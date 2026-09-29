import { SEVERITY_VALUES, type Severity } from '../shared/aiConfig';
import { diffTokens } from './textDiff';

export interface VersionChange {
  id: number;
  type: 'modified' | 'added' | 'removed';
  /** Empty for added paragraphs */
  oldText: string;
  /** Empty for removed paragraphs */
  newText: string;
  /**
   * Paragraph index in the current document: the modified or added paragraph, or for a removed one the
   * paragraph that now stands where it was (so a comment can be attached there).
   */
  paragraph: number;
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Share of common words (Dice coefficient over word multisets), 0..1 */
export function similarity(a: string, b: string): number {
  const words = (s: string) => normalize(s).toLowerCase().split(' ').filter(Boolean);
  const wa = words(a);
  const wb = words(b);
  if (!wa.length || !wb.length) return 0;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) {
    const n = counts.get(w) ?? 0;
    if (n > 0) {
      common++;
      counts.set(w, n - 1);
    }
  }
  return (2 * common) / (wa.length + wb.length);
}

const MIN_SIMILARITY = 0.5;
// Pairing inside one changed block compares every old paragraph with every new one; above this, pair by position
const MAX_PAIRING_CELLS = 250_000;

/**
 * Paragraph-level comparison of an earlier and the current version. Unchanged paragraphs are matched first
 * (longest common subsequence); inside each changed block, paragraphs that still share at least half of their
 * words count as modified, the rest as removed or added. Empty paragraphs are ignored.
 */
export function compareVersions(oldParagraphs: string[], newParagraphs: string[]): VersionChange[] {
  const oldIdx = oldParagraphs.map((t, i) => i).filter(i => normalize(oldParagraphs[i]));
  const newIdx = newParagraphs.map((t, i) => i).filter(i => normalize(newParagraphs[i]));
  const oldKeys = oldIdx.map(i => normalize(oldParagraphs[i]));
  const newKeys = newIdx.map(i => normalize(newParagraphs[i]));

  const changes: Omit<VersionChange, 'id'>[] = [];
  // Where a removed paragraph goes: the next current paragraph, or the last one at the end of the document
  const anchor = (k: number) => (k < newIdx.length ? newIdx[k] : newIdx[newIdx.length - 1] ?? 0);

  // diffTokens reports hunks in old-token positions; track the new-side position alongside
  let oldPos = 0;
  let newPos = 0;
  for (const hunk of diffTokens(oldKeys, newKeys)) {
    newPos += hunk.oldStart - oldPos;
    const olds = oldIdx.slice(hunk.oldStart, hunk.oldEnd);
    const news = newIdx.slice(newPos, newPos + hunk.newTokens.length);
    const newStart = newPos;

    // Greedy in-order pairing: each new paragraph takes the most similar unpaired old one after the last pair
    const pairs = new Map<number, number>(); // new position in block → old position in block
    if (olds.length * news.length <= MAX_PAIRING_CELLS) {
      let from = 0;
      news.forEach((n, j) => {
        let best = -1;
        let bestScore = MIN_SIMILARITY;
        for (let i = from; i < olds.length; i++) {
          const score = similarity(oldParagraphs[olds[i]], newParagraphs[n]);
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

    // Emit in document order: removed old paragraphs before the new paragraph they preceded
    const pairedOld = new Set(pairs.values());
    let nextOld = 0;
    news.forEach((n, j) => {
      const pairedWith = pairs.get(j);
      const upTo = pairedWith ?? -1;
      for (; nextOld < upTo; nextOld++) {
        if (!pairedOld.has(nextOld)) changes.push({ type: 'removed', oldText: oldParagraphs[olds[nextOld]], newText: '', paragraph: n });
      }
      if (pairedWith !== undefined) {
        changes.push({ type: 'modified', oldText: oldParagraphs[olds[pairedWith]], newText: newParagraphs[n], paragraph: n });
        nextOld = pairedWith + 1;
      } else {
        changes.push({ type: 'added', oldText: '', newText: newParagraphs[n], paragraph: n });
      }
    });
    for (; nextOld < olds.length; nextOld++) {
      if (!pairedOld.has(nextOld)) {
        changes.push({ type: 'removed', oldText: oldParagraphs[olds[nextOld]], newText: '', paragraph: anchor(newStart + news.length) });
      }
    }

    oldPos = hunk.oldEnd;
    newPos += hunk.newTokens.length;
  }

  return changes.map((c, id) => ({ id: id + 1, ...c }));
}

const MAX_CHANGE_TEXT = 2000;
const cut = (text: string) => (text.length > MAX_CHANGE_TEXT ? `${text.slice(0, MAX_CHANGE_TEXT)} […]` : text);

/** The change list as the AI gets it; stops before the limit, and says how many changes fit */
export function formatChangesForAI(changes: VersionChange[], limit: number): { text: string; included: number } {
  const TYPE_LABEL = { modified: 'modified', added: 'added', removed: 'removed' };
  let text = '';
  let included = 0;
  for (const change of changes) {
    const block =
      `CHANGE ${change.id} (${TYPE_LABEL[change.type]}):\n` +
      (change.type !== 'added' ? `BEFORE: ${cut(change.oldText)}\n` : '') +
      (change.type !== 'removed' ? `AFTER: ${cut(change.newText)}\n` : '') +
      '\n';
    if (text.length + block.length > limit) break;
    text += block;
    included++;
  }
  return { text: text.trimEnd(), included };
}

export interface ChangeAssessment {
  summary: string;
  risk: Severity;
  recommendation: string;
}

export interface CompareResult {
  overview: string;
  assessments: Map<number, ChangeAssessment>;
}

/** Parses the AI's JSON answer; only ids of real changes are kept */
export function parseCompareResult(text: string, validIds: Set<number>): CompareResult | null {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const raw = data as { overview?: unknown; changes?: unknown };
  const assessments = new Map<number, ChangeAssessment>();
  for (const item of Array.isArray(raw.changes) ? raw.changes : []) {
    const id = Number(item?.id);
    if (!validIds.has(id) || typeof item.summary !== 'string') continue;
    assessments.set(id, {
      summary: item.summary.trim(),
      risk: (SEVERITY_VALUES as readonly unknown[]).includes(item.risk) ? item.risk : 'medium',
      recommendation: typeof item.recommendation === 'string' ? item.recommendation.trim() : '',
    });
  }
  return { overview: typeof raw.overview === 'string' ? raw.overview.trim() : '', assessments };
}
