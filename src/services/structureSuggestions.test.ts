import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentGraph } from './structure';
import { requestForDefinitionsSection, requestForIssue } from './structureSuggestions';

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
