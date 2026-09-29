import React, { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { AI_MODEL, MAX_CONTEXT_CHARS, MAX_SELECTION_CHARS } from '../shared/aiConfig';

export type Mode = 'edit' | 'comment' | 'generate';

/** Minden, amit egy AI kérésről tudunk – ebből mutatjuk meg, mit látott az AI és hogyan jutott a válaszra */
export interface RequestDetailsData {
  mode: Mode;
  instruction: string;
  selectionText: string;
  documentChars: number;
  thoughts: string;
  startedAt: number;
  durationMs?: number;
}

const formatNumber = (n: number) => n.toLocaleString('hu-HU');

// A Word a bekezdéseket \r-rel választja el, ezt a böngésző nem töri sorba
const normalizeLineBreaks = (text: string) => text.replace(/\r\n?/g, '\n');

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

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1 flex items-start text-amber-700">
      <AlertTriangle className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export default function RequestDetails({ details, isLoading }: { details: RequestDetailsData; isLoading: boolean }) {
  const [open, setOpen] = useState(false);
  const { mode, instruction, selectionText, documentChars, thoughts, durationMs } = details;

  const selectionTruncated = selectionText.length > MAX_SELECTION_CHARS;
  const contextTruncated = documentChars > MAX_CONTEXT_CHARS;

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
          </Section>

          {mode === 'generate' ? (
            selectionText.trim() !== '' && (
              <Section title="Kijelölt szöveg">
                <p>A kijelölt szöveget az AI nem kapta meg, a generált szöveg ennek a helyére került.</p>
              </Section>
            )
          ) : (
            <Section title={`Kijelölt szöveg (${formatNumber(selectionText.length)} karakter)`}>
              <div className="max-h-32 overflow-y-auto whitespace-pre-wrap bg-neutral-50 border border-neutral-200 rounded-md p-2">
                {normalizeLineBreaks(selectionText.substring(0, MAX_SELECTION_CHARS))}
              </div>
              {selectionTruncated && (
                <Warning>Csak az első {formatNumber(MAX_SELECTION_CHARS)} karaktert kapta meg az AI, a kijelölés végét nem látta.</Warning>
              )}
            </Section>
          )}

          <Section title="Dokumentum-kontextus">
            {documentChars === 0 ? (
              <p>A dokumentum üres volt, így az AI nem kapott háttérinformációt.</p>
            ) : contextTruncated ? (
              <>
                <p>A dokumentum {formatNumber(documentChars)} karakteréből az első {formatNumber(MAX_CONTEXT_CHARS)} ment el háttérinformációként.</p>
                <Warning>A dokumentum ezen túli részét az AI nem látta.</Warning>
              </>
            ) : (
              <p>A teljes dokumentum ({formatNumber(documentChars)} karakter) elment háttérinformációként, hogy a hangnem és a szóhasználat illeszkedjen.</p>
            )}
          </Section>

          <Section title="Hogyan gondolkodott">
            {thoughts ? (
              <FormattedThoughts text={thoughts} />
            ) : (
              <p className="italic">{isLoading ? 'Várom az első gondolatokat…' : 'Ehhez a válaszhoz a modell nem adott gondolkodási összefoglalót.'}</p>
            )}
          </Section>

          <p className="text-neutral-400">
            {AI_MODEL}{durationMs !== undefined ? ` · ${(durationMs / 1000).toFixed(1).replace('.', ',')} mp` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
