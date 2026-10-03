import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultOptions, planTermEmphasis, STYLE_PRESETS, defaultProfile, headingLevelCount, planFormatting, roleOf, summarize, type FormatAudit, type ParagraphFormat } from './formatting';

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
  // The table keeps its own spacing and alignment: pinned, since the Normal style changes
  assert.deepEqual(at(8), { index: 8, font: 'Calibri', size: 11, spaceBefore: 0, spaceAfter: 0, lineSpacing: 13.8, alignment: 'Left' });
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

test('the ready-made styles: a Garamond classic, and all of them usable', () => {
  assert.deepEqual(STYLE_PRESETS.map(p => p.id), ['executive', 'classic', 'modern', 'compact', 'premium', 'legal']);
  assert.equal(STYLE_PRESETS.find(p => p.id === 'classic')!.profile.font, 'Garamond');
  for (const preset of STYLE_PRESETS) {
    assert.ok(preset.profile.headingSize > preset.profile.bodySize && preset.profile.footnoteSize < preset.profile.bodySize, preset.id);
    assert.ok(planFormatting(audit, preset.profile, defaultOptions()).changes.length > 0, preset.id);
  }
});

test('heading font, space before body paragraphs and first-line indent', () => {
  const profile = { ...defaultProfile(summarize(audit)), headingFont: 'Arial', bodySpaceBefore: 3, firstLineIndent: 18 };
  const plan = planFormatting(audit, profile, defaultOptions());
  const at = (i: number) => plan.changes.find(c => c.index === i);
  assert.equal(at(1)?.font, 'Arial');
  assert.equal(at(7)?.font, 'Arial');
  assert.equal(at(2)?.font, undefined);
  assert.deepEqual(at(2), { index: 2, spaceBefore: 3, firstLineIndent: 18 });
  assert.equal(at(8)?.firstLineIndent, undefined, 'tables keep their layout');
  assert.equal(at(1)?.firstLineIndent, undefined);
});

test('heading colour, indents (lists left alone), keep with next, margins in points', () => {
  const withMargins: FormatAudit = {
    ...audit,
    margins: [{ top: 72, bottom: 72, left: 85.04, right: 85.04 }],
    paragraphs: [...audit.paragraphs.map((p, i) => (i === 1 ? { ...p, style: 'Címsor 1' } : i === 3 ? { ...p, style: 'Címsor 2' } : p)), para('1. pont szöveg', { isList: true })],
  };
  const profile = { ...defaultProfile(summarize(withMargins)), headingColor: '#1F3864', leftIndent: 14, rightIndent: 7, marginLeft: 2.5, marginRight: 3 };
  const plan = planFormatting(withMargins, profile, defaultOptions());
  const at = (i: number) => plan.changes.find(c => c.index === i);
  assert.equal(at(1)?.color, '#1F3864');
  assert.equal(at(7)?.color, '#1F3864', 'fake headings too');
  assert.equal(at(2)?.color, undefined);
  assert.deepEqual([at(2)?.leftIndent, at(2)?.rightIndent], [14, 7]);
  assert.equal(at(11)?.leftIndent, undefined, 'a list item keeps its indent');
  assert.equal(at(8)?.leftIndent, undefined, 'a table cell too');
  assert.deepEqual(plan.keepWithNextStyles.sort(), ['Címsor 1', 'Címsor 2']);
  assert.deepEqual(plan.margins, { left: 70.9 }, 'the right margin is already 3 cm');
  const off = defaultOptions();
  off.categories.pagination = false;
  off.categories.margins = false;
  off.categories.color = false;
  const plan2 = planFormatting(withMargins, profile, off);
  assert.deepEqual([plan2.keepWithNextStyles, plan2.margins, plan2.changes.find(c => c.index === 1)?.color], [[], null, undefined]);
});

test('Word styles are updated too: Normal and the heading levels, with the rule under the top one', () => {
  const withNames: FormatAudit = {
    ...audit,
    paragraphs: audit.paragraphs.map(p => ({ ...p, style: { Normal: 'Normál', Heading1: 'Címsor 1', Heading2: 'Címsor 2', Title: 'Cím' }[p.styleBuiltIn] })),
  };
  const executive = STYLE_PRESETS.find(p => p.id === 'executive')!.profile;
  const plan = planFormatting(withNames, executive, defaultOptions());
  const byName = new Map(plan.styleUpdates.map(u => [u.name, u]));
  assert.deepEqual([...byName.keys()], ['Normál', 'Címsor 1', 'Címsor 2', 'Cím']);
  assert.deepEqual(byName.get('Normál')!.font, { name: 'Cambria', size: 11, color: '#1A1A1A' });
  assert.deepEqual(byName.get('Normál')!.paragraph, { spaceBefore: 0, spaceAfter: 8, lineSpacing: 14.5, alignment: 'Justified' });
  assert.deepEqual(byName.get('Címsor 1')!.font, { name: 'Cambria', size: 14, bold: true, smallCaps: true, color: '#0B3B60' });
  assert.deepEqual(byName.get('Címsor 1')!.border, { location: 'Bottom', color: '#2E75B6' });
  assert.deepEqual(byName.get('Címsor 2')!.border, { location: 'Left', color: '#2E75B6' });
  assert.equal(byName.get('Cím')!.paragraph, undefined, 'the title keeps its own spacing');
  // Headings in small capitals, fake headings too; the body in graphite
  assert.equal(plan.changes.find(c => c.index === 7)?.smallCaps, true);
  assert.equal(plan.changes.find(c => c.index === 2)?.color, '#1A1A1A');
  // Without the styles category nothing is pinned and no style is touched
  const off = defaultOptions();
  off.categories.styles = false;
  const plain = planFormatting(withNames, executive, off);
  assert.deepEqual(plain.styleUpdates, []);
  assert.equal(plain.changes.find(c => c.index === 8)?.spaceAfter, undefined);
});

test('microtypography only when asked, per paragraph', () => {
  const texts: FormatAudit = { ...audit, paragraphs: [...audit.paragraphs, para('A "Vevő" a § 5 szerint 100 000 Ft-ot fizet.')] };
  assert.deepEqual(planFormatting(texts, defaultProfile(summarize(texts)), defaultOptions()).textFixes, []);
  const options = defaultOptions();
  options.categories.nbsp = true;
  options.categories.quotes = true;
  const plan = planFormatting(texts, defaultProfile(summarize(texts)), options);
  const last = plan.textFixes.at(-1)!;
  assert.deepEqual([last.index, last.replacements.map(r => r.find), last.quotes], [11, ['§ 5', '100 000 Ft'], ['„', '”']]);
  assert.ok(plan.textFixes.some(f => f.replacements.some(r => r.find === '2026. október 3.')), 'the date in the place line too');
  assert.equal(summarize(texts).straightQuotes, 2);
});

test('defined terms: quoted and bold where defined, plain where used, headings and bold paragraphs left alone', () => {
  const termsAudit: FormatAudit = {
    footnotes: null,
    paragraphs: [
      para('ADÁSVÉTEL', { styleBuiltIn: 'Heading1', bold: true }),
      para('az ABC Kft. (a továbbiakban: Eladó) és Kovács János (a továbbiakban: „Vevő”) között'),
      para('A Vevő fizet az Eladónak.'),
      para('Az Eladó kijelenti.', { bold: true }),
    ],
  };
  const { emphasis, quoteFixes } = planTermEmphasis(termsAudit);
  assert.deepEqual(emphasis.definitions, [
    { index: 1, span: 'a továbbiakban: „Eladó”', term: 'Eladó' },
    { index: 1, span: 'a továbbiakban: „Vevő”', term: 'Vevő' },
  ]);
  assert.deepEqual([...quoteFixes], [[1, [{ find: 'a továbbiakban: Eladó', replace: 'a továbbiakban: „Eladó”' }]]]);
  assert.deepEqual(emphasis.usages, [{ index: 2, term: 'Eladó' }, { index: 2, term: 'Vevő' }]);
  const options = defaultOptions();
  options.categories.terms = true;
  const plan = planFormatting(termsAudit, defaultProfile(summarize(termsAudit)), options);
  assert.equal(plan.termEmphasis.definitions.length, 2);
  assert.ok(plan.textFixes.some(f => f.replacements.some(r => r.replace === 'a továbbiakban: „Eladó”')));
});
