import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMarkedRuns, findPlaceholders } from './presend';

test('unfilled places, but not a signature line or a citation', () => {
  const found = findPlaceholders([
    'A vételár [●] Ft, fizetendő XX napon belül.',
    'Vevő neve: [név], lakcím: ……………',
    '________________________',
    'Kelt: ……………',
    'A Ptk. [1] bekezdése szerint, TBD.',
    'A 2026. évi XX. törvény (római szám, nem kitöltetlen hely)',
  ]);
  assert.deepEqual(found.map(p => [p.paragraph, p.found]), [
    [0, '[●]'], [0, 'XX'], [1, '[név]'], [1, '……………'], [4, 'TBD'],
  ]);
});

test('highlighted and hidden runs from the OOXML, neighbours joined', () => {
  const ooxml = `<pkg><w:styles><w:rPr><w:vanish/></w:rPr></w:styles><w:body>
    <w:p><w:r><w:t>A vételár </w:t></w:r><w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr><w:t>26 000 000</w:t></w:r><w:r><w:rPr><w:b/><w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve"> Ft</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>belső &amp; titkos megjegyzés</w:t></w:r><w:r><w:rPr><w:highlight w:val="green"/></w:rPr><w:t>Vevő</w:t></w:r></w:p>
  </w:body></pkg>`;
  assert.deepEqual(findMarkedRuns(ooxml), {
    highlights: [{ text: '26 000 000 Ft', mark: 'yellow' }, { text: 'Vevő', mark: 'green' }],
    hidden: [{ text: 'belső & titkos megjegyzés', mark: 'hidden' }],
  });
});
