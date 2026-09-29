import React, { useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Plus, Trash2, KeyRound, Loader2 } from 'lucide-react';
import { MAX_INSTRUCTION_CHARS, MAX_STYLE_NOTES_CHARS, MODES, type Addressing, type Mode, type Tone } from '../shared/aiConfig';
import type { Settings } from '../services/settings';
import { checkAccessKey, describeRequestError } from '../services/aiService';
import { MODE_LABELS, modeLabel } from './modes';

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
      <h2 className="text-sm font-semibold text-neutral-800">{title}</h2>
      {children}
    </section>
  );
}

const inputClass = 'w-full p-2 border border-neutral-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-neutral-50';

type KeyStatus = { state: 'idle' } | { state: 'checking' } | { state: 'ok' } | { state: 'error'; message: string };

export default function SettingsPanel({
  settings,
  onChange,
  onClose,
  currentMode,
}: {
  settings: Settings;
  onChange: (updater: (current: Settings) => Settings) => void;
  onClose: () => void;
  currentMode: Mode;
}) {
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({ state: 'idle' });
  const [presetMode, setPresetMode] = useState<Mode>(currentMode);
  const [presetLabel, setPresetLabel] = useState('');

  const style = settings.styleProfile;
  const setStyle = (changes: Partial<typeof style>) =>
    onChange(s => ({ ...s, styleProfile: { ...s.styleProfile, ...changes } }));

  const verifyKey = async () => {
    setKeyStatus({ state: 'checking' });
    try {
      const result = await checkAccessKey(settings.accessKey);
      setKeyStatus('error' in result ? { state: 'error', message: describeRequestError(result.error) } : { state: 'ok' });
    } catch {
      setKeyStatus({ state: 'error', message: 'Nem érem el a szervert. Ellenőrizd a hálózatot.' });
    }
  };

  const addPreset = () => {
    const label = presetLabel.trim();
    if (!label) return;
    onChange(s => ({ ...s, customPresets: [...s.customPresets, { id: newId(), mode: presetMode, label }] }));
    setPresetLabel('');
  };

  return (
    <div className="h-screen bg-neutral-50 flex flex-col font-sans text-neutral-900">
      <div className="bg-blue-600 px-4 py-4 text-white shrink-0 shadow-md flex items-center">
        <button onClick={onClose} className="mr-2 p-1 rounded-lg hover:bg-blue-500 transition-colors" aria-label="Vissza">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">Beállítások</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        <Card title="Hozzáférési kulcs">
          <p className="text-xs text-neutral-500">A szerver csak ezzel a kulccsal fogad kéréseket. Az üzemeltető adja meg (APP_ACCESS_KEY).</p>
          <div className="flex space-x-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings.accessKey}
                onChange={e => { onChange(s => ({ ...s, accessKey: e.target.value.trim() })); setKeyStatus({ state: 'idle' }); }}
                placeholder="Hozzáférési kulcs"
                autoComplete="off"
                className={`${inputClass} pr-9`}
              />
              <button
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                aria-label={showKey ? 'Kulcs elrejtése' : 'Kulcs megjelenítése'}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={verifyKey}
              disabled={!settings.accessKey || keyStatus.state === 'checking'}
              className="flex items-center px-3 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors"
            >
              {keyStatus.state === 'checking' ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />}
              {keyStatus.state === 'checking' ? '' : 'Ellenőrzés'}
            </button>
          </div>
          {keyStatus.state === 'ok' && <p className="text-xs text-green-700">✅ A kulcs rendben van.</p>}
          {keyStatus.state === 'error' && <p className="text-xs text-red-700 whitespace-pre-wrap">{keyStatus.message}</p>}
        </Card>

        <Card title="Beszúrás">
          <label className="flex items-start space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!settings.autoApply}
              onChange={e => onChange(s => ({ ...s, autoApply: !e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              Előnézet beszúrás előtt <span className="text-neutral-400">(ajánlott)</span>
              <span className="block text-xs text-neutral-500">Előbb megmutatom a javaslatot, és te döntöd el, hogy bekerül-e a dokumentumba. Kikapcsolva azonnal beszúrom.</span>
            </span>
          </label>
        </Card>

        <Card title="Stílusprofil">
          <p className="text-xs text-neutral-500">Minden kérésnél figyelembe veszem, hacsak az utasítás mást nem mond.</p>
          <label className="block text-xs font-medium text-neutral-700">
            Megszólítás
            <select value={style.addressing} onChange={e => setStyle({ addressing: e.target.value as Addressing })} className={`${inputClass} mt-1`}>
              <option value="">Nincs megadva</option>
              <option value="formal">Magázó</option>
              <option value="informal">Tegező</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-neutral-700">
            Hangnem
            <select value={style.tone} onChange={e => setStyle({ tone: e.target.value as Tone })} className={`${inputClass} mt-1`}>
              <option value="">Nincs megadva</option>
              <option value="legal">Jogi</option>
              <option value="business">Üzleti</option>
              <option value="plain">Közérthető</option>
              <option value="friendly">Barátságos</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-neutral-700">
            Egyéni irányelvek
            <textarea
              value={style.notes}
              onChange={e => setStyle({ notes: e.target.value })}
              maxLength={MAX_STYLE_NOTES_CHARS}
              rows={3}
              placeholder="Pl. mindig a „Megbízó” és „Megbízott” kifejezéseket használd."
              className={`${inputClass} mt-1 resize-none font-normal`}
            />
            <span className="block text-right text-[10px] text-neutral-400 font-normal">{style.notes.length} / {MAX_STYLE_NOTES_CHARS}</span>
          </label>
        </Card>

        <Card title="Saját gyorsgombok">
          {MODES.map(mode => {
            const presets = settings.customPresets.filter(p => p.mode === mode);
            if (!presets.length) return null;
            return (
              <div key={mode}>
                <h3 className="text-xs font-medium text-neutral-500 mb-1">{modeLabel(mode)}</h3>
                <ul className="space-y-1">
                  {presets.map(preset => (
                    <li key={preset.id} className="flex items-center justify-between bg-neutral-50 border border-neutral-200 rounded-lg px-2 py-1">
                      <span className="text-xs truncate">{preset.label}</span>
                      <button
                        onClick={() => onChange(s => ({ ...s, customPresets: s.customPresets.filter(p => p.id !== preset.id) }))}
                        className="text-neutral-400 hover:text-red-600 ml-2 shrink-0"
                        aria-label={`${preset.label} törlése`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {settings.customPresets.length === 0 && <p className="text-xs text-neutral-500">Még nincs saját gyorsgombod. A gomb szövege lesz az utasítás.</p>}
          <div className="flex space-x-2">
            <select value={presetMode} onChange={e => setPresetMode(e.target.value as Mode)} className="p-2 border border-neutral-300 rounded-lg text-xs bg-neutral-50" aria-label="Mód">
              {MODES.map(mode => <option key={mode} value={mode}>{MODE_LABELS[mode].label}</option>)}
            </select>
            <input
              value={presetLabel}
              onChange={e => setPresetLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addPreset(); }}
              maxLength={MAX_INSTRUCTION_CHARS}
              placeholder="Pl. Fordítsd angolra"
              className={`${inputClass} flex-1 min-w-0 text-xs`}
            />
            <button
              onClick={addPreset}
              disabled={!presetLabel.trim()}
              className="shrink-0 px-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg"
              aria-label="Gyorsgomb hozzáadása"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </Card>

        <p className="text-[11px] text-center text-neutral-400 pb-2">A beállításokat ezen a gépen jegyzem meg.</p>
      </div>
    </div>
  );
}
