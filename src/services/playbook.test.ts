import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPlaybook, playbooksFile, readPlaybooksFile, sanitizePlaybook, MAX_PLAYBOOK_RULES } from '../shared/playbook';
import { coverLetterChanges, parsePlaybookChecks, playbookFindings, SAMPLE_PLAYBOOK, SAMPLE_PLAYBOOKS } from './playbook';

test('playbook: checked field by field, rules without topic or standard left out, ids made unique', () => {
  assert.equal(sanitizePlaybook(null), null);
  assert.equal(sanitizePlaybook({ name: 'X', rules: [] }), null);
  assert.equal(sanitizePlaybook({ name: '', rules: [{ topic: 'A', standard: 'B' }] }), null);
  const p = sanitizePlaybook({
    id: 'own-1', name: '  NDA  ', contractType: 'NDA', side: 7,
    rules: [
      { id: 'r1', topic: 'Titoktartás', standard: 'Öt év.', fallback1: 'Három év.' },
      { id: 'r1', topic: 'Kötbér', standard: 'Nincs.', walkAway: 'Korlátlan.' },
      { topic: 'Üres standard', standard: '  ' },
      { id: 'bad id!', topic: 'Joghatóság', standard: 'Budapest' },
    ],
  })!;
  assert.equal(p.name, 'NDA');
  assert.equal(p.side, '');
  assert.deepEqual(p.rules.map(r => r.id), ['r1', 'r2', 'r3']);
  assert.equal(p.rules[1].walkAway, 'Korlátlan.');
  assert.equal(p.rules[0].clause, '');
  const many = sanitizePlaybook({ name: 'Sok', rules: Array.from({ length: 50 }, (_, i) => ({ topic: `T${i}`, standard: 'S' })) })!;
  assert.equal(many.rules.length, MAX_PLAYBOOK_RULES);
});

test('playbook: the prompt block names every rule by its id with its levels', () => {
  const text = formatPlaybook(SAMPLE_PLAYBOOK);
  assert.match(text, /^PLAYBOOK: MINTA/);
  assert.match(text, /Written for: Vevő/);
  assert.match(text, /\[r1\] Vételár megfizetése\n {2}Standard: .*ügyvédi letét/);
  assert.match(text, /Walk-away \(never acceptable\): A foglaló/);
  // An empty level is left out, not sent as an empty line
  assert.doesNotMatch(text, /Fallback 2: \n/);
});

test('playbook file: export and import give the same playbooks, damaged ones counted', () => {
  const file = playbooksFile([SAMPLE_PLAYBOOK]);
  assert.equal(file.kind, 'playbooks');
  assert.equal('id' in file.playbooks[0], false);
  const { playbooks, skipped } = readPlaybooksFile({ ...file, playbooks: [...file.playbooks, { name: 'rossz' }] }, 'import');
  assert.equal(skipped, 1);
  assert.equal(playbooks[0].rules.length, SAMPLE_PLAYBOOK.rules.length);
  assert.match(playbooks[0].id, /^import-0-/);
  assert.deepEqual(readPlaybooksFile('nonsense', 'x'), { playbooks: [], skipped: 0 });
});

test('playbook answer: one check per rule in playbook order, a left-out rule marked unchecked', () => {
  const answer = JSON.stringify({ checks: [
    { rule: 'r3', position: 'walkaway', quote: 'a foglaló 30%', comment: 'Túl magas.', suggestion: 'a foglaló 10%' },
    { rule: '[r1]', position: 'standard', quote: 'letétbe', comment: 'Rendben.', suggestion: '' },
    { rule: 'r2', position: 'nonsense', quote: 'x', comment: 'y', suggestion: '' },
    { rule: 'r9', position: 'missing', quote: 'q', comment: 'kitalált szabály', suggestion: '' },
  ] });
  const checks = parsePlaybookChecks(answer, SAMPLE_PLAYBOOK)!;
  assert.deepEqual(checks.map(c => [c.rule, c.position]), [['r1', 'standard'], ['r2', 'unchecked'], ['r3', 'walkaway'], ['r4', 'unchecked'], ['r5', 'unchecked']]);
  assert.equal(checks[2].topic, 'Foglaló');
  assert.equal(parsePlaybookChecks('not json', SAMPLE_PLAYBOOK), null);
  assert.equal(parsePlaybookChecks('{"other":1}', SAMPLE_PLAYBOOK), null);
});

test('playbook findings: only what needs action, worst first, severity from the level, topic in the comment', () => {
  const base = { quote: 'q', comment: 'c', suggestion: '' };
  const findings = playbookFindings([
    { rule: 'r1', topic: 'Vételár', position: 'fallback1', ...base },
    { rule: 'r2', topic: 'Szavatosság', position: 'standard', ...base },
    { rule: 'r3', topic: 'Foglaló', position: 'walkaway', ...base, suggestion: 'új' },
    { rule: 'r4', topic: 'Birtok', position: 'missing', ...base },
    { rule: 'r5', topic: 'Elállás', position: 'unchecked', ...base },
    { rule: 'r6', topic: 'Kötbér', position: 'fallback2', ...base, quote: '' },
  ]);
  assert.deepEqual(findings.map(f => [f.topic, f.severity]), [['Foglaló', 'high'], ['Birtok', 'high'], ['Vételár', 'low']]);
  assert.equal(findings[0].comment, 'Foglaló (Elfogadhatatlan): c');
  assert.equal(findings[0].suggestion, 'új');
});

test('cover letter input: topic, reason, and the new wording only where it was written in', () => {
  const text = coverLetterChanges([
    { topic: 'Foglaló', comment: 'Foglaló (Elfogadhatatlan): A 30% túl magas, 10%-ra csökkentettük.', suggestion: 'a foglaló 10%', fixApplied: true },
    { topic: 'Birtok', comment: 'Birtok (Hiányzik): Hiányzik a birtokbaadás.', suggestion: 'új pont', fixApplied: false },
  ]);
  assert.equal(text, '1. Foglaló: A 30% túl magas, 10%-ra csökkentettük.\n   Új szöveg: „a foglaló 10%”\n2. Birtok: Hiányzik a birtokbaadás.');
});

test('the sample playbooks are whole after the checks (nothing cut, nothing dropped)', () => {
  for (const sample of SAMPLE_PLAYBOOKS) {
    assert.deepEqual(sanitizePlaybook(sample), sample, sample.name);
  }
  assert.equal(new Set(SAMPLE_PLAYBOOKS.map(p => p.id)).size, SAMPLE_PLAYBOOKS.length);
});
