import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateManifest } from './manifest';

test('manifest: Microsoft sign-in only with a client ID, the resource on the add-in host', () => {
  assert.doesNotMatch(generateManifest('https://localhost:3444/'), /WebApplicationInfo/);
  const xml = generateManifest('https://localhost:3444/', '11111111-2222-3333-4444-555555555555');
  assert.match(xml, /<Id>11111111-2222-3333-4444-555555555555<\/Id>\s*<Resource>api:\/\/localhost:3444\/11111111-2222-3333-4444-555555555555<\/Resource>/);
  // The last child of VersionOverrides, after Resources (the schema's order)
  assert.match(xml, /<\/Resources>\s*<WebApplicationInfo>[\s\S]*<\/WebApplicationInfo>\s*<\/VersionOverrides>/);
});
