import { Type, type Schema } from "@google/genai";
import {
  MAX_HISTORY_TURNS,
  MAX_INSTRUCTION_CHARS,
  MAX_REVIEW_FINDINGS,
  MAX_SELECTION_CHARS,
  MAX_STYLE_NOTES_CHARS,
  MODES,
  contextLimitFor,
  type AIRequestBody,
  type Addressing,
  type HistoryTurn,
  type Mode,
  type StyleProfile,
  type Tone,
} from "../src/shared/aiConfig";

// A review result is JSON with up to MAX_REVIEW_FINDINGS entries, so it needs more room than a text draft
const MAX_HISTORY_RESULT_CHARS = 20000;

const ADDRESSING_VALUES: Addressing[] = ["", "formal", "informal"];
const TONE_VALUES: Tone[] = ["", "legal", "business", "plain", "friendly"];

type ParseResult = { value: AIRequestBody } | { error: string };

const asString = (value: unknown) => (typeof value === "string" ? value : "");

/** Validates and truncates the request body; never trust the task pane's own limits */
export function parseRequest(body: unknown): ParseResult {
  const raw = (body ?? {}) as Record<string, unknown>;

  const mode = raw.mode as Mode;
  if (!MODES.includes(mode)) {
    return { error: "Invalid mode" };
  }

  const instruction = asString(raw.instruction).trim();
  if (!instruction) {
    return { error: "Missing instruction" };
  }
  if (instruction.length > MAX_INSTRUCTION_CHARS) {
    return { error: `Instruction is longer than ${MAX_INSTRUCTION_CHARS} characters` };
  }

  const originalText = asString(raw.originalText).substring(0, MAX_SELECTION_CHARS);
  if ((mode === "edit" || mode === "comment") && !originalText.trim()) {
    return { error: "Missing originalText" };
  }

  const documentContext = asString(raw.documentContext).substring(0, contextLimitFor(mode));
  if (mode === "review" && !documentContext.trim()) {
    return { error: "Missing documentContext" };
  }

  const history: HistoryTurn[] = (Array.isArray(raw.history) ? raw.history : [])
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({
      instruction: asString(turn?.instruction).substring(0, MAX_INSTRUCTION_CHARS),
      result: asString(turn?.result).substring(0, MAX_HISTORY_RESULT_CHARS),
    }))
    .filter((turn) => turn.instruction && turn.result);

  const rawStyle = (raw.styleProfile ?? {}) as Record<string, unknown>;
  const styleProfile: StyleProfile = {
    addressing: ADDRESSING_VALUES.includes(rawStyle.addressing as Addressing) ? (rawStyle.addressing as Addressing) : "",
    tone: TONE_VALUES.includes(rawStyle.tone as Tone) ? (rawStyle.tone as Tone) : "",
    notes: asString(rawStyle.notes).trim().substring(0, MAX_STYLE_NOTES_CHARS),
  };

  return { value: { mode, instruction, originalText, documentContext, history, styleProfile } };
}

const REVIEW_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      quote: { type: Type.STRING, description: "Exact, verbatim excerpt copied character-for-character from the document (5-15 words, at most 150 characters) that pinpoints where the comment belongs." },
      comment: { type: Type.STRING, description: "Concise comment for the margin, written in the language of the user's instruction." },
      severity: { type: Type.STRING, enum: ["high", "medium", "low"] },
    },
    required: ["quote", "comment", "severity"],
    propertyOrdering: ["quote", "comment", "severity"],
  },
};

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
  responseSchema?: Schema;
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
  const style = styleInstructions(styleProfile);

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
Your task is to analyze the user's selected text based on their instruction and provide a concise comment/margin note.
RULES:
- Return ONLY the text for the comment.
- Keep it concise, professional, and directly address the instruction.
- Do NOT wrap the text in quotes, markdown blocks, or add any conversational filler.${style}`,
      prompt: `${contextBlock("for your reference only")}SELECTED TEXT TO ANALYZE:\n${originalText}\n\n${historyBlock(history)}${instructionBlock}`,
    };
  }

  if (mode === "review") {
    return {
      systemInstruction: `You are a professional legal and business reviewer AI operating within Microsoft Word.
Your task is to review the whole document according to the user's instruction and return findings that will be inserted as Word comments.
RULES:
- Return a JSON array of findings, most important first, at most ${MAX_REVIEW_FINDINGS} findings.
- "quote" MUST be copied verbatim from the document (same characters, same punctuation), 5-15 words, so the add-in can find it with an exact search. Never paraphrase it.
- "comment" is a concise, actionable margin note written in the language of the user's instruction.
- If nothing relevant is found, return an empty array.${style}`,
      prompt: `DOCUMENT TO REVIEW:\n${documentContext}\n\n${historyBlock(history)}${instructionBlock}`,
      responseSchema: REVIEW_SCHEMA,
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
- Ensure the tone and content align with the DOCUMENT CONTEXT if provided.${style}`,
    prompt: `${contextBlock("for your reference only to understand the surrounding context. DO NOT output this, only use it to make better decisions for the selection")}ORIGINAL TEXT TO MODIFY (You must rewrite ONLY this part):\n${originalText}\n\n${historyBlock(history)}${instructionBlock}`,
  };
}
