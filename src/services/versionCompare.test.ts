import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { carryOver, compareVersions, formatChangesForAI, parseCompareResult, similarity } from './versionCompare';
import { paragraphsFromDocumentXml, readDocxParagraphs } from './docxText';

/** Minimal zip writer for tests (CRCs are not checked by the reader) */
function zip(files: Record<string, string>, compress = true): ArrayBuffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(content);
    const data = compress ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(compress ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...chunks, centralBuf, eocd]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length);
}

const documentXml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>1. Felek</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">A díj </w:t></w:r><w:del w:id="1"><w:r><w:delText>100</w:delText></w:r></w:del><w:ins w:id="2"><w:r><w:t>200</w:t></w:r></w:ins><w:r><w:tab/><w:t>Ft &amp; ÁFA</w:t><w:br/><w:t>második sor</w:t></w:r></w:p>
<w:p/>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cella</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><mc:AlternateContent><mc:Choice><w:t>Egyszer</w:t></mc:Choice><mc:Fallback><w:t>Kétszer</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>
</w:body></w:document>`;

test('document.xml: accepted text, tabs, line breaks, entities, tables, empty paragraphs', () => {
  assert.deepEqual(paragraphsFromDocumentXml(documentXml), ['1. Felek', 'A díj 200\tFt & ÁFA\vmásodik sor', '', 'Cella', 'Egyszer']);
});

test('a real zip (deflated and stored) is read without a zip library', async () => {
  for (const compress of [true, false]) {
    const paragraphs = await readDocxParagraphs(zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': documentXml }, compress));
    assert.equal(paragraphs[1], 'A díj 200\tFt & ÁFA\vmásodik sor');
  }
});

test('a file that is not a docx gives a clear error', async () => {
  await assert.rejects(readDocxParagraphs(new TextEncoder().encode('nem zip').buffer as ArrayBuffer), /nem \.docx/);
  await assert.rejects(readDocxParagraphs(zip({ 'a.txt': 'x' })), /nincs Word-dokumentum/);
});

test('similarity is the share of common words', () => {
  assert.equal(similarity('a b c d', 'a b c d'), 1);
  assert.equal(similarity('a b c d', 'a b x y'), 0.5);
  assert.equal(similarity('', 'a'), 0);
});

test('compareVersions finds modified, added and removed paragraphs in order', () => {
  const before = ['Cím', 'A díj 100 000 Ft, 30 napon belül fizetendő.', 'Ez a bekezdés törlésre kerül a partner által.', 'Változatlan zárás.', ''];
  const after = ['Cím', '', 'A díj 120 000 Ft, 30 napon belül fizetendő.', 'Teljesen új kötbér kikötés.', 'Változatlan zárás.'];
  const changes = compareVersions(before, after);
  assert.deepEqual(changes.map(c => [c.id, c.type, c.paragraph]), [
    [1, 'modified', 2],
    [2, 'added', 3],
    // A removed paragraph is anchored to the paragraph that now follows the changed block
    [3, 'removed', 4],
  ]);
  assert.equal(changes[0].oldText, before[1]);
  // Where each was in the earlier version
  assert.deepEqual(changes.map(c => c.oldParagraph), [1, undefined, 2]);
});

test('tracked changes: original and current text of the same Word paragraphs', () => {
  // A paragraph deleted with Track Changes is still a Word paragraph, empty when read with the changes accepted
  const original = ['Cím', 'A díj 100 000 Ft.', 'Kötbér nincs.', '', 'Zárás.'];
  const current = ['Cím', 'A díj 120 000 Ft.', '', 'Új titoktartási pont.', 'Zárás.'];
  const changes = compareVersions(original, current);
  // The removed paragraph still knows its Word paragraph (2), so its tracked deletion can be found there
  assert.deepEqual(changes.map(c => [c.type, c.paragraph, c.oldParagraph]), [
    ['modified', 1, 1],
    ['added', 3, undefined],
    ['removed', 4, 2],
  ]);
});

test('a fresh comparison keeps what was decided about the changes still there', () => {
  const before = compareVersions(['a b c', 'd e f', 'g h i'], ['a b X', 'd e Y', 'g h i']);
  const after = compareVersions(['a b c', 'd e f', 'g h i'], ['a b c', 'd e Y', 'g h i']);
  const kept = carryOver(before, after, new Map([[1, 'első'], [2, 'második']]));
  assert.deepEqual([...kept], [[1, 'második']]);
});

test('compareVersions: removal at the end anchors to the last paragraph; identical versions have no changes', () => {
  assert.deepEqual(compareVersions(['a', 'b'], ['a', 'b']), []);
  const changes = compareVersions(['Első', 'Második', 'Harmadik törölt'], ['Első', 'Második']);
  assert.deepEqual(changes.map(c => [c.type, c.paragraph]), [['removed', 1]]);
});

test('formatChangesForAI stops before the limit and reports how many fit', () => {
  const changes = compareVersions(['x y z'], ['x y w', 'új bekezdés']);
  const all = formatChangesForAI(changes, 10_000);
  assert.equal(all.included, 2);
  assert.match(all.text, /CHANGE 1 \(modified\):\nBEFORE: x y z\nAFTER: x y w/);
  assert.equal(formatChangesForAI(changes, 60).included, 1);
});

test('parseCompareResult keeps only known ids and valid risks', () => {
  const result = parseCompareResult(JSON.stringify({
    overview: 'A partner emelte a díjat.',
    changes: [{ id: 1, summary: 'Díjemelés', risk: 'high', recommendation: 'Tárgyalni' }, { id: 99, summary: 'kitalált', risk: 'low' }, { id: 2, summary: 'Törlés', risk: 'weird' }],
  }), new Set([1, 2]));
  assert.equal(result!.overview, 'A partner emelte a díjat.');
  assert.deepEqual([...result!.assessments.keys()], [1, 2]);
  assert.equal(result!.assessments.get(2)!.risk, 'medium');
  assert.equal(parseCompareResult('nem json', new Set()), null);
});
