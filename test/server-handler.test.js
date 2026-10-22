import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { GMAIL_SCOPE, TOKEN_URL } from '../src/contact.js';

const origin = 'http://localhost:3000';
const envKeys = ['NODE_ENV', 'PUBLIC_ORIGIN', 'EMAIL_PROVIDER', 'CONTACT_FROM', 'CONTACT_TO',
  'RESEND_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GMAIL_SENDER', 'TRUST_PROXY'];
const resend = { RESEND_API_KEY: 'test-key', CONTACT_FROM: 'sender@example.com', CONTACT_TO: 'inbox@example.net' };
const inquiry = () => ({ name: 'Alex Taylor', email: 'alex@example.org', company: 'Example',
  goal: 'Discuss a campaign.', partner_role: 'Advertiser', interest: 'Lead generation',
  request_id: randomUUID(), website_url: '' });

// Fresh imports isolate each process-level singleton. Never load the private .env.
async function fixture(t, settings = {}, fetchImpl = async () => assert.fail('Unexpected provider request')) {
  const previous = new Map(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'test', PUBLIC_ORIGIN: origin }, settings);
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(globalThis, 'fetch', fetchImpl);
  const { default: handler } = await import(`../server.js?handler-test=${randomUUID()}`);
  assert.equal(typeof handler, 'function');
  return handler;
}

async function invoke(handler, { url = '/healthz', method = 'GET', body, rawBody, replay = false, headers = {}, ip = '127.0.0.1' } = {}) {
  const bytes = rawBody ?? (body === undefined ? undefined : Buffer.from(JSON.stringify(body)));
  const req = Readable.from(bytes === undefined ? [] : [bytes]);
  if (replay) {
    for await (const chunk of req) { void chunk; }
    // Match Vercel's addHelpers body replay after it consumes the IncomingMessage.
    const stream = new PassThrough();
    const on = req.on.bind(req);
    req.read = stream.read.bind(stream);
    req.on = req.addListener = (event, listener) => ['data', 'end'].includes(event)
      ? stream.on(event, listener) : on(event, listener);
    stream.end(bytes);
  }
  Object.assign(req, { url, method, headers: { origin, 'content-type': 'application/json', ...headers },
    socket: { remoteAddress: ip } });
  const res = {
    headersSent: false, writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; return this; },
    end(data) { this.body = Buffer.from(data ?? ''); this.writableEnded = true; return this; }
  };
  await handler(req, res);
  assert.equal(res.writableEnded, true, 'The exported handler must await asynchronous routing, not emit an event and return');
  return res;
}

test('default export imports without configuration, listeners or signal handlers and initializes lazily', async t => {
  const signals = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  t.mock.method(http, 'createServer', () => assert.fail('Import/default requests must not create a listening server'));
  const handler = await fixture(t, { NODE_ENV: 'production', PUBLIC_ORIGIN: 'invalid' });
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), signals);
  // Valid settings supplied after import must be used at first invocation.
  process.env.PUBLIC_ORIGIN = 'https://site.example';
  assert.equal((await invoke(handler)).status, 200);
  process.env.PUBLIC_ORIGIN = 'invalid';
  assert.equal((await invoke(handler)).status, 200, 'Subsequent requests reuse initialized configuration');
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), signals);
});

test('default export awaits static reads and serves the homepage, assets, health and unavailable config', async t => {
  const handler = await fixture(t);
  for (const [url, file, contentType] of [
    ['/', 'index.html', 'text/html'], ['/styles.css', 'styles.css', 'text/css'],
    ['/contact.js', 'contact.js', 'text/javascript'], ['/assets/hero-sculpture.png', 'assets/hero-sculpture.png', 'image/png']
  ]) {
    const res = await invoke(handler, { url });
    assert.equal(res.status, 200); assert(res.headers['Content-Type'].startsWith(contentType));
    assert.deepEqual(res.body, await readFile(new URL('../public/' + file, import.meta.url)));
  }
  assert.equal((await invoke(handler, { url: '/', method: 'HEAD' })).body.length, 0);
  assert.deepEqual(JSON.parse((await invoke(handler)).body), { status: 'ok' });
  assert.deepEqual(JSON.parse((await invoke(handler, { url: '/api/contact/config' })).body), { enabled: false });
  const unavailable = await invoke(handler, { url: '/api/contact', method: 'POST', body: inquiry() });
  assert.equal(unavailable.status, 503); assert.match(unavailable.body.toString(), /temporarily unavailable/);
  assert.equal((await invoke(handler, { url: '/.env' })).status, 404);
});

test('default export enforces validation and origin protection with configured Resend', async t => {
  const calls = [];
  const handler = await fixture(t, resend, async (url, options) => {
    calls.push({ url, options }); return Response.json({ id: 'accepted-test-id' });
  });
  const post = options => invoke(handler, { url: '/api/contact', method: 'POST', body: inquiry(), ...options });
  assert.deepEqual(JSON.parse((await invoke(handler, { url: '/api/contact/config' })).body), { enabled: true });
  for (const invalidOrigin of ['', 'https://unrelated.example'])
    assert.equal((await post({ headers: { origin: invalidOrigin } })).status, 403);
  for (const patch of [{ email: 'bad' }, { goal: ' ' }, { website_url: 'spam' }])
    assert.equal((await post({ body: { ...inquiry(), ...patch } })).status, 400);
  assert.equal(calls.length, 0);
  const data = { ...inquiry(), to: 'untrusted@example.com', from: 'untrusted@example.com' };
  assert.equal((await post({ body: data })).status, 200);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.resend.com/emails');
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.from, resend.CONTACT_FROM); assert.equal(payload.to, resend.CONTACT_TO);
  assert.equal(payload.reply_to, data.email);
});

test('default export retains duplicate suppression and rate-limit state across requests', async t => {
  let calls = 0;
  const handler = await fixture(t, resend, async () => { calls++; return Response.json({ id: 'accepted-test-id' }); });
  const body = inquiry();
  const results = await Promise.all(Array.from({ length: 3 }, () => invoke(handler, { url: '/api/contact', method: 'POST', body })));
  assert(results.every(res => res.status === 200)); assert.equal(calls, 1);
  for (let i = 0; i < 2; i++) assert.equal((await invoke(handler, { url: '/api/contact', method: 'POST', body: inquiry() })).status, 200);
  const limited = await invoke(handler, { url: '/api/contact', method: 'POST', body: inquiry() });
  assert.equal(limited.status, 429); assert.equal(limited.headers['Retry-After'], '600'); assert.equal(calls, 3);
});

test('default export accepts Vercel body replay and preserves malformed/oversized body rejection', async t => {
  let calls = 0;
  const handler = await fixture(t, resend, async () => { calls++; return Response.json({ id: 'accepted-test-id' }); });
  const post = options => invoke(handler, { url: '/api/contact', method: 'POST', replay: true, ...options });
  assert.equal((await post({ body: inquiry() })).status, 200);
  assert.equal((await post({ rawBody: Buffer.from('{broken') })).status, 400);
  // No Content-Length: the application must still enforce its byte limit.
  assert.equal((await post({ rawBody: Buffer.from(' '.repeat(16_385)) })).status, 413);
  assert.equal(calls, 1);
});

test('default export awaits Gmail acceptance and reuses the token cache and pending submission', async t => {
  let tokens = 0, sends = 0, release;
  const delayed = new Promise(resolve => { release = resolve; });
  const handler = await fixture(t, { EMAIL_PROVIDER: 'gmail', GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REFRESH_TOKEN: 'test-refresh',
    GMAIL_SENDER: 'sender@example.com', CONTACT_TO: 'inbox@example.net' }, async url => {
    if (url === TOKEN_URL) { tokens++; return Response.json({ access_token: 'test-access', expires_in: 3600, token_type: 'Bearer', scope: GMAIL_SCOPE }); }
    sends++; await delayed; return Response.json({ id: 'gmail-test-id' });
  });
  let settled = false;
  const body = inquiry();
  const first = invoke(handler, { url: '/api/contact', method: 'POST', body }).then(res => { settled = true; return res; });
  const duplicate = invoke(handler, { url: '/api/contact', method: 'POST', body });
  await nextTurn(); assert.equal(settled, false); assert.equal(tokens, 1); assert.equal(sends, 1);
  release(); assert.equal((await first).status, 200); assert.equal((await duplicate).status, 200);
  assert.equal((await invoke(handler, { url: '/api/contact', method: 'POST', body: inquiry() })).status, 200);
  assert.equal(tokens, 1); assert.equal(sends, 2);
});

test('default export reuses error handling and retains uncertain sends without retry', async t => {
  let calls = 0;
  const handler = await fixture(t, resend, async () => { calls++; throw new Error('private-provider-detail'); });
  const body = inquiry();
  for (let i = 0; i < 2; i++) {
    const res = await invoke(handler, { url: '/api/contact', method: 'POST', body });
    assert.equal(res.status, 502); assert.match(res.body.toString(), /may have been sent/);
    assert.doesNotMatch(res.body.toString(), /private-provider-detail/);
  }
  assert.equal(calls, 1);
});

test('direct server entry point still starts and serves HTTP without loading private configuration', { timeout: 15_000 }, async t => {
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_ENV: 'test',
      PUBLIC_ORIGIN: `http://localhost:${port}`, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } });
  let logs = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.stdout.on('data', chunk => { logs += chunk; if (logs.includes('is listening')) { clearTimeout(timeout); resolve(); } });
    child.stderr.on('data', () => { clearTimeout(timeout); reject(new Error('Unexpected startup error')); });
  });
  const response = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: 'ok' });
});
