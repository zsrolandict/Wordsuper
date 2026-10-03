import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { bearerToken, createMicrosoftVerifier, parseAuthConfig } from './msAuth';

const CLIENT = '11111111-2222-3333-4444-555555555555';
const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_TENANT = 'ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee';

test('auth config: key mode by default, Microsoft modes need the client and the tenant ID', () => {
  assert.deepEqual(parseAuthConfig({}), { mode: 'key', clientId: '', tenantId: '', allowedDomains: [], problem: null });
  assert.equal(parseAuthConfig({ AUTH_MODE: ' KEY ' }).mode, 'key');
  const both = parseAuthConfig({ AUTH_MODE: 'both', MS_CLIENT_ID: CLIENT.toUpperCase(), MS_TENANT_ID: ` ${TENANT} `, MS_ALLOWED_DOMAINS: '@Iroda.hu, ictlegal.eu' });
  assert.deepEqual(both, { mode: 'both', clientId: CLIENT, tenantId: TENANT, allowedDomains: ['iroda.hu', 'ictlegal.eu'], problem: null });
  assert.match(parseAuthConfig({ AUTH_MODE: 'microsoft' }).problem!, /MS_CLIENT_ID/);
  assert.match(parseAuthConfig({ AUTH_MODE: 'microsoft', MS_CLIENT_ID: CLIENT, MS_TENANT_ID: 'common' }).problem!, /MS_TENANT_ID/);
  const typo = parseAuthConfig({ AUTH_MODE: 'azure' });
  assert.equal(typo.mode, 'key');
  assert.match(typo.problem!, /AUTH_MODE="azure"/);
});

test('bearer token: only a well-formed Authorization header counts', () => {
  assert.equal(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerToken('bearer   abc '), 'abc');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken('Bearer a b'), null);
  assert.equal(bearerToken(undefined), null);
});

test('Microsoft token: signature, issuer, audience, directory, scope and domain are all checked', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const config = parseAuthConfig({ AUTH_MODE: 'microsoft', MS_CLIENT_ID: CLIENT, MS_TENANT_ID: TENANT });
  const verify = createMicrosoftVerifier(config, keys);
  const sign = (claims: JWTPayload, { key = privateKey, issuer = `https://login.microsoftonline.com/${TENANT}/v2.0`, expires = '1h', audience = CLIENT } = {}) =>
    new SignJWT({ tid: TENANT, scp: 'access_as_user', preferred_username: 'Kovacs.Anna@iroda.hu', name: 'Kovács Anna', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(key);

  assert.deepEqual(await verify(await sign({})), { user: 'kovacs.anna@iroda.hu', name: 'Kovács Anna' });
  // v1 token: the Application ID URI as audience, upn instead of preferred_username
  const v1 = await new SignJWT({ tid: TENANT, scp: 'access_as_user openid', upn: 'nagy.peter@iroda.hu' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(`https://sts.windows.net/${TENANT}/`)
    .setAudience(`api://localhost:3444/${CLIENT}`)
    .setExpirationTime('1h')
    .sign(privateKey);
  assert.deepEqual(await verify(v1), { user: 'nagy.peter@iroda.hu', name: '' });

  const other = await generateKeyPair('RS256');
  assert.match((await verify(await sign({}, { key: other.privateKey })) as { error: string }).error, /token rejected/);
  assert.match((await verify(await sign({}, { expires: '-2h' })) as { error: string }).error, /token rejected/);
  assert.match((await verify(await sign({}, { issuer: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` })) as { error: string }).error, /token rejected/);
  assert.match((await verify(await sign({}, { audience: '99999999-2222-3333-4444-555555555555' })) as { error: string }).error, /another application/);
  assert.match((await verify(await sign({}, { audience: `api://evil.example/x${CLIENT}` })) as { error: string }).error, /another application/);
  assert.match((await verify(await sign({ tid: OTHER_TENANT })) as { error: string }).error, /another directory/);
  assert.match((await verify(await sign({ scp: 'User.Read' })) as { error: string }).error, /access_as_user/);
  assert.match((await verify(await sign({ preferred_username: undefined })) as { error: string }).error, /no user name/);
  assert.match((await verify('not-a-token') as { error: string }).error, /token rejected/);

  const limited = createMicrosoftVerifier({ ...config, allowedDomains: ['ictlegal.eu'] }, keys);
  assert.match((await limited(await sign({})) as { error: string }).error, /MS_ALLOWED_DOMAINS/);
  assert.deepEqual(await limited(await sign({ preferred_username: 'anna@ictlegal.eu' })), { user: 'anna@ictlegal.eu', name: 'Kovács Anna' });
});
