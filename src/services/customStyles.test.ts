import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeProfile } from './customStyles';
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
