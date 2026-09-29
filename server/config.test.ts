import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessKeyProblem, parseTrustProxy } from './config';
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
