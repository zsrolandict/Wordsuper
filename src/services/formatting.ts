import { buildDocumentGraph } from './structure';
import { countCleanup, countMicrotypography, dashFixes, englishQuoteFixes, markdownFixes, nbspFixes, punctuationFixes, quoteFixes, rangeFixes, type Replacement } from './microtypography';

/**
 * The Formázás tab without AI: what the document's formatting looks like (fonts, sizes, spacing, headings), and the
 * plan that makes it uniform. Only appearance: the text, the heading levels (navigation, table of contents) and the
 * numbering stay as they are; bold, italic and underline inside a paragraph are kept.
 */

/** One paragraph's formatting as Word reports it; null: mixed inside the paragraph */
export interface ParagraphFormat {
  text: string;
  /** Word's built-in style name in English ("Normal", "Heading1", "Title"), "Other" for a custom style */
  styleBuiltIn: string;
  /** > 0: inside a table */
  tableLevel: number;
  font: string | null;
  size: number | null;
  bold: boolean | null;
  /** "Left" | "Centered" | "Right" | "Justified" | … */
  alignment: string;
  spaceBefore: number;
  spaceAfter: number;
  /** In points */
  lineSpacing: number;
  /** First-line indent in points (negative: hanging); 0 when absent */
  firstLineIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  /** Font color as "#RRGGBB"; null when mixed */
  color?: string | null;
  /** Small capitals; null when mixed or unknown */
  smallCaps?: boolean | null;
  /** Localized style name ("Címsor 1"), to set page-break rules on the style */
  style?: string;
  /** A numbered or bulleted paragraph: its indents belong to the list */
  isList?: boolean;
}

export interface FootnoteFormat {
  font: string | null;
  size: number | null;
}

export interface PageMargins { top: number; bottom: number; left: number; right: number }

export interface FormatAudit {
  paragraphs: ParagraphFormat[];
  /** Page margins per section in points; null when this Word can't read them */
  margins?: PageMargins[] | null;
  /** Footnote texts' paragraphs; null when this Word can't read them (before WordApi 1.5) */
  footnotes: FootnoteFormat[] | null;
}

export type Role =
  | { kind: 'empty' }
  /** Nothing but a page/section break or a manual line break: never deleted, never formatted */
  | { kind: 'break' }
  | { kind: 'title' }
  | { kind: 'heading'; level: number }
  /** Not a heading style, but looks like one: short, bold or all capitals, no closing punctuation */
  | { kind: 'fake-heading' }
  | { kind: 'table' }
  | { kind: 'body' };

const HEADING = /^Heading(\d)$/;
const FAKE_HEADING_MAX_CHARS = 100;

/** Really empty: only spaces. A paragraph holding a page or section break (\f) or a manual line break (\v) is not */
export const isBlank = (text: string) => /^[ \t\u00A0\u200B\u00AD]*$/.test(text);

/** A line left for a signature ("______", "……………"): the empty lines above it make room for the signature */
const SIGNATURE_LINE = /^[\s_.…-]*(_{4,}|\.{6,}|…{3,})[\s_.…-]*$/;

export function roleOf(p: ParagraphFormat): Role {
  const text = p.text.trim();
  if (isBlank(p.text)) return { kind: 'empty' };
  if (!text) return { kind: 'break' };
  if (p.styleBuiltIn === 'Title') return { kind: 'title' };
  const heading = HEADING.exec(p.styleBuiltIn);
  if (heading) return { kind: 'heading', level: Number(heading[1]) };
  if (p.tableLevel > 0) return { kind: 'table' };
  const letters = text.replace(/[^\p{L}]/gu, '');
  const capitals = letters.length >= 3 && letters === letters.toLocaleUpperCase('hu');
  if (text.length <= FAKE_HEADING_MAX_CHARS && !/[.,;:!?]$/.test(text) && (p.bold === true || capitals)) return { kind: 'fake-heading' };
  return { kind: 'body' };
}

/** Values by how often they occur, the most common first */
function tally<T>(values: T[]): [T, number][] {
  const counts = new Map<T, number>();
  values.forEach(v => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1]);
}

const round = (n: number) => Math.round(n * 10) / 10;

export interface AuditSummary {
  /** Body text (tables included): font → paragraphs; '' for a paragraph with mixed fonts */
  fonts: [string, number][];
  sizes: [number, number][];
  /** Different spacing settings (before / after / line spacing) in the body text */
  spacings: number;
  /** Heading style level → paragraphs */
  headingLevels: [number, number][];
  fakeHeadings: string[];
  titles: number;
  /** Empty paragraphs right after another empty one: the extra blank lines */
  extraEmpty: number[];
  /** Every empty paragraph used only as spacing, which the spacing settings can take over */
  allEmpty: number[];
  /** Places with two or more spaces in a row */
  doubleSpaces: number;
  /** Places for a non-breaking space (§ 5, dates, laws, amounts) and straight double quotes */
  nbsp: number;
  /** Straight double quotes and English opening quotes (“) */
  straightQuotes: number;
  /** AI and pasted-text clean-up: em dashes and spaced hyphens, ranges, punctuation spacing, Markdown left-overs */
  /** Defined terms (their definitions) */
  terms: number;
  dashes: number;
  ranges: number;
  punctuation: number;
  markdown: number;
  /** Footnote sizes; null when they can't be read */
  footnoteSizes: [number, number][] | null;
  dominant: { font: string; size: number; lineSpacing: number; spaceBefore: number; spaceAfter: number; alignment: 'Left' | 'Justified' };
}

export function summarize(audit: FormatAudit): AuditSummary {
  const roles = audit.paragraphs.map(roleOf);
  const body = audit.paragraphs.filter((_, i) => roles[i].kind === 'body');
  const text = audit.paragraphs.filter((_, i) => roles[i].kind === 'body' || roles[i].kind === 'table');
  const fonts = tally(text.map(p => p.font ?? ''));
  const sizes = tally(text.map(p => p.size).filter((s): s is number => !!s).map(round));
  // An empty paragraph is kept when it holds the document together: the last one, one in or next to a table (it
  // keeps two tables apart, and Word needs a paragraph after a table), one right above a signature line
  const paragraphs = audit.paragraphs;
  const allEmpty = paragraphs
    .map((_, i) => i)
    .filter(i => roles[i].kind === 'empty' && i < paragraphs.length - 1
      && !paragraphs[i].tableLevel && !paragraphs[i - 1]?.tableLevel && !paragraphs[i + 1]?.tableLevel
      && !SIGNATURE_LINE.test(paragraphs[i + 1]?.text ?? ''));
  const extraEmpty = allEmpty.filter(i => i > 0 && roles[i - 1].kind === 'empty');
  const micro = countMicrotypography(audit.paragraphs.map(p => p.text));
  const cleanup = countCleanup(audit.paragraphs.map(p => p.text));
  const alignments = tally(body.map(p => p.alignment).filter(a => a === 'Left' || a === 'Justified'));
  return {
    fonts,
    sizes,
    spacings: new Set(body.map(p => `${round(p.spaceBefore)}/${round(p.spaceAfter)}/${round(p.lineSpacing)}`)).size,
    headingLevels: tally(roles.flatMap(r => (r.kind === 'heading' ? [r.level] : []))).sort((a, b) => a[0] - b[0]),
    fakeHeadings: audit.paragraphs.filter((_, i) => roles[i].kind === 'fake-heading').map(p => p.text.trim()),
    titles: roles.filter(r => r.kind === 'title').length,
    extraEmpty,
    allEmpty,
    doubleSpaces: audit.paragraphs.reduce((n, p, i) => n + (roles[i].kind === 'empty' ? 0 : (p.text.match(/ {2,}/g)?.length ?? 0)), 0),
    nbsp: micro.nbsp,
    straightQuotes: micro.quotes + cleanup.curlyQuotes,
    terms: buildDocumentGraph(audit.paragraphs.map(p => ({ text: p.text }))).terms.length,
    dashes: cleanup.dashes,
    ranges: cleanup.ranges,
    punctuation: cleanup.punctuation,
    markdown: cleanup.markdown,
    footnoteSizes: audit.footnotes && tally(audit.footnotes.map(f => f.size).filter((s): s is number => !!s).map(round)),
    dominant: {
      font: fonts.find(([f]) => f)?.[0] ?? 'Calibri',
      size: sizes[0]?.[0] ?? 11,
      lineSpacing: tally(body.map(p => round(p.lineSpacing)).filter(n => n > 0))[0]?.[0] ?? 0,
      spaceBefore: tally(body.map(p => round(p.spaceBefore)))[0]?.[0] ?? 0,
      spaceAfter: tally(body.map(p => round(p.spaceAfter)))[0]?.[0] ?? 6,
      alignment: alignments[0]?.[0] === 'Left' ? 'Left' : 'Justified',
    },
  };
}

/**
 * Is there a choice to make about the heading levels? More than one level (fake headings count as one more) may be
 * deliberate, or just inconsistent: the user is asked.
 */
export const headingLevelCount = (summary: AuditSummary, withFake: boolean) =>
  summary.headingLevels.length + (withFake && summary.fakeHeadings.length ? 1 : 0);

export interface FormatProfile {
  font: string;
  bodySize: number;
  /** The largest heading; with separate levels the lower ones step down from it */
  headingSize: number;
  footnoteSize: number;
  /** Empty: headings use the body font (a serif body with sans-serif headings is the classic pairing) */
  headingFont: string;
  bodySpaceBefore: number;
  bodySpaceAfter: number;
  headingSpaceBefore: number;
  headingSpaceAfter: number;
  /** Points; 0: left as it is */
  lineSpacing: number;
  /** First-line indent of body paragraphs in points; 0: left as it is */
  firstLineIndent: number;
  /** Body paragraphs' left/right indent in points; 0: left as it is */
  leftIndent: number;
  rightIndent: number;
  /** Heading color "#RRGGBB"; empty: left as it is */
  headingColor: string;
  /** Headings in small capitals */
  headingSmallCaps: boolean;
  /** A thin rule under Heading 1 in this color; empty: none */
  h1Rule: string;
  /** A thin bar left of Heading 2 in this color; empty: none */
  h2Bar: string;
  /** Body text color (e.g. a soft graphite instead of pure black); empty: left as it is */
  bodyColor: string;
  /** Page margins in cm; 0: left as it is */
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  alignment: 'Left' | 'Justified';
}

export function defaultProfile(summary: AuditSummary): FormatProfile {
  const body = summary.dominant.size;
  return {
    font: summary.dominant.font,
    bodySize: body,
    headingSize: body + 2,
    footnoteSize: Math.max(8, body - 2),
    headingFont: '',
    bodySpaceBefore: summary.dominant.spaceBefore,
    bodySpaceAfter: summary.dominant.spaceAfter,
    headingSpaceBefore: 12,
    headingSpaceAfter: 6,
    lineSpacing: summary.dominant.lineSpacing,
    firstLineIndent: 0,
    leftIndent: 0,
    rightIndent: 0,
    headingColor: '',
    headingSmallCaps: false,
    h1Rule: '',
    h2Bar: '',
    bodyColor: '',
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    alignment: summary.dominant.alignment,
  };
}

export type Category = 'font' | 'size' | 'headings' | 'footnotes' | 'spacing' | 'alignment' | 'color' | 'indent' | 'pagination' | 'margins' | 'styles' | 'emptyParagraphs' | 'allEmpty' | 'doubleSpaces' | 'nbsp' | 'quotes' | 'dashes' | 'ranges' | 'punctuation' | 'markdown' | 'terms';

export interface FormatOptions {
  categories: Record<Category, boolean>;
  /** Bold or all-capital short lines without a heading style are formatted as headings */
  fakeHeadings: boolean;
  /** All headings the same size (they are really one level); false: sizes step down by level */
  unifyHeadings: boolean;
}

/** Changes the formatting only: the text is never touched by these */
export const FORMAT_CATEGORIES: Category[] = ['font', 'size', 'headings', 'footnotes', 'spacing', 'alignment', 'color', 'indent', 'pagination', 'margins', 'styles'];
/** These change the text (so they go in like any other text change, by the Track Changes rule) */
export const TEXT_CATEGORIES: Category[] = ['terms', 'dashes', 'markdown', 'quotes', 'nbsp', 'ranges', 'punctuation', 'emptyParagraphs', 'allEmpty', 'doubleSpaces'];

export const defaultOptions = (): FormatOptions => ({
  categories: { font: true, size: true, headings: true, footnotes: true, spacing: true, alignment: true, color: true, indent: true, pagination: true, margins: true, styles: true, emptyParagraphs: false, allEmpty: false, doubleSpaces: false, nbsp: false, quotes: false, dashes: false, ranges: false, punctuation: false, markdown: false, terms: false },
  fakeHeadings: true,
  unifyHeadings: false,
});

export interface ParagraphChange {
  index: number;
  font?: string;
  size?: number;
  bold?: true;
  spaceBefore?: number;
  spaceAfter?: number;
  lineSpacing?: number;
  firstLineIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  color?: string;
  smallCaps?: true;
  /** Pinned to the current value, so a new Normal style does not change it (table cells, centered lines) */
  alignment?: string;
}

export interface StyleUpdate {
  /** The style's name as this Word knows it (localized, e.g. "Címsor 1"); English fallback when not in the document */
  name: string;
  builtIn: string;
  font: { name?: string; size?: number; bold?: boolean; color?: string; smallCaps?: boolean };
  paragraph?: { spaceBefore?: number; spaceAfter?: number; lineSpacing?: number; alignment?: 'Left' | 'Justified' };
  /** A rule under (Heading 1) or a bar left of (Heading 2) the paragraph */
  border?: { location: 'Bottom' | 'Left'; color: string };
  /** A style of our own, made when missing (for headings without a heading style) */
  create?: boolean;
  /** Paragraphs that get this style */
  apply?: number[];
}

/** The style made for headings that have no heading style, so they can carry the rule too */
export const CHAPTER_STYLE = 'ICT Fejezetcím';

export interface TermEmphasis {
  /** Where each term is defined: the defining text as it will read (quotes added) and the term in it */
  definitions: { index: number; span: string; term: string }[];
  /** Paragraphs and terms whose uses are not to be bold */
  usages: { index: number; term: string }[];
}

const OPENING_QUOTES = '„"“«';

/**
 * Defined terms shown the same way everywhere: at the definition bold and in Hungarian quotation marks, elsewhere
 * plain (the capital letter shows it is a term). Headings and wholly bold paragraphs are left as they are.
 */
export function planTermEmphasis(audit: FormatAudit): { emphasis: TermEmphasis; quoteFixes: Map<number, Replacement[]> } {
  const graph = buildDocumentGraph(audit.paragraphs.map(p => ({ text: p.text })));
  const definitions: TermEmphasis['definitions'] = [];
  const quoteFixes = new Map<number, Replacement[]>();
  for (const term of graph.terms) {
    const { paragraph, start, end } = term.definedAt;
    const text = audit.paragraphs[paragraph]?.text ?? '';
    const span = text.slice(start, end);
    const at = span.indexOf(term.term);
    if (at === -1 || span.length > 250) continue;
    const quoted = at > 0 && OPENING_QUOTES.includes(span[at - 1]);
    const after = quoted ? span : `${span.slice(0, at)}„${term.term}”${span.slice(at + term.term.length)}`;
    if (!quoted) quoteFixes.set(paragraph, [...(quoteFixes.get(paragraph) ?? []), { find: span, replace: after }]);
    definitions.push({ index: paragraph, span: after, term: term.term });
  }
  const usages: TermEmphasis['usages'] = [];
  audit.paragraphs.forEach((p, index) => {
    const role = roleOf(p).kind;
    if (role !== 'body' && role !== 'table') return;
    if (p.bold === true) return;
    for (const term of graph.terms) if (term.usages.some(u => u.paragraph === index)) usages.push({ index, term: term.term });
  });
  return { emphasis: { definitions, usages }, quoteFixes };
}

export interface TextFix {
  index: number;
  /** Text replacements in this paragraph, the longest first (non-breaking spaces, dashes, ranges, spacing…) */
  replacements: Replacement[];
  /** The replacement of each straight double quote, in order */
  quotes: ('„' | '”')[];
  /** Markdown **bold** and *italic*: the texts between the asterisks */
  bold: string[];
  italic: string[];
}

export interface FormatPlan {
  changes: ParagraphChange[];
  footnotes: { font?: string; size?: number } | null;
  /** Paragraphs to delete (the extra empty lines) */
  deleteEmpty: number[];
  doubleSpaces: boolean;
  /** Word's own style definitions, so text typed later looks the same */
  styleUpdates: StyleUpdate[];
  /** Microtypography per paragraph (text changes: tracked like any other) */
  textFixes: TextFix[];
  /** Defined terms: bold where they are defined (in „…”), not bold where they are used */
  termEmphasis: TermEmphasis;
  /** Localized names of the heading styles that get "keep with next" */
  keepWithNextStyles: string[];
  /** New page margins in points (only the ones to change); null: none */
  margins: Partial<PageMargins> | null;
  /** Per category: how many paragraphs (footnotes, places) it changes */
  counts: Record<Category, number>;
}

/** The size of a heading of this level */
export function headingSize(level: number | 'fake', profile: FormatProfile, unified: boolean, levels: number[]): number {
  if (unified) return profile.headingSize;
  const lowest = Math.max(profile.bodySize + 1, profile.headingSize - 2);
  // Fake headings rank below the heading styles; alone they are the headings
  if (level === 'fake') return levels.length ? lowest : profile.headingSize;
  const rank = levels.indexOf(level);
  return Math.max(lowest, profile.headingSize - Math.max(0, rank));
}

const differs = (current: number | null, wanted: number) => current === null || Math.abs(current - wanted) > 0.05;

/** What has to change for the profile; only what is different now */
export function planFormatting(audit: FormatAudit, profile: FormatProfile, options: FormatOptions): FormatPlan {
  const on = options.categories;
  const summary = summarize(audit);
  const levels = summary.headingLevels.map(([level]) => level);
  const counts = Object.fromEntries([...FORMAT_CATEGORIES, ...TEXT_CATEGORIES].map(c => [c, 0])) as Record<Category, number>;
  const changes: ParagraphChange[] = [];

  audit.paragraphs.forEach((p, index) => {
    let role = roleOf(p);
    if (role.kind === 'fake-heading' && !options.fakeHeadings) role = { kind: 'body' };
    if (role.kind === 'empty' || role.kind === 'break') return;
    const change: ParagraphChange = { index };
    const counted = new Set<Category>();
    const set = <K extends keyof ParagraphChange>(category: Category, key: K, value: ParagraphChange[K], changed: boolean) => {
      if (!on[category] || !changed) return;
      change[key] = value;
      counted.add(category);
    };
    const isHeading = role.kind === 'heading' || role.kind === 'fake-heading' || role.kind === 'title';
    const font = isHeading && profile.headingFont ? profile.headingFont : profile.font;
    set('font', 'font', font, p.font !== font);

    if (isHeading) {
      const size = role.kind === 'title' ? profile.headingSize + 2 : headingSize(role.kind === 'heading' ? role.level : 'fake', profile, options.unifyHeadings, levels);
      set('headings', 'size', size, differs(p.size, size));
      set('headings', 'bold', true, p.bold !== true);
      if (profile.headingColor) set('color', 'color', profile.headingColor, (p.color ?? '').toLowerCase() !== profile.headingColor.toLowerCase());
      if (profile.headingSmallCaps) set('headings', 'smallCaps', true, p.smallCaps !== true);
      if (role.kind !== 'title') {
        set('spacing', 'spaceBefore', profile.headingSpaceBefore, differs(p.spaceBefore, profile.headingSpaceBefore));
        set('spacing', 'spaceAfter', profile.headingSpaceAfter, differs(p.spaceAfter, profile.headingSpaceAfter));
      }
    } else {
      set('size', 'size', profile.bodySize, differs(p.size, profile.bodySize));
      if (profile.bodyColor) set('color', 'color', profile.bodyColor, (p.color ?? '').toLowerCase() !== profile.bodyColor.toLowerCase());
      // Table cells: only the font, so the table keeps its own layout. When the Normal style gets new spacing and
      // alignment, a cell would take them over: its present values are pinned on the paragraph itself.
      if (role.kind === 'table' && on.styles) {
        if (on.spacing) {
          change.spaceBefore = p.spaceBefore;
          change.spaceAfter = p.spaceAfter;
          if (p.lineSpacing > 0) change.lineSpacing = p.lineSpacing;
        }
        if (on.alignment && p.alignment !== 'Mixed') change.alignment = p.alignment;
      }
      if (role.kind === 'body') {
        set('spacing', 'spaceBefore', profile.bodySpaceBefore, differs(p.spaceBefore, profile.bodySpaceBefore));
        set('spacing', 'spaceAfter', profile.bodySpaceAfter, differs(p.spaceAfter, profile.bodySpaceAfter));
        if (profile.lineSpacing > 0) set('spacing', 'lineSpacing', profile.lineSpacing, differs(p.lineSpacing, profile.lineSpacing));
        // A list's indents belong to its numbering: left alone
        if (!p.isList) {
          if (profile.firstLineIndent !== 0) set('indent', 'firstLineIndent', profile.firstLineIndent, differs(p.firstLineIndent ?? 0, profile.firstLineIndent));
          if (profile.leftIndent !== 0) set('indent', 'leftIndent', profile.leftIndent, differs(p.leftIndent ?? 0, profile.leftIndent));
          if (profile.rightIndent !== 0) set('indent', 'rightIndent', profile.rightIndent, differs(p.rightIndent ?? 0, profile.rightIndent));
        }
        // A centered or right-aligned paragraph (a title, a signature) is meant to be so
        if (p.alignment === 'Left' || p.alignment === 'Justified') set('alignment', 'alignment', profile.alignment, p.alignment !== profile.alignment);
      }
    }
    counted.forEach(c => counts[c]++);
    if (Object.keys(change).length > 1) changes.push(change);
  });

  let footnotes: FormatPlan['footnotes'] = null;
  if (audit.footnotes?.length) {
    const font = on.font && audit.footnotes.some(f => f.font !== profile.font) ? profile.font : undefined;
    const size = on.footnotes && audit.footnotes.some(f => differs(f.size, profile.footnoteSize)) ? profile.footnoteSize : undefined;
    if (font || size) footnotes = { ...(font ? { font } : {}), ...(size ? { size } : {}) };
    if (font) counts.font += audit.footnotes.length;
    if (size) counts.footnotes = audit.footnotes.length;
  }
  // Headings stay on the page with the paragraph after them: set once on each heading style
  const keepWithNextStyles = on.pagination
    ? [...new Set(audit.paragraphs.flatMap((p, i) => {
      const role = roleOf(p);
      return (role.kind === 'heading' || role.kind === 'title') && p.style ? [p.style] : [];
    }))]
    : [];
  counts.pagination = keepWithNextStyles.length;

  let margins: FormatPlan['margins'] = null;
  if (on.margins && audit.margins?.length) {
    const wanted: Partial<PageMargins> = {};
    const cm = (value: number) => Math.round(value * 28.3465 * 10) / 10;
    (['top', 'bottom', 'left', 'right'] as const).forEach(side => {
      const value = profile[`margin${side[0].toUpperCase()}${side.slice(1)}` as 'marginTop'];
      if (value > 0 && audit.margins!.some(m => differs(m[side], cm(value)))) wanted[side] = cm(value);
    });
    if (Object.keys(wanted).length) {
      margins = wanted;
      counts.margins = audit.margins.length;
    }
  }

  // Word's own styles, so what is typed later looks the same; only what the switched-on categories cover
  const styleUpdates: StyleUpdate[] = [];
  const paragraphs = audit.paragraphs;
  if (on.styles) {
    const localName = (builtIn: string, english: string) => audit.paragraphs.find(p => p.styleBuiltIn === builtIn && p.style)?.style ?? english;
    const font = (name: string) => (on.font ? { name } : {});
    const normal: StyleUpdate = {
      name: localName('Normal', 'Normal'),
      builtIn: 'Normal',
      font: { ...font(profile.font), ...(on.size ? { size: profile.bodySize } : {}), ...(on.color && profile.bodyColor ? { color: profile.bodyColor } : {}) },
      paragraph: {
        ...(on.spacing ? { spaceBefore: profile.bodySpaceBefore, spaceAfter: profile.bodySpaceAfter, ...(profile.lineSpacing > 0 ? { lineSpacing: profile.lineSpacing } : {}) } : {}),
        ...(on.alignment ? { alignment: profile.alignment } : {}),
      },
    };
    styleUpdates.push(normal);
    const headingFont = profile.headingFont || profile.font;
    const headingStyle = (builtIn: string, english: string, size: number, isTitle: boolean): StyleUpdate => ({
      name: localName(builtIn, english),
      builtIn,
      font: {
        ...font(headingFont),
        ...(on.headings ? { size, bold: true, ...(profile.headingSmallCaps ? { smallCaps: true } : {}) } : {}),
        ...(on.color && profile.headingColor ? { color: profile.headingColor } : {}),
      },
      ...(on.spacing && !isTitle ? { paragraph: { spaceBefore: profile.headingSpaceBefore, spaceAfter: profile.headingSpaceAfter } } : {}),
    });
    levels.forEach(level => {
      const update = headingStyle(`Heading${level}`, `Heading ${level}`, headingSize(level, profile, options.unifyHeadings, levels), false);
      // The rule under the top level and the bar beside the second one are part of the look of the headings
      const rank = levels.indexOf(level);
      if (on.headings && rank === 0 && profile.h1Rule) update.border = { location: 'Bottom', color: profile.h1Rule };
      if (on.headings && rank === 1 && profile.h2Bar) update.border = { location: 'Left', color: profile.h2Bar };
      styleUpdates.push(update);
    });
    if (summary.titles) styleUpdates.push(headingStyle('Title', 'Title', profile.headingSize + 2, true));
    // Headings without a heading style (bold or capital lines, "II. Az adásvétel") can carry the rule or the bar only
    // through a paragraph style: one of our own, based on Normal, so their outline level and numbering stay
    const chapterIndices = options.fakeHeadings ? paragraphs.flatMap((p, i) => (roleOf(p).kind === 'fake-heading' ? [i] : [])) : [];
    const topLevel = levels.length === 0 || options.unifyHeadings;
    const mark = topLevel && profile.h1Rule ? { location: 'Bottom' as const, color: profile.h1Rule }
      : !topLevel && levels.length === 1 && profile.h2Bar ? { location: 'Left' as const, color: profile.h2Bar } : null;
    if (on.headings && mark && chapterIndices.length) {
      const chapter = headingStyle('Custom', CHAPTER_STYLE, headingSize('fake', profile, options.unifyHeadings, levels), false);
      styleUpdates.push({ ...chapter, name: CHAPTER_STYLE, create: true, apply: chapterIndices, border: mark });
    }
  }
  // An update with nothing in it is left out
  const usefulStyles = styleUpdates.filter(u => Object.keys(u.font).length || Object.keys(u.paragraph ?? {}).length || u.border);
  counts.styles = usefulStyles.length;

  const terms = on.terms ? planTermEmphasis(audit) : { emphasis: { definitions: [], usages: [] }, quoteFixes: new Map<number, Replacement[]>() };
  const textFixes: TextFix[] = [];
  if (TEXT_CATEGORIES.some(c => c !== 'emptyParagraphs' && c !== 'allEmpty' && c !== 'doubleSpaces' && on[c])) {
    audit.paragraphs.forEach((p, index) => {
      if (!p.text.trim()) return;
      const md = on.markdown ? markdownFixes(p.text) : { replacements: [], bold: [], italic: [] };
      const replacements = [
        ...(terms.quoteFixes.get(index) ?? []),
        ...md.replacements,
        ...(on.dashes ? dashFixes(p.text) : []),
        ...(on.ranges ? rangeFixes(p.text) : []),
        ...(on.punctuation ? punctuationFixes(p.text) : []),
        ...(on.quotes ? englishQuoteFixes(p.text) : []),
        ...(on.nbsp ? nbspFixes(p.text) : []),
      ];
      const fix: TextFix = { index, replacements, quotes: on.quotes ? quoteFixes(p.text) : [], bold: md.bold, italic: md.italic };
      if (replacements.length || fix.quotes.length || fix.bold.length || fix.italic.length) textFixes.push(fix);
    });
  }
  counts.nbsp = on.nbsp ? summary.nbsp : 0;
  counts.quotes = on.quotes ? summary.straightQuotes : 0;
  counts.dashes = on.dashes ? summary.dashes : 0;
  counts.ranges = on.ranges ? summary.ranges : 0;
  counts.punctuation = on.punctuation ? summary.punctuation : 0;
  counts.markdown = on.markdown ? summary.markdown : 0;
  counts.terms = terms.emphasis.definitions.length;

  // Every empty line (the spacing takes over), or only the repeated ones
  const deleteEmpty = on.allEmpty ? summary.allEmpty : on.emptyParagraphs ? summary.extraEmpty : [];
  counts.allEmpty = on.allEmpty ? deleteEmpty.length : 0;
  counts.emptyParagraphs = !on.allEmpty && on.emptyParagraphs ? deleteEmpty.length : 0;
  counts.doubleSpaces = on.doubleSpaces ? summary.doubleSpaces : 0;
  return { changes, footnotes, deleteEmpty, doubleSpaces: counts.doubleSpaces > 0, styleUpdates: usefulStyles, textFixes, termEmphasis: terms.emphasis, keepWithNextStyles, margins, counts };
}

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  /** Shown first and marked as recommended */
  featured?: boolean;
  profile: FormatProfile;
}

/** Ready-made looks; "Ebből a dokumentumból" (the document's own most common settings) stays the default */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'executive',
    name: 'ICT Europa Executive',
    description: 'Cambria 11 pt grafit szöveg, kiskapitális sötétkék címek, kék vonal a főcím alatt, kék csík a második szint mellett',
    featured: true,
    profile: {
      font: 'Cambria', bodySize: 11, headingSize: 14, footnoteSize: 9, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 8,
      headingSpaceBefore: 18, headingSpaceAfter: 6, lineSpacing: 14.5, firstLineIndent: 0, leftIndent: 0, rightIndent: 0,
      headingColor: '#0B3B60', headingSmallCaps: true, h1Rule: '#2E75B6', h2Bar: '#2E75B6', bodyColor: '#1A1A1A',
      marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Justified',
    },
  },
  {
    id: 'classic',
    name: 'Klasszikus',
    description: 'Garamond 12 pt, sorkizárt, egyenletes, hagyományos szerződés',
    profile: { font: 'Garamond', bodySize: 12, headingSize: 14, footnoteSize: 10, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 6, headingSpaceBefore: 14, headingSpaceAfter: 6, lineSpacing: 14.4, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '', headingSmallCaps: false, h1Rule: '', h2Bar: '', bodyColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Justified' },
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Calibri 11 pt, balra zárt, levegős térközökkel',
    profile: { font: 'Calibri', bodySize: 11, headingSize: 14, footnoteSize: 9, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 8, headingSpaceBefore: 16, headingSpaceAfter: 8, lineSpacing: 15.5, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '', headingSmallCaps: false, h1Rule: '', h2Bar: '', bodyColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Left' },
  },
  {
    id: 'compact',
    name: 'Kompakt',
    description: 'Arial 10 pt, sorkizárt, szűk térközök: hosszú szerződéshez, kevesebb oldal',
    profile: { font: 'Arial', bodySize: 10, headingSize: 11, footnoteSize: 8, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 4, headingSpaceBefore: 10, headingSpaceAfter: 4, lineSpacing: 12, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '', headingSmallCaps: false, h1Rule: '', h2Bar: '', bodyColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Justified' },
  },
  {
    id: 'premium',
    name: 'Prémium',
    description: 'Cambria 11 pt szöveg, Calibri címek, balra zárt, bőséges térközök: tanácsadói jelentések, ajánlatok',
    profile: { font: 'Cambria', bodySize: 11, headingSize: 14, footnoteSize: 9, headingFont: 'Calibri', bodySpaceBefore: 0, bodySpaceAfter: 8, headingSpaceBefore: 18, headingSpaceAfter: 8, lineSpacing: 15.5, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '#1F3864', headingSmallCaps: false, h1Rule: '', h2Bar: '', bodyColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Left' },
  },
  {
    id: 'legal',
    name: 'Jogi (angolszász)',
    description: 'Times New Roman 11 pt, sorkizárt, szűk, egyenletes térközök: nemzetközi szerződések',
    profile: { font: 'Times New Roman', bodySize: 11, headingSize: 12, footnoteSize: 9, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 6, headingSpaceBefore: 12, headingSpaceAfter: 6, lineSpacing: 13.2, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '', headingSmallCaps: false, h1Rule: '', h2Bar: '', bodyColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Justified' },
  },
];
