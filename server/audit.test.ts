import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLogger, readUserId } from './audit';

test('user IDs are decoded, cleaned and capped', () => {
  assert.equal(readUserId(encodeURIComponent('Dr. Őri Zsófia')), 'Dr. Őri Zsófia');
  assert.equal(readUserId('a%ZZ'), 'a%ZZ');
  assert.equal(readUserId('x\u0000y'), 'xy');
  assert.equal(readUserId(undefined), '');
  assert.equal(readUserId('a'.repeat(300)).length, 100);
});

test('an audit line has metadata only', () => {
  const lines: string[] = [];
  const log = createAuditLogger(undefined, line => lines.push(line));
  log({ user: 'zs', ip: '1.2.3.4', action: 'review', status: 'ok', chars: { selection: 0, context: 1200, history: 0 }, model: 'm', location: 'Vertex AI (europe-west1)', durationMs: 5, tokens: { prompt: 10, output: 5, thoughts: 3, total: 18 } });
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.type, 'audit');
  assert.equal(entry.action, 'review');
  assert.deepEqual(entry.tokens, { prompt: 10, output: 5, thoughts: 3, total: 18 });
  assert.ok(!('instruction' in entry) && !('text' in entry));
});
