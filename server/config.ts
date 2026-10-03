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

/** The server's access keys: a shared one (APP_ACCESS_KEY), and personal ones (APP_ACCESS_KEYS="anna:key1, péter:key2") */
export interface AccessKeys {
  shared: string | null;
  /** key → whose it is */
  personal: Map<string, string>;
  /** Why no request can be accepted at all, or null */
  problem: string | null;
  /** Personal entries that were skipped, for the start-up log */
  warnings: string[];
}

/**
 * Personal keys let each colleague have their own key, revoked one by one, and make the audit log's user the
 * verified owner of the key instead of a name anyone can type. The shared key keeps working next to them.
 */
export function parseAccessKeys(sharedRaw: string | undefined, personalRaw: string | undefined): AccessKeys {
  const warnings: string[] = [];
  const personal = new Map<string, string>();
  const names = new Set<string>();
  for (const entry of (personalRaw ?? '').split(/[,;\n]/).map(e => e.trim()).filter(Boolean)) {
    const colon = entry.indexOf(':');
    const name = colon > 0 ? entry.slice(0, colon).trim() : '';
    const key = colon > 0 ? entry.slice(colon + 1).trim() : '';
    const problem = !name ? 'it has no "name:" in front' : accessKeyProblem(key);
    if (problem) warnings.push(`APP_ACCESS_KEYS entry ${name ? `"${name}"` : `#${personal.size + warnings.length + 1}`} skipped: ${problem.replace(/^APP_ACCESS_KEY/, 'the key')}`);
    else if (personal.has(key)) warnings.push(`APP_ACCESS_KEYS entry "${name}" skipped: the same key is already given to "${personal.get(key)}".`);
    else if (names.has(name)) warnings.push(`APP_ACCESS_KEYS entry "${name}" skipped: the name is used twice.`);
    else {
      personal.set(key, name);
      names.add(name);
    }
  }
  const sharedValue = sharedRaw?.trim() || null;
  const sharedProblem = accessKeyProblem(sharedValue ?? undefined);
  // Without a usable shared key, personal keys alone are enough
  if (sharedProblem && sharedValue) warnings.push(`${sharedProblem} The shared key is not accepted.`);
  const shared = sharedProblem ? null : sharedValue;
  return { shared, personal, problem: !shared && !personal.size ? sharedProblem : null, warnings };
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

/**
 * The firm's own styles for the Formázás tab, from a JSON file next to the server (OFFICE_STYLES_FILE): the
 * "Exportálás" file of the task pane, put there by whoever runs the server. Read on every request, so a new file
 * needs no restart. The task pane checks every field again before it uses a style.
 */
export function readOfficeStyles(path: string | undefined, read: (path: string) => string): { styles: unknown[]; problem?: string } {
  if (!path?.trim()) return { styles: [] };
  try {
    const data = JSON.parse(read(path.trim()));
    const styles = Array.isArray(data) ? data : Array.isArray(data?.styles) ? data.styles : null;
    if (!styles) return { styles: [], problem: `OFFICE_STYLES_FILE (${path}) has no "styles" list.` };
    return { styles: styles.slice(0, 20) };
  } catch (error) {
    return { styles: [], problem: `OFFICE_STYLES_FILE (${path}) cannot be read: ${(error as Error).message}` };
  }
}

/** OFFICE_STYLES_LOCKED=true: only the firm's styles can be used, and their values can't be changed in the pane */
export const parseStylesLocked = (value: string | undefined) => /^(1|true|yes|igen)$/i.test(value?.trim() ?? '');
