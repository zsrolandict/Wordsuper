// Shared by the server (server.ts) and the task pane, so the UI can show exactly what the AI received

/** Modes of the assistant tab */
export const ASSISTANT_MODES = ['edit', 'comment', 'generate', 'review'] as const;
export type AssistantMode = typeof ASSISTANT_MODES[number];
/** Every request mode the server accepts; "compare" comes from the version comparison tab */
export const MODES = [...ASSISTANT_MODES, 'compare'] as const;
export type Mode = typeof MODES[number];

// Our own limits (not the model's: it takes about a million tokens). They keep answers fast and costs
// predictable while a whole contract still fits. The server truncates anything longer.
export const MAX_SELECTION_CHARS = 50000;
/** About 60-70 pages of contract text */
export const MAX_CONTEXT_CHARS = 200000;
/** Whole-document review sends the document itself, so it gets a bigger budget */
export const MAX_REVIEW_CHARS = 400000;
/** Version comparison sends the list of changes */
export const MAX_COMPARE_CHARS = 200000;
export const MAX_INSTRUCTION_CHARS = 2000;
/** How many earlier rounds of a refinement the AI gets to see (the first one always stays) */
export const MAX_HISTORY_TURNS = 5;
export const MAX_HISTORY_RESULT_CHARS = MAX_CONTEXT_CHARS;
export const MAX_STYLE_NOTES_CHARS = 500;
export const MAX_REVIEW_FINDINGS = 15;
export const RATE_LIMIT_PER_MINUTE = 20;

export const ACCESS_KEY_HEADER = 'X-Access-Key';

// Single source of the allowed values; the server, the settings and the review schema all use these
export const ADDRESSING_VALUES = ['', 'formal', 'informal'] as const;
export type Addressing = typeof ADDRESSING_VALUES[number];
export const TONE_VALUES = ['', 'legal', 'business', 'plain', 'friendly'] as const;
export type Tone = typeof TONE_VALUES[number];
export const SEVERITY_VALUES = ['high', 'medium', 'low'] as const;
export type Severity = typeof SEVERITY_VALUES[number];

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
  /** Sensitive values were replaced with placeholders like [CÉG_1] before sending */
  masked?: boolean;
  /** Edit or comment without a selection: originalText is the whole document */
  wholeDocument?: boolean;
}

export interface ReviewFinding {
  /** Verbatim excerpt of the document, used to find where the comment goes */
  quote: string;
  comment: string;
  severity: Severity;
  /** Corrected wording that replaces the quote as a tracked change; empty when the finding needs no text change */
  suggestion: string;
}

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'ACCESS_KEY_NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'SERVER_ERROR'
  /** The model stopped early (length limit, safety filter…), so the answer is incomplete */
  | 'INCOMPLETE'
  /** Cloud dictation is refused unless the server processes data in the EU */
  | 'DICTATION_NOT_ALLOWED';

export const contextLimitFor = (mode: Mode) =>
  mode === 'review' ? MAX_REVIEW_CHARS : mode === 'compare' ? MAX_COMPARE_CHARS : MAX_CONTEXT_CHARS;

/**
 * The rounds the AI gets to see: the first one (it holds the original intent) and the most recent ones.
 * Used by both the task pane (to show it honestly) and the server (to enforce it).
 */
export function trimHistory<T>(history: T[]): T[] {
  if (history.length <= MAX_HISTORY_TURNS) return history;
  return [history[0], ...history.slice(-(MAX_HISTORY_TURNS - 1))];
}

/** Word separates paragraphs with \r; everything sent to the model and shown in the pane uses \n */
export const toLineFeeds = (text: string) => text.replace(/\r\n?/g, '\n');

/** An edit ends with this line and a short explanation of why the change was needed (for an optional comment) */
export const EXPLANATION_MARKER = '===WHY===';

/** Splits an edit answer into the new text and its explanation; while streaming, a half-arrived marker is hidden */
export function splitExplanation(answer: string, streaming = false): { text: string; explanation: string } {
  const at = answer.indexOf(EXPLANATION_MARKER);
  if (at !== -1) {
    return { text: answer.slice(0, at).trimEnd(), explanation: answer.slice(at + EXPLANATION_MARKER.length).trim() };
  }
  if (streaming) {
    // "…text\n===W" – the marker is still arriving
    const partial = answer.match(/\n?=+[A-Z]*=*$/);
    if (partial && EXPLANATION_MARKER.startsWith(partial[0].replace(/^\n/, ''))) {
      return { text: answer.slice(0, partial.index).trimEnd(), explanation: '' };
    }
  }
  return { text: answer, explanation: '' };
}
