import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChosenHunks, composeDocument, editHunks, planDocumentEdits, summarizeDocumentEdits } from './documentEdit';

const doc = ['Adásvételi szerződés', '', '1. Az Eladó eladja a Vevőnek az ingatlant.', '2. A vételár 45 000 000 Ft.', 'Kelt: Budapest'];

test('a signature block added at the end is only an insertion', () => {
  const ops = planDocumentEdits(doc, `${doc.filter(Boolean).join('\n')}\n\nBudapest, 2026. ….\n\n……………… Eladó\n……………… Vevő`);
  assert.deepEqual(ops, [{ type: 'insert', after: 4, texts: ['Budapest, 2026. ….', '……………… Eladó', '……………… Vevő'] }]);
});

test('an unchanged document needs nothing, blank lines do not count', () => {
  assert.deepEqual(planDocumentEdits(doc, doc.join('\n\n')), []);
});

test('a reworded paragraph becomes a word-level edit, a dropped one a deletion', () => {
  const ops = planDocumentEdits(doc, 'Adásvételi szerződés\n1. Az Eladó eladja a Vevőnek a lakást.\nKelt: Budapest');
  assert.equal(ops.length, 2);
  assert.deepEqual(ops[0], { type: 'edit', paragraph: 2, newText: '1. Az Eladó eladja a Vevőnek a lakást.', hunks: [{ oldStart: 6, oldEnd: 8, newTokens: ['a', 'lakást.'] }] });
  assert.deepEqual(ops[1], { type: 'delete', paragraph: 3 });
  assert.deepEqual(summarizeDocumentEdits(ops), { changed: 1, inserted: 0, deleted: 1 });
});

test('a new paragraph in the middle goes after the paragraph before it', () => {
  const ops = planDocumentEdits(doc, 'Adásvételi szerződés\n1. Az Eladó eladja a Vevőnek az ingatlant.\n1/A. Az ingatlan per-, teher- és igénymentes.\n2. A vételár 45 000 000 Ft.\nKelt: Budapest');
  assert.deepEqual(ops, [{ type: 'insert', after: 2, texts: ['1/A. Az ingatlan per-, teher- és igénymentes.'] }]);
});

test('a new title goes before the first paragraph', () => {
  const ops = planDocumentEdits(['Első bekezdés szövege.'], 'Cím\nElső bekezdés szövege.');
  assert.deepEqual(ops, [{ type: 'insert', after: -1, texts: ['Cím'] }]);
});

test('a sentence that only gained a clause is an edit, not a delete and an insert', () => {
  const ops = planDocumentEdits(['Első mondat.', 'Második mondat.', 'Harmadik mondat.'], 'Első mondat.\nMásodik mondat, pontosítva.\nHarmadik mondat.');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'edit');
});

test('an edit can be taken in part: the left-out places keep the original words', () => {
  const original = 'A megbizott köteles a munkát határidőre elvégezni.\nA díj 100 Ft.';
  const proposal = 'A Megbízott köteles a munkát határidőre, szakszerűen elvégezni.\nA díj 150 Ft.';
  const hunks = editHunks(original, proposal)!;
  assert.equal(hunks.count, 3);
  // Leave out the second change ("határidőre," + "szakszerűen")
  assert.equal(applyChosenHunks(original, proposal, new Set([1])), 'A Megbízott köteles a munkát határidőre elvégezni.\nA díj 150 Ft.');
  assert.equal(applyChosenHunks(original, proposal, new Set()), proposal);
  assert.equal(applyChosenHunks(original, proposal, new Set([0, 1, 2])), original);
});

test('a whole-document edit can be taken in part', () => {
  const doc = ['Cím', 'Első.', 'Második mondat.', 'Harmadik.'];
  const ops = planDocumentEdits(doc, 'Cím\nElső.\nMásodik mondat, pontosítva.\nHarmadik.\nAláírás');
  assert.equal(ops.length, 2);
  assert.equal(composeDocument(doc, ops, new Set([1])), 'Cím\nElső.\nMásodik mondat, pontosítva.\nHarmadik.');
  assert.deepEqual(planDocumentEdits(doc, composeDocument(doc, ops, new Set([0]))), [ops[1]]);
});
