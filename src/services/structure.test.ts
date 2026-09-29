import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentGraph, findAt, sectionPreview, termPattern, type ParagraphInfo } from './structure';

const contract: ParagraphInfo[] = [
  { text: 'MEGBÍZÁSI SZERZŐDÉS' },                                                                                  // 0
  { text: 'amely létrejött az ABC Kft. (székhely: 1111 Budapest, Fő utca 1.; a továbbiakban: Megbízó), valamint' }, // 1
  { text: 'az XYZ Zrt. (a továbbiakban: „Megbízott”; a továbbiakban együtt: Felek, külön-külön: Fél) között.' },     // 2
  { text: 'Fogalmak', listString: '1.' },                                                                         // 3
  { text: '„Munka”: jelenti a 2. számú mellékletben leírt feladatokat.', listString: '1.1.' },                     // 4
  { text: '„Titoktartási Időszak” alatt a szerződés megszűnését követő 3 év értendő.', listString: '1.2.' },       // 5
  { text: 'A Megbízott feladatai', listString: '2.' },                                                            // 6
  { text: 'A Megbízott a Munkát az 5.2. pontban foglalt határidőre végzi el.', listString: '2.1.' },               // 7
  { text: 'A Megbízó a Megbízottnak díjat fizet, a 3.1 pontban és a 9. pontban foglaltak szerint.', listString: '2.2.' }, // 8
  { text: 'Díjazás', listString: '3.' },                                                                          // 9
  { text: 'A díj a Felek megállapodása szerint alakul, a „Teljesítési Igazolás” alapján.', listString: '3.1.' },  // 10
  { text: 'Határidők', listString: '5.' },                                                                        // 11
  { text: 'A teljesítési határidő 30 nap; a Ptk. 6:142. §-a szerinti felelősség kizárt.', listString: '5.2.' },    // 12
  { text: '2. számú melléklet' },                                                                                 // 13
  { text: 'A Munka részletes leírása.' },                                                                        // 14
];

const graph = buildDocumentGraph(contract);
const term = (name: string) => graph.terms.find(t => t.term === name);

test('inline and list definitions are found, including several in one parenthesis', () => {
  assert.deepEqual(graph.terms.map(t => t.term).sort(), ['Fél', 'Felek', 'Megbízott', 'Megbízó', 'Munka', 'Titoktartási Időszak'].sort());
  assert.equal(term('Megbízó')!.kind, 'inline');
  assert.equal(term('Munka')!.kind, 'list');
  assert.match(term('Megbízó')!.definition, /ABC Kft\./);
});

test('uses include inflected forms but not the definition itself or longer terms', () => {
  // "Megbízottnak" belongs to Megbízott, not to Megbízó
  assert.deepEqual(term('Megbízó')!.usages.map(u => u.paragraph), [8]);
  assert.deepEqual(term('Megbízott')!.usages.map(u => u.paragraph), [6, 7, 8]);
  // "Munkát" (a → á) and "Munka"
  assert.deepEqual(term('Munka')!.usages.map(u => u.paragraph), [7, 14]);
});

test('sections come from Word numbering, annexes from their headings', () => {
  const labels = graph.sections.map(s => `${s.kind}:${s.label}`);
  assert.ok(labels.includes('section:5.2') && labels.includes('section:3.1') && labels.includes('annex:2'));
});

test('cross-references resolve; missing targets and external law are handled', () => {
  const refs = graph.references.map(r => `${r.raw}→${r.target}`);
  assert.deepEqual(refs, ['2. számú mellékletben→13', '5.2. pontban→12', '3.1 pontban→10', '9. pontban→null']);
  // "Ptk. 6:142. §" is not a reference into this contract
  assert.ok(!graph.references.some(r => r.paragraph === 12));
});

test('issues: unused term, broken reference, quoted but undefined term', () => {
  const kinds = graph.issues.map(i => `${i.kind}@${i.at.paragraph}`);
  assert.deepEqual(kinds, ['unused@2', 'unused@5', 'broken-reference@8', 'undefined-quoted@10']);
  assert.match(graph.issues[0].message, /Fél/);
  assert.match(graph.issues[1].message, /Titoktartási Időszak/);
});

test('duplicate definitions are reported', () => {
  const g = buildDocumentGraph([{ text: 'X (a továbbiakban: Vevő) és' }, { text: 'Y (a továbbiakban: Vevő).' }, { text: 'A Vevő fizet.' }]);
  assert.deepEqual(g.issues.map(i => i.kind), ['duplicate']);
});

test('findAt returns the term or the reference under the cursor', () => {
  const text = contract[7].text;
  const onTerm = findAt(graph, 7, text.indexOf('Munkát') + 2);
  assert.equal(onTerm?.type === 'term' && onTerm.term.term, 'Munka');
  const onRef = findAt(graph, 7, text.indexOf('5.2.') + 1);
  assert.equal(onRef?.type === 'reference' && onRef.reference.target, 12);
  assert.equal(findAt(graph, 7, text.indexOf('határidőre')), null);
});

test('termPattern: multi-word terms and final vowel lengthening', () => {
  assert.ok(termPattern('Bizalmas Információ').test('a Bizalmas  Információkat'));
  assert.ok(termPattern('Munka').test('a Munkáért'));
  assert.ok(!termPattern('Munka').test('a munkát'));
});

test('English definitions', () => {
  const g = buildDocumentGraph([{ text: 'ABC Ltd. (the "Client") and XYZ (hereinafter "Contractor").' }, { text: 'The Client pays the Contractor.' }]);
  assert.deepEqual(g.terms.map(t => [t.term, t.usages.length]), [['Client', 1], ['Contractor', 1]]);
});

test('sectionPreview shows a section with its own subsections only', () => {
  const preview = sectionPreview(contract, graph, 11);
  assert.equal(preview, '5. Határidők\n5.2. A teljesítési határidő 30 nap; a Ptk. 6:142. §-a szerinti felelősség kizárt.');
  assert.equal(sectionPreview(contract, graph, 13), '2. számú melléklet\nA Munka részletes leírása.');
});
