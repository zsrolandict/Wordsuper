import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Eye, EyeOff, Plus, Trash2, KeyRound, Loader2, Volume2, RotateCw } from 'lucide-react';
import { playSound } from '../services/sound';
import { LOCAL_MODELS, type LocalModel } from '../services/localSpeech';
import { ENTITY_LABELS } from '../services/masking';
import { MAX_INSTRUCTION_CHARS, MAX_STYLE_NOTES_CHARS, MODES, type Addressing, type Mode, type Tone } from '../shared/aiConfig';
import type { Settings } from '../services/settings';
import { checkAccessKey, describeRequestError, fetchServerInfo, type RateLimitInfo, type ServerInfo } from '../services/aiService';
import { MODE_LABELS, modeLabel, presetNeedsInstruction } from './modes';

/** The server runs another version than this page was loaded with (e.g. after an update): a reload brings it */
export const isOtherVersion = (serverVersion: string) =>
  serverVersion !== __APP_VERSION__ && __APP_VERSION__ !== 'ismeretlen' && serverVersion !== 'ismeretlen';

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
  onRateLimit,
  onReload,
}: {
  settings: Settings;
  onChange: (updater: (current: Settings) => Settings) => void;
  onClose: () => void;
  currentMode: Mode;
  /** The key check counts towards the rate limit too, so the limits bar is told about it */
  onRateLimit: (info: RateLimitInfo) => void;
  /** Loads the add-in again (asks first if a conversation would be lost) */
  onReload: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>({ state: 'idle' });
  const [presetMode, setPresetMode] = useState<Mode>(currentMode);
  const [presetLabel, setPresetLabel] = useState('');
  const [presetInstruction, setPresetInstruction] = useState('');
  // What the server runs: its version, where it processes data (for dictation and the version line below)
  const [serverInfo, setServerInfo] = useState<ServerInfo | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    fetchServerInfo(settings.accessKey).then(info => { if (!cancelled) setServerInfo(info); });
    return () => { cancelled = true; };
  }, [settings.accessKey]);

  const style = settings.styleProfile;
  const setStyle = (changes: Partial<typeof style>) =>
    onChange(s => ({ ...s, styleProfile: { ...s.styleProfile, ...changes } }));

  // The key being edited right now; a check that finishes after an edit belongs to an old key and is dropped
  const currentKeyRef = useRef(settings.accessKey);
  useEffect(() => {
    currentKeyRef.current = settings.accessKey;
  }, [settings.accessKey]);

  const verifyKey = async () => {
    const checkedKey = settings.accessKey;
    setKeyStatus({ state: 'checking' });
    let status: KeyStatus;
    try {
      const result = await checkAccessKey(checkedKey);
      if (result.rateLimit) onRateLimit(result.rateLimit);
      status = result.ok ? { state: 'ok' } : { state: 'error', message: describeRequestError(result.error) };
    } catch {
      status = { state: 'error', message: 'Nem érem el a szervert. Ellenőrizd a hálózatot.' };
    }
    if (currentKeyRef.current === checkedKey) setKeyStatus(status);
  };

  const addPreset = () => {
    const label = presetLabel.trim();
    const instruction = presetInstruction.trim();
    if (!label || presetNeedsInstruction(label, instruction)) return;
    onChange(s => ({ ...s, customPresets: [...s.customPresets, { id: newId(), mode: presetMode, label, ...(instruction ? { instruction } : {}) }] }));
    setPresetLabel('');
    setPresetInstruction('');
  };

  return (
    <div className="h-screen bg-neutral-50 flex flex-col font-sans text-neutral-900">
      <div className="bg-white border-b-2 border-[#29abe2] px-4 py-3 text-[#0f2350] shrink-0 shadow-sm flex items-center">
        <button onClick={onClose} className="mr-2 p-1 rounded-lg hover:bg-neutral-100 transition-colors" aria-label="Vissza">
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
          <label className="block text-xs font-medium text-neutral-700 pt-1">
            Felhasználói azonosító <span className="font-normal text-neutral-400">(nem kötelező)</span>
            <input
              value={settings.userId}
              onChange={e => onChange(s => ({ ...s, userId: e.target.value }))}
              maxLength={100}
              placeholder="Pl. dr. Kovács Anna vagy kovacs.anna@iroda.hu"
              className={`${inputClass} mt-1 font-normal`}
            />
            <span className="block text-[10px] text-neutral-400 font-normal">A szerver auditnaplója ezzel jegyzi fel, ki mikor milyen műveletet futtatott. A dokumentum tartalma sosem kerül a naplóba, csak méretek, időpont, modell és tokenszám.</span>
          </label>
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
          <label className="flex items-start space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.skipTrackedChanges}
              onChange={e => onChange(s => ({ ...s, skipTrackedChanges: e.target.checked }))}
              className="mt-0.5"
            />
            <span>
              Beírás korrektúra nélkül <span className="text-neutral-400">(saját tervezethez)</span>
              <span className="block text-xs text-neutral-500">
                Alapból minden változtatás korrektúrával kerül be. Bekapcsolva a Word saját „Változások követése” beállítása dönt.
                Ha a dokumentumban el nem fogadott korrektúra van (pl. a másik fél módosításai), biztonsági okból mégis korrektúrával írok, hogy semmi ne kerülhessen be észrevétlenül.
                Korrektúra nélkül a „Visszavonom” gomb nem érhető el; a Word Ctrl+Z-je működik.
              </span>
            </span>
          </label>
        </Card>

        <Card title="Hangjelzés">
          <div className="flex items-start justify-between">
            <label className="flex items-start space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.sound}
                onChange={e => onChange(s => ({ ...s, sound: e.target.checked }))}
                className="mt-0.5"
              />
              <span>
                Halk hang, ha elkészültem
                <span className="block text-xs text-neutral-500">Két halk, emelkedő hang, ha kész a válasz; egy mélyebb, ha hiba történt. Így közben nyugodtan dolgozhatsz a dokumentumban.</span>
              </span>
            </label>
            <button onClick={() => playSound('done')} className="ml-2 shrink-0 flex items-center px-2 py-1 text-xs border border-neutral-300 rounded-lg hover:bg-neutral-100">
              <Volume2 className="w-3.5 h-3.5 mr-1" />Kipróbálás
            </button>
          </div>
        </Card>

        <Card title="Diktálás">
          {(['local', 'cloud'] as const).map(engine => (
            <label key={engine} className="flex items-start space-x-2 cursor-pointer">
              <input
                type="radio"
                name="dictation-engine"
                checked={settings.dictation.engine === engine}
                onChange={() => onChange(s => ({ ...s, dictation: { ...s.dictation, engine } }))}
                className="mt-0.5"
              />
              {engine === 'local' ? (
                <span>
                  Helyben, ezen a gépen <span className="text-neutral-400">(ajánlott)</span>
                  <span className="block text-xs text-neutral-500">A hangfelvétel nem hagyja el a gépet. Első használatkor egyszer letöltöm a beszédfelismerő modellt, utána a gépről töltődik be.</span>
                </span>
              ) : (
                <span>
                  Felhőben (a szerver AI-ja)
                  <span className="block text-xs text-neutral-500">Pontosabb lehet, de a hang a szerver AI-szolgáltatójához kerül, és hangot nem lehet maszkolni.</span>
                </span>
              )}
            </label>
          ))}
          {settings.dictation.engine === 'cloud' && (
            serverInfo?.euResident ? (
              <p className="text-xs text-green-700">✅ Ez a szerver EU-ban dolgoz fel ({serverInfo.location}), a hang nem hagyja el az EU-t.</p>
            ) : serverInfo?.dictationPolicy === 'eu-only' ? (
              <p className="text-xs text-red-700">⛔ Az üzemeltető csak EU-ban feldolgozott felhős diktálást engedélyez, ez a szerver ({serverInfo.location ?? 'ismeretlen'}) nem az. Használd a helyi diktálást.</p>
            ) : (
              <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1.5">
                <p className="text-amber-900">
                  ⚠️ Ez a szerver ({serverInfo?.location ?? 'ismeretlen hely'}) nem garantálja, hogy a hang az EU-ban marad. A hangfelvételt nem lehet maszkolni, ezért a benne elhangzó nevek, összegek kijutnak a Google-höz. Ingyenes Gemini-kulcsnál a Google termékfejlesztésre is használhatja.
                </p>
                <label className="flex items-start space-x-2 cursor-pointer text-amber-950">
                  <input
                    type="checkbox"
                    checked={settings.dictation.riskAccepted}
                    onChange={e => onChange(s => ({ ...s, dictation: { ...s.dictation, riskAccepted: e.target.checked } }))}
                    className="mt-0.5"
                  />
                  <span>Tudomásul veszem, és saját felelősségemre használom a felhős diktálást. (A használat bekerül a szerver auditnaplójába.)</span>
                </label>
              </div>
            )
          )}
          {settings.dictation.engine === 'local' && (
            <label className="block text-xs font-medium text-neutral-700">
              Helyi modell
              <select
                value={settings.dictation.localModel}
                onChange={e => onChange(s => ({ ...s, dictation: { ...s.dictation, localModel: e.target.value as LocalModel } }))}
                className={`${inputClass} mt-1`}
              >
                {Object.entries(LOCAL_MODELS).map(([key, model]) => <option key={key} value={key}>{model.label}</option>)}
              </select>
              <span className="block text-[10px] text-neutral-400 font-normal mt-1">Váltás után az első diktáláskor egyszer letöltöm az új modellt. Tipp: a Windows saját diktálása (Windows+H a szövegmezőben) magyarul nagyon jó, de a hang ekkor a Microsofthoz megy.</span>
            </label>
          )}
        </Card>

        <Card title="Adatvédelem">
          <label className="flex items-start space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.masking.enabled}
              onChange={e => onChange(s => ({ ...s, masking: { ...s.masking, enabled: e.target.checked } }))}
              className="mt-0.5"
            />
            <span>
              Érzékeny adatok maszkolása <span className="text-neutral-400">(ajánlott)</span>
              <span className="block text-xs text-neutral-500">
                Mielőtt bármi az AI-hoz kerül, a neveket és azonosítókat helyettesítőre cserélem (pl. [CÉG_1], [SZEMÉLY_2]), a válaszban pedig visszacserélem.
                Felismerem: {Object.values(ENTITY_LABELS).filter(label => label !== ENTITY_LABELS.EGYÉB).join(', ')}.
                Hogy mit rejtettem el, azt minden válasz Részletek paneljén megnézheted.
              </span>
            </span>
          </label>
          <label className="block text-xs font-medium text-neutral-700">
            Mindig elrejtendő kifejezések
            <textarea
              value={settings.masking.extraTerms}
              onChange={e => onChange(s => ({ ...s, masking: { ...s.masking, extraTerms: e.target.value } }))}
              rows={3}
              placeholder={'Soronként egy, pl.\nNapfény projekt\nKiss és Társa'}
              className={`${inputClass} mt-1 resize-none font-normal`}
            />
            <span className="block text-[10px] text-neutral-400 font-normal">Amit a szabályok nem ismernek fel (projektnevek, becenevek, termékek). Pontos egyezésre keresem.</span>
          </label>
          <label className="block text-xs font-medium text-neutral-700">
            Soha ne rejtsd el
            <textarea
              value={settings.masking.neverHide}
              onChange={e => onChange(s => ({ ...s, masking: { ...s.masking, neverHide: e.target.value } }))}
              rows={2}
              placeholder={'Soronként egy, pl.\nNemzeti Adó- és Vámhivatal'}
              className={`${inputClass} mt-1 resize-none font-normal`}
            />
            <span className="block text-[10px] text-neutral-400 font-normal">Amit a szabály tévesen rejtene el (pl. hatóság, közismert cég). A Részletek panelen a „Ne rejtsd” gombbal is ide kerül.</span>
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
                      <span className="text-xs min-w-0">
                        <span className="font-medium">{preset.label}</span>
                        {preset.instruction && <span className="block text-[11px] text-neutral-500 truncate">{preset.instruction}</span>}
                        {presetNeedsInstruction(preset.label, preset.instruction) && (
                          <span className="block mt-1">
                            <span className="block text-[11px] text-amber-700">Nincs utasítása: az AI csak ennyit kap: „{preset.label}”. Mit tegyen?</span>
                            <input
                              onBlur={e => {
                                const value = e.target.value.trim();
                                if (value) onChange(s => ({ ...s, customPresets: s.customPresets.map(p => (p.id === preset.id ? { ...p, instruction: value } : p)) }));
                              }}
                              maxLength={MAX_INSTRUCTION_CHARS}
                              placeholder="Pl. Fordítsd le angolra, jogi szaknyelven."
                              aria-label={`${preset.label} utasítása`}
                              className="mt-0.5 w-full p-1.5 border border-amber-300 rounded-md text-[11px] bg-white"
                            />
                          </span>
                        )}
                      </span>
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
          {settings.customPresets.length === 0 && (
            <p className="text-xs text-neutral-500">Még nincs saját gyorsgombod. Egy gomb = egy gyakori kérés egy kattintásra, a kiválasztott módban.</p>
          )}
          <div className="space-y-1.5 bg-neutral-50 border border-neutral-200 rounded-lg p-2">
            <p className="text-[11px] font-medium text-neutral-600">Új gyorsgomb</p>
            <label className="block text-[11px] text-neutral-600">
              Melyik módban jelenjen meg
              <select value={presetMode} onChange={e => setPresetMode(e.target.value as Mode)} className="w-full mt-0.5 p-2 border border-neutral-300 rounded-lg text-xs bg-white" aria-label="Mód">
                {MODES.map(mode => <option key={mode} value={mode}>{MODE_LABELS[mode].label}</option>)}
              </select>
            </label>
            <label className="block text-[11px] text-neutral-600">
              A gomb felirata
              <input
                value={presetLabel}
                onChange={e => setPresetLabel(e.target.value)}
                maxLength={60}
                placeholder="Pl. ENG"
                className={`${inputClass} mt-0.5 text-xs bg-white`}
              />
            </label>
            <label className="block text-[11px] text-neutral-600">
              Mit kérjen az AI-tól <span className="text-neutral-400">(ha üres, a felirat lesz az utasítás)</span>
              <textarea
                value={presetInstruction}
                onChange={e => setPresetInstruction(e.target.value)}
                maxLength={MAX_INSTRUCTION_CHARS}
                rows={2}
                placeholder="Pl. Fordítsd le angolra, jogi szaknyelven, a definiált fogalmakat következetesen."
                className={`${inputClass} mt-0.5 text-xs bg-white resize-none`}
              />
            </label>
            {presetNeedsInstruction(presetLabel, presetInstruction) && presetLabel.trim() && (
              <p className="text-[11px] text-amber-700">
                A felirat egyetlen szó, ezért az AI nem tudhatja, mit jelent („{presetLabel.trim()}”). Írd le fent, mit kérjen tőle, pl. „Fordítsd le angolra, jogi szaknyelven.”
              </p>
            )}
            <button
              onClick={addPreset}
              disabled={!presetLabel.trim() || presetNeedsInstruction(presetLabel, presetInstruction)}
              className="w-full flex items-center justify-center py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg"
              aria-label="Gyorsgomb hozzáadása"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />Gyorsgomb hozzáadása
            </button>
          </div>
        </Card>

        <div className="text-[11px] text-center text-neutral-400 pb-2 space-y-0.5">
          <p>A beállításokat ezen a gépen jegyzem meg.</p>
          <p>
            Verzió: felület {__APP_VERSION__}
            {serverInfo ? ` · szerver ${serverInfo.version}${serverInfo.date ? ` (${serverInfo.date})` : ''}` : serverInfo === null ? ' · a szerver nem érhető el' : ''}
          </p>
          {serverInfo && isOtherVersion(serverInfo.version) && (
            <p className="text-amber-700">A felület és a szerver verziója eltér: töltsd újra a bővítményt. Ha utána is eltér, zárd be a Wordöt, és indítsd újra az INDITAS.bat-ot.</p>
          )}
          {serverInfo?.model && <p>{serverInfo.model} · {serverInfo.location}</p>}
          <button
            onClick={onReload}
            title="Ha a bővítmény nem válaszol, vagy új verzió érhető el"
            className="mt-1 inline-flex items-center px-2.5 py-1 text-[11px] font-medium text-neutral-600 border border-neutral-300 rounded-lg hover:bg-neutral-100"
          >
            <RotateCw className="w-3 h-3 mr-1" />Bővítmény újratöltése
          </button>
        </div>
      </div>
    </div>
  );
}
