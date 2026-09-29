import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentContext } from './contextBuilder';

const base = { selectionStart: 0, selectionLength: 0, headings: [] as string[], limit: 1000 };

test('short documents are sent whole, with \\r turned into line breaks', () => {
  const { text, info } = buildDocumentContext({ ...base, documentText: 'Első\rMásodik' });
  assert.equal(text, 'Első\nMásodik');
  assert.equal(info.strategy, 'full');
});

test('empty documents send nothing', () => {
  assert.equal(buildDocumentContext({ ...base, documentText: '' }).info.strategy, 'empty');
});

test('whole-document review of a long document is truncated to the limit', () => {
  const { text, info } = buildDocumentContext({ ...base, documentText: 'x'.repeat(5000), wholeDocument: true });
  assert.equal(text.length, 1000);
  assert.equal(info.strategy, 'truncated');
});

test('long documents send the beginning, the headings and the selection with its surroundings', () => {
  const documentText = 'B'.repeat(20000) + 'SELECTED' + 'A'.repeat(20000);
  const { text, info } = buildDocumentContext({
    documentText,
    selectionStart: 20000,
    selectionLength: 8,
    headings: ['1. Felek', '2. Tárgy'],
    limit: 10000,
  });
  assert.equal(info.strategy, 'excerpts');
  assert.ok(text.length <= 10000);
  assert.ok(text.includes('=== DOCUMENT BEGINNING'));
  assert.ok(text.includes('- 1. Felek\n- 2. Tárgy'));
  assert.ok(text.includes('SELECTED'));
  assert.equal(info.headingCount, 2);
  assert.ok(info.windowStart! < 20000 && info.windowEnd! > 20008);
  // 60% of the window goes before the selection
  assert.ok(20000 - info.windowStart! > info.windowEnd! - 20008);
});

test('a selection near the start merges the beginning into the window', () => {
  const { text, info } = buildDocumentContext({ ...base, documentText: 'x'.repeat(50000), selectionStart: 100, selectionLength: 10, limit: 10000 });
  assert.equal(info.windowStart, 0);
  assert.equal(info.beginningChars, 0);
  assert.ok(!text.includes('=== DOCUMENT BEGINNING'));
  assert.ok(text.length <= 10000);
});

test('a selection at the very end shifts the unused budget before it', () => {
  const { info } = buildDocumentContext({ ...base, documentText: 'x'.repeat(50000), selectionStart: 49990, selectionLength: 10, limit: 10000 });
  assert.equal(info.windowEnd, 50000);
  assert.ok(info.windowEnd! - info.windowStart! > 7000);
});
