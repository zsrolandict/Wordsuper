// Checks of the server's own configuration; pure functions so they can be tested without starting the server

/** Values from .env.example that must never be accepted as a real key */
const PLACEHOLDER_ACCESS_KEYS = new Set(["MY_APP_ACCESS_KEY"]);
export const MIN_ACCESS_KEY_LENGTH = 16;

/** Why APP_ACCESS_KEY can't be used, or null when it's fine */
/**
 * eu-only: cloud dictation only when the server processes data in the EU.
 * user-risk (default): it is also allowed anywhere else when the user explicitly accepts the risk in the settings.
 */
export type DictationPolicy = "eu-only" | "user-risk";
export const parseDictationPolicy = (value: string | undefined): DictationPolicy =>
  value?.trim().toLowerCase() === "eu-only" ? "eu-only" : "user-risk";

/**
 * required (default): the server refuses requests the task pane did not mask, so nothing leaves unmasked by mistake
 * (e.g. a user switched masking off). optional: the user may switch masking off.
 */
export type MaskingPolicy = "required" | "optional";
export const parseMaskingPolicy = (value: string | undefined): MaskingPolicy =>
  value?.trim().toLowerCase() === "optional" ? "optional" : "required";

export function accessKeyProblem(key: string | undefined): string | null {
  const value = key?.trim() ?? "";
  if (!value) return "APP_ACCESS_KEY is not set.";
  if (PLACEHOLDER_ACCESS_KEYS.has(value)) return "APP_ACCESS_KEY still has the placeholder value from .env.example.";
  if (value.length < MIN_ACCESS_KEY_LENGTH) return `APP_ACCESS_KEY is shorter than ${MIN_ACCESS_KEY_LENGTH} characters.`;
  return null;
}

export type TrustProxy = false | number | string;

/**
 * Behind a reverse proxy (Cloud Run, a load balancer) req.ip is the proxy's address, so every user would share one
 * rate limit bucket. TRUST_PROXY tells Express which X-Forwarded-For hops to trust: a hop count or addresses/subnets
 * (e.g. "loopback, 10.0.0.0/8"). On Cloud Run it defaults to one hop. "true" is refused: it trusts any hop, so
 * clients could dodge the rate limit with a fake X-Forwarded-For.
 */
export function parseTrustProxy(raw: string | undefined, onCloudRun: boolean): { value: TrustProxy; warning?: string } {
  const fallback: TrustProxy = onCloudRun ? 1 : false;
  const value = raw?.trim() ?? "";
  if (!value) return { value: fallback };

  const lower = value.toLowerCase();
  if (lower === "false") return { value: false };
  if (/^\d+$/.test(value)) return { value: Number(value) };
  if (lower === "true") {
    return { value: fallback, warning: 'TRUST_PROXY=true would trust any X-Forwarded-For hop; use a hop count such as "1". Ignoring it.' };
  }
  return { value };
}

/**
 * Content Security Policy of the task pane. Its main job is connect-src: the page may only talk to this server,
 * Microsoft's Office.js host and (for the local dictation model's one-time download) Hugging Face, so even a
 * compromised dependency could not send the document anywhere else. Scripts stay permissive ('unsafe-eval' for
 * Office.js, WebAssembly for local dictation, inline for the dev server's React refresh). CSP=off switches it off.
 */
export function contentSecurityPolicy(setting: string | undefined): string | null {
  if (setting?.trim().toLowerCase() === "off") return null;
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://appsforoffice.microsoft.com",
    "worker-src 'self' blob:",
    "connect-src 'self' ws://localhost:* wss://localhost:* https://appsforoffice.microsoft.com https://huggingface.co https://*.huggingface.co https://*.hf.co",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
