import React, { useState } from 'react';
import { UserRound, Loader2 } from 'lucide-react';
import { MAX_PARTY_CHARS } from '../shared/aiConfig';
import { cleanParty, partySuggestions } from '../services/parties';
import { buildDocumentGraph } from '../services/structure';
import { readParagraphs } from '../services/wordDocument';

/**
 * Which side we are on in this document ("Vevő"). Every request tells the AI, so a review weighs the risks for
 * that party and an edit protects its interests. Empty: neutral.
 */
export default function PartyBar({ party, onChange }: { party: string; onChange: (party: string) => void }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [custom, setCustom] = useState('');

  const openEditor = async () => {
    setOpen(true);
    setCustom(party);
    setSuggestions(null);
    try {
      const paragraphs = await readParagraphs();
      setSuggestions(partySuggestions(buildDocumentGraph(paragraphs), paragraphs.map(p => p.text)));
    } catch {
      setSuggestions([]);
    }
  };
  const choose = (value: string) => {
    onChange(cleanParty(value));
    setOpen(false);
  };

  if (!open) {
    return (
      <div className="flex items-center justify-between bg-white border-b border-neutral-200 px-3 py-1 text-[11px] text-neutral-600 shrink-0">
        <span className="flex items-center min-w-0">
          <UserRound className="w-3.5 h-3.5 mr-1 shrink-0 text-[#29abe2]" />
          <span className="mr-1 shrink-0">Képviselt fél:</span>
          {party ? <strong className="text-neutral-900 truncate">{party}</strong> : <span className="text-neutral-400 truncate">nincs megadva (semleges)</span>}
        </span>
        <button onClick={openEditor} className="ml-2 shrink-0 font-medium text-blue-700 hover:text-blue-900">{party ? 'Módosítás' : 'Megadom'}</button>
      </div>
    );
  }

  return (
    <div className="bg-white border-b border-neutral-200 px-3 py-2 text-xs space-y-1.5 shrink-0">
      <p className="font-medium text-neutral-800 flex items-center"><UserRound className="w-3.5 h-3.5 mr-1 text-[#29abe2]" />Kit képviselünk ebben a dokumentumban?</p>
      <div className="flex flex-wrap gap-1.5">
        {suggestions === null && <span className="flex items-center text-neutral-400"><Loader2 className="w-3 h-3 mr-1 animate-spin" />A dokumentum feleit keresem…</span>}
        {suggestions?.map(s => (
          <button
            key={s}
            onClick={() => choose(s)}
            className={`px-2.5 py-1 rounded-full border ${s === party ? 'bg-blue-600 border-blue-600 text-white' : 'border-blue-200 text-blue-900 hover:bg-blue-50'}`}
          >
            {s}
          </button>
        ))}
        {suggestions?.length === 0 && <span className="text-neutral-400">Nem találtam feleket a dokumentumban, írd be lent.</span>}
      </div>
      <div className="flex space-x-1.5">
        <input
          value={custom}
          onChange={e => setCustom(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && custom.trim()) choose(custom); }}
          maxLength={MAX_PARTY_CHARS}
          placeholder="Pl. Vevő, vagy Vevő és Zálogkötelezett"
          aria-label="Képviselt fél"
          className="flex-1 min-w-0 p-1.5 border border-neutral-300 rounded-lg bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={() => choose(custom)} disabled={!custom.trim()} className="px-2.5 font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg">Mentés</button>
      </div>
      <div className="flex items-center justify-between">
        <span className="space-x-3">
          <button onClick={() => choose('')} className="underline text-neutral-600">Semleges (nincs fél)</button>
          <button onClick={() => setOpen(false)} className="text-neutral-500">Mégse</button>
        </span>
      </div>
      <p className="text-[10px] text-neutral-400">Az AI ennek a félnek a szemszögéből vizsgál, szerkeszt és értékel. Csak ezen a gépen jegyzem meg ehhez a dokumentumhoz, a fájlba nem írom bele.</p>
    </div>
  );
}
