import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentGraph } from './structure';
import { cleanParty, partySuggestions } from './parties';

const suggestionsFor = (texts: string[]) => partySuggestions(buildDocumentGraph(texts.map(text => ({ text }))), texts);

test('parties are the terms defined after identification data, then known party names in the text', () => {
  const contract = [
    'ADÁSVÉTELI SZERZŐDÉS',
    'amely létrejött az ABC Kft. (székhely: 1111 Budapest, Fő utca 1.; cégjegyzékszám: 01-09-123456; a továbbiakban: Eladó), valamint',
    'Kiss Péter (születési hely, idő: Budapest, 1980. 01. 01.; a továbbiakban: Vevő; a továbbiakban együtt: Felek) között.',
    'Az Eladó eladja a Budapest 12345 hrsz. alatti ingatlant (a továbbiakban: Ingatlan) a Vevőnek.',
    'A Kezes a Vevő tartozásáért kezességet vállal.',
  ];
  // The property ("Ingatlan") and the collective name ("Felek") are not parties
  assert.deepEqual(suggestionsFor(contract), ['Eladó', 'Vevő', 'Kezes']);
});

test('an English contract and a document without parties', () => {
  assert.deepEqual(suggestionsFor(['This Agreement is made between ABC Ltd. (registered office: London) (the "Licensor") and the Licensee.']), ['Licensor', 'Licensee']);
  assert.deepEqual(suggestionsFor(['Emlékeztető a tárgyalásról.']), []);
});

test('the party is one short line', () => {
  assert.equal(cleanParty('  Vevő\n(és a zálogkötelezett)  '), 'Vevő (és a zálogkötelezett)');
  assert.equal(cleanParty('x'.repeat(300)).length, 100);
});
