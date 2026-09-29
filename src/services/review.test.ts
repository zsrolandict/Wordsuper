import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFindings, searchCandidates } from './review';

test('parseFindings keeps valid findings and defaults the severity', () => {
  const findings = parseFindings('```json\n[{"quote":"a határidő","comment":"Hiányzik a kötbér.","severity":"high"},{"quote":"x","comment":"y","severity":"weird"},{"quote":"","comment":"nincs hely"}]\n```');
  assert.deepEqual(findings, [
    { quote: 'a határidő', comment: 'Hiányzik a kötbér.', severity: 'high' },
    { quote: 'x', comment: 'y', severity: 'medium' },
  ]);
});

test('parseFindings rejects non-lists', () => {
  assert.equal(parseFindings('{"quote":"a"}'), null);
  assert.equal(parseFindings('nem json'), null);
});

test('searchCandidates strips quotes, shortens and escapes carets', () => {
  assert.deepEqual(
    searchCandidates('„A Megbízott köteles a megbízás tárgyát képező feladatot   határidőn belül teljesíteni.”'),
    [
      'A Megbízott köteles a megbízás tárgyát képező feladatot határidőn belül teljesíteni.',
      'A Megbízott köteles a megbízás tárgyát képező feladatot',
      'A Megbízott köteles a',
    ]
  );
  assert.deepEqual(searchCandidates('2^10 bájt'), ['2^^10 bájt']);
  assert.deepEqual(searchCandidates('ab'), []);
});
