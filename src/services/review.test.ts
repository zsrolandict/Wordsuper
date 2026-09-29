import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFindings, reviewCommentText, reviewFix, searchCandidates } from './review';
import { splitExplanation } from '../shared/aiConfig';

test('parseFindings keeps valid findings and defaults the severity', () => {
  const findings = parseFindings('```json\n[{"quote":"a határidő","comment":"Hiányzik a kötbér.","severity":"high"},{"quote":"x","comment":"y","severity":"weird"},{"quote":"","comment":"nincs hely"}]\n```');
  assert.deepEqual(findings, [
    { quote: 'a határidő', comment: 'Hiányzik a kötbér.', severity: 'high', suggestion: '' },
    { quote: 'x', comment: 'y', severity: 'medium', suggestion: '' },
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

test('searchCandidates also tries the sentences of a quote that spans two paragraphs', () => {
  const candidates = searchCandidates('fizeti meg. A Megbízott felelőssége korlátlan.');
  assert.ok(candidates.includes('A Megbízott felelőssége korlátlan.'));
  // The longer sentence comes before the shorter one
  assert.ok(candidates.indexOf('A Megbízott felelőssége korlátlan.') < candidates.indexOf('fizeti meg.'));
});

const finding = (quote: string, suggestion: string) => ({ quote, comment: 'Ellentmondás.', severity: 'high' as const, suggestion });

test('reviewFix replaces the whole quote, without doubling wrapping quotation marks', () => {
  assert.deepEqual(reviewFix(finding('„A vételár 40 000 000 Ft.”', '„A vételár 45 000 000 Ft.”')), { search: 'A vételár 40 000 000 Ft.', replacement: 'A vételár 45 000 000 Ft.' });
  assert.equal(reviewFix(finding('A vételár 40 000 000 Ft.', '')), null);
  assert.equal(reviewFix(finding('A vételár 40 000 000 Ft.', 'A vételár 40 000 000 Ft.')), null);
  assert.equal(reviewFix(finding('x'.repeat(300), 'y')), null);
});

test('the proposed wording goes into the comment when it is not written into the text', () => {
  const f = finding('A vételár 40 000 000 Ft.', 'A vételár 45 000 000 Ft.');
  assert.equal(reviewCommentText(f, true), 'Ellentmondás.');
  assert.equal(reviewCommentText(f, false), 'Ellentmondás.\nJavasolt szöveg: „A vételár 45 000 000 Ft.”');
});

test('an edit answer is split into the new text and the explanation', () => {
  assert.deepEqual(splitExplanation('Új szöveg.\n===WHY===\nMert így pontos.'), { text: 'Új szöveg.', explanation: 'Mert így pontos.' });
  assert.deepEqual(splitExplanation('Új szöveg.'), { text: 'Új szöveg.', explanation: '' });
  assert.deepEqual(splitExplanation('Új szöveg.\n===WH', true), { text: 'Új szöveg.', explanation: '' });
  assert.deepEqual(splitExplanation('A = B', true), { text: 'A = B', explanation: '' });
});
