import React, { useMemo, useState } from 'react';
import { Check, RefreshCw, X, Loader2, SearchX, Lightbulb } from 'lucide-react';
import type { Mode, ReviewFinding } from '../shared/aiConfig';
import { diffForDisplay } from '../services/textDiff';
import { SEVERITY_LABELS, cleanQuote } from '../services/review';
import { planDocumentEdits } from '../services/documentEdit';

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

/** A rewrite of the whole document: only the paragraphs that change, new or go, not the whole text */
function DocumentChangesView({ original, proposal }: { original: string; proposal: string }) {
  const oldParagraphs = useMemo(() => original.split('\n'), [original]);
  const ops = useMemo(() => planDocumentEdits(oldParagraphs, proposal), [oldParagraphs, proposal]);
  if (!ops.length) return <span className="text-xs text-neutral-500">Nincs változás a dokumentumhoz képest.</span>;
  const label = (text: string) => <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-400 mb-0.5">{text}</span>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-neutral-500">Csak a változó részeket mutatom, a dokumentum többi része érintetlen marad.</p>
      {ops.map((op, i) => (
        <div key={i} className="border-l-2 border-neutral-200 pl-2">
          {op.type === 'edit' ? (
            <>{label(`${op.paragraph + 1}. bekezdés – módosul`)}<DiffView original={oldParagraphs[op.paragraph]} proposal={op.newText} /></>
          ) : op.type === 'delete' ? (
            <>{label(`${op.paragraph + 1}. bekezdés – törlődik`)}<del className="bg-red-50 text-red-700 whitespace-pre-wrap">{oldParagraphs[op.paragraph]}</del></>
          ) : (
            <>
              {label(op.after === -1 ? 'Új bekezdés a dokumentum elején' : `Új bekezdés a(z) ${op.after + 1}. után`)}
              {op.texts.map((text, k) => <ins key={k} className="block no-underline bg-green-50 text-green-800 whitespace-pre-wrap">{text}</ins>)}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function FindingsList({ findings, editable, onToggle }: { findings: FindingView[]; editable: boolean; onToggle: (index: number, field: 'selected' | 'fix') => void }) {
  return (
    <ul className="space-y-2">
      {findings.map((finding, i) => {
        const missed = finding.notFound || finding.fixFailed;
        return (
          <li key={i} className={`border rounded-lg p-2 ${missed ? 'border-amber-300 bg-amber-50' : 'border-neutral-200 bg-neutral-50'}`}>
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
            {editable && (
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
            {finding.notFound && (
              <span className="flex items-center text-xs text-amber-700 mt-1">
                <SearchX className="w-3.5 h-3.5 mr-1 shrink-0" />
                Nem találtam meg szó szerint a dokumentumban, ezért a megjegyzés nem került be.
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
  onToggleFinding,
  explanation,
  addExplanation,
  onToggleExplanation,
  wholeDocument = false,
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
  onToggleFinding: (index: number, field: 'selected' | 'fix') => void;
  explanation?: string;
  addExplanation?: boolean;
  onToggleExplanation?: () => void;
  /** Edit without a selection: originalText is the whole document, one paragraph per line */
  wholeDocument?: boolean;
}) {
  const [showChanges, setShowChanges] = useState(true);
  const isOpen = state === 'pending' || state === 'applying';
  const commentCount = findings?.filter(f => f.selected).length ?? 0;
  const fixCount = findings?.filter(f => f.fix && f.suggestion).length ?? 0;
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
          <FindingsList findings={findings} editable={state === 'pending'} onToggle={onToggleFinding} />
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
            : wholeDocument ? <DocumentChangesView original={originalText} proposal={text} /> : <DiffView original={originalText} proposal={text} />}
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
        <span className="whitespace-pre-wrap">{text}</span>
      )}

      {isOpen && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onApply}
              disabled={busy || state === 'applying' || (mode === 'review' && commentCount + fixCount === 0)}
              className="flex items-center px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors"
            >
              {state === 'applying' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
              {mode === 'review'
                ? `${APPLY_LABELS.review} (${[commentCount && `${commentCount} megjegyzés`, fixCount && `${fixCount} javítás`].filter(Boolean).join(', ') || '0'})`
                : APPLY_LABELS[mode]}
            </button>
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
