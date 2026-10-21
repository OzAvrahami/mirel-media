import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { validateInquiry } from '../src/contact.js';

const source = readFileSync(new URL('../public/contact.js', import.meta.url), 'utf8');
const response = (body, ok = true) => ({ ok, json: async () => body });
const settle = () => new Promise(resolve => setImmediate(resolve));

// Test the production transport in isolation, without a browser dependency or
// network access. Actual HTML/select mapping is also checked in browser QA.
async function fixture(fetchImpl) {
  const listeners = {};
  const fields = Object.fromEntries(Object.entries({
    partner_role: 'Publisher', interest: 'Traffic partnerships', name: ' Alex Taylor ',
    email: 'alex@example.net', company: 'Example Studio', goal: ' Explore a partnership. ', website_url: ''
  }).map(([name, value]) => [name, { name, value, disabled: false, validityMessage: '',
    setCustomValidity(message) { this.validityMessage = message; } }]));
  const button = { disabled: true, firstChild: { textContent: 'Loading form… ' } };
  const status = { textContent: '', dataset: {}, focus() { this.focused = true; } };
  const attributes = new Map();
  const controls = [...Object.values(fields), button];
  const form = {
    elements: { namedItem: name => fields[name] },
    addEventListener: (event, handler) => { listeners[event] = handler; },
    reportValidity: () => !Object.values(fields).some(field => field.validityMessage),
    querySelectorAll: selector => controls.filter(control => control !== fields.interest || selector.includes('select')),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    reset() { this.resets = (this.resets || 0) + 1; }
  };
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: id => ({ 'inquiry-form': form, 'send-inquiry': button, 'form-status': status })[id] },
    fetch: (url, options) => { requests.push({ url, options }); return fetchImpl(url, options); },
    AbortSignal, crypto: { randomUUID },
    FormData: class { constructor() { return Object.entries(fields).map(([name, field]) => [name, field.value]); } }
  });
  vm.runInContext(source, context);
  await settle();
  return { form, fields, controls, button, status, requests, attributes,
    submit: () => listeners.submit({ preventDefault() {} }),
    input: field => listeners.input({ target: fields[field] }) };
}

test('client fails closed when availability is absent, false or unreachable', async () => {
  for (const fetchImpl of [async () => response({ enabled: false }), async () => response(null),
    async () => response({}, false), async () => { throw new TypeError('Network unavailable'); }]) {
    const f = await fixture(fetchImpl);
    assert.equal(f.button.disabled, true);
    assert.match(f.status.textContent, /temporarily unavailable/);
    await f.submit();
    assert.equal(f.requests.length, 1);
  }
});

test('client maps the approved fields to the production contract and locks the interest select while sending', async () => {
  let accept;
  const f = await fixture(async url => url.endsWith('/config') ? response({ enabled: true }) :
    new Promise(resolve => { accept = resolve; }));
  f.fields.company.disabled = true;
  const pending = f.submit();
  assert.equal(f.attributes.get('aria-busy'), 'true');
  assert(f.controls.every(control => control.disabled));
  await f.submit(); // A double click cannot start a second request.
  const sends = f.requests.filter(request => request.url === '/api/contact');
  assert.equal(sends.length, 1);
  const { options } = sends[0];
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Type'], 'application/json');
  const payload = JSON.parse(options.body);
  assert.equal(validateInquiry(payload).partner_role, 'Publisher');
  assert.equal(payload.interest, 'Traffic partnerships');
  assert.equal(payload.name, 'Alex Taylor');
  assert.equal(payload.website_url, '');
  assert.deepEqual(Object.keys(payload).sort(), ['company', 'email', 'goal', 'interest', 'name', 'partner_role', 'request_id', 'website_url']);
  assert.notEqual(f.status.dataset.kind, 'success');
  accept(response({ ok: true }));
  await pending;
  assert.equal(f.status.dataset.kind, 'success');
  assert.equal(f.form.resets, 1);
  assert.equal(f.fields.interest.disabled, false);
  assert.equal(f.fields.company.disabled, true);
  assert.equal(f.button.disabled, false);
  assert.equal(f.status.focused, true);
  assert.equal(f.attributes.has('aria-busy'), false);
});

test('client rejects whitespace input and allows correction before a network request', async () => {
  const f = await fixture(async url => response(url.endsWith('/config') ? { enabled: true } : { ok: true }));
  f.fields.goal.value = '   ';
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.match(f.fields.goal.validityMessage, /goal/);
  f.fields.goal.value = 'A campaign to discuss.';
  f.input('goal');
  assert.equal(f.fields.goal.validityMessage, '');
  await f.submit();
  assert.equal(f.status.dataset.kind, 'success');
});

test('client requires confirmed acceptance and shows API errors without clearing the inquiry', async () => {
  for (const reply of [response({ error: 'Please check your inquiry.' }, false), response({ ok: false }),
    { ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }]) {
    const f = await fixture(async url => url.endsWith('/config') ? response({ enabled: true }) : reply);
    await f.submit();
    assert.equal(f.status.dataset.kind, 'error');
    assert.equal(f.form.resets, undefined);
    assert.equal(f.button.disabled, false);
    assert.equal(f.fields.interest.disabled, false);
  }
});

test('client never retries ambiguous sends automatically and reuses the request ID for an explicit unchanged retry', async () => {
  const f = await fixture(async url => {
    if (url.endsWith('/config')) return response({ enabled: true });
    throw new TypeError('Connection lost');
  });
  await f.submit();
  await settle();
  assert.match(f.status.textContent, /may have been sent/);
  assert.equal(f.requests.length, 2);
  const first = JSON.parse(f.requests[1].options.body).request_id;
  await f.submit();
  assert.equal(JSON.parse(f.requests[2].options.body).request_id, first);
  f.fields.interest.value = 'Paid media';
  await f.submit();
  assert.notEqual(JSON.parse(f.requests[3].options.body).request_id, first);
  assert.equal(f.form.resets, undefined);
});
