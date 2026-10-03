import { useEffect, useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { checkMicrosoftSignIn, describeRequestError, type RateLimitInfo } from '../services/aiService';
import { loadAuthMode, retryMicrosoftSignIn, type AuthMode } from '../services/signIn';

/** How the server wants the pane to sign in; null until it answers */
export function useAuthMode(): AuthMode | null {
  const [mode, setMode] = useState<AuthMode | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadAuthMode().then(value => { if (!cancelled) setMode(value); });
    return () => { cancelled = true; };
  }, []);
  return mode;
}

type Status = { state: 'idle' } | { state: 'checking' } | { state: 'ok'; user: string; name: string } | { state: 'error'; message: string };

/** Settings card: sign-in with the Microsoft work account the user is signed in to Word with */
export default function MicrosoftSignIn({ mode, onRateLimit }: { mode: 'microsoft' | 'both'; onRateLimit: (info: RateLimitInfo) => void }) {
  const [status, setStatus] = useState<Status>({ state: 'idle' });

  // Quietly first: when Word already has the account, the card says who is signed in without any window
  useEffect(() => {
    let cancelled = false;
    checkMicrosoftSignIn(false).then(result => {
      if (cancelled) return;
      if (result.rateLimit) onRateLimit(result.rateLimit);
      if (result.ok) setStatus({ state: 'ok', user: result.user ?? '', name: result.name ?? '' });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const signIn = async () => {
    setStatus({ state: 'checking' });
    // A failure earlier made the requests use the access key; this tries the account again
    retryMicrosoftSignIn();
    try {
      const result = await checkMicrosoftSignIn(true);
      if (result.rateLimit) onRateLimit(result.rateLimit);
      setStatus(result.ok ? { state: 'ok', user: result.user ?? '', name: result.name ?? '' } : { state: 'error', message: describeRequestError(result.error) });
    } catch {
      setStatus({ state: 'error', message: 'Nem érem el a szervert. Ellenőrizd a hálózatot.' });
    }
  };

  return (
    <section className="bg-white border border-neutral-200 rounded-xl p-3 space-y-2">
      <h2 className="text-sm font-semibold text-neutral-800">Bejelentkezés Microsoft-fiókkal</h2>
      <p className="text-xs text-neutral-500">
        Az iroda szervere azt a munkahelyi fiókot használja, amellyel a Wordbe bejelentkeztél: nem kell kulcsot megadni, és az auditnapló ellenőrzötten a nevedet írja.
        {mode === 'both' && ' Ha a belépés nem sikerül, a lenti hozzáférési kulccsal dolgozom tovább.'}
      </p>
      {status.state === 'ok' && (
        <p className="text-xs text-green-700">
          ✅ Bejelentkezve: <span className="font-medium">{status.name || status.user}</span>{status.name && status.user ? ` (${status.user})` : ''}
        </p>
      )}
      <button
        onClick={signIn}
        disabled={status.state === 'checking'}
        className="flex items-center px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg transition-colors"
      >
        {status.state === 'checking' ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <LogIn className="w-4 h-4 mr-1" />}
        {status.state === 'ok' ? 'Újra ellenőrzöm' : 'Bejelentkezés'}
      </button>
      {status.state === 'error' && <p className="text-xs text-red-700 whitespace-pre-wrap">{status.message}</p>}
    </section>
  );
}
