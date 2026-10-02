import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AIRequestError, describeRequestError, streamAIResponse } from './aiService';

const request = { mode: 'edit' as const, instruction: 'x', originalText: 'y', documentContext: '' };
const encoder = new TextEncoder();

/** A server that sends the given chunks, then stays silent; it honours the abort signal like a real fetch */
function fakeFetch(chunks: string[]) {
  return async (_url: string, init: { signal: AbortSignal }) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
        init.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}

test('a server that goes silent is given up after the idle time, with a clear message', async (t) => {
  t.mock.method(globalThis, 'fetch', fakeFetch(['data: {"text":"Rész"}\n\n']));
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const result = streamAIResponse(request, { onText: () => {} }, { accessKey: 'k', userId: '' });
    // Let the first chunk arrive, then 90 s of silence
    await new Promise(resolve => setImmediate(resolve));
    mock.timers.tick(90_000);
    await assert.rejects(result, (error: unknown) => error instanceof AIRequestError && error.code === 'TIMEOUT');
    assert.match(describeRequestError(new AIRequestError('x', 'TIMEOUT')), /nem módosítottam/);
  } finally {
    mock.timers.reset();
  }
});

test('heartbeats keep a slow answer alive', async (t) => {
  let push: (chunk: string) => void = () => {};
  t.mock.method(globalThis, 'fetch', async (_url: string, init: { signal: AbortSignal }) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = chunk => controller.enqueue(encoder.encode(chunk));
        init.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
    });
    return new Response(body, { status: 200 });
  });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const result = streamAIResponse(request, { onText: () => {} }, { accessKey: 'k', userId: '' });
    await new Promise(resolve => setImmediate(resolve));
    // 4 × 60 s, a heartbeat each time: longer than the idle limit in total, but never silent for that long
    for (let i = 0; i < 4; i++) {
      mock.timers.tick(60_000);
      push(': ping\n\n');
      await new Promise(resolve => setImmediate(resolve));
    }
    push('data: {"text":"Kész."}\n\ndata: [DONE]\n\n');
    assert.equal(await result, 'Kész.');
  } finally {
    mock.timers.reset();
  }
});
