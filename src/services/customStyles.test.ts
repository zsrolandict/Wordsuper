import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStylesFile, sanitizeProfile, stylesFile } from './customStyles';
import { STYLE_PRESETS } from './formatting';

test('a stored style is only taken back when every field is valid', () => {
  const profile = STYLE_PRESETS[0].profile;
  assert.deepEqual(sanitizeProfile(JSON.parse(JSON.stringify(profile))), profile);
  assert.deepEqual(sanitizeProfile({ ...profile, extra: 'x' }), profile, 'unknown fields dropped');
  assert.equal(sanitizeProfile({ ...profile, bodySize: 'nagy' }), null);
  assert.equal(sanitizeProfile({ ...profile, headingColor: 'red;}' }), null);
  assert.equal(sanitizeProfile({ ...profile, font: '<script>' }), null);
  assert.equal(sanitizeProfile({ ...profile, alignment: 'Center' }), null);
  assert.equal(sanitizeProfile(null), null);
});

test('export and import: the same file back, damaged entries left out', () => {
  const profile = STYLE_PRESETS[0].profile;
  const file = JSON.parse(JSON.stringify(stylesFile([{ id: 'own-1', name: 'Iroda', profile }])));
  assert.equal(file.kind, 'styles');
  const back = readStylesFile({ ...file, styles: [...file.styles, { name: 'Rossz', profile: { ...profile, font: '<x>' } }, { profile }] }, 'own');
  assert.deepEqual(back.styles.map(s => [s.name, s.profile.font]), [['Iroda', profile.font]]);
  assert.equal(back.skipped, 2);
  assert.equal(readStylesFile([{ name: 'Lista', profile }], 'office').styles[0].id.startsWith('office-'), true);
  assert.deepEqual(readStylesFile('szemét', 'own'), { styles: [], skipped: 0 });
});
