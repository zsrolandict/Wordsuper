import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessKeyProblem, contentSecurityPolicy, parseAccessKeys, parseDictationPolicy, parseMaskingPolicy, parseTrustProxy } from './config';
import { mapGeminiFinish } from './ai/gemini';

test('access key: missing, placeholder and short keys are refused, whitespace is ignored', () => {
  assert.match(accessKeyProblem(undefined)!, /not set/);
  assert.match(accessKeyProblem('   ')!, /not set/);
  assert.match(accessKeyProblem('MY_APP_ACCESS_KEY')!, /placeholder/);
  assert.match(accessKeyProblem('short-key')!, /shorter than 16/);
  assert.equal(accessKeyProblem('0123456789abcdef0123\n'), null);
});

test('TRUST_PROXY: hop counts and addresses pass, "true" is refused, Cloud Run defaults to one hop', () => {
  assert.deepEqual(parseTrustProxy(undefined, false), { value: false });
  assert.deepEqual(parseTrustProxy(undefined, true), { value: 1 });
  assert.deepEqual(parseTrustProxy(' 2 ', false), { value: 2 });
  assert.deepEqual(parseTrustProxy('FALSE', true), { value: false });
  assert.deepEqual(parseTrustProxy('loopback, 10.0.0.0/8', false), { value: 'loopback, 10.0.0.0/8' });
  const permissive = parseTrustProxy('True', true);
  assert.equal(permissive.value, 1);
  assert.match(permissive.warning!, /any X-Forwarded-For/);
});

test('Gemini finish reasons: only STOP counts as a complete answer', () => {
  assert.deepEqual(mapGeminiFinish('STOP', undefined), { reason: 'stop' });
  assert.deepEqual(mapGeminiFinish(undefined, undefined), { reason: 'stop' });
  assert.deepEqual(mapGeminiFinish('MAX_TOKENS', undefined), { reason: 'length', detail: 'MAX_TOKENS' });
  assert.deepEqual(mapGeminiFinish('RECITATION', undefined), { reason: 'safety', detail: 'RECITATION' });
  assert.deepEqual(mapGeminiFinish('STOP', 'PROHIBITED_CONTENT'), { reason: 'safety', detail: 'PROHIBITED_CONTENT' });
  assert.deepEqual(mapGeminiFinish('FINISH_REASON_UNSPECIFIED', undefined), { reason: 'other', detail: 'FINISH_REASON_UNSPECIFIED' });
});

test('dictation policy: the user may accept the risk unless the operator forbids it', () => {
  assert.equal(parseDictationPolicy(undefined), 'user-risk');
  assert.equal(parseDictationPolicy(''), 'user-risk');
  assert.equal(parseDictationPolicy('eu-only'), 'eu-only');
  assert.equal(parseDictationPolicy(' EU-ONLY '), 'eu-only');
  assert.equal(parseDictationPolicy('whatever'), 'user-risk');
});

test('masking is required unless the operator makes it optional', () => {
  assert.equal(parseMaskingPolicy(undefined), 'required');
  assert.equal(parseMaskingPolicy(''), 'required');
  assert.equal(parseMaskingPolicy('nonsense'), 'required');
  assert.equal(parseMaskingPolicy(' Optional '), 'optional');
});

test('the task pane may only connect to this server, Office.js and the dictation model host', () => {
  const policy = contentSecurityPolicy(undefined)!;
  const connect = policy.split('; ').find(d => d.startsWith('connect-src'))!;
  assert.match(connect, /'self'/);
  assert.doesNotMatch(connect, /(^| )(https?:|ws:|wss:|\*)( |$)/, 'no scheme-wide or wildcard source');
  assert.match(policy, /object-src 'none'/);
  assert.equal(contentSecurityPolicy(' OFF '), null);
});

test('personal access keys: each colleague their own, invalid entries skipped with a reason', () => {
  const keys = parseAccessKeys('0123456789abcdef-shared', 'Kovács Anna: anna-0123456789abcdef, peter:peter-0123456789abcdef; rossz:rövid, :nincs-nev-0123456789ab, masik:anna-0123456789abcdef');
  assert.equal(keys.shared, '0123456789abcdef-shared');
  assert.deepEqual([...keys.personal], [['anna-0123456789abcdef', 'Kovács Anna'], ['peter-0123456789abcdef', 'peter']]);
  assert.equal(keys.problem, null);
  assert.equal(keys.warnings.length, 3);
  assert.match(keys.warnings.join('\n'), /"rossz" skipped: the key is shorter/);
  assert.match(keys.warnings.join('\n'), /already given to "Kovács Anna"/);
});

test('personal keys alone are enough; nothing usable refuses every request', () => {
  const personalOnly = parseAccessKeys(undefined, 'anna:anna-0123456789abcdef');
  assert.equal(personalOnly.shared, null);
  assert.equal(personalOnly.problem, null);
  const placeholderShared = parseAccessKeys('MY_APP_ACCESS_KEY', 'anna:anna-0123456789abcdef');
  assert.equal(placeholderShared.shared, null);
  assert.equal(placeholderShared.problem, null);
  assert.match(parseAccessKeys(undefined, undefined).problem!, /not set/);
  assert.match(parseAccessKeys('short', '').problem!, /shorter/);
});
