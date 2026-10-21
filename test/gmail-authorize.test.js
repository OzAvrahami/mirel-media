import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startAuthorization, saveRefreshToken } from '../scripts/gmail-authorize.js';
import { GMAIL_SCOPE, TOKEN_URL } from '../src/contact.js';

test('local helper requests only gmail.send with state and PKCE, rejects wrong state, saves without exposing tokens', async t => {
  const saved = []; const calls = [];
  const auth = await startAuthorization({ clientId: 'test-client', clientSecret: 'test-secret', sender: 'authorized@example.com',
    saveToken: async token => saved.push(token), fetchImpl: async (url, options) => {
      calls.push({ url, ...options });
      return Response.json({ refresh_token: 'test-refresh', access_token: 'test-access', scope: GMAIL_SCOPE });
    } });
  t.after(auth.close);
  const url = new URL(auth.url);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), GMAIL_SCOPE);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('login_hint'), 'authorized@example.com');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('state').length >= 43);
  assert.doesNotMatch(auth.url, /test-secret|test-refresh|test-access/);
  const callback = new URL(url.searchParams.get('redirect_uri'));
  assert.equal(callback.hostname, '127.0.0.1');
  assert.equal(callback.pathname, '/oauth2callback');
  callback.search = new URLSearchParams({ state: 'wrong', code: 'test-code' });
  assert.equal((await fetch(callback)).status, 400);
  assert.equal(calls.length, 0); assert.equal(saved.length, 0);
  callback.searchParams.set('state', url.searchParams.get('state'));
  const response = await fetch(callback);
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /test-refresh|test-access|test-secret/);
  assert.equal(await auth.completion, true);
  assert.deepEqual(saved, ['test-refresh']); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, TOKEN_URL); assert.equal(calls[0].redirect, 'error');
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'authorization_code');
  assert.equal(body.get('redirect_uri'), url.searchParams.get('redirect_uri'));
  assert.equal(body.get('client_secret'), 'test-secret');
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), url.searchParams.get('code_challenge'));
});

test('helper rejects consent errors, token errors, missing refresh tokens and broader grants without saving', async t => {
  for (const mode of ['denied', 'error', 'missing', 'broader', 'network']) {
    let saved = false; let calls = 0;
    const auth = await startAuthorization({ clientId: 'test-client', clientSecret: 'test-secret', sender: 'authorized@example.com',
      saveToken: async () => { saved = true; }, fetchImpl: async () => {
        calls++;
        if (mode === 'network') throw new Error('secret-debug');
        if (mode === 'error') return new Response('secret-debug', { status: 400 });
        return Response.json({ refresh_token: mode === 'missing' ? undefined : 'test-refresh',
          scope: mode === 'broader' ? GMAIL_SCOPE + ' other' : GMAIL_SCOPE });
      } });
    t.after(auth.close);
    const url = new URL(auth.url);
    const callback = new URL(url.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: url.searchParams.get('state'),
      ...(mode === 'denied' ? { error: 'access_denied' } : { code: 'test-code' }) });
    const response = await fetch(callback);
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /secret-debug|test-refresh|test-secret/);
    assert.equal(await auth.completion, false); assert.equal(saved, false);
    assert.equal(calls, mode === 'denied' ? 0 : 1);
  }
});

test('helper expires unused authorization and closes the loopback listener', async () => {
  const auth = await startAuthorization({ clientId: 'test-client', clientSecret: 'test-secret', sender: 'authorized@example.com',
    lifetimeMs: 10, saveToken: async () => assert.fail('Must not save'), fetchImpl: async () => assert.fail('Must not contact Google') });
  assert.equal(await auth.completion, false);
  await assert.rejects(fetch(new URL(auth.url).searchParams.get('redirect_uri')));
});

test('token persistence replaces only the refresh token and keeps unrelated local settings', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mirel-gmail-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = path.join(dir, '.env');
  await writeFile(filename, '# Keep this comment\r\nPORT=4321\r\nGOOGLE_REFRESH_TOKEN=old-test\r\nOTHER=unchanged\r\n');
  await saveRefreshToken(filename, 'new-test-token');
  const content = await readFile(filename, 'utf8');
  assert.equal(content, '# Keep this comment\r\nPORT=4321\r\nOTHER=unchanged\r\nGOOGLE_REFRESH_TOKEN=new-test-token\r\n');
  if (process.platform !== 'win32') assert.equal((await stat(filename)).mode & 0o777, 0o600);
  await assert.rejects(saveRefreshToken(filename, 'bad\nINJECTED=value'));
  assert.equal(await readFile(filename, 'utf8'), content);
});
