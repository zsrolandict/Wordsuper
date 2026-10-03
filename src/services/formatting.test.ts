import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultOptions, defaultProfile, headingLevelCount, planFormatting, roleOf, summarize, type FormatAudit, type ParagraphFormat } from './formatting';

const para = (text: string, extra: Partial<ParagraphFormat> = {}): ParagraphFormat => ({
  text, styleBuiltIn: 'Normal', tableLevel: 0, font: 'Calibri', size: 11, bold: false, alignment: 'Justified', spaceBefore: 0, spaceAfter: 6, lineSpacing: 13.8, ...extra,
});

const audit: FormatAudit = {
  paragraphs: [
    para('ADÁSVÉTELI SZERZŐDÉS', { styleBuiltIn: 'Title', alignment: 'Centered', size: 16 }),
    para('Fogalmak', { styleBuiltIn: 'Heading1', size: 14, bold: true }),
    para('A Vevő fizet.'),
    para('A vételár', { styleBuiltIn: 'Heading2', size: 12, bold: true }),
    para('A vételár  100 Ft.', { font: 'Times New Roman', size: 12, spaceAfter: 0 }),
    para(''),
    para(''),
    para('ZÁRÓ RENDELKEZÉSEK'),
    para('Cella szöveg', { tableLevel: 1, font: 'Arial', size: 9, alignment: 'Left', spaceAfter: 0 }),
    para('Budapest, 2026. október 3.', { alignment: 'Right' }),
    para('Eladó', { bold: true, alignment: 'Centered' }),
  ],
  footnotes: [{ font: 'Calibri', size: 10 }, { font: 'Arial', size: 10 }],
};

test('roles: heading styles, fake headings (bold or capitals, no closing punctuation), tables', () => {
  assert.deepEqual(audit.paragraphs.map(p => roleOf(p).kind), ['title', 'heading', 'body', 'heading', 'body', 'empty', 'empty', 'fake-heading', 'table', 'body', 'fake-heading']);
  assert.equal(roleOf(para('A Vevő köteles fizetni.', { bold: true })).kind, 'body');
});

test('the summary counts what is uneven', () => {
  const s = summarize(audit);
  assert.deepEqual(s.fonts[0], ['Calibri', 2]);
  assert.equal(s.fonts.length, 3);
  assert.deepEqual(s.headingLevels, [[1, 1], [2, 1]]);
  assert.deepEqual(s.fakeHeadings, ['ZÁRÓ RENDELKEZÉSEK', 'Eladó']);
  assert.deepEqual(s.extraEmpty, [6]);
  assert.equal(s.doubleSpaces, 1);
  assert.equal(s.dominant.font, 'Calibri');
  assert.equal(s.dominant.size, 11);
  assert.equal(headingLevelCount(s, true), 3);
  assert.equal(headingLevelCount(s, false), 2);
});

test('the plan: body unified, headings graded by level, tables only font and size, centered and right left alone', () => {
  const s = summarize(audit);
  const profile = defaultProfile(s);
  assert.equal(profile.headingSize, 13);
  assert.equal(profile.footnoteSize, 9);
  const plan = planFormatting(audit, profile, defaultOptions());
  const at = (i: number) => plan.changes.find(c => c.index === i);
  assert.equal(at(0)?.size, 15);
  assert.equal(at(0)?.alignment, undefined);
  assert.deepEqual(at(1), { index: 1, size: 13, spaceBefore: 12 });
  assert.deepEqual(at(3), { index: 3, spaceBefore: 12 }, 'level 2 is one step down, as it already was');
  assert.equal(at(2), undefined, 'already as the profile says');
  assert.deepEqual(at(4), { index: 4, font: 'Calibri', size: 11, spaceAfter: 6 });
  // A fake heading below heading styles gets the smallest heading size
  assert.deepEqual(at(7), { index: 7, size: 12, bold: true, spaceBefore: 12 });
  assert.deepEqual(at(8), { index: 8, font: 'Calibri', size: 11 });
  assert.equal(at(9), undefined);
  assert.deepEqual(plan.footnotes, { font: 'Calibri', size: 9 });
  assert.deepEqual(plan.deleteEmpty, []);
  assert.equal(plan.doubleSpaces, false);
  assert.equal(plan.counts.headings, 4);
});

test('unified headings are all one size; the text options only when asked', () => {
  const profile = defaultProfile(summarize(audit));
  const options = defaultOptions();
  options.unifyHeadings = true;
  options.categories.emptyParagraphs = true;
  options.categories.doubleSpaces = true;
  const plan = planFormatting(audit, profile, options);
  const sizes = [1, 3, 7].map(i => plan.changes.find(c => c.index === i)?.size);
  assert.deepEqual(sizes, [13, 13, 13]);
  assert.deepEqual(plan.deleteEmpty, [6]);
  assert.equal(plan.doubleSpaces, true);
});

test('categories switched off change nothing of theirs', () => {
  const options = defaultOptions();
  Object.keys(options.categories).forEach(k => { options.categories[k as keyof typeof options.categories] = false; });
  options.categories.font = true;
  const plan = planFormatting(audit, defaultProfile(summarize(audit)), options);
  assert.ok(plan.changes.every(c => Object.keys(c).join() === 'index,font'));
  assert.deepEqual(plan.footnotes, { font: 'Calibri' });
});
