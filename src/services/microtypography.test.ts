import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NBSP, countMicrotypography, dashFixes, englishQuoteFixes, markdownFixes, nbspFixes, punctuationFixes, quoteFixes, rangeFixes } from './microtypography';

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

test('dashes: em dash, double hyphen and a spaced hyphen become a spaced en dash', () => {
  assert.deepEqual(dashFixes('A Vevő—a jelen szerződés szerint — fizet -- vagy nem - ahogy'), [
    { find: ' -- ', replace: ' – ' },
    { find: ' — ', replace: ' – ' },
    { find: ' - ', replace: ' – ' },
    { find: '—', replace: ' – ' },
  ]);
  assert.deepEqual(dashFixes('— felsorolás'), [{ find: '— ', replace: '– ' }]);
  assert.deepEqual(dashFixes('adás-vétel, Rt.-vel'), [], 'a hyphen inside a word stays');
});

test('ranges: two plain numbers, the first smaller; phone numbers, dates, accounts stay', () => {
  assert.deepEqual(rangeFixes('2020-2025 között, az 5-10. pontban'), [
    { find: '2020-2025', replace: '2020–2025' },
    { find: '5-10.', replace: '5–10.' },
  ]);
  assert.deepEqual(rangeFixes('Tel.: 06-30-123-4567, 2026-10-03, 12345678-12345678, 01-09-123456, 06-30, 10-5'), []);
});

test('punctuation spacing, but not in numbers, abbreviations or e-mail addresses', () => {
  assert.deepEqual(punctuationFixes('A Vevő , az Eladó ;és a Bank:a felek.Zárás !'), [
    { find: 'Eladó ;és', replace: 'Eladó; és' },
    { find: 'Zárás !', replace: 'Zárás!' },
    { find: 'Vevő ,', replace: 'Vevő,' },
    { find: 'Bank:a', replace: 'Bank: a' },
  ]);
  assert.deepEqual(punctuationFixes('Ptk. 6:98. §, 1,5 %, info@ict.hu,kapcsolat'), []);
});

test('Markdown left in pasted AI text', () => {
  assert.deepEqual(markdownFixes('## A szerződés tárgya'), { replacements: [{ find: '## A szerződés tárgya', replace: 'A szerződés tárgya' }], bold: [], italic: [] });
  assert.deepEqual(markdownFixes('- első pont'), { replacements: [{ find: '- első pont', replace: '– első pont' }], bold: [], italic: [] });
  assert.deepEqual(markdownFixes('A **Vevő** köteles *haladéktalanul* fizetni, 5 * 3, 2*'), { replacements: [], bold: ['Vevő'], italic: ['haladéktalanul'] });
  assert.deepEqual(englishQuoteFixes('“Vevő”'), [{ find: '“', replace: '„' }]);
});
