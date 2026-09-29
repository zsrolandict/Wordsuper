/** One piece of a streamed answer: answer text, or the model's thought summary (shown in the pane only) */
export interface StreamEvent {
  type: 'text' | 'thought';
  text: string;
}

/**
 * Why the model stopped. Anything but "stop" means the answer is incomplete and must not reach the document:
 * length = output token limit, safety = a safety/recitation filter cut it off, other = anything else.
 */
export type FinishReason = 'stop' | 'length' | 'safety' | 'other';

export interface StreamFinish {
  reason: FinishReason;
  /** The provider's own reason code, for logs and the error message */
  detail?: string;
  /** Token counts for the audit log, when the provider reports them */
  usage?: TokenUsage;
}

export interface TokenUsage {
  prompt: number;
  output: number;
  thoughts: number;
  total: number;
}

export interface GenerateOptions {
  systemInstruction: string;
  prompt: string;
  /** Standard JSON Schema; when set, the answer must be JSON matching it */
  responseJsonSchema?: object;
  /** fast / deep map to the model's thinking level; auto (or none) lets the model decide */
  depth?: "auto" | "fast" | "deep";
  signal: AbortSignal;
}

/** Every model provider implements this, so prompts and the endpoint don't depend on one vendor */
export interface ModelProvider {
  /** Model name, shown in the task pane's details panel */
  readonly model: string;
  /** The model used for a request: deep may go to a stronger one (AI_MODEL_DEEP) */
  modelFor(depth?: GenerateOptions["depth"]): string;
  /** Where the request is processed, e.g. "Gemini API" or "Vertex AI (europe-west1)" */
  readonly location: string;
  /** The data is processed only inside the EU (Vertex AI in a europe-* region) */
  readonly euResident: boolean;
  generate(options: GenerateOptions, onEvent: (event: StreamEvent) => void): Promise<StreamFinish>;
  /** Speech to text, for dictating instructions */
  transcribe(options: TranscribeOptions): Promise<{ text: string; usage?: TokenUsage }>;
}

export interface TranscribeOptions {
  /** Base64 encoded recording */
  audio: string;
  /** e.g. audio/webm, audio/ogg, audio/mp4 */
  mimeType: string;
  signal: AbortSignal;
}
