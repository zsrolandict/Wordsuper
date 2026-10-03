import { useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Download, FileUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { downloadFile } from '../services/download';
import { emptyRule, loadOwnPlaybooks, newPlaybookId, SAMPLE_PLAYBOOKS, saveOwnPlaybooks } from '../services/playbook';
import { MAX_PLAYBOOK_NAME, MAX_PLAYBOOK_RULES, playbooksFile, readPlaybooksFile, sanitizePlaybook, type Playbook, type PlaybookRule } from '../shared/playbook';
import { usePlaybooks } from './PlaybookBar';

const input = 'w-full p-1.5 border border-neutral-300 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400';

const RULE_FIELDS: { key: keyof Omit<PlaybookRule, 'id' | 'topic'>; label: string; hint: string; rows: number }[] = [
  { key: 'standard', label: 'Standard (kötelező)', hint: 'Amit az iroda elvár.', rows: 2 },
  { key: 'fallback1', label: 'Fallback 1', hint: 'Az első elfogadható kompromisszum.', rows: 2 },
  { key: 'fallback2', label: 'Fallback 2', hint: 'Az utolsó elfogadható kompromisszum.', rows: 2 },
  { key: 'walkAway', label: 'Elfogadhatatlan (walk-away)', hint: 'Amit semmiképp nem fogadunk el.', rows: 2 },
  { key: 'clause', label: 'Mintaszöveg', hint: 'A záradék szövege standard pozícióban; ezt javasolja, ha hiányzik vagy rosszabb.', rows: 3 },
];

/** Managing the playbooks: the firm's (read-only), the own ones (edit, delete), a sample, import and export */
export default function PlaybookPanel({ accessKey, onClose }: { accessKey: string; onClose: () => void }) {
  const [version, setVersion] = useState(0);
  const { office, own } = usePlaybooks(accessKey, version);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [message, setMessage] = useState('');
  const [showSamples, setShowSamples] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const store = (playbooks: Playbook[], note: string) => {
    saveOwnPlaybooks(playbooks);
    setVersion(v => v + 1);
    setMessage(note);
  };
  const addCopy = (playbook: Playbook, name = playbook.name) =>
    store([...loadOwnPlaybooks(), { ...structuredClone(playbook), id: newPlaybookId(), name }], `„${name}” a saját playbookok közé került.`);

  const importFile = async (file: File) => {
    try {
      const { playbooks, skipped } = readPlaybooksFile(JSON.parse(await file.text()), 'import');
      if (!playbooks.length) {
        setMessage('A fájlban nem találtam használható playbookot.');
        return;
      }
      store([...loadOwnPlaybooks(), ...playbooks.map(p => ({ ...p, id: newPlaybookId() }))],
        `${playbooks.length} playbook beolvasva${skipped ? `, ${skipped} hibás kimaradt` : ''}.`);
    } catch {
      setMessage('Ez nem playbook-fájl (.json).');
    }
  };

  if (editing) {
    return (
      <PlaybookEditor
        initial={editing}
        onCancel={() => setEditing(null)}
        onSave={playbook => {
          const list = loadOwnPlaybooks();
          const exists = list.some(p => p.id === playbook.id);
          store(exists ? list.map(p => (p.id === playbook.id ? playbook : p)) : [...list, playbook], `„${playbook.name}” elmentve.`);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="h-screen bg-neutral-50 flex flex-col font-sans text-neutral-900">
      <div className="bg-navy border-b-2 border-brass px-4 py-3 text-white shrink-0 shadow-sm flex items-center">
        <button onClick={onClose} className="mr-2 p-1 rounded-lg hover:bg-white/10" aria-label="Vissza"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-lg font-bold">Playbookok</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        <p className="text-xs text-neutral-600">
          A playbook záradéktípusonként rögzíti az iroda álláspontját: standard pozíció, két elfogadható kompromisszum és ami elfogadhatatlan.
          Az Átvizsgálás módban a szerződés ehhez mérhető; a javasolt módosítások egyenként, korrektúrával kerülnek be.
        </p>
        {message && <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1">{message}</p>}

        {office.length > 0 && (
          <section className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
            <h2 className="text-sm font-semibold">Irodai playbookok</h2>
            <p className="text-[11px] text-neutral-500">Az üzemeltető tette a szerverre; itt nem szerkeszthetők, de lemásolhatók sajátként.</p>
            {office.map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs">
                <span><span className="font-medium">{p.name}</span> <span className="text-neutral-500">· {p.rules.length} pont</span></span>
                <button onClick={() => addCopy(p, `${p.name} (másolat)`.slice(0, MAX_PLAYBOOK_NAME))} className="flex items-center text-indigo-700 hover:underline"><Copy className="w-3.5 h-3.5 mr-1" />Másolat sajátként</button>
              </div>
            ))}
          </section>
        )}

        <section className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
          <h2 className="text-sm font-semibold">Saját playbookok</h2>
          <p className="text-[11px] text-neutral-500">Ezen a gépen tárolódnak. Exportálva a kollégák beolvashatják, vagy az üzemeltető irodai playbookká teheti (PLAYBOOKS_FILE).</p>
          {own.length === 0 && <p className="text-xs text-neutral-500">Még nincs saját playbook.</p>}
          {own.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate"><span className="font-medium">{p.name}</span> <span className="text-neutral-500">· {p.rules.length} pont</span></span>
              <span className="flex shrink-0 gap-2">
                <button onClick={() => setEditing(structuredClone(p))} className="flex items-center text-indigo-700 hover:underline" aria-label={`${p.name} szerkesztése`}><Pencil className="w-3.5 h-3.5 mr-0.5" />Szerkesztés</button>
                <button
                  onClick={() => { if (window.confirm(`Törlöd: „${p.name}”?`)) store(loadOwnPlaybooks().filter(x => x.id !== p.id), `„${p.name}” törölve.`); }}
                  className="flex items-center text-red-700 hover:underline"
                  aria-label={`${p.name} törlése`}
                ><Trash2 className="w-3.5 h-3.5" /></button>
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => setEditing({ id: newPlaybookId(), name: '', contractType: '', side: '', rules: [emptyRule([])] })}
              className="flex items-center px-2.5 py-1.5 text-xs font-medium bg-indigo-700 text-white rounded-lg hover:bg-indigo-800"
            ><Plus className="w-3.5 h-3.5 mr-1" />Új playbook</button>
            <button onClick={() => setShowSamples(v => !v)} aria-expanded={showSamples} className="px-2.5 py-1.5 text-xs border border-neutral-300 rounded-lg hover:bg-neutral-100">Minta betöltése…</button>
            <button onClick={() => fileRef.current?.click()} className="flex items-center px-2.5 py-1.5 text-xs border border-neutral-300 rounded-lg hover:bg-neutral-100"><FileUp className="w-3.5 h-3.5 mr-1" />Importálás…</button>
            <button
              onClick={() => downloadFile(JSON.stringify(playbooksFile(own), null, 2), 'playbookok.json', 'application/json')}
              disabled={!own.length}
              className="flex items-center px-2.5 py-1.5 text-xs border border-neutral-300 rounded-lg hover:bg-neutral-100 disabled:opacity-40"
            ><Download className="w-3.5 h-3.5 mr-1" />Exportálás (.json)</button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Playbook-fájl"
              onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) importFile(file); }}
            />
          </div>
          {showSamples && (
            <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-2 space-y-1">
              <p className="text-[11px] text-neutral-600">Melyiket töltsem be a sajátok közé? Utána szerkeszthető.</p>
              {SAMPLE_PLAYBOOKS.map(sample => (
                <button
                  key={sample.id}
                  onClick={() => { addCopy(sample); setShowSamples(false); }}
                  className="w-full text-left text-xs px-2 py-1 rounded hover:bg-white"
                >
                  <span className="font-medium">{sample.name.replace(/^MINTA – /, '')}</span> <span className="text-neutral-500">· {sample.rules.length} pont</span>
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-neutral-500">A minták kiindulópontok: a pozíciókat és az összegeket az iroda jogászainak kell az iroda gyakorlatához igazítaniuk.</p>
        </section>
      </div>
    </div>
  );
}

function PlaybookEditor({ initial, onSave, onCancel }: { initial: Playbook; onSave: (playbook: Playbook) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Playbook>(initial);
  const [error, setError] = useState('');
  const setRule = (index: number, changes: Partial<PlaybookRule>) =>
    setDraft(d => ({ ...d, rules: d.rules.map((r, i) => (i === index ? { ...r, ...changes } : r)) }));
  const move = (index: number, by: number) => setDraft(d => {
    const rules = [...d.rules];
    const [rule] = rules.splice(index, 1);
    rules.splice(index + by, 0, rule);
    return { ...d, rules };
  });

  const save = () => {
    if (!draft.name.trim()) return setError('Adj nevet a playbooknak.');
    // A completely empty rule is simply left out; a started one needs its topic and standard
    const rules = draft.rules.filter(r => Object.entries(r).some(([k, v]) => k !== 'id' && String(v).trim()));
    const incomplete = rules.findIndex(r => !r.topic.trim() || !r.standard.trim());
    if (incomplete >= 0) return setError(`A(z) ${incomplete + 1}. pontnál a téma és a standard is kell.`);
    const playbook = sanitizePlaybook({ ...draft, rules }, draft.id);
    if (!playbook) return setError('Legalább egy pont kell (téma és standard).');
    onSave({ ...playbook, id: draft.id });
  };

  return (
    <div className="h-screen bg-neutral-50 flex flex-col font-sans text-neutral-900">
      <div className="bg-navy border-b-2 border-brass px-4 py-3 text-white shrink-0 shadow-sm flex items-center">
        <button onClick={onCancel} className="mr-2 p-1 rounded-lg hover:bg-neutral-100" aria-label="Mégse"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-lg font-bold">Playbook szerkesztése</h1>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        <section className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
          <label className="block font-medium">Név
            <input value={draft.name} maxLength={MAX_PLAYBOOK_NAME} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="Pl. Ingatlan-adásvétel, vevői oldal" className={`${input} mt-1 font-normal`} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block font-medium">Szerződéstípus
              <input value={draft.contractType} onChange={e => setDraft(d => ({ ...d, contractType: e.target.value }))} placeholder="Pl. NDA" className={`${input} mt-1 font-normal`} />
            </label>
            <label className="block font-medium">Kinek az oldaláról
              <input value={draft.side} onChange={e => setDraft(d => ({ ...d, side: e.target.value }))} placeholder="Pl. Vevő (üres: a képviselt fél)" className={`${input} mt-1 font-normal`} />
            </label>
          </div>
        </section>

        {draft.rules.map((rule, index) => (
          <section key={rule.id} className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2" aria-label={`${index + 1}. pont`}>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-neutral-500">{index + 1}.</span>
              <input value={rule.topic} onChange={e => setRule(index, { topic: e.target.value })} placeholder="Téma, pl. Felelősségkorlátozás" aria-label="Téma" className={`${input} font-medium`} />
              <button onClick={() => move(index, -1)} disabled={index === 0} aria-label="Feljebb" className="p-1 text-neutral-500 disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
              <button onClick={() => move(index, 1)} disabled={index === draft.rules.length - 1} aria-label="Lejjebb" className="p-1 text-neutral-500 disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
              <button onClick={() => setDraft(d => ({ ...d, rules: d.rules.filter((_, i) => i !== index) }))} aria-label="Pont törlése" className="p-1 text-red-700"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            {RULE_FIELDS.map(field => (
              <label key={field.key} className="block font-medium">{field.label}
                <span className="block font-normal text-[10px] text-neutral-500">{field.hint}</span>
                <textarea value={rule[field.key]} rows={field.rows} onChange={e => setRule(index, { [field.key]: e.target.value })} className={`${input} mt-0.5 font-normal resize-y`} />
              </label>
            ))}
          </section>
        ))}
        <button
          onClick={() => setDraft(d => ({ ...d, rules: [...d.rules, emptyRule(d.rules)] }))}
          disabled={draft.rules.length >= MAX_PLAYBOOK_RULES}
          className="flex items-center px-2.5 py-1.5 border border-dashed border-neutral-400 rounded-lg hover:bg-white disabled:opacity-40"
        ><Plus className="w-3.5 h-3.5 mr-1" />Új pont</button>
      </div>
      <div className="p-3 bg-white border-t border-neutral-200 space-y-2">
        {error && <p className="text-xs text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 py-2 text-sm font-medium bg-indigo-700 text-white rounded-lg hover:bg-indigo-800">Mentés</button>
          <button onClick={onCancel} className="px-4 py-2 text-sm border border-neutral-300 rounded-lg hover:bg-neutral-100">Mégse</button>
        </div>
      </div>
    </div>
  );
}
