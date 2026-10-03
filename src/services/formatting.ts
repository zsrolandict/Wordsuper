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
  | { kind: 'title' }
  | { kind: 'heading'; level: number }
  /** Not a heading style, but looks like one: short, bold or all capitals, no closing punctuation */
  | { kind: 'fake-heading' }
  | { kind: 'table' }
  | { kind: 'body' };

const HEADING = /^Heading(\d)$/;
const FAKE_HEADING_MAX_CHARS = 100;

export function roleOf(p: ParagraphFormat): Role {
  const text = p.text.trim();
  if (!text) return { kind: 'empty' };
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
  /** Places with two or more spaces in a row */
  doubleSpaces: number;
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
  const extraEmpty = audit.paragraphs
    .map((p, i) => i)
    .filter(i => i > 0 && i < audit.paragraphs.length - 1 && roles[i].kind === 'empty' && roles[i - 1].kind === 'empty'
      && !audit.paragraphs[i].tableLevel && !audit.paragraphs[i - 1].tableLevel);
  const alignments = tally(body.map(p => p.alignment).filter(a => a === 'Left' || a === 'Justified'));
  return {
    fonts,
    sizes,
    spacings: new Set(body.map(p => `${round(p.spaceBefore)}/${round(p.spaceAfter)}/${round(p.lineSpacing)}`)).size,
    headingLevels: tally(roles.flatMap(r => (r.kind === 'heading' ? [r.level] : []))).sort((a, b) => a[0] - b[0]),
    fakeHeadings: audit.paragraphs.filter((_, i) => roles[i].kind === 'fake-heading').map(p => p.text.trim()),
    titles: roles.filter(r => r.kind === 'title').length,
    extraEmpty,
    doubleSpaces: audit.paragraphs.reduce((n, p, i) => n + (roles[i].kind === 'empty' ? 0 : (p.text.match(/ {2,}/g)?.length ?? 0)), 0),
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
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
    marginRight: 0,
    alignment: summary.dominant.alignment,
  };
}

export type Category = 'font' | 'size' | 'headings' | 'footnotes' | 'spacing' | 'alignment' | 'color' | 'indent' | 'pagination' | 'margins' | 'emptyParagraphs' | 'doubleSpaces';

export interface FormatOptions {
  categories: Record<Category, boolean>;
  /** Bold or all-capital short lines without a heading style are formatted as headings */
  fakeHeadings: boolean;
  /** All headings the same size (they are really one level); false: sizes step down by level */
  unifyHeadings: boolean;
}

/** Changes the formatting only: the text is never touched by these */
export const FORMAT_CATEGORIES: Category[] = ['font', 'size', 'headings', 'footnotes', 'spacing', 'alignment', 'color', 'indent', 'pagination', 'margins'];
/** These change the text (so they go in like any other text change, by the Track Changes rule) */
export const TEXT_CATEGORIES: Category[] = ['emptyParagraphs', 'doubleSpaces'];

export const defaultOptions = (): FormatOptions => ({
  categories: { font: true, size: true, headings: true, footnotes: true, spacing: true, alignment: true, color: true, indent: true, pagination: true, margins: true, emptyParagraphs: false, doubleSpaces: false },
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
  alignment?: 'Left' | 'Justified';
}

export interface FormatPlan {
  changes: ParagraphChange[];
  footnotes: { font?: string; size?: number } | null;
  /** Paragraphs to delete (the extra empty lines) */
  deleteEmpty: number[];
  doubleSpaces: boolean;
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
    if (role.kind === 'empty') return;
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
      if (role.kind !== 'title') {
        set('spacing', 'spaceBefore', profile.headingSpaceBefore, differs(p.spaceBefore, profile.headingSpaceBefore));
        set('spacing', 'spaceAfter', profile.headingSpaceAfter, differs(p.spaceAfter, profile.headingSpaceAfter));
      }
    } else {
      set('size', 'size', profile.bodySize, differs(p.size, profile.bodySize));
      // Table cells: only the font, so the table keeps its own layout
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

  const deleteEmpty = on.emptyParagraphs ? summary.extraEmpty : [];
  counts.emptyParagraphs = deleteEmpty.length;
  counts.doubleSpaces = on.doubleSpaces ? summary.doubleSpaces : 0;
  return { changes, footnotes, deleteEmpty, doubleSpaces: counts.doubleSpaces > 0, keepWithNextStyles, margins, counts };
}

export interface StylePreset {
  id: string;
  name: string;
  description: string;
  profile: FormatProfile;
}

/** Ready-made looks; "Ebből a dokumentumból" (the document's own most common settings) stays the default */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'classic',
    name: 'Klasszikus',
    description: 'Garamond 12 pt, sorkizárt, egyenletes, hagyományos szerződés',
    profile: { font: 'Garamond', bodySize: 12, headingSize: 14, footnoteSize: 10, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 6, headingSpaceBefore: 14, headingSpaceAfter: 6, lineSpacing: 14.4, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Justified' },
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Calibri 11 pt, balra zárt, levegős térközökkel',
    profile: { font: 'Calibri', bodySize: 11, headingSize: 14, footnoteSize: 9, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 8, headingSpaceBefore: 16, headingSpaceAfter: 8, lineSpacing: 15.5, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Left' },
  },
  {
    id: 'compact',
    name: 'Kompakt',
    description: 'Arial 10 pt, sorkizárt, szűk térközök: hosszú szerződéshez, kevesebb oldal',
    profile: { font: 'Arial', bodySize: 10, headingSize: 11, footnoteSize: 8, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 4, headingSpaceBefore: 10, headingSpaceAfter: 4, lineSpacing: 12, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Justified' },
  },
  {
    id: 'premium',
    name: 'Prémium',
    description: 'Cambria 11 pt szöveg, Calibri címek, balra zárt, bőséges térközök: tanácsadói jelentések, ajánlatok',
    profile: { font: 'Cambria', bodySize: 11, headingSize: 14, footnoteSize: 9, headingFont: 'Calibri', bodySpaceBefore: 0, bodySpaceAfter: 8, headingSpaceBefore: 18, headingSpaceAfter: 8, lineSpacing: 15.5, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '#1F3864', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Left' },
  },
  {
    id: 'legal',
    name: 'Jogi (angolszász)',
    description: 'Times New Roman 11 pt, sorkizárt, szűk, egyenletes térközök: nemzetközi szerződések',
    profile: { font: 'Times New Roman', bodySize: 11, headingSize: 12, footnoteSize: 9, headingFont: '', bodySpaceBefore: 0, bodySpaceAfter: 6, headingSpaceBefore: 12, headingSpaceAfter: 6, lineSpacing: 13.2, firstLineIndent: 0, leftIndent: 0, rightIndent: 0, headingColor: '', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, alignment: 'Justified' },
  },
];
