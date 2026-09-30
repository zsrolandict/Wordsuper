import { diffTokens, planParagraphEdits, splitParagraphs, tokenizeLikeWord, type DiffHunk } from './textDiff';
import { similarity } from './versionCompare';

/**
 * Edits of a whole document, paragraph by paragraph. The AI returns the full rewritten text; unchanged
 * paragraphs are left alone, changed ones get a word-level diff, and only really new or removed paragraphs are
 * inserted or deleted. So adding a signature block at the end touches nothing else.
 */
export type DocumentEditOp =
  /** Change words inside a paragraph of the document */
  | { type: 'edit'; paragraph: number; newText: string; hunks: DiffHunk[] }
  | { type: 'delete'; paragraph: number }
  /** New paragraphs after a paragraph of the document (-1: before the first one) */
  | { type: 'insert'; after: number; texts: string[] };

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const MIN_SIMILARITY = 0.5;
const MAX_PAIRING_CELLS = 250_000;

/** Operations in document order; empty paragraphs are ignored on both sides */
export function planDocumentEdits(oldParagraphs: string[], newText: string): DocumentEditOp[] {
  const newParagraphs = splitParagraphs(newText).filter(t => normalize(t));
  const oldIdx = oldParagraphs.map((_, i) => i).filter(i => normalize(oldParagraphs[i]));
  const oldKeys = oldIdx.map(i => normalize(oldParagraphs[i]));
  const newKeys = newParagraphs.map(normalize);

  const ops: DocumentEditOp[] = [];
  let oldPos = 0;
  let newPos = 0;
  for (const hunk of diffTokens(oldKeys, newKeys)) {
    newPos += hunk.oldStart - oldPos;
    const olds = oldIdx.slice(hunk.oldStart, hunk.oldEnd);
    const news = newParagraphs.slice(newPos, newPos + hunk.newTokens.length);

    // Greedy in-order pairing of similar paragraphs (block position of the new → of the old one)
    const pairs = new Map<number, number>();
    if (olds.length * news.length <= MAX_PAIRING_CELLS) {
      let from = 0;
      news.forEach((text, j) => {
        let best = -1;
        let bestScore = MIN_SIMILARITY;
        for (let i = from; i < olds.length; i++) {
          const score = similarity(oldParagraphs[olds[i]], text);
          if (score >= bestScore) {
            best = i;
            bestScore = score;
          }
        }
        if (best !== -1) {
          pairs.set(j, best);
          from = best + 1;
        }
      });
    } else {
      for (let j = 0; j < Math.min(olds.length, news.length); j++) pairs.set(j, j);
    }

    // New paragraphs go after the last document paragraph before them
    let lastOld = hunk.oldStart > 0 ? oldIdx[hunk.oldStart - 1] : -1;
    let pendingInsert: string[] = [];
    const flushInsert = () => {
      if (pendingInsert.length) ops.push({ type: 'insert', after: lastOld, texts: pendingInsert });
      pendingInsert = [];
    };
    let nextOld = 0;
    news.forEach((text, j) => {
      const pairedWith = pairs.get(j);
      if (pairedWith === undefined) {
        pendingInsert.push(text.trim());
        return;
      }
      flushInsert();
      for (; nextOld < pairedWith; nextOld++) ops.push({ type: 'delete', paragraph: olds[nextOld] });
      const paragraph = olds[pairedWith];
      const hunks = diffTokens(tokenizeLikeWord(oldParagraphs[paragraph]), tokenizeLikeWord(text));
      if (hunks.length) ops.push({ type: 'edit', paragraph, newText: text, hunks });
      lastOld = paragraph;
      nextOld = pairedWith + 1;
    });
    // Old paragraphs left over were removed; new ones still waiting go after the last kept paragraph
    for (; nextOld < olds.length; nextOld++) ops.push({ type: 'delete', paragraph: olds[nextOld] });
    flushInsert();

    oldPos = hunk.oldEnd;
    newPos += hunk.newTokens.length;
  }
  return ops;
}

export function summarizeDocumentEdits(ops: DocumentEditOp[]) {
  return {
    changed: ops.filter(op => op.type === 'edit').length,
    inserted: ops.reduce((n, op) => n + (op.type === 'insert' ? op.texts.length : 0), 0),
    deleted: ops.filter(op => op.type === 'delete').length,
  };
}

/**
 * The changes of an edit, word by word, as they will be applied: one entry per changed place (hunk), numbered in
 * document order. null when the paragraphs don't line up (then the proposal can only be taken as a whole).
 */
export function editHunks(original: string, proposal: string) {
  const paragraphs = splitParagraphs(original);
  const tokens = paragraphs.map(tokenizeLikeWord);
  const plan = planParagraphEdits(tokens, proposal);
  if (!plan) return null;
  let next = 0;
  const numbered = plan.map(edit => ({ ...edit, hunks: edit.hunks.map(hunk => ({ ...hunk, id: next++ })) }));
  return { paragraphs, tokens, plan: numbered, count: next };
}

/** The proposal with some of its changes left out: the excluded places keep the original words */
export function applyChosenHunks(original: string, proposal: string, excluded: Set<number>): string {
  if (!excluded.size) return proposal;
  const hunks = editHunks(original, proposal);
  if (!hunks) return proposal;
  const result = [...hunks.paragraphs];
  for (const edit of hunks.plan) {
    const chosen = edit.hunks.filter(h => !excluded.has(h.id));
    // A paragraph with none of its changes chosen keeps its original text as is
    if (!chosen.length) continue;
    const words = [...hunks.tokens[edit.paragraphIndex]];
    // Last to first, so the positions of earlier changes stay valid
    for (const h of [...chosen].reverse()) words.splice(h.oldStart, h.oldEnd - h.oldStart, ...h.newTokens);
    result[edit.paragraphIndex] = words.join(' ');
  }
  return result.join('\n');
}

/** The whole document with only the chosen operations applied (by their index in the plan) */
export function composeDocument(oldParagraphs: string[], ops: DocumentEditOp[], excluded: Set<number>): string {
  const chosen = ops.map((op, i) => ({ op, i })).filter(({ i }) => !excluded.has(i)).map(({ op }) => op);
  const out: string[] = [];
  const insertsAfter = (index: number) => chosen.forEach(op => { if (op.type === 'insert' && op.after === index) out.push(...op.texts); });
  insertsAfter(-1);
  oldParagraphs.forEach((text, index) => {
    const own = chosen.find(op => op.type !== 'insert' && op.paragraph === index);
    if (!own) out.push(text);
    else if (own.type === 'edit') out.push(own.newText);
    // a chosen delete leaves the paragraph out
    insertsAfter(index);
  });
  return out.join('\n');
}
