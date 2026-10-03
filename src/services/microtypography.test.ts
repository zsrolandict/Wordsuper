import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NBSP, countMicrotypography, nbspFixes, quoteFixes } from './microtypography';

const n = (s: string) => s.replace(/ /g, NBSP);

test('non-breaking spaces: section signs, laws, dates, amounts', () => {
  const text = 'A Ptk. § 5 és a 2013. évi V. törvény szerint 2026. október 3. napjáig 1 250 000 Ft és 500 EUR jár, 30 nap alatt.';
  assert.deepEqual(nbspFixes(text), [
    { find: '§ 5', replace: n('§ 5') },
    { find: '2013. évi V. törvény', replace: n('2013. évi V. törvény') },
    { find: '2026. október 3.', replace: n('2026. október 3.') },
    { find: '1 250 000 Ft', replace: n('1 250 000 Ft') },
    { find: '500 EUR', replace: n('500 EUR') },
  ]);
  assert.deepEqual(nbspFixes('30 nap, 3 Ftos, 12 34 Ft'), [], 'no currency, a word going on, not a thousands group');
  assert.deepEqual(nbspFixes(n('§ 5 és 100 Ft')), [], 'already non-breaking');
});

test('quotes: opening at the start or after a space or bracket, closing otherwise', () => {
  assert.deepEqual(quoteFixes('"Vevő" (a továbbiakban: "Eladó")'), ['„', '”', '„', '”']);
  assert.deepEqual(quoteFixes('„Vevő”'), []);
  assert.deepEqual(countMicrotypography(['§ 5 "a"', '100 Ft']), { nbsp: 2, quotes: 2 });
});
