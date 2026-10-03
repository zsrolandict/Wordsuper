import React, { useMemo, useState } from 'react';
import { Check, RefreshCw, X, Loader2, SearchX, Lightbulb, LocateFixed, Ban } from 'lucide-react';
import { unresolvedMessage } from '../services/masking';
import type { Mode, ReviewFinding } from '../shared/aiConfig';
import { diffForDisplay } from '../services/textDiff';
import { SEVERITY_LABELS, cleanQuote } from '../services/review';
import { editHunks, planDocumentEdits } from '../services/documentEdit';

export type ProposalState = 'pending' | 'applying' | 'applied' | 'rejected' | 'superseded';

export interface FindingView extends ReviewFinding {
  /** Insert as a margin comment */
  selected: boolean;
  /** Write the suggested wording into the text (only when there is a suggestion) */
  fix: boolean;
  /** Set after inserting: the quote could not be found in the document */
  notFound?: boolean;
  /** Set after inserting: the fix could not be applied, the quote was not found word for word */
  fixFailed?: boolean;
  /** Set after inserting: the fix was not written, it would have deleted a footnote, a field… */
  fixProtected?: boolean;
  /** Decided one by one: inserted, or thrown away */
  done?: 'applied' | 'dismissed';
  /** "Mutasd" found nothing */
  notShown?: boolean;
  /** Placeholders the finding still has after unmasking: it can't be inserted */
  blocked?: string[];
}

export interface FindingActions {
  onToggle: (index: number, field: 'selected' | 'fix') => void;
  onShow: (index: number) => void;
  onApplyOne: (index: number) => void;
  onDismiss: (index: number) => void;
  /** Takes a dismissed finding back into the list */
  onRestore: (index: number) => void;
}

export const SEVERITY_STYLES = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-neutral-200 text-neutral-700',
};

/** Word-level changes: deleted words struck through in red, new words in green */
export function DiffView({ original, proposal }: { original: string; proposal: string }) {
  const segments = useMemo(() => diffForDisplay(original, proposal), [original, proposal]);
  if (!segments) return <span className="whitespace-pre-wrap">{proposal}</span>;
  if (segments.every(s => s.type === 'equal')) {
    return <span className="whitespace-pre-wrap">{proposal}<span className="block mt-1 text-xs text-neutral-500">Nincs változás az eredetihez képest.</span></span>;
  }

  let atLineStart = true;
  return (
    <span className="whitespace-pre-wrap">
      {segments.map((segment, i) => {
        // Words are joined with spaces, line breaks are kept as they are
        const text = segment.tokens.map(token => {
          const isBreak = token.startsWith('\n');
          const piece = isBreak || atLineStart ? token : ` ${token}`;
          atLineStart = isBreak;
          return piece;
        }).join('');
        if (segment.type === 'removed') return <del key={i} className="bg-red-50 text-red-700 decoration-red-400">{text}</del>;
        if (segment.type === 'added') return <ins key={i} className="bg-green-50 text-green-800 no-underline border-b border-green-400">{text}</ins>;
        return <React.Fragment key={i}>{text}</React.Fragment>;
      })}
    </span>
  );
}

/**
 * The changes of an edit, each one clickable: a left-out change shows the original words again and is not written
 * into the document. Falls back to the plain diff when the paragraphs don't line up.
 */
function SelectableDiff({ original, proposal, excluded, onToggle }: { original: string; proposal: string; excluded: number[]; onToggle?: (id: number) => void }) {
  const hunks = useMemo(() => editHunks(original, proposal), [original, proposal]);
  if (!hunks || hunks.count < 2 || !onToggle) return <DiffView original={original} proposal={proposal} />;
  const off = new Set(excluded);
  return (
    <div>
      <p className="text-[11px] text-neutral-500 mb-1">Kattints egy változásra, ha azt nem kéred ({hunks.count - off.size}/{hunks.count} kiválasztva).</p>
      {hunks.paragraphs.map((_, index) => {
        const words = hunks.tokens[index];
        const changes = hunks.plan.find(e => e.paragraphIndex === index)?.hunks ?? [];
        const parts: React.ReactNode[] = [];
        let at = 0;
        for (const change of changes) {
          if (change.oldStart > at) parts.push(words.slice(at, change.oldStart).join(' ') + ' ');
          const left = off.has(change.id);
          const removed = words.slice(change.oldStart, change.oldEnd).join(' ');
          const added = change.newTokens.join(' ');
          parts.push(
            <button
              key={change.id}
              onClick={() => onToggle(change.id)}
              title={left ? 'Kihagyva: az eredeti marad. Kattints, ha mégis kéred.' : 'Kattints, ha ezt a változást nem kéred'}
              className={`rounded px-0.5 mr-1 border ${left ? 'border-dashed border-neutral-300 bg-neutral-50' : 'border-transparent hover:border-blue-300'}`}
            >
              {removed && (left
                ? <span className="text-neutral-800">{removed}</span>
                : <del className="bg-red-50 text-red-700 decoration-red-400">{removed}</del>)}
              {removed && added && ' '}
              {added && (left
                ? <span className="text-neutral-400 line-through">{added}</span>
                : <ins className="bg-green-50 text-green-800 no-underline border-b border-green-400">{added}</ins>)}
            </button>
          );
          at = change.oldEnd;
        }
        if (at < words.length) parts.push(words.slice(at).join(' '));
        return <p key={index} className="whitespace-pre-wrap min-h-[1em]">{parts}</p>;
      })}
    </div>
  );
}

/** A rewrite of the whole document: only the paragraphs that change, new or go, not the whole text */
function DocumentChangesView({ original, proposal, onShowParagraph, excluded = [], onToggle }: {
  original: string;
  proposal: string;
  onShowParagraph?: (index: number) => void;
  /** Indexes of the changes left out */
  excluded?: number[];
  onToggle?: (index: number) => void;
}) {
  const oldParagraphs = useMemo(() => original.split('\n'), [original]);
  const ops = useMemo(() => planDocumentEdits(oldParagraphs, proposal), [oldParagraphs, proposal]);
  if (!ops.length) return <span className="text-xs text-neutral-500">Nincs változás a dokumentumhoz képest.</span>;
  // A heading per change, with a jump to the paragraph in the document
  const label = (text: string, paragraph: number, i: number) => (
    <span className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-0.5">
      {onToggle ? (
        <label className="flex items-center cursor-pointer">
          <input type="checkbox" checked={!excluded.includes(i)} onChange={() => onToggle(i)} className="mr-1" />
          {text}
        </label>
      ) : text}
      {onShowParagraph && (
        <button onClick={() => onShowParagraph(paragraph)} className="flex items-center normal-case tracking-normal font-medium text-blue-700 hover:text-blue-900">
          <LocateFixed className="w-3 h-3 mr-0.5" />Mutasd
        </button>
      )}
    </span>
  );
  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500">Csak a változó részeket mutatom, a dokumentum többi része érintetlen marad.</p>
      {ops.map((op, i) => (
        <div key={i} className={`border-l-2 border-neutral-200 pl-2 ${excluded.includes(i) ? 'opacity-40' : ''}`}>
          {op.type === 'edit' ? (
            <>{label(`${op.paragraph + 1}. bekezdés – módosul`, op.paragraph, i)}<DiffView original={oldParagraphs[op.paragraph]} proposal={op.newText} /></>
          ) : op.type === 'delete' ? (
            <>{label(`${op.paragraph + 1}. bekezdés – törlődik`, op.paragraph, i)}<del className="bg-red-50 text-red-700 whitespace-pre-wrap">{oldParagraphs[op.paragraph]}</del></>
          ) : (
            <>
              {label(op.after === -1 ? 'Új bekezdés a dokumentum elején' : `Új bekezdés a(z) ${op.after + 1}. után`, Math.max(op.after, 0), i)}
              {op.texts.map((text, k) => <ins key={k} className="block no-underline bg-green-50 text-green-800 whitespace-pre-wrap">{text}</ins>)}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

const smallButton = 'flex items-center px-2 py-1 text-[11px] font-medium rounded-md border disabled:opacity-50';

function FindingsList({ findings, editable, busy, actions }: { findings: FindingView[]; editable: boolean; busy: boolean; actions: FindingActions }) {
  const { onToggle, onShow, onApplyOne, onDismiss, onRestore } = actions;
  return (
    <ul className="space-y-2">
      {findings.map((finding, i) => {
        const missed = finding.notFound || finding.fixFailed || finding.fixProtected;
        return (
          <li key={i} className={`border rounded-lg p-2 ${finding.done === 'dismissed' ? 'opacity-50 border-neutral-200' : missed ? 'border-amber-300 bg-amber-50' : finding.done === 'applied' ? 'border-green-200 bg-green-50' : 'border-neutral-200 bg-neutral-50'}`}>
            {finding.done && (
              <span className={`flex items-center justify-between text-[11px] font-semibold mb-0.5 ${finding.done === 'applied' ? 'text-green-700' : 'text-neutral-500'}`}>
                {finding.done === 'applied' ? '✓ Beszúrva' : '✖ Elvetve'}
                {finding.done === 'dismissed' && editable && (
                  <button onClick={() => onRestore(i)} disabled={busy} className="font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50">Visszaállítom</button>
                )}
              </span>
            )}
            <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mr-1 ${SEVERITY_STYLES[finding.severity]}`}>
              {SEVERITY_LABELS[finding.severity]}
            </span>
            <span className="text-xs italic text-neutral-500 break-words">„{cleanQuote(finding.quote)}”</span>
            <span className="block text-sm mt-1">{finding.comment}</span>
            {finding.suggestion && (
              <span className="block mt-1.5 text-xs bg-white border border-neutral-200 rounded-md p-1.5">
                <span className="block font-semibold text-neutral-600 mb-0.5">Javasolt szöveg:</span>
                <DiffView original={cleanQuote(finding.quote)} proposal={finding.suggestion} />
              </span>
            )}
            {finding.blocked && !finding.done && (
              <span className="flex items-start text-xs text-red-700 mt-1.5">
                <Ban className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
                Nem szúrható be: fel nem oldott helyettesítő maradt benne ({finding.blocked.join(', ')}), mögötte nincs valódi adat.
              </span>
            )}
            {editable && !finding.done && !finding.blocked && (
              <span className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs text-neutral-700">
                <label className="flex items-center cursor-pointer">
                  <input type="checkbox" checked={finding.selected} onChange={() => onToggle(i, 'selected')} className="mr-1" />
                  Megjegyzés
                </label>
                {finding.suggestion && (
                  <label className="flex items-center cursor-pointer">
                    <input type="checkbox" checked={finding.fix} onChange={() => onToggle(i, 'fix')} className="mr-1" />
                    Javítás korrektúrával
                  </label>
                )}
              </span>
            )}
            {/* One by one: look at it in the document, then take it or leave it */}
            {(editable || finding.done === 'applied') && finding.done !== 'dismissed' && (
              <span className="flex flex-wrap gap-1.5 mt-1.5">
                <button onClick={() => onShow(i)} disabled={busy} className={`${smallButton} border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100`} title="Kijelöli az idézett részt a dokumentumban">
                  <LocateFixed className="w-3 h-3 mr-1" />Mutasd
                </button>
                {editable && !finding.done && (
                  <>
                    <button
                      onClick={() => onApplyOne(i)}
                      disabled={busy || !!finding.blocked || (!finding.selected && !(finding.fix && finding.suggestion))}
                      className={`${smallButton} border-blue-600 bg-blue-600 text-white hover:bg-blue-700`}
                      title="Csak ezt az észrevételt szúrja be (a bejelöltek szerint), és odaugrik"
                    >
                      <Check className="w-3 h-3 mr-1" />Elfogadom
                    </button>
                    <button onClick={() => onDismiss(i)} disabled={busy} className={`${smallButton} border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100`}>
                      <X className="w-3 h-3 mr-1" />Elvetem
                    </button>
                  </>
                )}
              </span>
            )}
            {finding.notShown && (
              <span className="flex items-center text-xs text-amber-700 mt-1">
                <SearchX className="w-3.5 h-3.5 mr-1 shrink-0" />
                Ezt a részt nem találom szó szerint a dokumentumban.
              </span>
            )}
            {finding.notFound && (
              <span className="flex items-center text-xs text-amber-700 mt-1">
                <SearchX className="w-3.5 h-3.5 mr-1 shrink-0" />
                Nem találtam meg szó szerint a dokumentumban, ezért a megjegyzés nem került be.
              </span>
            )}
            {finding.fixProtected && (
              <span className="flex items-center text-xs text-amber-700 mt-1">
                <SearchX className="w-3.5 h-3.5 mr-1 shrink-0" />
                A javítást nem írtam be: lábjegyzetet, mezőt (pl. kereszthivatkozást) vagy képet törölne. Ezt a részt írd át kézzel.
              </span>
            )}
            {finding.fixFailed && (
              <span className="flex items-center text-xs text-amber-700 mt-1">
                <SearchX className="w-3.5 h-3.5 mr-1 shrink-0" />
                A javítást nem írtam be: az idézett szöveget nem találtam meg pontosan így a dokumentumban.{finding.selected && !finding.notFound ? ' A javasolt szöveg a megjegyzésbe került.' : ''}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const APPLY_LABELS: Record<Mode, string> = {
  edit: 'Elfogadom',
  generate: 'Beszúrás',
  comment: 'Megjegyzés beszúrása',
  review: 'Beszúrás',
  compare: 'Megjegyzések beszúrása',
  translate: 'Beszúrás',
};

export default function Proposal({
  mode,
  originalText,
  text,
  state,
  findings,
  busy,
  onApply,
  onReject,
  onAlternative,
  findingActions,
  onRecheck,
  onShow,
  onShowParagraph,
  excluded = [],
  onToggleChange,
  explanation,
  addExplanation,
  onToggleExplanation,
  wholeDocument = false,
  blocked,
}: {
  mode: Mode;
  originalText: string;
  text: string;
  state: ProposalState;
  findings?: FindingView[];
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
  onAlternative: () => void;
  findingActions: FindingActions;
  /** Review: check the result again after only part of the findings was taken */
  onRecheck?: () => void;
  /** Selects the place the proposal is for (its selection or insertion point) */
  onShow?: () => void;
  /** Whole-document edit: jumps to a paragraph of the document */
  onShowParagraph?: (index: number) => void;
  /** Edit: the changes left out (word-level places, or paragraphs of a whole-document edit) */
  excluded?: number[];
  onToggleChange?: (id: number) => void;
  explanation?: string;
  addExplanation?: boolean;
  onToggleExplanation?: () => void;
  /** Edit without a selection: originalText is the whole document, one paragraph per line */
  wholeDocument?: boolean;
  /** Unresolved placeholders in the answer: it can't be inserted */
  blocked?: string[];
}) {
  const [showChanges, setShowChanges] = useState(true);
  const isOpen = state === 'pending' || state === 'applying';
  // Every change of an edit left out: nothing to accept
  const changeCount = useMemo(() => {
    if (mode !== 'edit') return 0;
    return wholeDocument ? planDocumentEdits(originalText.split('\n'), text).length : editHunks(originalText, text)?.count ?? 0;
  }, [mode, wholeDocument, originalText, text]);
  const allLeftOut = mode === 'edit' && changeCount > 0 && excluded.length >= changeCount;
  // The batch button covers the findings not decided one by one yet
  const open = findings?.filter(f => !f.done) ?? [];
  const commentCount = open.filter(f => f.selected).length;
  const fixCount = open.filter(f => f.fix && f.suggestion).length;
  const hasSuggestions = findings?.some(f => f.suggestion) ?? false;

  return (
    <div>
      {mode === 'review' && findings ? (
        <>
          <p className="mb-2">
            {findings.length} észrevételt találtam.{' '}
            {isOpen && (hasSuggestions
              ? 'Mindegyiknél eldöntheted, hogy megjegyzésként, javításként (korrektúrával) vagy mindkettőként kerüljön be:'
              : 'Válaszd ki, melyik kerüljön be megjegyzésként:')}
          </p>
          <FindingsList findings={findings} editable={state === 'pending'} busy={busy} actions={findingActions} />
          {onRecheck && findings.some(f => f.done === 'applied') && findings.some(f => f.done === 'dismissed') && (
            <div className="mt-2 text-xs bg-blue-50 border border-blue-200 rounded-lg p-2">
              <p className="text-blue-900">
                {findings.filter(f => f.done === 'applied').length} észrevételt fogadtál el, {findings.filter(f => f.done === 'dismissed').length}-t vetettél el.
                Az észrevételek összefügghetnek (számozás, hivatkozások, fogalmak, logika), ezért érdemes a döntéseid után újra átnézni a dokumentumot.
              </p>
              <button onClick={onRecheck} disabled={busy} className="mt-1.5 flex items-center px-2.5 py-1 text-[11px] font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-md">
                <RefreshCw className="w-3 h-3 mr-1" />Ellenőrző átvizsgálás
              </button>
            </div>
          )}
        </>
      ) : mode === 'edit' ? (
        <>
          <div className="flex space-x-1 mb-2 text-[11px]">
            {[true, false].map(changes => (
              <button
                key={String(changes)}
                onClick={() => setShowChanges(changes)}
                className={`px-2 py-0.5 rounded-full border ${showChanges === changes ? 'bg-neutral-800 text-white border-neutral-800' : 'border-neutral-300 text-neutral-600 hover:bg-neutral-100'}`}
              >
                {changes ? 'Változások' : 'Új szöveg'}
              </button>
            ))}
          </div>
          {!showChanges
            ? <span className="whitespace-pre-wrap">{text}</span>
            : wholeDocument
            ? <DocumentChangesView original={originalText} proposal={text} onShowParagraph={onShowParagraph} excluded={excluded} onToggle={state === 'pending' ? onToggleChange : undefined} />
            : <SelectableDiff original={originalText} proposal={text} excluded={excluded} onToggle={state === 'pending' ? onToggleChange : undefined} />}
          {explanation && (
            <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded-md p-2">
              <p className="flex items-center font-semibold text-amber-900 mb-0.5"><Lightbulb className="w-3.5 h-3.5 mr-1" />Miért?</p>
              <p className="whitespace-pre-wrap text-neutral-700">{explanation}</p>
              {state === 'pending' && onToggleExplanation && (
                <label className="flex items-center mt-1.5 cursor-pointer text-neutral-700">
                  <input type="checkbox" checked={!!addExplanation} onChange={onToggleExplanation} className="mr-1" />
                  Magyarázó megjegyzés is a módosításhoz
                </label>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <span className="whitespace-pre-wrap">{text}</span>
          {mode === 'generate' && isOpen && (
            <span className="block mt-1.5 text-[11px] text-neutral-500">Oda kerül, ahol a kurzor a kérés elküldésekor állt (akkor is, ha azóta máshova kattintottál). A „Mutasd” gomb megmutatja.</span>
          )}
        </>
      )}

      {isOpen && !!blocked?.length && (
        <p className="mt-2 flex items-start text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
          <Ban className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
          {unresolvedMessage(blocked).replace(/^⛔ /, '')}
        </p>
      )}

      {isOpen && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onApply}
              disabled={busy || state === 'applying' || (mode === 'review' && commentCount + fixCount === 0) || allLeftOut || !!blocked?.length}
              className="flex items-center px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors"
            >
              {state === 'applying' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
              {mode === 'review'
                ? `${findings && open.length < findings.length ? 'A többi kijelölt' : 'Az összes kijelölt'} beszúrása (${[commentCount && `${commentCount} megjegyzés`, fixCount && `${fixCount} javítás`].filter(Boolean).join(', ') || '0'})`
                : excluded.length && mode === 'edit' ? 'Elfogadom a kiválasztottakat' : APPLY_LABELS[mode]}
            </button>
            {onShow && (
              <button
                onClick={onShow}
                disabled={busy}
                className="flex items-center px-3 py-1.5 text-xs font-medium bg-white hover:bg-neutral-100 disabled:opacity-50 border border-neutral-300 text-neutral-700 rounded-lg transition-colors"
                title="Kijelöli a dokumentumban, mire vonatkozik a javaslat"
              >
                <LocateFixed className="w-3.5 h-3.5 mr-1" />
                Mutasd
              </button>
            )}
            <button
              onClick={onAlternative}
              disabled={busy || state === 'applying'}
              className="flex items-center px-3 py-1.5 text-xs font-medium bg-white hover:bg-neutral-100 disabled:opacity-50 border border-neutral-300 text-neutral-700 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" />
              Másik változat
            </button>
            <button
              onClick={onReject}
              disabled={busy || state === 'applying'}
              className="flex items-center px-3 py-1.5 text-xs font-medium bg-white hover:bg-neutral-100 disabled:opacity-50 border border-neutral-300 text-neutral-700 rounded-lg transition-colors"
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Elvetés
            </button>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">Finomítanád? Írd be alul, pl. „legyen rövidebb” vagy „tegeződve”.</p>
        </div>
      )}
    </div>
  );
}
