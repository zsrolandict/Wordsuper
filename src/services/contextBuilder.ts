import { toLineFeeds } from '../shared/aiConfig';

/** What part of the document the AI received as context; shown in the limits bar and the details panel */
export interface ContextInfo {
  documentChars: number;
  sentChars: number;
  limit: number;
  /**
   * full: the whole document fit.
   * excerpts: too long, so the beginning, the headings and the surroundings of the selection were sent.
   * truncated: too long for a whole-document review, only the beginning was sent.
   */
  strategy: 'empty' | 'full' | 'excerpts' | 'truncated';
  beginningChars?: number;
  headingCount?: number;
  totalHeadings?: number;
  /** Character range of the document sent around the selection (0-based, end exclusive) */
  windowStart?: number;
  windowEnd?: number;
  /** Version comparison: how many of the changes fit into the request */
  includedItems?: number;
  totalItems?: number;
}

interface BuildOptions {
  documentText: string;
  /** Offset of the selection inside documentText */
  selectionStart: number;
  selectionLength: number;
  headings: string[];
  limit: number;
  /** Whole-document review: excerpts make no sense, send the beginning */
  wholeDocument?: boolean;
}

const OMITTED = '[… omitted …]';
// Room for the === headers and omission markers
const OVERHEAD_CHARS = 400;

const formatRange = (start: number, end: number, total: number) => `characters ${start + 1}–${end} of ${total}`;

export function buildDocumentContext({ documentText, selectionStart, selectionLength, headings, limit, wholeDocument }: BuildOptions): { text: string; info: ContextInfo } {
  // The AI reads \n as line breaks; Word uses a lone \r for paragraphs, so the offsets stay valid
  const doc = toLineFeeds(documentText);
  const total = doc.length;

  if (total === 0) {
    return { text: '', info: { documentChars: 0, sentChars: 0, limit, strategy: 'empty' } };
  }
  if (total <= limit) {
    return { text: doc, info: { documentChars: total, sentChars: total, limit, strategy: 'full' } };
  }
  if (wholeDocument) {
    const text = doc.substring(0, limit);
    return { text, info: { documentChars: total, sentChars: text.length, limit, strategy: 'truncated' } };
  }

  // Beginning: parties, definitions and the subject of a contract usually live here
  let beginningChars = Math.floor(Math.min(4000, limit * 0.1));

  // Outline: headings until their budget runs out
  const outlineBudget = Math.floor(Math.min(4000, limit * 0.1));
  const outlineLines: string[] = [];
  let outlineChars = 0;
  for (const heading of headings) {
    const line = `- ${heading.trim()}`;
    if (!heading.trim()) continue;
    if (outlineChars + line.length + 1 > outlineBudget) break;
    outlineLines.push(line);
    outlineChars += line.length + 1;
  }

  // Window around the selection gets everything that's left, 60% before and 40% after it
  const selStart = Math.min(Math.max(0, selectionStart), total);
  const selEnd = Math.min(total, selStart + Math.max(0, selectionLength));
  let windowBudget = limit - beginningChars - outlineChars - OVERHEAD_CHARS;

  let windowStart: number;
  let windowEnd: number;
  const place = () => {
    const rest = Math.max(0, windowBudget - (selEnd - selStart));
    const before = Math.floor(rest * 0.6);
    const after = rest - before;
    windowStart = selStart - before;
    windowEnd = selEnd + after;
    // Budget that falls off one end of the document goes to the other side
    if (windowStart < 0) { windowEnd += -windowStart; windowStart = 0; }
    if (windowEnd > total) { windowStart = Math.max(0, windowStart - (windowEnd - total)); windowEnd = total; }
    windowEnd = Math.min(windowEnd, windowStart + windowBudget);
  };
  place();

  // The window already reaches the beginning: merge them and give the beginning's budget to the window
  if (windowStart! <= beginningChars) {
    windowBudget += beginningChars;
    beginningChars = 0;
    place();
  }

  const sections: string[] = [];
  if (beginningChars > 0) {
    sections.push(`=== DOCUMENT BEGINNING (${formatRange(0, beginningChars, total)}) ===\n${doc.substring(0, beginningChars)}`);
  }
  if (outlineLines.length) {
    sections.push(`=== DOCUMENT OUTLINE (headings) ===\n${outlineLines.join('\n')}`);
  }
  sections.push(
    `=== AROUND THE SELECTION (${formatRange(windowStart!, windowEnd!, total)}) ===\n` +
    (windowStart! > 0 ? `${OMITTED}\n` : '') +
    doc.substring(windowStart!, windowEnd!) +
    (windowEnd! < total ? `\n${OMITTED}` : '')
  );

  const text = sections.join('\n\n').substring(0, limit);
  return {
    text,
    info: {
      documentChars: total,
      sentChars: text.length,
      limit,
      strategy: 'excerpts',
      beginningChars,
      headingCount: outlineLines.length,
      totalHeadings: headings.filter(h => h.trim()).length,
      windowStart: windowStart!,
      windowEnd: windowEnd!,
    },
  };
}
