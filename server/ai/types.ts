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
}

export interface GenerateOptions {
  systemInstruction: string;
  prompt: string;
  /** Standard JSON Schema; when set, the answer must be JSON matching it */
  responseJsonSchema?: object;
  signal: AbortSignal;
}

/** Every model provider implements this, so prompts and the endpoint don't depend on one vendor */
export interface ModelProvider {
  /** Model name, shown in the task pane's details panel */
  readonly model: string;
  /** Where the request is processed, e.g. "Gemini API" or "Vertex AI (europe-west1)" */
  readonly location: string;
  generate(options: GenerateOptions, onEvent: (event: StreamEvent) => void): Promise<StreamFinish>;
}
