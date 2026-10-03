import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Loader2, MousePointerClick, Paintbrush, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  defaultOptions, defaultProfile, STYLE_PRESETS, FORMAT_CATEGORIES, headingLevelCount, planFormatting, summarize, TEXT_CATEGORIES,
  type AuditSummary, type Category, type FormatAudit, type FormatOptions, type FormatProfile,
} from '../services/formatting';
import { UserFacingError, applyFormatPlan, canOpenNewDocument, openNewDocument, readDocumentFile, readFormatAudit, readSelectionFormat } from '../services/wordDocument';
import { toBase64 } from '../services/docxWriter';
import { documentName, downloadDocx } from '../services/download';
import { formatNumber } from '../services/format';

const CATEGORY_LABELS: Record<Category, { label: string; title: string }> = {
  font: { label: 'Betűtípus', title: 'Minden bekezdés (és lábjegyzet) ugyanazzal a betűtípussal' },
  size: { label: 'Betűméret', title: 'A szövegtörzs (és a táblázatok) egy méretben' },
  headings: { label: 'Címsorok', title: 'A címsorok nagyobbak és félkövérek' },
  footnotes: { label: 'Lábjegyzetek', title: 'A lábjegyzetek kisebbek' },
  spacing: { label: 'Térközök', title: 'Egységes bekezdés előtti/utáni térköz és sorköz (táblázaton kívül)' },
  color: { label: 'Címek színe', title: 'A címek egyforma színűek (csak ha választasz színt)' },
  indent: { label: 'Behúzások', title: 'Első sor, bal és jobb behúzás a szövegbekezdéseken (számozott listákhoz nem nyúl)' },
  pagination: { label: 'Címsor együtt marad a következővel', title: 'A címsor stílusa: a cím nem maradhat egyedül a lap alján' },
  margins: { label: 'Oldalmargók', title: 'Felső, alsó, bal és jobb margó (csak ha megadsz értéket; asztali Word kell)' },
  alignment: { label: 'Igazítás', title: 'A balra zárt és sorkizárt bekezdések egyformán; a középre és jobbra igazítotthoz nem nyúl' },
  emptyParagraphs: { label: 'Többszörös üres sorok törlése', title: 'Ahol két vagy több üres bekezdés áll egymás után, csak egy marad' },
  doubleSpaces: { label: 'Dupla szóközök cseréje', title: 'Két vagy több szóköz helyett egy' },
};

const HEADING_COLORS: [string, string][] = [
  ['', 'Nem változtat'],
  ['#000000', 'Fekete'],
  ['#1F3864', 'Sötétkék'],
  ['#404040', 'Sötétszürke'],
  ['#7B1E3A', 'Bordó'],
  ['#1E4D2B', 'Sötétzöld'],
];
const COMMON_FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Garamond', 'Cambria', 'Georgia', 'Tahoma', 'Verdana'];
const LEVEL_NAMES = (level: number) => `Címsor ${level}`;
const pt = (n: number) => `${formatNumber(Math.round(n * 10) / 10)} pt`;

interface Snapshot {
  bytes: Uint8Array;
  base64: string;
  takenAt: Date;
}

/** A number field in points */
function PointsInput({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between space-x-2">
      <span className="text-neutral-600">{label}</span>
      <span className="flex items-center">
        <input
          type="number"
          min={0}
          max={72}
          step={0.5}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0 && n <= 72) onChange(n);
          }}
          className="w-16 p-1 text-right border border-neutral-300 rounded-md bg-neutral-50 disabled:opacity-50"
        />
        <span className="ml-1 text-neutral-400">pt</span>
      </span>
    </label>
  );
}

/** A number field in centimetres */
function CmInput({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between space-x-1">
      <span className="text-neutral-600">{label.replace(' margó', '')}</span>
      <span className="flex items-center">
        <input
          type="number"
          min={0}
          max={15}
          step={0.1}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 0 && n <= 15) onChange(n);
          }}
          className="w-14 p-1 text-right border border-neutral-300 rounded-md bg-neutral-50 disabled:opacity-50"
        />
        <span className="ml-1 text-neutral-400">cm</span>
      </span>
    </label>
  );
}

/**
 * Formázás nézet: a dokumentum formázásának átvilágítása (AI nélkül) és egységesítése. Csak a megjelenéshez nyúl;
 * előtte elmenti a dokumentum teljes állapotát, ami egy kattintással új ablakban megnyitható.
 */
export default function FormatPanel({ active, onDocumentChanged }: { active: boolean; onDocumentChanged: () => void }) {
  const [audit, setAudit] = useState<FormatAudit | null>(null);
  const [reading, setReading] = useState(false);
  const [profile, setProfile] = useState<FormatProfile | null>(null);
  const [options, setOptions] = useState<FormatOptions>(defaultOptions);
  /** The answer to the heading question; null: not asked or not answered yet */
  const [headingAnswer, setHeadingAnswer] = useState<'separate' | 'unified' | null>(null);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Saving the previous state failed: the user may go on without it, but only after saying so */
  const [noSnapshotAsk, setNoSnapshotAsk] = useState(false);
  /** The state before the first unification, and before the latest one (when there were more) */
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const summary: AuditSummary | null = useMemo(() => (audit ? summarize(audit) : null), [audit]);

  const read = useCallback(async (keepProfile = false) => {
    setReading(true);
    setError(null);
    try {
      const next = await readFormatAudit();
      setAudit(next);
      if (!keepProfile) {
        setProfile(defaultProfile(summarize(next)));
        setHeadingAnswer(null);
      }
    } catch (e) {
      console.error(e);
      setError('Nem sikerült beolvasni a dokumentum formázását.');
    } finally {
      setReading(false);
    }
  }, []);

  // Read on the first visit; on every later visit again (the document may have changed), keeping the choices
  useEffect(() => {
    if (!active || typeof Word === 'undefined') return;
    read(!!audit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const levels = summary ? headingLevelCount(summary, options.fakeHeadings) : 0;
  const askHeadings = levels > 1 && options.categories.headings;
  const plan = useMemo(
    () => (audit && profile ? planFormatting(audit, profile, { ...options, unifyHeadings: headingAnswer === 'unified' }) : null),
    [audit, profile, options, headingAnswer]
  );
  const total = plan ? plan.changes.length + (plan.footnotes ? 1 : 0) + plan.keepWithNextStyles.length + (plan.margins ? 1 : 0) + plan.deleteEmpty.length + (plan.doubleSpaces ? 1 : 0) : 0;
  const busy = reading || applying;

  const setCategory = (category: Category, on: boolean) => setOptions(o => ({ ...o, categories: { ...o.categories, [category]: on } }));
  const setProfileValue = <K extends keyof FormatProfile>(key: K, value: FormatProfile[K]) => setProfile(p => p && { ...p, [key]: value });

  /** "Like the paragraph the cursor is in": for the body text, or for the headings */
  const takeFromSelection = async (role: 'body' | 'heading') => {
    setError(null);
    try {
      const format = await readSelectionFormat();
      setProfile(p => {
        if (!p) return p;
        if (role === 'heading') return format.size ? { ...p, headingSize: format.size } : p;
        return {
          ...p,
          ...(format.font ? { font: format.font } : {}),
          ...(format.size ? { bodySize: format.size } : {}),
          leftIndent: format.leftIndent,
          rightIndent: format.rightIndent,
          bodySpaceBefore: format.spaceBefore,
          bodySpaceAfter: format.spaceAfter,
          firstLineIndent: format.firstLineIndent,
          ...(format.lineSpacing ? { lineSpacing: format.lineSpacing } : {}),
          ...(format.alignment === 'Left' || format.alignment === 'Justified' ? { alignment: format.alignment } : {}),
        };
      });
      setStatus(role === 'heading' ? 'A címsor méretét a kijelölt bekezdésről vettem át.' : 'A betűtípust, a méretet és a térközt a kijelölt bekezdésről vettem át.');
    } catch (e) {
      console.error(e);
      setError('Nem sikerült beolvasni a kijelölt bekezdést.');
    }
  };

  const apply = async (withoutSnapshot = false) => {
    if (!audit || !plan || !total || busy || (askHeadings && !headingAnswer)) return;
    setApplying(true);
    setError(null);
    setStatus(null);
    setNoSnapshotAsk(false);
    try {
      // The previous state first: if anything goes wrong, the document can be had back as it was
      if (!withoutSnapshot) {
        try {
          const bytes = await readDocumentFile();
          const taken = { bytes, base64: toBase64(bytes), takenAt: new Date() };
          setSnapshots(previous => (previous.length ? [previous[0], taken] : [taken]));
          setSnapshotError(null);
        } catch (e) {
          console.error(e);
          setNoSnapshotAsk(true);
          return;
        }
      }
      const outcome = await applyFormatPlan(plan, audit.paragraphs.map(p => p.text));
      onDocumentChanged();
      const parts = [
        outcome.formatted ? `${formatNumber(outcome.formatted)} bekezdés formázása` : '',
        outcome.footnotes ? `${formatNumber(outcome.footnotes)} lábjegyzet` : '',
        outcome.keepWithNext ? `${outcome.keepWithNext} címsorstílus együtt marad a következő bekezdéssel` : '',
        outcome.margins ? `oldalmargók (${outcome.margins} szakasz)` : '',
        outcome.deleted ? `${formatNumber(outcome.deleted)} üres sor törölve` : '',
        outcome.spaces ? `${formatNumber(outcome.spaces)} dupla szóköz cserélve` : '',
      ].filter(Boolean);
      const how = outcome.write ? ` A szöveg változásai ${outcome.write.tracked ? 'korrektúrával' : 'korrektúra nélkül'} kerültek be${outcome.write.forced ? ' (a dokumentumban el nem fogadott korrektúra van, ezért mindenképp korrektúrával)' : ''}.` : '';
      setStatus(`✅ Kész: ${parts.join(', ')}. A formázás korrektúra nélkül került be.${how}${outcome.notes.length ? ` ${outcome.notes.join(' ')}` : ''}`);
      await read(true);
    } catch (e) {
      console.error(e);
      // Read again first (it clears the message), so the next try works on the document as it is now
      await read(true);
      setError(e instanceof UserFacingError ? e.message : 'Nem sikerült végigvinni az egységesítést. Ha valami félig átállt, az előző állapot lent megnyitható.');
    } finally {
      setApplying(false);
    }
  };

  const openSnapshot = async (snapshot: Snapshot) => {
    setSnapshotError(null);
    try {
      if (!canOpenNewDocument()) throw new Error('unsupported');
      await openNewDocument(snapshot.base64);
    } catch (e) {
      console.error(e);
      setSnapshotError('Nem sikerült új ablakban megnyitni. Töltsd le, és nyisd meg a letöltött fájlt.');
    }
  };

  if (typeof Word === 'undefined') {
    return <p className="p-4 text-sm text-neutral-500">A Formázás nézet csak Wordben működik.</p>;
  }

  const fonts = summary ? [...new Set([...summary.fonts.map(([f]) => f).filter(Boolean), ...COMMON_FONTS])] : COMMON_FONTS;
  const footnotesKnown = !!audit?.footnotes?.length;
  const marginsKnown = !!audit?.margins?.length;
  const textCategories = TEXT_CATEGORIES.filter(c => (c === 'emptyParagraphs' ? summary?.extraEmpty.length : summary?.doubleSpaces));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-xs">
      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-neutral-600">A dokumentum formázásának átvilágítása és egységesítése, AI nélkül. A szöveghez nem nyúl.</p>
          <button onClick={() => read()} disabled={busy} title="Átvilágítás újra" aria-label="Átvilágítás" className="ml-2 p-1 text-neutral-500 hover:text-neutral-800 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${reading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {reading && !summary && <p className="flex items-center text-neutral-500"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Átvilágítom…</p>}
        {summary && (
          <ul className="space-y-0.5 text-neutral-800">
            <li><strong>Betűtípus:</strong> {summary.fonts.map(([f, n]) => `${f || 'vegyes'} (${n})`).join(', ') || '–'}</li>
            <li><strong>Betűméret:</strong> {summary.sizes.map(([s, n]) => `${pt(s)} (${n})`).join(', ') || '–'}</li>
            <li><strong>Térközök:</strong> {summary.spacings <= 1 ? 'egységes' : `${summary.spacings} féle beállítás`}</li>
            <li>
              <strong>Címsorok:</strong>{' '}
              {[
                ...summary.headingLevels.map(([level, n]) => `${LEVEL_NAMES(level)}: ${n}`),
                summary.fakeHeadings.length ? `stílus nélküli (félkövér vagy nagybetűs): ${summary.fakeHeadings.length}` : '',
              ].filter(Boolean).join(', ') || 'nincs'}
            </li>
            {audit?.footnotes && <li><strong>Lábjegyzetek:</strong> {audit.footnotes.length ? `${audit.footnotes.length} (${summary.footnoteSizes!.map(([s]) => pt(s)).join(', ')})` : 'nincs'}</li>}
            {summary.extraEmpty.length > 0 && <li><strong>Többszörös üres sor:</strong> {summary.extraEmpty.length}</li>}
            {summary.doubleSpaces > 0 && <li><strong>Dupla szóköz:</strong> {summary.doubleSpaces}</li>}
          </ul>
        )}
        {error && <p className="text-red-700">{error}</p>}
      </div>

      {summary && profile && plan && (
        <>
          {summary.fakeHeadings.length > 0 && (
            <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1">
              <label className="flex items-start space-x-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5" checked={options.fakeHeadings} disabled={busy} onChange={e => setOptions(o => ({ ...o, fakeHeadings: e.target.checked }))} />
                <span>A stílus nélküli címeket is címsorként formázom ({summary.fakeHeadings.length})</span>
              </label>
              <p className="text-neutral-500 pl-5">Pl. {summary.fakeHeadings.slice(0, 4).map(t => `„${t.length > 40 ? `${t.slice(0, 40)}…` : t}”`).join(', ')}. Ha ezek között nem cím is van (pl. aláírásnál egy név), vedd ki a pipát.</p>
            </div>
          )}

          {askHeadings && (
            <div className={`border rounded-xl p-3 space-y-1.5 ${headingAnswer ? 'bg-white border-neutral-200' : 'bg-amber-50 border-amber-300'}`} role="group" aria-label="Címsorszintek">
              <p className="font-semibold text-neutral-900">Tudatosan van {levels} külön címsorszint?</p>
              <p className="text-neutral-600">Gyakran nem: valójában mind ugyanolyan cím, csak más stílust kaptak. A számozás és a tartalomjegyzék szintjei mindkét esetben maradnak, csak a megjelenés változik.</p>
              <label className="flex items-start space-x-2 cursor-pointer">
                <input type="radio" name="headings" className="mt-0.5" checked={headingAnswer === 'separate'} disabled={busy} onChange={() => setHeadingAnswer('separate')} />
                <span><strong>Igen, külön szintek</strong> – a magasabb szint nagyobb</span>
              </label>
              <label className="flex items-start space-x-2 cursor-pointer">
                <input type="radio" name="headings" className="mt-0.5" checked={headingAnswer === 'unified'} disabled={busy} onChange={() => setHeadingAnswer('unified')} />
                <span><strong>Nem, mind egy szint</strong> – minden cím egyforma</span>
              </label>
            </div>
          )}

          <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
            <p className="font-semibold text-neutral-700">Egységes stílus</p>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => audit && setProfile(defaultProfile(summarize(audit)))} disabled={busy} title="A dokumentum leggyakoribb beállításai" className="px-2 py-1 border border-neutral-300 rounded-md hover:bg-neutral-100 disabled:opacity-50">Ebből a dokumentumból</button>
              {STYLE_PRESETS.map(preset => (
                <button key={preset.id} onClick={() => setProfile(preset.profile)} disabled={busy} title={preset.description} className="px-2 py-1 border border-blue-300 text-blue-800 rounded-md hover:bg-blue-50 disabled:opacity-50">{preset.name}</button>
              ))}
            </div>
            <label className="flex items-center justify-between space-x-2">
              <span className="text-neutral-600">Betűtípus</span>
              <select value={profile.font} disabled={busy} onChange={e => setProfileValue('font', e.target.value)} aria-label="Betűtípus" className="p-1 border border-neutral-300 rounded-md bg-neutral-50 max-w-[60%]">
                {fonts.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="flex items-center justify-between space-x-2">
              <span className="text-neutral-600">Címsorok betűtípusa</span>
              <select value={profile.headingFont} disabled={busy} onChange={e => setProfileValue('headingFont', e.target.value)} aria-label="Címsorok betűtípusa" className="p-1 border border-neutral-300 rounded-md bg-neutral-50 max-w-[60%]">
                <option value="">Mint a szöveg</option>
                {fonts.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <PointsInput label="Szöveg mérete" value={profile.bodySize} disabled={busy} onChange={n => setProfileValue('bodySize', Math.max(6, n))} />
            <PointsInput label={askHeadings && headingAnswer !== 'unified' ? 'Legnagyobb címsor mérete' : 'Címsor mérete'} value={profile.headingSize} disabled={busy} onChange={n => setProfileValue('headingSize', Math.max(6, n))} />
            {footnotesKnown && <PointsInput label="Lábjegyzet mérete" value={profile.footnoteSize} disabled={busy} onChange={n => setProfileValue('footnoteSize', Math.max(6, n))} />}
            <PointsInput label="Bekezdés előtti térköz" value={profile.bodySpaceBefore} disabled={busy} onChange={n => setProfileValue('bodySpaceBefore', n)} />
            <PointsInput label="Bekezdés utáni térköz" value={profile.bodySpaceAfter} disabled={busy} onChange={n => setProfileValue('bodySpaceAfter', n)} />
            <PointsInput label="Címsor előtti térköz" value={profile.headingSpaceBefore} disabled={busy} onChange={n => setProfileValue('headingSpaceBefore', n)} />
            <PointsInput label="Címsor utáni térköz" value={profile.headingSpaceAfter} disabled={busy} onChange={n => setProfileValue('headingSpaceAfter', n)} />
            <PointsInput label="Sorköz (0 = nem változtat)" value={profile.lineSpacing} disabled={busy} onChange={n => setProfileValue('lineSpacing', n)} />
            <p className="text-neutral-500">Pontban: a szöveg méretének kb. 1,2-szerese a megszokott (11 pt-nál 13–14 pt).</p>
            <PointsInput label="Első sor behúzása (0 = nem változtat)" value={profile.firstLineIndent} disabled={busy} onChange={n => setProfileValue('firstLineIndent', n)} />
            <PointsInput label="Bal behúzás (0 = nem változtat)" value={profile.leftIndent} disabled={busy} onChange={n => setProfileValue('leftIndent', n)} />
            <PointsInput label="Jobb behúzás (0 = nem változtat)" value={profile.rightIndent} disabled={busy} onChange={n => setProfileValue('rightIndent', n)} />
            <label className="flex items-center justify-between space-x-2">
              <span className="text-neutral-600">Címek színe</span>
              <select value={profile.headingColor} disabled={busy} onChange={e => setProfileValue('headingColor', e.target.value)} aria-label="Címek színe" className="p-1 border border-neutral-300 rounded-md bg-neutral-50">
                {HEADING_COLORS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
              </select>
            </label>
            {marginsKnown && (
              <div className="pt-1 space-y-1.5">
                <p className="text-neutral-500">Oldalmargók cm-ben (0 = nem változtat):</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <CmInput label="Felső margó" value={profile.marginTop} disabled={busy} onChange={n => setProfileValue('marginTop', n)} />
                  <CmInput label="Alsó margó" value={profile.marginBottom} disabled={busy} onChange={n => setProfileValue('marginBottom', n)} />
                  <CmInput label="Bal margó" value={profile.marginLeft} disabled={busy} onChange={n => setProfileValue('marginLeft', n)} />
                  <CmInput label="Jobb margó" value={profile.marginRight} disabled={busy} onChange={n => setProfileValue('marginRight', n)} />
                </div>
              </div>
            )}
            <label className="flex items-center justify-between space-x-2">
              <span className="text-neutral-600">Igazítás</span>
              <select value={profile.alignment} disabled={busy} onChange={e => setProfileValue('alignment', e.target.value as FormatProfile['alignment'])} aria-label="Igazítás" className="p-1 border border-neutral-300 rounded-md bg-neutral-50">
                <option value="Justified">Sorkizárt</option>
                <option value="Left">Balra zárt</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button onClick={() => takeFromSelection('body')} disabled={busy} className="flex items-center px-2 py-1 border border-neutral-300 rounded-md hover:bg-neutral-100 disabled:opacity-50" title="Kattints egy jól formázott szövegbekezdésbe, majd ide">
                <MousePointerClick className="w-3 h-3 mr-1" />Szöveg: mint a kijelölt
              </button>
              <button onClick={() => takeFromSelection('heading')} disabled={busy} className="flex items-center px-2 py-1 border border-neutral-300 rounded-md hover:bg-neutral-100 disabled:opacity-50" title="Kattints egy jól formázott címbe, majd ide">
                <MousePointerClick className="w-3 h-3 mr-1" />Cím: mint a kijelölt
              </button>
            </div>
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
            <p className="font-semibold text-neutral-700">Mit egységesítsek?</p>
            {FORMAT_CATEGORIES.filter(c => (c !== 'footnotes' || footnotesKnown) && (c !== 'margins' || marginsKnown)).map(c => (
              <label key={c} className="flex items-center justify-between cursor-pointer" title={CATEGORY_LABELS[c].title}>
                <span className="flex items-center space-x-2">
                  <input type="checkbox" checked={options.categories[c]} disabled={busy} onChange={e => setCategory(c, e.target.checked)} />
                  <span>{CATEGORY_LABELS[c].label}</span>
                </span>
                <span className="text-neutral-500">{options.categories[c] ? (plan.counts[c] ? `${formatNumber(plan.counts[c])} helyen` : 'rendben') : 'kihagyva'}</span>
              </label>
            ))}
            {textCategories.length > 0 && (
              <div className="pt-1.5 mt-1 border-t border-neutral-100 space-y-1.5">
                <p className="text-neutral-500">A szöveget is módosítja (korrektúrával, a szokásos szabály szerint):</p>
                {textCategories.map(c => (
                  <label key={c} className="flex items-center justify-between cursor-pointer" title={CATEGORY_LABELS[c].title}>
                    <span className="flex items-center space-x-2">
                      <input type="checkbox" checked={options.categories[c]} disabled={busy} onChange={e => setCategory(c, e.target.checked)} />
                      <span>{CATEGORY_LABELS[c].label}</span>
                    </span>
                    <span className="text-neutral-500">{c === 'emptyParagraphs' ? summary.extraEmpty.length : summary.doubleSpaces}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
            <p className="text-neutral-700">
              {total
                ? <>Ez történik: <strong>{formatNumber(plan.changes.length)} bekezdés</strong> formázása{plan.footnotes ? ', a lábjegyzetek' : ''}{plan.deleteEmpty.length ? `, ${plan.deleteEmpty.length} üres sor törlése` : ''}{plan.doubleSpaces ? `, ${summary.doubleSpaces} dupla szóköz cseréje` : ''}.</>
                : 'A kiválasztottak szerint a dokumentum már egységes, nincs mit változtatni.'}
            </p>
            <p className="flex items-start text-neutral-500">
              <ShieldCheck className="w-3.5 h-3.5 mr-1 mt-px shrink-0 text-green-700" />
              Előtte elmentem a dokumentum mostani állapotát (korrektúrákkal, megjegyzésekkel), és itt bármikor megnyithatod. A félkövér, dőlt, aláhúzott kiemelések, a számozás és a címsorszintek megmaradnak. A formázás korrektúra nélkül kerül be.
            </p>
            {askHeadings && !headingAnswer && <p className="text-amber-700">Előbb válaszolj a címsorszintekről fent.</p>}
            {noSnapshotAsk ? (
              <div className="space-y-1.5">
                <p className="text-red-700">Nem sikerült elmenteni a dokumentum mostani állapotát. Mentés nélkül csak a Word Ctrl+Z-je marad visszaútnak.</p>
                <div className="flex space-x-2">
                  <button onClick={() => apply(true)} className="flex-1 py-1.5 font-medium border border-red-500 text-red-700 hover:bg-red-50 rounded-lg">Mentés nélkül folytatom</button>
                  <button onClick={() => setNoSnapshotAsk(false)} className="flex-1 py-1.5 font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-100 rounded-lg">Mégse</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => apply()}
                disabled={busy || !total || (askHeadings && !headingAnswer)}
                className="w-full flex items-center justify-center py-2 font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg"
              >
                {applying ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Paintbrush className="w-4 h-4 mr-1" />}
                Egységesítés
              </button>
            )}
            {status && <p className="font-medium text-green-700">{status}</p>}
          </div>
        </>
      )}

      {snapshots.length > 0 && (
        <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
          <p className="font-semibold text-neutral-700">Előző állapot</p>
          <p className="text-neutral-500">Ha nem tetszik az eredmény: nyisd meg, és mentsd el a régi helyére (vagy Ctrl+Z a Wordben).</p>
          {snapshots.map((snapshot, i) => {
            const time = snapshot.takenAt.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={snapshot.takenAt.getTime()} className="space-y-1">
                <p className="text-neutral-800">{i === 0 ? `Az első egységesítés előtt (${time})` : `Egy későbbi egységesítés előtt (${time})`}</p>
                <div className="flex space-x-2">
                  <button onClick={() => openSnapshot(snapshot)} aria-label={`Megnyitás új ablakban: ${time}`} className="flex items-center px-2.5 py-1.5 font-medium border border-blue-600 text-blue-700 hover:bg-blue-50 rounded-lg">
                    <ExternalLink className="w-3.5 h-3.5 mr-1" />Megnyitás új ablakban
                  </button>
                  <button onClick={() => downloadDocx(snapshot.bytes, `${documentName() || 'Dokumentum'} - elozo allapot ${time.replace(':', '')}.docx`)} className="flex items-center px-2.5 py-1.5 font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-100 rounded-lg">
                    <Download className="w-3.5 h-3.5 mr-1" />Letöltés
                  </button>
                </div>
              </div>
            );
          })}
          {snapshotError && <p className="text-amber-700">{snapshotError}</p>}
        </div>
      )}
    </div>
  );
}
