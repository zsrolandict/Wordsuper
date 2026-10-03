import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentGraph, findAt, sectionPreview, termPattern, type ParagraphInfo } from './structure';
import { inlineDefinitionRemoval, withAutoNumbers } from './structure';

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

test('issues: unused term, broken reference (a quotation used only once is not an issue)', () => {
  const kinds = graph.issues.map(i => `${i.kind}@${i.at.paragraph}`);
  // The fixture also skips section 4 and 5.1: the numbering check reports them
  assert.deepEqual(kinds, ['unused@2', 'unused@5', 'broken-reference@8', 'numbering@11', 'numbering@12']);
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

test('a quoted term ends at its closing quote', () => {
  const g = buildDocumentGraph([
    { text: 'A második részlet (a továbbiakban: „Vételár-részlet 2.” Utolsó vételárrészlet) esedékes.' },
    { text: 'A Vételár-részlet 2. megfizetése a birtokbaadáskor történik.' },
  ]);
  assert.deepEqual(g.terms.map(t => [t.term, t.usages.length]), [['Vételár-részlet 2.', 1]]);
});

test('a one-off quotation is not reported as an undefined term, a reused one is', () => {
  const g = buildDocumentGraph([
    { text: 'Az „I. ütem: A jelű 12 lakásos lakóépület” építése.' },
    { text: 'A „Teljesítési Igazolás” kiállítása.' },
    { text: 'A Teljesítési Igazolás alapján fizet.' },
  ]);
  assert.deepEqual(g.issues.map(i => i.kind + ':' + i.message.slice(0, 25)), ['undefined-quoted:„Teljesítési Igazolás” id']);
});

test('references to annexes that are not in this file are a note, not a broken reference', () => {
  const g = buildDocumentGraph([{ text: 'Az 1. sz. mellékletben foglaltak szerint.' }]);
  assert.deepEqual(g.issues.map(i => i.kind), ['missing-annex']);
});

test('multi-level numbering is rebuilt when Word only gives the number of the level', () => {
  const g = buildDocumentGraph([
    { text: 'Felek', listString: '1.', listLevel: 0 },
    { text: 'Az eladó adatai', listString: '1.', listLevel: 1 },
    { text: 'A vevő adatai', listString: '2.', listLevel: 1 },
    { text: 'Vételár', listString: '2.', listLevel: 0 },
    { text: 'Részletek', listString: 'a)', listLevel: 1 },
    { text: 'A vételár az 1.2. pont szerinti vevőt terheli.', listString: '1.', listLevel: 1 },
  ]);
  const labels = g.sections.map(s => s.label);
  assert.deepEqual(labels, ['1', '1.1', '1.2', '2', '2.1']);
  assert.equal(g.references[0].target, 2);
});

test('automatic numbering is shown in brackets, levels rebuilt', () => {
  assert.deepEqual(
    withAutoNumbers([
      { text: 'Fogalmak', listString: '1.', listLevel: 0 },
      { text: 'Vételár: …', listString: '1.', listLevel: 1 },
      { text: 'felsorolás', listString: 'a)', listLevel: 2 },
      { text: 'Sima bekezdés' },
    ]),
    ['[1.] Fogalmak', '[1.1.] Vételár: …', '[a)] felsorolás', 'Sima bekezdés']
  );
});

test('a term defined both in the definitions section and inline is flagged with the text to remove', () => {
  const graph = buildDocumentGraph([
    { text: 'Az ABC Kft. (a továbbiakban: Megbízó) és az XYZ Zrt. (székhely: Budapest; a továbbiakban: Megbízott) között.' },
    { text: 'Fogalommeghatározások' },
    { text: '„Megbízó”: jelenti az ABC Kft.-t.' },
    { text: '„Megbízott”: jelenti az XYZ Zrt.-t.' },
    { text: 'A Megbízó fizet, a Megbízott teljesít.' },
  ]);
  const inline = graph.issues.filter(i => i.kind === 'duplicate-inline');
  assert.deepEqual(inline.map(i => [i.subject, i.at.paragraph, i.removal]), [
    ['Megbízó', 0, ' (a továbbiakban: Megbízó)'],
    ['Megbízott', 0, '; a továbbiakban: Megbízott'],
  ]);
  assert.ok(!graph.issues.some(i => i.kind === 'duplicate'));
});

test('inline definition removal keeps the rest of the parenthesis', () => {
  const text = 'ABC Kft. (a továbbiakban: Megbízó; székhely: Budapest) fizet.';
  const start = text.indexOf('a továbbiakban');
  assert.equal(inlineDefinitionRemoval(text, start, text.indexOf(';')), 'a továbbiakban: Megbízó; ');
  const plain = 'ABC Kft., a továbbiakban: Megbízó, fizet.';
  assert.equal(inlineDefinitionRemoval(plain, plain.indexOf('a továbbiakban'), plain.indexOf(', fizet')), undefined);
});
