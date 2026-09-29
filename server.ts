import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import rateLimit from "express-rate-limit";
import { AI_MODEL, MAX_CONTEXT_CHARS, MAX_SELECTION_CHARS } from "./src/shared/aiConfig";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // 1. Rate Limiter (Prevents DDoS and Credit draining)
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // limit each IP to 20 requests per windowMs
    message: { error: "Too many requests from this IP, please try again after a minute." }
  });

  app.use("/api/", apiLimiter);
  
  // 2. Payload size limiter (Prevents massive 50MB texts from crashing server)
  app.use(express.json({ limit: "2mb" }));

  app.post("/api/edit-stream", async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
      }

      const ai = new GoogleGenAI({ apiKey });
      const { originalText, instruction, documentContext, mode } = req.body;

      if (!instruction) {
        return res.status(400).json({ error: "Missing instruction" });
      }
      
      if (mode !== "generate" && !originalText) {
        return res.status(400).json({ error: "Missing originalText" });
      }

      // Truncate context just in case it slips past the 2mb somehow or uses too many tokens
      const safeContext = documentContext ? documentContext.substring(0, MAX_CONTEXT_CHARS) : "";
      const safeOriginal = originalText ? originalText.substring(0, MAX_SELECTION_CHARS) : "";

      let systemInstruction = "";
      let prompt = "";
      
      // Move structural rules to System Instructions (Prevents Prompt Injection)
      if (mode === "generate") {
        systemInstruction = `You are a professional legal and business advisor AI operating within Microsoft Word.
Your task is to generate new text or a new clause based on the user's instruction, to be inserted into the document.
RULES:
- Return ONLY the newly generated text.
- Do NOT wrap the text in quotes, markdown blocks, or add any conversational filler.
- Ensure the tone matches the document context if provided.`;

        prompt = `INSTRUCTION:\n${instruction}\n\n${safeContext ? `ENTIRE DOCUMENT CONTEXT (For your reference only, to ensure consistent tone, formatting, and terminology. DO NOT output this):\n${safeContext}\n` : ""}`;
      
      } else if (mode === "comment") {
        systemInstruction = `You are a professional legal and business advisor AI operating within Microsoft Word.
Your task is to analyze the user's selected text based on their instruction and provide a concise comment/margin note.
RULES:
- Return ONLY the text for the comment.
- Keep it concise, professional, and directly address the instruction.
- Do NOT wrap the text in quotes, markdown blocks, or add any conversational filler.`;

        prompt = `INSTRUCTION:\n${instruction}\n\n${safeContext ? `ENTIRE DOCUMENT CONTEXT (For your reference only):\n${safeContext}\n` : ""}SELECTED TEXT TO ANALYZE:\n${safeOriginal}`;
      
      } else {
        systemInstruction = `You are a professional text editor AI operating directly within Microsoft Word. 
Your task is to modify the user's selected text based on their instruction.
RULES:
- Return ONLY the modified text for the "ORIGINAL TEXT TO MODIFY" section.
- Do NOT wrap the text in quotes, markdown blocks, or add any conversational filler (e.g. "Here is the text:").
- Maintain the original formatting structure (paragraphs) as much as possible.
- Ensure the tone and content align with the ENTIRE DOCUMENT CONTEXT if provided.`;

        prompt = `INSTRUCTION:\n${instruction}\n\n${safeContext ? `ENTIRE DOCUMENT CONTEXT (For your reference only to understand the surrounding context. DO NOT output this, only use it to make better decisions for the selection):\n${safeContext}\n` : ""}ORIGINAL TEXT TO MODIFY (You must rewrite ONLY this part):\n${safeOriginal}`;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const responseStream = await ai.models.generateContentStream({
        model: AI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: systemInstruction,
          // Stream the model's thought summaries too, so the task pane can show how it reached the answer
          thinkingConfig: { includeThoughts: true }
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
