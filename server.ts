import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import https from "https";
import { createHash, timingSafeEqual } from "crypto";
import { createServer as createViteServer } from "vite";
import rateLimit from "express-rate-limit";
import { ACCESS_KEY_HEADER, RATE_LIMIT_PER_MINUTE, USER_ID_HEADER } from "./src/shared/aiConfig";
import { createAuditLogger, readUserId, type AuditEntry } from "./server/audit";
import { buildPrompt, parseRequest, parseTranscribeRequest } from "./server/prompts";
import { accessKeyProblem, contentSecurityPolicy, parseDictationPolicy, parseMaskingPolicy, parseTrustProxy } from "./server/config";
import { readVersion } from "./server/version";
import { providerFromEnv } from "./server/ai";

// Compare digests so neither the length nor the content of the key leaks through timing
function keysMatch(provided: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

// 3. Access key (Prevents strangers from spending the AI credits of whoever hosts the add-in)
function requireAccessKey(expected: string | null, problem: string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (problem || !expected) {
      return res.status(503).json({ error: `The access key is not configured properly: ${problem}`, code: "ACCESS_KEY_NOT_CONFIGURED" });
    }
    if (!keysMatch(req.get(ACCESS_KEY_HEADER) ?? "", expected)) {
      return res.status(401).json({ error: "Invalid or missing access key.", code: "UNAUTHORIZED" });
    }
    next();
  };
}

const sseEvent = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.disable("x-powered-by");

  // Where the task pane may send data (see contentSecurityPolicy)
  const csp = contentSecurityPolicy(process.env.CSP);
  if (csp) {
    app.use((req, res, next) => {
      res.setHeader("Content-Security-Policy", csp);
      next();
    });
  } else {
    console.warn("CSP=off: the task pane may connect anywhere.");
  }

  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY, !!process.env.K_SERVICE);
  if (trustProxy.warning) console.warn(trustProxy.warning);
  try {
    app.set("trust proxy", trustProxy.value);
  } catch (error) {
    // Express compiles the address list right away; a typo must not take the whole server down
    console.warn(`Invalid TRUST_PROXY value, ignoring it: ${(error as Error).message}`);
    app.set("trust proxy", parseTrustProxy(undefined, !!process.env.K_SERVICE).value);
  }

  // Secrets from files or `gcloud secrets` often end with a newline; Node trims header values the same way
  const accessKey = process.env.APP_ACCESS_KEY?.trim() || null;
  const keyProblem = accessKeyProblem(accessKey ?? undefined);
  if (keyProblem) console.warn(`${keyProblem} Every /api request will be refused.`);

  const audit = createAuditLogger(process.env.AUDIT_LOG_FILE);
  const auditBase = (req: Request) => ({ user: readUserId(req.get(USER_ID_HEADER)), ip: req.ip ?? "" });

  const ai = providerFromEnv(process.env);
  if ("problem" in ai) console.warn(ai.problem);
  else console.log(`AI: ${ai.provider.model} via ${ai.provider.location}`);

  // 1. Rate Limiter (Prevents DDoS, credit draining and access key guessing)
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: RATE_LIMIT_PER_MINUTE, // per IP per windowMs
    // RateLimit-Limit / -Remaining / -Reset headers let the task pane show how many requests are left
    standardHeaders: "draft-6",
    legacyHeaders: false,
    message: { error: "Too many requests from this IP, please try again after a minute.", code: "RATE_LIMITED" }
  });

  // The version check (/api/info) is cheap and runs on its own schedule: it must not use up the AI requests' budget
  const infoLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 6 * RATE_LIMIT_PER_MINUTE,
    standardHeaders: false,
    legacyHeaders: false,
    message: { error: "Too many requests from this IP, please try again after a minute.", code: "RATE_LIMITED" }
  });

  // Rate limit and authenticate before parsing the body, so unauthenticated requests stay cheap
  app.use("/api/", (req, res, next) => (req.path === "/info" ? infoLimiter : apiLimiter)(req, res, next), requireAccessKey(accessKey, keyProblem));
  
  // 2. Payload size limiter (Prevents massive 50MB texts from crashing server; the text limits above fit well within it)
  app.use(express.json({ limit: "8mb" }));

  const version = readVersion();
  const dictationPolicy = parseDictationPolicy(process.env.DICTATION_POLICY);
  const maskingPolicy = parseMaskingPolicy(process.env.MASKING_POLICY);
  console.log(`Version: ${version.commit} (${version.date || "no date"}); dictation policy: ${dictationPolicy}; masking: ${maskingPolicy}`);

  // Lets the settings panel verify the access key without spending AI credits
  app.get("/api/auth-check", (req, res) => {
    res.json({ ok: true });
  });

  // What is running: shown in the settings, so a stale server or page is visible
  app.get("/api/info", (req, res) => {
    res.json({
      version: version.commit,
      date: version.date,
      model: "provider" in ai ? ai.provider.model : null,
      location: "provider" in ai ? ai.provider.location : null,
      euResident: "provider" in ai ? ai.provider.euResident : false,
      dictationPolicy,
      maskingPolicy,
    });
  });

  app.post("/api/edit-stream", async (req, res) => {
    if ("problem" in ai) {
      return res.status(500).json({ error: ai.problem, code: "SERVER_ERROR" });
    }

    const startedAt = Date.now();
    const parsed = parseRequest(req.body);
    if ("error" in parsed) {
      audit({ ...auditBase(req), action: String(req.body?.mode ?? "unknown").slice(0, 20), status: "rejected", detail: parsed.error, model: ai.provider.model, location: ai.provider.location, durationMs: 0 });
      return res.status(400).json({ error: parsed.error, code: "BAD_REQUEST" });
    }
    const request = parsed.value;
    // Against mistakes, not against a hostile client: the task pane says whether it masked the texts
    if (maskingPolicy === "required" && !request.masked) {
      audit({ ...auditBase(req), action: request.mode, status: "rejected", detail: "MASKING_REQUIRED", model: ai.provider.model, location: ai.provider.location, durationMs: 0 });
      return res.status(403).json({ error: "This server only accepts masked requests (MASKING_POLICY=required).", code: "MASKING_REQUIRED" });
    }
    const { systemInstruction, prompt, responseJsonSchema } = buildPrompt(request);
    // Metadata only: sizes and flags, never the texts
    const logResult = (status: AuditEntry["status"], extra: Partial<AuditEntry> = {}) => audit({
      ...auditBase(req),
      action: request.mode,
      status,
      chars: {
        selection: request.originalText.length,
        context: request.documentContext.length,
        history: (request.history ?? []).reduce((n, turn) => n + turn.instruction.length + turn.result.length, 0),
      },
      masked: !!request.masked,
      maskedValues: request.maskedValues,
      wholeDocument: !!request.wholeDocument,
      depth: request.depth ?? "auto",
      model: ai.provider.modelFor(request.depth),
      location: ai.provider.location,
      durationMs: Date.now() - startedAt,
      ...extra,
    });

    // Stop generating (and spending tokens) as soon as the task pane disconnects, e.g. the user pressed Stop
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Tells the task pane which model answered and where the text was processed
      res.write(sseEvent({ meta: { model: ai.provider.modelFor(request.depth), location: ai.provider.location } }));

      const finish = await ai.provider.generate(
        { systemInstruction, prompt, responseJsonSchema, signal: abortController.signal, depth: request.depth },
        // Thoughts are only shown in the task pane, never written into the document
        (event) => res.write(sseEvent(event.type === "thought" ? { thought: event.text } : { text: event.text }))
      );

      // A cut-off answer must never look complete: no [DONE], so the task pane won't insert it
      if (finish.reason !== "stop") {
        logResult("incomplete", { tokens: finish.usage, detail: finish.detail ?? finish.reason });
        console.warn(`AI answer incomplete: ${finish.reason} (${finish.detail ?? "no detail"})`);
        res.write(sseEvent({ error: `The model stopped before finishing the answer (${finish.detail ?? finish.reason}).`, code: "INCOMPLETE", reason: finish.reason }));
        return res.end();
      }

      logResult("ok", { tokens: finish.usage });
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      // The client went away on purpose, there is nobody left to tell
      if (abortController.signal.aborted) {
        logResult("aborted");
        return;
      }
      logResult("error", { detail: "SERVER_ERROR" });
      console.error("AI Generation Stream Error:", error);
      res.write(sseEvent({ error: "Failed to generate text.", code: "SERVER_ERROR" }));
      res.end();
    }
  });

  // Dictation: a short recording in, the transcript out
  app.post("/api/transcribe", async (req, res) => {
    if ("problem" in ai) {
      return res.status(500).json({ error: ai.problem, code: "SERVER_ERROR" });
    }
    const startedAt = Date.now();
    const logDictation = (status: AuditEntry["status"], extra: Partial<AuditEntry> = {}) => audit({
      ...auditBase(req),
      action: "dictation",
      status,
      audioBytes: typeof req.body?.audio === "string" ? Math.floor(req.body.audio.length * 0.75) : 0,
      model: ai.provider.model,
      location: ai.provider.location,
      durationMs: Date.now() - startedAt,
      ...extra,
    });
    // A recording can't be masked. Outside the EU (Vertex AI, europe-* region) it is only sent when the user accepted
    // the risk in the settings, unless the operator forbids that (DICTATION_POLICY=eu-only)
    const riskAccepted = req.body?.riskAccepted === true;
    if (!ai.provider.euResident && !(dictationPolicy === "user-risk" && riskAccepted)) {
      logDictation("rejected", { detail: "DICTATION_NOT_ALLOWED" });
      return res.status(403).json({
        error: dictationPolicy === "eu-only"
          ? "Cloud dictation is only allowed with Vertex AI in an EU region on this server (DICTATION_POLICY=eu-only)."
          : "Cloud dictation outside the EU needs the user to accept the risk in the settings.",
        code: dictationPolicy === "eu-only" ? "DICTATION_NOT_ALLOWED" : "DICTATION_RISK_NOT_ACCEPTED",
      });
    }
    const parsed = parseTranscribeRequest(req.body);
    if ("error" in parsed) {
      logDictation("rejected", { detail: parsed.error });
      return res.status(400).json({ error: parsed.error, code: "BAD_REQUEST" });
    }
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });
    try {
      const { text, usage } = await ai.provider.transcribe({ ...parsed.value, signal: abortController.signal });
      logDictation("ok", { tokens: usage, detail: ai.provider.euResident ? undefined : "non-EU, risk accepted by the user" });
      res.json({ text });
    } catch (error) {
      if (abortController.signal.aborted) {
        logDictation("aborted");
        return;
      }
      logDictation("error", { detail: "SERVER_ERROR" });
      console.error("Transcription error:", error);
      res.status(502).json({ error: "Failed to transcribe the recording.", code: "SERVER_ERROR" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Local HTTPS for Word on the desktop (scripts/word-local.ts, started by INDITAS.bat): Office add-ins must be
  // served over HTTPS, with the certificate from `npx office-addin-dev-certs install`
  const localHttpsPort = Number(process.env.LOCAL_HTTPS_PORT);
  if (localHttpsPort) {
    const certDir = path.join(os.homedir(), ".office-addin-dev-certs");
    try {
      const options = { cert: fs.readFileSync(path.join(certDir, "localhost.crt")), key: fs.readFileSync(path.join(certDir, "localhost.key")) };
      https.createServer(options, app).listen(localHttpsPort, "127.0.0.1", () => {
        console.log(`Server running on https://localhost:${localHttpsPort}`);
      });
    } catch {
      console.error(`No development certificate in ${certDir}. Run: npx office-addin-dev-certs install`);
      process.exit(1);
    }
    return;
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
