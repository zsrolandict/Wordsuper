import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, Loader2, MousePointerClick, Paintbrush, RefreshCw, Save, ShieldCheck, Star, Trash2 } from 'lucide-react';
import {
  defaultOptions, defaultProfile, STYLE_PRESETS, FORMAT_CATEGORIES, headingLevelCount, planFormatting, summarize, TEXT_CATEGORIES,
  type AuditSummary, type Category, type FormatAudit, type FormatOptions, type FormatProfile,
} from '../services/formatting';
import { UserFacingError, applyFormatPlan, canOpenNewDocument, jumpToParagraph, openNewDocument, readDocumentFile, readFormatAudit, readSelectionFormat } from '../services/wordDocument';
import { AI_MARK_LABELS, findAiMarks, type AiMarkKind } from '../services/aiMarks';
import { MAX_STYLE_NAME, loadCustomStyles, newStyleId, saveCustomStyles, type CustomStyle } from '../services/customStyles';
import { toBase64 } from '../services/docxWriter';
import { documentName, downloadDocx } from '../services/download';
import { formatNumber } from '../services/format';

const CATEGORY_LABELS: Record<Category, { label: string; title: string }> = {
  font: { label: 'Betűtípus', title: 'Minden bekezdés (és lábjegyzet) ugyanazzal a betűtípussal' },
  size: { label: 'Betűméret', title: 'A szövegtörzs (és a táblázatok) egy méretben' },
  headings: { label: 'Címsorok', title: 'A címsorok nagyobbak, félkövérek (és ha kéred, kiskapitálisak, díszvonallal)' },
  footnotes: { label: 'Lábjegyzetek', title: 'A lábjegyzetek kisebbek' },
  spacing: { label: 'Térközök', title: 'Egységes bekezdés előtti/utáni térköz és sorköz (táblázaton kívül)' },
  alignment: { label: 'Igazítás', title: 'A balra zárt és sorkizárt bekezdések egyformán; a középre és jobbra igazítotthoz nem nyúl' },
  color: { label: 'Színek', title: 'A címek és a szöveg színe (csak ha választasz színt)' },
  indent: { label: 'Behúzások', title: 'Első sor, bal és jobb behúzás a szövegbekezdéseken (számozott listákhoz nem nyúl)' },
  pagination: { label: 'Címsor együtt marad a következővel', title: 'A címsor stílusa: a cím nem maradhat egyedül a lap alján' },
  margins: { label: 'Oldalmargók', title: 'Felső, alsó, bal és jobb margó (csak ha megadsz értéket; asztali Word kell)' },
  styles: { label: 'A Word saját stílusai is', title: 'A Normál és a Címsor stílusok is az új formát kapják, így az utána begépelt szöveg is egységes marad' },
  dashes: { label: 'Gondolatjelek (— és - helyett –)', title: 'Az angolos/AI-s hosszú gondolatjel (—), a dupla kötőjel (--) és a szóközök közötti kötőjel helyett a magyar „ – ”' },
  markdown: { label: 'Markdown-maradványok', title: 'AI-csevegésből bemásolt szöveg: **félkövér**, *dőlt*, # cím, - felsorolás; a jelek eltűnnek, a félkövér/dőlt valódi formázás lesz' },
  quotes: { label: 'Magyar idézőjelek', title: '"…" és “…” helyett „…”' },
  nbsp: { label: 'Nem törő szóközök', title: '§ 5, 2013. évi V. törvény, 2026. október 3., 100 000 Ft: nem törhet két sorba' },
  ranges: { label: 'Tartományok (2020–2025)', title: 'Két szám közötti kötőjel helyett nagykötőjel (2020-2025 → 2020–2025, 5-10. pont → 5–10. pont); telefonszámhoz, dátumhoz, számlaszámhoz nem nyúl' },
  punctuation: { label: 'Szóközök az írásjeleknél', title: 'Nincs szóköz vessző, pont stb. előtt („szó ,”), van utána („szó,szó”); számokhoz, rövidítésekhez, e-mail-címhez nem nyúl' },
  doubleSpaces: { label: 'Dupla szóközök', title: 'Két vagy több szóköz helyett egy' },
  emptyParagraphs: { label: 'Csak a többszörös üres sorok', title: 'Ahol két vagy több üres bekezdés áll egymás után, csak egy marad' },
  allEmpty: { label: 'Minden üres sor (a térköz veszi át)', title: 'Az összes térközként használt üres bekezdés törlődik; a távolságot a bekezdés utáni és a címsor előtti térköz adja' },
};

const COMMON_FONTS = ['Calibri', 'Cambria', 'Garamond', 'Georgia', 'Times New Roman', 'Arial', 'Tahoma', 'Verdana'];
const SERIF_FONTS = /Cambria|Garamond|Georgia|Times|Book|Palatino/i;
const ICT_DARK = '#0B3B60';
const ICT_ACCENT = '#2E75B6';
const HEADING_COLORS: [string, string][] = [
  ['', 'Nem változtat'],
  [ICT_DARK, 'ICT Europa sötétkék'],
  [ICT_ACCENT, 'ICT Europa kék'],
  ['#000000', 'Fekete'],
  ['#1F3864', 'Sötétkék'],
  ['#404040', 'Sötétszürke'],
  ['#7B1E3A', 'Bordó'],
  ['#1E4D2B', 'Sötétzöld'],
];
const RULE_COLORS: [string, string][] = [['', 'Nincs'], [ICT_ACCENT, 'ICT Europa kék'], [ICT_DARK, 'ICT Europa sötétkék'], ['#808080', 'Szürke']];
const BODY_COLORS: [string, string][] = [['', 'Nem változtat'], ['#1A1A1A', 'Grafit (kíméli a szemet)'], ['#000000', 'Fekete'], ['#262626', 'Sötétszürke']];
const LEVEL_NAMES = (level: number) => `Címsor ${level}`;
const pt = (n: number) => `${formatNumber(Math.round(n * 10) / 10)} pt`;
const DOCUMENT_PRESET = 'document';

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

function ColorSelect({ label, value, options, onChange, disabled }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between space-x-2">
      <span className="text-neutral-600">{label}</span>
      <span className="flex items-center space-x-1.5">
        {value && <span className="w-3 h-3 rounded-sm border border-neutral-300" style={{ background: value }} />}
        <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} aria-label={label} className="p-1 border border-neutral-300 rounded-md bg-neutral-50 max-w-[9.5rem]">
          {options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
        </select>
      </span>
    </label>
  );
}

/** The font as the browser can show it: the named font if installed, a similar family otherwise */
const cssFont = (font: string) => `"${font}", ${SERIF_FONTS.test(font) ? 'Georgia, "Times New Roman", serif' : 'Calibri, Arial, sans-serif'}`;

/**
 * A small sample page in the chosen style: a top-level heading (small capitals, the rule under it), a second-level
 * heading (the bar beside it) and a paragraph. Sizes are scaled down to fit the pane; the proportions are right.
 */
function StylePreview({ profile }: { profile: FormatProfile }) {
  const scale = 1.333 * 0.82;
  const px = (points: number) => `${(points * scale).toFixed(1)}px`;
  const headingFont = cssFont(profile.headingFont || profile.font);
  const headingColor = profile.headingColor || '#111111';
  const lineHeight = profile.lineSpacing > 0 ? (profile.lineSpacing / profile.bodySize).toFixed(2) : '1.3';
  const body: React.CSSProperties = {
    fontFamily: cssFont(profile.font),
    fontSize: px(profile.bodySize),
    color: profile.bodyColor || '#000000',
    lineHeight,
    textAlign: profile.alignment === 'Justified' ? 'justify' : 'left',
    textIndent: profile.firstLineIndent ? px(profile.firstLineIndent) : undefined,
    marginTop: px(profile.bodySpaceBefore),
    marginBottom: px(profile.bodySpaceAfter),
  };
  return (
    <div className="bg-white border border-neutral-200 rounded-lg px-4 py-3 shadow-inner" aria-label="Élő előnézet">
      <p
        style={{
          fontFamily: headingFont,
          fontSize: px(profile.headingSize),
          fontWeight: 700,
          fontVariant: profile.headingSmallCaps ? 'small-caps' : undefined,
          color: headingColor,
          borderBottom: profile.h1Rule ? `1.5px solid ${profile.h1Rule}` : undefined,
          paddingBottom: profile.h1Rule ? '2px' : undefined,
          marginBottom: px(profile.headingSpaceAfter),
        }}
      >
        1. A szerződés tárgya
      </p>
      <p style={body}>
        Eladó eladja, Vevő megvásárolja a 2. pontban meghatározott ingatlant a jelen szerződésben foglalt feltételekkel, a Ptk. § 6:215
        szerint, 2026. október 3. napján.
      </p>
      <p
        style={{
          fontFamily: headingFont,
          fontSize: px(Math.max(profile.bodySize + 1, profile.headingSize - 1)),
          fontWeight: 700,
          fontVariant: profile.headingSmallCaps ? 'small-caps' : undefined,
          color: headingColor,
          borderLeft: profile.h2Bar ? `3px solid ${profile.h2Bar}` : undefined,
          paddingLeft: profile.h2Bar ? '6px' : undefined,
          marginTop: px(Math.min(profile.headingSpaceBefore, 14)),
          marginBottom: px(profile.headingSpaceAfter),
        }}
      >
        1.1 Vételár
      </p>
      <p style={{ ...body, marginBottom: 0 }}>A vételár 125 000 000 Ft, amelyet Vevő a birtokbaadáskor fizet meg.</p>
    </div>
  );
}

/**
 * Formázás nézet: a dokumentum formázásának átvilágítása (AI nélkül) és egységesítése. Csak a megjelenéshez nyúl
 * (a szöveget csak a külön bekapcsolható szövegfésülés módosítja); előtte elmenti a dokumentum teljes állapotát, ami
 * egy kattintással új ablakban megnyitható.
 */
export default function FormatPanel({ active, onDocumentChanged }: { active: boolean; onDocumentChanged: () => void }) {
  const [audit, setAudit] = useState<FormatAudit | null>(null);
  const [reading, setReading] = useState(false);
  const [profile, setProfile] = useState<FormatProfile | null>(null);
  /** The style card chosen; "customized": a value was changed by hand after */
  const [presetId, setPresetId] = useState(DOCUMENT_PRESET);
  const [customized, setCustomized] = useState(false);
  /** The panel's own tabs: choose a style, set it by hand, clean the text, choose what to unify */
  const [view, setView] = useState<'styles' | 'manual' | 'text' | 'scope'>('styles');
  const [ownStyles, setOwnStyles] = useState<CustomStyle[]>(loadCustomStyles);
  const [styleName, setStyleName] = useState('');
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
        setPresetId(DOCUMENT_PRESET);
        setCustomized(false);
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
  const total = plan
    ? plan.changes.length + (plan.footnotes ? 1 : 0) + plan.styleUpdates.length + plan.keepWithNextStyles.length + (plan.margins ? 1 : 0)
      + plan.textFixes.length + plan.deleteEmpty.length + (plan.doubleSpaces ? 1 : 0)
    : 0;
  const busy = reading || applying;

  const setCategory = (category: Category, on: boolean) => setOptions(o => ({ ...o, categories: { ...o.categories, [category]: on } }));
  const setProfileValue = <K extends keyof FormatProfile>(key: K, value: FormatProfile[K]) => {
    setProfile(p => p && { ...p, [key]: value });
    setCustomized(true);
  };
  const choosePreset = (id: string) => {
    if (!audit) return;
    const own = ownStyles.find(o => o.id === id);
    setProfile(id === DOCUMENT_PRESET ? defaultProfile(summarize(audit)) : own ? own.profile : STYLE_PRESETS.find(p => p.id === id)!.profile);
    setPresetId(id);
    setCustomized(false);
    setStyleName(own?.name ?? '');
  };
  const ownSelected = ownStyles.find(o => o.id === presetId);
  const storeOwn = (next: CustomStyle[]) => {
    setOwnStyles(next);
    saveCustomStyles(next);
  };
  /** Saves the current values: over the chosen own style, or as a new one */
  const saveStyle = (asNew: boolean) => {
    const name = styleName.trim().slice(0, MAX_STYLE_NAME);
    if (!profile || !name) return;
    if (!asNew && ownSelected) {
      storeOwn(ownStyles.map(o => (o.id === ownSelected.id ? { ...o, name, profile } : o)));
      setStatus(`💾 A(z) „${name}” stílust frissítettem.`);
    } else {
      const created = { id: newStyleId(), name, profile };
      storeOwn([...ownStyles, created]);
      setPresetId(created.id);
      setStatus(`💾 „${name}” elmentve saját stílusként; a Stílusok között megtalálod.`);
    }
    setCustomized(false);
  };
  const deleteStyle = () => {
    if (!ownSelected) return;
    storeOwn(ownStyles.filter(o => o.id !== ownSelected.id));
    setPresetId(DOCUMENT_PRESET);
    setStyleName('');
    setStatus(`A(z) „${ownSelected.name}” saját stílust töröltem.`);
  };

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
      setCustomized(true);
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
        outcome.styles ? `${outcome.styles} Word-stílus frissítve` : '',
        outcome.footnotes ? `${formatNumber(outcome.footnotes)} lábjegyzet` : '',
        outcome.keepWithNext ? `${outcome.keepWithNext} címsorstílus együtt marad a következő bekezdéssel` : '',
        outcome.margins ? `oldalmargók (${outcome.margins} szakasz)` : '',
        outcome.cleaned ? `${formatNumber(outcome.cleaned)} helyen szövegtisztítás` : '',
        outcome.quotes ? `${formatNumber(outcome.quotes)} idézőjel` : '',
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


  const jump = async (paragraph: number) => {
    try {
      await jumpToParagraph(paragraph, false);
    } catch (e) {
      setError(e instanceof UserFacingError ? e.message : 'Nem sikerült odaugrani.');
    }
  };

  if (typeof Word === 'undefined') {
    return <p className="p-4 text-sm text-neutral-500">A Formázás nézet csak Wordben működik.</p>;
  }

  const fonts = summary ? [...new Set([...summary.fonts.map(([f]) => f).filter(Boolean), ...COMMON_FONTS])] : COMMON_FONTS;
  const footnotesKnown = !!audit?.footnotes?.length;
  const marginsKnown = !!audit?.margins?.length;
  const aiMarks = audit ? findAiMarks(audit) : [];
  const textCounts: Partial<Record<Category, number>> = summary
    ? {
      dashes: summary.dashes, markdown: summary.markdown, quotes: summary.straightQuotes, nbsp: summary.nbsp, ranges: summary.ranges,
      punctuation: summary.punctuation, doubleSpaces: summary.doubleSpaces, emptyParagraphs: summary.extraEmpty.length, allEmpty: summary.allEmpty.length,
    }
    : {};
  const cleanupTotal = summary ? summary.dashes + summary.markdown + summary.straightQuotes + summary.nbsp + summary.ranges + summary.punctuation + summary.doubleSpaces + summary.allEmpty.length : 0;
  const emptyMode = options.categories.allEmpty ? 'all' : options.categories.emptyParagraphs ? 'repeated' : 'keep';
  const setEmptyMode = (mode: 'keep' | 'repeated' | 'all') => setOptions(o => ({ ...o, categories: { ...o.categories, emptyParagraphs: mode === 'repeated', allEmpty: mode === 'all' } }));

  // The state in one line: what is uneven, or that nothing is
  const findings = summary ? [
    summary.fonts.length > 1 ? `${summary.fonts.length} féle betűtípus` : '',
    summary.sizes.length > 1 ? `${summary.sizes.length} féle betűméret` : '',
    summary.spacings > 1 ? `${summary.spacings} féle térköz` : '',
    summary.fakeHeadings.length ? `${summary.fakeHeadings.length} stílus nélküli cím` : '',
    summary.allEmpty.length ? `${summary.allEmpty.length} üres sor térköznek használva` : '',
    cleanupTotal - summary.allEmpty.length > 0 ? `${formatNumber(cleanupTotal - summary.allEmpty.length)} tisztítandó hely a szövegben` : '',
    aiMarks.length ? `${aiMarks.length} AI-nyom` : '',
  ].filter(Boolean) : [];

  const presetCards = [
    ...STYLE_PRESETS.filter(p => p.featured),
    { id: DOCUMENT_PRESET, name: 'Ebből a dokumentumból', description: 'A dokumentum leggyakoribb beállításai, egységesítve', featured: false, profile: null as FormatProfile | null, own: false },
    ...STYLE_PRESETS.filter(p => !p.featured).map(p => ({ ...p, own: false })),
    ...ownStyles.map(o => ({ id: o.id, name: o.name, description: `Saját stílus: ${o.profile.font} ${formatNumber(o.profile.bodySize)} pt`, featured: false, profile: o.profile, own: true })),
  ];

  const tabs: { id: typeof view; label: string; badge?: number }[] = [
    { id: 'styles', label: 'Stílusok' },
    { id: 'manual', label: 'Kézi' },
    { id: 'text', label: 'Szöveg', badge: aiMarks.length || undefined },
    { id: 'scope', label: 'Kategóriák' },
  ];

  const marksByKind = (Object.keys(AI_MARK_LABELS) as AiMarkKind[])
    .map(kind => ({ kind, items: aiMarks.filter(m => m.kind === kind) }))
    .filter(group => group.items.length);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-xs">
      {/* State */}
      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
        <div className="flex items-start justify-between">
          {reading && !summary ? (
            <p className="flex items-center text-neutral-500"><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Átvilágítom…</p>
          ) : summary ? (
            <p className="text-neutral-800">
              <span className={`inline-block w-2 h-2 mr-1.5 rounded-full align-middle ${findings.length ? 'bg-amber-500' : 'bg-green-600'}`} />
              <strong>Állapot:</strong> {findings.length ? findings.join(', ') : 'a dokumentum formázása egységes'}.
            </p>
          ) : <span />}
          <button onClick={() => read()} disabled={busy} title="Átvilágítás újra" aria-label="Átvilágítás" className="ml-2 p-1 text-neutral-500 hover:text-neutral-800 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${reading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {summary && (
          <details className="group">
            <summary className="cursor-pointer text-neutral-500 hover:text-neutral-800 select-none">Részletek</summary>
            <ul className="mt-1 space-y-0.5 text-neutral-700">
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
              {summary.allEmpty.length > 0 && <li><strong>Üres sorok:</strong> {summary.allEmpty.length}, ebből többszörös: {summary.extraEmpty.length}</li>}
              {summary.doubleSpaces > 0 && <li><strong>Dupla szóköz:</strong> {summary.doubleSpaces}</li>}
            </ul>
          </details>
        )}
        {error && <p className="text-red-700">{error}</p>}
      </div>

      {summary && profile && plan && (
        <>
          {/* The panel's own tabs */}
          <div className="flex bg-neutral-100 rounded-lg p-0.5" role="tablist" aria-label="Formázás nézetei">
            {tabs.map(t => (
              <button
                key={t.id}
                role="tab"
                aria-selected={view === t.id}
                onClick={() => setView(t.id)}
                className={`flex-1 flex items-center justify-center py-1.5 rounded-md text-[11px] font-medium transition-colors ${view === t.id ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500 hover:text-neutral-800'}`}
              >
                {t.label}
                {t.badge ? <span className="ml-1 px-1 rounded-full bg-amber-100 text-amber-800 text-[10px]">{t.badge}</span> : null}
              </button>
            ))}
          </div>

          {view === 'styles' && (
            <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
              <p className="font-semibold text-neutral-800">
                Stílus{customized && <span className="ml-1 font-normal text-neutral-500">(módosítva – a Kézi fülön elmentheted)</span>}
              </p>
              <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Stílusok">
                {presetCards.map(card => {
                  const selected = presetId === card.id;
                  const sampleFont = card.profile ? cssFont(card.profile.font) : cssFont(profile.font);
                  return (
                    <button
                      key={card.id}
                      onClick={() => choosePreset(card.id)}
                      disabled={busy}
                      aria-label={card.name}
                      aria-pressed={selected}
                      title={card.description}
                      className={`relative text-left rounded-lg border p-2 transition-colors disabled:opacity-50 ${card.featured ? 'col-span-2' : ''} ${selected ? 'border-blue-600 ring-1 ring-blue-600 bg-blue-50/60' : 'border-neutral-200 hover:border-neutral-400 bg-white'}`}
                    >
                      {card.featured && (
                        <span className="absolute top-1.5 right-1.5 flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold text-white" style={{ background: ICT_DARK }}>
                          <Star className="w-2.5 h-2.5 mr-0.5 fill-current" />Ajánlott
                        </span>
                      )}
                      {card.own && <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-neutral-200 text-neutral-700">Saját</span>}
                      <span
                        className="font-semibold text-[13px] leading-tight"
                        style={{
                          fontFamily: card.profile ? cssFont(card.profile.headingFont || card.profile.font) : sampleFont,
                          fontVariant: card.profile?.headingSmallCaps ? 'small-caps' : undefined,
                          color: card.profile?.headingColor || '#171717',
                          borderBottom: card.profile?.h1Rule ? `1.5px solid ${card.profile.h1Rule}` : undefined,
                          display: 'inline-block',
                        }}
                      >
                        {card.name}
                      </span>
                      <span className="block mt-0.5 text-[10.5px] leading-snug text-neutral-500" style={{ fontFamily: sampleFont }}>{card.description}</span>
                    </button>
                  );
                })}
                <button
                  onClick={() => { setStyleName(''); setPresetId('new'); setView('manual'); }}
                  disabled={busy}
                  className="text-left rounded-lg border border-dashed border-neutral-300 p-2 text-neutral-600 hover:border-neutral-500 hover:text-neutral-900 disabled:opacity-50"
                >
                  <span className="block font-semibold text-[13px]">+ Új stílus</span>
                  <span className="block mt-0.5 text-[10.5px] text-neutral-500">A mostaniból kiindulva, kézzel beállítva, néven mentve</span>
                </button>
              </div>
              <StylePreview profile={profile} />
              <p className="text-[10.5px] text-neutral-400">Minta, kicsinyítve. Ha a betűtípus nincs telepítve ezen a gépen, a minta hasonlóval mutatja.</p>
            </div>
          )}

          {view === 'manual' && (
            <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-3">
              <StylePreview profile={profile} />
              <div className="space-y-1.5">
                <p className="font-semibold text-neutral-600">Betűk</p>
                <label className="flex items-center justify-between space-x-2">
                  <span className="text-neutral-600">Betűtípus</span>
                  <select value={profile.font} disabled={busy} onChange={e => setProfileValue('font', e.target.value)} aria-label="Betűtípus" className="p-1 border border-neutral-300 rounded-md bg-neutral-50 max-w-[60%]">
                    {fonts.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <PointsInput label="Szöveg mérete" value={profile.bodySize} disabled={busy} onChange={n => setProfileValue('bodySize', Math.max(6, n))} />
                {footnotesKnown && <PointsInput label="Lábjegyzet mérete" value={profile.footnoteSize} disabled={busy} onChange={n => setProfileValue('footnoteSize', Math.max(6, n))} />}
                <ColorSelect label="Szöveg színe" value={profile.bodyColor} options={BODY_COLORS} disabled={busy} onChange={v => setProfileValue('bodyColor', v)} />
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-neutral-600">Címek</p>
                <label className="flex items-center justify-between space-x-2">
                  <span className="text-neutral-600">Címsorok betűtípusa</span>
                  <select value={profile.headingFont} disabled={busy} onChange={e => setProfileValue('headingFont', e.target.value)} aria-label="Címsorok betűtípusa" className="p-1 border border-neutral-300 rounded-md bg-neutral-50 max-w-[60%]">
                    <option value="">Mint a szöveg</option>
                    {fonts.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <PointsInput label={askHeadings && headingAnswer !== 'unified' ? 'Legnagyobb címsor mérete' : 'Címsor mérete'} value={profile.headingSize} disabled={busy} onChange={n => setProfileValue('headingSize', Math.max(6, n))} />
                <ColorSelect label="Címek színe" value={profile.headingColor} options={HEADING_COLORS} disabled={busy} onChange={v => setProfileValue('headingColor', v)} />
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-neutral-600">Kiskapitális címek</span>
                  <input type="checkbox" checked={profile.headingSmallCaps} disabled={busy} onChange={e => setProfileValue('headingSmallCaps', e.target.checked)} aria-label="Kiskapitális címek" />
                </label>
                <ColorSelect label="Vonal a főcím alatt" value={profile.h1Rule} options={RULE_COLORS} disabled={busy} onChange={v => setProfileValue('h1Rule', v)} />
                <ColorSelect label="Csík a 2. szint mellett" value={profile.h2Bar} options={RULE_COLORS} disabled={busy} onChange={v => setProfileValue('h2Bar', v)} />
                <PointsInput label="Címsor előtti térköz" value={profile.headingSpaceBefore} disabled={busy} onChange={n => setProfileValue('headingSpaceBefore', n)} />
                <PointsInput label="Címsor utáni térköz" value={profile.headingSpaceAfter} disabled={busy} onChange={n => setProfileValue('headingSpaceAfter', n)} />
                <p className="text-neutral-400">A vonal és a csík a Word címsorstílusán keresztül kerül fel (asztali Word kell hozzá).</p>
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold text-neutral-600">Bekezdések</p>
                <PointsInput label="Bekezdés előtti térköz" value={profile.bodySpaceBefore} disabled={busy} onChange={n => setProfileValue('bodySpaceBefore', n)} />
                <PointsInput label="Bekezdés utáni térköz" value={profile.bodySpaceAfter} disabled={busy} onChange={n => setProfileValue('bodySpaceAfter', n)} />
                <PointsInput label="Sorköz (0 = nem változtat)" value={profile.lineSpacing} disabled={busy} onChange={n => setProfileValue('lineSpacing', n)} />
                <p className="text-neutral-400">Pontban: a szöveg méretének kb. 1,2–1,3-szorosa a megszokott (11 pt-nál 13–14,5 pt).</p>
                <PointsInput label="Első sor behúzása (0 = nem változtat)" value={profile.firstLineIndent} disabled={busy} onChange={n => setProfileValue('firstLineIndent', n)} />
                <PointsInput label="Bal behúzás (0 = nem változtat)" value={profile.leftIndent} disabled={busy} onChange={n => setProfileValue('leftIndent', n)} />
                <PointsInput label="Jobb behúzás (0 = nem változtat)" value={profile.rightIndent} disabled={busy} onChange={n => setProfileValue('rightIndent', n)} />
                <label className="flex items-center justify-between space-x-2">
                  <span className="text-neutral-600">Igazítás</span>
                  <select value={profile.alignment} disabled={busy} onChange={e => setProfileValue('alignment', e.target.value as FormatProfile['alignment'])} aria-label="Igazítás" className="p-1 border border-neutral-300 rounded-md bg-neutral-50">
                    <option value="Justified">Sorkizárt</option>
                    <option value="Left">Balra zárt</option>
                  </select>
                </label>
              </div>

              {marginsKnown && (
                <div className="space-y-1.5">
                  <p className="font-semibold text-neutral-600">Oldal <span className="font-normal text-neutral-400">– margók cm-ben (0 = nem változtat)</span></p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    <CmInput label="Felső margó" value={profile.marginTop} disabled={busy} onChange={n => setProfileValue('marginTop', n)} />
                    <CmInput label="Alsó margó" value={profile.marginBottom} disabled={busy} onChange={n => setProfileValue('marginBottom', n)} />
                    <CmInput label="Bal margó" value={profile.marginLeft} disabled={busy} onChange={n => setProfileValue('marginLeft', n)} />
                    <CmInput label="Jobb margó" value={profile.marginRight} disabled={busy} onChange={n => setProfileValue('marginRight', n)} />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => takeFromSelection('body')} disabled={busy} className="flex items-center px-2 py-1 border border-neutral-300 rounded-md hover:bg-neutral-100 disabled:opacity-50" title="Kattints egy jól formázott szövegbekezdésbe, majd ide">
                  <MousePointerClick className="w-3 h-3 mr-1" />Szöveg: mint a kijelölt
                </button>
                <button onClick={() => takeFromSelection('heading')} disabled={busy} className="flex items-center px-2 py-1 border border-neutral-300 rounded-md hover:bg-neutral-100 disabled:opacity-50" title="Kattints egy jól formázott címbe, majd ide">
                  <MousePointerClick className="w-3 h-3 mr-1" />Cím: mint a kijelölt
                </button>
              </div>

              {/* Saving as an own style */}
              <div className="pt-2 border-t border-neutral-100 space-y-1.5">
                <p className="font-semibold text-neutral-600">Saját stílus</p>
                <input
                  value={styleName}
                  onChange={e => setStyleName(e.target.value)}
                  maxLength={MAX_STYLE_NAME}
                  placeholder="Név, pl. Iroda – szerződés"
                  aria-label="Saját stílus neve"
                  className="w-full p-1.5 border border-neutral-300 rounded-md bg-neutral-50"
                />
                <div className="flex flex-wrap gap-1.5">
                  {ownSelected && (
                    <button onClick={() => saveStyle(false)} disabled={busy || !styleName.trim()} className="flex items-center px-2 py-1 font-medium border border-blue-600 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50">
                      <Save className="w-3 h-3 mr-1" />Frissítés
                    </button>
                  )}
                  <button onClick={() => saveStyle(true)} disabled={busy || !styleName.trim()} className="flex items-center px-2 py-1 font-medium border border-blue-600 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50">
                    <Save className="w-3 h-3 mr-1" />{ownSelected ? 'Mentés újként' : 'Mentés saját stílusként'}
                  </button>
                  {ownSelected && (
                    <button onClick={deleteStyle} disabled={busy} className="flex items-center px-2 py-1 border border-red-400 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50">
                      <Trash2 className="w-3 h-3 mr-1" />Törlés
                    </button>
                  )}
                </div>
                <p className="text-neutral-400">A saját stílusok ezen a gépen maradnak; a Stílusok fülön „Saját” jelöléssel jelennek meg.</p>
              </div>
            </div>
          )}

          {view === 'text' && (
            <>
              <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
                <p className="font-semibold text-neutral-800">Szövegtisztítás <span className="font-normal text-neutral-500">– a szöveget is módosítja, korrektúrával</span></p>
                {(['dashes', 'markdown', 'quotes', 'nbsp', 'ranges', 'punctuation', 'doubleSpaces'] as Category[]).map(c => (
                  <label key={c} className={`flex items-center justify-between ${textCounts[c] ? 'cursor-pointer' : 'opacity-50'}`} title={CATEGORY_LABELS[c].title}>
                    <span className="flex items-center space-x-2">
                      <input type="checkbox" checked={options.categories[c]} disabled={busy || !textCounts[c]} onChange={e => setCategory(c, e.target.checked)} />
                      <span>{CATEGORY_LABELS[c].label}</span>
                    </span>
                    <span className="text-neutral-500">{textCounts[c] ? formatNumber(textCounts[c]!) : 'nincs'}</span>
                  </label>
                ))}
                <p className="text-neutral-400 pl-5">Csak írásjelek és szóközök változnak, a szavak nem. Számokhoz (6:98, 1,5), telefonszámhoz, dátumhoz, e-mail-címhez nem nyúl.</p>
              </div>

              <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5" role="radiogroup" aria-label="Üres sorok">
                <p className="font-semibold text-neutral-800">Üres sorok <span className="font-normal text-neutral-500">({summary.allEmpty.length}, ebből többszörös {summary.extraEmpty.length})</span></p>
                {([
                  ['keep', 'Maradjanak'],
                  ['repeated', CATEGORY_LABELS.emptyParagraphs.label],
                  ['all', `${CATEGORY_LABELS.allEmpty.label} – ajánlott`],
                ] as const).map(([mode, label]) => (
                  <label key={mode} className="flex items-start space-x-2 cursor-pointer">
                    <input type="radio" name="empty-lines" className="mt-0.5" checked={emptyMode === mode} disabled={busy} onChange={() => setEmptyMode(mode)} />
                    <span>{label}</span>
                  </label>
                ))}
                <p className="text-neutral-500 pl-5">
                  Modern dokumentumban nincs üres sor: a távolságot a bekezdés utáni ({pt(profile.bodySpaceAfter)}) és a címsor előtti ({pt(profile.headingSpaceBefore)}) térköz adja.
                  Megmarad: a táblázat melletti, az aláírásvonal fölötti, az oldaltörést tartalmazó és a képet tartalmazó sor.
                </p>
                {emptyMode === 'all' && !options.categories.spacing && <p className="text-amber-700 pl-5">A Térközök kategória ki van kapcsolva: üres sorok nélkül a szöveg összecsúszhat.</p>}
              </div>

              <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
                <p className="font-semibold text-neutral-800">AI-nyomok <span className="font-normal text-neutral-500">– csak jelzés, a szöveget nem írom át</span></p>
                {marksByKind.length === 0 ? (
                  <p className="text-green-700">Nem találtam AI-ra utaló nyomot.</p>
                ) : marksByKind.map(group => (
                  <details key={group.kind} className="border-t border-neutral-100 pt-1">
                    <summary className="cursor-pointer select-none" title={AI_MARK_LABELS[group.kind].hint}>
                      <span className="font-medium">{AI_MARK_LABELS[group.kind].label}</span> <span className="text-neutral-500">({group.items.length})</span>
                    </summary>
                    <p className="text-neutral-500 mt-0.5">{AI_MARK_LABELS[group.kind].hint}</p>
                    <ul className="mt-1 space-y-0.5">
                      {group.items.slice(0, 30).map((mark, i) => (
                        <li key={i} className="flex items-center justify-between space-x-2">
                          <span className="truncate text-neutral-800">„{mark.found}”</span>
                          <button onClick={() => jump(mark.paragraph)} className="shrink-0 text-[11px] font-medium text-blue-700 hover:text-blue-900">Ugrás →</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </>
          )}

          {view === 'scope' && (
            <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
              <p className="font-semibold text-neutral-800">Mit egységesítsek?</p>
              {FORMAT_CATEGORIES.filter(c => (c !== 'footnotes' || footnotesKnown) && (c !== 'margins' || marginsKnown)).map(c => (
                <label key={c} className="flex items-center justify-between cursor-pointer" title={CATEGORY_LABELS[c].title}>
                  <span className="flex items-center space-x-2">
                    <input type="checkbox" checked={options.categories[c]} disabled={busy} onChange={e => setCategory(c, e.target.checked)} />
                    <span>{CATEGORY_LABELS[c].label}</span>
                  </span>
                  <span className="text-neutral-500">{options.categories[c] ? (plan.counts[c] ? `${formatNumber(plan.counts[c])} helyen` : 'rendben') : 'kihagyva'}</span>
                </label>
              ))}
            </div>
          )}

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

          {/* The one big action, the same on every tab */}
          <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
            <p className="text-neutral-700">
              {total
                ? <>Ez történik: <strong>{formatNumber(plan.changes.length)} bekezdés</strong> formázása
                  {plan.styleUpdates.length ? `, ${plan.styleUpdates.length} Word-stílus frissítése` : ''}
                  {plan.footnotes ? ', a lábjegyzetek' : ''}
                  {plan.textFixes.length ? `, szövegtisztítás ${plan.textFixes.length} bekezdésben` : ''}
                  {plan.deleteEmpty.length ? `, ${plan.deleteEmpty.length} üres sor törlése` : ''}
                  {plan.doubleSpaces ? `, ${summary.doubleSpaces} dupla szóköz cseréje` : ''}.</>
                : 'A kiválasztottak szerint a dokumentum már egységes, nincs mit változtatni.'}
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
                className="w-full flex items-center justify-center py-2.5 text-sm font-semibold text-white rounded-lg disabled:opacity-40"
                style={{ background: ICT_DARK }}
              >
                {applying ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Paintbrush className="w-4 h-4 mr-1.5" />}
                Egységesítés
              </button>
            )}
            <p className="flex items-start text-neutral-500">
              <ShieldCheck className="w-3.5 h-3.5 mr-1 mt-px shrink-0 text-green-700" />
              Előtte elmentem a dokumentum mostani állapotát, és lent bármikor megnyithatod. A kiemelések, a számozás és a címsorszintek megmaradnak; a formázás korrektúra nélkül kerül be.
            </p>
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
