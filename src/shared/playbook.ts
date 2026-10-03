/**
 * The firm's playbook: per clause type, the position the firm wants (standard), the compromises it accepts
 * (Fallback 1, Fallback 2) and what it never accepts (walk-away). Shared by the task pane (editor, results) and the
 * server (it checks what arrives and writes it into the prompt). The content is written by lawyers.
 */

export const PLAYBOOK_POSITIONS = ['standard', 'fallback1', 'fallback2', 'walkaway', 'missing'] as const;
export type PlaybookPosition = typeof PLAYBOOK_POSITIONS[number];

export const POSITION_LABELS: Record<PlaybookPosition, string> = {
  standard: 'Standard',
  fallback1: 'Fallback 1',
  fallback2: 'Fallback 2',
  walkaway: 'Elfogadhatatlan',
  missing: 'Hiányzik',
};

export interface PlaybookRule {
  /** Short stable id inside the playbook ("r1") */
  id: string;
  /** The clause type: "Felelősségkorlátozás", "Kötbér" */
  topic: string;
  /** The firm's standard position, in words */
  standard: string;
  /** First acceptable compromise */
  fallback1: string;
  /** Last acceptable compromise */
  fallback2: string;
  /** What must never be accepted */
  walkAway: string;
  /** Model wording of the clause in the standard position, proposed when the clause is missing or worse */
  clause: string;
}

export interface Playbook {
  id: string;
  name: string;
  /** "Ingatlan-adásvétel", "NDA"; free text */
  contractType: string;
  /** Whose side the playbook is written for ("Vevő"); empty: the party set in the task pane */
  side: string;
  rules: PlaybookRule[];
}

export const MAX_PLAYBOOK_RULES = 30;
export const MAX_PLAYBOOK_NAME = 60;
const MAX_SHORT = 100;
const MAX_POSITION = 1000;
const MAX_CLAUSE = 2000;

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '';

/**
 * A playbook as it may be used: every field checked and cut to its limit, rules without a topic or a standard left
 * out. null when nothing usable is left. Used on everything that comes from storage, a file, the server or a request.
 */
export function sanitizePlaybook(value: unknown, fallbackId = 'playbook'): Playbook | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const name = text(v.name, MAX_PLAYBOOK_NAME);
  const rules: PlaybookRule[] = [];
  for (const raw of Array.isArray(v.rules) ? v.rules : []) {
    if (rules.length >= MAX_PLAYBOOK_RULES) break;
    const r = (raw ?? {}) as Record<string, unknown>;
    const topic = text(r.topic, MAX_SHORT);
    const standard = text(r.standard, MAX_POSITION);
    if (!topic || !standard) continue;
    const id = typeof r.id === 'string' && /^[\w-]{1,20}$/.test(r.id) && !rules.some(x => x.id === r.id) ? r.id : `r${rules.length + 1}`;
    rules.push({
      id,
      topic,
      standard,
      fallback1: text(r.fallback1, MAX_POSITION),
      fallback2: text(r.fallback2, MAX_POSITION),
      walkAway: text(r.walkAway, MAX_POSITION),
      clause: text(r.clause, MAX_CLAUSE),
    });
  }
  if (!name || !rules.length) return null;
  const id = typeof v.id === 'string' && /^[\w-]{1,80}$/.test(v.id) ? v.id : fallbackId;
  return { id, name, contractType: text(v.contractType, MAX_SHORT), side: text(v.side, MAX_SHORT), rules };
}

/** The playbook as the model reads it: one block per rule, under its id */
export function formatPlaybook(playbook: Playbook): string {
  const head = [`PLAYBOOK: ${playbook.name}`, playbook.contractType && `Contract type: ${playbook.contractType}`, playbook.side && `Written for: ${playbook.side}`]
    .filter(Boolean)
    .join('\n');
  const rules = playbook.rules.map(rule => [
    `[${rule.id}] ${rule.topic}`,
    `  Standard: ${rule.standard}`,
    rule.fallback1 && `  Fallback 1: ${rule.fallback1}`,
    rule.fallback2 && `  Fallback 2: ${rule.fallback2}`,
    rule.walkAway && `  Walk-away (never acceptable): ${rule.walkAway}`,
    rule.clause && `  Model clause (standard position): ${rule.clause}`,
  ].filter(Boolean).join('\n'));
  return `${head}\n\n${rules.join('\n\n')}`;
}

/** The file the "Exportálás" button saves and "Importálás" reads; the same file can be the server's PLAYBOOKS_FILE */
export interface PlaybooksFile {
  app: 'word-writer';
  kind: 'playbooks';
  version: 1;
  playbooks: Omit<Playbook, 'id'>[];
}

export const playbooksFile = (playbooks: Playbook[]): PlaybooksFile => ({
  app: 'word-writer', kind: 'playbooks', version: 1, playbooks: playbooks.map(({ id: _id, ...rest }) => rest),
});

/** The valid playbooks of a file (or the server's list); prefix: the id prefix ("own", "office") */
export function readPlaybooksFile(data: unknown, prefix: string): { playbooks: Playbook[]; skipped: number } {
  const list = Array.isArray(data) ? data : Array.isArray((data as PlaybooksFile | null)?.playbooks) ? (data as PlaybooksFile).playbooks : [];
  const playbooks: Playbook[] = [];
  let skipped = 0;
  list.forEach((item: unknown, i: number) => {
    const playbook = sanitizePlaybook(item, `${prefix}-${i}`);
    if (playbook) playbooks.push({ ...playbook, id: `${prefix}-${i}-${playbook.name}`.slice(0, 80).replace(/[^\w-]/g, '_') });
    else skipped++;
  });
  return { playbooks, skipped };
}
