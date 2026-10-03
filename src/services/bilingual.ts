import type { ParagraphInfo } from './structure';

/**
 * The bilingual side-by-side document. The two sides stay in step by construction: the document is translated
 * paragraph by paragraph, each paragraph keeps its id, and the answer must give back every id exactly once. One id
 * = one table row, so the left and the right side can never drift apart.
 */

export type Language = 'hu' | 'en';

export const LANGUAGE_LABELS: Record<Language, { name: string; column: string }> = {
  hu: { name: 'magyar', column: 'Magyar' },
  en: { name: 'angol', column: 'English' },
};

export interface TranslationUnit {
  id: number;
  /** Word's automatic number ("5.2."): kept on both sides, never translated */
  number?: string;
  text: string;
  heading?: boolean;
}

/** One unit per non-empty paragraph, in document order */
export function translationUnits(paragraphs: (ParagraphInfo & { heading?: boolean })[]): TranslationUnit[] {
  const units: TranslationUnit[] = [];
  for (const p of paragraphs) {
    const text = p.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    units.push({ id: units.length + 1, text, ...(p.listString ? { number: p.listString.trim() } : {}), ...(p.heading ? { heading: true } : {}) });
  }
  return units;
}

/** Which language the document is in, by its most common short words and the Hungarian letters */
export function guessLanguage(text: string): Language {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const count = (list: string[]) => words.filter(w => list.includes(w)).length;
  const hungarian = count(['a', 'az', 'és', 'hogy', 'nem', 'szerint', 'között', 'vagy', 'is', 'meg', 'jelen', 'szerződés']) + (text.match(/[őűŐŰ]/g)?.length ?? 0);
  const english = count(['the', 'and', 'of', 'to', 'in', 'shall', 'by', 'or', 'any', 'this', 'agreement', 'with']);
  return english > hungarian ? 'en' : 'hu';
}

/**
 * Units in parts small enough for one answer each (the answer is as long as the part). A unit longer than the
 * limit gets a part of its own.
 */
export function chunkUnits(units: TranslationUnit[], maxChars: number): TranslationUnit[][] {
  const chunks: TranslationUnit[][] = [];
  let current: TranslationUnit[] = [];
  let size = 0;
  for (const unit of units) {
    if (current.length && size + unit.text.length > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(unit);
    size += unit.text.length;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** One unit per line, the id in double brackets: masking can't break this form (it could break JSON quotes) */
export const formatUnits = (units: { id: number; text: string }[]) => units.map(u => `[[${u.id}]] ${u.text}`).join('\n');

/**
 * The translations of an answer, by id. Only the ids that were asked for count; an id given twice keeps its first
 * text. missing: the ids the answer left out, to be asked again.
 */
export function parseTranslations(answer: string, ids: number[]): { texts: Map<number, string>; missing: number[] } {
  const texts = new Map<number, string>();
  const wanted = new Set(ids);
  let data: unknown;
  try {
    data = JSON.parse(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return { texts, missing: ids };
  }
  const list = Array.isArray(data) ? data : (data as { translations?: unknown })?.translations;
  for (const item of Array.isArray(list) ? list : []) {
    const id = Number(item?.id);
    if (wanted.has(id) && !texts.has(id) && typeof item?.text === 'string' && item.text.trim()) texts.set(id, item.text.replace(/\s+/g, ' ').trim());
  }
  return { texts, missing: ids.filter(id => !texts.has(id)) };
}

/** One part's text in a request: the answer is about as long, which keeps it well under the model's output limit */
export const PART_CHARS = 12000;
/** A longer document is not translated in one go (about 150 pages) */
export const MAX_TRANSLATE_CHARS = 400000;

export interface PartsRun {
  /** Sends one request with these units and returns the raw (still masked) answer */
  ask: (units: TranslationUnit[]) => Promise<string>;
  /** Puts the hidden values back into one translated text */
  unmask: (text: string) => string;
  /** The answer was cut off for its length: the part is split in two and asked again */
  isTooLong: (error: unknown) => boolean;
  /** After each part: how many of the parts are done */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Translates the units part by part. The ids an answer leaves out are asked once more on their own; what is still
 * missing after that is simply not in the result (the caller marks those rows). Any other error stops the run.
 */
export async function translateInParts(units: TranslationUnit[], run: PartsRun, partChars = PART_CHARS): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const take = async (part: TranslationUnit[], retry: boolean): Promise<void> => {
    let answer: string;
    try {
      answer = await run.ask(part);
    } catch (e) {
      if (part.length > 1 && run.isTooLong(e)) {
        const half = Math.ceil(part.length / 2);
        await take(part.slice(0, half), retry);
        await take(part.slice(half), retry);
        return;
      }
      throw e;
    }
    const { texts, missing } = parseTranslations(answer, part.map(u => u.id));
    texts.forEach((text, id) => result.set(id, run.unmask(text)));
    if (missing.length && retry) await take(part.filter(u => missing.includes(u.id)), false);
  };
  const parts = chunkUnits(units, partChars);
  for (const [i, part] of parts.entries()) {
    await take(part, true);
    run.onProgress?.(i + 1, parts.length);
  }
  return result;
}

/** "Vevő → Buyer" lines for the prompt: the defined terms, translated once and used the same way everywhere */
export const formatGlossary = (glossary: Map<string, string>) => [...glossary].map(([term, translation]) => `${term} → ${translation}`).join('\n');

export const translateInstruction = (from: Language, to: Language) =>
  `Fordítsd le ${LANGUAGE_LABELS[from].name} nyelvről ${LANGUAGE_LABELS[to].name} nyelvre, jogi szaknyelven, minden elemet külön.`;

export const glossaryInstruction = (from: Language, to: Language) =>
  `Ezek egy szerződés definiált fogalmai. Fordítsd le őket ${LANGUAGE_LABELS[from].name} nyelvről ${LANGUAGE_LABELS[to].name} nyelvre, a jogi szaknyelvben szokásos, nagy kezdőbetűs fogalomként (pl. Vevő → Buyer).`;
