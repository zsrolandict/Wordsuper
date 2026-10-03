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

/** Distinct replacements, the longest first (so a longer form is replaced before a shorter one inside it) */
function distinct(pairs: [string, string][]): Replacement[] {
  const found = new Map<string, string>();
  for (const [find, replace] of pairs) if (find !== replace && find.length <= 255 && !found.has(find)) found.set(find, replace);
  return [...found].map(([find, replace]) => ({ find, replace })).sort((a, b) => b.find.length - a.find.length);
}

const EN_DASH = '–';

/**
 * Dashes as Hungarian typography wants them: an em dash (—, typical of AI text) or a double hyphen becomes a spaced
 * en dash ( – ), and so does a hyphen standing between spaces ("szó - szó")
 */
export function dashFixes(text: string): Replacement[] {
  const pairs: [string, string][] = [];
  for (const match of text.matchAll(/ *(?:—|--+) */g)) {
    const atStart = match.index === 0 || /^\s*$/.test(text.slice(0, match.index));
    pairs.push([match[0], atStart ? `${EN_DASH} ` : ` ${EN_DASH} `]);
  }
  for (const match of text.matchAll(/(?<=\S) - (?=\S)/g)) pairs.push([match[0], ` ${EN_DASH} `]);
  return distinct(pairs);
}

/**
 * Ranges with an en dash: 2020-2025, 5-10. pont. Only two plain numbers, the first smaller and without a leading
 * zero, and not part of a longer chain: phone numbers, dates, bank accounts and company numbers stay as they are.
 */
export function rangeFixes(text: string): Replacement[] {
  const pairs: [string, string][] = [];
  for (const match of text.matchAll(/(?<![\d.\-/])(\d{1,4})(\.?)-(\d{1,4})(\.?)(?![\d\-/])/g)) {
    const [, from, dot1, to, dot2] = match;
    if (from.startsWith('0') || Number(from) >= Number(to)) continue;
    pairs.push([match[0], `${from}${dot1}${EN_DASH}${to}${dot2}`]);
  }
  return distinct(pairs);
}

/** English opening quotation marks (“) become Hungarian ones („); the closing one (”) is the same in both */
export function englishQuoteFixes(text: string): Replacement[] {
  return text.includes('“') ? [{ find: '“', replace: '„' }] : [];
}

/** Within e-mail addresses, links and similar tokens nothing is touched */
const isTechnicalToken = (text: string, at: number) => {
  const start = text.lastIndexOf(' ', at) + 1;
  const end = text.indexOf(' ', at);
  const token = text.slice(start, end === -1 ? undefined : end);
  return /@|\/\/|www\.|\.(hu|com|eu|org)\b/i.test(token);
};

/**
 * Spaces around punctuation: none before a comma, semicolon, colon, period, exclamation or question mark ("szó ,"),
 * one after a comma, semicolon, colon, exclamation or question mark followed by a word ("szó,szó"). Numbers (6:98,
 * 1,5), periods after abbreviations and technical tokens (e-mail, links) are left alone.
 */
export function punctuationFixes(text: string): Replacement[] {
  const pairs: [string, string][] = [];
  // "szó ,szó": the space moves to after the mark
  for (const match of text.matchAll(/(\p{L}+) +([,;:!?]|\.(?=\s|$))(\p{L}*)/gu)) {
    if (!isTechnicalToken(text, match.index!)) pairs.push([match[0], `${match[1]}${match[2]}${match[3] ? ` ${match[3]}` : ''}`]);
  }
  for (const match of text.matchAll(/(\p{L}+)([,;:!?])(\p{L}+)/gu)) {
    if (!isTechnicalToken(text, match.index!)) pairs.push([match[0], `${match[1]}${match[2]} ${match[3]}`]);
  }
  return distinct(pairs);
}

export interface MarkdownFix {
  /** Heading hashes and list markers at the start of the paragraph */
  replacements: Replacement[];
  /** Texts between double asterisks: the asterisks go, the text becomes bold */
  bold: string[];
  /** Texts between single asterisks: the asterisks go, the text becomes italic */
  italic: string[];
}

/** What is left of Markdown in text pasted from an AI chat: # headings, - or * list markers, **bold**, *italic* */
export function markdownFixes(text: string): MarkdownFix {
  const replacements: [string, string][] = [];
  const prefix = /^(\s*)(#{1,6} +|[-*] +)(\S.{0,30})/u.exec(text);
  if (prefix) {
    const [whole, space, marker, rest] = prefix;
    replacements.push([whole, `${space}${marker.startsWith('#') ? '' : `${EN_DASH} `}${rest}`]);
  }
  const bold = [...new Set([...text.matchAll(/\*\*(?!\s)([^*\n]{1,240}?)(?<!\s)\*\*/g)].map(m => m[1]))];
  const italic = [...new Set([...text.matchAll(/(?<![*\p{L}\d])\*(?![\s*])([^*\n]{1,80}?\p{L}[^*\n]{0,80}?)(?<![\s*])\*(?![*\p{L}\d])/gu)].map(m => m[1]))];
  return { replacements: distinct(replacements), bold, italic };
}

/** How many places each kind of clean-up would change, over all paragraphs */
export function countCleanup(texts: string[]): { dashes: number; ranges: number; punctuation: number; markdown: number; curlyQuotes: number } {
  const total = { dashes: 0, ranges: 0, punctuation: 0, markdown: 0, curlyQuotes: 0 };
  for (const text of texts) {
    total.dashes += (text.match(/—|--+|(?<=\S) - (?=\S)/g) ?? []).length;
    total.ranges += rangeFixes(text).length;
    total.punctuation += punctuationFixes(text).length;
    const md = markdownFixes(text);
    total.markdown += md.replacements.length + md.bold.length + md.italic.length;
    total.curlyQuotes += (text.match(/“/g) ?? []).length;
  }
  return total;
}
