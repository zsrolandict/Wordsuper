import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Download, ExternalLink, KeyRound, Languages, Loader2, RefreshCw, Square, TextSelect } from 'lucide-react';
import type { AIRequestBody } from '../shared/aiConfig';
import { AIRequestError, describeRequestError, needsSettings, streamAIResponse, type RateLimitInfo } from '../services/aiService';
import {
  LANGUAGE_LABELS, MAX_TRANSLATE_CHARS, PART_CHARS, chunkUnits, formatGlossary, formatUnits, glossaryInstruction, guessLanguage,
  parseBilingualDocumentXml, reuseTranslations, translateInParts, translateInstruction, translationUnits,
  type Language, type PreviousBilingual, type TranslationUnit,
} from '../services/bilingual';
import { bilingualDocx, toBase64, type BilingualRow } from '../services/docxWriter';
import { buildDocumentGraph } from '../services/structure';
import { canOpenNewDocument, openNewDocument, readParagraphsForTranslation, readSelectionForTranslation, writeTranslatedRows, type SelectedForTranslation } from '../services/wordDocument';
import { Masker, maskRequest, parseExtraTerms, unresolvedPlaceholders } from '../services/masking';
import { formatNumber } from '../services/format';
import CopyButton from './CopyButton';
import { readZipEntry } from '../services/docxText';
import { documentName, downloadDocx } from '../services/download';
import { playSound, primeSound } from '../services/sound';
import type { Settings } from '../services/settings';

/** The right side of a row that could not be translated: never left empty, so it is not overlooked */
export const UNTRANSLATED = '⚠ Nem sikerült lefordítani – fordítsd kézzel.';
/** At most this many defined terms go into the glossary */
const MAX_GLOSSARY_TERMS = 200;
/** A rate-limited request is tried again after this long, a few times */
const RATE_LIMIT_WAIT_MS = 30 * 1000;
const RATE_LIMIT_RETRIES = 3;

interface DocumentInfo {
  units: TranslationUnit[];
  chars: number;
  terms: string[];
  guessed: Language;
}

interface Output {
  base64: string;
  bytes: Uint8Array;
  fileName: string;
  rows: number;
  /** Rows whose right side is the warning */
  untranslated: number;
  /** Rows taken over from the earlier bilingual document (an update) */
  reused: number;
  maskSummary: string;
  opened: boolean;
}

class Cancelled extends Error {}

/** Remembered on this machine: an update translates only the changed paragraphs */
const SYNC_KEY = 'word-writer-bilingual-sync';

const other = (language: Language): Language => (language === 'hu' ? 'en' : 'hu');

/** Waits, but stops at once when the run is stopped */
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Cancelled()); }, { once: true });
});

/**
 * Kétnyelvű nézet: a dokumentum fordítása bekezdésenként, egy új dokumentumba, két oszlopban (eredeti | fordítás).
 * A megnyitott dokumentumhoz nem nyúl.
 */
export default function TranslatePanel({
  active,
  settings,
  prepareSend,
  onRateLimit,
  onOpenSettings,
}: {
  active: boolean;
  settings: Settings;
  /** Masks the request, and shows it before sending when the settings ask for it; null: the user cancelled */
  prepareSend: (request: AIRequestBody, masker: Masker | null, reserve?: string[]) => Promise<{ sent: AIRequestBody; masker: Masker | null } | null>;
  onRateLimit: (info: RateLimitInfo) => void;
  onOpenSettings: () => void;
}) {
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [from, setFrom] = useState<Language>('en');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; authProblem?: boolean } | null>(null);
  const [output, setOutput] = useState<Output | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** An earlier bilingual document: its unchanged rows are taken over, only the rest is translated again */
  const [previous, setPrevious] = useState<{ name: string; data: PreviousBilingual } | null>(null);
  const [syncUpdate, setSyncUpdateState] = useState(() => {
    try {
      return localStorage.getItem(SYNC_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const setSyncUpdate = (on: boolean) => {
    setSyncUpdateState(on);
    try {
      localStorage.setItem(SYNC_KEY, on ? 'on' : 'off');
    } catch {
      // The choice then lasts for this session only
    }
  };
  /** The last „only the selection” run: the translations, and how many went straight into a bilingual table */
  const [selectionResult, setSelectionResult] = useState<{ items: (SelectedForTranslation & { translation: string })[]; inTable: boolean; written: number; maskSummary: string } | null>(null);
  const previousInput = useRef<HTMLInputElement>(null);
  const running = progress !== null;
  const to = other(from);
  // The earlier document must have the same direction (its column labels)
  const previousMatches = !!previous && previous.data.leftLabel === LANGUAGE_LABELS[from].column && previous.data.rightLabel === LANGUAGE_LABELS[to].column;

  const read = useCallback(async () => {
    setReading(true);
    setError(null);
    try {
      const paragraphs = await readParagraphsForTranslation();
      const units = translationUnits(paragraphs);
      const terms = [...new Set(buildDocumentGraph(paragraphs).terms.map(t => t.term))].slice(0, MAX_GLOSSARY_TERMS);
      const guessed = guessLanguage(units.map(u => u.text).join(' ').slice(0, 20000));
      setInfo({ units, chars: units.reduce((n, u) => n + u.text.length, 0), terms, guessed });
      setFrom(guessed);
    } catch (e) {
      console.error(e);
      setError({ message: 'Nem sikerült beolvasni a dokumentumot.' });
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => {
    if (active && !info && !reading && typeof Word !== 'undefined') read();
  }, [active, info, reading, read]);

  const open = async (target: Output) => {
    setOpenError(null);
    try {
      if (!canOpenNewDocument()) throw new Error('unsupported');
      await openNewDocument(target.base64);
      setOutput(o => o && { ...o, opened: true });
    } catch (e) {
      console.error(e);
      setOpenError('Nem sikerült új dokumentumként megnyitni. Töltsd le, és nyisd meg a letöltött fájlt.');
    }
  };

  const loadPrevious = async (file: File) => {
    setError(null);
    try {
      const xml = await readZipEntry(await file.arrayBuffer(), 'word/document.xml');
      const data = xml && parseBilingualDocumentXml(new TextDecoder().decode(xml));
      if (!data || !data.rows.length) throw new Error('not bilingual');
      setPrevious({ name: file.name, data });
    } catch (e) {
      console.error(e);
      setPrevious(null);
      setError({ message: 'Ez nem itt készült kétnyelvű dokumentum (két oszlopos táblázat).' });
    } finally {
      if (previousInput.current) previousInput.current.value = '';
    }
  };

  /** One run's sending: masking once for all its requests, the first one shown before sending, waits on rate limits */
  const startRun = (allTexts: string[]) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setOpenError(null);
    if (settings.sound) primeSound();
    let masker: Masker | null = settings.masking.enabled ? new Masker(parseExtraTerms(settings.masking.extraTerms), parseExtraTerms(settings.masking.neverHide)) : null;
    // Placeholder-like text anywhere in the document is never one of our own tokens, in any part
    masker?.reserve(allTexts);
    let first = true;

    /** One request; the first one is shown before sending (when the settings ask for it), the rest are masked the same way */
    const send = async (request: AIRequestBody): Promise<string> => {
      let sent: AIRequestBody;
      if (first) {
        const prepared = await prepareSend(request, masker, allTexts);
        if (!prepared) throw new Cancelled();
        masker = prepared.masker;
        sent = prepared.sent;
        first = false;
      } else {
        sent = masker ? maskRequest(request, masker) : request;
      }
      for (let attempt = 0; ; attempt++) {
        try {
          return await streamAIResponse(sent, { onText: () => {}, onRateLimit }, { accessKey: settings.accessKey, userId: settings.userId, signal: controller.signal });
        } catch (e) {
          if (controller.signal.aborted) throw new Cancelled();
          if (!(e instanceof AIRequestError && e.code === 'RATE_LIMITED') || attempt >= RATE_LIMIT_RETRIES) throw e;
          setProgress(p => `${p ?? ''} – sok a kérés, fél percet várok…`);
          await wait(RATE_LIMIT_WAIT_MS, controller.signal);
        }
      }
    };
    const unmask = (text: string) => (masker ? masker.unmask(text) : text);
    const isTooLong = (e: unknown) => e instanceof AIRequestError && e.code === 'INCOMPLETE' && e.reason === 'length';
    const base = { styleProfile: settings.styleProfile, depth: settings.depth };

    /** The defined terms first, so every part uses the same words for them */
    const translateGlossary = async (terms: string[]) => {
      const glossary = new Map<string, string>();
      if (!terms.length) return glossary;
      setProgress('Fogalmak fordítása…');
      const termUnits = terms.map((term, i) => ({ id: i + 1, text: term }));
      const translated = await translateInParts(termUnits, {
        ask: units => send({ mode: 'translate', instruction: glossaryInstruction(from, to), originalText: '', documentContext: formatUnits(units), ...base }),
        unmask,
        isTooLong,
      });
      termUnits.forEach(u => {
        const text = translated.get(u.id);
        if (text && !unresolvedPlaceholders(text, [u.text]).length) glossary.set(u.text, text);
      });
      return glossary;
    };

    const failed = (e: unknown) => {
      setProgress(null);
      if (e instanceof Cancelled || controller.signal.aborted) {
        setError({ message: '⏹️ Leállítottad a fordítást. A megnyitott dokumentumhoz nem nyúltam.' });
      } else {
        console.error(e);
        if (settings.sound) playSound('error');
        setError({ message: describeRequestError(e), authProblem: needsSettings(e) });
      }
    };

    return { send, unmask, isTooLong, base, translateGlossary, failed, maskSummary: () => masker?.summary() ?? '' };
  };

  /** Only the selected paragraphs: in a bilingual table straight into the right cells, otherwise shown here to copy */
  const runSelection = async () => {
    if (running) return;
    setOutput(null);
    setSelectionResult(null);
    setError(null);
    let selected: SelectedForTranslation[];
    try {
      selected = await readSelectionForTranslation();
    } catch (e) {
      console.error(e);
      setError({ message: 'Nem sikerült beolvasni a kijelölést.' });
      return;
    }
    if (!selected.length) {
      setError({ message: 'Jelölj ki egy vagy több bekezdést (vagy kattints bele egybe), és nyomd meg újra.' });
      return;
    }
    const units: TranslationUnit[] = selected.map((item, i) => ({ id: i + 1, text: item.text }));
    if (units.reduce((n, u) => n + u.text.length, 0) > MAX_TRANSLATE_CHARS) {
      setError({ message: 'A kijelölés túl hosszú; használd a teljes dokumentum fordítását.' });
      return;
    }
    const r = startRun(units.map(u => u.text));
    try {
      // Only the defined terms that occur in the selection: a few words instead of the whole glossary
      const selectedText = units.map(u => u.text).join('\n');
      const glossary = await r.translateGlossary((info?.terms ?? []).filter(term => selectedText.includes(term)));
      const glossaryText = formatGlossary(glossary);
      setProgress(`Fordítás: ${formatNumber(selected.length)} kijelölt bekezdés`);
      const translations = await translateInParts(units, {
        ask: part => r.send({ mode: 'translate', instruction: translateInstruction(from, to), originalText: glossaryText, documentContext: formatUnits(part), ...r.base }),
        unmask: r.unmask,
        isTooLong: r.isTooLong,
      });
      const items = selected.map((item, i) => {
        const text = translations.get(i + 1);
        const ok = !!text && !unresolvedPlaceholders(text, [item.text, glossaryText]).length;
        return { ...item, translation: ok ? text! : '' };
      });
      // In a bilingual table every selected row must have its translation, or none is written (no half update)
      const inTable = items.length > 0 && items.every(item => item.row !== undefined);
      const written = inTable && items.every(item => item.translation)
        ? await writeTranslatedRows(items.map(item => ({ row: item.row!, left: item.text, right: item.translation })))
        : 0;
      setProgress(null);
      if (settings.sound) playSound('done');
      setSelectionResult({ items, inTable, written, maskSummary: r.maskSummary() });
    } catch (e) {
      r.failed(e);
    } finally {
      abortRef.current = null;
    }
  };

  const run = async () => {
    if (!info || running || !info.units.length) return;
    setOutput(null);
    setSelectionResult(null);
    const allTexts = info.units.map(u => u.text);
    const { send, unmask, isTooLong, base, translateGlossary, failed, maskSummary } = startRun(allTexts);

    // An update: rows whose original is unchanged keep their translation
    const updating = !!previous && syncUpdate && previousMatches;
    const reused = updating ? reuseTranslations(info.units, previous!.data) : new Map<number, string>();
    const toTranslate = info.units.filter(u => !reused.has(u.id));

    try {
      // 1. The defined terms first (only when something is translated at all)
      const glossary = toTranslate.length ? await translateGlossary(info.terms) : new Map<string, string>();
      const glossaryText = formatGlossary(glossary);

      // 2. The document, part by part
      const parts = chunkUnits(toTranslate, PART_CHARS).length;
      setProgress(`Fordítás: 0/${parts} rész`);
      const translations = toTranslate.length ? await translateInParts(toTranslate, {
        ask: units => send({ mode: 'translate', instruction: translateInstruction(from, to), originalText: glossaryText, documentContext: formatUnits(units), ...base }),
        unmask,
        isTooLong,
        onProgress: (done, total) => setProgress(`Fordítás: ${done}/${total} rész`),
      }) : new Map<number, string>();

      // 3. One row per paragraph; a missing translation, or one with a placeholder nothing stands behind, is marked
      const rows: BilingualRow[] = info.units.map(unit => {
        const kept = reused.get(unit.id);
        if (kept !== undefined) return { number: unit.number, left: unit.text, right: kept, heading: unit.heading };
        const text = translations.get(unit.id);
        const ok = !!text && !unresolvedPlaceholders(text, [unit.text, glossaryText]).length;
        // In an update, the rows translated anew are marked, so the reviewer reads only those
        return { number: unit.number, left: unit.text, right: ok ? text! : UNTRANSLATED, heading: unit.heading, ...(ok ? {} : { warning: true }), ...(updating ? { changed: true } : {}) };
      });
      const name = documentName();
      const bytes = bilingualDocx({
        leftLabel: LANGUAGE_LABELS[from].column,
        rightLabel: LANGUAGE_LABELS[to].column,
        rows,
      });
      const result: Output = {
        base64: toBase64(bytes),
        bytes,
        fileName: `${name || 'Dokumentum'} ${from.toUpperCase()}-${to.toUpperCase()}.docx`,
        rows: rows.length,
        untranslated: rows.filter(r => r.warning).length,
        reused: reused.size,
        maskSummary: maskSummary(),
        opened: false,
      };
      setOutput(result);
      setProgress(null);
      if (settings.sound) playSound('done');
      await open(result);
    } catch (e) {
      failed(e);
    } finally {
      abortRef.current = null;
    }
  };

  if (typeof Word === 'undefined') {
    return <p className="p-4 text-sm text-neutral-500">A Kétnyelvű nézet csak Wordben működik.</p>;
  }

  const tooLong = !!info && info.chars > MAX_TRANSLATE_CHARS;
  const parts = info ? chunkUnits(info.units, PART_CHARS).length : 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-sm">
      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
        <p className="text-xs text-neutral-600">
          A dokumentumot bekezdésenként lefordítom, és <strong>új dokumentumba</strong> teszem két oszlopban: balra az eredeti, jobbra a
          fordítás, minden bekezdés egy sorban, így a két oldal mindig egymás mellett marad. A megnyitott dokumentumhoz nem nyúlok.
        </p>
        <div className="flex items-center justify-between text-xs">
          <span className="text-neutral-700">
            {reading ? 'Beolvasom…'
              : info ? <>{formatNumber(info.units.length)} bekezdés, {formatNumber(info.chars)} karakter{info.terms.length ? `, ${formatNumber(info.terms.length)} definiált fogalom` : ''}</>
              : null}
          </span>
          <button onClick={read} disabled={reading || running} title="A dokumentum újraolvasása" aria-label="Újraolvasás" className="p-1 text-neutral-500 hover:text-neutral-800 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${reading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-center space-x-2 text-xs">
          <span className="flex-1 text-center py-1.5 rounded-lg bg-neutral-100 font-medium">{LANGUAGE_LABELS[from].column}</span>
          <button
            onClick={() => setFrom(to)}
            disabled={running}
            aria-label="Irány megfordítása"
            title="Irány megfordítása"
            className="p-1.5 border border-neutral-300 rounded-lg hover:bg-neutral-100 disabled:opacity-50"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
          </button>
          <span className="flex-1 text-center py-1.5 rounded-lg bg-blue-50 text-blue-800 font-medium">{LANGUAGE_LABELS[to].column}</span>
        </div>
        {info && info.guessed !== from && (
          <p className="text-[11px] text-amber-700">A dokumentum inkább {LANGUAGE_LABELS[info.guessed].name} nyelvűnek tűnik – biztosan jó az irány?</p>
        )}
        <div className="border-t border-neutral-100 pt-2 space-y-1.5 text-xs">
          <p className="font-medium text-neutral-700">Csak a kijelölt bekezdés</p>
          <p className="text-[11px] text-neutral-500">
            Egy-két bekezdéshez nem kell az egészet újrafordítani. Ha a kétnyelvű dokumentumban állsz, a kijelölt sor(ok) bal oldalát fordítom, és a
            jobb oldali cellába írom (sárga háttérrel); máshol a fordítást itt mutatom, kimásolhatod.
          </p>
          <button
            onClick={runSelection}
            disabled={running || reading}
            className="w-full flex items-center justify-center py-1.5 border border-blue-600 text-blue-700 hover:bg-blue-50 disabled:opacity-50 rounded-lg font-medium"
          >
            <TextSelect className="w-3.5 h-3.5 mr-1" />Kijelölt bekezdés(ek) fordítása
          </button>
        </div>
        {tooLong && (
          <p className="text-xs text-amber-700">A dokumentum túl hosszú ({formatNumber(info!.chars)} karakter, a korlát {formatNumber(MAX_TRANSLATE_CHARS)}). Fordítsd részenként: másold egy új dokumentumba a fordítandó részt.</p>
        )}
        <div className="border-t border-neutral-100 pt-2 space-y-1.5 text-xs">
          <p className="font-medium text-neutral-700">Korábbi kétnyelvű változat frissítése</p>
          <input ref={previousInput} type="file" accept=".docx" className="hidden" aria-label="Korábbi kétnyelvű változat" onChange={e => e.target.files?.[0] && loadPrevious(e.target.files[0])} />
          {previous ? (
            <div className="flex items-center justify-between">
              <span className="truncate text-neutral-700">📄 {previous.name} ({formatNumber(previous.data.rows.length)} sor, {previous.data.leftLabel} → {previous.data.rightLabel})</span>
              <button onClick={() => setPrevious(null)} disabled={running} className="ml-2 text-neutral-500 hover:text-neutral-900" aria-label="Korábbi változat elvetése">✕</button>
            </div>
          ) : (
            <button onClick={() => previousInput.current?.click()} disabled={running} className="w-full py-1.5 border border-neutral-300 rounded-lg text-neutral-700 hover:bg-neutral-100 disabled:opacity-50">
              Korábbi kétnyelvű változat feltöltése (.docx)
            </button>
          )}
          <label className="flex items-start space-x-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={syncUpdate} disabled={running} onChange={e => setSyncUpdate(e.target.checked)} />
            <span>Szinkron frissítés: csak a megváltozott bekezdéseket fordítom újra, a többi fordítása marad (az újak sárga hátteret kapnak)</span>
          </label>
          {previous && !previousMatches && <p className="text-amber-700">A korábbi változat iránya ({previous.data.leftLabel} → {previous.data.rightLabel}) más, mint a mostani: mindent újrafordítok.</p>}
          {previous && previousMatches && !syncUpdate && <p className="text-neutral-500">A szinkron frissítés ki van kapcsolva: mindent újrafordítok.</p>}
        </div>
        {running ? (
          <div className="flex items-center space-x-2">
            <p className="flex-1 flex items-center text-xs text-neutral-600"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin text-blue-600" />{progress}</p>
            <button onClick={() => abortRef.current?.abort()} aria-label="Leállítás" className="flex items-center px-2.5 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg">
              <Square className="w-3 h-3 mr-1 fill-current" />Leállítás
            </button>
          </div>
        ) : (
          <button
            onClick={run}
            disabled={!info || !info.units.length || reading || tooLong}
            className="w-full flex items-center justify-center py-2 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg"
          >
            <Languages className="w-4 h-4 mr-1" />
            Kétnyelvű változat készítése{parts > 1 ? ` (${parts} részben)` : ''}
          </button>
        )}
        <p className="text-[11px] text-neutral-500">
          Az el nem fogadott korrektúrákat elfogadott állapotukban fordítom. A definiált fogalmakat először külön lefordítom, és a teljes
          szövegben ugyanígy használom őket.{settings.masking.enabled ? ' Az érzékeny adatok maszkolva mennek ki, a fordításba a valódi adat kerül vissza.' : ''}
        </p>
        {error && (
          <div className="text-xs text-red-700 whitespace-pre-wrap">
            {error.message}
            {error.authProblem && (
              <button onClick={onOpenSettings} className="mt-1 flex items-center font-medium underline"><KeyRound className="w-3.5 h-3.5 mr-1" />Beállítások megnyitása</button>
            )}
          </div>
        )}
      </div>

      {selectionResult && (
        <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2 text-xs">
          {selectionResult.inTable && selectionResult.written > 0 && (
            <p className="font-medium text-green-700">✅ {formatNumber(selectionResult.written)} sor fordítását beírtam a jobb oldali cellába (sárga háttér).</p>
          )}
          {selectionResult.inTable && selectionResult.written === 0 && (
            <p className="text-amber-700">Nem írtam a táblázatba: {selectionResult.items.some(i => !i.translation) ? 'nem minden sort sikerült lefordítani' : 'közben máshová került a kijelölés, vagy megváltozott a bal oldal'}. A fordítás lent kimásolható.</p>
          )}
          {(!selectionResult.inTable || selectionResult.written === 0) && (
            <>
              <div className="flex items-center justify-between">
                <p className="font-medium text-neutral-700">Fordítás ({LANGUAGE_LABELS[from].name} → {LANGUAGE_LABELS[to].name})</p>
                <CopyButton text={selectionResult.items.map(i => `${i.number ? `${i.number} ` : ''}${i.translation || UNTRANSLATED}`).join('\n')} />
              </div>
              {selectionResult.items.map((item, i) => (
                <p key={i} className={`whitespace-pre-wrap ${item.heading ? 'font-semibold' : ''} ${item.translation ? 'text-neutral-800' : 'text-red-700'}`}>
                  {item.number ? `${item.number} ` : ''}{item.translation || UNTRANSLATED}
                </p>
              ))}
            </>
          )}
          {selectionResult.maskSummary && <p className="text-neutral-500">Az AI elől elrejtve: {selectionResult.maskSummary}.</p>}
          <p className="text-neutral-500">Gépi fordítás: aláírás vagy kiküldés előtt nézesd át.</p>
        </div>
      )}

      {output && (
        <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2 text-xs">
          <p className="font-medium text-green-700">
            ✅ Elkészült: {formatNumber(output.rows)} sor{output.reused ? `, ebből ${formatNumber(output.reused)} a korábbi változatból átvéve, ${formatNumber(output.rows - output.reused)} újrafordítva (sárga háttér)` : ''}.{output.opened ? ' Új dokumentumként megnyitottam (még nincs elmentve).' : ''}
          </p>
          {output.untranslated > 0 && (
            <p className="text-red-700">⚠ {formatNumber(output.untranslated)} bekezdést nem sikerült lefordítani: ezeknél a jobb oldalon piros figyelmeztetés áll, fordítsd kézzel.</p>
          )}
          {output.maskSummary && <p className="text-neutral-500">Az AI elől elrejtve: {output.maskSummary}.</p>}
          <p className="text-neutral-500">Gépi fordítás: aláírás vagy kiküldés előtt nézesd át.</p>
          {openError && <p className="text-amber-700">{openError}</p>}
          <div className="flex space-x-2">
            <button onClick={() => open(output)} className="flex items-center px-2.5 py-1.5 font-medium border border-blue-600 text-blue-700 hover:bg-blue-50 rounded-lg">
              <ExternalLink className="w-3.5 h-3.5 mr-1" />{output.opened ? 'Megnyitás újra' : 'Megnyitás'}
            </button>
            <button onClick={() => downloadDocx(output.bytes, output.fileName)} className="flex items-center px-2.5 py-1.5 font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-100 rounded-lg">
              <Download className="w-3.5 h-3.5 mr-1" />Letöltés (.docx)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
