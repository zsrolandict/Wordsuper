import { MAX_SELECTION_CHARS, contextLimitFor, type Mode, type ReviewFinding } from '../shared/aiConfig';
import { buildDocumentContext, type ContextInfo } from './contextBuilder';
import { planParagraphEdits, tokenizeLikeWord, type DiffHunk } from './textDiff';
import { searchCandidates } from './review';
import { formatNumber } from './format';

/** An error whose message is meant for the user as is */
export class UserFacingError extends Error {}

export interface DocumentSnapshot {
  /** The selection, tracked so it stays valid across Word.run calls until releaseRange */
  range: Word.Range | null;
  selectionText: string;
  documentContext: string;
  contextInfo: ContextInfo;
}

const isHeading = (p: Word.Paragraph) =>
  p.styleBuiltIn === 'Title' || p.styleBuiltIn.startsWith('Heading') || /^(heading|címsor)/i.test(p.style);

/** Reads what the AI needs for a request and starts tracking the selection */
export async function takeSnapshot(mode: Mode): Promise<DocumentSnapshot> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const body = context.document.body;
    selection.load('text');
    body.load('text');
    await context.sync();

    const selectionText = selection.text || '';
    const documentText = body.text || '';

    if ((mode === 'edit' || mode === 'comment') && !selectionText.trim()) {
      throw new UserFacingError('Kérlek előbb jelölj ki egy szövegrészt a Word dokumentumban!');
    }
    // Szerkesztésnél a teljes kijelölés lecserélődik, de az AI csak az elejét kapja meg – a vége elveszne
    if (mode === 'edit' && selectionText.length > MAX_SELECTION_CHARS) {
      throw new UserFacingError(`A kijelölés túl hosszú (${formatNumber(selectionText.length)} karakter). Szerkesztésnél egyszerre legfeljebb ${formatNumber(MAX_SELECTION_CHARS)} karaktert tudok átírni, különben a kijelölés vége elveszne. Jelölj ki kisebb részt!`);
    }

    const limit = contextLimitFor(mode);
    let headings: string[] = [];
    let selectionStart = 0;
    // Only long documents need the outline and the position of the selection
    if (documentText.length > limit && mode !== 'review') {
      const paragraphs = body.paragraphs;
      paragraphs.load('items/text,items/styleBuiltIn,items/style');
      await context.sync();
      headings = paragraphs.items.filter(isHeading).map(p => p.text);

      try {
        const before = body.getRange('Start').expandTo(selection.getRange('Start'));
        before.load('text');
        await context.sync();
        selectionStart = before.text.length;
      } catch {
        // E.g. the selection is in a header or a footnote: locate it by its text instead
        selectionStart = Math.max(0, documentText.indexOf(selectionText));
      }
    }

    const { text, info } = buildDocumentContext({
      documentText,
      selectionStart,
      selectionLength: selectionText.length,
      headings,
      limit,
      wholeDocument: mode === 'review',
    });

    let range: Word.Range | null = null;
    if (mode !== 'review') {
      context.trackedObjects.add(selection);
      await context.sync();
      range = selection;
    }

    return { range, selectionText, documentContext: text, contextInfo: info };
  });
}

/** Stops tracking a snapshot's selection; harmless if it is already gone */
export async function releaseRange(range: Word.Range | null) {
  if (!range) return;
  try {
    await Word.run(range, async (context) => {
      context.trackedObjects.remove(range);
      await context.sync();
    });
  } catch {
    // Nothing left to release
  }
}

/**
 * Releases a tracked range once its change is in the document. A failure here must not look like a failed
 * change, otherwise a retry would apply it twice.
 */
async function untrack(context: Word.RequestContext, range: Word.Range) {
  try {
    context.trackedObjects.remove(range);
    await context.sync();
  } catch {
    // The change already landed; the range is released when the session ends
  }
}

/** Runs a change with Track Changes on, then restores the user's own setting */
async function withTrackChanges(context: Word.RequestContext, queueChanges: () => void) {
  const doc = context.document;
  doc.load('changeTrackingMode');
  await context.sync();
  const previous = doc.changeTrackingMode;
  doc.changeTrackingMode = 'TrackAll';
  try {
    queueChanges();
    await context.sync();
  } finally {
    doc.changeTrackingMode = previous;
    await context.sync();
  }
}

/** Replaces one hunk of words; words are the ranges from getTextRanges([' '], true) */
function applyHunk(words: Word.Range[], hunk: DiffHunk) {
  const text = hunk.newTokens.join(' ');
  const count = words.length;
  if (hunk.oldEnd > hunk.oldStart) {
    const first = words[hunk.oldStart];
    const last = words[hunk.oldEnd - 1];
    if (text) {
      first.expandTo(last).insertText(text, 'Replace');
    } else if (hunk.oldEnd < count) {
      // Take the following space along, so no double space is left behind
      first.expandTo(words[hunk.oldEnd].getRange('Start')).delete();
    } else if (hunk.oldStart > 0) {
      words[hunk.oldStart - 1].getRange('End').expandTo(last).delete();
    } else {
      first.expandTo(last).delete();
    }
  } else if (hunk.oldStart < count) {
    words[hunk.oldStart].insertText(`${text} `, 'Before');
  } else {
    words[count - 1].insertText(` ${text}`, 'After');
  }
}

export interface EditOutcome {
  /**
   * words: only the changed words were replaced, everything else kept its formatting.
   * replace: the whole selection was replaced (paragraphs changed, or the selection starts mid-paragraph).
   * unchanged: the proposal equals the original.
   */
  strategy: 'words' | 'replace' | 'unchanged';
  changedPlaces: number;
}

/**
 * Applies an edit with Track Changes, touching only the words that changed where possible.
 * That keeps bold, italics, lists and styles of everything the AI didn't change.
 */
export async function applyEdit(range: Word.Range, newText: string): Promise<EditOutcome> {
  return Word.run(range, async (context) => {
    range.load('text');
    const paragraphs = range.paragraphs;
    paragraphs.load('items/text');
    await context.sync();

    // Which ranges can be diffed word by word: the selection itself inside one paragraph, or whole paragraphs
    const selectionText = range.text.replace(/\r$/, '');
    let segments: { getTextRanges: Word.Range['getTextRanges'] }[] | null = null;
    let segmentTexts: string[] = [];
    if (!selectionText.includes('\r')) {
      segments = [range];
      segmentTexts = [selectionText];
    } else if (paragraphs.items.map(p => p.text).join('\r') === selectionText) {
      segments = paragraphs.items;
      segmentTexts = paragraphs.items.map(p => p.text);
    }

    let wordCollections: Word.RangeCollection[] = [];
    let plan: ReturnType<typeof planParagraphEdits> = null;
    if (segments) {
      try {
        wordCollections = segments.map(segment => segment.getTextRanges([' '], true));
        wordCollections.forEach(collection => collection.load('items/text'));
        await context.sync();

        const oldTokens = wordCollections.map(collection => collection.items.map(word => word.text));
        // Only trust the word ranges when Word split them the same way we would
        const consistent = oldTokens.every((tokens, i) => tokens.join('\u0000') === tokenizeLikeWord(segmentTexts[i]).join('\u0000'));
        plan = consistent ? planParagraphEdits(oldTokens, newText) : null;
      } catch {
        // Nothing was changed yet: fall back to replacing the whole selection
        plan = null;
      }
    }

    if (plan) {
      if (plan.length === 0) {
        await untrack(context, range);
        return { strategy: 'unchanged', changedPlaces: 0 };
      }
      await withTrackChanges(context, () => {
        // Last to first, so earlier word ranges are not shifted by later edits
        for (const edit of [...plan].reverse()) {
          const words = wordCollections[edit.paragraphIndex].items;
          for (const hunk of [...edit.hunks].reverse()) applyHunk(words, hunk);
        }
      });
      await untrack(context, range);
      return { strategy: 'words', changedPlaces: plan.reduce((sum, edit) => sum + edit.hunks.length, 0) };
    }

    await withTrackChanges(context, () => {
      range.insertText(newText, 'Replace');
    });
    await untrack(context, range);
    return { strategy: 'replace', changedPlaces: 1 };
  });
}

/** Inserts generated text at the tracked selection (replacing it, if there was one) */
export async function insertGenerated(range: Word.Range, text: string) {
  await Word.run(range, async (context) => {
    range.insertText(text, 'Replace');
    await context.sync();
    await untrack(context, range);
  });
}

export async function insertCommentAt(range: Word.Range, text: string) {
  await Word.run(range, async (context) => {
    range.insertComment(text);
    await context.sync();
    await untrack(context, range);
  });
}

export interface ReviewInsertOutcome {
  inserted: number;
  notFound: ReviewFinding[];
}

/** Finds each quote in the document and attaches its comment there */
export async function insertReviewComments(findings: ReviewFinding[]): Promise<ReviewInsertOutcome> {
  return Word.run(async (context) => {
    const body = context.document.body;
    // All searches go out in one batch
    const searches = findings.map(finding =>
      searchCandidates(finding.quote).map(candidate => {
        const results = body.search(candidate, { matchCase: false });
        results.load('items/text');
        return results;
      })
    );
    await context.sync();

    const notFound: ReviewFinding[] = [];
    let inserted = 0;
    findings.forEach((finding, i) => {
      // The full quote is exact, so its first match is right. A shorter prefix is only trusted when it occurs
      // exactly once: otherwise the comment could land on an unrelated, earlier sentence.
      const hit = searches[i].find((results, k) => (k === 0 ? results.items.length > 0 : results.items.length === 1));
      if (hit) {
        hit.items[0].insertComment(finding.comment);
        inserted++;
      } else {
        notFound.push(finding);
      }
    });
    await context.sync();
    return { inserted, notFound };
  });
}

export async function readSelectionLength(): Promise<number> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    selection.load('text');
    await context.sync();
    return (selection.text || '').length;
  });
}

/** Reads the whole body over the Office bridge, so callers should do it sparingly */
export async function readDocumentLength(): Promise<number> {
  return Word.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    return (body.text || '').length;
  });
}

/** Subscribes to selection changes in the document; returns the unsubscribe function */
export function onSelectionChanged(handler: () => void): () => void {
  const document = typeof Office !== 'undefined' ? Office.context?.document : undefined;
  if (!document?.addHandlerAsync) return () => {};
  document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, handler);
  return () => document.removeHandlerAsync(Office.EventType.DocumentSelectionChanged, { handler });
}
