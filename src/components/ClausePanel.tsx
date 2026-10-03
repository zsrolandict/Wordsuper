import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Search, Wand2, FileInput } from 'lucide-react';
import { fetchClauses, type ClauseItem, type ClauseLibrary } from '../services/aiService';
import { MAX_INSTRUCTION_CHARS } from '../shared/aiConfig';

/** What the AI gets around the clause when it fits it to the contract; the clause must fit into one instruction */
export const fitInstruction = (clause: ClauseItem) =>
  `Illeszd be ezt a mintazáradékot a szerződésbe a kurzor helyére: igazítsd a szerződés definiált fogalmaihoz, feleinek megnevezéséhez, számozásához és stílusához, a tartalmán ne változtass.\n\nMINTAZÁRADÉK („${clause.title}”):\n${clause.text}`;
const fits = (clause: ClauseItem) => fitInstruction(clause).length <= MAX_INSTRUCTION_CHARS;

/**
 * The firm's model clauses: search, read, put one at the cursor as it is (tracked), or have the AI fit it to the
 * contract (the usual preview first).
 */
export default function ClausePanel({ accessKey, busy, onClose, onInsert, onFit }: {
  accessKey: string;
  busy: boolean;
  onClose: () => void;
  onInsert: (clause: ClauseItem) => Promise<string>;
  onFit: (clause: ClauseItem) => void;
}) {
  const [library, setLibrary] = useState<ClauseLibrary | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchClauses(accessKey).then(result => { if (!cancelled) setLibrary(result); });
    return () => { cancelled = true; };
  }, [accessKey]);

  const shown = useMemo(() => {
    const words = query.toLocaleLowerCase('hu').split(/\s+/).filter(Boolean);
    return (library?.clauses ?? []).filter(c => words.every(w => `${c.category} ${c.title} ${c.text}`.toLocaleLowerCase('hu').includes(w)));
  }, [library, query]);
  const categories = [...new Set(shown.map(c => c.category))];

  const insert = async (clause: ClauseItem) => {
    setWorking(true);
    setStatus('');
    try {
      setStatus(await onInsert(clause));
    } catch {
      setStatus('Nem sikerült beszúrni. Esetleg írásvédett a dokumentum.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="h-screen bg-neutral-50 flex flex-col font-sans text-neutral-900">
      <div className="bg-white border-b-2 border-[#29abe2] px-4 py-3 text-[#0f2350] shrink-0 shadow-sm flex items-center">
        <button onClick={onClose} className="mr-2 p-1 rounded-lg hover:bg-neutral-100" aria-label="Vissza"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-lg font-bold">Záradéktár</h1>
      </div>
      <div className="p-3 border-b border-neutral-200 bg-white space-y-1.5">
        <label className="relative block">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Keresés (pl. vis maior, titoktartás)" aria-label="Keresés a záradékok között" className="w-full pl-8 p-2 border border-neutral-300 rounded-lg text-sm bg-neutral-50" />
        </label>
        <p className="text-[11px] text-neutral-500">
          {library?.source === 'sharepoint' ? 'Az iroda SharePoint-mappájából; csak az látszik, amihez jogod van.' : library?.source === 'folder' ? 'Az iroda záradéktár-mappájából.' : ''}
          {' '}A „Beszúrás” szó szerint teszi a kurzorhoz, korrektúrával; az „Illesztés” előbb az AI-val a szerződés fogalmaihoz igazíttatja, előnézettel.
        </p>
        {status && <p className="text-xs text-green-800">{status}</p>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {library === undefined && <p className="flex items-center text-xs text-neutral-500"><Loader2 className="w-4 h-4 mr-1 animate-spin" />Betöltöm a záradékokat…</p>}
        {library === null && <p className="text-xs text-red-700">Nem érem el a szervert. Próbáld újra később.</p>}
        {library?.problem && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{library.problem}</p>}
        {library && library.source === 'none' && (
          <p className="text-xs text-neutral-600">Még nincs beállítva záradéktár. Az üzemeltető egy mappát (CLAUSES_DIR, pl. a OneDrive-val szinkronizált SharePoint-mappát) vagy egy SharePoint-mappa címét (CLAUSES_SHAREPOINT_URL) adhatja meg; ott minden .docx egy záradék, a fájlneve a címe, az almappa a kategóriája.</p>
        )}
        {library && library.source !== 'none' && !library.problem && shown.length === 0 && <p className="text-xs text-neutral-500">{query ? 'Nincs találat.' : 'A záradéktár üres.'}</p>}
        {categories.map(category => (
          <section key={category || '-'} className="space-y-1.5">
            {category && <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">{category}</h2>}
            {shown.filter(c => c.category === category).map(clause => (
              <div key={clause.id} className="bg-white border border-neutral-200 rounded-xl p-2.5 space-y-1">
                <button onClick={() => setOpen(open === clause.id ? null : clause.id)} className="w-full text-left text-sm font-medium text-neutral-900">{clause.title}</button>
                <p className={`text-xs text-neutral-600 whitespace-pre-wrap ${open === clause.id ? '' : 'line-clamp-3'}`}>{clause.text}</p>
                <div className="flex gap-3 pt-0.5">
                  <button onClick={() => insert(clause)} disabled={busy || working} className="flex items-center text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-40">
                    <FileInput className="w-3.5 h-3.5 mr-1" />Beszúrás a kurzorhoz
                  </button>
                  <button
                    onClick={() => onFit(clause)}
                    disabled={busy || working || !fits(clause)}
                    title={fits(clause) ? 'Az AI a szerződés fogalmaihoz és számozásához igazítja; beszúrás előtt megmutatja' : 'Ez a záradék túl hosszú az AI-os illesztéshez; szúrd be, és utána a Szerkesztés móddal igazítsd'}
                    className="flex items-center text-xs font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-40"
                  >
                    <Wand2 className="w-3.5 h-3.5 mr-1" />Illesztés a szerződéshez
                  </button>
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
