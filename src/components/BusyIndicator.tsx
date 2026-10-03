import { useRunningActivities } from '../services/activity';
import { LogoMark } from './Logo';

/**
 * The moving sign in the header while the add-in works (an AI request in any tab, or writing into the document).
 * The sign of the logo turns slowly while it works.
 */
export default function BusyIndicator({ writing = false }: { writing?: boolean }) {
  const running = useRunningActivities();
  if (running === 0 && !writing) return null;
  const label = running > 0 ? (running > 1 ? `Dolgozom (${running} kérés fut)…` : 'Dolgozom…') : 'Írom a dokumentumba…';
  return (
    <span role="status" title={label} aria-label={label} className="flex items-center px-1.5 py-1 rounded-lg bg-white/10">
      <LogoMark className="w-5 h-5 animate-[spin_2.4s_linear_infinite]" />
      <span className="ml-1 text-[11px] font-medium text-white hidden min-[360px]:inline">Dolgozom</span>
    </span>
  );
}
