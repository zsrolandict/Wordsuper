import { ACCESS_KEY_HEADER, type AIRequestBody, type ApiErrorCode } from '../shared/aiConfig';

export class AIRequestError extends Error {
  code?: ApiErrorCode;
  status?: number;

  constructor(message: string, code?: ApiErrorCode, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
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

          let data: { text?: string; thought?: string; error?: string };
          try {
            data = JSON.parse(dataStr);
          } catch {
            // Ignore malformed lines
            continue;
          }

          if (data.error) {
            throw new AIRequestError(data.error, 'SERVER_ERROR');
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

/** Checks the access key without spending AI credits */
export async function checkAccessKey(accessKey: string): Promise<{ ok: true } | { ok: false; error: AIRequestError }> {
  const response = await fetch('/api/auth-check', { headers: { [ACCESS_KEY_HEADER]: accessKey } });
  return response.ok ? { ok: true } : { ok: false, error: await errorFromResponse(response) };
}

/** Hungarian explanation of a failed request, for the chat */
export function describeRequestError(error: unknown): string {
  if (error instanceof AIRequestError) {
    switch (error.code) {
      case 'UNAUTHORIZED':
        return 'Hibás vagy hiányzó hozzáférési kulcs. Add meg a Beállításokban (fogaskerék ikon fent).';
      case 'ACCESS_KEY_NOT_CONFIGURED':
        return 'A szerveren nincs beállítva hozzáférési kulcs (APP_ACCESS_KEY), ezért a szerver minden kérést elutasít. Az üzemeltetőnek kell beállítania.';
      case 'RATE_LIMITED':
        return 'Túl sok kérés érkezett egy percen belül. Várj egy kicsit, és próbáld újra.';
    }
  }
  const detail = error instanceof Error ? error.message : '';
  return `Nem sikerült választ kapni az AI-tól, a dokumentumot nem módosítottam. Kérlek próbáld újra.${detail ? `\n(${detail})` : ''}`;
}
