/**
 * Hungarian legal microtypography, rule-based: non-breaking spaces where a line must not break (§ 5, 2013. évi
 * V. törvény, 2026. október 3., 100 000 Ft) and Hungarian quotation marks („…”) instead of straight ones. Only
 * spaces become non-breaking and only straight quotes are replaced: the words themselves never change.
 */

export const NBSP = ' ';

const MONTHS = 'január|február|március|április|május|június|július|augusztus|szeptember|október|november|december';
const CURRENCY = 'Ft|forint|HUF|EUR|euró|euro|USD|CHF|GBP';

/**
 * One alternation, so the matches never overlap. Each match is kept together on one line: its spaces become
 * non-breaking.
 */
const KEEP_TOGETHER = new RegExp([
  // A law: 2013. évi V. törvény / tv.
  `\\d{4}\\. évi [IVXLCDM]+\\. (?:törvény|tv\\.)`,
  // A date: 2026. október 3.
  `\\d{4}\\. (?:${MONTHS}) \\d{1,2}\\.`,
  // A section sign and its number: § 5, §§ 5
  `§§? \\d+`,
  // An amount with thousands groups and an optional currency: 100 000 Ft, 1 250 000
  `(?<!\\d)(?<!\\d )\\d{1,3}(?: \\d{3})+(?: (?:${CURRENCY})(?![\\p{L}]))?`,
  // A plain amount with a currency: 500 Ft, 30 EUR
  `(?<!\\d)(?<!\\d )\\d+ (?:${CURRENCY})(?![\\p{L}])`,
].join('|'), 'gu');

export interface Replacement {
  /** The text as it is now (with ordinary spaces) */
  find: string;
  /** The same text with non-breaking spaces */
  replace: string;
}

/** Where a paragraph needs non-breaking spaces; each distinct text once */
export function nbspFixes(text: string): Replacement[] {
  const found = new Map<string, string>();
  for (const match of text.matchAll(KEEP_TOGETHER)) {
    const find = match[0];
    // Word's search takes at most 255 characters
    if (find.includes(' ') && find.length <= 255) found.set(find, find.replace(/ /g, NBSP));
  }
  return [...found].map(([find, replace]) => ({ find, replace }));
}

const OPENS_AFTER = /[\s([{–—/-]/;

/**
 * The Hungarian quotation mark for each straight double quote of a paragraph, in order: an opening one („) at the
 * start or after a space or bracket, a closing one (”) otherwise.
 */
export function quoteFixes(text: string): ('„' | '”')[] {
  const marks: ('„' | '”')[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    const before = i === 0 ? ' ' : text[i - 1];
    marks.push(OPENS_AFTER.test(before) || before === '„' ? '„' : '”');
  }
  return marks;
}

/** How many places a set of paragraphs would change: non-breaking spaces and straight quotes */
export function countMicrotypography(texts: string[]): { nbsp: number; quotes: number } {
  let nbsp = 0;
  let quotes = 0;
  for (const text of texts) {
    for (const match of text.matchAll(KEEP_TOGETHER)) if (match[0].includes(' ')) nbsp++;
    quotes += quoteFixes(text).length;
  }
  return { nbsp, quotes };
}
