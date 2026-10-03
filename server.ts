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
import { contentSecurityPolicy, parseAccessKeys, parseDictationPolicy, parseMaskingPolicy, parseStylesLocked, parseTrustProxy, readOfficeStyles, type AccessKeys } from "./server/config";
import { readVersion } from "./server/version";
import { generateManifest } from "./src/manifest";
import { bearerToken, createMicrosoftVerifier, parseAuthConfig, type MicrosoftAuthConfig, type MicrosoftVerifier } from "./server/msAuth";
import { providerFromEnv } from "./server/ai";

// Compare digests so neither the length nor the content of the key leaks through timing
function keysMatch(provided: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

// 3. Access key (Prevents strangers from spending the AI credits of whoever hosts the add-in)
/** Whose key it is: the owner of a personal key, "" for the shared key, null for no valid key */
function keyOwner(keys: AccessKeys, provided: string): string | null {
  let owner: string | null = null;
  // Every key is compared, so the time taken does not tell which one matched
  for (const [key, name] of keys.personal) if (keysMatch(provided, key)) owner = name;
  if (keys.shared && keysMatch(provided, keys.shared) && owner === null) owner = "";
  return owner;
}

function requireAuth(keys: AccessKeys, microsoft: MicrosoftAuthConfig, verify: MicrosoftVerifier | null) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Tells the task pane how to sign in, so it must work before signing in
    if (req.path === "/auth-mode") return next();
    if (microsoft.problem) {
      return res.status(503).json({ error: `Microsoft sign-in is not configured properly: ${microsoft.problem}`, code: "AUTH_NOT_CONFIGURED" });
    }
    const token = microsoft.mode !== "key" ? bearerToken(req.get("Authorization")) : null;
    let tokenProblem = "";
    if (token && verify) {
      const result = await verify(token);
      if ("user" in result) {
        // Verified by Microsoft: the audit log names the user's work account
        res.locals.keyOwner = result.user;
        res.locals.authMethod = "microsoft";
        res.locals.displayName = result.name;
        return next();
      }
      tokenProblem = result.error;
    }
    if (microsoft.mode === "microsoft") {
      return res.status(401).json(tokenProblem
        ? { error: `Microsoft sign-in failed: ${tokenProblem}.`, code: "MICROSOFT_TOKEN_INVALID" }
        : { error: "This server needs Microsoft sign-in.", code: "MICROSOFT_LOGIN_REQUIRED" });
    }
    if (keys.problem) {
      return res.status(503).json({ error: `The access key is not configured properly: ${keys.problem}`, code: "ACCESS_KEY_NOT_CONFIGURED" });
    }
    const owner = keyOwner(keys, req.get(ACCESS_KEY_HEADER) ?? "");
    if (owner === null) {
      return res.status(401).json(tokenProblem
        ? { error: `Microsoft sign-in failed: ${tokenProblem}, and there is no valid access key either.`, code: "MICROSOFT_TOKEN_INVALID" }
        : { error: "Invalid or missing access key.", code: "UNAUTHORIZED" });
    }
    // A personal key tells who it is; with the shared key only the name typed in the settings is known
    res.locals.keyOwner = owner;
    res.locals.authMethod = owner ? "personal-key" : "shared-key";
    next();
  };
}

const sseEvent = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/** Longest an answer may take; a whole-contract review with deep thinking takes a few minutes */
const GENERATION_TIMEOUT_MS = 8 * 60 * 1000;
/** An SSE comment line this often, so a silently thinking model is not taken for a dropped connection */
const HEARTBEAT_MS = 20 * 1000;

async function startServer() {
  const app = express();
  // Cloud Run (and most hosts) say which port to listen on
  const PORT = Number(process.env.PORT) || 3000;

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
  const accessKeys = parseAccessKeys(process.env.APP_ACCESS_KEY, process.env.APP_ACCESS_KEYS);
  const microsoftAuth = parseAuthConfig(process.env);
  if (microsoftAuth.problem) console.warn(`${microsoftAuth.problem} Every /api request will be refused.`);
  else if (microsoftAuth.mode !== "key") console.log(`Microsoft sign-in: ${microsoftAuth.mode === "both" ? "on, access keys still accepted" : "required"}${microsoftAuth.allowedDomains.length ? ` (${microsoftAuth.allowedDomains.join(", ")})` : ""}`);
  const verifyMicrosoft = microsoftAuth.mode !== "key" && !microsoftAuth.problem ? createMicrosoftVerifier(microsoftAuth) : null;
  // With Microsoft sign-in only, the access keys are not used at all
  if (microsoftAuth.mode !== "microsoft") {
    accessKeys.warnings.forEach(warning => console.warn(warning));
    if (accessKeys.problem) console.warn(`${accessKeys.problem} ${microsoftAuth.mode === "both" ? "Only Microsoft sign-in will work." : "Every /api request will be refused."}`);
    else if (accessKeys.personal.size) console.log(`Personal access keys: ${accessKeys.personal.size}${accessKeys.shared ? " (and the shared key)" : ""}`);
  }

  const audit = createAuditLogger(process.env.AUDIT_LOG_FILE);
  // The Microsoft account and the owner of a personal key are verified; the name typed in the settings is not
  const auditBase = (req: Request) => {
    const owner = (req.res?.locals.keyOwner as string | undefined) || "";
    const auth = req.res?.locals.authMethod as AuditEntry["auth"];
    return owner ? { user: owner, verified: true, auth, ip: req.ip ?? "" } : { user: readUserId(req.get(USER_ID_HEADER)), verified: false, auth, ip: req.ip ?? "" };
  };

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
  app.use("/api/", (req, res, next) => (["/info", "/office-styles", "/auth-mode"].includes(req.path) ? infoLimiter : apiLimiter)(req, res, next), requireAuth(accessKeys, microsoftAuth, verifyMicrosoft));
  
  // 2. Payload size limiter (Prevents massive 50MB texts from crashing server; the text limits above fit well within it)
  app.use(express.json({ limit: "8mb" }));

  const version = readVersion();
  const dictationPolicy = parseDictationPolicy(process.env.DICTATION_POLICY);
  const maskingPolicy = parseMaskingPolicy(process.env.MASKING_POLICY);
  console.log(`Version: ${version.commit} (${version.date || "no date"}); dictation policy: ${dictationPolicy}; masking: ${maskingPolicy}`);

  // How the task pane signs in: Microsoft account, access key, or either
  app.get("/api/auth-mode", (req, res) => {
    res.json({ mode: microsoftAuth.problem ? "key" : microsoftAuth.mode });
  });

  // Lets the settings panel verify the sign-in without spending AI credits, and shows whom the server sees
  app.get("/api/auth-check", (req, res) => {
    res.json({ ok: true, method: res.locals.authMethod, user: res.locals.keyOwner || null, name: res.locals.displayName || null });
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

  // The firm's own styles (OFFICE_STYLES_FILE), and whether they are the only ones allowed (OFFICE_STYLES_LOCKED)
  const stylesLocked = parseStylesLocked(process.env.OFFICE_STYLES_LOCKED);
  const firstStyles = readOfficeStyles(process.env.OFFICE_STYLES_FILE, path => fs.readFileSync(path, "utf8"));
  if (firstStyles.problem) console.warn(firstStyles.problem);
  else if (firstStyles.styles.length) console.log(`Office styles: ${firstStyles.styles.length}${stylesLocked ? " (locked)" : ""}`);
  app.get("/api/office-styles", (req, res) => {
    const { styles } = readOfficeStyles(process.env.OFFICE_STYLES_FILE, path => fs.readFileSync(path, "utf8"));
    res.json({ styles, locked: stylesLocked && styles.length > 0 });
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
    // A model that hangs is stopped after a while; a heartbeat shows the task pane the connection is alive
    // while the model thinks silently (the pane gives up after a longer silence, see streamAIResponse)
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, GENERATION_TIMEOUT_MS);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, HEARTBEAT_MS);
    const stopTimers = () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);
    };
    res.on("close", () => {
      stopTimers();
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
      if (timedOut) {
        logResult("error", { detail: "TIMEOUT" });
        res.write(sseEvent({ error: `The model did not finish within ${GENERATION_TIMEOUT_MS / 60000} minutes.`, code: "TIMEOUT" }));
        res.end();
        return;
      }
      // The client went away on purpose, there is nobody left to tell
      if (abortController.signal.aborted) {
        logResult("aborted");
        return;
      }
      logResult("error", { detail: "SERVER_ERROR" });
      console.error("AI Generation Stream Error:", error);
      res.write(sseEvent({ error: "Failed to generate text.", code: "SERVER_ERROR" }));
      res.end();
    } finally {
      stopTimers();
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

  // The add-in's manifest for this server, for central deployment (Microsoft 365 admin center) or sideloading.
  // The address comes from PUBLIC_URL, or else from the request (behind Cloud Run's proxy: https and its host).
  // With Microsoft sign-in it carries the app registration, so Word can sign the user in.
  app.get("/manifest.xml", (req, res) => {
    const base = (process.env.PUBLIC_URL?.trim() || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const ssoClientId = microsoftAuth.mode !== "key" && !microsoftAuth.problem ? microsoftAuth.clientId : undefined;
    res.type("application/xml").setHeader("Content-Disposition", 'inline; filename="manifest.xml"');
    res.send(generateManifest(base, ssoClientId));
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
