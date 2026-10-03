import { ACCESS_KEY_HEADER, USER_ID_HEADER } from '../shared/aiConfig';
import { recordEvent } from './diagnostics';

/**
 * How the task pane proves who it is. The server says which way it wants (AUTH_MODE): the access key, the Microsoft
 * work account the user is signed in to Word with (Office single sign-on, no key needed), or either one.
 */
export type AuthMode = 'key' | 'microsoft' | 'both';

/** The Microsoft sign-in did not work; the message is for the user, the code is Office's (13001…) */
export class SignInError extends Error {
  code: number | null;
  constructor(message: string, code: number | null) {
    super(message);
    this.name = 'SignInError';
    this.code = code;
  }
}

let modeRequest: Promise<AuthMode> | null = null;

/** Asked once; an unreachable server is asked again next time */
export function loadAuthMode(): Promise<AuthMode> {
  modeRequest ??= fetch('/api/auth-mode')
    .then(response => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .then(data => (data?.mode === 'microsoft' || data?.mode === 'both' ? data.mode : 'key') as AuthMode)
    .catch(() => {
      modeRequest = null;
      return 'key' as AuthMode;
    });
  return modeRequest;
}

/** The server refused the sign-in: it may have been switched to another mode since, so it is asked again next time */
export function forgetAuthMode() {
  modeRequest = null;
}

/** For the tests: forget what the server said */
export function resetAuthMode() {
  modeRequest = null;
  skipMicrosoft = false;
}

/** Office's sign-in error codes in plain words (https://learn.microsoft.com/office/dev/add-ins/develop/troubleshoot-sso-in-office-add-ins) */
export function describeSignInError(code: number | null): string {
  switch (code) {
    case 13000:
      return 'Ez a Word-verzió nem támogatja a Microsoft-fiókos belépést. Frissítsd az Office-t (Microsoft 365), vagy kérj hozzáférési kulcsot az üzemeltetőtől.';
    case 13001:
      return 'Nem vagy bejelentkezve a Wordbe a munkahelyi Microsoft-fiókoddal. Jelentkezz be (Word jobb felső sarka), majd a Beállításokban nyomd meg a „Bejelentkezés” gombot.';
    case 13002:
      return 'A bejelentkezés vagy a hozzájárulás megszakadt. Próbáld újra a Beállítások → „Bejelentkezés” gombbal.';
    case 13003:
      return 'Ezzel a fióktípussal nem lehet belépni: munkahelyi (irodai) Microsoft-fiók kell, nem személyes.';
    case 13004:
    case 13005:
    case 13007:
      return 'A Word nem kapott belépési tokent ehhez a bővítményhez. Valószínűleg az Azure-ban hiányos az alkalmazásregisztráció (üzemeltetői feladat, lásd docs/MICROSOFT-BELEPES.md), vagy hálózati hiba volt.';
    case 13006:
      return 'Az Office belső hibát jelzett a belépésnél. Mentsd a munkát, indítsd újra a Wordöt, és próbáld újra.';
    case 13008:
      return 'Egy korábbi bejelentkezés még folyamatban van. Várj pár másodpercet, és próbáld újra.';
    case 13012:
      return 'Ezen a platformon (vagy ebből a megnyitási módból) a Word nem ad belépési tokent a bővítménynek.';
    case 13013:
      return 'Túl sok belépési kérés ment rövid idő alatt. Várj egy kicsit, és próbáld újra.';
    default:
      return `Nem sikerült a Microsoft-fiókos belépés${code ? ` (hibakód: ${code})` : ''}.`;
  }
}

/** A token for this add-in from Word; interactive: Word may ask the user to sign in or to consent */
export async function microsoftToken(interactive = true): Promise<string> {
  const auth = typeof Office !== 'undefined' ? Office.auth : undefined;
  if (!auth?.getAccessToken) throw new SignInError(describeSignInError(13000), 13000);
  try {
    return await auth.getAccessToken({ allowSignInPrompt: interactive, allowConsentPrompt: interactive });
  } catch (error) {
    const code = Number((error as { code?: unknown })?.code) || null;
    throw new SignInError(describeSignInError(code), code);
  }
}

/**
 * When either way is allowed and the Microsoft sign-in failed once, the access key is used from then on, so Word does
 * not ask on every request; the settings' sign-in button tries again
 */
let skipMicrosoft = false;
export const retryMicrosoftSignIn = () => {
  skipMicrosoft = false;
};

/**
 * The headers that sign a request: the Microsoft token when the server takes it, the access key when it takes that
 * (with both, the server uses the token first). interactive: false for background checks that must never pop up a
 * sign-in window.
 */
export async function requestHeaders(accessKey: string, userId = '', { interactive = true } = {}): Promise<Record<string, string>> {
  const mode = await loadAuthMode();
  const headers: Record<string, string> = {};
  if (userId.trim()) headers[USER_ID_HEADER] = encodeURIComponent(userId.trim());
  const keyUsable = mode !== 'microsoft' && !!accessKey;
  if (mode !== 'key' && !(skipMicrosoft && keyUsable)) {
    try {
      headers.Authorization = `Bearer ${await microsoftToken(interactive)}`;
    } catch (error) {
      if (!keyUsable) throw error;
      if (interactive) skipMicrosoft = true;
      recordEvent('action', `Microsoft-belépés sikertelen (${(error as SignInError).code ?? 'ismeretlen'}), hozzáférési kulccsal folytatom`);
    }
  }
  if (keyUsable) headers[ACCESS_KEY_HEADER] = accessKey;
  return headers;
}
