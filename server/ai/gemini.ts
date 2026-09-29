import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { ModelProvider, StreamFinish, TokenUsage } from "./types";

const toUsage = (u: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number }): TokenUsage => ({
  prompt: u.promptTokenCount ?? 0,
  output: u.candidatesTokenCount ?? 0,
  thoughts: u.thoughtsTokenCount ?? 0,
  total: u.totalTokenCount ?? 0,
});

const TRANSCRIBE_INSTRUCTION = `Transcribe the speech in the recording word for word, in the language spoken (usually Hungarian).
Return only the transcript with proper punctuation: no comments, no quotation marks, no timestamps.
The speaker dictates an instruction for editing a legal or business document. If there is no intelligible speech, return an empty answer.`;

export interface GeminiConfig {
  model: string;
  /** Used for "deep" requests when set, e.g. a Pro model */
  deepModel?: string;
  /** Gemini Developer API key; used when no Vertex AI project is given */
  apiKey?: string;
  /** Vertex AI keeps the data in the chosen Google Cloud region (e.g. europe-west1); credentials come from the environment */
  vertexProject?: string;
  vertexLocation?: string;
}

const SAFETY_REASONS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]);

/** Maps Gemini's finish/block reasons to the provider-independent ones */
export function mapGeminiFinish(finishReason: string | undefined, blockReason: string | undefined): StreamFinish {
  if (blockReason) return { reason: "safety", detail: blockReason };
  if (finishReason === undefined || finishReason === "STOP") return { reason: "stop" };
  if (finishReason === "MAX_TOKENS") return { reason: "length", detail: finishReason };
  if (SAFETY_REASONS.has(finishReason)) return { reason: "safety", detail: finishReason };
  return { reason: "other", detail: finishReason };
}

export function createGeminiProvider(config: GeminiConfig): ModelProvider {
  const ai = config.vertexProject
    ? new GoogleGenAI({ vertexai: true, project: config.vertexProject, location: config.vertexLocation })
    : new GoogleGenAI({ apiKey: config.apiKey });

  return {
    model: config.model,
    location: config.vertexProject ? `Vertex AI (${config.vertexLocation})` : "Gemini API",
    // europe-* regions and the "eu" jurisdictional multi-region keep ML processing in the EU
    modelFor: (depth) => (depth === "deep" && config.deepModel ? config.deepModel : config.model),
    euResident: !!config.vertexProject && /^(europe-|eu$)/.test(config.vertexLocation ?? ""),

    async generate({ systemInstruction, prompt, responseJsonSchema, signal, depth }, onEvent) {
      const stream = await ai.models.generateContentStream({
        model: this.modelFor(depth),
        contents: prompt,
        config: {
          systemInstruction,
          // Stream the model's thought summaries too, so the task pane can show how it reached the answer
          thinkingConfig: {
            includeThoughts: true,
            ...(depth === "fast" ? { thinkingLevel: ThinkingLevel.LOW } : depth === "deep" ? { thinkingLevel: ThinkingLevel.HIGH } : {}),
          },
          abortSignal: signal,
          ...(responseJsonSchema ? { responseMimeType: "application/json", responseJsonSchema } : {}),
        },
      });

      let finishReason: string | undefined;
      let blockReason: string | undefined;
      let usage: TokenUsage | undefined;
      for await (const chunk of stream) {
        blockReason ??= chunk.promptFeedback?.blockReason;
        // Reported with the last chunk; kept for the audit log
        if (chunk.usageMetadata) usage = toUsage(chunk.usageMetadata);
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.text) onEvent({ type: part.thought ? "thought" : "text", text: part.text });
        }
        finishReason = candidate?.finishReason ?? finishReason;
      }
      return { ...mapGeminiFinish(finishReason, blockReason), usage };
    },

    async transcribe({ audio, mimeType, signal }) {
      const response = await ai.models.generateContent({
        model: config.model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: audio } }, { text: "Transcribe this recording." }] }],
        config: { systemInstruction: TRANSCRIBE_INSTRUCTION, abortSignal: signal },
      });
      return { text: (response.text ?? "").trim(), usage: response.usageMetadata && toUsage(response.usageMetadata) };
    },
  };
}
