import { CHECK_LABELS, type PlaybookCheck } from '../services/playbook';

const CHIP: Record<PlaybookCheck['position'], string> = {
  standard: 'bg-green-50 text-green-800 border-green-200',
  fallback1: 'bg-sky-50 text-sky-800 border-sky-200',
  fallback2: 'bg-amber-50 text-amber-800 border-amber-200',
  walkaway: 'bg-red-50 text-red-800 border-red-300',
  missing: 'bg-white text-red-800 border-red-300 border-dashed',
  unchecked: 'bg-neutral-50 text-neutral-500 border-neutral-200',
};

/** The playbook check as a checklist: every rule with the level the document meets */
export default function PlaybookSummary({ name, checks }: { name: string; checks: PlaybookCheck[] }) {
  const counts = checks.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.position]: (acc[c.position] ?? 0) + 1 }), {});
  const order: PlaybookCheck['position'][] = ['standard', 'fallback1', 'fallback2', 'walkaway', 'missing', 'unchecked'];
  return (
    <section className="mb-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs" aria-label="Playbook-összesítő">
      <p className="font-semibold text-neutral-800">📋 {name}</p>
      <p className="text-[11px] text-neutral-500 mb-1.5">
        {checks.length} pontból: {order.filter(p => counts[p]).map(p => `${counts[p]} ${CHECK_LABELS[p].toLowerCase()}`).join(', ')}
      </p>
      <ul className="space-y-1">
        {checks.map(check => (
          <li key={check.rule} className="flex items-start justify-between gap-2">
            <span className="text-neutral-800">{check.topic}</span>
            <span className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium ${CHIP[check.position]}`}>{CHECK_LABELS[check.position]}</span>
          </li>
        ))}
      </ul>
      {counts.unchecked ? <p className="mt-1.5 text-[11px] text-neutral-500">A „Nem vizsgálta” pontokra az AI nem adott választ; a Másik változat vagy egy új futtatás pótolhatja.</p> : null}
    </section>
  );
}
