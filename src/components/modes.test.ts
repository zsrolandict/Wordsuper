import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPreset } from './modes';

const own = [{ mode: 'edit' as const, label: 'Fordítsd angolra' }, { mode: 'review' as const, label: 'GDPR ellenőrzés' }];

test('a typed quick button is recognized, case and final punctuation aside', () => {
  assert.deepEqual(matchPreset('  fordítsd   angolra. ', 'edit', own), { label: 'Fordítsd angolra', mode: 'edit', custom: true });
  assert.deepEqual(matchPreset('Tedd hivatalosabbá', 'edit', own), { label: 'Tedd hivatalosabbá', mode: 'edit', custom: false });
  assert.equal(matchPreset('Tedd hivatalosabbá és rövidebbé', 'edit', own), null);
});

test('an own quick button of another mode runs in its mode', () => {
  assert.deepEqual(matchPreset('gdpr ellenőrzés', 'edit', own), { label: 'GDPR ellenőrzés', mode: 'review', custom: true });
});
