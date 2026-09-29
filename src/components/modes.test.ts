import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeReview, matchPreset } from './modes';

const own = [{ mode: 'edit' as const, label: 'Fordítsd angolra' }, { mode: 'review' as const, label: 'GDPR ellenőrzés' }];

test('a typed quick button is recognized, case and final punctuation aside', () => {
  assert.deepEqual(matchPreset('  fordítsd   angolra. ', 'edit', own), { label: 'Fordítsd angolra', mode: 'edit', custom: true });
  assert.deepEqual(matchPreset('Tedd hivatalosabbá', 'edit', own), { label: 'Tedd hivatalosabbá', mode: 'edit', custom: false });
  assert.equal(matchPreset('Tedd hivatalosabbá és rövidebbé', 'edit', own), null);
});

test('an own quick button of another mode runs in its mode', () => {
  assert.deepEqual(matchPreset('gdpr ellenőrzés', 'edit', own), { label: 'GDPR ellenőrzés', mode: 'review', custom: true });
});

test('a request to go through the whole document is recognized as a review', () => {
  assert.ok(looksLikeReview('Nézd át az egész dokumentumot, van-e benne ellentmondás'));
  assert.ok(looksLikeReview('van-e benne ellentmondás?'));
  assert.ok(looksLikeReview('Vizsgáld át a teljes szerződést'));
  assert.ok(!looksLikeReview('Tedd hivatalosabbá'));
  assert.ok(!looksLikeReview('Javítsd a helyesírást a teljes bekezdésben'));
});
