import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkUnits, formatUnits, guessLanguage, parseBilingualDocumentXml, parseTranslations, reuseTranslations, translateInParts, translationUnits } from './bilingual';
import { bilingualDocx, crc32 } from './docxWriter';
import { readDocxParagraphs, readZipEntry } from './docxText';

test('one unit per non-empty paragraph, the automatic number kept apart', () => {
  const units = translationUnits([
    { text: 'ADÁSVÉTELI SZERZŐDÉS', heading: true },
    { text: '' },
    { text: 'A Vevő  fizet.', listString: '1.1.' },
  ]);
  assert.deepEqual(units, [
    { id: 1, text: 'ADÁSVÉTELI SZERZŐDÉS', heading: true },
    { id: 2, text: 'A Vevő fizet.', number: '1.1.' },
  ]);
});

test('the language is guessed from common words', () => {
  assert.equal(guessLanguage('A Vevő a vételárat a szerződés aláírásától számított 8 napon belül fizeti meg.'), 'hu');
  assert.equal(guessLanguage('The Buyer shall pay the purchase price within 8 days of the signing of this Agreement.'), 'en');
});

test('parts stay under the limit, a long unit gets a part of its own', () => {
  const units = [1, 2, 3, 4].map(id => ({ id, text: 'x'.repeat(id === 3 ? 50 : 10) }));
  assert.deepEqual(chunkUnits(units, 25).map(c => c.map(u => u.id)), [[1, 2], [3], [4]]);
  assert.equal(formatUnits(units.slice(0, 2)), `[[1]] ${'x'.repeat(10)}\n[[2]] ${'x'.repeat(10)}`);
});

test('every id must come back: the missing ones are named, unknown and duplicate ids are ignored', () => {
  const answer = JSON.stringify({ translations: [{ id: 1, text: 'The Buyer pays.' }, { id: 1, text: 'twice' }, { id: 9, text: 'unknown' }, { id: 3, text: '  ' }] });
  const { texts, missing } = parseTranslations(answer, [1, 2, 3]);
  assert.deepEqual([...texts], [[1, 'The Buyer pays.']]);
  assert.deepEqual(missing, [2, 3]);
  assert.deepEqual(parseTranslations('not json', [1, 2]).missing, [1, 2]);
});

test('the bilingual .docx is a valid zip with a two-column table, readable back', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bytes = bilingualDocx({
    leftLabel: 'Magyar',
    rightLabel: 'English',
    rows: [
      { number: '1.', left: 'A Vevő fizet & <nem késik>.', right: 'The Buyer pays & <is not late>.', heading: false },
      { left: 'Zárás', right: '⚠ Nem sikerült lefordítani', warning: true },
    ],
  });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const xml = new TextDecoder().decode((await readZipEntry(buffer, 'word/document.xml'))!);
  assert.equal((xml.match(/<w:tr>/g) ?? []).length, 2, 'no language header row');
  assert.match(xml, /w:orient="landscape"/);
  assert.doesNotMatch(xml, /<w:tblHeader\/>|Kétnyelvű változat/, 'no title, no header');
  assert.match(xml, /<w:tblCaption w:val="Kétnyelvű: Magyar → English"\/>/);
  const paragraphs = await readDocxParagraphs(buffer);
  assert.ok(paragraphs.includes('1. A Vevő fizet & <nem késik>.'));
  assert.ok(paragraphs.includes('1. The Buyer pays & <is not late>.'));
});

test('parts: a missing id is asked once more, a too long part is halved, the texts are unmasked', async () => {
  const units = [1, 2, 3, 4].map(id => ({ id, text: `t${id} [CÉG_1]` }));
  const asked: number[][] = [];
  const result = await translateInParts(units, {
    ask: async part => {
      asked.push(part.map(u => u.id));
      if (part.length === 4) throw new Error('too long');
      // The first answer (after the halving) leaves out id 2; id 4 never comes back
      const leaveOut = asked.length === 2 ? [2, 4] : [4];
      return JSON.stringify({ translations: part.filter(u => !leaveOut.includes(u.id)).map(u => ({ id: u.id, text: `T${u.id} [CÉG_1]` })) });
    },
    unmask: text => text.replace('[CÉG_1]', 'ABC Kft.'),
    isTooLong: e => e instanceof Error && e.message === 'too long',
  }, 1000);
  assert.deepEqual(asked, [[1, 2, 3, 4], [1, 2], [2], [3, 4], [4]]);
  assert.deepEqual([...result].sort(), [[1, 'T1 ABC Kft.'], [2, 'T2 ABC Kft.'], [3, 'T3 ABC Kft.']]);
});

test('parts: any other error stops the run', async () => {
  await assert.rejects(translateInParts([{ id: 1, text: 'a' }, { id: 2, text: 'b' }], {
    ask: async () => { throw new Error('unauthorized'); },
    unmask: t => t,
    isTooLong: () => false,
  }), /unauthorized/);
});

test('an earlier bilingual document: unchanged paragraphs keep their translation, changed and red ones are translated anew', async () => {
  const bytes = bilingualDocx({
    leftLabel: 'Magyar', rightLabel: 'English',
    rows: [
      { number: '1.', left: 'Fogalmak', right: 'Definitions', heading: true },
      { number: '1.1.', left: 'A Vevő fizet.', right: 'The Buyer pays.' },
      { left: 'Zárás.', right: '⚠ Nem sikerült lefordítani – fordítsd kézzel.', warning: true },
      { left: 'Régi bekezdés.', right: 'Old paragraph.', changed: true },
    ],
  });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const xml = new TextDecoder().decode((await readZipEntry(buffer, 'word/document.xml'))!);
  assert.match(xml, /w:fill="FFF2CC"/);
  const previous = parseBilingualDocumentXml(xml)!;
  assert.deepEqual([previous.leftLabel, previous.rightLabel, previous.rows.length], ['Magyar', 'English', 4]);
  const units = translationUnits([
    { text: 'Fogalmak', listString: '1.' },
    { text: 'A Vevő fizet.', listString: '1.1.' },
    { text: 'A Vevő fizet, azonnal.', listString: '1.2.' },
    { text: 'Zárás.' },
  ]);
  const reused = reuseTranslations(units, previous);
  assert.deepEqual([...reused], [[1, 'Definitions'], [2, 'The Buyer pays.']]);
});

test('an earlier bilingual file: direction from the alt text, from an old header row, or from the text itself', () => {
  const cellXml = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const row = (a: string, b: string) => `<w:tr>${cellXml(a)}${cellXml(b)}</w:tr>`;
  const body = row('A Vevő a vételárat a szerződés szerint fizeti meg.', 'The Buyer shall pay the price under this agreement.');
  const old = parseBilingualDocumentXml(`<w:tbl>${row('Magyar', 'English')}${body}</w:tbl>`)!;
  assert.deepEqual([old.leftLabel, old.rightLabel, old.rows.length], ['Magyar', 'English', 1]);
  const guessed = parseBilingualDocumentXml(`<w:tbl>${body}</w:tbl>`)!;
  assert.deepEqual([guessed.leftLabel, guessed.rightLabel, guessed.rows.length], ['Magyar', 'English', 1]);
  const captioned = parseBilingualDocumentXml(`<w:tbl><w:tblPr><w:tblCaption w:val="Kétnyelvű: English → Magyar"/></w:tblPr>${body}</w:tbl>`)!;
  assert.deepEqual([captioned.leftLabel, captioned.rightLabel], ['English', 'Magyar'], 'the alt text wins over guessing');
  assert.equal(parseBilingualDocumentXml('<w:p/>'), null);
});
