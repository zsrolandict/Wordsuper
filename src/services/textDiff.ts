import { toLineFeeds } from '../shared/aiConfig';

/** A run of changed tokens: old[oldStart, oldEnd) is replaced by newTokens (either side may be empty) */
export interface DiffHunk {
  oldStart: number;
  oldEnd: number;
  newTokens: string[];
}

// Above this many LCS cells the middle part is treated as one big change instead (keeps the pane responsive)
const MAX_LCS_CELLS = 4_000_000;

/** Longest-common-subsequence diff of two token lists, returned as the changed hunks only */
export function diffTokens(oldTokens: string[], newTokens: string[]): DiffHunk[] {
  // Common prefix and suffix are cheap to strip and usually cover most of the text
  let prefix = 0;
  while (prefix < oldTokens.length && prefix < newTokens.length && oldTokens[prefix] === newTokens[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldTokens.length - prefix &&
    suffix < newTokens.length - prefix &&
    oldTokens[oldTokens.length - 1 - suffix] === newTokens[newTokens.length - 1 - suffix]
  ) suffix++;

  const a = oldTokens.slice(prefix, oldTokens.length - suffix);
  const b = newTokens.slice(prefix, newTokens.length - suffix);
  if (a.length === 0 && b.length === 0) return [];

  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_LCS_CELLS) {
    return [{ oldStart: prefix, oldEnd: prefix + n, newTokens: b }];
  }

  // lcs[i * (m + 1) + j] = LCS length of a[i..] and b[j..]
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = a[i] === b[j]
        ? lcs[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
    }
  }

  const hunks: DiffHunk[] = [];
  let open: { i: number; j: number } | null = null;
  const close = (i: number, j: number) => {
    if (!open) return;
    hunks.push({ oldStart: prefix + open.i, oldEnd: prefix + i, newTokens: b.slice(open.j, j) });
    open = null;
  };

  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close(i, j);
      i++;
      j++;
    } else {
      if (!open) open = { i, j };
      if (j >= m || (i < n && lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1])) i++;
      else j++;
    }
  }
  close(i, j);
  return hunks;
}

/** Word separates paragraphs with \r, the AI with \n */
export const splitParagraphs = (text: string) => text.split(/\r\n|\r|\n/);

// What getTextRanges(..., trimSpacing: true) trims: spaces, tabs, paragraph and line marks – not non-breaking spaces
const WORD_SPACING = /^[ \t\r\n\v\f]+|[ \t\r\n\v\f]+$/g;

/**
 * Mirrors Word's getTextRanges([' '], true): split on spaces only, trim spacing from both ends of each word.
 * Used for both the document and the AI's answer, so an unchanged tab or non-breaking space is never a "change".
 */
/**
 * Word puts invisible marks into range text (comment and field anchors show up as control characters).
 * They are dropped from what the AI sees, and ignored when comparing words.
 */
/**
 * Word's invisible marks (anchors, optional hyphens) and invisible format characters pasted from the web (soft
 * hyphen, zero-width spaces and joiners): they split words, so names and identifiers would not be recognized.
 */
export const stripControlChars = (text: string) => text.replace(/[\u0000-\u0008\u000e-\u001f\u00ad\u200b-\u200d\u2060\ufeff]/g, '');

export const tokenizeLikeWord = (text: string) => text.split(' ').map(t => t.replace(WORD_SPACING, '')).filter(Boolean);

export interface ParagraphEdit {
  /** Index among the given paragraphs */
  paragraphIndex: number;
  hunks: DiffHunk[];
}

/**
 * Pairs the old paragraphs (as Word tokenized them) with the new text's paragraphs and diffs them word by word.
 * Empty paragraphs are left alone. Returns null when the paragraph count changed, so the words can't be paired.
 */
export function planParagraphEdits(oldParagraphTokens: string[][], newText: string): ParagraphEdit[] | null {
  const oldIndexes = oldParagraphTokens.map((tokens, index) => ({ tokens, index })).filter(p => p.tokens.length > 0);
  const newParagraphs = splitParagraphs(newText).map(tokenizeLikeWord).filter(tokens => tokens.length > 0);
  if (oldIndexes.length !== newParagraphs.length) return null;

  const edits: ParagraphEdit[] = [];
  oldIndexes.forEach(({ tokens, index }, k) => {
    const hunks = diffTokens(tokens, newParagraphs[k]);
    if (hunks.length) edits.push({ paragraphIndex: index, hunks });
  });
  return edits;
}

export type DisplaySegment = { type: 'equal' | 'removed' | 'added'; tokens: string[] };

/** Word-level diff for showing a proposal: tokens are words and line breaks */
export function diffForDisplay(oldText: string, newText: string): DisplaySegment[] | null {
  const tokenize = (text: string) => toLineFeeds(text).match(/\n+|[^\s]+/g) ?? [];
  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);
  if ((oldTokens.length + 1) * (newTokens.length + 1) > MAX_LCS_CELLS) return null;

  const segments: DisplaySegment[] = [];
  const push = (type: DisplaySegment['type'], tokens: string[]) => {
    if (!tokens.length) return;
    const last = segments[segments.length - 1];
    if (last?.type === type) last.tokens.push(...tokens);
    else segments.push({ type, tokens: [...tokens] });
  };

  let position = 0;
  for (const hunk of diffTokens(oldTokens, newTokens)) {
    push('equal', oldTokens.slice(position, hunk.oldStart));
    push('removed', oldTokens.slice(hunk.oldStart, hunk.oldEnd));
    push('added', hunk.newTokens);
    position = hunk.oldEnd;
  }
  push('equal', oldTokens.slice(position));
  return segments;
}
