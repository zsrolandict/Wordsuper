import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import rateLimit from "express-rate-limit";

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

  app.post("/api/edit", async (req, res) => {
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

      // 3. Truncate context just in case it slips past the 2mb somehow or uses too many tokens
      const safeContext = documentContext ? documentContext.substring(0, 40000) : "";
      const safeOriginal = originalText ? originalText.substring(0, 10000) : "";

      let systemInstruction = "";
      let prompt = "";
      
      // 4. Move structural rules to System Instructions (Prevents Prompt Injection)
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

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          systemInstruction: systemInstruction
        }
      });

      res.json({ result: response.text });
    } catch (error) {
      console.error("AI Generation Error:", error);
      res.status(500).json({ error: "Failed to generate modified text." });
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
