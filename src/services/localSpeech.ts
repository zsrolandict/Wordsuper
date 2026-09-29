import type { WorkerRequest, WorkerResponse } from '../workers/whisper.worker';

/** Whisper sizes offered in the settings: base is quick, small understands Hungarian better */
export const LOCAL_MODELS = {
  base: { id: 'onnx-community/whisper-base', label: 'Gyors (base, kb. 80 MB)' },
  small: { id: 'onnx-community/whisper-small', label: 'Pontosabb (small, kb. 250 MB)' },
} as const;
export type LocalModel = keyof typeof LOCAL_MODELS;

export interface LocalProgress {
  /** 0..1 while the model downloads (first use only), null when it is already here */
  download: number | null;
}

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  worker ??= new Worker(new URL('../workers/whisper.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

/** Whisper wants 16 kHz mono samples; the browser decodes and resamples the recording */
async function toSamples(recording: Blob): Promise<Float32Array> {
  const context = new AudioContext({ sampleRate: 16000 });
  try {
    const audio = await context.decodeAudioData(await recording.arrayBuffer());
    return audio.getChannelData(0).slice();
  } finally {
    void context.close();
  }
}

/** Transcribes on this machine; nothing is sent anywhere (the model itself is downloaded once) */
export async function transcribeLocally(recording: Blob, model: LocalModel, onProgress: (progress: LocalProgress) => void, signal?: AbortSignal): Promise<string> {
  const samples = await toSamples(recording);
  const id = nextId++;
  const target = getWorker();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.id !== id) return;
      if (message.type === 'progress') onProgress({ download: message.total ? message.loaded / message.total : 0 });
      else if (message.type === 'loaded') onProgress({ download: null });
      else {
        cleanup();
        if (message.type === 'result') resolve(message.text);
        else reject(new Error(message.message));
      }
    };
    target.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort);
    const request: WorkerRequest = { type: 'transcribe', id, model: LOCAL_MODELS[model].id, audio: samples };
    target.postMessage(request, [samples.buffer]);
  });
}
