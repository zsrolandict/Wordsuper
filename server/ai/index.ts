import { createGeminiProvider } from "./gemini";
import type { ModelProvider } from "./types";

export type { ModelProvider, StreamEvent, StreamFinish, TokenUsage } from "./types";

// gemini-2.5-flash is no longer available to new Gemini API users
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_VERTEX_LOCATION = "europe-west1";

/**
 * Picks the model provider from the environment:
 * - AI_PROVIDER=gemini (default): Gemini Developer API with GEMINI_API_KEY
 * - AI_PROVIDER=vertex: Vertex AI in GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION (default europe-west1),
 *   so documents are processed in the EU; credentials come from the service account
 * AI_MODEL overrides the model name.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv): { provider: ModelProvider } | { problem: string } {
  const model = env.AI_MODEL?.trim() || DEFAULT_MODEL;
  const deepModel = env.AI_MODEL_DEEP?.trim() || undefined;
  const kind = (env.AI_PROVIDER?.trim() || "gemini").toLowerCase();

  if (kind === "vertex") {
    const project = env.GOOGLE_CLOUD_PROJECT?.trim();
    if (!project) return { problem: "AI_PROVIDER=vertex needs GOOGLE_CLOUD_PROJECT." };
    const location = env.GOOGLE_CLOUD_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION;
    return { provider: createGeminiProvider({ model, deepModel, vertexProject: project, vertexLocation: location }) };
  }
  if (kind === "gemini") {
    const apiKey = env.GEMINI_API_KEY?.trim();
    if (!apiKey) return { problem: "GEMINI_API_KEY is not configured on the server." };
    return { provider: createGeminiProvider({ model, deepModel, apiKey }) };
  }
  return { problem: `Unknown AI_PROVIDER "${kind}" (use "gemini" or "vertex").` };
}
