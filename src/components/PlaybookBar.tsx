import { useEffect, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { fetchOfficePlaybooks } from '../services/aiService';
import { loadOwnPlaybooks } from '../services/playbook';
import { readPlaybooksFile, type Playbook } from '../shared/playbook';

const SELECTED_KEY = 'word-writer-playbook-selected';

/** The firm's playbooks (from the server) and the own ones; reloaded when `version` changes (after editing) */
export function usePlaybooks(accessKey: string, version: number): { office: Playbook[]; own: Playbook[] } {
  const [office, setOffice] = useState<Playbook[]>([]);
  const [own, setOwn] = useState<Playbook[]>(() => loadOwnPlaybooks());
  useEffect(() => {
    let cancelled = false;
    fetchOfficePlaybooks(accessKey).then(list => {
      if (!cancelled && list) setOffice(readPlaybooksFile(list, 'office').playbooks);
    });
    return () => { cancelled = true; };
  }, [accessKey]);
  useEffect(() => setOwn(loadOwnPlaybooks()), [version]);
  return { office, own };
}

/** In the Átvizsgálás mode: pick a playbook and check the whole document against it */
export default function PlaybookBar({ accessKey, version, disabled, onRun, onManage }: {
  accessKey: string;
  version: number;
  disabled: boolean;
  onRun: (playbook: Playbook) => void;
  onManage: () => void;
}) {
  const { office, own } = usePlaybooks(accessKey, version);
  const all = [...office, ...own];
  const [selected, setSelected] = useState(() => {
    try {
      return localStorage.getItem(SELECTED_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const choose = (id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(SELECTED_KEY, id);
    } catch {
      // only for this session
    }
  };
  const playbook = all.find(p => p.id === selected) ?? null;

  return (
    <div className="mb-2 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-2 text-xs text-indigo-950">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 shrink-0 text-indigo-700" />
        <label className="sr-only" htmlFor="playbook-select">Playbook</label>
        <select
          id="playbook-select"
          value={playbook ? playbook.id : ''}
          onChange={e => choose(e.target.value)}
          className="min-w-0 flex-1 rounded border border-indigo-200 bg-white px-1.5 py-1"
        >
          <option value="">Playbook nélkül (szabad átvizsgálás)</option>
          {office.length > 0 && (
            <optgroup label="Irodai">
              {office.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          )}
          {own.length > 0 && (
            <optgroup label="Saját">
              {own.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          )}
        </select>
        <button
          onClick={() => playbook && onRun(playbook)}
          disabled={disabled || !playbook}
          className="shrink-0 rounded bg-indigo-700 px-2 py-1 font-medium text-white hover:bg-indigo-800 disabled:opacity-40"
        >
          Ellenőrzés
        </button>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-indigo-800">
        <span>{playbook ? `${playbook.rules.length} pont${playbook.side ? ` · ${playbook.side} oldaláról` : ''}` : all.length ? 'Válassz playbookot az iroda szabálykönyve szerinti ellenőrzéshez.' : 'Még nincs playbook.'}</span>
        <button onClick={onManage} className="underline shrink-0 ml-2">Playbookok kezelése</button>
      </div>
    </div>
  );
}
