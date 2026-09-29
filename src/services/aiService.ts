import { ACCESS_KEY_HEADER, type AIRequestBody, type ApiErrorCode } from '../shared/aiConfig';

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
  return new AIRequestError(data?.error || `HTTP error! status: ${response.status}`, data?.code, response.status);
}

/**
 * Service to call the AI backend and stream the response
 */
export async function streamAIResponse(request: AIRequestBody, handlers: StreamHandlers, options: StreamOptions): Promise<string> {
  try {
    const response = await fetch('/api/edit-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [ACCESS_KEY_HEADER]: options.accessKey,
      },
      body: JSON.stringify(request),
      signal: options.signal,
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
    if (!options.signal?.aborted) {
      console.error('Error calling AI streaming service:', error);
    }
    throw error;
  }
}

/** Checks the access key without spending AI credits (it still counts towards the rate limit) */
export async function checkAccessKey(accessKey: string): Promise<{ ok: boolean; error?: AIRequestError; rateLimit: RateLimitInfo | null }> {
  const response = await fetch('/api/auth-check', { headers: { [ACCESS_KEY_HEADER]: accessKey } });
  const rateLimit = readRateLimit(response.headers);
  return response.ok ? { ok: true, rateLimit } : { ok: false, error: await errorFromResponse(response), rateLimit };
}

/** Hungarian explanation of a failed request, for the chat */
/** Sends a dictated recording to the server and returns the transcript */
export async function transcribeAudio(recording: Blob, accessKey: string, signal?: AbortSignal): Promise<string> {
  const bytes = new Uint8Array(await recording.arrayBuffer());
  let binary = '';
  // In chunks: String.fromCharCode with a huge argument list overflows the stack
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [ACCESS_KEY_HEADER]: accessKey },
    body: JSON.stringify({ audio: btoa(binary), mimeType: recording.type }),
    signal,
  });
  if (!response.ok) throw await errorFromResponse(response);
  const data = await response.json();
  return typeof data?.text === 'string' ? data.text.trim() : '';
}

export function describeRequestError(error: unknown): string {
  if (error instanceof AIRequestError) {
    switch (error.code) {
      case 'UNAUTHORIZED':
        return 'Hibás vagy hiányzó hozzáférési kulcs. Add meg a Beállításokban (fogaskerék ikon fent).';
      case 'ACCESS_KEY_NOT_CONFIGURED':
        return 'A szerveren nincs rendesen beállítva a hozzáférési kulcs (APP_ACCESS_KEY hiányzik, túl rövid vagy még a mintaérték), ezért a szerver minden kérést elutasít. Az üzemeltetőnek kell beállítania.';
      case 'DICTATION_NOT_ALLOWED':
        return 'A felhős diktálás ezen a szerveren nem engedélyezett, mert a hang nem EU-ban (Vertex AI, europe-… régió) kerülne feldolgozásra. Használd a helyi diktálást (Beállítások → Diktálás), ott a hang el sem hagyja a gépet.';
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
