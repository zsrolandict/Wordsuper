import type { Mode } from '../shared/aiConfig';

export const MODE_LABELS: Record<Mode, { icon: string; label: string }> = {
  edit: { icon: '📝', label: 'Szerkesztés' },
  comment: { icon: '💬', label: 'Vélemény' },
  generate: { icon: '✨', label: 'Generálás' },
  review: { icon: '🔍', label: 'Átvizsgálás' },
  compare: { icon: '⇄', label: 'Összevetés' },
};

export const modeLabel = (mode: Mode) => `${MODE_LABELS[mode].icon} ${MODE_LABELS[mode].label}`;

export const DEFAULT_PRESETS: Record<Mode, string[]> = {
  edit: ['Javítsd a helyesírást', 'Tedd hivatalosabbá', 'Rövidítsd le'],
  comment: ['Kockázatok keresése', 'Magyarázd el egyszerűen', 'Mi hiányzik belőle?'],
  generate: ['Titoktartási záradék (NDA)', 'Vis maior záradék', 'Fizetési feltételek'],
  review: ['Kockázatok és hiányosságok', 'Ellentmondások keresése', 'Jogszabályi hivatkozások', 'Kereszthivatkozások és számozás', 'Helyesírás és stílus'],
  compare: ['Mit módosított a partner, és mi a kockázata?', 'Csak a kockázatos változások', 'Rövid összefoglaló az ügyfélnek'],
};

/** Built-in quick buttons whose short label stands for a longer instruction */
export const PRESET_INSTRUCTIONS: Record<string, string> = {
  'Jogszabályi hivatkozások': `Ellenőrizd a dokumentum összes jogszabályi hivatkozását (törvény, rendelet, §, bekezdés, pont, pl. „Ptk. 6:48. §”).
Mindegyiknél vizsgáld meg:
- létezik-e az a jogszabály és az a hely (§, bekezdés, pont), és helyes-e a jogszabály neve, száma, éve és rövidítése;
- arról szól-e, amire a szerződés hivatkozik, vagyis jó helyre mutat-e;
- oda illik-e egyáltalán a hivatkozás, vagy más jogszabályhely lenne a helyes (pl. régi Ptk. helyett a 2013. évi V. törvény);
- tudomásod szerint hatályos-e, nem módosult vagy szűnt-e meg.
Ahol javítani kell, add meg a javított szöveget. Ha valamiben nem vagy biztos (különösen a hatályosságban és a friss módosításokban), a megjegyzésben írd ki, hogy a Nemzeti Jogszabálytárban (njt.hu) ellenőrizni kell. A tudásod nem élő jogszabálytár, ne állíts biztosat, amit nem tudsz.`,
  'Kereszthivatkozások és számozás': `Csak a dokumentum szerkezetét ellenőrizd, a tartalmát ne:
- pontszámozás: kimaradt vagy ismétlődő szám, rossz sorrend, következetlen formátum (pl. „5.2.” és „5.2” vegyesen), a szögletes zárójelben látható automatikus számozással együtt;
- kereszthivatkozások: létezik-e a hivatkozott pont, bekezdés vagy melléklet, és tartalmilag is oda mutat-e, ahova kell (pl. a fizetésre hivatkozó mondat tényleg a fizetési pontra mutat-e);
- mellékletek: a hivatkozott mellékletek megvannak-e, és egyezik-e a számozásuk és a címük;
- definiált fogalmak: minden nagybetűs fogalom definiálva van-e, egységesen használja-e a szöveg, van-e definiált, de nem használt fogalom.
Ahol a hiba szövegcserével javítható (pl. rossz pontszám), add meg a javított szöveget.`,
};

export const PLACEHOLDERS: Record<Mode, string> = {
  edit: 'Mit módosítsak? (kijelölés nélkül az egész dokumentumon)',
  comment: 'Mit nézzek meg? (kijelölés nélkül az egész dokumentumot)',
  generate: 'Mit írjak a kurzor helyére?',
  review: 'Mire figyeljek a teljes dokumentumban?',
  compare: 'Mire figyeljek a változásokban?',
};

export interface PresetMatch {
  label: string;
  mode: Mode;
  /** One of the user's own quick buttons (not a built-in one) */
  custom: boolean;
}

const presetKey = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?…]+$/, '');

/**
 * Recognizes an instruction that is the text of a quick button, typed or clicked. The user's own buttons of
 * the current mode come first, then their buttons of other modes (the request then runs in that mode), then
 * the built-in ones of the current mode.
 */
export function matchPreset(instruction: string, mode: Mode, customPresets: { mode: Mode; label: string }[]): PresetMatch | null {
  const key = presetKey(instruction);
  if (!key) return null;
  const own = customPresets.filter(p => presetKey(p.label) === key);
  const custom = own.find(p => p.mode === mode) ?? own[0];
  if (custom) return { label: custom.label, mode: custom.mode, custom: true };
  const builtIn = DEFAULT_PRESETS[mode].find(label => presetKey(label) === key);
  return builtIn ? { label: builtIn, mode, custom: false } : null;
}
