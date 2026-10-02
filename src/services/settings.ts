import { useCallback, useState } from 'react';
import { LOCAL_MODELS, type LocalModel } from './localSpeech';
import { DEPTH_VALUES, type Depth } from '../shared/aiConfig';
import { ADDRESSING_VALUES, MODES, TONE_VALUES, type Addressing, type Mode, type StyleProfile, type Tone } from '../shared/aiConfig';

export interface CustomPreset {
  id: string;
  mode: Mode;
  /** The button's text, e.g. "ENG" */
  label: string;
  /** What the AI is asked, e.g. "Fordítsd le angolra, jogi szaknyelven"; the label itself when empty */
  instruction?: string;
}

export interface Settings {
  /** Must match APP_ACCESS_KEY on the server */
  accessKey: string;
  /** Name or e-mail for the server's audit log (who ran what); optional */
  userId: string;
  styleProfile: StyleProfile;
  customPresets: CustomPreset[];
  /** Insert without the preview step */
  autoApply: boolean;
  /** Replace sensitive values with placeholders before anything is sent to the AI */
  masking: {
    enabled: boolean;
    extraTerms: string;
    neverHide: string;
    /** Show what the AI will get, and wait for "Küldés", before every request */
    previewBeforeSend: boolean;
  };
  /** A soft chime when an answer is ready */
  sound: boolean;
  /**
   * local: Whisper runs on this machine, the recording never leaves it (default).
   * cloud: the server's AI transcribes it; only allowed when the server processes data in the EU.
   */
  dictation: { engine: 'local' | 'cloud'; localModel: LocalModel; /** Cloud dictation outside the EU, at the user's own risk */ riskAccepted: boolean };
  /** How hard the AI thinks: auto lets the model decide */
  depth: Depth;
  /**
   * Write changes without Track Changes (e.g. into one's own first draft). Off by default: tracked changes are the
   * rule. Even when on, a document with pending tracked changes is still written with Track Changes.
   */
  skipTrackedChanges: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  accessKey: '',
  userId: '',
  styleProfile: { addressing: '', tone: '', notes: '' },
  customPresets: [],
  autoApply: false,
  masking: { enabled: true, extraTerms: '', neverHide: '', previewBeforeSend: false },
  sound: true,
  // base misunderstands Hungarian too often to be the default
  dictation: { engine: 'local', localModel: 'small', riskAccepted: false },
  depth: 'auto',
  skipTrackedChanges: false,
};

const STORAGE_KEY = 'word-writer-settings-v1';

/** Anything read back from storage is validated, so a broken or old value never crashes the pane */
function sanitize(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<Settings>;
  const style = (value.styleProfile ?? {}) as Partial<StyleProfile>;
  return {
    accessKey: typeof value.accessKey === 'string' ? value.accessKey : '',
    userId: typeof value.userId === 'string' ? value.userId : '',
    styleProfile: {
      addressing: (ADDRESSING_VALUES as readonly string[]).includes(style.addressing as string) ? style.addressing as Addressing : '',
      tone: (TONE_VALUES as readonly string[]).includes(style.tone as string) ? style.tone as Tone : '',
      notes: typeof style.notes === 'string' ? style.notes : '',
    },
    customPresets: (Array.isArray(value.customPresets) ? value.customPresets : []).filter(
      (p): p is CustomPreset => !!p && typeof p.id === 'string' && typeof p.label === 'string' && (MODES as readonly string[]).includes(p.mode)
    ).map(p => ({ id: p.id, mode: p.mode, label: p.label, ...(typeof p.instruction === 'string' && p.instruction.trim() ? { instruction: p.instruction } : {}) })),
    autoApply: value.autoApply === true,
    // Older settings had no masking entry: masking is on unless it was switched off explicitly
    masking: {
      enabled: value.masking?.enabled !== false,
      extraTerms: typeof value.masking?.extraTerms === 'string' ? value.masking.extraTerms : '',
      neverHide: typeof value.masking?.neverHide === 'string' ? value.masking.neverHide : '',
      previewBeforeSend: value.masking?.previewBeforeSend === true,
    },
    sound: value.sound !== false,
    depth: (DEPTH_VALUES as readonly unknown[]).includes(value.depth) ? value.depth as Depth : 'auto',
    skipTrackedChanges: value.skipTrackedChanges === true,
    dictation: {
      engine: value.dictation?.engine === 'cloud' ? 'cloud' : 'local',
      localModel: value.dictation?.localModel && value.dictation.localModel in LOCAL_MODELS ? value.dictation.localModel : 'small',
      riskAccepted: value.dictation?.riskAccepted === true,
    },
  };
}

export function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? sanitize(JSON.parse(stored)) : DEFAULT_SETTINGS;
  } catch {
    // Storage can be blocked or empty in some Office hosts; the defaults still work
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not persisted, but the current session keeps working
  }
}

export function useSettings(): [Settings, (update: (current: Settings) => Settings) => void] {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const update = useCallback((updater: (current: Settings) => Settings) => {
    setSettings(current => {
      const next = updater(current);
      saveSettings(next);
      return next;
    });
  }, []);
  return [settings, update];
}

/** Short Hungarian summary of the style profile, for the details panel */
export function describeStyle(style: StyleProfile): string {
  const parts: string[] = [];
  if (style.addressing === 'formal') parts.push('magázó');
  if (style.addressing === 'informal') parts.push('tegező');
  if (style.tone === 'legal') parts.push('jogi hangnem');
  if (style.tone === 'business') parts.push('üzleti hangnem');
  if (style.tone === 'plain') parts.push('közérthető');
  if (style.tone === 'friendly') parts.push('barátságos');
  if (style.notes.trim()) parts.push('egyéni irányelvek');
  return parts.join(', ');
}
