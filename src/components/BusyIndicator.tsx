import { useRunningActivities } from '../services/activity';

/**
 * The moving sign in the header while the add-in works (an AI request in any tab, or writing into the document).
 * Later the logo turns here; until then a turning ring in the brand colours.
 */
export default function BusyIndicator({ writing = false }: { writing?: boolean }) {
  const running = useRunningActivities();
  if (running === 0 && !writing) return null;
  const label = running > 0 ? (running > 1 ? `Dolgozom (${running} kérés fut)…` : 'Dolgozom…') : 'Írom a dokumentumba…';
  return (
    <span role="status" title={label} aria-label={label} className="flex items-center px-1.5 py-1 rounded-lg bg-[#29abe2]/10">
      <span className="block w-4 h-4 rounded-full border-2 border-[#29abe2]/30 border-t-[#29abe2] border-r-[#0f2350] animate-spin" />
      <span className="ml-1 text-[11px] font-medium text-[#0f2350] hidden min-[360px]:inline">Dolgozom</span>
    </span>
  );
}
