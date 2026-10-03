import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { describeSignInError, requestHeaders, resetAuthMode, retryMicrosoftSignIn, SignInError } from './signIn';

let serverMode: string | null = 'key';
let tokenCalls: { allowSignInPrompt?: boolean }[] = [];
let tokenResult: () => Promise<string> = async () => 'tok';
globalThis.fetch = (async (url: string) => {
  assert.equal(url, '/api/auth-mode');
  if (serverMode === null) throw new TypeError('Failed to fetch');
  return { ok: true, json: async () => ({ mode: serverMode }) };
}) as unknown as typeof fetch;
(globalThis as Record<string, unknown>).Office = {
  auth: { getAccessToken: (options: { allowSignInPrompt?: boolean }) => { tokenCalls.push(options); return tokenResult(); } },
};
const failWith = (code: number) => async () => { throw { code, message: 'x' }; };

beforeEach(() => {
  resetAuthMode();
  tokenCalls = [];
  tokenResult = async () => 'tok';
});

test('key mode: only the access key and the user name', async () => {
  serverMode = 'key';
  assert.deepEqual(await requestHeaders('k'.repeat(16), 'Kovács Anna'), { 'X-User-Id': encodeURIComponent('Kovács Anna'), 'X-Access-Key': 'k'.repeat(16) });
  assert.equal(tokenCalls.length, 0);
});

test('Microsoft mode: the token, never the key; a failed sign-in stops the request with a plain explanation', async () => {
  serverMode = 'microsoft';
  assert.deepEqual(await requestHeaders('some-key'), { Authorization: 'Bearer tok' });
  tokenResult = failWith(13001);
  await assert.rejects(requestHeaders('some-key'), (error: unknown) => error instanceof SignInError && error.code === 13001 && /Nem vagy bejelentkezve/.test(error.message));
});

test('both: the token and the key; after a failed sign-in the key alone, until the user tries again', async () => {
  serverMode = 'both';
  assert.deepEqual(await requestHeaders('some-key'), { Authorization: 'Bearer tok', 'X-Access-Key': 'some-key' });
  tokenResult = failWith(13007);
  // A quiet background check does not give up on the account
  assert.deepEqual(await requestHeaders('some-key', '', { interactive: false }), { 'X-Access-Key': 'some-key' });
  assert.equal(tokenCalls.at(-1)!.allowSignInPrompt, false);
  const before = tokenCalls.length;
  assert.deepEqual(await requestHeaders('some-key'), { 'X-Access-Key': 'some-key' });
  assert.deepEqual(await requestHeaders('some-key'), { 'X-Access-Key': 'some-key' });
  assert.equal(tokenCalls.length, before + 1, 'Word is not asked again on every request');
  retryMicrosoftSignIn();
  tokenResult = async () => 'tok2';
  assert.deepEqual(await requestHeaders('some-key'), { Authorization: 'Bearer tok2', 'X-Access-Key': 'some-key' });
  // Without a key there is nothing to fall back to
  tokenResult = failWith(13002);
  await assert.rejects(requestHeaders(''), SignInError);
});

test('unreachable server: key sign-in for now, asked again next time', async () => {
  serverMode = null;
  assert.deepEqual(await requestHeaders('some-key'), { 'X-Access-Key': 'some-key' });
  serverMode = 'microsoft';
  assert.deepEqual(await requestHeaders('some-key'), { Authorization: 'Bearer tok' });
});

test('sign-in errors in plain words', () => {
  assert.match(describeSignInError(13003), /munkahelyi/);
  assert.match(describeSignInError(13007), /alkalmazásregisztráció/);
  assert.match(describeSignInError(99999), /hibakód: 99999/);
  assert.match(describeSignInError(null), /Nem sikerült a Microsoft-fiókos belépés\.$/);
});

test('a refused sign-in makes the pane ask the server again how to sign in', async () => {
  const { forgetAuthMode } = await import('./signIn');
  serverMode = 'key';
  assert.deepEqual(await requestHeaders('some-key'), { 'X-Access-Key': 'some-key' });
  serverMode = 'microsoft';
  assert.deepEqual(await requestHeaders('some-key'), { 'X-Access-Key': 'some-key' }, 'remembered until refused');
  forgetAuthMode();
  assert.deepEqual(await requestHeaders('some-key'), { Authorization: 'Bearer tok' });
});
