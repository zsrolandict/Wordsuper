import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountIssues, numberingIssues, parseHungarianNumber, partyNameIssues, shareIssues } from './consistency';
import { buildDocumentGraph, sectionLabels, type ParagraphInfo } from './structure';

const paras = (...texts: string[]): ParagraphInfo[] => texts.map(text => ({ text }));

test('Hungarian number words', () => {
  assert.equal(parseHungarianNumber('huszonhatmillió'), 26_000_000);
  assert.equal(parseHungarianNumber('egymillió-kétszázötvenezer'), 1_250_000);
  assert.equal(parseHungarianNumber('százötven'), 150);
  assert.equal(parseHungarianNumber('kétmilliárd-háromszázmillió'), 2_300_000_000);
  assert.equal(parseHungarianNumber('ezerkilencszázkilencvenkilenc'), 1999);
  assert.equal(parseHungarianNumber('tizenkettő'), 12);
  assert.equal(parseHungarianNumber('Vevő'), null);
});

test('amounts: figures and words must agree', () => {
  assert.deepEqual(amountIssues(paras(
    'bruttó 26.000.000.- Ft, azaz huszonhatmillió forint összegben',
    'a vételár 25.000.000,- Ft, azaz huszonhatmillió forint',
    'foglaló 1 250 000 Ft (azaz egymillió-kétszázötvenezer forint)',
    'előleg 500 EUR (ötszáz euró)',
    'előleg 600 EUR (ötszáz euró)',
  )).map(i => [i.at.paragraph, i.message]), [
    [1, 'Az összeg számmal 25 000 000, betűvel 26 000 000 („huszonhatmillió”) – a kettő eltér.'],
    [4, 'Az összeg számmal 600, betűvel 500 („ötszáz”) – a kettő eltér.'],
  ]);
});

test('shares listed together must add up to one; a lone 1/1 and a hrsz are no list', () => {
  const ok = 'Vevő1 7/10 és Vevő2 3/10 arányú tulajdonába kerül Eladó 1/1 arányú tulajdonjogának törlésével, 1234/5 hrsz.';
  assert.deepEqual(shareIssues(paras(ok)), []);
  const wrong = shareIssues(paras('Vevő1 7/10-ed és Vevő2 2/10-ed arányban szerez tulajdont.', 'a felek 1/2-1/3 arányban'));
  assert.deepEqual(wrong.map(i => i.message), [
    'A tulajdoni hányadok összege 9/10, nem 1 (7/10 + 2/10).',
    'A tulajdoni hányadok összege 5/6, nem 1 (1/2 + 1/3).',
  ]);
  assert.deepEqual(shareIssues(paras('EP/3118-13/2022 számú határozat, tulajdoni lap')), []);
});

test('party names: a defined singular used in the plural', () => {
  const paragraphs = paras(
    'ABC Kft. (a továbbiakban: Eladó) és Kovács János (a továbbiakban: Vevő)',
    'Eladók eladják, Vevők megvásárolják az Ingatlant.',
    'A Vevő fizet, a Vevőknek jár.',
  );
  const graph = buildDocumentGraph(paragraphs);
  const issues = partyNameIssues(paragraphs, graph.terms);
  assert.deepEqual(issues.map(i => [i.subject, i.at.paragraph, i.message]), [
    ['Eladó', 1, 'A definiált fogalom „Eladó” (egyes szám), de 1 helyen „Eladók” alakban szerepel (többes számban).'],
    ['Vevő', 1, 'A definiált fogalom „Vevő” (egyes szám), de 2 helyen „Vevők” alakban szerepel (többes számban).'],
  ]);
  assert.ok(graph.issues.some(i => i.kind === 'party-name'), 'part of the structure issues');
});

test('numbering: typed among automatic, skipped, repeated, a level skipped; dates are no numbers', () => {
  const paragraphs: ParagraphInfo[] = [
    { text: 'Fogalmak', listString: '1.', listLevel: 0 },
    { text: 'Első', listString: '1.1.', listLevel: 1 },
    { text: 'Harmadik', listString: '1.3.', listLevel: 1 },
    { text: '2. Kézzel írt pont' },
    { text: '2026. október 3. napján' },
    { text: 'Vételár', listString: '3.', listLevel: 0 },
    { text: 'Mélyebb', listString: '3.1.1.', listLevel: 2 },
    { text: 'Ismét', listString: '3.', listLevel: 0 },
  ];
  const messages = numberingIssues(paragraphs, sectionLabels(paragraphs), () => false).map(i => i.message);
  assert.deepEqual(messages, [
    'Kimaradt a „1.2.” pont (a 1.1. után a 1.3. jön).',
    'A „2.” pontszám kézzel van beírva, a többi automatikus számozás: ha a pontok sorrendje változik, ez nem követi.',
    'A „3.1.1.” pont előtt nincs „3.1.” pont: kimaradt egy szint.',
    'A „3.” pontszám kétszer szerepel.',
  ]);
});
