import React, { useEffect, useState } from 'react';
import { BookOpenText, FileSignature, Loader2, PanelTop, RefreshCw } from 'lucide-react';
import { footerXml, guessParties, headerXml, hungarianDate, ooxmlPackage, signatureBlockXml, tableOfContentsXml } from '../services/documentElements';
import { addToFooters, applyHeaderFooter, insertPackageAtCursor, readHeaderFooter, updateTablesOfContents } from '../services/wordDocument';
import type { FormatProfile } from '../services/formatting';

const FIRM = 'ICT Europa Legal';
const A4_WIDTH_PT = 595.3;

const field = 'w-full p-1.5 border border-neutral-300 rounded-md bg-neutral-50';

/**
 * Formázás → Elemek: élőfej és élőláb az iroda arculatával, aláírási blokk és tartalomjegyzék a kurzorhoz.
 */
export default function FormatElements({ profile, terms, documentName, margins, busy, takeSnapshot, onChanged }: {
  profile: FormatProfile;
  /** Defined terms of the document, to guess the parties of the signature block */
  terms: string[];
  documentName: string;
  /** Left and right page margins in points (first section); null when unknown */
  margins: { left: number; right: number } | null;
  busy: boolean;
  /** Saves the document as it is now (the "previous state"); false when that failed and the user did not go on */
  takeSnapshot: () => Promise<boolean>;
  onChanged: () => void;
}) {
  const font = profile.headingFont || profile.font;
  const accent = profile.headingColor || '#0B3B60';
  const [working, setWorking] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Header and footer
  const [header, setHeader] = useState(true);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [confidential, setConfidential] = useState(true);
  const [documentId, setDocumentId] = useState(documentName);
  const [version, setVersion] = useState('');
  const [withDate, setWithDate] = useState(true);
  const [existing, setExisting] = useState<{ header: string; footer: string } | null>(null);
  const [replaceOk, setReplaceOk] = useState(false);

  // Signature block
  const [left, right] = guessParties(terms);
  const [place, setPlace] = useState('Budapest');
  const [today, setToday] = useState(false);
  const [leftRole, setLeftRole] = useState(left);
  const [rightRole, setRightRole] = useState(right);
  const [leftName, setLeftName] = useState('');
  const [rightName, setRightName] = useState('');
  const [representative, setRepresentative] = useState(false);
  // The header/footer setting puts the signature row into the new footer too (it replaces the footer)
  const [footerSignature, setFooterSignature] = useState(false);

  useEffect(() => {
    readHeaderFooter().then(setExisting).catch(() => setExisting(null));
  }, []);
  useEffect(() => {
    setLeftRole(left);
    setRightRole(right);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms.join('|')]);

  const hasExisting = !!existing && (existing.header || existing.footer);
  const width = margins ? Math.round((A4_WIDTH_PT - margins.left - margins.right) * 20) : 9072;
  const date = hungarianDate(new Date());

  const run = async (label: string, action: () => Promise<string>) => {
    setWorking(label);
    setStatus(null);
    setError(null);
    try {
      setStatus(await action());
      onChanged();
    } catch (e) {
      console.error(e);
      setError('Nem sikerült. Esetleg írásvédett a dokumentum, vagy ez a Word nem engedi innen.');
    } finally {
      setWorking(null);
    }
  };

  const setHeaderFooter = () => run('hf', async () => {
    if (!(await takeSnapshot())) return 'Megszakítva: az előző állapotot nem sikerült elmenteni.';
    const o = { width, font, accent, header, firm: FIRM, title: documentName, pageNumbers, confidential, documentId, version, date: withDate ? date : '' };
    const footer = (footerSignature ? signatureXml(true) : '') + footerXml(o);
    const sections = await applyHeaderFooter(header ? ooxmlPackage(headerXml(o)) : null, ooxmlPackage(footer));
    setExisting(await readHeaderFooter().catch(() => null));
    setReplaceOk(false);
    return `✅ Élőfej és élőláb beállítva (${sections} szakasz)${footerSignature ? ', az élőlábban aláírási sorral' : ''}. Az oldalszám Word-mező, magától frissül.`;
  });

  const signatureXml = (compact: boolean) => signatureBlockXml({ place, date: today ? date : '', left: { role: leftRole, name: leftName }, right: { role: rightRole, name: rightName }, representative, font: profile.font, compact });

  // Into the existing footer, above what is there: every page gets the signature row (e.g. to initial each page)
  const signatureToFooter = () => run('sigf', async () => {
    if (!(await takeSnapshot())) return 'Megszakítva: az előző állapotot nem sikerült elmenteni.';
    const sections = await addToFooters(ooxmlPackage(signatureXml(true)));
    setExisting(await readHeaderFooter().catch(() => null));
    return `✅ Aláírási sor az élőlábba került (${sections} szakasz), minden oldal alján megjelenik. Korrektúra nélkül, mint az élőláb; a meglévő élőláb megmaradt alatta.`;
  });

  const insertSignature = () => run('sig', async () => {
    const xml = signatureXml(false);
    const write = await insertPackageAtCursor(ooxmlPackage(xml));
    return `✅ Aláírási blokk beszúrva a kurzorhoz ${write.tracked ? 'korrektúrával' : 'korrektúra nélkül'}.`;
  });

  const insertToc = () => run('toc', async () => {
    const write = await insertPackageAtCursor(ooxmlPackage(tableOfContentsXml(font, accent)));
    const updated = await updateTablesOfContents().catch(() => 0);
    return `✅ Tartalomjegyzék beszúrva ${write.tracked ? 'korrektúrával' : 'korrektúra nélkül'}.${updated ? ' Frissítettem.' : ' Frissítéshez: jobb gomb rajta → Mező frissítése.'}`;
  });

  const refreshToc = () => run('tocu', async () => {
    const updated = await updateTablesOfContents();
    return updated ? `✅ ${updated} tartalomjegyzéket frissítettem.` : 'Nem találtam frissíthető tartalomjegyzéket (vagy ez a Word nem engedi; ott: jobb gomb → Mező frissítése).';
  });

  const disabled = busy || !!working;
  const spinner = (label: string) => (working === label ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : null);

  return (
    <div className="space-y-3">
      {/* Header and footer */}
      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
        <p className="flex items-center font-semibold text-neutral-800"><PanelTop className="w-3.5 h-3.5 mr-1" />Élőfej és élőláb</p>
        <label className="flex items-center space-x-2"><input type="checkbox" checked={header} onChange={e => setHeader(e.target.checked)} disabled={disabled} /><span>Élőfej: „{FIRM}” és a dokumentum címe, vékony vonallal</span></label>
        <label className="flex items-center space-x-2"><input type="checkbox" checked={pageNumbers} onChange={e => setPageNumbers(e.target.checked)} disabled={disabled} /><span>Oldalszám: „Oldal 3 / 12”</span></label>
        <label className="flex items-center space-x-2"><input type="checkbox" checked={confidential} onChange={e => setConfidential(e.target.checked)} disabled={disabled} /><span>„BIZALMAS” felirat</span></label>
        <label className="flex items-center space-x-2"><input type="checkbox" checked={withDate} onChange={e => setWithDate(e.target.checked)} disabled={disabled} /><span>Dátum ({date})</span></label>
        <label className="flex items-center space-x-2"><input type="checkbox" checked={footerSignature} onChange={e => setFooterSignature(e.target.checked)} disabled={disabled || !leftRole.trim() || !rightRole.trim()} /><span>Aláírási sor is az élőlábba ({leftRole || '…'} / {rightRole || '…'}, lent beállítható)</span></label>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="space-y-0.5"><span className="text-neutral-500">Dokumentumazonosító</span><input value={documentId} onChange={e => setDocumentId(e.target.value)} maxLength={60} aria-label="Dokumentumazonosító" className={field} disabled={disabled} /></label>
          <label className="space-y-0.5"><span className="text-neutral-500">Verzió</span><input value={version} onChange={e => setVersion(e.target.value)} maxLength={20} placeholder="pl. v3, tervezet" aria-label="Verzió" className={field} disabled={disabled} /></label>
        </div>
        <p className="text-neutral-500">Lábléc: {[confidential ? 'BIZALMAS' : '', documentId, version, withDate ? date : ''].filter(Boolean).join(' · ') || '–'}{pageNumbers ? ' … Oldal 1 / 12' : ''}</p>
        {hasExisting && (
          <label className="flex items-start space-x-2 text-amber-800">
            <input type="checkbox" className="mt-0.5" checked={replaceOk} onChange={e => setReplaceOk(e.target.checked)} disabled={disabled} />
            <span>A meglévő élőfej/élőláb lecserélődik{existing!.header ? ` (élőfej: „${existing!.header.slice(0, 40)}”)` : ''}{existing!.footer ? ` (élőláb: „${existing!.footer.slice(0, 40)}”)` : ''}. Rendben.</span>
          </label>
        )}
        <button onClick={setHeaderFooter} disabled={disabled || (!!hasExisting && !replaceOk)} className="w-full flex items-center justify-center py-1.5 font-medium text-white rounded-lg disabled:opacity-40" style={{ background: accent }}>
          {spinner('hf')}Élőfej és élőláb beállítása
        </button>
        <p className="text-neutral-400">Minden szakaszba kerül, korrektúra nélkül (az oldal kerete, nem a szerződés szövege); előtte elmentem a dokumentumot.</p>
      </div>

      {/* Signature block */}
      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
        <p className="flex items-center font-semibold text-neutral-800"><FileSignature className="w-3.5 h-3.5 mr-1" />Aláírási blokk</p>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="space-y-0.5"><span className="text-neutral-500">Hely</span><input value={place} onChange={e => setPlace(e.target.value)} maxLength={40} aria-label="Hely" className={field} disabled={disabled} /></label>
          <label className="flex items-end space-x-1.5 pb-1.5"><input type="checkbox" checked={today} onChange={e => setToday(e.target.checked)} disabled={disabled} /><span>Mai dátum (különben kipontozva)</span></label>
          <label className="space-y-0.5"><span className="text-neutral-500">Bal oldali fél</span><input value={leftRole} onChange={e => setLeftRole(e.target.value)} maxLength={40} aria-label="Bal oldali fél" className={field} disabled={disabled} /></label>
          <label className="space-y-0.5"><span className="text-neutral-500">Jobb oldali fél</span><input value={rightRole} onChange={e => setRightRole(e.target.value)} maxLength={40} aria-label="Jobb oldali fél" className={field} disabled={disabled} /></label>
          <label className="space-y-0.5"><span className="text-neutral-500">Neve (üres: kipontozva)</span><input value={leftName} onChange={e => setLeftName(e.target.value)} maxLength={80} aria-label="Bal oldali fél neve" className={field} disabled={disabled} /></label>
          <label className="space-y-0.5"><span className="text-neutral-500">Neve (üres: kipontozva)</span><input value={rightName} onChange={e => setRightName(e.target.value)} maxLength={80} aria-label="Jobb oldali fél neve" className={field} disabled={disabled} /></label>
        </div>
        <label className="flex items-center space-x-2"><input type="checkbox" checked={representative} onChange={e => setRepresentative(e.target.checked)} disabled={disabled} /><span>„képviseli: …” sor (cég esetén)</span></label>
        <div className="flex space-x-2">
          <button onClick={insertSignature} disabled={disabled || !leftRole.trim() || !rightRole.trim()} className="flex-1 flex items-center justify-center py-1.5 font-medium border border-blue-600 text-blue-700 hover:bg-blue-50 rounded-lg disabled:opacity-40">
            {spinner('sig')}Beszúrás a kurzorhoz
          </button>
          <button onClick={signatureToFooter} disabled={disabled || !leftRole.trim() || !rightRole.trim()} className="flex-1 flex items-center justify-center py-1.5 font-medium border border-blue-600 text-blue-700 hover:bg-blue-50 rounded-lg disabled:opacity-40">
            {spinner('sigf')}Az élőlábba (minden oldal)
          </button>
        </div>
        <p className="text-neutral-400">Két oszlop keret nélkül. A kurzorhoz aláírásnyi hellyel, a szokásos korrektúraszabály szerint. Az élőlábba kisebb, hely és dátum nélkül, minden oldal aljára (pl. oldalankénti kézjegyhez), korrektúra nélkül; a meglévő élőláb megmarad alatta.</p>
      </div>

      {/* Table of contents */}
      <div className="bg-white border border-neutral-200 rounded-xl p-3 space-y-1.5">
        <p className="flex items-center font-semibold text-neutral-800"><BookOpenText className="w-3.5 h-3.5 mr-1" />Tartalomjegyzék</p>
        <p className="text-neutral-500">A Címsor stílusú címekből és az „ICT Fejezetcím” stílusú fejezetcímekből készül (ezt a Formázás adja a stílus nélküli címeknek).</p>
        <div className="flex space-x-2">
          <button onClick={insertToc} disabled={disabled} className="flex-1 flex items-center justify-center py-1.5 font-medium border border-blue-600 text-blue-700 hover:bg-blue-50 rounded-lg disabled:opacity-40">
            {spinner('toc')}Beszúrás a kurzorhoz
          </button>
          <button onClick={refreshToc} disabled={disabled} className="flex-1 flex items-center justify-center py-1.5 font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-100 rounded-lg disabled:opacity-40">
            {spinner('tocu') ?? <RefreshCw className="w-3.5 h-3.5 mr-1" />}Frissítés
          </button>
        </div>
      </div>

      {status && <p className="font-medium text-green-700">{status}</p>}
      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}
