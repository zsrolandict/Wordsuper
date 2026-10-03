import {
  ADDRESSING_VALUES,
  MAX_HISTORY_RESULT_CHARS,
  MAX_INSTRUCTION_CHARS,
  MAX_PARTY_CHARS,
  MAX_REVIEW_FINDINGS,
  MAX_SELECTION_CHARS,
  MAX_STYLE_NOTES_CHARS,
  CLARIFY_MARKER,
  DEPTH_VALUES,
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

import { MAX_PLAYBOOK_RULES, PLAYBOOK_POSITIONS, formatPlaybook, sanitizePlaybook } from "../src/shared/playbook";

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
  if ((mode === "edit" || mode === "comment" || mode === "letter") && !originalText.trim()) {
    return { error: "Missing originalText" };
  }

  const documentContext = toLineFeeds(asString(raw.documentContext)).substring(0, contextLimitFor(mode));
  if ((mode === "review" || mode === "compare" || mode === "translate") && !documentContext.trim()) {
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

  const party = asString(raw.party).replace(/\s+/g, " ").trim().substring(0, MAX_PARTY_CHARS);
  // Only a review checks against a playbook; what arrives is checked like anything from a file
  const playbook = mode === "review" && raw.playbook !== undefined ? sanitizePlaybook(raw.playbook) : null;
  // Several specialist reviewers, then a merge: a free review only (a playbook check is one pass per rule anyway)
  const multiAgent = mode === "review" && !playbook && raw.multiAgent === true;
  if (mode === "review" && raw.playbook !== undefined && !playbook) {
    return { error: "Invalid playbook" };
  }

  return { value: { mode, instruction, originalText, documentContext, history, styleProfile, ...(party ? { party } : {}), ...(playbook ? { playbook } : {}), ...(multiAgent ? { multiAgent } : {}), masked: raw.masked === true, wholeDocument: raw.wholeDocument === true, depth: (DEPTH_VALUES as readonly unknown[]).includes(raw.depth) ? raw.depth as AIRequestBody["depth"] : undefined, maskedValues: typeof raw.maskedValues === "number" && Number.isInteger(raw.maskedValues) && raw.maskedValues >= 0 ? raw.maskedValues : undefined } };
}

const QUOTE_DESCRIPTION = "Exact, verbatim excerpt copied character-for-character from the document that pinpoints where the comment belongs: 5-15 words, or up to one whole sentence (at most 250 characters) when the suggestion rewrites it.";

// One check per playbook rule, every rule exactly once: the pane shows them all as a checklist
const PLAYBOOK_SCHEMA = {
  type: "object",
  properties: {
    checks: {
      type: "array",
      maxItems: MAX_PLAYBOOK_RULES,
      items: {
        type: "object",
        properties: {
          rule: { type: "string", description: "The rule id from the playbook, as in [r3] without the brackets." },
          position: { type: "string", enum: [...PLAYBOOK_POSITIONS] },
          quote: { type: "string", description: QUOTE_DESCRIPTION + " For a missing clause: the sentence after which it belongs." },
          comment: { type: "string", description: "What the document says on this point, which level of the playbook it meets and what to do, written in the language of the user's instruction." },
          suggestion: { type: "string", description: "The wording that replaces exactly the quoted text as a tracked change and brings the clause to the standard position; empty for a clause already at the standard." },
        },
        required: ["rule", "position", "quote", "comment", "suggestion"],
        propertyOrdering: ["rule", "position", "quote", "comment", "suggestion"],
      },
    },
  },
  required: ["checks"],
};

// Standard JSON Schema, so any provider that supports structured output can use it
export const REVIEW_SCHEMA = {
  type: "array",
  maxItems: MAX_REVIEW_FINDINGS,
  items: {
    type: "object",
    properties: {
      quote: { type: "string", description: QUOTE_DESCRIPTION },
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

// One translation per item, by its id: the bilingual table pairs them back row by row
const TRANSLATE_SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", description: "The id of the item, the number in [[…]]." },
          text: { type: "string", description: "The translation of exactly that item." },
        },
        required: ["id", "text"],
        propertyOrdering: ["id", "text"],
      },
    },
  },
  required: ["translations"],
};

// Edit, comment and generate answer in plain text, so they can ask back; review and compare must return JSON
const CLARIFY_RULE = `
- ASK BACK instead of guessing when the instruction is unclear: it is garbled or misspelled (e.g. a dictation error), it names no clear action, or it has several plausible readings that would lead to different texts (e.g. "make the contractor consistent" without saying which of the existing terms to keep). Then do not do the task; answer with exactly this and nothing else: a first line containing only ${CLARIFY_MARKER}, then a JSON object {"question": "...", "options": ["...", "...", "..."]}.
  - The question and the 2-3 options are in the language of the instruction. Each option is a complete, concrete instruction the user could send as it is (e.g. "Egységesítsd a fogalmat mindenhol »Vállalkozó«-ra").
  - Clear instructions, even very short ones ("Javítsd", "Rövidítsd le", "Tedd hivatalosabbá"), are done without asking.`;

const WHOLE_DOCUMENT_EDIT = `
- Nothing was selected, so the text to modify is the WHOLE DOCUMENT. Return the whole document with the requested change: copy every paragraph you do not need to change exactly as it is, character for character, in the same order.
- Put new material where it belongs (e.g. a signature block with place and date at the end, a new clause after the related one) as separate paragraphs.`;

/** An edit changes wording, not substance: what a lawyer would never want lost in a style rewrite */
const KEEP_SUBSTANCE = `
- Change only what the instruction asks for. A style instruction (more formal, simpler, shorter) changes the wording, never the substance: keep every legal reference (act, section, paragraph, e.g. "a Ptk. 6:186. §-a szerint"), amount, percentage, date, deadline, name, defined term, cross-reference and number exactly, unless the instruction explicitly asks to change it.`;

/** The explanation of a whole-document edit: a summary, then one reason per changed paragraph (shown under it) */
const WHOLE_DOCUMENT_EXPLANATION = (marker: string) => `
- After the modified text, add a line containing only ${marker}. Then, in the language of the user's instruction:
  1. A summary of 3-6 sentences: what kind of changes you made across the document and why, and what you deliberately left unchanged.
  2. Then one line for EVERY paragraph you changed, added or removed, in document order, in exactly this form:
     >> first 5-10 words of the paragraph, copied verbatim from your modified text (for a removed paragraph, from the original) :: one sentence on why this paragraph was changed
  Nothing else after it.`;

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

/** Whose side the AI is on; neutral when no party is set */
function partyInstructions(party: string | undefined, mode: AIRequestBody["mode"]): string {
  if (!party) return "";
  const judge = mode === "review" || mode === "compare"
    ? "- Judge risks and priorities from this party's point of view: what disadvantages, exposes or burdens it comes first; say plainly when a change or clause works against it."
    : "- Draft and comment from this party's point of view: protect its interests and avoid wording that weakens its position.";
  return `\n\nTHE USER REPRESENTS THIS PARTY: ${party}
${judge}
- Stay fair and enforceable: do not make the text aggressive or one-sided beyond what the instruction asks, and never misstate the other side's rights or obligations.`;
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
  const style = styleInstructions(styleProfile) + partyInstructions(request.party, mode) + (request.masked ? MASKING_NOTE : "");
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
- Ensure the tone matches the document context if provided.${CLARIFY_RULE}${style}`,
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
- Do NOT wrap the text in quotes, markdown blocks, or add any conversational filler.${CLARIFY_RULE}${style}`,
      prompt: `${contextBlock("for your reference only")}${whole ? "WHOLE DOCUMENT TO ANALYZE" : "SELECTED TEXT TO ANALYZE"}:\n${originalText}\n\n${historyBlock(history)}${instructionBlock}`,
    };
  }

  if (mode === "translate") {
    return {
      systemInstruction: `You are a professional legal translator working on contracts within Microsoft Word.
Your task is to translate the items of the document as the user's instruction says.
RULES:
- Each item starts with its id in double brackets, e.g. [[12]]. Return exactly one translation per item, with the same id, every id exactly once, in the same order. Never merge, split, skip or reorder items, even if a sentence seems to continue in the next item.
- Translate only the item's text; never copy the [[id]] marker into the translation.
- Use precise legal language and the conventions of contracts in the target language, keeping the meaning exactly, including obligations, conditions, deadlines and amounts.
- Keep numbers, dates, amounts, section numbers and cross-references (e.g. "5.2. pont" → "Clause 5.2") consistent and correct.
- GLOSSARY: when a glossary is given, translate those defined terms exactly as listed, everywhere, with the same capitalisation.
- An item that is a name, a number or a title stays a short item in the translation too.${style}`,
      prompt: `${originalText ? `GLOSSARY (defined terms and their fixed translations):\n${originalText}\n\n` : ""}ITEMS TO TRANSLATE:\n${documentContext}\n\n${instructionBlock}`,
      responseJsonSchema: TRANSLATE_SCHEMA,
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

  if (mode === "letter") {
    return {
      systemInstruction: `You are a lawyer's assistant within Microsoft Word.
Your task is to draft the cover email that goes to the counterparty's lawyer together with the marked-up contract.
RULES:
- Write in the language of the user's instruction (Hungarian unless it says otherwise), polite and professional, concise.
- Start with a subject line ("Tárgy: …" in Hungarian, "Subject: …" in English), then the email.
- Explain the changes listed under CHANGES WE MADE, grouped by topic, each with its reason in one sentence. Mention only those changes: never add new demands, concessions or facts.
- No markdown, no placeholders for things you do not know (leave out names you do not have; sign as "[név]").${style}`,
      prompt: `CHANGES WE MADE (in the marked-up contract):\n${originalText}\n\n${contextBlock("the beginning of the contract, for the parties and the subject only")}${historyBlock(history)}${instructionBlock}`,
    };
  }

  if (mode === "review" && request.playbook) {
    return {
      systemInstruction: `You are a professional legal reviewer AI operating within Microsoft Word.
Your task is to check the whole document against the firm's PLAYBOOK below: for each rule, which level of the firm's positions the document meets.
RULES:
- Return one check per rule, every rule id exactly once, in the order of the playbook. Never invent rules.
- "position": standard = the clause meets the standard position (or is better for the side the playbook is written for); fallback1 / fallback2 = it meets only that compromise; walkaway = it is worse than the last acceptable compromise or matches the walk-away; missing = the document has no such clause at all. Do not soften: a clause is standard only if it really meets the standard.
- Judge from the point of view of the side the playbook is written for; when it names none, of the party the user represents.
- "quote" MUST be copied verbatim from the document (same characters, same punctuation), so the add-in can find it with an exact search: 5-15 words, or the whole sentence (at most 250 characters) when the suggestion rewrites it. It must come from a single paragraph. For a missing clause, quote the sentence after which it belongs.
- A number in square brackets at the start of a line (e.g. [5.2.]) is Word's automatic paragraph numbering. It is not part of the text: never put it into a quote or a suggestion.
- "comment": what the document says on this point, which level it meets, and what to do; concise, in the language of the user's instruction. Name the level in words (standard, Fallback 1, Fallback 2, elfogadhatatlan, hiányzik).
- "suggestion": for fallback1, fallback2 and walkaway, the quoted text reworded to the standard position (use the model clause's wording where the playbook gives one); for missing, the quoted sentence followed by the new clause; for standard, an empty string. Write it in the language and style of the document, with its defined terms.
- The playbook is the firm's internal policy: never mention it, its fallbacks or its walk-away in a suggestion.${style}`,
      prompt: `${formatPlaybook(request.playbook)}\n\nDOCUMENT TO CHECK:\n${documentContext}\n\n${historyBlock(history)}${instructionBlock}`,
      responseJsonSchema: PLAYBOOK_SCHEMA,
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
- Ensure the tone and content align with the DOCUMENT CONTEXT if provided.${KEEP_SUBSTANCE}${whole ? WHOLE_DOCUMENT_EDIT : ""}${whole ? WHOLE_DOCUMENT_EXPLANATION(EXPLANATION_MARKER) : `
- After the modified text, add a line containing only ${EXPLANATION_MARKER}, then 1-3 short sentences in the language of the user's instruction explaining why the changes were needed (it may become a Word comment next to them; with several changes, one short point each). Nothing else after it.`}${CLARIFY_RULE}${style}`,
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
