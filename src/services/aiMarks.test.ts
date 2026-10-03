import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findAiMarks } from './aiMarks';
import type { ParagraphFormat } from './formatting';

const para = (text: string, extra: Partial<ParagraphFormat> = {}): ParagraphFormat => ({
  text, styleBuiltIn: 'Normal', tableLevel: 0, font: 'Calibri', size: 11, bold: false, alignment: 'Justified', spaceBefore: 0, spaceAfter: 6, lineSpacing: 13.8, ...extra,
});

test('AI traces are found and placed, never in plain legal wording', () => {
  const marks = findAiMarks({
    footnotes: null,
    paragraphs: [
      para('A Szerződés Tárgya', { styleBuiltIn: 'Heading1', bold: true }),
      para('Fontos megjegyezni, hogy a Vevő továbbá köteles a kulcsfontosságú adatokat átadni.'),
      para('A Vevő​ fizet ✅'),
      para('x'.repeat(250), { bold: true }),
      para('ÁLTALÁNOS RENDELKEZÉSEK', { styleBuiltIn: 'Heading1' }),
      para('A Vevő és az Eladó megállapodnak.'),
    ],
  });
  assert.deepEqual(marks.map(m => [m.kind, m.paragraph, m.found]), [
    ['phrase', 1, 'Fontos megjegyezni'],
    ['phrase', 1, 'kulcsfontosságú'],
    ['invisible', 2, 'A Vevő​ fizet ✅'],
    ['emoji', 2, '✅'],
  ]);
});

test('capitals in titles: a spelling hint, not for names, institutions, defined terms or numbered labels', () => {
  const heading = (text: string) => para(text, { styleBuiltIn: 'Heading1' });
  const marks = findAiMarks({
    footnotes: null,
    paragraphs: [
      heading('Szavatossági Nyilatkozatok'),
      heading('Dr. Jákfalvi Ágnes Ügyvédi Iroda'),
      heading('Vevő1 Vevő2'),
      heading('Pest Megyei Kormányhivatal'),
      // The defined term may stay capitalized; "Utolsó" in the middle may not
      heading('Az Utolsó Vételárrészlet'),
      // First word and a defined term: fine
      heading('Utolsó Vételárrészlet'),
      heading('Utolsó vételárrészlet'),
      // A long bold paragraph is no longer pointed out: lawyers bold whole clauses on purpose
      para('y'.repeat(250), { bold: true }),
    ],
  }, ['Vételárrészlet']);
  assert.deepEqual(marks, [], 'capitals in titles are not pointed out at all');
});
