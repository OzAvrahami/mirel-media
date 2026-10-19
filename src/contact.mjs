import { createHash } from 'node:crypto';
import { domainToASCII } from 'node:url';

export const MAX_BODY_BYTES = 16_384;
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const BUSINESS_MAILBOX = 'lior@mirel-media.com';
const UNAVAILABLE = 'The contact form is temporarily unavailable. Your inquiry has not been sent. Please try again later.';
const UNCERTAIN = 'We could not confirm your submission. It may have been sent. Please wait before trying again; another submission could send a duplicate.';

// Only an addr-spec goes into Reply-To. Unicode domains become ASCII; Unicode
// message content is MIME encoded. SMTPUTF8 local parts are deliberately rejected.
function emailAddress(value) {
  if (typeof value !== 'string' || /[\s\x00-\x1f\x7f]/.test(value)) return null;
  const parts = value.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!/^[\p{L}\p{N}\p{M}.-]+$/u.test(domain)) return null;
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i.test(local) || local.length > 64 ||
      local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const ascii = domainToASCII(domain);
  if (!ascii || ascii.length > 253 || !ascii.includes('.') ||
      !ascii.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
  return `${local}@${ascii}`;
}
const ROLES = new Set(['Advertiser', 'Publisher', 'Other']);
const INTERESTS = new Set(['Paid media', 'Lead generation', 'Traffic partnerships']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ContactError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function readConfig(env) {
  let origin;
  try {
    const url = new URL(env.PUBLIC_ORIGIN || 'http://localhost:3000');
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && local && url.protocol === 'http:'))) throw new Error();
    origin = url.origin;
  } catch { throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (localhost HTTP is allowed in development).'); }
  const clientId = (env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = (env.GOOGLE_REFRESH_TOKEN || '').trim();
  const from = (env.GMAIL_SENDER || '').trim();
  const to = (env.CONTACT_TO || '').trim();
  const configured = [clientId, clientSecret, refreshToken].every(value => value && !/[\s\x00-\x1f\x7f]/.test(value)) &&
    from === BUSINESS_MAILBOX && to === BUSINESS_MAILBOX;
  return { origin, clientId, clientSecret, refreshToken, from, to, configured, trustProxy: env.TRUST_PROXY === 'true' };
}

export function validateInquiry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContactError(400, 'Please check your inquiry and try again.');
  const string = (key, max, required = true) => {
    if (typeof input[key] !== 'string') throw new ContactError(400, `Please check the ${key.replace('_', ' ')} field.`);
    const value = input[key].trim();
    if ((required && !value) || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
      throw new ContactError(400, `Please check the ${key.replace('_', ' ')} field.`);
    return value;
  };
  const data = {
    name: string('name', 100), email: string('email', 200), company: string('company', 200, false),
    goal: string('goal', 2000), partner_role: string('partner_role', 30), interest: string('interest', 40),
    request_id: string('request_id', 36), website_url: string('website_url', 200, false)
  };
  data.email = emailAddress(data.email);
  if (!data.email) throw new ContactError(400, 'Please enter a valid email address.');
  if (!ROLES.has(data.partner_role) || !INTERESTS.has(data.interest) || !UUID.test(data.request_id))
    throw new ContactError(400, 'Please refresh the page and try again.');
  return data;
}

// Bounded, single-process protection. Use a shared limiter before scaling to multiple replicas.
export function createRateLimiter({ now = Date.now, limit = 5, windowMs = 600_000, maxEntries = 10_000 } = {}) {
  const buckets = new Map();
  return key => {
    const time = now();
    for (const [id, bucket] of buckets) if (bucket.until <= time) buckets.delete(id);
    const id = createHash('sha256').update(key).digest('hex');
    let bucket = buckets.get(id);
    if (!bucket) {
      if (buckets.size >= maxEntries) return false;
      bucket = { count: 0, until: time + windowMs }; buckets.set(id, bucket);
    }
    bucket.count += 1;
    return bucket.count <= limit;
  };
}

function inquiryText(data) {
  return [
    'New inquiry for mirel-media', '', `Partner type: ${data.partner_role}`, `Interested in: ${data.interest}`,
    `Name: ${data.name}`, `Email: ${data.email}`, `Company or website: ${data.company || 'Not provided'}`,
    '', 'Message:', data.goal
  ].join('\n').replace(/\r\n|\r|\n/g, '\r\n');
}

function rawMessage(data, config, fingerprint, now) {
  const body = Buffer.from(inquiryText(data), 'utf8').toString('base64').match(/.{1,76}/g).join('\r\n');
  const subject = Buffer.from(`mirel-media: ${data.partner_role.toLowerCase()} inquiry`).toString('base64');
  return Buffer.from([
    `From: mirel-media <${config.from}>`, `To: ${config.to}`, `Reply-To: ${data.email}`,
    `Subject: =?UTF-8?B?${subject}?=`, `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${fingerprint}@mirel-media.com>`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', body, ''
  ].join('\r\n'), 'utf8').toString('base64url');
}

// One instance per server: token caching and bounded duplicate suppression are
// process-local. Gmail has no documented idempotency key; Message-ID alone is not one.
export function createInquirySender(config, {
  fetchImpl = fetch, now = Date.now, tokenTimeoutMs = 5_000, sendTimeoutMs = 10_000,
  maxEntries = 10_000, retentionMs = 86_400_000
} = {}) {
  let token = null;
  let refreshing = null;
  const submissions = new Map();
  async function accessToken() {
    if (token && token.until > now()) return token.value;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const response = await fetchImpl(TOKEN_URL, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(tokenTimeoutMs),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
              refresh_token: config.refreshToken, grant_type: 'refresh_token' }).toString()
          });
          if (!response.ok) throw new Error();
          const result = await response.json();
          if (typeof result.access_token !== 'string' || !result.access_token || /\s/.test(result.access_token) ||
              !Number.isFinite(result.expires_in) || result.expires_in <= 0 ||
              result.token_type?.toLowerCase() !== 'bearer' ||
              (result.scope !== undefined && result.scope !== GMAIL_SCOPE)) throw new Error();
          token = { value: result.access_token, until: now() + Math.max(0, result.expires_in - 60) * 1000 };
          return token.value;
        } catch { token = null; throw new ContactError(503, UNAVAILABLE); }
      })();
    }
    try { return await refreshing; } finally { refreshing = null; }
  }

  return async input => {
    if (!config.configured) throw new ContactError(503, UNAVAILABLE);
    const data = validateInquiry(input);
    if (data.website_url) throw new ContactError(400, 'We could not accept this submission.');
    const fingerprint = createHash('sha256').update(data.request_id + '\n' + inquiryText(data) + '\n' + config.to).digest('hex');
    for (const [key, entry] of submissions) if (entry.until <= now()) submissions.delete(key);
    if (submissions.has(fingerprint)) return submissions.get(fingerprint).promise;
    if (submissions.size >= maxEntries) throw new ContactError(503, UNAVAILABLE);
    const entry = { until: Infinity };
    // Cache the promise before performing any network I/O, including concurrent calls.
    entry.promise = Promise.resolve().then(async () => {
      let ambiguous = false;
      try {
        const bearer = await accessToken();
        const raw = rawMessage(data, config, fingerprint, now());
        ambiguous = true;
        const response = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(config.from)}/messages/send`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(sendTimeoutMs),
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw })
        });
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            ambiguous = false;
            if (response.status === 401) token = null;
            throw new ContactError(502, 'We could not submit your inquiry right now. Please try again later.');
          }
          throw new Error();
        }
        const result = await response.json();
        if (typeof result?.id !== 'string' || !result.id.trim()) throw new Error();
      } catch (error) {
        if (ambiguous) throw new ContactError(502, UNCERTAIN);
        submissions.delete(fingerprint);
        throw error;
      } finally { entry.until = now() + retentionMs; }
    });
    submissions.set(fingerprint, entry);
    return entry.promise;
  };
}
