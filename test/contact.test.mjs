import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.mjs';
import { readConfig, createRateLimiter, createInquirySender, GMAIL_SCOPE, TOKEN_URL } from '../src/contact.mjs';

const env = { NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000', GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REFRESH_TOKEN: 'test-refresh',
  GMAIL_SENDER: 'lior@mirel-media.com', CONTACT_TO: 'lior@mirel-media.com' };
const tokenResponse = () => Response.json({ access_token: 'test-access', expires_in: 3600, token_type: 'Bearer', scope: GMAIL_SCOPE });
const inquiry = () => ({ name: 'Alex Taylor', email: 'alex@example.net', company: 'Example Studio',
  goal: 'We would like to discuss a lead generation campaign.', partner_role: 'Advertiser',
  interest: 'Lead generation', request_id: randomUUID(), website_url: '' });

async function fixture(t, options = {}) {
  const calls = [];
  const server = createServer({ env, fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return url === TOKEN_URL ? tokenResponse() : Response.json({ id: 'test-email-id' });
  }, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (data = inquiry(), { headers = {}, method = 'POST', body, path = '/api/contact' } = {}) =>
    fetch(base + path, { method, headers: { Origin: env.PUBLIC_ORIGIN, 'Content-Type': 'application/json', ...headers },
      body: ['GET', 'HEAD'].includes(method) ? undefined : (body ?? JSON.stringify(data)) });
  return { base, request, calls };
}

test('valid inquiry reaches only the configured recipient, with reply-to and plain text', async t => {
  const f = await fixture(t); const data = inquiry(); data.to = 'attacker@example.com'; data.from = 'attacker@example.com';
  const response = await f.request(data);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.calls.length, 2);
  const refresh = new URLSearchParams(f.calls[0].body);
  assert.equal(f.calls[0].url, TOKEN_URL);
  assert.equal(refresh.get('grant_type'), 'refresh_token');
  assert.equal(refresh.get('refresh_token'), 'test-refresh');
  const sent = JSON.parse(f.calls[1].body);
  assert.deepEqual(Object.keys(sent), ['raw']);
  const mime = Buffer.from(sent.raw, 'base64url').toString('utf8');
  assert.match(mime, /^From: mirel-media <lior@mirel-media.com>\r\nTo: lior@mirel-media.com\r\nReply-To: alex@example.net\r\n/);
  assert.doesNotMatch(mime, /attacker|Bcc:|text\/html/);
  const body = Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString('utf8');
  assert.match(body, /Alex Taylor/); assert.match(body, /Lead generation/);
  assert.equal(f.calls[1].url, 'https://gmail.googleapis.com/gmail/v1/users/lior%40mirel-media.com/messages/send');
  assert.equal(f.calls[1].headers.Authorization, 'Bearer test-access');
  assert.equal(f.calls[1].redirect, 'error');
});

test('invalid email, whitespace, enums, lengths and request IDs are rejected before sending', async t => {
  const f = await fixture(t, { limiter: () => true });
  for (const patch of [{ email: 'bad' }, { email: 'a@example.com\r\nBcc: other@example.com' }, { name: '   ' },
    { email: 'a@example.com(Bcc:evil)' }, { email: '"a"@example.com' }, { email: 'a..b@example.com' },
    { email: 'a@example.com/path' }, { email: 'a@-example.com' }, { email: 'é@example.com' },
    { goal: 'x'.repeat(2001) }, { partner_role: 'Admin' }, { interest: 'Spam' }, { request_id: 'invalid' }, { company: 42 }]) {
    assert.equal((await f.request({ ...inquiry(), ...patch })).status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('cross-origin requests and requests without Origin cannot send mail', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(inquiry(), { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await f.request(inquiry(), { headers: { Origin: '' } })).status, 403);
  assert.equal(f.calls.length, 0);
});

test('unconfigured form reports unavailable without leaking config or claiming success', async t => {
  const f = await fixture(t, { env: { NODE_ENV: 'test', PUBLIC_ORIGIN: env.PUBLIC_ORIGIN } });
  const config = await fetch(f.base + '/api/contact/config');
  assert.deepEqual(await config.json(), { enabled: false });
  assert.equal((await f.request()).status, 503); assert.equal(f.calls.length, 0);
});

test('honeypot submission is rejected without contacting the provider', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ ...inquiry(), website_url: 'spam.example' })).status, 400);
  assert.equal(f.calls.length, 0);
});

test('refresh failures including revoked authorization never send or leak details', async t => {
  for (const fail of [async () => Response.json({ error: 'invalid_grant', error_description: 'secret-debug' }, { status: 400 }),
    async () => new Response('secret-provider-debug', { status: 401 }),
    async () => { throw new Error('secret-network-debug'); }, async () => Response.json({}),
    async () => Response.json({ access_token: 'test-access', expires_in: 3600, token_type: 'Bearer', scope: GMAIL_SCOPE + ' other' })]) {
    let calls = 0;
    const f = await fixture(t, { fetchImpl: async url => { calls++; assert.equal(url, TOKEN_URL); return fail(); } });
    const response = await f.request(); assert.equal(response.status, 503);
    const body = await response.text(); assert.match(body, /has not been sent/);
    assert.doesNotMatch(body, /secret-|test-refresh|test-access|invalid_grant|"ok"/);
    assert.equal(calls, 1);
  }
});

test('Gmail HTTP errors never return success, leak details or automatically retry', async t => {
  for (const status of [401, 403, 429, 500, 503]) {
    let sends = 0;
    const f = await fixture(t, { fetchImpl: async url => {
      if (url === TOKEN_URL) return tokenResponse();
      sends++; return new Response('secret-provider-debug', { status });
    } });
    const response = await f.request(); assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /secret-|test-access|"ok"/);
    assert.equal(sends, 1);
  }
});

test('concurrent and repeated submissions share one confirmed send; changes send separately', async t => {
  const f = await fixture(t); const data = inquiry();
  const responses = await Promise.all([f.request(data), f.request(data)]);
  for (const response of responses) assert.equal(response.status, 200);
  assert.equal((await f.request(data)).status, 200);
  assert.equal((await f.request({ ...data, goal: 'A different goal.' })).status, 200);
  assert.equal(f.calls.filter(call => call.url === TOKEN_URL).length, 1);
  assert.equal(f.calls.length, 3);
});

test('ambiguous send failures are retained and never retried for the same inquiry', async t => {
  for (const fail of [async () => { throw new Error('secret-network-debug'); },
    async () => Response.json({}), async () => new Response('{broken', { status: 200 }),
    async () => Response.json({ id: 123 }), async () => new Response('secret-debug', { status: 503 })]) {
    let sends = 0;
    const f = await fixture(t, { fetchImpl: async url => {
      if (url === TOKEN_URL) return tokenResponse();
      sends++; return fail();
    } });
    const data = inquiry();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.request(data); assert.equal(response.status, 502);
      const body = await response.text(); assert.match(body, /may have been sent/);
      assert.doesNotMatch(body, /secret-|test-access|"ok"/);
    }
    assert.equal(sends, 1);
  }
});

test('Unicode and newlines in content round-trip through MIME without injecting headers', async t => {
  const f = await fixture(t);
  const data = { ...inquiry(), name: 'Zoë 🌍\r\nBcc: evil@example.net', company: '東京',
    goal: 'Hello 👋\nCafé — partnership', email: 'alex@bücher.example' };
  assert.equal((await f.request(data)).status, 200);
  const raw = JSON.parse(f.calls[1].body).raw;
  assert.match(raw, /^[a-zA-Z0-9_-]+$/);
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  const [headers, encoded] = mime.split('\r\n\r\n');
  assert.doesNotMatch(headers, /Bcc:|evil|Zoë|東京/);
  assert.match(headers, /Reply-To: alex@xn--bcher-kva.example/);
  const subject = headers.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1];
  assert.equal(Buffer.from(subject, 'base64').toString(), 'mirel-media: advertiser inquiry');
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  assert.match(decoded, /Zoë 🌍\r\nBcc: evil@example.net/);
  assert.match(decoded, /東京/); assert.match(decoded, /Hello 👋\r\nCafé — partnership/);
  for (const line of encoded.split('\r\n')) assert.ok(line.length <= 76);
});

test('access tokens are cached, refreshed before expiry and shared during concurrent refresh', async () => {
  let now = 0; let refreshes = 0; let sends = 0;
  const send = createInquirySender(readConfig(env), { now: () => now, fetchImpl: async url => {
    if (url === TOKEN_URL) { refreshes++; return tokenResponse(); }
    sends++; return Response.json({ id: 'test-id' });
  } });
  await Promise.all([send(inquiry()), send(inquiry())]);
  assert.equal(refreshes, 1); assert.equal(sends, 2);
  now = 3_541_000;
  await send(inquiry()); assert.equal(refreshes, 2); assert.equal(sends, 3);
});

test('401 invalidates cached token but requires an explicit new attempt to refresh and send', async () => {
  let refreshes = 0; let sends = 0;
  const send = createInquirySender(readConfig(env), { fetchImpl: async url => {
    if (url === TOKEN_URL) { refreshes++; return tokenResponse(); }
    sends++; return sends === 1 ? new Response('', { status: 401 }) : Response.json({ id: 'test-id' });
  } });
  const data = inquiry();
  await assert.rejects(send(data), { status: 502 });
  assert.equal(refreshes, 1); assert.equal(sends, 1);
  await send(data); assert.equal(refreshes, 2); assert.equal(sends, 2);
});

test('actual abort signals bound token refresh and send, including response-body timeouts', async () => {
  // Keep the test loop alive; AbortSignal.timeout intentionally uses an unref timer.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    for (const stage of ['token', 'send', 'body']) {
      let sends = 0;
      const waitForAbort = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      const send = createInquirySender(readConfig(env), { tokenTimeoutMs: 10, sendTimeoutMs: 10, fetchImpl: async (url, options) => {
        if (url === TOKEN_URL) return stage === 'token' ? waitForAbort(options.signal) : tokenResponse();
        sends++;
        return stage === 'body' ? { ok: true, json: () => waitForAbort(options.signal) } : waitForAbort(options.signal);
      } });
      const data = inquiry();
      await assert.rejects(send(data), { status: stage === 'token' ? 503 : 502 });
      if (stage !== 'token') await assert.rejects(send(data), /may have been sent/);
      assert.equal(sends, stage === 'token' ? 0 : 1);
    }
  } finally { clearInterval(keepAlive); }
});

test('duplicate cache is bounded, fails closed at capacity and expires', async () => {
  let now = 0; let sends = 0;
  const send = createInquirySender(readConfig(env), { now: () => now, maxEntries: 1, retentionMs: 1000,
    fetchImpl: async url => {
      if (url === TOKEN_URL) return tokenResponse();
      sends++; return Response.json({ id: 'test-id' });
    } });
  const data = inquiry(); await send(data); await send(data);
  await assert.rejects(send(inquiry()), { status: 503 }); assert.equal(sends, 1);
  now = 1001; await send(data); assert.equal(sends, 2);
});

test('rate limit blocks repeat attempts and expires after its window', () => {
  let now = 100; const allow = createRateLimiter({ now: () => now, windowMs: 1000, limit: 2, maxEntries: 2 });
  assert.equal(allow('one'), true); assert.equal(allow('one'), true); assert.equal(allow('one'), false);
  assert.equal(allow('two'), true); assert.equal(allow('three'), false);
  now = 1101; assert.equal(allow('one'), true); assert.equal(allow('three'), true);
});

test('rate-limited HTTP submissions return Retry-After without sending', async t => {
  const f = await fixture(t, { limiter: () => false });
  const response = await f.request(); assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '600'); assert.equal(f.calls.length, 0);
});

test('malformed, oversized, non-JSON and unsupported method requests are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request(null, { body: '{broken' })).status, 400);
  assert.equal((await f.request(null, { body: 'x'.repeat(17_000) })).status, 413);
  assert.equal((await f.request(inquiry(), { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.request(null, { method: 'GET' })).status, 405);
  assert.equal(f.calls.length, 0);
});

test('static routes serve assets but never secrets or source files', async t => {
  const f = await fixture(t);
  const page = await fetch(f.base); assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>mirel-media/);
  assert.match(page.headers.get('content-security-policy'), /form-action 'self'/);
  for (const asset of ['/app.js', '/styles.css', '/brand.css', '/assets/favicon.svg', '/assets/growth-sculpture.png'])
    assert.equal((await fetch(f.base + asset)).status, 200, asset);
  for (const forbidden of ['/.env', '/server.mjs', '/package.json', '/%2e%2e%2f.env', '/assets/%2e%2e%2f%2eenv', '/missing', '/api/missing'])
    assert.equal((await fetch(f.base + forbidden)).status, 404, forbidden);
  assert.equal((await fetch(f.base + '/healthz')).status, 200);
});

test('config requires a secure production origin and valid mail addresses', () => {
  assert.throws(() => readConfig({ ...env, NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => readConfig({ ...env, PUBLIC_ORIGIN: 'https://example.com/path' }), /origin/);
  assert.equal(readConfig({ ...env, CONTACT_TO: 'bad' }).configured, false);
  assert.equal(readConfig({ ...env, GMAIL_SENDER: 'bad\r\nBcc: bad@example.com' }).configured, false);
  assert.equal(readConfig({ ...env, GMAIL_SENDER: 'other@example.com' }).configured, false);
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'])
    assert.equal(readConfig({ ...env, [key]: '' }).configured, false);
  assert.equal(readConfig({ ...env, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://example.com' }).configured, true);
});

test('proxy header is ignored unless explicitly trusted', async t => {
  const seen = []; const f = await fixture(t, { limiter: address => { seen.push(address); return false; } });
  await f.request(inquiry(), { headers: { 'X-Forwarded-For': '203.0.113.10' } });
  assert.notEqual(seen[0], '203.0.113.10');
  const trusted = await fixture(t, { env: { ...env, TRUST_PROXY: 'true' }, limiter: address => { seen.push(address); return false; } });
  await trusted.request(inquiry(), { headers: { 'X-Forwarded-For': '192.0.2.9, 203.0.113.10' } });
  assert.equal(seen[1], '203.0.113.10');
});
