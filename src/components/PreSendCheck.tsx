import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Eraser, Loader2, Send, X } from 'lucide-react';
import { CLEARABLE_PROPERTIES, HIGHLIGHT_NAMES, PROPERTY_LABELS, findMarkedRuns, findPlaceholders, type DocumentPropertiesInfo } from '../services/presend';
import { clearDocumentProperties, jumpToParagraph, readPreSendFacts, selectReviewItem, selectText, type PreSendFacts } from '../services/wordDocument';
import { formatNumber } from '../services/format';

const MAX_SHOWN = 25;
const short = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max)}…` : text);

function Jump({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center shrink-0 text-[11px] font-medium text-blue-700 hover:text-blue-900">
      Ugrás<ArrowRight className="w-3 h-3 ml-0.5" />
    </button>
  );
}

function Section({ title, count, ok, children }: { title: string; count: number; ok: string; children?: React.ReactNode }) {
  return (
    <div className="border border-neutral-200 rounded-lg p-2 space-y-1">
      <p className="flex items-center text-xs font-semibold text-neutral-800">
        {count ? <span className="w-2 h-2 mr-1.5 rounded-full bg-amber-500" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-green-600" />}
        {title}{count ? <span className="ml-1 font-normal text-neutral-500">({formatNumber(count)})</span> : null}
      </p>
      {count ? children : <p className="text-[11px] text-green-700 pl-5">{ok}</p>}
    </div>
  );
}

/**
 * Kiküldés előtti ellenőrzés: csak gombnyomásra fut, és egy ablakban sorolja fel, ami nem mehet ki a másik félnek –
 * el nem fogadott korrektúrák, megjegyzések, kitöltetlen helyek, kiemelések, rejtett szöveg, a szerzők adatai.
 * A dokumentumhoz csak a tulajdonságok törlésénél nyúl, és csak külön gombra.
 */
export default function PreSendCheck() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [facts, setFacts] = useState<PreSendFacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);

  const run = async () => {
    setOpen(true);
    setRunning(true);
    setError(null);
    setCleared(null);
    try {
      setFacts(await readPreSendFacts());
    } catch (e) {
      console.error(e);
      setError('Nem sikerült végignézni a dokumentumot.');
    } finally {
      setRunning(false);
    }
  };

  const go = async (action: () => Promise<boolean | void>) => {
    try {
      const found = await action();
      if (found === false) setError('Ezt a helyet már nem találom; futtasd újra az ellenőrzést.');
    } catch (e) {
      console.error(e);
      setError('Nem sikerült odaugrani.');
    }
  };

  const placeholders = facts ? findPlaceholders(facts.texts) : [];
  const marked = facts?.ooxml ? findMarkedRuns(facts.ooxml) : { highlights: [], hidden: [] };
  const filledProperties = facts?.properties
    ? (Object.keys(PROPERTY_LABELS) as (keyof DocumentPropertiesInfo)[]).filter(key => facts.properties![key].trim())
    : [];
  const clearable = filledProperties.filter(key => CLEARABLE_PROPERTIES.includes(key));
  const trackedCount = facts ? (facts.tracked ? facts.tracked.length : facts.hasTracked ? 1 : 0) : 0;
  const openComments = facts?.comments?.filter(c => !c.resolved) ?? [];
  const problems = facts
    ? [trackedCount, facts.comments?.length ?? 0, placeholders.length, marked.highlights.length, marked.hidden.length, filledProperties.length > 0 ? 1 : 0].filter(Boolean).length
    : 0;

  const clearProperties = async () => {
    try {
      await clearDocumentProperties(clearable);
      setCleared(`Töröltem: ${clearable.map(key => PROPERTY_LABELS[key]).join(', ')}.`);
      setFacts(await readPreSendFacts());
    } catch (e) {
      console.error(e);
      setError('Nem sikerült törölni a tulajdonságokat.');
    }
  };

  return (
    <>
      <button
        onClick={run}
        className="w-full flex items-center justify-center py-1.5 text-xs font-medium border border-blue-600 text-blue-700 hover:bg-blue-50 rounded-lg"
        title="Megnézi, mi nem mehet ki a másik félnek: korrektúrák, megjegyzések, kitöltetlen helyek, kiemelések, rejtett szöveg, szerzők"
      >
        <Send className="w-3.5 h-3.5 mr-1" />Kiküldés előtti ellenőrzés
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Kiküldés előtti ellenőrzés">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-md max-h-full flex flex-col text-xs">
            <div className="flex items-center justify-between p-3 border-b border-neutral-200">
              <p className="text-sm font-semibold text-neutral-900">Kiküldés előtti ellenőrzés</p>
              <button onClick={() => setOpen(false)} aria-label="Bezárás" className="p-1 text-neutral-500 hover:text-neutral-900"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
              {running && <p className="flex items-center text-neutral-500"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Végignézem a dokumentumot…</p>}
              {error && <p className="text-red-700">{error}</p>}
              {facts && !running && (
                <>
                  <p className={`font-medium ${problems ? 'text-amber-800' : 'text-green-700'}`}>
                    {problems ? `⚠ ${problems} dolgot nézz meg, mielőtt kiküldöd.` : '✅ Nem találtam semmit, ami ne mehetne ki.'}
                  </p>

                  <Section title="El nem fogadott korrektúrák" count={trackedCount} ok="Nincs.">
                    {facts.tracked ? (
                      <>
                        <p className="text-neutral-600 pl-5">Szerzők: {[...new Set(facts.tracked.map(t => t.author))].join(', ')}. Elfogadni vagy elutasítani az Összevetés fülön vagy a Wordben (Véleményezés) lehet.</p>
                        <ul className="pl-5 space-y-0.5">
                          {facts.tracked.slice(0, MAX_SHOWN).map((t, i) => (
                            <li key={i} className="flex items-center justify-between space-x-2">
                              <span className="truncate">{t.type === 'Deleted' ? '🗑' : t.type === 'Added' ? '➕' : '✎'} {t.author}: „{short(t.text, 60)}”</span>
                              <Jump onClick={() => go(() => selectReviewItem('tracked', i))} />
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <p className="text-neutral-600 pl-5">A dokumentumban el nem fogadott korrektúra van. (A felsorolásukhoz Microsoft 365 kell; a Wordben: Véleményezés → Következő.)</p>
                    )}
                  </Section>

                  {facts.comments && (
                    <Section title="Megjegyzések" count={facts.comments.length} ok="Nincs megjegyzés.">
                      <p className="text-neutral-600 pl-5">{openComments.length} megoldatlan. A belső megjegyzéseket kiküldés előtt töröld (Véleményezés → Törlés → Az összes megjegyzés törlése).</p>
                      <ul className="pl-5 space-y-0.5">
                        {facts.comments.slice(0, MAX_SHOWN).map((c, i) => (
                          <li key={i} className="flex items-center justify-between space-x-2">
                            <span className="truncate">{c.resolved ? '✓ ' : ''}{c.author}: „{short(c.text, 60)}”</span>
                            <Jump onClick={() => go(() => selectReviewItem('comment', i))} />
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  <Section title="Kitöltetlen helyek" count={placeholders.length} ok="Nem találtam [●], XX, ……, TBD jellegű helyet.">
                    <ul className="pl-5 space-y-0.5">
                      {placeholders.slice(0, MAX_SHOWN).map((p, i) => (
                        <li key={i} className="flex items-center justify-between space-x-2">
                          <span className="truncate"><strong>{p.found}</strong> – {p.context}</span>
                          <Jump onClick={() => go(() => jumpToParagraph(p.paragraph, false).then(() => true))} />
                        </li>
                      ))}
                    </ul>
                  </Section>

                  {facts.ooxml !== null ? (
                    <>
                      <Section title="Kiemelt (színes hátterű) szöveg" count={marked.highlights.length} ok="Nincs kiemelés.">
                        <ul className="pl-5 space-y-0.5">
                          {marked.highlights.slice(0, MAX_SHOWN).map((h, i) => (
                            <li key={i} className="flex items-center justify-between space-x-2">
                              <span className="truncate">{HIGHLIGHT_NAMES[h.mark] ?? h.mark}: „{short(h.text, 60)}”</span>
                              <Jump onClick={() => go(() => selectText(h.text))} />
                            </li>
                          ))}
                        </ul>
                      </Section>
                      <Section title="Rejtett szöveg" count={marked.hidden.length} ok="Nincs rejtett szöveg.">
                        <p className="text-neutral-600 pl-5">Nyomtatásban és a képernyőn nem látszik, de a fájlban benne van, és a másik fél megtalálhatja.</p>
                        <ul className="pl-5 space-y-0.5">
                          {marked.hidden.slice(0, MAX_SHOWN).map((h, i) => (
                            <li key={i} className="flex items-center justify-between space-x-2">
                              <span className="truncate">„{short(h.text, 70)}”</span>
                              <Jump onClick={() => go(() => selectText(h.text))} />
                            </li>
                          ))}
                        </ul>
                      </Section>
                    </>
                  ) : (
                    <p className="text-neutral-500">A kiemeléseket és a rejtett szöveget ebben a Wordben nem tudtam végignézni.</p>
                  )}

                  {facts.properties && (
                    <Section title="Szerzők és tulajdonságok" count={filledProperties.length} ok="A dokumentum tulajdonságai üresek.">
                      <ul className="pl-5 space-y-0.5">
                        {filledProperties.map(key => (
                          <li key={key}><span className="text-neutral-500">{PROPERTY_LABELS[key]}:</span> {short(facts.properties![key], 70)}</li>
                        ))}
                      </ul>
                      {clearable.length > 0 && (
                        <button onClick={clearProperties} className="ml-5 flex items-center px-2 py-1 font-medium border border-red-400 text-red-700 hover:bg-red-50 rounded-md">
                          <Eraser className="w-3 h-3 mr-1" />Szerzői adatok törlése ({clearable.length})
                        </button>
                      )}
                      <p className="text-neutral-500 pl-5">Az „Utoljára mentette” és a sablon nevét a Word maga írja; teljes tisztításhoz: Fájl → Információ → Problémák keresése → Dokumentum ellenőrzése.</p>
                      {cleared && <p className="text-green-700 pl-5">{cleared}</p>}
                    </Section>
                  )}
                </>
              )}
            </div>
            <div className="p-3 border-t border-neutral-200 flex space-x-2">
              <button onClick={run} disabled={running} className="flex-1 py-1.5 font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg">Újra ellenőrzöm</button>
              <button onClick={() => setOpen(false)} className="flex-1 py-1.5 font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-100 rounded-lg">Bezárás</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
