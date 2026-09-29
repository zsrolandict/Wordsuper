import { MAX_SELECTION_CHARS, contextLimitFor, type Mode, type ReviewFinding } from '../shared/aiConfig';
import { buildDocumentContext, type ContextInfo } from './contextBuilder';
import { planParagraphEdits, stripControlChars, tokenizeLikeWord, type DiffHunk } from './textDiff';
import { reviewCommentText, reviewFix, searchCandidates } from './review';
import { planDocumentEdits, summarizeDocumentEdits, type DocumentEditOp } from './documentEdit';
import { formatNumber } from './format';
import { withAutoNumbers, type ParagraphInfo } from './structure';

/** An error whose message is meant for the user as is */
export class UserFacingError extends Error {}

export interface DocumentSnapshot {
  /** The selection, tracked so it stays valid across Word.run calls until releaseRange */
  range: Word.Range | null;
  selectionText: string;
  documentContext: string;
  contextInfo: ContextInfo;
  /**
   * Edit or comment without a selection: the whole document is the text to work on. Its paragraphs are kept
   * so that an edit is only applied if the document is still the same.
   */
  wholeDocument?: {
    /** As Word reports them (with text deleted by pending tracked changes), to detect later changes */
    paragraphs: string[];
    /** What the AI saw: pending tracked changes accepted, invisible marks removed */
    reviewed: string[];
  };
}

/**
 * The text as it reads with pending tracked changes accepted. range.text would also contain the deleted
 * words ("eladóiEladói"), which confuses the AI and the diff.
 */
const readable = (reviewed: string) => stripControlChars(reviewed);
const sameWords = (a: string, b: string) => stripControlChars(a).replace(/\s+/g, ' ').trim() === stripControlChars(b).replace(/\s+/g, ' ').trim();

const isHeading = (p: Word.Paragraph) =>
  p.styleBuiltIn === 'Title' || p.styleBuiltIn.startsWith('Heading') || /^(heading|címsor)/i.test(p.style);

/** Reads what the AI needs for a request and starts tracking the selection */
export async function takeSnapshot(mode: Mode): Promise<DocumentSnapshot> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const body = context.document.body;
    const selectionReviewed = selection.getReviewedText('Current');
    const bodyReviewed = body.getReviewedText('Current');
    await context.sync();

    const selectionText = readable(selectionReviewed.value || '');
    let documentText = readable(bodyReviewed.value || '');
    // A review sees Word's automatic numbering too, so it can check numbering and cross-references
    if (mode === 'review') documentText = await numberedDocumentText(context) ?? documentText;

    // Nothing selected: edit or comment on the whole document
    if ((mode === 'edit' || mode === 'comment') && !selectionText.trim()) {
      return wholeDocumentSnapshot(context, mode, selection);
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

async function wholeDocumentSnapshot(context: Word.RequestContext, mode: Mode, selection: Word.Range): Promise<DocumentSnapshot> {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load('items/text');
  // A comment goes to the paragraph the cursor is in
  const cursorParagraph = selection.paragraphs.getFirst();
  await context.sync();

  const reviewedResults = paragraphs.items.map(p => p.getReviewedText('Current'));
  await context.sync();
  const raw = paragraphs.items.map(p => p.text);
  const texts = reviewedResults.map(r => readable(r.value || '').replace(/\r$/, ''));
  const text = texts.join('\n');
  if (!text.trim()) {
    throw new UserFacingError(mode === 'edit'
      ? 'A dokumentum még üres. Új szöveghez válaszd a Generálás módot!'
      : 'A dokumentum üres, nincs mit véleményeznem.');
  }
  if (mode === 'edit' && text.length > MAX_SELECTION_CHARS) {
    throw new UserFacingError(`Nem jelöltél ki semmit, ezért az egész dokumentumon dolgoznék, de ahhoz túl hosszú (${formatNumber(text.length)} karakter, legfeljebb ${formatNumber(MAX_SELECTION_CHARS)}). Jelölj ki egy részt, vagy új szöveghez (pl. aláírósor) állj a helyére és válaszd a Generálás módot.`);
  }

  let range: Word.Range | null = null;
  if (mode === 'comment') {
    const anchor = cursorParagraph.getRange('Whole');
    context.trackedObjects.add(anchor);
    await context.sync();
    range = anchor;
  }
  return {
    range,
    selectionText: text,
    // The text itself is the whole document, no separate background is needed
    documentContext: '',
    contextInfo: { documentChars: text.length, sentChars: Math.min(text.length, MAX_SELECTION_CHARS), limit: MAX_SELECTION_CHARS, strategy: 'full' },
    wholeDocument: { paragraphs: raw, reviewed: texts },
  };
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

/** Runs changes with Track Changes on, then restores the user's own setting */
async function withTrackChanges<T>(context: Word.RequestContext, run: () => Promise<T>): Promise<T> {
  const doc = context.document;
  doc.load('changeTrackingMode');
  await context.sync();
  const previous = doc.changeTrackingMode;
  doc.changeTrackingMode = 'TrackAll';
  try {
    return await run();
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
  /** The range had tracked changes not yet accepted, so it was replaced as a whole */
  pendingChanges?: boolean;
}

/**
 * Rewrites a range to newText, touching only the words that changed where possible. That keeps bold, italics,
 * lists and styles of everything the AI didn't change. The caller turns Track Changes on.
 */
async function editRange(context: Word.RequestContext, range: Word.Range, newText: string): Promise<EditOutcome> {
  range.load('text');
  const reviewed = range.getReviewedText('Current');
  const paragraphs = range.paragraphs;
  paragraphs.load('items/text');
  await context.sync();

  // Pending tracked changes inside: word ranges would include deleted words, so the whole range is replaced
  if (!sameWords(range.text, reviewed.value || '')) {
    range.insertText(newText, 'Replace');
    await context.sync();
    return { strategy: 'replace', changedPlaces: 1, pendingChanges: true };
  }

  // Which ranges can be diffed word by word: the range itself inside one paragraph, or whole paragraphs
  const rangeText = range.text.replace(/\r$/, '');
  let segments: { getTextRanges: Word.Range['getTextRanges'] }[] | null = null;
  let segmentTexts: string[] = [];
  if (!rangeText.includes('\r')) {
    segments = [range];
    segmentTexts = [rangeText];
  } else if (paragraphs.items.map(p => p.text).join('\r') === rangeText) {
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
      plan = consistentWords(wordCollections, segmentTexts) ? planParagraphEdits(wordCollections.map(comparableWords), newText) : null;
    } catch {
      // Nothing was changed yet: fall back to replacing the whole range
      plan = null;
    }
  }

  if (plan) {
    if (plan.length === 0) return { strategy: 'unchanged', changedPlaces: 0 };
    // Last to first, so earlier word ranges are not shifted by later edits
    for (const edit of [...plan].reverse()) {
      const words = wordCollections[edit.paragraphIndex].items;
      for (const hunk of [...edit.hunks].reverse()) applyHunk(words, hunk);
    }
    await context.sync();
    return { strategy: 'words', changedPlaces: plan.reduce((sum, edit) => sum + edit.hunks.length, 0) };
  }

  range.insertText(newText, 'Replace');
  await context.sync();
  return { strategy: 'replace', changedPlaces: 1 };
}

const wordTexts = (collection: Word.RangeCollection) => collection.items.map(word => word.text);
/** Words as the diff compares them: "ott" followed by an invisible anchor mark is still "ott" */
const comparableWords = (collection: Word.RangeCollection) => wordTexts(collection).map(word => stripControlChars(word) || word);

/** Only trust Word's word ranges when Word split the text the same way we would */
const consistentWords = (collections: Word.RangeCollection[], texts: string[]) =>
  collections.every((collection, i) => wordTexts(collection).join('\u0000') === tokenizeLikeWord(texts[i]).join('\u0000'));

/** Applies an edit of the tracked selection with Track Changes; the explanation, if any, goes on it as a comment */
export async function applyEdit(range: Word.Range, newText: string, explanation = ''): Promise<EditOutcome> {
  return Word.run(range, async (context) => {
    const outcome = await withTrackChanges(context, () => editRange(context, range, newText));
    if (explanation && outcome.strategy !== 'unchanged') {
      range.insertComment(explanation);
      await context.sync();
    }
    await untrack(context, range);
    return outcome;
  });
}

export interface DocumentEditOutcome {
  changed: number;
  inserted: number;
  deleted: number;
}

/**
 * Applies a rewrite of the whole document with Track Changes: only changed words, new paragraphs and removed
 * paragraphs are touched, never the whole document at once. Refuses if the document changed since the request.
 */
export async function applyDocumentEdit(
  snapshot: NonNullable<DocumentSnapshot['wholeDocument']>,
  newText: string,
  explanation = ''
): Promise<DocumentEditOutcome> {
  const { paragraphs: expectedParagraphs, reviewed } = snapshot;
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    const items = paragraphs.items;
    if (items.length !== expectedParagraphs.length || items.some((p, i) => p.text !== expectedParagraphs[i])) {
      throw new UserFacingError('A dokumentum megváltozott, amióta a kérést elküldted, ezért nem írtam bele. Kérd újra, hogy a mostani szövegen dolgozzak.');
    }

    const ops = planDocumentEdits(reviewed, newText);
    const summary = summarizeDocumentEdits(ops);
    if (ops.length === 0) return summary;

    const edits = ops.filter((op): op is Extract<DocumentEditOp, { type: 'edit' }> => op.type === 'edit');
    const words = new Map(edits.map(op => {
      const collection = items[op.paragraph].getTextRanges([' '], true);
      collection.load('items/text');
      return [op.paragraph, collection] as const;
    }));

    // The explanation goes on the first place that changes
    let firstChanged: Word.Paragraph | null = null;
    await withTrackChanges(context, async () => {
      await context.sync();
      // Last to first, so the positions of earlier paragraphs and words stay put
      for (const op of [...ops].reverse()) {
        const paragraph = items[op.type === 'insert' ? Math.max(op.after, 0) : op.paragraph];
        firstChanged = paragraph;
        if (op.type === 'insert') {
          if (op.after === -1) {
            op.texts.forEach(text => { firstChanged = paragraph.insertParagraph(text, 'Before'); });
          } else {
            [...op.texts].reverse().forEach(text => { firstChanged = paragraph.insertParagraph(text, 'After'); });
          }
        } else if (op.type === 'delete') {
          paragraph.delete();
        } else {
          const collection = words.get(op.paragraph)!;
          // Word ranges can be trusted only without pending tracked changes in the paragraph
          if (sameWords(expectedParagraphs[op.paragraph], reviewed[op.paragraph]) && consistentWords([collection], [expectedParagraphs[op.paragraph]])) {
            const hunks = planParagraphEdits([comparableWords(collection)], op.newText)?.[0]?.hunks ?? [];
            for (const hunk of [...hunks].reverse()) applyHunk(collection.items, hunk);
          } else {
            // Word split this paragraph differently: rewrite just this one
            paragraph.insertText(op.newText, 'Replace');
          }
        }
      }
      await context.sync();
    });
    if (explanation && firstChanged) {
      (firstChanged as Word.Paragraph).getRange("Whole").insertComment(explanation);
      await context.sync();
    }
    return summary;
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

export interface ReviewItem {
  finding: ReviewFinding;
  /** Attach the finding as a margin comment */
  comment: boolean;
  /** Write the suggested wording into the text as a tracked change */
  fix: boolean;
}

export interface ReviewInsertOutcome {
  comments: number;
  fixes: number;
  /** A comment was asked for, but its quote was not found */
  notFound: ReviewFinding[];
  /** A fix was asked for, but the whole quote was not found word for word, so it could not be replaced */
  fixFailed: ReviewFinding[];
}

/** Finds each quote in the document, attaches its comment there and applies the chosen fixes as tracked changes */
export async function applyReviewFindings(items: ReviewItem[]): Promise<ReviewInsertOutcome> {
  return Word.run(async (context) => {
    const body = context.document.body;
    const search = (text: string, matchCase: boolean) => {
      const results = body.search(text, { matchCase });
      results.load('items/text');
      return results;
    };
    // All searches go out in one batch
    const commentSearches = items.map(({ finding }) => searchCandidates(finding.quote).map(candidate => search(candidate, false)));
    const fixSearches = items.map(item => {
      const fix = item.fix ? reviewFix(item.finding) : null;
      return fix && { ...fix, results: search(fix.search, true) };
    });
    await context.sync();

    const outcome: ReviewInsertOutcome = { comments: 0, fixes: 0, notFound: [], fixFailed: [] };
    const toFix: { range: Word.Range; text: string }[] = [];
    items.forEach((item, i) => {
      const fix = fixSearches[i];
      const fixRange = fix && fix.results.items.length > 0 ? fix.results.items[0] : null;
      if (item.fix && !fixRange) outcome.fixFailed.push(item.finding);
      if (item.comment) {
        // The full quote is exact, so its first match is right. A shorter prefix is only trusted when it occurs
        // exactly once: otherwise the comment could land on an unrelated, earlier sentence.
        const hit = fixRange ?? commentSearches[i].find((results, k) => (k === 0 ? results.items.length > 0 : results.items.length === 1))?.items[0];
        if (hit) {
          // Before the fix, so the comment is anchored on the original wording
          hit.insertComment(reviewCommentText(item.finding, !!fixRange));
          outcome.comments++;
        } else {
          outcome.notFound.push(item.finding);
        }
      }
      if (fix && fixRange) toFix.push({ range: fixRange, text: fix.replacement });
    });
    await context.sync();

    if (toFix.length) {
      await withTrackChanges(context, async () => {
        for (const { range, text } of toFix) {
          const result = await editRange(context, range, text);
          if (result.strategy !== 'unchanged') outcome.fixes++;
        }
      });
    }
    return outcome;
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

/** Every paragraph of the body with Word's automatic numbering, for the structure map and the comparison */
export async function readParagraphs(): Promise<ParagraphInfo[]> {
  return Word.run(context => loadParagraphs(context));
}

async function loadParagraphs(context: Word.RequestContext, reviewedText = false): Promise<ParagraphInfo[]> {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load('items/text,items/isListItem');
  await context.sync();
  // The number Word shows ("5.2.") is not part of paragraph.text
  const listItems = paragraphs.items.map(p => (p.isListItem ? p.listItemOrNullObject : null));
  listItems.forEach(item => item?.load('listString,level'));
  const texts = reviewedText ? paragraphs.items.map(p => p.getReviewedText('Current')) : null;
  await context.sync();
  return paragraphs.items.map((p, i) => {
    const item = listItems[i];
    const text = texts ? readable(texts[i].value || '').replace(/\r$/, '') : p.text;
    return item && !item.isNullObject ? { text, listString: item.listString, listLevel: item.level } : { text };
  });
}

/** The document with automatic numbers in brackets; null when it has no numbered paragraphs */
async function numberedDocumentText(context: Word.RequestContext): Promise<string | null> {
  const paragraphs = await loadParagraphs(context, true);
  return paragraphs.some(p => p.listString) ? withAutoNumbers(paragraphs).join('\n') : null;
}

/** The paragraph the cursor is in, and the cursor's offset inside its text */
export async function readCursor(): Promise<{ paragraphText: string; offset: number }> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const paragraph = selection.paragraphs.getFirst();
    paragraph.load('text');
    const before = paragraph.getRange('Start').expandTo(selection.getRange('Start'));
    before.load('text');
    await context.sync();
    return { paragraphText: paragraph.text, offset: before.text.length };
  });
}

/**
 * Selects a paragraph, so Word scrolls to it. With rememberPosition the current selection is tracked and
 * returned, so the user can jump back to where they were.
 */
export async function jumpToParagraph(index: number, rememberPosition: boolean): Promise<Word.Range | null> {
  return Word.run(async (context) => {
    const previous = rememberPosition ? context.document.getSelection() : null;
    if (previous) context.trackedObjects.add(previous);
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    const target = paragraphs.items[index];
    if (!target) {
      if (previous) {
        context.trackedObjects.remove(previous);
        await context.sync();
      }
      throw new UserFacingError('Ez a bekezdés már nincs meg a dokumentumban. Frissítsd a nézetet.');
    }
    target.select();
    await context.sync();
    return previous;
  });
}

/** Returns to a position remembered by jumpToParagraph and releases it */
export async function jumpBack(range: Word.Range) {
  await Word.run(range, async (context) => {
    range.select();
    await context.sync();
    await untrack(context, range);
  });
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * Attaches comments to paragraphs by index. A paragraph whose text is no longer what it was when the list was
 * made (the document changed since) is skipped rather than commented in the wrong place.
 */
export async function insertCommentsAtParagraphs(items: { paragraph: number; expectedText: string; comment: string }[]): Promise<{ inserted: number; skipped: number[] }> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    let inserted = 0;
    const skipped: number[] = [];
    items.forEach((item, i) => {
      const paragraph = paragraphs.items[item.paragraph];
      if (paragraph && sameText(paragraph.text, item.expectedText)) {
        paragraph.getRange('Whole').insertComment(item.comment);
        inserted++;
      } else {
        skipped.push(i);
      }
    });
    await context.sync();
    return { inserted, skipped };
  });
}
