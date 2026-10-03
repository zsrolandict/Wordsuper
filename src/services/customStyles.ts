import type { FormatProfile } from './formatting';

/**
 * The user's own styles for the Formázás tab, kept on this machine (like the settings). Each is a full style
 * profile with a name; what is read back is checked field by field, so a damaged entry never reaches Word.
 */

export interface CustomStyle {
  id: string;
  name: string;
  profile: FormatProfile;
}

const STORAGE_KEY = 'word-writer-styles-v1';
export const MAX_STYLE_NAME = 40;

const NUMBER_FIELDS: (keyof FormatProfile)[] = [
  'bodySize', 'headingSize', 'footnoteSize', 'bodySpaceBefore', 'bodySpaceAfter', 'headingSpaceBefore', 'headingSpaceAfter',
  'lineSpacing', 'firstLineIndent', 'leftIndent', 'rightIndent', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight',
];
const COLOR_FIELDS: (keyof FormatProfile)[] = ['headingColor', 'h1Rule', 'h2Bar', 'bodyColor'];
const COLOR = /^(#[0-9A-Fa-f]{6})?$/;
const FONT = /^[\p{L}\d ._-]{1,60}$/u;

/** A profile as stored, or null when anything in it is not what Word may get */
export function sanitizeProfile(value: unknown): FormatProfile | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.font !== 'string' || !FONT.test(v.font)) return null;
  if (typeof v.headingFont !== 'string' || (v.headingFont && !FONT.test(v.headingFont))) return null;
  for (const key of NUMBER_FIELDS) {
    const n = v[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 72) return null;
  }
  for (const key of COLOR_FIELDS) if (typeof v[key] !== 'string' || !COLOR.test(v[key] as string)) return null;
  if (typeof v.headingSmallCaps !== 'boolean' || (v.alignment !== 'Left' && v.alignment !== 'Justified')) return null;
  return Object.fromEntries([
    ['font', v.font], ['headingFont', v.headingFont], ['headingSmallCaps', v.headingSmallCaps], ['alignment', v.alignment],
    ...NUMBER_FIELDS.map(k => [k, v[k]]), ...COLOR_FIELDS.map(k => [k, v[k]]),
  ]) as FormatProfile;
}

export function loadCustomStyles(): CustomStyle[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item): CustomStyle[] => {
      const profile = sanitizeProfile(item?.profile);
      const name = typeof item?.name === 'string' ? item.name.trim().slice(0, MAX_STYLE_NAME) : '';
      return profile && name && typeof item.id === 'string' ? [{ id: item.id, name, profile }] : [];
    });
  } catch {
    return [];
  }
}

export function saveCustomStyles(styles: CustomStyle[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(styles));
  } catch {
    // Private mode or full storage: the style stays for this session only
  }
}

export const newStyleId = () => `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
