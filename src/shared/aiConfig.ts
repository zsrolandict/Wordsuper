// Shared by the server (server.ts) and the task pane, so the UI can show exactly what the AI received
export const AI_MODEL = "gemini-2.5-flash";

export type Mode = 'edit' | 'comment' | 'generate' | 'review';
export const MODES: readonly Mode[] = ['edit', 'comment', 'generate', 'review'];

// The server truncates anything longer than these before sending it to the model
export const MAX_SELECTION_CHARS = 10000;
export const MAX_CONTEXT_CHARS = 40000;
/** Whole-document review sends the document itself, so it gets a bigger budget */
export const MAX_REVIEW_CHARS = 150000;
export const MAX_INSTRUCTION_CHARS = 2000;
/** How many earlier rounds of a refinement the AI gets to see */
export const MAX_HISTORY_TURNS = 5;
export const MAX_STYLE_NOTES_CHARS = 500;
export const MAX_REVIEW_FINDINGS = 15;
export const RATE_LIMIT_PER_MINUTE = 20;

export const ACCESS_KEY_HEADER = 'X-Access-Key';

export type Addressing = '' | 'formal' | 'informal';
export type Tone = '' | 'legal' | 'business' | 'plain' | 'friendly';

export interface StyleProfile {
  addressing: Addressing;
  tone: Tone;
  notes: string;
}

export interface HistoryTurn {
  instruction: string;
  result: string;
}

/** Body of POST /api/edit-stream */
export interface AIRequestBody {
  mode: Mode;
  instruction: string;
  originalText: string;
  documentContext: string;
  /** Earlier rounds when the user refines a proposal; the last one is the current draft */
  history?: HistoryTurn[];
  styleProfile?: StyleProfile;
}

export type Severity = 'high' | 'medium' | 'low';

export interface ReviewFinding {
  /** Verbatim excerpt of the document, used to find where the comment goes */
  quote: string;
  comment: string;
  severity: Severity;
}

export type ApiErrorCode = 'UNAUTHORIZED' | 'ACCESS_KEY_NOT_CONFIGURED' | 'RATE_LIMITED' | 'BAD_REQUEST' | 'SERVER_ERROR';

export const contextLimitFor = (mode: Mode) => (mode === 'review' ? MAX_REVIEW_CHARS : MAX_CONTEXT_CHARS);
