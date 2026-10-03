import React, { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { MAX_SELECTION_CHARS, toLineFeeds, type Mode } from '../shared/aiConfig';
import type { ContextInfo } from '../services/contextBuilder';
import { formatNumber } from '../services/format';

/** Minden, amit egy AI kérésről tudunk – ebből mutatjuk meg, mit látott az AI és hogyan jutott a válaszra */
export interface RequestDetailsData {
  mode: Mode;
  instruction: string;
  selectionText: string;
  contextInfo: ContextInfo;
  /** Finomításnál ennyi korábbi kört (utasítás + válasz) látott az AI */
  historyRounds: number;
  /** Ennyi kör volt összesen; ha több, mint amit az AI látott, a középsők kimaradtak */
  totalRounds: number;
  /** A stílusprofil rövid leírása, üres, ha nincs beállítva */
  styleSummary: string;
  thoughts: string;
  startedAt: number;
  durationMs?: number;
  /** A szerver küldi a válasz elején: melyik modell válaszolt és hol dolgozták fel a szöveget */
  model?: string;
  location?: string;
  /** Edit or comment without a selection: the whole document was the text to work on */
  wholeDocument?: boolean;
  /** How hard the model was asked to think */
  depth?: 'auto' | 'fast' | 'deep';
  /** The review was made by several specialist reviewers and merged */
  multiAgent?: boolean;
  /** The represented party the AI worked for; empty: neutral */
  party?: string;
  /** What was hidden from the AI; null: masking was off */
  masking?: MaskingInfo | null;
}

export interface MaskingInfo {
  summary: string;
  /** [placeholder, original value] */
  entries: [string, string][];
}

const MAX_MASK_ROWS = 40;

function MaskingDescription({ masking, onNeverHide }: { masking: MaskingInfo | null; onNeverHide?: (value: string) => void }) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  if (!masking) {
    return <p>A maszkolás ki volt kapcsolva: az AI a szöveget változtatás nélkül kapta meg. (Beállítások → Adatvédelem)</p>;
  }
  if (!masking.entries.length) {
    return <p>A maszkolás be volt kapcsolva, de nem találtam elrejtendő adatot (nevet, céget, azonosítót, címet).</p>;
  }
  return (
    <>
      <p>Ezeket az AI nem látta, helyettük helyettesítőt kapott ({masking.summary}). A válaszban visszacseréltem őket.</p>
      <table className="mt-1 w-full border-collapse">
        <tbody>
          {masking.entries.slice(0, MAX_MASK_ROWS).map(([token, value]) => (
            <tr key={token} className="border-t border-neutral-100">
              <td className="py-0.5 pr-2 font-mono text-[10px] text-neutral-500 whitespace-nowrap align-top">{token}</td>
              <td className="py-0.5 break-words">{value}</td>
              {onNeverHide && (
                <td className="py-0.5 pl-2 text-right whitespace-nowrap align-top">
                  {shown.has(value) ? (
                    <span className="text-[10px] text-green-700">✓ a következő kéréstől látja</span>
                  ) : (
                    <button
                      onClick={() => { onNeverHide(value); setShown(s => new Set(s).add(value)); }}
                      title="Ezt nem kell elrejteni: a következő kéréstől az AI látja (Beállítások → Adatvédelem → Soha ne rejtsd el)"
                      className="text-[10px] font-medium text-blue-700 hover:text-blue-900"
                    >
                      Ne rejtsd
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {masking.entries.length > MAX_MASK_ROWS && <p className="mt-1">…és még {formatNumber(masking.entries.length - MAX_MASK_ROWS)}.</p>}
      <p className="mt-1 text-neutral-400">A felismerés szabályalapú. Ha valami kimaradt, add hozzá a Beállításokban a mindig elrejtendő kifejezésekhez.</p>
    </>
  );
}

/** A gondolkodási összefoglaló **félkövér** címsorait jelenítjük meg félkövérként */
function FormattedThoughts({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <strong key={i} className="text-neutral-800">{part.slice(2, -2)}</strong>
          : <React.Fragment key={i}>{part}</React.Fragment>
      )}
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="font-semibold text-neutral-700 mb-1">{title}</h4>
      <div className="text-neutral-600">{children}</div>
    </div>
  );
}

export function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 flex items-start text-amber-700">
      <AlertTriangle className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ContextDescription({ info, mode }: { info: ContextInfo; mode: Mode }) {
  if (mode === 'compare') {
    return (
      <>
        <p>Az AI nem a teljes dokumentumot, hanem csak a változások listáját kapta meg ({formatNumber(info.includedItems ?? 0)} változás, {formatNumber(info.sentChars)} karakter).</p>
        {(info.includedItems ?? 0) < (info.totalItems ?? 0) && (
          <Warning>A {formatNumber(info.totalItems ?? 0)} változásból csak {formatNumber(info.includedItems ?? 0)} fért bele a korlátba, a többit az AI nem látta.</Warning>
        )}
      </>
    );
  }
  switch (info.strategy) {
    case 'empty':
      return <p>A dokumentum üres volt, így az AI nem kapott háttérinformációt.</p>;
    case 'full':
      return mode === 'review'
        ? <p>Az AI a teljes dokumentumot ({formatNumber(info.documentChars)} karakter) átvizsgálta.</p>
        : <p>A teljes dokumentum ({formatNumber(info.documentChars)} karakter) elment háttérinformációként, hogy a hangnem és a szóhasználat illeszkedjen.</p>;
    case 'truncated':
      return (
        <>
          <p>A dokumentum {formatNumber(info.documentChars)} karakteréből az első {formatNumber(info.sentChars)} ment el átvizsgálásra.</p>
          <Warning>A dokumentum ezen túli részét az AI nem vizsgálta át.</Warning>
        </>
      );
    case 'excerpts':
      return (
        <>
          <p>A dokumentum túl hosszú ({formatNumber(info.documentChars)} karakter, a korlát {formatNumber(info.limit)}), ezért részleteket kapott:</p>
          <ul className="list-disc pl-4 mt-1 space-y-0.5">
            {!!info.beginningChars && <li>a dokumentum elejét ({formatNumber(info.beginningChars)} karakter),</li>}
            {!!info.totalHeadings && <li>{formatNumber(info.headingCount ?? 0)} címsort a vázlatból (összesen {formatNumber(info.totalHeadings)} van),</li>}
            <li>a kijelölés környékét ({formatNumber((info.windowStart ?? 0) + 1)}–{formatNumber(info.windowEnd ?? 0)}. karakter).</li>
          </ul>
          <Warning>A dokumentum többi részét az AI nem látta.</Warning>
        </>
      );
  }
}

export default function RequestDetails({ details, isLoading, onNeverHide }: {
  details: RequestDetailsData;
  isLoading: boolean;
  /** A masked value the user wants the AI to see from now on */
  onNeverHide?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { mode, instruction, selectionText, contextInfo, historyRounds, totalRounds, styleSummary, thoughts, durationMs, model, location, wholeDocument, masking, depth, party, multiAgent } = details;

  return (
    <div className="mt-2 pt-2 border-t border-neutral-100">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center text-left text-xs text-neutral-500 hover:text-neutral-800 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 mr-1 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 mr-1 shrink-0" />}
        Részletek – honnan jött a válasz?
      </button>

      {open && (
        <div className="mt-2 space-y-3 text-xs">
          <Section title="Utasítás">
            <p className="whitespace-pre-wrap">{instruction}</p>
            {historyRounds > 0 && (
              <p className="mt-1">
                Ez finomítás volt: az AI látta az előző {formatNumber(historyRounds)} kör utasítását és a saját válaszát is.
                {totalRounds > historyRounds && ` Összesen ${formatNumber(totalRounds)} kör volt: az elsőt és a legutóbbiakat kapta meg, a közbülsőket nem.`}
              </p>
            )}
            {styleSummary && <p className="mt-1">Stílusprofil: {styleSummary}.</p>}
            <p className="mt-1">Képviselt fél: {party ? <strong>{party}</strong> : 'nincs megadva, semleges szemszögből'}.</p>
          </Section>

          {mode === 'generate' ? (
            selectionText.trim() !== '' && (
              <Section title="Kijelölt szöveg">
                <p>A kijelölt szöveget az AI nem kapta meg, a generált szöveg ennek a helyére kerül.</p>
              </Section>
            )
          ) : (mode === 'edit' || mode === 'comment') && (
            <Section title={wholeDocument ? `Nem jelöltél ki semmit: a teljes dokumentum (${formatNumber(selectionText.length)} karakter)` : `Kijelölt szöveg (${formatNumber(selectionText.length)} karakter)`}>
              <div className="max-h-32 overflow-y-auto whitespace-pre-wrap bg-neutral-50 border border-neutral-200 rounded-md p-2">
                {toLineFeeds(selectionText.substring(0, MAX_SELECTION_CHARS))}
              </div>
              {selectionText.length > MAX_SELECTION_CHARS && (
                <Warning>Csak az első {formatNumber(MAX_SELECTION_CHARS)} karaktert kapta meg az AI, a kijelölés végét nem látta.</Warning>
              )}
            </Section>
          )}

          {!wholeDocument && (
            <Section title={mode === 'review' ? 'Átvizsgált szöveg' : mode === 'compare' ? 'Összevetett változások' : 'Dokumentum-kontextus'}>
              <ContextDescription info={contextInfo} mode={mode} />
            </Section>
          )}

          {masking !== undefined && (
            <Section title="Adatvédelem">
              <MaskingDescription masking={masking} onNeverHide={onNeverHide} />
            </Section>
          )}

          <Section title="Hogyan gondolkodott">
            {thoughts ? (
              <>
                <FormattedThoughts text={thoughts} />
                <p className="mt-1 text-neutral-400">A modell a gondolkodását angolul foglalja össze, a válasza ettől még magyar.</p>
              </>
            ) : (
              <p className="italic">{isLoading ? 'Várom az első gondolatokat…' : 'Ehhez a válaszhoz a modell nem adott gondolkodási összefoglalót.'}</p>
            )}
          </Section>

          <p className="text-neutral-400">
            {model ? `${model} · ${location}` : 'A modell még nem jelentkezett'}{depth ? ` · gondolkodás: ${{ auto: 'automatikus', fast: 'gyors', deep: 'alapos' }[depth]}` : ''}{multiAgent ? ' · többágensű (szakértők + összegzés)' : ''}{durationMs !== undefined ? ` · ${(durationMs / 1000).toFixed(1).replace('.', ',')} mp` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
