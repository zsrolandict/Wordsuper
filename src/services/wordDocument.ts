import { MAX_SELECTION_CHARS, contextLimitFor, type Mode, type ReviewFinding } from '../shared/aiConfig';
import { buildDocumentContext, type ContextInfo } from './contextBuilder';
import { planParagraphEdits, stripControlChars, tokenizeLikeWord, type DiffHunk } from './textDiff';
import { reviewCommentText, reviewFix, searchCandidates } from './review';
import { planDocumentEdits, summarizeDocumentEdits, type DocumentEditOp } from './documentEdit';
import { formatNumber } from './format';
import { withAutoNumbers, type ParagraphInfo } from './structure';
import { isBlank, type FormatAudit, type FormatPlan, type PageMargins } from './formatting';

/** An error whose message is meant for the user as is */
export class UserFacingError extends Error {}

/** Part of the change is already in the document: it must not be offered again (it would be inserted twice) */
export class PartialWriteError extends UserFacingError {}

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
const readable = (reviewed: string) => stripControlChars(reviewed.replace(CELL_END_ALL, '\t'));
/** Word marks the end of a table cell or row with this character */
const CELL_END = /\u0007/;
const CELL_END_ALL = /\u0007/g;
const sameWords = (a: string, b: string) => stripControlChars(a).replace(/\s+/g, ' ').trim() === stripControlChars(b).replace(/\s+/g, ' ').trim();

const isHeading = (p: Word.Paragraph) =>
  p.styleBuiltIn === 'Title' || p.styleBuiltIn.startsWith('Heading') || /^(heading|címsor)/i.test(p.style);

/** Reads what the AI needs for a request and starts tracking the selection */
export async function takeSnapshot(mode: Mode): Promise<DocumentSnapshot> {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const body = context.document.body;
    selection.load('text');
    const selectionReviewed = selection.getReviewedText('Current');
    const bodyReviewed = body.getReviewedText('Current');
    await context.sync();

    // Replacing text across table cells would break the table apart
    if (mode === 'edit' && CELL_END.test(selection.text || '')) {
      throw new UserFacingError('A kijelölés több táblázatcellán ível át, ezt nem tudom biztonságosan átírni. Jelölj ki szöveget egy cellán belül, vagy a táblázaton kívül.');
    }

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
        // Measured on the reviewed text, like the document text it indexes into
        const before = body.getRange('Start').expandTo(selection.getRange('Start')).getReviewedText('Current');
        await context.sync();
        selectionStart = readable(before.value || '').length;
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

/**
 * Whether the user selected something else since the snapshot was taken: then a new instruction is more likely a
 * new request than a refinement of the pending proposal.
 */
export async function selectionMovedFrom(snapshot: DocumentSnapshot): Promise<boolean> {
  const range = snapshot.range;
  // Whole-document request: a new, non-empty selection means the user now wants to work on that part
  if (snapshot.wholeDocument && !range) {
    return Word.run(async (context) => {
      const selection = context.document.getSelection();
      selection.load('text');
      await context.sync();
      return (selection.text || '').trim() !== '';
    });
  }
  // A review has no selection to move away from
  if (!range) return false;
  return Word.run(range, async (context) => {
    const selection = context.document.getSelection();
    const relation = range.compareLocationWith(selection);
    await context.sync();
    return relation.value !== 'Equal';
  });
}

/**
 * What one insertion touched, so it can be taken back: the ranges (kept tracked across Word.run calls) and when it
 * happened. Undo rejects the tracked changes and deletes the comments inside those ranges made since then.
 */
export interface UndoRecord {
  ranges: Word.Range[];
  since: number;
  /**
   * Tracked changes and comments that were already in the touched places before the insertion: Word keeps their
   * time to the minute only, so the user's own changes made in the same minute are told apart by these
   */
  before: Set<string>;
}

export const newUndoRecord = (): UndoRecord => ({ ranges: [], since: Date.now(), before: new Set() });

const revisionSignature = (change: Word.TrackedChange) => `R|${change.type}|${change.author}|${change.text}|${new Date(change.date).getTime()}`;
const commentSignature = (comment: Word.Comment) => `C|${comment.authorName}|${comment.content}|${new Date(comment.creationDate).getTime()}`;

/** Notes the tracked changes and comments already in these places, before an insertion touches them (WordApi 1.6) */
async function rememberExisting(context: Word.RequestContext, undo: UndoRecord | undefined, ranges: Word.Range[]) {
  if (!undo || !ranges.length || !canUndo()) return;
  try {
    const found = ranges.map(range => {
      const changes = range.getTrackedChanges();
      changes.load('items/type,items/author,items/text,items/date');
      const comments = range.getComments();
      comments.load('items/authorName,items/content,items/creationDate');
      return { changes, comments };
    });
    await context.sync();
    found.forEach(({ changes, comments }) => {
      changes.items.forEach(change => undo.before.add(revisionSignature(change)));
      comments.items.forEach(comment => undo.before.add(commentSignature(comment)));
    });
  } catch {
    // Not known: undo then works by time alone, as before
  }
}

/** Taking back needs the tracked-changes API (WordApi 1.6, e.g. Microsoft 365) */
export const canUndo = () =>
  typeof Office !== 'undefined' && !!Office.context?.requirements?.isSetSupported('WordApi', '1.6');

function remember(context: Word.RequestContext, undo: UndoRecord | undefined, range: Word.Range) {
  if (!undo) return;
  context.trackedObjects.add(range);
  undo.ranges.push(range);
}

/**
 * Takes back what the records inserted: tracked changes are rejected, comments deleted. Only changes inside the
 * touched ranges and not older than the insertion count (Word keeps revision times to the minute), so earlier
 * tracked changes of the user in the same sentence stay.
 */
export async function undoChanges(records: UndoRecord[]): Promise<{ changes: number; comments: number }> {
  const ranges = records.flatMap(r => r.ranges.map(range => ({ range, since: Math.floor(r.since / 60000) * 60000, before: r.before ?? new Set<string>() })));
  if (!ranges.length) return { changes: 0, comments: 0 };
  return Word.run(ranges.map(r => r.range), async (context) => {
    let changes = 0;
    let comments = 0;
    // One range at a time: overlapping ranges would otherwise try to reject the same change twice
    for (const { range, since, before } of ranges) {
      try {
        const tracked = range.getTrackedChanges();
        tracked.load('items/date,items/type,items/author,items/text');
        const notes = range.getComments();
        notes.load('items/creationDate,items/authorName,items/content');
        await context.sync();
        const newer = (date: Date | string) => new Date(date).getTime() >= since;
        // Only what the insertion made: not older, and not already there before it (the user's own, same minute)
        tracked.items.filter(change => newer(change.date) && !before.has(revisionSignature(change))).forEach(change => { change.reject(); changes++; });
        notes.items.filter(comment => newer(comment.creationDate) && !before.has(commentSignature(comment))).forEach(comment => { comment.delete(); comments++; });
        await context.sync();
      } catch {
        // Already taken back through an overlapping range, or the text is gone
      }
    }
    ranges.forEach(({ range }) => context.trackedObjects.remove(range));
    await context.sync().catch(() => {});
    return { changes, comments };
  });
}

/** Lets Word forget the ranges kept for taking changes back (many tracked objects slow Word down) */
export async function releaseUndo(records: UndoRecord[]) {
  const ranges = records.flatMap(r => r.ranges);
  if (!ranges.length) return;
  try {
    await Word.run(ranges, async (context) => {
      ranges.forEach(range => context.trackedObjects.remove(range));
      await context.sync();
    });
  } catch {
    // Already gone
  }
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

/**
 * The user's choice to write without Track Changes (Settings, off by default). Set by the task pane; module-wide,
 * because every writer (assistant, structure view) must follow it.
 */
let skipTracking = false;
export function setSkipTrackedChanges(skip: boolean) {
  skipTracking = skip;
}

/** How a change went into the document */
export interface WriteMode {
  /** With Track Changes (ours, or the user's own Word setting) */
  tracked: boolean;
  /** Tracked despite the "without Track Changes" setting, because the document has pending tracked changes */
  forced: boolean;
}

/**
 * Runs changes with Track Changes on, then restores the user's own setting. With the "without Track Changes"
 * setting, Word's own setting decides instead, except in a document with pending tracked changes (typically one
 * being negotiated): there a silent change could slip past the other side, so it is tracked anyway.
 */
async function withTrackChanges<T>(context: Word.RequestContext, run: () => Promise<T>): Promise<{ value: T; write: WriteMode }> {
  const doc = context.document;
  doc.load('changeTrackingMode');
  const original = skipTracking ? doc.body.getReviewedText('Original') : null;
  const current = skipTracking ? doc.body.getReviewedText('Current') : null;
  await context.sync();
  const previous = doc.changeTrackingMode;
  const forced = !!original && !!current && original.value !== current.value;
  const track = !skipTracking || forced;
  if (track) doc.changeTrackingMode = 'TrackAll';
  try {
    const value = await run();
    return { value, write: { tracked: track || previous !== 'Off', forced } };
  } finally {
    if (track) {
      try {
        doc.changeTrackingMode = previous;
        await context.sync();
      } catch {
        // The batch failed: put the user's own setting back in a fresh one, so Track Changes is not left on
        await Word.run(async (fresh) => {
          fresh.document.changeTrackingMode = previous;
          await fresh.sync();
        }).catch(() => {});
      }
    }
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
   * blocked: nothing was written, because the change would have deleted footnotes, fields… (see protectedBy)
   */
  strategy: 'words' | 'replace' | 'unchanged' | 'blocked';
  changedPlaces: number;
  /** The range had tracked changes not yet accepted, so it was replaced as a whole */
  pendingChanges?: boolean;
  write?: WriteMode;
  /** blocked: what would have been deleted, and the words of the change that touched it ("" for the whole range) */
  protectedBy?: { elements: string[]; words: string };
}

const isSupported = (version: string) =>
  typeof Office !== 'undefined' && !!Office.context?.requirements?.isSetSupported('WordApi', version);

/**
 * What replacing or deleting these ranges would destroy without a trace in the text: footnotes, endnotes, fields
 * (cross-references, page numbers), content controls, pictures. One entry per kind, in the user's words.
 */
async function protectedElements(context: Word.RequestContext, ranges: Word.Range[]): Promise<string[]> {
  return [...new Set((await protectedElementsEach(context, ranges)).flat())];
}

/** protectedElements for each range separately, in one round trip */
async function protectedElementsEach(context: Word.RequestContext, ranges: Word.Range[]): Promise<string[][]> {
  if (!ranges.length) return [];
  const perRange = ranges.map(range => {
    const list: [string, { items: unknown[] }][] = [];
    const controls = range.contentControls;
    controls.load('items/id');
    list.push(['tartalomvezérlő (űrlapmező)', controls]);
    if (isSupported('1.2')) {
      const pictures = range.inlinePictures;
      pictures.load('items/width');
      list.push(['kép', pictures]);
    }
    if (isSupported('1.4')) {
      const fields = range.fields;
      fields.load('items/code');
      list.push(['mező (pl. kereszthivatkozás, oldalszám)', fields]);
    }
    if (isSupported('1.5')) {
      const footnotes = range.footnotes;
      footnotes.load('items/type');
      list.push(['lábjegyzet', footnotes]);
      const endnotes = range.endnotes;
      endnotes.load('items/type');
      list.push(['végjegyzet', endnotes]);
    }
    return list;
  });
  try {
    await context.sync();
  } catch {
    // This Word can't tell: nothing is known to be in the way
    return ranges.map(() => []);
  }
  return perRange.map(list => list.filter(([, collection]) => collection.items.length > 0).map(([name]) => name));
}

/** Why a change was not written: what it would have deleted, and how to get around it */
export function protectedMessage(protectedBy: NonNullable<EditOutcome['protectedBy']>): string {
  const what = protectedBy.elements.join(', ');
  return protectedBy.words
    ? `Nem írtam be: a javaslat a(z) „${protectedBy.words}” részt is átírná, és ezzel törölné a benne lévő elemet (${what}). Kattints erre a változásra a javaslatban, hogy kimaradjon, vagy ezt a részt írd át kézzel.`
    : `Nem írtam be: ezt csak a teljes kijelölés cseréjével lehetne, ami törölné a benne lévő elemet (${what}). Jelölj ki kisebb részt ezek nélkül, vagy fogadd el előbb a kijelölés korrektúráit.`;
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
    const elements = await protectedElements(context, [range]);
    if (elements.length) return { strategy: 'blocked', changedPlaces: 0, protectedBy: { elements, words: '' } };
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
    // A changed word may carry a footnote mark or a field: replacing the word would delete it
    const touched = plan.flatMap(edit => edit.hunks.filter(hunk => hunk.oldEnd > hunk.oldStart).map(hunk => {
      const words = wordCollections[edit.paragraphIndex].items;
      return { range: words[hunk.oldStart].expandTo(words[hunk.oldEnd - 1]), words: words.slice(hunk.oldStart, hunk.oldEnd).map(w => w.text).join(' ') };
    }));
    const found = await protectedElementsEach(context, touched.map(t => t.range));
    const hit = found.findIndex(elements => elements.length > 0);
    if (hit !== -1) return { strategy: 'blocked', changedPlaces: 0, protectedBy: { elements: found[hit], words: stripControlChars(touched[hit].words).trim() } };
    // Last to first, so earlier word ranges are not shifted by later edits
    for (const edit of [...plan].reverse()) {
      const words = wordCollections[edit.paragraphIndex].items;
      for (const hunk of [...edit.hunks].reverse()) applyHunk(words, hunk);
    }
    await context.sync();
    return { strategy: 'words', changedPlaces: plan.reduce((sum, edit) => sum + edit.hunks.length, 0) };
  }

  const elements = await protectedElements(context, [range]);
  if (elements.length) return { strategy: 'blocked', changedPlaces: 0, protectedBy: { elements, words: '' } };
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

/**
 * Refuses to write if the text of a tracked selection is no longer what the AI got: the user typed into it while
 * waiting, and the answer would silently overwrite that.
 */
async function assertUnchanged(context: Word.RequestContext, range: Word.Range, expectedText: string | undefined) {
  if (expectedText === undefined) return;
  const current = range.getReviewedText('Current');
  await context.sync();
  if (!sameText(readable(current.value || ''), expectedText)) {
    throw new UserFacingError('A kijelölt szöveg megváltozott, amióta a kérést elküldted (közben beleírtál?), ezért nem írtam bele: elveszne, amit közben írtál. Jelöld ki újra, és kérd újra a mostani szövegre.');
  }
}

/** Applies an edit of the tracked selection with Track Changes; the explanation, if any, goes on it as a comment */
export async function applyEdit(range: Word.Range, newText: string, explanation = '', undo?: UndoRecord, expectedText?: string): Promise<EditOutcome> {
  return Word.run(range, async (context) => {
    await assertUnchanged(context, range, expectedText);
    await rememberExisting(context, undo, [range]);
    const { value, write } = await withTrackChanges(context, () => editRange(context, range, newText));
    if (value.strategy === 'blocked') throw new UserFacingError(protectedMessage(value.protectedBy!));
    const outcome = { ...value, write };
    if (explanation && outcome.strategy !== 'unchanged') range.insertComment(explanation);
    // Show where it happened: the user may have scrolled away while the AI was working
    range.select();
    await context.sync();
    // Kept tracked when it may be taken back; the snapshot's own tracking is released either way
    if (undo) remember(context, undo, range.getRange('Whole'));
    await untrack(context, range);
    return outcome;
  });
}

export interface DocumentEditOutcome {
  changed: number;
  inserted: number;
  deleted: number;
  write?: WriteMode;
}

/**
 * Applies a rewrite of the whole document with Track Changes: only changed words, new paragraphs and removed
 * paragraphs are touched, never the whole document at once. Refuses if the document changed since the request.
 */
export async function applyDocumentEdit(
  snapshot: NonNullable<DocumentSnapshot['wholeDocument']>,
  newText: string,
  explanation = '',
  undo?: UndoRecord
): Promise<DocumentEditOutcome> {
  const { paragraphs: expectedParagraphs, reviewed } = snapshot;
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text,items/tableNestingLevel');
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
    await context.sync();

    // How each edited paragraph is changed: word by word (its hunks), or rewritten whole (null)
    const wordHunks = new Map(edits.map(op => {
      const collection = words.get(op.paragraph)!;
      // Word ranges can be trusted only without pending tracked changes in the paragraph
      const byWords = sameWords(expectedParagraphs[op.paragraph], reviewed[op.paragraph]) && consistentWords([collection], [expectedParagraphs[op.paragraph]]);
      return [op.paragraph, byWords ? planParagraphEdits([comparableWords(collection)], op.newText)?.[0]?.hunks ?? [] : null] as const;
    }));
    // Nothing is written if a deleted or rewritten part holds a footnote, a field, a picture…
    const doomed = ops.flatMap(op => {
      if (op.type === 'insert') return [];
      const paragraph = items[op.paragraph];
      const hunks = op.type === 'edit' ? wordHunks.get(op.paragraph) : null;
      if (!hunks) return [{ range: paragraph.getRange('Whole'), words: '' }];
      const list = words.get(op.paragraph)!.items;
      return hunks.filter(hunk => hunk.oldEnd > hunk.oldStart).map(hunk => ({
        range: list[hunk.oldStart].expandTo(list[hunk.oldEnd - 1]),
        words: list.slice(hunk.oldStart, hunk.oldEnd).map(w => w.text).join(' '),
      }));
    });
    const found = await protectedElementsEach(context, doomed.map(d => d.range));
    const hit = found.findIndex(elements => elements.length > 0);
    if (hit !== -1) {
      const words = stripControlChars(doomed[hit].words).trim();
      throw new UserFacingError(words
        ? protectedMessage({ elements: found[hit], words })
        : `Nem írtam be: a javaslat egy olyan bekezdést törölne vagy írna át egészében, amelyben ${found[hit].join(', ')} van, és ez elveszne. Vedd ki ezt a bekezdést a javaslatból (pipa), vagy ezt a részt írd át kézzel.`);
    }

    await rememberExisting(context, undo, ops.filter(op => op.type !== 'insert').map(op => items[(op as { paragraph: number }).paragraph].getRange('Whole')));

    // The explanation goes on the first place that changes
    let firstChanged: Word.Paragraph | null = null;
    const { write } = await withTrackChanges(context, async () => {
      // Last to first, so the positions of earlier paragraphs and words stay put
      for (const op of [...ops].reverse()) {
        const paragraph = items[op.type === 'insert' ? Math.max(op.after, 0) : op.paragraph];
        // Processed last to first, so after the loop this holds the first place that changed
        firstChanged = paragraph;
        if (op.type !== 'insert') remember(context, undo, paragraph.getRange('Whole'));
        if (op.type === 'insert') {
          if (op.after === -1) {
            op.texts.forEach((text, i) => {
              const inserted = paragraph.insertParagraph(text, 'Before');
              remember(context, undo, inserted.getRange('Whole'));
              if (i === 0) firstChanged = inserted;
            });
          } else {
            // After a table cell (e.g. a signature table at the end) the new text goes after the whole table
            let previous: Word.Paragraph | null = null;
            op.texts.forEach((text, i) => {
              previous = previous
                ? previous.insertParagraph(text, 'After')
                : paragraph.tableNestingLevel > 0 ? paragraph.parentTable.insertParagraph(text, 'After') : paragraph.insertParagraph(text, 'After');
              remember(context, undo, previous.getRange('Whole'));
              if (i === 0) firstChanged = previous;
            });
          }
        } else if (op.type === 'delete') {
          paragraph.delete();
        } else {
          const hunks = wordHunks.get(op.paragraph);
          if (hunks) {
            for (const hunk of [...hunks].reverse()) applyHunk(words.get(op.paragraph)!.items, hunk);
          } else {
            // Word split this paragraph differently: rewrite just this one
            paragraph.insertText(op.newText, 'Replace');
          }
        }
      }
      try {
        await context.sync();
      } catch (error) {
        // Word applies a batch up to the failing step: part of the changes is in, so it must not be retried
        console.error(error);
        throw new PartialWriteError('A beírás félbeszakadt: a változások egy része bekerült a dokumentumba, egy része nem (hiba a Wordben). Nézd át a dokumentumot; a már beírt korrektúrákat a Wordben (vagy a Visszavonom gombbal) elutasíthatod. Újra nem próbálom, mert duplán kerülne be.');
      }
    });
    if (firstChanged) {
      const place = (firstChanged as Word.Paragraph).getRange('Whole');
      if (explanation) place.insertComment(explanation);
      place.select();
      await context.sync();
    }
    return { ...summary, write };
  });
}

/**
 * Inserts generated text at the tracked selection (replacing it, if there was one). At the start or the end of
 * a non-empty paragraph it becomes paragraphs of its own instead of gluing onto that paragraph's text.
 */
export async function insertGenerated(range: Word.Range, text: string, undo?: UndoRecord, expectedText?: string): Promise<WriteMode> {
  return Word.run(range, async (context) => {
    // A selection is replaced by the generated text: never one the user has typed into since
    await assertUnchanged(context, range, expectedText);
    await rememberExisting(context, undo, [range]);
    range.load('text');
    const paragraph = range.paragraphs.getFirst();
    paragraph.load('text');
    const before = paragraph.getRange('Start').expandTo(range.getRange('Start'));
    before.load('text');
    await context.sync();

    let insert = text;
    if (!range.text && paragraph.text.trim()) {
      const offset = before.text.length;
      if (offset === 0) insert = `${text}\n`;
      else if (offset >= paragraph.text.length) insert = `\n${text}`;
    }
    // Inserted with Track Changes, like every other change
    const { write } = await withTrackChanges(context, async () => {
      const inserted = range.insertText(insert, 'Replace');
      inserted.select();
      remember(context, undo, inserted);
      await context.sync();
    });
    await untrack(context, range);
    return write;
  });
}

export async function insertCommentAt(range: Word.Range, text: string, undo?: UndoRecord) {
  await Word.run(range, async (context) => {
    range.insertComment(text);
    range.select();
    await context.sync();
    if (undo) remember(context, undo, range.getRange('Whole'));
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
  /** A fix was not written because it would have deleted a footnote, a field… */
  fixProtected: ReviewFinding[];
  /** How the fixes went in; unset when only comments were inserted */
  write?: WriteMode;
}

/** Finds each quote in the document, attaches its comment there and applies the chosen fixes as tracked changes */
export async function applyReviewFindings(items: ReviewItem[], options: { select?: boolean; undo?: UndoRecord } = {}): Promise<ReviewInsertOutcome> {
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

    const outcome: ReviewInsertOutcome = { comments: 0, fixes: 0, notFound: [], fixFailed: [], fixProtected: [] };
    const toFix: { range: Word.Range; text: string; finding: ReviewFinding }[] = [];
    // Where the (last) change landed, to show it when asked
    let landed: Word.Range | null = null;
    // Where each finding goes. The full quote is exact, so its first match is right. A shorter prefix is only
    // trusted when it occurs exactly once: otherwise the comment could land on an unrelated, earlier sentence.
    const places = items.map((item, i) => {
      const fix = fixSearches[i];
      const fixRange = fix && fix.results.items.length > 0 ? fix.results.items[0] : null;
      const hit = item.comment ? fixRange ?? commentSearches[i].find((results, k) => (k === 0 ? results.items.length > 0 : results.items.length === 1))?.items[0] : undefined;
      return { item, fix, fixRange, hit };
    });
    await rememberExisting(context, options.undo, places.flatMap(p => [p.hit, p.fixRange]).filter((r): r is Word.Range => !!r));
    places.forEach(({ item, fix, fixRange, hit }) => {
      if (item.fix && !fixRange) outcome.fixFailed.push(item.finding);
      if (item.comment) {
        if (hit) {
          // Before the fix, so the comment is anchored on the original wording
          hit.insertComment(reviewCommentText(item.finding, !!fixRange));
          outcome.comments++;
          landed = hit;
          if (!fixRange) remember(context, options.undo, hit);
        } else {
          outcome.notFound.push(item.finding);
        }
      }
      if (fix && fixRange) {
        toFix.push({ range: fixRange, text: fix.replacement, finding: item.finding });
        landed = fixRange;
        remember(context, options.undo, fixRange);
      }
    });
    await context.sync();

    if (toFix.length) {
      ({ write: outcome.write } = await withTrackChanges(context, async () => {
        for (const { range, text, finding } of toFix) {
          const result = await editRange(context, range, text);
          if (result.strategy === 'blocked') outcome.fixProtected.push(finding);
          else if (result.strategy !== 'unchanged') outcome.fixes++;
        }
      }));
    }
    if (options.select && landed) {
      (landed as Word.Range).select();
      await context.sync();
    }
    return outcome;
  });
}

/** Selects a pending proposal's place (its selection, or the insertion point), so Word scrolls there */
export async function showRange(range: Word.Range) {
  await Word.run(range, async (context) => {
    range.select();
    await context.sync();
  });
}

/**
 * Selects the quoted passage of a finding, so Word scrolls there; false when it can't be found. After its fix was
 * written in, the new wording is looked for first (the quote then only survives as tracked deleted text).
 */
export async function showFinding(finding: ReviewFinding, fixApplied = false): Promise<boolean> {
  return Word.run(async (context) => {
    const body = context.document.body;
    const fix = fixApplied ? reviewFix(finding) : null;
    const texts = fix ? [...searchCandidates(fix.replacement), ...searchCandidates(finding.quote)] : searchCandidates(finding.quote);
    const searches = texts.map(candidate => {
      const results = body.search(candidate, { matchCase: false });
      results.load('items/text');
      return results;
    });
    await context.sync();
    // Same trust rule as when inserting: the full quote's first match, or a shorter candidate that is unique
    const hit = searches.find((results, k) => (k === 0 ? results.items.length > 0 : results.items.length === 1))?.items[0];
    if (!hit) return false;
    hit.select();
    await context.sync();
    return true;
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

async function loadParagraphs(context: Word.RequestContext, reviewedText = false, headings = false): Promise<(ParagraphInfo & { heading?: boolean })[]> {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load(headings ? 'items/text,items/isListItem,items/styleBuiltIn' : 'items/text,items/isListItem');
  await context.sync();
  // The number Word shows ("5.2.") is not part of paragraph.text
  const listItems = paragraphs.items.map(p => (p.isListItem ? p.listItemOrNullObject : null));
  listItems.forEach(item => item?.load('listString,level'));
  const texts = reviewedText ? paragraphs.items.map(p => p.getReviewedText('Current')) : null;
  await context.sync();
  return paragraphs.items.map((p, i) => {
    const item = listItems[i];
    const text = texts ? readable(texts[i].value || '').replace(/\r$/, '') : p.text;
    const info: ParagraphInfo & { heading?: boolean } = item && !item.isNullObject ? { text, listString: item.listString, listLevel: item.level } : { text };
    if (headings && HEADING_STYLE.test(String(p.styleBuiltIn))) info.heading = true;
    return info;
  });
}

/** Word's built-in heading styles (Címsor 1–9, Cím), whatever the language of Word */
const HEADING_STYLE = /^(Heading\d|Title)$/;

/**
 * The paragraphs to translate: the text as it reads with the pending tracked changes accepted, Word's automatic
 * number, and whether it is a heading
 */
export async function readParagraphsForTranslation(): Promise<(ParagraphInfo & { heading?: boolean })[]> {
  return Word.run(context => loadParagraphs(context, true, true));
}

/** Word's search treats ^ as a special character */
const wordSearchText = (text: string) => text.replace(/\^/g, '^^');

/** Opening a new document from the add-in needs WordApi 1.3 */
export const canOpenNewDocument = () => isSupported('1.3');

/** Opens a .docx (base64) as a new, unsaved document in a window of its own; the open document is not touched */
export async function openNewDocument(base64: string) {
  await Word.run(async (context) => {
    context.application.createDocument(base64).open();
    await context.sync();
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

/** Puts the cursor where a request from the structure view should work: the whole paragraph, or before it */
export async function placeAtParagraph(index: number, where: 'select' | 'before' | 'after', expectedText?: string) {
  await Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    const target = paragraphs.items[index];
    // The structure map is a snapshot: after an edit its paragraph numbers may point elsewhere
    if (!target || (expectedText !== undefined && !sameText(target.text, expectedText))) {
      throw new UserFacingError('A dokumentum változott, amióta a Szerkezet nézet beolvasta. Nyomd meg a Frissítés gombot, és próbáld újra.');
    }
    const place = where === 'select' ? target.getRange('Whole') : where === 'before' ? target.getRange('Start') : target.getRange('Content').getRange('End');
    place.select();
    await context.sync();
  });
}

/**
 * Deletes exact texts from paragraphs with Track Changes (e.g. an inline definition that the definitions section
 * made redundant). A paragraph that changed since the structure map was built is left alone.
 */
export async function deleteTextsInParagraphs(items: { paragraph: number; expectedText: string; text: string }[]): Promise<{ deleted: number; skipped: number; write: WriteMode }> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    const searches = items.map(item => {
      const paragraph = paragraphs.items[item.paragraph];
      if (!paragraph || !sameText(paragraph.text, item.expectedText) || item.text.length > 255) return null;
      const results = paragraph.search(item.text.replace(/\^/g, '^^'), { matchCase: true });
      results.load('items/text');
      return results;
    });
    await context.sync();
    const targets = searches.map(results => results?.items[0] ?? null);
    const { write } = await withTrackChanges(context, async () => {
      targets.forEach(range => range?.delete());
      await context.sync();
    });
    const deleted = targets.filter(Boolean).length;
    return { deleted, skipped: items.length - deleted, write };
  });
}

/** The pending tracked changes of the document, paragraph by paragraph */
export interface DocumentRevisions {
  /** Per Word paragraph: the text before the pending tracked changes */
  original: string[];
  /** Per Word paragraph: the text with them accepted (a deleted paragraph is empty) */
  current: string[];
  /** paragraph.text as Word reports it (deleted words included), to check later that a paragraph is the same */
  raw: string[];
  /** Who made the changes, per paragraph index; null when this Word can't tell (before WordApi 1.6) */
  authors: Map<number, string[]> | null;
}

/** Accepting, rejecting and reading the authors of tracked changes needs WordApi 1.6 (e.g. Microsoft 365) */
export const canResolveRevisions = canUndo;

/** Reads the document before and after its pending tracked changes, e.g. what the other side changed */
export async function readRevisions(): Promise<DocumentRevisions> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    const originals = paragraphs.items.map(p => p.getReviewedText('Original'));
    const currents = paragraphs.items.map(p => p.getReviewedText('Current'));
    await context.sync();
    const clean = (result: OfficeExtension.ClientResult<string>) => readable(result.value || '').replace(/\r$/, '');
    const original = originals.map(clean);
    const current = currents.map(clean);

    let authors: Map<number, string[]> | null = null;
    if (canResolveRevisions()) {
      const changed = original.map((text, i) => (text !== current[i] ? i : -1)).filter(i => i !== -1);
      const collections = changed.map(i => {
        const tracked = paragraphs.items[i].getRange('Whole').getTrackedChanges();
        tracked.load('items/author,items/type');
        return [i, tracked] as const;
      });
      await context.sync();
      // Only text changes: a formatting change does not alter the text shown
      authors = new Map(collections.map(([i, tracked]) => [i, [...new Set(tracked.items.filter(isTextChange).map(change => change.author).filter(Boolean))]]));
    }
    return { original, current, raw: paragraphs.items.map(p => p.text), authors };
  });
}

const isTextChange = (change: Word.TrackedChange) => change.type !== 'Formatted';

/**
 * Accepts or rejects the pending text changes in paragraphs, one tracked change at a time: changes of hidden
 * authors and formatting changes are left as they are. A paragraph whose text changed since it was read is left
 * alone (its index may point elsewhere by now).
 */
export async function resolveRevisions(
  items: { paragraph: number; expectedText: string }[],
  action: 'accept' | 'reject',
  hiddenAuthors: ReadonlySet<string> = new Set()
): Promise<{ resolved: number; skipped: number; leftAlone: number }> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load('items/text');
    await context.sync();
    const valid = items.filter(item => paragraphs.items[item.paragraph]?.text === item.expectedText);
    const collections = [...new Set(valid.map(item => item.paragraph))].map(index => {
      const tracked = paragraphs.items[index].getRange('Whole').getTrackedChanges();
      tracked.load('items/author,items/type');
      return tracked;
    });
    await context.sync();
    const all = collections.flatMap(tracked => tracked.items);
    const chosen = all.filter(change => isTextChange(change) && !hiddenAuthors.has(change.author));
    chosen.forEach(change => (action === 'accept' ? change.accept() : change.reject()));
    await context.sync();
    return { resolved: chosen.length, skipped: items.length - valid.length, leftAlone: all.length - chosen.length };
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

const FORMAT_PROPERTIES = 'items/text,items/styleBuiltIn,items/alignment,items/spaceAfter,items/spaceBefore,items/lineSpacing,items/firstLineIndent,items/leftIndent,items/rightIndent,items/isListItem,items/style,items/tableNestingLevel,items/font/name,items/font/size,items/font/bold,items/font/color';

/** Reading and changing the footnotes needs WordApi 1.5 */
export const canFormatFootnotes = () => isSupported('1.5');

/** The formatting of every paragraph (and of the footnotes, where Word can tell), for the Formázás tab */
export async function readFormatAudit(): Promise<FormatAudit> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    // Small capitals can only be read (and set) in desktop Word; asking for it elsewhere would fail the whole read
    paragraphs.load(canUseSmallCaps() ? `${FORMAT_PROPERTIES},items/font/smallCaps` : FORMAT_PROPERTIES);
    const notes = canFormatFootnotes() ? context.document.body.footnotes : null;
    notes?.load('items/body/font/name,items/body/font/size');
    await context.sync();
    const margins = await readMargins();
    return {
      margins,
      paragraphs: paragraphs.items.map(p => ({
        text: p.text,
        styleBuiltIn: String(p.styleBuiltIn),
        tableLevel: p.tableNestingLevel || 0,
        // Word gives "" or null for a paragraph with mixed fonts or sizes
        font: p.font.name || null,
        size: p.font.size || null,
        bold: typeof p.font.bold === 'boolean' ? p.font.bold : null,
        alignment: String(p.alignment),
        spaceBefore: p.spaceBefore || 0,
        spaceAfter: p.spaceAfter || 0,
        lineSpacing: p.lineSpacing || 0,
        firstLineIndent: p.firstLineIndent || 0,
        leftIndent: p.leftIndent || 0,
        rightIndent: p.rightIndent || 0,
        color: p.font.color || null,
        smallCaps: canUseSmallCaps() && typeof p.font.smallCaps === 'boolean' ? p.font.smallCaps : null,
        style: p.style || undefined,
        isList: !!p.isListItem,
      })),
      footnotes: notes ? notes.items.map(n => ({ font: n.body.font.name || null, size: n.body.font.size || null })) : null,
    };
  });
}

const isDesktopSupported = (version: string) =>
  typeof Office !== 'undefined' && !!Office.context?.requirements?.isSetSupported('WordApiDesktop', version);
/** Small capitals: WordApiDesktop 1.3 */
export const canUseSmallCaps = () => isDesktopSupported('1.3');
/** Style borders (the rule under a heading): WordApiDesktop 1.1 */
export const canSetStyleBorders = () => isDesktopSupported('1.1');

/** Page margins need WordApiDesktop 1.3 (desktop Word); elsewhere they are not offered */
export const canSetMargins = () => typeof Office !== 'undefined' && !!Office.context?.requirements?.isSetSupported('WordApiDesktop', '1.3');

async function readMargins(): Promise<PageMargins[] | null> {
  if (!canSetMargins()) return null;
  try {
    return await Word.run(async (context) => {
      const sections = context.document.sections;
      sections.load('items');
      await context.sync();
      const setups = sections.items.map(section => {
        const setup = (section as unknown as { pageSetup: Word.PageSetup }).pageSetup;
        setup.load('topMargin,bottomMargin,leftMargin,rightMargin');
        return setup;
      });
      await context.sync();
      return setups.map(m => ({ top: m.topMargin, bottom: m.bottomMargin, left: m.leftMargin, right: m.rightMargin }));
    });
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** The font, size and spacing of the paragraph the cursor is in: "like this one" for the style profile */
export async function readSelectionFormat(): Promise<{ font: string | null; size: number | null; spaceBefore: number; spaceAfter: number; lineSpacing: number; firstLineIndent: number; leftIndent: number; rightIndent: number; alignment: string }> {
  return Word.run(async (context) => {
    const paragraph = context.document.getSelection().paragraphs.getFirst();
    paragraph.load('alignment,spaceBefore,spaceAfter,lineSpacing,firstLineIndent,leftIndent,rightIndent,font/name,font/size');
    await context.sync();
    return { font: paragraph.font.name || null, size: paragraph.font.size || null, spaceBefore: paragraph.spaceBefore || 0, spaceAfter: paragraph.spaceAfter || 0, lineSpacing: paragraph.lineSpacing || 0, firstLineIndent: paragraph.firstLineIndent || 0, leftIndent: paragraph.leftIndent || 0, rightIndent: paragraph.rightIndent || 0, alignment: String(paragraph.alignment) };
  });
}

export interface FormatOutcome {
  /** Word styles updated (Normal, Címsor 1…) */
  styles: number;
  /** Text clean-up places changed (non-breaking spaces, dashes, ranges, spacing, Markdown) and quotation marks */
  cleaned: number;
  quotes: number;
  formatted: number;
  /** Heading styles that now keep their paragraph with the next one */
  keepWithNext: number;
  /** Sections whose margins were set */
  margins: number;
  /** What this Word could not do (said to the user) */
  notes: string[];
  footnotes: number;
  deleted: number;
  spaces: number;
  /** How the text changes went in; null when there were none */
  write: WriteMode | null;
}

/**
 * Applies a formatting plan. The formatting goes in without Track Changes (a tracked formatting change is only
 * noise for the other side); Word's own setting is put back afterwards. The text changes (extra empty lines, double
 * spaces) follow the usual Track Changes rule. Nothing happens when the document changed since it was read.
 */
export async function applyFormatPlan(plan: FormatPlan, expectedTexts: string[]): Promise<FormatOutcome> {
  return Word.run(async (context) => {
    const doc = context.document;
    const paragraphs = doc.body.paragraphs;
    paragraphs.load('items/text');
    doc.load('changeTrackingMode');
    await context.sync();
    if (paragraphs.items.length !== expectedTexts.length || paragraphs.items.some((p, i) => p.text !== expectedTexts[i])) {
      throw new UserFacingError('A dokumentum változott az átvilágítás óta, ezért nem nyúltam hozzá. Nyomd meg újra az Átvilágítás gombot.');
    }
    const previous = doc.changeTrackingMode;
    let footnotes = 0;
    try {
      if (previous !== 'Off') doc.changeTrackingMode = 'Off';
      for (const change of plan.changes) {
        const p = paragraphs.items[change.index];
        if (change.font !== undefined) p.font.name = change.font;
        if (change.size !== undefined) p.font.size = change.size;
        if (change.bold) p.font.bold = true;
        if (change.spaceBefore !== undefined) p.spaceBefore = change.spaceBefore;
        if (change.spaceAfter !== undefined) p.spaceAfter = change.spaceAfter;
        if (change.lineSpacing !== undefined) p.lineSpacing = change.lineSpacing;
        if (change.firstLineIndent !== undefined) p.firstLineIndent = change.firstLineIndent;
        if (change.leftIndent !== undefined) p.leftIndent = change.leftIndent;
        if (change.rightIndent !== undefined) p.rightIndent = change.rightIndent;
        if (change.color !== undefined) p.font.color = change.color;
        if (change.smallCaps && canUseSmallCaps()) p.font.smallCaps = true;
        if (change.alignment !== undefined) p.alignment = change.alignment as Word.Alignment;
      }
      if (plan.footnotes && canFormatFootnotes()) {
        const notes = doc.body.footnotes;
        notes.load('items');
        await context.sync();
        notes.items.forEach(n => {
          if (plan.footnotes!.font) n.body.font.name = plan.footnotes!.font;
          if (plan.footnotes!.size) n.body.font.size = plan.footnotes!.size;
        });
        footnotes = notes.items.length;
      }
      await context.sync();
    } finally {
      if (previous !== 'Off') {
        doc.changeTrackingMode = previous;
        await context.sync().catch(() => Word.run(async (fresh) => {
          fresh.document.changeTrackingMode = previous;
          await fresh.sync();
        }).catch(() => {}));
      }
    }

    // Page-break rule and margins: a part of Word that is missing gives a note, not a failure of the rest
    const notes: string[] = [];
    if (plan.changes.some(c => c.smallCaps) && !canUseSmallCaps()) notes.push('A kiskapitálist ez a Word innen nem tudja beállítani (asztali Word kell hozzá).');
    let styles = 0;
    if (plan.styleUpdates.length) {
      if (!isSupported('1.5')) {
        notes.push('A Word saját stílusait ez a Word innen nem tudja frissíteni (WordApi 1.5 kell); a bekezdések formázása megtörtént.');
      } else {
        try {
          if (previous !== 'Off') doc.changeTrackingMode = 'Off';
          const collection = doc.getStyles();
          const found = plan.styleUpdates.map(update => {
            const style = collection.getByNameOrNullObject(update.name);
            style.load('isNullObject');
            return { update, style };
          });
          await context.sync();
          let bordersSkipped = false;
          for (const { update, style } of found) {
            if (style.isNullObject) continue;
            const { font, paragraph, border } = update;
            if (font.name !== undefined) style.font.name = font.name;
            if (font.size !== undefined) style.font.size = font.size;
            if (font.bold !== undefined) style.font.bold = font.bold;
            if (font.color !== undefined) style.font.color = font.color;
            if (font.smallCaps !== undefined && canUseSmallCaps()) style.font.smallCaps = font.smallCaps;
            if (paragraph?.spaceBefore !== undefined) style.paragraphFormat.spaceBefore = paragraph.spaceBefore;
            if (paragraph?.spaceAfter !== undefined) style.paragraphFormat.spaceAfter = paragraph.spaceAfter;
            if (paragraph?.lineSpacing !== undefined) style.paragraphFormat.lineSpacing = paragraph.lineSpacing;
            if (paragraph?.alignment !== undefined) style.paragraphFormat.alignment = paragraph.alignment;
            if (border) {
              if (canSetStyleBorders()) {
                const line = style.borders.getByLocation(border.location);
                line.type = 'Single';
                line.width = 'Pt100';
                line.color = border.color;
                line.visible = true;
              } else {
                bordersSkipped = true;
              }
            }
            styles++;
          }
          await context.sync();
          if (bordersSkipped) notes.push('A címek díszvonalát ez a Word nem tudja beállítani (asztali Word kell hozzá).');
        } catch (e) {
          console.error(e);
          styles = 0;
          notes.push('A Word saját stílusait nem sikerült frissíteni; a bekezdések formázása megtörtént.');
        } finally {
          if (previous !== 'Off') {
            doc.changeTrackingMode = previous;
            await context.sync().catch(() => {});
          }
        }
      }
    }
    let keepWithNext = 0;
    let marginSections = 0;
    if (plan.keepWithNextStyles.length) {
      if (!isSupported('1.5')) {
        notes.push('A „címsor együtt marad a következő bekezdéssel” szabályhoz újabb Word kell (WordApi 1.5).');
      } else {
        try {
          if (previous !== 'Off') doc.changeTrackingMode = 'Off';
          const styles = doc.getStyles();
          const found = plan.keepWithNextStyles.map(name => {
            const style = styles.getByNameOrNullObject(name);
            style.load('isNullObject');
            return style;
          });
          await context.sync();
          found.forEach(style => {
            if (!style.isNullObject) {
              style.paragraphFormat.keepWithNext = true;
              keepWithNext++;
            }
          });
          await context.sync();
        } catch (e) {
          console.error(e);
          keepWithNext = 0;
          notes.push('A „címsor együtt marad a következő bekezdéssel” szabályt nem sikerült beállítani.');
        } finally {
          if (previous !== 'Off') {
            doc.changeTrackingMode = previous;
            await context.sync().catch(() => {});
          }
        }
      }
    }
    if (plan.margins) {
      if (!canSetMargins()) {
        notes.push('Az oldalmargókat ez a Word nem engedi beállítani innen (asztali Word kell hozzá).');
      } else {
        try {
          if (previous !== 'Off') doc.changeTrackingMode = 'Off';
          const sections = doc.sections;
          sections.load('items');
          await context.sync();
          sections.items.forEach(section => {
            const setup = (section as unknown as { pageSetup: Word.PageSetup }).pageSetup;
            if (plan.margins!.top !== undefined) setup.topMargin = plan.margins!.top;
            if (plan.margins!.bottom !== undefined) setup.bottomMargin = plan.margins!.bottom;
            if (plan.margins!.left !== undefined) setup.leftMargin = plan.margins!.left;
            if (plan.margins!.right !== undefined) setup.rightMargin = plan.margins!.right;
          });
          await context.sync();
          marginSections = sections.items.length;
        } catch (e) {
          console.error(e);
          notes.push('Az oldalmargókat nem sikerült beállítani.');
        } finally {
          if (previous !== 'Off') {
            doc.changeTrackingMode = previous;
            await context.sync().catch(() => {});
          }
        }
      }
    }

    let deleted = 0;
    let spaces = 0;
    let cleaned = 0;
    let quotes = 0;
    let write: WriteMode | null = null;
    if (plan.textFixes.length || plan.deleteEmpty.length || plan.doubleSpaces) {
      ({ write } = await withTrackChanges(context, async () => {
        // Text clean-up. 1) Markdown **bold** and *italic*: the format comes, the asterisks go
        const marked = plan.textFixes.flatMap(fix => {
          const paragraph = paragraphs.items[fix.index];
          return [...fix.bold.map(text => ({ marker: '**', text, bold: true })), ...fix.italic.map(text => ({ marker: '*', text, bold: false }))].map(m => {
            const found = paragraph.search(wordSearchText(`${m.marker}${m.text}${m.marker}`), { matchCase: true });
            found.load('items');
            return { m, found };
          });
        });
        if (marked.length) {
          await context.sync();
          const stars = marked.flatMap(({ m, found }) => found.items.map(range => {
            if (m.bold) range.font.bold = true;
            else range.font.italic = true;
            const markers = range.search(m.marker, { matchCase: true });
            markers.load('items');
            return markers;
          }));
          await context.sync();
          stars.forEach(markers => {
            // The text between has no asterisk: the first and the last found are the markers
            if (markers.items.length < 2) return;
            markers.items[0].delete();
            markers.items[markers.items.length - 1].delete();
            cleaned++;
          });
          await context.sync();
        }

        // 2) Replacements, one round at a time: each search sees the earlier changes, so nothing is replaced twice
        const ordered = plan.textFixes.map(fix => ({ fix, list: [...fix.replacements].sort((a, b) => b.find.length - a.find.length) }));
        const rounds = Math.max(0, ...ordered.map(o => o.list.length));
        for (let round = 0; round < rounds; round++) {
          const searches = ordered.filter(o => o.list[round]).map(({ fix, list }) => {
            const replacement = list[round];
            const found = paragraphs.items[fix.index].search(wordSearchText(replacement.find), { matchCase: true });
            found.load('items');
            return { replacement, found };
          });
          await context.sync();
          searches.forEach(({ replacement, found }) => found.items.forEach(range => {
            range.insertText(replacement.replace, 'Replace');
            cleaned++;
          }));
          await context.sync();
        }

        // 3) Straight quotes, paired in order
        const quoteSearches = plan.textFixes.filter(fix => fix.quotes.length).map(fix => {
          const quoteMarks = paragraphs.items[fix.index].search('"', { matchCase: true });
          quoteMarks.load('items/text');
          return { fix, quoteMarks };
        });
        await context.sync();
        let quotesSkipped = 0;
        for (const { fix, quoteMarks } of quoteSearches) {
          // Word may find curly quotes for a straight one too: only the straight ones count, and only when their
          // number is the one planned
          const straight = quoteMarks.items.filter(range => range.text === '"');
          if (straight.length === fix.quotes.length) {
            straight.forEach((range, i) => range.insertText(fix.quotes[i], 'Replace'));
            quotes += straight.length;
          } else {
            quotesSkipped++;
          }
        }
        await context.sync();
        if (quotesSkipped) notes.push(`${quotesSkipped} bekezdésben az idézőjeleket nem cseréltem (nem egyértelmű a párosításuk).`);

        // Only paragraphs still empty; one holding a picture is kept
        const candidates = plan.deleteEmpty.map(i => paragraphs.items[i]).filter(p => p && isBlank(p.text));
        const pictures = candidates.map(p => {
          const items = p.inlinePictures;
          items.load('items');
          return items;
        });
        await context.sync();
        candidates.forEach((p, i) => {
          if (pictures[i].items.length) return;
          p.delete();
          deleted++;
        });
        await context.sync();
        // Three spaces in a row need two rounds; stop when a round finds no fewer
        let last = Infinity;
        for (let round = 0; plan.doubleSpaces && round < 4; round++) {
          const found = doc.body.search('  ', { matchCase: true });
          found.load('items');
          await context.sync();
          if (!found.items.length || found.items.length >= last) break;
          last = found.items.length;
          found.items.forEach(r => r.insertText(' ', 'Replace'));
          spaces += found.items.length;
          await context.sync();
        }
      }));
    }
    return { formatted: plan.changes.length, styles, cleaned, quotes, keepWithNext, margins: marginSections, notes, footnotes, deleted, spaces, write };
  });
}

/**
 * The whole document as a .docx file, exactly as it is now (tracked changes and comments included): the "previous
 * state" kept before the formatting is changed
 */
export function readDocumentFile(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(Office.FileType.Compressed, { sliceSize: 4 * 1024 * 1024 }, (result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) {
        reject(result.error);
        return;
      }
      const file = result.value;
      const slices: Uint8Array[] = [];
      const fail = (error: unknown) => file.closeAsync(() => reject(error));
      const next = (index: number) => file.getSliceAsync(index, (slice) => {
        if (slice.status !== Office.AsyncResultStatus.Succeeded) {
          fail(slice.error);
          return;
        }
        slices.push(new Uint8Array(slice.value.data));
        if (index + 1 < file.sliceCount) {
          next(index + 1);
          return;
        }
        file.closeAsync();
        const bytes = new Uint8Array(slices.reduce((n, s) => n + s.length, 0));
        let at = 0;
        slices.forEach(s => {
          bytes.set(s, at);
          at += s.length;
        });
        resolve(bytes);
      });
      next(0);
    });
  });
}
