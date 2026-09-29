import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import { createHash, timingSafeEqual } from "crypto";
import { createServer as createViteServer } from "vite";
import rateLimit from "express-rate-limit";
import { ACCESS_KEY_HEADER, RATE_LIMIT_PER_MINUTE } from "./src/shared/aiConfig";
import { buildPrompt, parseRequest, parseTranscribeRequest } from "./server/prompts";
import { accessKeyProblem, parseTrustProxy } from "./server/config";
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

  // Rate limit and authenticate before parsing the body, so unauthenticated requests stay cheap
  app.use("/api/", apiLimiter, requireAccessKey(accessKey, keyProblem));
  
  // 2. Payload size limiter (Prevents massive 50MB texts from crashing server; the text limits above fit well within it)
  app.use(express.json({ limit: "8mb" }));

  // Lets the settings panel verify the access key without spending AI credits
  app.get("/api/auth-check", (req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/edit-stream", async (req, res) => {
    if ("problem" in ai) {
      return res.status(500).json({ error: ai.problem, code: "SERVER_ERROR" });
    }

    const parsed = parseRequest(req.body);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error, code: "BAD_REQUEST" });
    }
    const { systemInstruction, prompt, responseJsonSchema } = buildPrompt(parsed.value);

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
      res.write(sseEvent({ meta: { model: ai.provider.model, location: ai.provider.location } }));

      const finish = await ai.provider.generate(
        { systemInstruction, prompt, responseJsonSchema, signal: abortController.signal },
        // Thoughts are only shown in the task pane, never written into the document
        (event) => res.write(sseEvent(event.type === "thought" ? { thought: event.text } : { text: event.text }))
      );

      // A cut-off answer must never look complete: no [DONE], so the task pane won't insert it
      if (finish.reason !== "stop") {
        console.warn(`AI answer incomplete: ${finish.reason} (${finish.detail ?? "no detail"})`);
        res.write(sseEvent({ error: `The model stopped before finishing the answer (${finish.detail ?? finish.reason}).`, code: "INCOMPLETE", reason: finish.reason }));
        return res.end();
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      // The client went away on purpose, there is nobody left to tell
      if (abortController.signal.aborted) return;
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
    // A recording can't be masked: it may only go to the cloud when it stays in the EU (Vertex AI, europe-* region)
    if (!ai.provider.euResident) {
      return res.status(403).json({
        error: "Cloud dictation is only allowed with Vertex AI in an EU region (AI_PROVIDER=vertex, GOOGLE_CLOUD_LOCATION=europe-…).",
        code: "DICTATION_NOT_ALLOWED",
      });
    }
    const parsed = parseTranscribeRequest(req.body);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error, code: "BAD_REQUEST" });
    }
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });
    try {
      const text = await ai.provider.transcribe({ ...parsed.value, signal: abortController.signal });
      res.json({ text });
    } catch (error) {
      if (abortController.signal.aborted) return;
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
