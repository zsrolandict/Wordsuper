import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Sign-in with the Microsoft work account (Office single sign-on). Word gives the task pane a token for this add-in
 * (Office.auth.getAccessToken); the server checks its signature with Microsoft's public keys and takes the user's
 * name from it. No shared secret is needed, and the audit log names everyone verified.
 */

/** key: access keys only (as before); microsoft: Microsoft sign-in only; both: either one */
export const AUTH_MODES = ["key", "microsoft", "both"] as const;
export type AuthMode = typeof AUTH_MODES[number];

export interface MicrosoftAuthConfig {
  mode: AuthMode;
  /** The add-in's app registration in Entra ID (Application (client) ID) */
  clientId: string;
  /** The firm's directory (Directory (tenant) ID): only its users get in */
  tenantId: string;
  /** Optional further limit on the sign-in name's domain ("iroda.hu") */
  allowedDomains: string[];
  /** Microsoft sign-in is asked for but can't work: every request is refused until it is fixed */
  problem: string | null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The scope the app registration exposes for Office ("Expose an API") */
export const SSO_SCOPE = "access_as_user";

export function parseAuthConfig(env: { AUTH_MODE?: string; MS_CLIENT_ID?: string; MS_TENANT_ID?: string; MS_ALLOWED_DOMAINS?: string }): MicrosoftAuthConfig {
  const rawMode = (env.AUTH_MODE ?? "").trim().toLowerCase();
  const clientId = (env.MS_CLIENT_ID ?? "").trim().toLowerCase();
  const tenantId = (env.MS_TENANT_ID ?? "").trim().toLowerCase();
  const allowedDomains = (env.MS_ALLOWED_DOMAINS ?? "").split(/[\s,;]+/).map(d => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  const config = (mode: AuthMode, problem: string | null = null): MicrosoftAuthConfig => ({ mode, clientId, tenantId, allowedDomains, problem });
  if (!rawMode || rawMode === "key") return config("key");
  if (!(AUTH_MODES as readonly string[]).includes(rawMode)) {
    return config("key", `AUTH_MODE="${env.AUTH_MODE}" is not one of ${AUTH_MODES.join(", ")}.`);
  }
  const mode = rawMode as AuthMode;
  if (!GUID.test(clientId)) return config(mode, "MS_CLIENT_ID must be the Application (client) ID of the add-in's app registration (a GUID).");
  // A fixed directory: with "common" or "organizations" anyone with any work account could sign in
  if (!GUID.test(tenantId)) return config(mode, "MS_TENANT_ID must be the Directory (tenant) ID of the firm (a GUID).");
  return config(mode);
}

export type VerifiedUser = { user: string; name: string };
export type MicrosoftVerifier = (token: string) => Promise<VerifiedUser | { error: string }>;

/** Microsoft's signing keys for the directory; jose caches them and fetches again when a new key turns up */
export const microsoftKeys = (tenantId: string): JWTVerifyGetKey =>
  createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));

const claim = (payload: JWTPayload, name: string) => (typeof payload[name] === "string" ? (payload[name] as string) : "");

/**
 * Checks a token from Office.auth.getAccessToken: Microsoft's signature, not expired, issued by the firm's directory
 * for this add-in with the access_as_user scope. Both token versions are accepted (v2: audience is the client ID;
 * v1: audience is the Application ID URI, api://<host>/<client ID>).
 */
export function createMicrosoftVerifier(config: MicrosoftAuthConfig, keys: JWTVerifyGetKey = microsoftKeys(config.tenantId)): MicrosoftVerifier {
  const issuers = [`https://login.microsoftonline.com/${config.tenantId}/v2.0`, `https://sts.windows.net/${config.tenantId}/`];
  return async (token) => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, keys, { algorithms: ["RS256"], issuer: issuers, clockTolerance: 60 }));
    } catch (error) {
      return { error: `token rejected: ${(error as { code?: string }).code ?? (error as Error).message}` };
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud ?? ""];
    const forThisApp = audiences.some(aud => aud.toLowerCase() === config.clientId || (/^api:\/\//i.test(aud) && aud.toLowerCase().endsWith(`/${config.clientId}`)));
    if (!forThisApp) return { error: "token is for another application" };
    if (claim(payload, "tid").toLowerCase() !== config.tenantId) return { error: "token is from another directory" };
    if (!claim(payload, "scp").split(" ").includes(SSO_SCOPE)) return { error: `token has no ${SSO_SCOPE} scope` };
    // v2: preferred_username; v1: upn (unique_name for guests)
    const user = (claim(payload, "preferred_username") || claim(payload, "upn") || claim(payload, "unique_name") || claim(payload, "email")).trim().toLowerCase();
    if (!user) return { error: "token has no user name" };
    if (config.allowedDomains.length && !config.allowedDomains.includes(user.split("@")[1] ?? "")) return { error: "user's domain is not allowed (MS_ALLOWED_DOMAINS)" };
    return { user, name: claim(payload, "name").trim() };
  };
}

/** The token from an "Authorization: Bearer …" header, or null */
export function bearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}
