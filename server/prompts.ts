import {
  ADDRESSING_VALUES,
  MAX_HISTORY_RESULT_CHARS,
  MAX_INSTRUCTION_CHARS,
  MAX_REVIEW_FINDINGS,
  MAX_SELECTION_CHARS,
  MAX_STYLE_NOTES_CHARS,
  EXPLANATION_MARKER,
  MODES,
  SEVERITY_VALUES,
  TONE_VALUES,
  contextLimitFor,
  toLineFeeds,
  trimHistory,
  type AIRequestBody,
  type Addressing,
  type HistoryTurn,
  type Mode,
  type StyleProfile,
  type Tone,
} from "../src/shared/aiConfig";

type ParseResult = { value: AIRequestBody } | { error: string };

const asString = (value: unknown) => (typeof value === "string" ? value : "");

/** Validates and truncates the request body; never trust the task pane's own limits */
export function parseRequest(body: unknown): ParseResult {
  const raw = (body ?? {}) as Record<string, unknown>;

  const mode = raw.mode as Mode;
  if (!(MODES as readonly unknown[]).includes(mode)) {
    return { error: "Invalid mode" };
  }

  const instruction = asString(raw.instruction).trim();
  if (!instruction) {
    return { error: "Missing instruction" };
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return { error: `Instruction is longer than ${MAX_INSTRUCTION_CHARS} characters` };
  }

  // Word separates paragraphs with \r; the model reads \n as a line break
  const originalText = toLineFeeds(asString(raw.originalText)).substring(0, MAX_SELECTION_CHARS);
  if ((mode === "edit" || mode === "comment") && !originalText.trim()) {
    return { error: "Missing originalText" };
  }

  const documentContext = toLineFeeds(asString(raw.documentContext)).substring(0, contextLimitFor(mode));
  if ((mode === "review" || mode === "compare") && !documentContext.trim()) {
    return { error: "Missing documentContext" };
  }

  const history: HistoryTurn[] = trimHistory(
    (Array.isArray(raw.history) ? raw.history : [])
      .map((turn) => ({
        instruction: asString(turn?.instruction).substring(0, MAX_INSTRUCTION_CHARS),
        result: toLineFeeds(asString(turn?.result)).substring(0, MAX_HISTORY_RESULT_CHARS),
      }))
      .filter((turn) => turn.instruction && turn.result)
  );

  const rawStyle = (raw.styleProfile ?? {}) as Record<string, unknown>;
  const styleProfile: StyleProfile = {
    addressing: (ADDRESSING_VALUES as readonly unknown[]).includes(rawStyle.addressing) ? (rawStyle.addressing as Addressing) : "",
    tone: (TONE_VALUES as readonly unknown[]).includes(rawStyle.tone) ? (rawStyle.tone as Tone) : "",
    notes: asString(rawStyle.notes).trim().substring(0, MAX_STYLE_NOTES_CHARS),
  };

  return { value: { mode, instruction, originalText, documentContext, history, styleProfile, masked: raw.masked === true, wholeDocument: raw.wholeDocument === true } };
}

// Standard JSON Schema, so any provider that supports structured output can use it
const REVIEW_SCHEMA = {
  type: "array",
  maxItems: MAX_REVIEW_FINDINGS,
  items: {
    type: "object",
    properties: {
      quote: { type: "string", description: "Exact, verbatim excerpt copied character-for-character from the document that pinpoints where the comment belongs: 5-15 words, or up to one whole sentence (at most 250 characters) when the suggestion rewrites it." },
      comment: { type: "string", description: "Concise comment for the margin, written in the language of the user's instruction." },
      severity: { type: "string", enum: [...SEVERITY_VALUES] },
      suggestion: { type: "string", description: "The corrected wording that replaces exactly the quoted text, as a tracked change. Empty string when the finding needs no change of wording." },
    },
    required: ["quote", "comment", "severity", "suggestion"],
    // Gemini extension: generate the quote first, so the comment and the fix are written with the exact spot in mind
    propertyOrdering: ["quote", "comment", "severity", "suggestion"],
  },
};

const COMPARE_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "Short overall summary of what the counterparty changed and the main risks." },
    changes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "The CHANGE number from the list." },
          summary: { type: "string", description: "What changed in substance, in one or two sentences." },
          risk: { type: "string", enum: [...SEVERITY_VALUES] },
          recommendation: { type: "string", description: "Accept, reject or negotiate, and why." },
        },
        required: ["id", "summary", "risk", "recommendation"],
        propertyOrdering: ["id", "summary", "risk", "recommendation"],
      },
    },
  },
  required: ["overview", "changes"],
  propertyOrdering: ["overview", "changes"],
};

const WHOLE_DOCUMENT_EDIT = `
- Nothing was selected, so the text to modify is the WHOLE DOCUMENT. Return the whole document with the requested change: copy every paragraph you do not need to change exactly as it is, character for character, in the same order.
- Put new material where it belongs (e.g. a signature block with place and date at the end, a new clause after the related one) as separate paragraphs.`;

const MASKING_NOTE = `\n\nPLACEHOLDERS: some names and identifiers were replaced with placeholders such as [CÉG_1], [SZEMÉLY_2] or [CÍM_1] before the text reached you.
- Keep every placeholder exactly as written (same brackets, same word, same number) wherever that entity appears in your answer, including quotes.
- Never guess or invent the real values behind them.`;

function styleInstructions(style: StyleProfile | undefined): string {
  if (!style) return "";
  const lines: string[] = [];
  if (style.addressing === "formal") lines.push('- Form of address: formal (in Hungarian use "Ön", magázás).');
  if (style.addressing === "informal") lines.push("- Form of address: informal (in Hungarian use tegezés).");
  if (style.tone === "legal") lines.push("- Tone: precise legal language.");
  if (style.tone === "business") lines.push("- Tone: professional business language.");
  if (style.tone === "plain") lines.push("- Tone: plain language that a non-expert understands.");
  if (style.tone === "friendly") lines.push("- Tone: friendly and approachable.");
  if (style.notes) lines.push(`- Additional guidelines from the user: ${style.notes}`);
  return lines.length ? `\n\nUSER STYLE PREFERENCES (follow them unless the instruction explicitly says otherwise):\n${lines.join("\n")}` : "";
}

function historyBlock(history: HistoryTurn[] | undefined): string {
  if (!history?.length) return "";
  const rounds = history
    .map((turn, i) => `--- Round ${i + 1} ---\nInstruction: ${turn.instruction}\nYour answer:\n${turn.result}`)
    .join("\n\n");
  return `PREVIOUS ROUNDS (the user is refining your earlier answer; the last round is your current draft):\n${rounds}\n\n`;
}

export interface BuiltPrompt {
  systemInstruction: string;
  prompt: string;
  /** Set when the model must answer with JSON matching this schema */
  responseJsonSchema?: object;
}

export function buildPrompt(request: AIRequestBody): BuiltPrompt {
  const { mode, instruction, originalText, documentContext, history, styleProfile } = request;
  const isRefinement = !!history?.length;
  const instructionBlock = isRefinement
    ? `FOLLOW-UP INSTRUCTION (apply it to your latest answer and return the complete new version):\n${instruction}`
    : `INSTRUCTION:\n${instruction}`;
  // Long documents arrive as excerpts (beginning, headings, surroundings of the selection) marked with === headers
  const contextBlock = (purpose: string) =>
    documentContext ? `DOCUMENT CONTEXT (${purpose}; long documents are sent as excerpts marked with === headers):\n${documentContext}\n\n` : "";
  const style = styleInstructions(styleProfile) + (request.masked ? MASKING_NOTE : "");
  const whole = request.wholeDocument === true;

  // Structural rules live in the system instruction (helps against prompt injection from document text)
  if (mode === "generate") {
    return {
      systemInstruction: `You are a professional legal and business advisor AI operating within Microsoft Word.
Your task is to generate new text or a new clause based on the user's instruction, to be inserted into the document.
RULES:
- Return ONLY the newly generated text.
- Do NOT wrap the text in quotes, markdown blocks, or add any conversational filler.
- Do NOT use markdown formatting (no **bold**, no # headings).
- Ensure the tone matches the document context if provided.${style}`,
      prompt: `${contextBlock("for your reference only, to ensure consistent tone, formatting, and terminology. DO NOT output this")}${historyBlock(history)}${instructionBlock}`,
    };
  }

  if (mode === "comment") {
    return {
      systemInstruction: `You are a professional legal and business advisor AI operating within Microsoft Word.
Your task is to analyze the user's ${whole ? "whole document (nothing was selected)" : "selected text"} based on their instruction and provide a concise comment/margin note.
RULES:
- Return ONLY the text for the comment.
- Keep it concise, professional, and directly address the instruction.
- Do NOT wrap the text in quotes, markdown blocks, or add any conversational filler.${style}`,
      prompt: `${contextBlock("for your reference only")}${whole ? "WHOLE DOCUMENT TO ANALYZE" : "SELECTED TEXT TO ANALYZE"}:\n${originalText}\n\n${historyBlock(history)}${instructionBlock}`,
    };
  }

  if (mode === "compare") {
    return {
      systemInstruction: `You are a professional legal and business advisor AI operating within Microsoft Word.
The user compares an earlier version of a document with the current one, typically to see what the counterparty changed.
Your task is to assess the listed changes according to the user's instruction.
RULES:
- Answer with JSON: an overview, and one entry per change you assess, using the CHANGE numbers from the list as ids.
- Judge the substance and the risk from the user's point of view; purely formal changes are low risk unless they change the meaning.
- Write in the language of the user's instruction.${style}`,
      prompt: `CHANGES BETWEEN THE EARLIER AND THE CURRENT VERSION:\n${documentContext}\n\n${historyBlock(history)}${instructionBlock}`,
      responseJsonSchema: COMPARE_SCHEMA,
    };
  }

  if (mode === "review") {
    return {
      systemInstruction: `You are a professional legal and business reviewer AI operating within Microsoft Word.
Your task is to review the whole document according to the user's instruction and return findings that will be inserted as Word comments.
RULES:
- Return a JSON array of findings, most important first, at most ${MAX_REVIEW_FINDINGS} findings.
- "quote" MUST be copied verbatim from the document (same characters, same punctuation), 5-15 words, so the add-in can find it with an exact search. Never paraphrase it.
- A quote must come from a single paragraph: never let it run across a line break.
- A number in square brackets at the start of a line (e.g. [5.2.]) is Word's automatic paragraph numbering, shown so you can check numbering and cross-references. It is not part of the text: never put it into a quote or a suggestion.
- "comment" is a concise, actionable margin note written in the language of the user's instruction.
- "suggestion" is the fix: the corrected text that will replace exactly the quoted words as a tracked change, so it must read correctly in their place. Give one whenever the problem can be solved by rewording (a contradiction, a wrong reference, an unclear or one-sided clause, a typo).
  - The quote must then contain everything you change (up to one whole sentence, at most 250 characters); keep the words that need no change identical.
  - To add something missing, quote the sentence after which it belongs and return that sentence followed by the addition.
  - Write the suggestion in the language of the document, in its style and defined terms.
  - Use an empty string when no rewording helps (e.g. a question for the client, a missing annex, a business decision).
- If nothing relevant is found, return an empty array.${style}`,
      prompt: `DOCUMENT TO REVIEW:\n${documentContext}\n\n${historyBlock(history)}${instructionBlock}`,
      responseJsonSchema: REVIEW_SCHEMA,
    };
  }

  return {
    systemInstruction: `You are a professional text editor AI operating directly within Microsoft Word.
Your task is to modify the user's selected text based on their instruction.
RULES:
- Return ONLY the modified text for the "ORIGINAL TEXT TO MODIFY" section.
- Do NOT wrap the text in quotes, markdown blocks, or add any conversational filler (e.g. "Here is the text:").
- Do NOT use markdown formatting (no **bold**, no # headings).
- Keep the paragraph structure: return one paragraph per original paragraph, separated by line breaks, unless the instruction requires otherwise.
- Ensure the tone and content align with the DOCUMENT CONTEXT if provided.${whole ? WHOLE_DOCUMENT_EDIT : ""}
- After the modified text, add a line containing only ${EXPLANATION_MARKER}, then 1-3 short sentences in the language of the user's instruction explaining why the changes were needed (it may become a Word comment next to them; with several changes, one short point each). Nothing else after it.${style}`,
    prompt: `${contextBlock("for your reference only to understand the surrounding context. DO NOT output this, only use it to make better decisions for the selection")}ORIGINAL TEXT TO MODIFY (You must rewrite ONLY this part):\n${originalText}\n\n${historyBlock(history)}${instructionBlock}`,
  };
}

/** Largest accepted recording (base64): about two minutes of compressed speech */
export const MAX_AUDIO_BASE64_CHARS = 4_000_000;
const AUDIO_TYPES = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|aac|flac|aiff)$/;

/** Validates a dictation upload; the codec parameters are dropped from the type */
export function parseTranscribeRequest(raw: any): { value: { audio: string; mimeType: string } } | { error: string } {
  const audio = typeof raw?.audio === "string" ? raw.audio : "";
  const mimeType = (typeof raw?.mimeType === "string" ? raw.mimeType : "").split(";")[0].trim().toLowerCase();
  if (!audio) return { error: "Missing audio" };
  if (audio.length > MAX_AUDIO_BASE64_CHARS) return { error: "Recording too long" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return { error: "Audio must be base64" };
  if (!AUDIO_TYPES.test(mimeType)) return { error: "Unsupported audio type" };
  return { value: { audio, mimeType } };
}
