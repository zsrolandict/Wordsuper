/// <reference lib="webworker" />
/**
 * Local speech recognition (Whisper) in a background thread: the recording never leaves the machine. The model
 * is downloaded once from Hugging Face and then served from the browser cache; the ONNX runtime comes from our
 * own server, not from a CDN.
 */
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import ortWasm from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjs from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';

export type WorkerRequest = { type: 'transcribe'; id: number; model: string; audio: Float32Array };
export type WorkerResponse =
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'loaded'; id: number; device: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; message: string };

env.allowLocalModels = false;
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href, mjs: new URL(ortMjs, self.location.href).href };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerResponse) => scope.postMessage(message);

let loaded: { model: string; device: string; run: AutomaticSpeechRecognitionPipeline } | null = null;

async function load(model: string, id: number) {
  if (loaded?.model === model) return loaded;
  // Download progress summed over the model's files
  const files = new Map<string, { loaded: number; total: number }>();
  const onProgress = (info: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (info.status !== 'progress' || !info.file) return;
    files.set(info.file, { loaded: info.loaded ?? 0, total: info.total ?? 0 });
    let done = 0;
    let total = 0;
    files.forEach(f => { done += f.loaded; total += f.total; });
    post({ type: 'progress', id, loaded: done, total });
  };
  // WebGPU when the machine has it (much faster), WebAssembly otherwise
  const hasWebGpu = 'gpu' in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  const device = hasWebGpu ? 'webgpu' : 'wasm';
  const run = (await pipeline('automatic-speech-recognition', model, {
    device,
    dtype: hasWebGpu ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: onProgress,
  })) as AutomaticSpeechRecognitionPipeline;
  loaded = { model, device, run };
  post({ type: 'loaded', id, device });
  return loaded;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'transcribe') return;
  try {
    const { run } = await load(request.model, request.id);
    const output = await run(request.audio, { language: 'hungarian', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(output) ? output.map(o => o.text).join(' ') : output.text).trim();
    post({ type: 'result', id: request.id, text });
  } catch (error) {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
};
