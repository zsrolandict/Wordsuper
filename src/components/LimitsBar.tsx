import React, { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, OctagonAlert, Gauge } from 'lucide-react';
import {
  MAX_HISTORY_TURNS,
  MAX_REVIEW_FINDINGS,
  MAX_SELECTION_CHARS,
  RATE_LIMIT_PER_MINUTE,
  contextLimitFor,
  type Mode,
} from '../shared/aiConfig';
import type { DocumentStats } from '../services/wordDocument';
import type { RateLimitInfo } from '../services/aiService';
import { formatNumber } from '../services/format';

type Level = 'ok' | 'warn' | 'error';

const BAR_COLORS: Record<Level, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', error: 'bg-red-500' };
const TEXT_COLORS: Record<Level, string> = { ok: 'text-neutral-500', warn: 'text-amber-700', error: 'text-red-700' };

function Meter({ value, limit, level }: { value: number; limit: number; level: Level }) {
  const percent = Math.min(100, (value / limit) * 100);
  return (
    <div className="h-1.5 w-full bg-neutral-200 rounded-full overflow-hidden" role="meter" aria-valuenow={value} aria-valuemax={limit}>
      <div className={`h-full ${BAR_COLORS[level]} transition-all`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function LimitRow({ label, value, limit, level, note }: { label: string; value: number | null; limit: number; level: Level; note: string }) {
  return (
    <div>
      <div className="flex justify-between">
        <span className="font-medium text-neutral-700">{label}</span>
        <span className={TEXT_COLORS[level]}>
          {value === null ? '…' : formatNumber(value)} / {formatNumber(limit)}
        </span>
      </div>
      <Meter value={value ?? 0} limit={limit} level={level} />
      <p className="text-neutral-500 mt-0.5">{note}</p>
    </div>
  );
}

/** Currently known rate limit, or null if the window has already reset */
function currentRateLimit(rateLimit: RateLimitInfo | null): RateLimitInfo | null {
  if (!rateLimit) return null;
  return Date.now() < rateLimit.receivedAt + rateLimit.resetSeconds * 1000 ? rateLimit : null;
}

/**
 * Élő korlátjelző: mekkora a dokumentum és a kijelölés ahhoz képest, amennyit az AI megkap,
 * és hány kérés maradt ebben a percben. Figyelmeztet, ha valami nem fér bele.
 */
export default function LimitsBar({ mode, stats, rateLimit }: { mode: Mode; stats: DocumentStats | null; rateLimit: RateLimitInfo | null }) {
  const [open, setOpen] = useState(false);

  const docLimit = contextLimitFor(mode);
  const documentChars = stats?.documentChars ?? null;
  const selectionChars = stats?.selectionChars ?? null;
  const selectionMatters = mode === 'edit' || mode === 'comment';

  const docLevel: Level = documentChars !== null && documentChars > docLimit ? 'warn' : 'ok';
  const selectionLevel: Level = !selectionMatters || selectionChars === null || selectionChars <= MAX_SELECTION_CHARS
    ? 'ok'
    : mode === 'edit' ? 'error' : 'warn';

  const rate = currentRateLimit(rateLimit);
  const remaining = rate?.remaining ?? RATE_LIMIT_PER_MINUTE;
  const rateLevel: Level = remaining === 0 ? 'error' : remaining <= 3 ? 'warn' : 'ok';

  const messages: { level: Level; text: string }[] = [];
  if (selectionLevel === 'error') {
    messages.push({ level: 'error', text: `A kijelölés túl hosszú a szerkesztéshez (legfeljebb ${formatNumber(MAX_SELECTION_CHARS)} karakter). Jelölj ki kisebb részt!` });
  } else if (selectionLevel === 'warn') {
    messages.push({ level: 'warn', text: `Hosszú kijelölés: az AI csak az első ${formatNumber(MAX_SELECTION_CHARS)} karaktert elemzi.` });
  }
  if (docLevel === 'warn') {
    messages.push({
      level: 'warn',
      text: mode === 'review'
        ? `Nagy dokumentum: az átvizsgálás csak az első ${formatNumber(docLimit)} karaktert fedi le.`
        : `Nagy dokumentum: az AI nem látja az egészet, csak az elejét, a címsorokat és a kijelölés környékét (${formatNumber(docLimit)} karakter).`,
    });
  }
  if (rateLevel !== 'ok') {
    messages.push({ level: rateLevel, text: remaining === 0 ? 'Elfogyott az e percre jutó kérések száma, várj egy kicsit.' : `Ebben a percben már csak ${remaining} kérés maradt.` });
  }

  const worst: Level = messages.some(m => m.level === 'error') ? 'error' : messages.length ? 'warn' : 'ok';

  return (
    <div className={`mb-2 rounded-lg border text-[11px] ${worst === 'error' ? 'border-red-200 bg-red-50' : worst === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-neutral-200 bg-neutral-50'}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center text-neutral-600 min-w-0">
          <Gauge className="w-3.5 h-3.5 mr-1 shrink-0" />
          <span className="truncate">
            Dokumentum: {documentChars === null ? '…' : formatNumber(documentChars)} kar.
            {selectionMatters && <> · Kijelölés: {selectionChars === null ? '…' : formatNumber(selectionChars)} kar.</>}
          </span>
        </span>
        <span className="flex items-center text-neutral-500 shrink-0 ml-2">
          Korlátok
          {open ? <ChevronDown className="w-3.5 h-3.5 ml-0.5" /> : <ChevronRight className="w-3.5 h-3.5 ml-0.5" />}
        </span>
      </button>

      {messages.map(message => (
        <p key={message.text} className={`flex items-start px-2.5 pb-1.5 ${TEXT_COLORS[message.level]}`}>
          {message.level === 'error'
            ? <OctagonAlert className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />
            : <AlertTriangle className="w-3.5 h-3.5 mr-1 mt-px shrink-0" />}
          <span>{message.text}</span>
        </p>
      ))}

      {open && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2 border-t border-neutral-200">
          <LimitRow
            label="Dokumentum"
            value={documentChars}
            limit={docLimit}
            level={docLevel}
            note={mode === 'review'
              ? 'Átvizsgálásnál ennyi karaktert kap meg az AI a dokumentum elejétől.'
              : 'Ennyi karakter megy el háttérinformációként. Ha a dokumentum hosszabb, az eleje, a címsorok és a kijelölés környéke megy.'}
          />
          {selectionMatters && (
            <LimitRow
              label="Kijelölés"
              value={selectionChars}
              limit={MAX_SELECTION_CHARS}
              level={selectionLevel}
              note={mode === 'edit' ? 'Szerkesztésnél ennél hosszabb kijelölést nem írok át.' : 'Véleményezésnél ennél hosszabb kijelölésnek csak az elejét elemzi az AI.'}
            />
          )}
          <LimitRow
            label="Kérések ebben a percben"
            value={remaining}
            limit={rate?.limit || RATE_LIMIT_PER_MINUTE}
            level={rateLevel}
            note="Ennyi kérés maradt; percenként újratöltődik."
          />
          <ul className="list-disc pl-4 text-neutral-500 space-y-0.5">
            <li>Finomításnál az AI az utolsó {MAX_HISTORY_TURNS} kört látja.</li>
            <li>Egy átvizsgálás legfeljebb {MAX_REVIEW_FINDINGS} megjegyzést ad.</li>
            <li>A korlátok a válaszidőt és a költséget tartják kordában.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
