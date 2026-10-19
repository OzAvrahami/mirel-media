import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.mjs';
import { readConfig, createRateLimiter, sendInquiry } from '../src/contact.mjs';

const env = { NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000', RESEND_API_KEY: 'test-key',
  CONTACT_FROM: 'mirel-media <forms@example.com>', CONTACT_TO: 'owner@example.com' };
const inquiry = () => ({ name: 'Alex Taylor', email: 'alex@example.net', company: 'Example Studio',
  goal: 'We would like to discuss a lead generation campaign.', partner_role: 'Advertiser',
  interest: 'Lead generation', request_id: randomUUID(), website_url: '' });

async function fixture(t, options = {}) {
  const calls = [];
  const server = createServer({ env, fetchImpl: async (url, options) => {
    calls.push({ url, ...options }); return Response.json({ id: 'test-email-id' });
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
  const f = await fixture(t); const data = inquiry(); data.to = 'attacker@example.com';
  const response = await f.request(data);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  assert.equal(f.calls.length, 1);
  const sent = JSON.parse(f.calls[0].body);
  assert.deepEqual(sent.to, ['owner@example.com']); assert.equal(sent.reply_to, data.email);
  assert.match(sent.text, /Alex Taylor/); assert.match(sent.text, /Lead generation/);
  assert.equal(sent.html, undefined); assert.equal(f.calls[0].url, 'https://api.resend.com/emails');
});

test('invalid email, whitespace, enums, lengths and request IDs are rejected before sending', async t => {
  const f = await fixture(t, { limiter: () => true });
  for (const patch of [{ email: 'bad' }, { email: 'a@example.com\r\nBcc: other@example.com' }, { name: '   ' },
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

test('mail provider errors and timeouts never return success or leak internal details', async t => {
  for (const fetchImpl of [async () => new Response('secret-provider-debug', { status: 401 }),
    async () => { throw new Error('secret-network-debug'); }, async () => Response.json({})]) {
    const f = await fixture(t, { fetchImpl });
    const response = await f.request(); assert.equal(response.status, 502);
    const body = await response.text(); assert.doesNotMatch(body, /secret-|test-key|"ok"/);
  }
});

test('same retry uses a stable idempotency key; changed message uses a new one', async () => {
  const headers = []; const data = inquiry(); const config = readConfig(env);
  const transport = { fetchImpl: async (_, options) => { headers.push(options.headers); return Response.json({ id: 'test-id' }); } };
  await sendInquiry(data, config, transport); await sendInquiry(data, config, transport);
  await sendInquiry({ ...data, goal: 'A different goal.' }, config, transport);
  assert.equal(headers[0]['Idempotency-Key'], headers[1]['Idempotency-Key']);
  assert.notEqual(headers[0]['Idempotency-Key'], headers[2]['Idempotency-Key']);
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
  assert.equal(readConfig({ ...env, CONTACT_FROM: 'bad\r\nBcc: bad@example.com' }).configured, false);
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
