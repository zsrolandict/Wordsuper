import React, { useMemo, useState } from 'react';
import { Check, RefreshCw, X, Loader2, SearchX } from 'lucide-react';
import type { Mode, ReviewFinding } from '../shared/aiConfig';
import { diffForDisplay } from '../services/textDiff';
import { SEVERITY_LABELS, cleanQuote } from '../services/review';

export type ProposalState = 'pending' | 'applying' | 'applied' | 'rejected' | 'superseded';

export interface FindingView extends ReviewFinding {
  selected: boolean;
  /** Set after inserting: the quote could not be found in the document */
  notFound?: boolean;
}

const SEVERITY_STYLES = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-neutral-200 text-neutral-700',
};

/** Word-level changes: deleted words struck through in red, new words in green */
function DiffView({ original, proposal }: { original: string; proposal: string }) {
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

function FindingsList({ findings, editable, onToggle }: { findings: FindingView[]; editable: boolean; onToggle: (index: number) => void }) {
  return (
    <ul className="space-y-2">
      {findings.map((finding, i) => (
        <li key={i} className={`border rounded-lg p-2 ${finding.notFound ? 'border-amber-300 bg-amber-50' : 'border-neutral-200 bg-neutral-50'}`}>
          <label className={`flex items-start space-x-2 ${editable ? 'cursor-pointer' : ''}`}>
            {editable && <input type="checkbox" checked={finding.selected} onChange={() => onToggle(i)} className="mt-0.5 shrink-0" />}
            <span className="min-w-0">
              <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mr-1 ${SEVERITY_STYLES[finding.severity]}`}>
                {SEVERITY_LABELS[finding.severity]}
              </span>
              <span className="text-xs italic text-neutral-500 break-words">„{cleanQuote(finding.quote)}”</span>
              <span className="block text-sm mt-1">{finding.comment}</span>
              {finding.notFound && (
                <span className="flex items-center text-xs text-amber-700 mt-1">
                  <SearchX className="w-3.5 h-3.5 mr-1 shrink-0" />
                  Nem találtam meg szó szerint a dokumentumban, ezért ez nem került be.
                </span>
              )}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

const APPLY_LABELS: Record<Mode, string> = {
  edit: 'Elfogadom',
  generate: 'Beszúrás',
  comment: 'Megjegyzés beszúrása',
  review: 'Megjegyzések beszúrása',
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
  onToggleFinding: (index: number) => void;
}) {
  const [showChanges, setShowChanges] = useState(true);
  const isOpen = state === 'pending' || state === 'applying';
  const selectedCount = findings?.filter(f => f.selected).length ?? 0;

  return (
    <div>
      {mode === 'review' && findings ? (
        <>
          <p className="mb-2">{findings.length} észrevételt találtam. {isOpen ? 'Válaszd ki, melyik kerüljön be megjegyzésként:' : ''}</p>
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
          {showChanges ? <DiffView original={originalText} proposal={text} /> : <span className="whitespace-pre-wrap">{text}</span>}
        </>
      ) : (
        <span className="whitespace-pre-wrap">{text}</span>
      )}

      {isOpen && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onApply}
              disabled={busy || state === 'applying' || (mode === 'review' && selectedCount === 0)}
              className="flex items-center px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors"
            >
              {state === 'applying' ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
              {APPLY_LABELS[mode]}{mode === 'review' ? ` (${selectedCount})` : ''}
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
