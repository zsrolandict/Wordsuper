import type { AIRequestBody } from "../src/shared/aiConfig";
import { MAX_REVIEW_FINDINGS } from "../src/shared/aiConfig";
import type { ModelProvider, StreamFinish, TokenUsage } from "./ai/types";
import { buildPrompt, REVIEW_SCHEMA } from "./prompts";

/**
 * Multi-agent review: the same document goes to several specialist reviewers at once, each looking at one field
 * only; then a supervising reviewer merges their findings into one list (duplicates dropped, contradictions
 * resolved, the most important first). The pane gets the merged list as an ordinary review answer, so the
 * one-by-one decisions and the tracked changes work the same way. Costs about as many requests as specialists + 1.
 */

export interface Specialist {
  id: string;
  /** Shown in the pane's details while it runs */
  label: string;
  /** What this reviewer looks at, in the language of the instructions */
  focus: string;
}

export const SPECIALISTS: Specialist[] = [
  { id: "liability", label: "Felelősség és kockázat", focus: "felelősség, kártérítés, felelősségkorlátozás, kötbér, szavatosság, jótállás, biztosítékok, kockázatviselés" },
  { id: "money", label: "Pénzügyi feltételek", focus: "ellenérték, vételár, fizetési feltételek és határidők, késedelem, kamat, költségek, adók, árváltozás" },
  { id: "term", label: "Hatály és megszűnés", focus: "hatálybalépés, időtartam, teljesítési határidők, elállás, felmondás, megszűnés és következményei, vis maior, jogviták rendezése, joghatóság" },
  { id: "rights", label: "Jogok és adatok", focus: "szellemi tulajdon, titoktartás, személyes adatok és adatvédelem, versenytilalom, engedmény, alvállalkozók" },
  { id: "consistency", label: "Belső következetesség", focus: "definiált fogalmak, kereszthivatkozások, számozás, mellékletek, a rendelkezések közötti ellentmondások, hiányzó vagy kétértelmű rendelkezések" },
];

export interface SpecialistResult {
  specialist: Specialist;
  findings: unknown[];
  error?: string;
}

const addUsage = (a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage | undefined =>
  !a ? b : !b ? a : { prompt: a.prompt + b.prompt, output: a.output + b.output, thoughts: a.thoughts + b.thoughts, total: a.total + b.total };

/** The findings of one specialist's answer; [] when it is not a list */
export function parseFindingList(text: string): unknown[] {
  try {
    const data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    return Array.isArray(data) ? data.filter(f => f && typeof f === "object" && typeof f.quote === "string" && typeof f.comment === "string") : [];
  } catch {
    return [];
  }
}

/** The request one specialist gets: the user's instruction, narrowed to its field */
export function specialistRequest(request: AIRequestBody, specialist: Specialist): AIRequestBody {
  return {
    ...request,
    instruction: `${request.instruction}\n\nSZAKTERÜLETED: csak ezt vizsgáld: ${specialist.focus}. A többi szempontot más szakértők nézik, azokkal ne foglalkozz.`.slice(0, 4000),
    history: [],
  };
}

/** The supervisor's prompt: the document, every specialist's findings, and how to merge them */
export function mergePrompt(request: AIRequestBody, results: SpecialistResult[]) {
  const base = buildPrompt({ ...request, history: [] });
  const candidates = results
    .filter(r => r.findings.length)
    .map(r => `### ${r.specialist.label}\n${JSON.stringify(r.findings)}`)
    .join("\n\n");
  return {
    systemInstruction: `${base.systemInstruction}

YOU ARE THE SUPERVISING REVIEWER. Specialist reviewers have each checked the document for one field; their findings are listed under SPECIALIST FINDINGS.
- Merge them into one list of at most ${MAX_REVIEW_FINDINGS} findings, the most important first.
- Drop duplicates: when several specialists flag the same place, keep one finding that covers what they said.
- Resolve contradictions: when two suggestions for the same text conflict, keep the one that fits the instruction and the represented party best, and say in the comment what the other view was.
- Keep each kept finding's quote verbatim as the specialist gave it (it must still be found word for word in the document); you may shorten or sharpen comments and suggestions.
- Drop findings that are wrong on the face of the document. Do not add new findings that no specialist raised.`,
    prompt: `SPECIALIST FINDINGS:\n${candidates || "(none)"}\n\n${base.prompt}`,
    responseJsonSchema: REVIEW_SCHEMA,
  };
}

/**
 * Runs the specialists in parallel, then streams the supervisor's merged answer through onText. Progress goes to
 * onThought (the pane shows it in the details). Throws when every specialist failed.
 */
export async function runMultiAgentReview(
  provider: ModelProvider,
  request: AIRequestBody,
  handlers: { signal: AbortSignal; onThought: (text: string) => void; onText: (text: string) => void },
): Promise<StreamFinish & { specialists: number }> {
  let usage: TokenUsage | undefined;
  handlers.onThought(`${SPECIALISTS.length} szakértő vizsgálja párhuzamosan: ${SPECIALISTS.map(s => s.label).join(", ")}.`);
  const results = await Promise.all(SPECIALISTS.map(async (specialist): Promise<SpecialistResult> => {
    const built = buildPrompt(specialistRequest(request, specialist));
    let text = "";
    try {
      const finish = await provider.generate(
        { systemInstruction: built.systemInstruction, prompt: built.prompt, responseJsonSchema: built.responseJsonSchema, signal: handlers.signal, depth: request.depth },
        event => { if (event.type === "text") text += event.text; },
      );
      usage = addUsage(usage, finish.usage);
      if (finish.reason !== "stop") return { specialist, findings: [], error: finish.detail ?? finish.reason };
      const findings = parseFindingList(text);
      handlers.onThought(`${specialist.label}: ${findings.length} észrevétel.`);
      return { specialist, findings };
    } catch (error) {
      if (handlers.signal.aborted) throw error;
      handlers.onThought(`${specialist.label}: nem sikerült (${(error as Error).message}).`);
      return { specialist, findings: [], error: (error as Error).message };
    }
  }));
  if (results.every(r => r.error)) throw new Error("Every specialist reviewer failed.");
  const failed = results.filter(r => r.error).length;
  handlers.onThought(`Összegzés: ${results.reduce((n, r) => n + r.findings.length, 0)} szakértői észrevételből egy lista${failed ? ` (${failed} szakértő kimaradt)` : ""}.`);

  const merge = mergePrompt(request, results);
  const finish = await provider.generate(
    { ...merge, signal: handlers.signal, depth: request.depth },
    event => (event.type === "thought" ? handlers.onThought(event.text) : handlers.onText(event.text)),
  );
  return { ...finish, usage: addUsage(usage, finish.usage), specialists: SPECIALISTS.length - failed };
}
