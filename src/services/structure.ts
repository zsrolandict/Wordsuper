/**
 * Deterministic map of a contract's structure: defined terms, numbered sections, annexes and cross-references.
 * No AI involved, so it is instant, free and repeatable. Tuned for Hungarian contracts (with the common English
 * patterns too). Offsets are positions inside Word's paragraph.text.
 */

export interface ParagraphInfo {
  text: string;
  /** Automatic numbering as Word shows it (ListItem.listString), e.g. "5.2." — some hosts give only "2." */
  listString?: string;
  /** List level (0 = top), used to rebuild "5.2" when Word only gives the number of the level */
  listLevel?: number;
}

export interface Occurrence {
  paragraph: number;
  start: number;
  end: number;
}

export interface DefinedTerm {
  term: string;
  kind: 'inline' | 'list';
  /** Where the term is defined */
  definedAt: Occurrence;
  /** The defining text: the definition paragraph, or the sentence the inline definition closes */
  definition: string;
  /** Uses of the term elsewhere, inflected forms included (Megbízónak, Munkát…) */
  usages: Occurrence[];
}

export interface Section {
  kind: 'section' | 'annex';
  /** "5.2" for sections, "2" for annexes */
  label: string;
  paragraph: number;
  title: string;
}

export interface CrossReference extends Occurrence {
  kind: 'section' | 'annex';
  label: string;
  raw: string;
  /** Paragraph of the referenced section/annex, null when it doesn't exist in this document */
  target: number | null;
}

/** missing-annex is only a note: annexes are often separate files */
export type IssueKind = 'unused' | 'duplicate' | 'broken-reference' | 'missing-annex' | 'undefined-quoted';

export interface StructureIssue {
  kind: IssueKind;
  message: string;
  at: Occurrence;
  /** The term or the reference text the issue is about */
  subject: string;
}

export interface DocumentGraph {
  terms: DefinedTerm[];
  sections: Section[];
  references: CrossReference[];
  issues: StructureIssue[];
}

const UPPER = 'A-ZÁÉÍÓÖŐÚÜŰ';
const QUOTE_OPEN = '„"“«';
const QUOTE_CLOSE = '”"“»';
const COMPANY_SUFFIX = /\b(Kft|Zrt|Nyrt|Bt|Kkt|Ltd|GmbH|Inc|LLC)\.?$/;

const QUOTED_START = new RegExp(`^\\s*[${QUOTE_OPEN}]([^${QUOTE_CLOSE}]+)[${QUOTE_CLOSE}]`, 'u');

/** A term without its quotes; a quoted term ends at its closing quote („Vételár-részlet 2.” Utolsó… → Vételár-részlet 2.) */
const normalizeTerm = (term: string) =>
  (QUOTED_START.exec(term)?.[1] ?? term)
    .replace(new RegExp(`^[${QUOTE_OPEN}\\s]+|[${QUOTE_CLOSE}\\s]+$`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();

const looksLikeTerm = (term: string) =>
  term.length >= 2 && term.length <= 60 && new RegExp(`^[${UPPER}]`).test(term) && !COMPANY_SUFFIX.test(term);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Regex for a term and its inflected forms: suffixes are allowed on the last word, and a final a/e may
 * lengthen (Munka → Munkát, Fele → Felét). Case-sensitive, because defined terms are capitalized.
 */
export function termPattern(term: string): RegExp {
  const words = term.split(' ').map(escapeRegExp);
  const last = words.pop()!;
  const stem = last.replace(/a$/, '[aá]').replace(/e$/, '[eé]');
  return new RegExp(`(?<![\\p{L}\\p{N}])${[...words, stem].join('\\s+')}\\p{L}*`, 'gu');
}

/**
 * "(a továbbiakban: Megbízó)", "(székhely: …; a továbbiakban: Megbízó)", "(a továbbiakban együtt: Felek, külön-külön: Fél)".
 * The definition runs from "továbbiakban" to the next ";" or ")".
 */
const INLINE_HU = /(?:\ba\s+)?\btovábbiakban\b([^);]*)/giu;
const INLINE_EN = new RegExp(`\\(\\s*(?:hereinafter\\s+(?:referred\\s+to\\s+as\\s+)?)?(?:the\\s+)?[${QUOTE_OPEN}]([^${QUOTE_CLOSE}]{2,60})[${QUOTE_CLOSE}]\\s*\\)`, 'gu');
/** Definition list entries: „Szerződés”: jelenti …, "Szerződés" alatt … értendő, Szerződés: jelenti … */
const LIST_QUOTED = new RegExp(`^\\s*(?:\\d+(?:\\.\\d+)*\\.?\\s+|[a-z]\\)\\s+)?[${QUOTE_OPEN}]([^${QUOTE_CLOSE}]{2,80})[${QUOTE_CLOSE}]\\s*(?::|–|-|jelenti|jelent|alatt|means)`, 'u');
const LIST_PLAIN = new RegExp(`^\\s*(?:\\d+(?:\\.\\d+)*\\.?\\s+|[a-z]\\)\\s+)?([${UPPER}][\\p{L} ]{1,60}?)\\s*(?::\\s*|\\s+)(?:jelenti|jelent)\\b`, 'u');

const SECTION_REF = /(?<![\d:.])(\d+(?:\.\d+)*)\.?\s*(?:pont|alpont|fejezet|cikk)\p{L}*/gu;
const ANNEX_REF = /(?<![\d:.])(\d+)\.?\s*(?:számú|sz\.)\s*mellékl?et\p{L}*/giu;
const ANNEX_HEADING = /^\s*(?:(\d+)\.?\s*(?:számú|sz\.)\s*melléklet|melléklet\s*(?:no\.?|sz\.?)?\s*(\d+))/iu;
const TEXT_NUMBERING = /^\s*(\d+(?:\.\d+)*)\.?\s+\S/u;

/**
 * The text an inline definition closes, for showing it at the cursor: the paragraph up to the closing
 * parenthesis (party blocks are one paragraph). Sentence detection is avoided on purpose: Hungarian
 * abbreviations (Kft., Zrt., u., sz.) are full of dots.
 */
function sentenceBefore(text: string, end: number): string {
  const close = text.indexOf(')', end);
  const sentence = text.slice(0, close === -1 ? end : close + 1).trim();
  return sentence.length > 400 ? `…${sentence.slice(-400)}` : sentence;
}

/**
 * Section labels of all paragraphs. Word's listString is "5.2." on desktop but can be just "2." for a level-2
 * item; then the label is rebuilt from the numbers of the parent levels.
 */
function sectionLabels(paragraphs: ParagraphInfo[]): (string | null)[] {
  const levels: string[] = [];
  return paragraphs.map(p => {
    const fromList = p.listString?.trim().replace(/\.+$/, '');
    if (fromList !== undefined) {
      const level = p.listLevel ?? 0;
      if (!/^\d+(\.\d+)*$/.test(fromList)) return null; // bullets, a), i. …
      const parts = fromList.split('.');
      const label = parts.length > 1 || level === 0 ? fromList : [...levels.slice(0, level), fromList].join('.');
      levels.length = level;
      levels[level] = parts[parts.length - 1];
      return label;
    }
    return TEXT_NUMBERING.exec(p.text)?.[1] ?? null;
  });
}

/**
 * Paragraph texts with Word's automatic numbering put in front in square brackets ("[5.2.] A Vevő…"). The
 * numbering is not part of the text, so without this the AI could not check numbering and references.
 */
export function withAutoNumbers(paragraphs: ParagraphInfo[]): string[] {
  const labels = sectionLabels(paragraphs);
  return paragraphs.map((p, i) => {
    const shown = p.listString?.trim();
    if (!shown) return p.text;
    return `[${labels[i] !== null && /^\d/.test(shown) ? `${labels[i]}.` : shown}] ${p.text}`;
  });
}

export function buildDocumentGraph(paragraphs: ParagraphInfo[]): DocumentGraph {
  const terms: DefinedTerm[] = [];
  const issues: StructureIssue[] = [];
  const byTerm = new Map<string, DefinedTerm>();
  /** Spans that are part of a definition itself, so they don't count as uses */
  const definitionSpans: Occurrence[] = [];

  const addTerm = (term: string, kind: DefinedTerm['kind'], at: Occurrence, definition: string) => {
    if (!looksLikeTerm(term)) return;
    const existing = byTerm.get(term);
    if (existing) {
      if (existing.definedAt.paragraph !== at.paragraph) {
        issues.push({ kind: 'duplicate', message: `„${term}” kétszer van definiálva (az első a ${existing.definedAt.paragraph + 1}. bekezdésben).`, at, subject: term });
      }
      return;
    }
    const entry: DefinedTerm = { term, kind, definedAt: at, definition, usages: [] };
    byTerm.set(term, entry);
    terms.push(entry);
  };

  // 1. Definitions
  paragraphs.forEach(({ text }, paragraph) => {
    for (const match of text.matchAll(INLINE_HU)) {
      const start = match.index!;
      const end = start + match[0].length;
      definitionSpans.push({ paragraph, start, end });
      // "együtt: Felek, külön-külön: Fél" → two terms
      for (const piece of match[1].split(',')) {
        const term = normalizeTerm(piece.replace(/^\s*(?:(?:együtt(?:esen)?|külön-külön|külön|egyenként|mint)\s*)*:?\s*/iu, ''));
        addTerm(term, 'inline', { paragraph, start, end }, sentenceBefore(text, end));
      }
    }
    for (const match of text.matchAll(INLINE_EN)) {
      const start = match.index!;
      const end = start + match[0].length;
      definitionSpans.push({ paragraph, start, end });
      addTerm(normalizeTerm(match[1]), 'inline', { paragraph, start, end }, sentenceBefore(text, end));
    }
    const listMatch = LIST_QUOTED.exec(text) ?? LIST_PLAIN.exec(text);
    if (listMatch) {
      const end = listMatch.index + listMatch[0].length;
      definitionSpans.push({ paragraph, start: listMatch.index, end });
      addTerm(normalizeTerm(listMatch[1]), 'list', { paragraph, start: listMatch.index, end }, text.trim());
    }
  });

  // 2. Uses: longer terms first, so "Bizalmas Információ" isn't also counted as a use of "Információ"
  const covered: Occurrence[] = [];
  const overlaps = (a: Occurrence, b: Occurrence) => a.paragraph === b.paragraph && a.start < b.end && b.start < a.end;
  for (const entry of [...terms].sort((a, b) => b.term.length - a.term.length)) {
    const pattern = termPattern(entry.term);
    paragraphs.forEach(({ text }, paragraph) => {
      for (const match of text.matchAll(pattern)) {
        const occurrence = { paragraph, start: match.index!, end: match.index! + match[0].length };
        if (definitionSpans.some(span => overlaps(span, occurrence)) || covered.some(c => overlaps(c, occurrence))) continue;
        entry.usages.push(occurrence);
        covered.push(occurrence);
      }
    });
  }
  for (const entry of terms) {
    entry.usages.sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);
    if (entry.usages.length === 0) {
      issues.push({ kind: 'unused', message: `„${entry.term}” definiálva van, de a szerződés sehol nem használja.`, at: entry.definedAt, subject: entry.term });
    }
  }

  // 3. Sections and annexes
  const sections: Section[] = [];
  const sectionIndex = new Map<string, number>();
  const annexIndex = new Map<string, number>();
  const labels = sectionLabels(paragraphs);
  paragraphs.forEach((p, paragraph) => {
    const title = p.text.trim().slice(0, 100);
    const annex = ANNEX_HEADING.exec(p.text);
    if (annex) {
      const label = annex[1] ?? annex[2];
      if (!annexIndex.has(label)) {
        annexIndex.set(label, paragraph);
        sections.push({ kind: 'annex', label, paragraph, title });
      }
      return;
    }
    const label = labels[paragraph];
    // The first occurrence wins: numbering often restarts inside annexes
    if (label && !sectionIndex.has(label)) {
      sectionIndex.set(label, paragraph);
      sections.push({ kind: 'section', label, paragraph, title });
    }
  });

  // 4. Cross-references
  const references: CrossReference[] = [];
  paragraphs.forEach(({ text }, paragraph) => {
    for (const match of text.matchAll(ANNEX_REF)) {
      const label = match[1];
      // The annex's own heading is not a reference to itself
      if (annexIndex.get(label) === paragraph && match.index! <= 3) continue;
      references.push({ kind: 'annex', label, raw: match[0], paragraph, start: match.index!, end: match.index! + match[0].length, target: annexIndex.get(label) ?? null });
    }
    for (const match of text.matchAll(SECTION_REF)) {
      const label = match[1];
      references.push({ kind: 'section', label, raw: match[0], paragraph, start: match.index!, end: match.index! + match[0].length, target: sectionIndex.get(label) ?? null });
    }
  });
  references.sort((a, b) => a.paragraph - b.paragraph || a.start - b.start);
  for (const ref of references) {
    if (ref.target === null && ref.kind === 'annex') {
      issues.push({ kind: 'missing-annex', message: `A(z) ${ref.label}. számú melléklet nincs ebben a dokumentumban („${ref.raw}”) – ha külön fájl, ez rendben van.`, at: ref, subject: ref.raw });
    } else if (ref.target === null) {
      issues.push({ kind: 'broken-reference', message: `A „${ref.raw}” hivatkozás célja (${ref.label}. pont) nem található ebben a dokumentumban.`, at: ref, subject: ref.raw });
    }
  }

  // 5. Quoted terms that are never defined but used again, e.g. „Teljesítési Igazolás” … a Teljesítési Igazolás
  // (a quotation that appears only once is just a quotation, not a term)
  const reported = new Set<string>();
  const occurrencesOf = (term: string) => paragraphs.reduce((n, { text }) => n + (text.match(termPattern(term)) ?? []).length, 0);
  const quoted = new RegExp(`[${QUOTE_OPEN}]([${UPPER}][^${QUOTE_CLOSE}]{1,59})[${QUOTE_CLOSE}]`, 'gu');
  paragraphs.forEach(({ text }, paragraph) => {
    for (const match of text.matchAll(quoted)) {
      const term = normalizeTerm(match[1]);
      const occurrence = { paragraph, start: match.index!, end: match.index! + match[0].length };
      if (!looksLikeTerm(term) || byTerm.has(term) || reported.has(term)) continue;
      if (definitionSpans.some(span => overlaps(span, occurrence))) continue;
      reported.add(term);
      if (occurrencesOf(term) < 2) continue;
      issues.push({ kind: 'undefined-quoted', message: `„${term}” idézőjelben szerepel, mintha definiált fogalom lenne, de nincs definiálva.`, at: occurrence, subject: term });
    }
  });

  issues.sort((a, b) => a.at.paragraph - b.at.paragraph || a.at.start - b.at.start);
  return { terms, sections, references, issues };
}

/**
 * Text of a section for showing it at the cursor: its paragraph and what follows, including its own subsections
 * ("5." shows 5.1, 5.2…), until the next section or annex, capped.
 */
export function sectionPreview(paragraphs: ParagraphInfo[], graph: DocumentGraph, index: number, maxChars = 700): string {
  const target = graph.sections.find(s => s.paragraph === index);
  const starts = new Map(graph.sections.map(s => [s.paragraph, s]));
  let text = '';
  for (let i = index; i < paragraphs.length && text.length < maxChars; i++) {
    const next = starts.get(i);
    const isOwnSubsection = next && target && next.kind === 'section' && target.kind === 'section' && next.label.startsWith(`${target.label}.`);
    if (i > index && next && !isOwnSubsection) break;
    const line = `${paragraphs[i].listString ? `${paragraphs[i].listString} ` : ''}${paragraphs[i].text}`.trim();
    if (line) text += (text ? '\n' : '') + line;
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export type FoundAt =
  | { type: 'term'; term: DefinedTerm; occurrence: Occurrence }
  | { type: 'reference'; reference: CrossReference };

/** What is at a position of the document: a use of a defined term, or a cross-reference */
export function findAt(graph: DocumentGraph, paragraph: number, offset: number): FoundAt | null {
  const contains = (o: Occurrence) => o.paragraph === paragraph && o.start <= offset && offset <= o.end;
  const reference = graph.references.find(contains);
  if (reference) return { type: 'reference', reference };
  for (const term of graph.terms) {
    const occurrence = term.usages.find(contains) ?? (contains(term.definedAt) ? term.definedAt : undefined);
    if (occurrence) return { type: 'term', term, occurrence };
  }
  return null;
}
