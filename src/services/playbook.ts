import type { ReviewFinding, Severity } from '../shared/aiConfig';
import { PLAYBOOK_POSITIONS, POSITION_LABELS, sanitizePlaybook, type Playbook, type PlaybookPosition, type PlaybookRule } from '../shared/playbook';

/**
 * The playbook check in the task pane: the own playbooks kept on this machine, the answer read back as one check per
 * rule, and the checks that need action turned into review findings, so they go through the same one-by-one
 * decision (Mutasd / Elfogadom / Elvetem) and tracked changes as any review.
 */

const STORAGE_KEY = 'word-writer-playbooks-v1';

export function loadOwnPlaybooks(): Playbook[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.flatMap((item, i) => {
      const playbook = sanitizePlaybook(item, `own-${i}`);
      return playbook ? [playbook] : [];
    }) : [];
  } catch {
    return [];
  }
}

export function saveOwnPlaybooks(playbooks: Playbook[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playbooks));
  } catch {
    // Private mode or full storage: kept for this session only
  }
}

export const newPlaybookId = () => `own-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const emptyRule = (rules: PlaybookRule[]): PlaybookRule => {
  let n = rules.length + 1;
  while (rules.some(r => r.id === `r${n}`)) n++;
  return { id: `r${n}`, topic: '', standard: '', fallback1: '', fallback2: '', walkAway: '', clause: '' };
};

/** What the check found for one rule; "unchecked": the answer left the rule out */
export interface PlaybookCheck {
  rule: string;
  topic: string;
  position: PlaybookPosition | 'unchecked';
  quote: string;
  comment: string;
  suggestion: string;
}

export const CHECK_LABELS: Record<PlaybookCheck['position'], string> = { ...POSITION_LABELS, unchecked: 'Nem vizsgálta' };

/** How serious a level is: the further from the standard, the higher */
export const POSITION_SEVERITY: Record<Exclude<PlaybookPosition, 'standard'>, Severity> = {
  fallback1: 'low',
  fallback2: 'medium',
  walkaway: 'high',
  missing: 'high',
};

/** One check per rule of the playbook, in its order; null when the answer is not the expected JSON */
export function parsePlaybookChecks(text: string, playbook: Playbook): PlaybookCheck[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  const list = Array.isArray(data) ? data : (data as { checks?: unknown })?.checks;
  if (!Array.isArray(list)) return null;
  const byRule = new Map<string, Record<string, unknown>>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rule = String((item as Record<string, unknown>).rule ?? '').replace(/[[\]\s]/g, '');
    if (rule && !byRule.has(rule)) byRule.set(rule, item as Record<string, unknown>);
  }
  const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  return playbook.rules.map(rule => {
    const found = byRule.get(rule.id);
    if (!found) return { rule: rule.id, topic: rule.topic, position: 'unchecked', quote: '', comment: '', suggestion: '' };
    const position = (PLAYBOOK_POSITIONS as readonly unknown[]).includes(found.position) ? found.position as PlaybookPosition : 'unchecked';
    return { rule: rule.id, topic: rule.topic, position, quote: str(found.quote), comment: str(found.comment), suggestion: str(found.suggestion) };
  });
}

/** A finding the pane can decide on, with the rule it came from */
export type PlaybookFinding = ReviewFinding & { topic: string; position: PlaybookPosition };

/** The checks that need action, worst first; a standard clause or an unchecked rule makes no finding */
export function playbookFindings(checks: PlaybookCheck[]): PlaybookFinding[] {
  const order: Record<PlaybookPosition, number> = { walkaway: 0, missing: 1, fallback2: 2, fallback1: 3, standard: 4 };
  return checks
    .filter((c): c is PlaybookCheck & { position: Exclude<PlaybookPosition, 'standard'> } => c.position !== 'standard' && c.position !== 'unchecked' && !!c.quote && !!c.comment)
    .sort((a, b) => order[a.position] - order[b.position])
    .map(c => ({
      quote: c.quote,
      comment: `${c.topic} (${POSITION_LABELS[c.position]}): ${c.comment}`,
      severity: POSITION_SEVERITY[c.position],
      suggestion: c.suggestion,
      topic: c.topic,
      position: c.position,
    }));
}

/** The changes written into the contract, for the cover letter: one line each, with its topic and reason */
export function coverLetterChanges(findings: { comment: string; suggestion: string; topic?: string; fixApplied: boolean }[]): string {
  return findings
    .map((f, i) => `${i + 1}. ${f.topic ? `${f.topic}: ` : ''}${f.comment.replace(/^[^:]*\([^)]*\):\s*/, '')}${f.fixApplied && f.suggestion ? `\n   Új szöveg: „${f.suggestion}”` : ''}`)
    .join('\n');
}

/**
 * A starting point, to be rewritten by the firm's lawyers: the format and the level of detail, not legal advice.
 * Offered once with "Minta betöltése" in the playbook editor.
 */
export const SAMPLE_PLAYBOOK: Playbook = {
  id: 'sample',
  name: 'MINTA – Ingatlan-adásvétel, vevői oldal',
  contractType: 'Ingatlan-adásvételi szerződés',
  side: 'Vevő',
  rules: [
    {
      id: 'r1', topic: 'Vételár megfizetése',
      standard: 'A vételár ügyvédi letétbe kerül, és csak a tulajdonjog bejegyzésére alkalmas okiratok átadása után fizethető ki az Eladónak.',
      fallback1: 'Részletfizetés, de az utolsó részlet (legalább 30%) csak a birtokbaadás után.',
      fallback2: 'Közvetlen fizetés az Eladónak, ha a tulajdonjog-fenntartás és a bejegyzési engedély letétbe kerül.',
      walkAway: 'A teljes vételár megfizetése a tulajdonjog bejegyzéséhez szükséges okiratok átadása előtt, biztosíték nélkül.',
      clause: 'A Vevő a vételárat a szerződés aláírásától számított 8 napon belül az ügyvédi letéti számlára fizeti meg. A letétkezelő a vételárat a tulajdonjog bejegyzésére alkalmas okiratok átadását követően utalja át az Eladónak.',
    },
    {
      id: 'r2', topic: 'Szavatosság, tehermentesség',
      standard: 'Az Eladó szavatol azért, hogy az Ingatlan per-, teher- és igénymentes, és ezt a tulajdoni lap az aláírás napján igazolja.',
      fallback1: 'A meglévő jelzálogjog a vételárból kerül kiváltásra, a bank törlési nyilatkozatával.',
      fallback2: '',
      walkAway: 'A Vevő tehermentesség nélkül, a terhek átvállalásával szerez tulajdont.',
      clause: 'Az Eladó szavatol azért, hogy az Ingatlan per-, teher- és igénymentes, és harmadik személynek nincs rajta olyan joga, amely a Vevő tulajdonszerzését vagy birtoklását akadályozza.',
    },
    {
      id: 'r3', topic: 'Foglaló',
      standard: 'Foglaló legfeljebb a vételár 10%-a, és az Eladónak felróható meghiúsulásnál kétszeresen jár vissza.',
      fallback1: 'Foglaló legfeljebb a vételár 20%-a.',
      fallback2: '',
      walkAway: 'A foglaló a vételár 20%-ánál több, vagy bármely meghiúsulás esetén elvész.',
      clause: '',
    },
    {
      id: 'r4', topic: 'Birtokbaadás',
      standard: 'Birtokbaadás a vételár teljes megfizetésekor, jegyzőkönyvvel, a közüzemi mérőállások rögzítésével.',
      fallback1: 'Birtokbaadás legfeljebb 30 nappal a teljes vételár megfizetése után.',
      fallback2: '',
      walkAway: 'A birtokbaadás időpontja nincs meghatározva.',
      clause: 'Az Eladó az Ingatlant a vételár teljes megfizetésének napján adja a Vevő birtokába. A birtokbaadásról a felek jegyzőkönyvet vesznek fel, amelyben rögzítik a közüzemi mérőórák állását.',
    },
    {
      id: 'r5', topic: 'Elállás, késedelem',
      standard: 'Az Eladó késedelme esetén a Vevő 15 napos póthatáridő után elállhat, és a megfizetett összeg 8 napon belül visszajár.',
      fallback1: '30 napos póthatáridő.',
      fallback2: '',
      walkAway: 'A Vevőnek nincs elállási joga az Eladó késedelme esetén.',
      clause: '',
    },
  ],
};
