import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentGraph } from './structure';
import { newIssues, recheckInstruction, requestForDefinitionsSection, requestForIssue } from './structureSuggestions';
import { MAX_INSTRUCTION_CHARS } from '../shared/aiConfig';

const paragraphs = [
  { text: 'MEGBÍZÁSI SZERZŐDÉS' },
  { text: 'amely létrejött az ABC Kft. (a továbbiakban: Megbízó) és az XYZ Zrt. (a továbbiakban: Megbízott) között.' },
  { text: 'Határidők', listString: '1.', listLevel: 0 },
  { text: 'A Megbízott a 7.3. pont szerint teljesít, a Megbízó utasításai alapján.', listString: '1.', listLevel: 1 },
];

test('a broken reference asks for a fix and lists the sections that exist', () => {
  const graph = buildDocumentGraph(paragraphs);
  const issue = graph.issues.find(i => i.kind === 'broken-reference')!;
  const request = requestForIssue(issue, graph)!;
  assert.equal(request.paragraph, 3);
  assert.equal(request.mode, 'edit');
  assert.equal(request.cursor, 'select');
  assert.match(request.instruction, /„7\.3\. pont” hivatkozás/);
  assert.match(request.instruction, /- 1\.1\. pont/);
});

test('the definitions section goes before the first numbered section and lists the terms', () => {
  const request = requestForDefinitionsSection(buildDocumentGraph(paragraphs), paragraphs.length);
  assert.equal(request.mode, 'generate');
  // At the end of the preamble, not in front of the numbered section
  assert.equal(request.cursor, 'after');
  assert.equal(request.paragraph, 1);
  assert.ok(request.instruction.indexOf('„Megbízó”') < request.instruction.indexOf('„Megbízott”'));
});

test('only problems that were not there before count as new, even when paragraphs moved', () => {
  const issue = (kind: 'unused' | 'broken-reference', subject: string, paragraph: number) => ({ kind, subject, message: subject, at: { paragraph, start: 0, end: 1 } });
  const before = [issue('unused', 'Munka', 3), issue('broken-reference', '7.3. pont', 5)];
  const after = [issue('unused', 'Munka', 4), issue('broken-reference', '7.3. pont', 6), issue('broken-reference', '4.1. pont', 8)];
  assert.deepEqual(newIssues(before, after).map(i => i.subject), ['4.1. pont']);
});

test('the recheck instruction lists the decisions and stays within the limit', () => {
  const f = (comment: string) => ({ quote: 'q', comment, severity: 'medium' as const, suggestion: '' });
  const text = recheckInstruction([f('A vételár ellentmondásos.')], [f('A határidő hiányzik.')]);
  assert.match(text, /fogadtam el[^]*A vételár ellentmondásos\.[^]*elvetettem:\n- A határidő hiányzik\./);
  const long = recheckInstruction(Array.from({ length: 15 }, () => f('x'.repeat(300))), Array.from({ length: 15 }, () => f('y'.repeat(300))));
  assert.ok(long.length <= MAX_INSTRUCTION_CHARS);
});
