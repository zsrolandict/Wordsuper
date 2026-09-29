import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import { createHash, timingSafeEqual } from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import rateLimit from "express-rate-limit";
import { ACCESS_KEY_HEADER, AI_MODEL, RATE_LIMIT_PER_MINUTE } from "./src/shared/aiConfig";
import { buildPrompt, parseRequest } from "./server/prompts";

// Compare digests so neither the length nor the content of the key leaks through timing
function keysMatch(provided: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

// 3. Access key (Prevents strangers from spending the Gemini credits of whoever hosts the add-in)
function requireAccessKey(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.APP_ACCESS_KEY;
  if (!expected) {
    return res.status(503).json({ error: "APP_ACCESS_KEY is not configured on the server.", code: "ACCESS_KEY_NOT_CONFIGURED" });
  }
  if (!keysMatch(req.get(ACCESS_KEY_HEADER) ?? "", expected)) {
    return res.status(401).json({ error: "Invalid or missing access key.", code: "UNAUTHORIZED" });
  }
  next();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.disable("x-powered-by");

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
  app.use("/api/", apiLimiter, requireAccessKey);
  
  // 2. Payload size limiter (Prevents massive 50MB texts from crashing server)
  app.use(express.json({ limit: "2mb" }));

  // Lets the settings panel verify the access key without spending AI credits
  app.get("/api/auth-check", (req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/edit-stream", async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server.", code: "SERVER_ERROR" });
    }

    const parsed = parseRequest(req.body);
    if ("error" in parsed) {
      return res.status(400).json({ error: parsed.error, code: "BAD_REQUEST" });
    }
    const { systemInstruction, prompt, responseSchema } = buildPrompt(parsed.value);

    // Stop generating (and spending tokens) as soon as the task pane disconnects, e.g. the user pressed Stop
    const abortController = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abortController.abort();
    });

    try {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const ai = new GoogleGenAI({ apiKey });
      const responseStream = await ai.models.generateContentStream({
        model: AI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          // Stream the model's thought summaries too, so the task pane can show how it reached the answer
          thinkingConfig: { includeThoughts: true },
          abortSignal: abortController.signal,
          ...(responseSchema ? { responseMimeType: "application/json", responseSchema } : {})
        }
      });

      for await (const chunk of responseStream) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (!part.text) continue;
          // Thoughts are only shown in the task pane, never written into the document
          const event = part.thought ? { thought: part.text } : { text: part.text };
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      // The client went away on purpose, there is nobody left to tell
      if (abortController.signal.aborted) return;
      console.error("AI Generation Stream Error:", error);
      res.write(`data: ${JSON.stringify({ error: "Failed to generate text." })}\n\n`);
      res.end();
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
