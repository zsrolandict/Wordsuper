import { recordEvent } from './diagnostics';
import { ACCESS_KEY_HEADER, type AIRequestBody, type ApiErrorCode } from '../shared/aiConfig';
import { forgetAuthMode, microsoftToken, requestHeaders, SignInError } from './signIn';

export class AIRequestError extends Error {
  code?: ApiErrorCode;
  status?: number;
  /** For INCOMPLETE: why the model stopped (length, safety, other) */
  reason?: string;

  constructor(message: string, code?: ApiErrorCode, status?: number, reason?: string) {
    super(message);
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

/** Which model answered and where the text was processed; sent by the server before the answer */
export interface ResponseMeta {
  model: string;
  location: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  /** Seconds until the window resets */
  resetSeconds: number;
  receivedAt: number;
}

export interface StreamHandlers {
  /** Answer text, the only part that may end up in the document */
  onText: (chunk: string) => void;
  /** The model's thought summary, shown in the task pane only */
  onThought?: (chunk: string) => void;
  onRateLimit?: (info: RateLimitInfo) => void;
  onMeta?: (meta: ResponseMeta) => void;
}

export interface StreamOptions {
  accessKey: string;
  /** For the server's audit log; accented names are URI-encoded, headers only carry plain characters */
  userId?: string;
  signal?: AbortSignal;
}

// express-rate-limit's draft-6 headers
function readRateLimit(headers: Headers): RateLimitInfo | null {
  const remaining = headers.get('RateLimit-Remaining');
  if (remaining === null) return null;
  return {
    limit: Number(headers.get('RateLimit-Limit')) || 0,
    remaining: Number(remaining) || 0,
    resetSeconds: Number(headers.get('RateLimit-Reset')) || 0,
    receivedAt: Date.now(),
  };
}

async function errorFromResponse(response: Response): Promise<AIRequestError> {
  // The server (and the rate limiter) answer non-stream errors as JSON: { error: "...", code: "..." }
  const data = await response.json().catch(() => null);
  if (response.status === 401 || data?.code === 'AUTH_NOT_CONFIGURED') forgetAuthMode();
  return new AIRequestError(data?.error || `HTTP error! status: ${response.status}`, data?.code, response.status);
}

/**
 * Service to call the AI backend and stream the response
 */
/**
 * The server sends a heartbeat every 20 s while the model thinks, so this long a silence means the connection or
 * the server is stuck: waiting is given up instead of spinning forever
 */
const IDLE_TIMEOUT_MS = 90 * 1000;

export async function streamAIResponse(request: AIRequestBody, handlers: StreamHandlers, options: StreamOptions): Promise<string> {
  // For the error report: the mode, the size and how it ended, never the text
  const started = Date.now();
  const size = request.originalText.length + request.documentContext.length;
  try {
    const answer = await streamOnce(request, handlers, options);
    recordEvent('request', `${request.mode}: ok, ${size} karakter, ${Date.now() - started} ms`);
    return answer;
  } catch (error) {
    const how = options.signal?.aborted ? 'leállítva' : error instanceof SignInError ? `belépési hiba ${error.code ?? ''}` : error instanceof AIRequestError ? `hiba ${error.code ?? error.status ?? ''}${error.reason ? ` (${error.reason})` : ''}` : `hiba (${error instanceof Error ? error.name : 'ismeretlen'})`;
    recordEvent('request', `${request.mode}: ${how}, ${size} karakter, ${Date.now() - started} ms`);
    throw error;
  }
}

async function streamOnce(request: AIRequestBody, handlers: StreamHandlers, options: StreamOptions): Promise<string> {
  // Aborted by the user (options.signal) or by the idle timer
  const controller = new AbortController();
  const onUserAbort = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', onUserAbort);
  let idle = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const stillAlive = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };
  stillAlive();
  try {
    const response = await fetch('/api/edit-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await requestHeaders(options.accessKey, options.userId ?? '')),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const rateLimit = readRateLimit(response.headers);
    if (rateLimit) handlers.onRateLimit?.(rateLimit);

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let receivedDone = false;
    let fullText = '';
    let buffer = '';

    while (!done) {
      const { value, done: readerDone } = await reader.read();
      // Anything, a heartbeat too, shows the connection is alive
      stillAlive();
      done = readerDone;
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') {
            receivedDone = true;
            done = true;
            break;
          }

          let data: { text?: string; thought?: string; meta?: ResponseMeta; error?: string; code?: ApiErrorCode; reason?: string };
          try {
            data = JSON.parse(dataStr);
          } catch {
            // Ignore malformed lines
            continue;
          }

          if (data.error) {
            throw new AIRequestError(data.error, data.code ?? 'SERVER_ERROR', undefined, data.reason);
          }
          if (data.meta) {
            handlers.onMeta?.(data.meta);
          }
          if (data.thought) {
            handlers.onThought?.(data.thought);
          }
          if (data.text) {
            fullText += data.text;
            handlers.onText(data.text);
          }
        }
      }
    }

    // Without the [DONE] marker the connection dropped mid-answer, so the text is incomplete
    if (!receivedDone) {
      throw new Error('The AI response stream ended unexpectedly.');
    }

    return fullText;
  } catch (error) {
    if (idle && !options.signal?.aborted) {
      throw new AIRequestError('No data from the server for too long.', 'TIMEOUT');
    }
    if (!options.signal?.aborted) {
      console.error('Error calling AI streaming service:', error);
    }
    throw error;
  } finally {
    clearTimeout(idleTimer);
    options.signal?.removeEventListener('abort', onUserAbort);
  }
}

/** Checks the access key without spending AI credits (it still counts towards the rate limit) */
export async function checkAccessKey(accessKey: string): Promise<{ ok: boolean; error?: AIRequestError; rateLimit: RateLimitInfo | null }> {
  const response = await fetch('/api/auth-check', { headers: { [ACCESS_KEY_HEADER]: accessKey } });
  const rateLimit = readRateLimit(response.headers);
  return response.ok ? { ok: true, rateLimit } : { ok: false, error: await errorFromResponse(response), rateLimit };
}

export interface SignInCheck {
  ok: boolean;
  error?: AIRequestError | SignInError;
  rateLimit: RateLimitInfo | null;
  /** Whom the server sees: the work account and the display name in it */
  user?: string;
  name?: string;
}

/** Signs in with the Microsoft account and asks the server whom it sees; interactive: Word may ask the user */
export async function checkMicrosoftSignIn(interactive = true): Promise<SignInCheck> {
  let token: string;
  try {
    token = await microsoftToken(interactive);
  } catch (error) {
    return { ok: false, error: error as SignInError, rateLimit: null };
  }
  const response = await fetch('/api/auth-check', { headers: { Authorization: `Bearer ${token}` } });
  const rateLimit = readRateLimit(response.headers);
  if (!response.ok) return { ok: false, error: await errorFromResponse(response), rateLimit };
  const data = await response.json().catch(() => null);
  // A server that took the token signs in with "microsoft"; anything else means it did not use the token
  if (data?.method !== 'microsoft') return { ok: false, error: new AIRequestError('The server did not use the Microsoft sign-in.', 'MICROSOFT_TOKEN_INVALID', response.status), rateLimit };
  return { ok: true, rateLimit, user: typeof data.user === 'string' ? data.user : '', name: typeof data.name === 'string' ? data.name : '' };
}

/** Hungarian explanation of a failed request, for the chat */
/** Sends a dictated recording to the server and returns the transcript */
export async function transcribeAudio(recording: Blob, accessKey: string, userId: string, riskAccepted: boolean, signal?: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(await recording.arrayBuffer());
  let binary = '';
  // In chunks: String.fromCharCode with a huge argument list overflows the stack
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await requestHeaders(accessKey, userId)) },
    body: JSON.stringify({ audio: btoa(binary), mimeType: recording.type, riskAccepted }),
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  const data = await response.json();
  return typeof data?.text === 'string' ? data.text.trim() : '';
}

/** The fix is in the settings: the key, the sign-in, or masking switched off on a server that requires it */
export const needsSettings = (error: unknown) =>
  error instanceof SignInError ||
  (error instanceof AIRequestError && ['UNAUTHORIZED', 'MASKING_REQUIRED', 'MICROSOFT_LOGIN_REQUIRED', 'MICROSOFT_TOKEN_INVALID'].includes(error.code ?? ''));

export function describeRequestError(error: unknown): string {
  if (error instanceof SignInError) return error.message;
  if (error instanceof AIRequestError) {
    switch (error.code) {
      case 'MICROSOFT_LOGIN_REQUIRED':
        return 'Ez a szerver Microsoft-fiókos belépést kér, de a Word nem adott belépési tokent. Jelentkezz be a Wordbe a munkahelyi fiókoddal, majd a Beállításokban nyomd meg a „Bejelentkezés” gombot.';
      case 'MICROSOFT_TOKEN_INVALID':
        return `A szerver nem fogadta el a Microsoft-belépést (pl. nem az iroda fiókja, nem engedélyezett domain, vagy az alkalmazásregisztráció nem egyezik). Ha szerinted jó fiókkal vagy bent, szólj az üzemeltetőnek.\n(${error.message})`;
      case 'AUTH_NOT_CONFIGURED':
        return 'A szerveren hibásan van beállítva a Microsoft-fiókos belépés (AUTH_MODE, MS_CLIENT_ID vagy MS_TENANT_ID), ezért minden kérést elutasít. Az üzemeltetőnek kell javítania (docs/MICROSOFT-BELEPES.md).';
      case 'UNAUTHORIZED':
        return 'Hibás vagy hiányzó hozzáférési kulcs. Add meg a Beállításokban (fogaskerék ikon fent).';
      case 'ACCESS_KEY_NOT_CONFIGURED':
        return 'A szerveren nincs rendesen beállítva a hozzáférési kulcs (APP_ACCESS_KEY hiányzik, túl rövid vagy még a mintaérték), ezért a szerver minden kérést elutasít. Az üzemeltetőnek kell beállítania.';
      case 'DICTATION_NOT_ALLOWED':
        return 'Ezen a szerveren az üzemeltető csak EU-ban (Vertex AI, europe-… régió) feldolgozott felhős diktálást engedélyez, és ez a szerver nem EU-ban dolgoz fel. Használd a helyi diktálást (Beállítások → Diktálás), ott a hang el sem hagyja a gépet.';
      case 'DICTATION_RISK_NOT_ACCEPTED':
        return 'A felhős diktálás itt nem EU-ban dolgozik fel. Ha vállalod a kockázatot, a Beállítások → Diktálás részen jelöld be az „Elfogadom” négyzetet.';
      case 'TIMEOUT':
        return 'A modell túl sokáig nem válaszolt (vagy megszakadt a kapcsolat), ezért leállítottam a várakozást. A dokumentumot nem módosítottam. Próbáld újra; nagy dokumentumnál segíthet a „Gyors” gondolkodás vagy egy kisebb kijelölés.';
      case 'MASKING_REQUIRED':
        return 'Az üzemeltető kötelezővé tette a maszkolást, ezért maszkolás nélkül nem küldhetek semmit az AI-nak. Kapcsold vissza: Beállítások → Adatvédelem → „Érzékeny adatok maszkolása”.';
      case 'RATE_LIMITED':
        return 'Túl sok kérés érkezett egy percen belül. Várj egy kicsit, és próbáld újra.';
      case 'INCOMPLETE':
        // A félbehagyott válasz sosem kerül a dokumentumba
        return error.reason === 'length'
          ? 'A válasz túl hosszú lett, a modell félbehagyta, ezért nem használom. Próbáld kisebb kijelöléssel vagy rövidebb kéréssel.'
          : error.reason === 'safety'
          ? 'A modell szűrője (pl. biztonsági vagy szerzői jogi) megszakította a választ, ezért nem használom. Próbáld másként megfogalmazni a kérést.'
          : 'A modell nem fejezte be a választ, ezért nem használom. Kérlek próbáld újra.';
    }
  }
  const detail = error instanceof Error ? error.message : '';
  return `Nem sikerült választ kapni az AI-tól, a dokumentumot nem módosítottam. Kérlek próbáld újra.${detail ? `\n(${detail})` : ''}`;
}

export interface ServerInfo {
  version: string;
  date: string;
  model: string | null;
  location: string | null;
  euResident: boolean;
  dictationPolicy: 'eu-only' | 'user-risk';
  /** required: the server refuses unmasked requests, so masking can't be switched off */
  maskingPolicy?: 'required' | 'optional';
}

/**
 * What the server runs (version, model, where it processes data); null when it can't be reached. Asked in the
 * background, so it never makes Word show a sign-in window.
 */
export async function fetchServerInfo(accessKey: string): Promise<ServerInfo | null> {
  try {
    const response = await fetch('/api/info', { headers: await requestHeaders(accessKey, '', { interactive: false }) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** The firm's styles from the server (OFFICE_STYLES_FILE) and whether only they may be used; null when unreachable */
export async function fetchOfficeStyles(accessKey: string): Promise<{ styles: unknown[]; locked: boolean } | null> {
  try {
    const response = await fetch('/api/office-styles', { headers: await requestHeaders(accessKey, '', { interactive: false }) });
    if (!response.ok) return null;
    const data = await response.json();
    return { styles: Array.isArray(data?.styles) ? data.styles : [], locked: data?.locked === true };
  } catch {
    return null;
  }
}
