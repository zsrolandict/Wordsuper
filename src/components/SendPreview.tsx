import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, EyeOff } from 'lucide-react';
import type { AIRequestBody } from '../shared/aiConfig';
import { formatNumber } from '../services/format';

/** What the user decided after looking at the request */
export type PreviewDecision = { kind: 'send' } | { kind: 'cancel' } | { kind: 'hide'; term: string };

/** Each section is shown up to this length; the rest is only counted */
const MAX_SHOWN_CHARS = 6000;
const PLACEHOLDER = /(\[[A-ZÁÉÍÓÖŐÚÜŰ]+_\d+\])/;

/** The text with the placeholders highlighted, so it is easy to see what was hidden and what was not */
function MaskedText({ text }: { text: string }) {
  const shown = text.length > MAX_SHOWN_CHARS ? text.slice(0, MAX_SHOWN_CHARS) : text;
  return (
    <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-neutral-800">
      {shown.split(PLACEHOLDER).map((part, i) => (i % 2 === 1
        ? <span key={i} className="px-0.5 rounded bg-blue-100 text-blue-800 font-mono text-[10px]">{part}</span>
        : <React.Fragment key={i}>{part}</React.Fragment>))}
      {text.length > MAX_SHOWN_CHARS && <span className="block mt-1 text-neutral-400">… és még {formatNumber(text.length - MAX_SHOWN_CHARS)} karakter</span>}
    </p>
  );
}

/**
 * Shows exactly what the AI will get, before anything leaves the machine. The user can send it, cancel it, or name
 * one more thing to hide (it is added to the "always hide" list and the request is masked again).
 */
export default function SendPreview({ request, masked, summary, onDecide }: {
  request: AIRequestBody;
  /** Masking was on for this request */
  masked: boolean;
  /** "2 cégnév, 3 személynév": what was hidden */
  summary: string;
  onDecide: (decision: PreviewDecision) => void;
}) {
  const [term, setTerm] = useState('');
  const sections = [
    { title: 'Utasítás', text: request.instruction },
    { title: request.wholeDocument ? 'A dokumentum (nincs kijelölés)' : 'Kijelölt szöveg', text: request.originalText },
    { title: request.mode === 'compare' ? 'A változások listája' : request.mode === 'review' ? 'A dokumentum' : 'Háttér a dokumentumból', text: request.documentContext },
    ...(request.party ? [{ title: 'Képviselt fél', text: request.party }] : []),
  ].filter(section => section.text.trim());
  const rounds = request.history?.length ?? 0;
  const hide = () => {
    const value = term.trim();
    if (value.length >= 2) onDecide({ kind: 'hide', term: value });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Küldés előtti ellenőrzés">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md max-h-full flex flex-col">
        <div className="p-3 border-b border-neutral-200">
          <p className="text-sm font-semibold text-neutral-900">Ezt kapja az AI</p>
          {masked ? (
            <p className="flex items-start mt-1 text-xs text-green-800">
              <ShieldCheck className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
              {summary ? `Elrejtve: ${summary}. A kék jelölések helyettesítők, mögöttük a valódi adat a gépen marad.` : 'A maszkolás be van kapcsolva, de nem találtam elrejtendő adatot.'}
            </p>
          ) : (
            <p className="flex items-start mt-1 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
              A maszkolás ki van kapcsolva: a szöveg változtatás nélkül megy ki.
            </p>
          )}
          <p className="mt-1 text-[11px] text-neutral-500">Nézd át: ha valamit nem rejtettem el, írd be lent, és újra maszkolom.</p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
          {sections.map(section => (
            <div key={section.title}>
              <p className="text-[11px] font-semibold text-neutral-600 mb-0.5">{section.title} <span className="font-normal text-neutral-400">({formatNumber(section.text.length)} karakter)</span></p>
              <MaskedText text={section.text} />
            </div>
          ))}
          {rounds > 0 && <p className="text-[11px] text-neutral-500">Finomítás: az előző {rounds} kör utasítását és válaszát is megkapja, ugyanígy maszkolva.</p>}
        </div>
        <div className="p-3 border-t border-neutral-200 space-y-2">
          {masked && (
            <div className="flex space-x-1.5">
              <input
                value={term}
                onChange={e => setTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') hide(); }}
                placeholder="Még elrejtendő, pl. Napfény projekt"
                aria-label="Még elrejtendő kifejezés"
                className="flex-1 min-w-0 p-1.5 text-xs border border-neutral-300 rounded-lg bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button onClick={hide} disabled={term.trim().length < 2} className="flex items-center px-2.5 text-xs font-medium border border-blue-600 text-blue-700 rounded-lg hover:bg-blue-50 disabled:opacity-50">
                <EyeOff className="w-3.5 h-3.5 mr-1" />Elrejtem
              </button>
            </div>
          )}
          <div className="flex space-x-2">
            <button onClick={() => onDecide({ kind: 'send' })} className="flex-1 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Küldés</button>
            <button onClick={() => onDecide({ kind: 'cancel' })} className="flex-1 py-2 text-xs font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-100 rounded-lg">Mégse</button>
          </div>
        </div>
      </div>
    </div>
  );
}
