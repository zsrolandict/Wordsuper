import type { Mode } from '../shared/aiConfig';

export const MODE_LABELS: Record<Mode, { icon: string; label: string }> = {
  edit: { icon: '📝', label: 'Szerkesztés' },
  comment: { icon: '💬', label: 'Vélemény' },
  generate: { icon: '✨', label: 'Generálás' },
  review: { icon: '🔍', label: 'Átvizsgálás' },
};

export const modeLabel = (mode: Mode) => `${MODE_LABELS[mode].icon} ${MODE_LABELS[mode].label}`;

export const DEFAULT_PRESETS: Record<Mode, string[]> = {
  edit: ['Javítsd a helyesírást', 'Tedd hivatalosabbá', 'Rövidítsd le'],
  comment: ['Kockázatok keresése', 'Magyarázd el egyszerűen', 'Mi hiányzik belőle?'],
  generate: ['Titoktartási záradék (NDA)', 'Vis maior záradék', 'Fizetési feltételek'],
  review: ['Kockázatok és hiányosságok', 'Ellentmondások keresése', 'Helyesírás és stílus'],
};

export const PLACEHOLDERS: Record<Mode, string> = {
  edit: 'Kijelöltem a szöveget. Csináld azt vele, hogy...',
  comment: 'Mit nézzek meg a kijelölt részben?',
  generate: 'Mit írjak a kurzor helyére?',
  review: 'Mire figyeljek a teljes dokumentumban?',
};
