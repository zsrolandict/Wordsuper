import React, { useState } from 'react';
import { Bug, Copy, Download } from 'lucide-react';
import { buildReport } from '../services/diagnostics';
import { downloadFile } from '../services/download';
import type { ServerInfo } from '../services/aiService';
import type { Settings } from '../services/settings';

/**
 * Hibajelentés: összegyűjti, mi történt (hibák, a kérések kimenetele, verziók, a Word képességei), a dokumentum
 * szövege, a kulcsok és a nevek nélkül. Megmutatja, és a felhasználó másolja vagy letölti; magától nem küld semmit.
 */
export default function ErrorReport({ serverInfo, settings }: { serverInfo: ServerInfo | null; settings: Settings }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [copied, setCopied] = useState(false);

  const report = () => buildReport({
    appVersion: __APP_VERSION__,
    server: serverInfo ? { version: serverInfo.version, date: serverInfo.date, model: serverInfo.model, location: serverInfo.location, maskingPolicy: serverInfo.maskingPolicy } : 'nem érhető el',
    // Only the switches: no access key, no names, no own terms
    settings: {
      masking: settings.masking.enabled,
      previewBeforeSend: settings.masking.previewBeforeSend,
      ownTermsToHide: settings.masking.extraTerms.trim() ? 'van' : 'nincs',
      depth: settings.depth,
      skipTrackedChanges: settings.skipTrackedChanges,
      sound: settings.sound,
    },
    description,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-1 mr-1.5 inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-100">
        <Bug className="w-3 h-3 mr-1" />Hibajelentés
      </button>
    );
  }
  return (
    <div className="mt-2 text-left bg-white border border-neutral-200 rounded-xl p-3 space-y-2 text-xs text-neutral-700">
      <p className="font-semibold text-neutral-900">Hibajelentés</p>
      <p>Összegyűjtöm, mi történt az utóbbi időben: a hibákat, a kérések kimenetelét (mód, méret, idő), a verziókat és a Word képességeit. <strong>A dokumentum szövege, az utasítás, a válasz, a kulcs és a nevek nincsenek benne.</strong> Magától nem küldök el semmit.</p>
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        maxLength={2000}
        rows={3}
        placeholder="Mi történt? (pl. a Formázásnál az Egységesítés után nem változott semmi)"
        aria-label="Mi történt?"
        className="w-full p-1.5 border border-neutral-300 rounded-md bg-neutral-50"
      />
      <details>
        <summary className="cursor-pointer text-neutral-500">Mi lesz benne? (megnézem)</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all text-[10px] bg-neutral-50 border border-neutral-200 rounded p-1.5">{report()}</pre>
      </details>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={copy} className="flex items-center px-2 py-1 font-medium border border-blue-600 text-blue-700 rounded-md hover:bg-blue-50"><Copy className="w-3 h-3 mr-1" />{copied ? 'Kimásolva' : 'Másolás'}</button>
        <button onClick={() => downloadFile(report(), `word-writer-hibajelentes-${new Date().toISOString().slice(0, 10)}.json`, 'application/json')} className="flex items-center px-2 py-1 font-medium border border-neutral-300 rounded-md hover:bg-neutral-100"><Download className="w-3 h-3 mr-1" />Letöltés</button>
        <button onClick={() => setOpen(false)} className="px-2 py-1 border border-neutral-300 rounded-md hover:bg-neutral-100">Bezárás</button>
      </div>
      <p className="text-neutral-500">A kimásolt jelentést küldd el a fejlesztőnek (e-mailben vagy ide a beszélgetésbe).</p>
    </div>
  );
}
