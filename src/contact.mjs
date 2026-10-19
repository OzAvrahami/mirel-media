import { createHash } from 'node:crypto';

export const MAX_BODY_BYTES = 16_384;
const EMAIL = /^[^\s@<>\x00-\x1f\x7f,;]+@[^\s@<>\x00-\x1f\x7f,;]+\.[^\s@<>\x00-\x1f\x7f,;]+$/;
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
  const apiKey = (env.RESEND_API_KEY || '').trim();
  const from = (env.CONTACT_FROM || '').trim();
  const to = (env.CONTACT_TO || '').trim();
  const senderAddress = from.match(/^mirel-media <([^<>]+)>$/)?.[1] || from;
  const configured = Boolean(apiKey && !/[\r\n]/.test(apiKey) && EMAIL.test(senderAddress) &&
    EMAIL.test(to) && !/[\r\n]/.test(from));
  return { origin, apiKey, from, to, configured, trustProxy: env.TRUST_PROXY === 'true' };
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
  if (!EMAIL.test(data.email)) throw new ContactError(400, 'Please enter a valid email address.');
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

export async function sendInquiry(data, config, { fetchImpl = fetch } = {}) {
  const text = [
    'New inquiry for mirel-media', '', `Partner type: ${data.partner_role}`, `Interested in: ${data.interest}`,
    `Name: ${data.name}`, `Email: ${data.email}`, `Company or website: ${data.company || 'Not provided'}`,
    '', 'Message:', data.goal
  ].join('\n');
  const idempotency = createHash('sha256').update(data.request_id + '\n' + text + '\n' + config.to).digest('hex');
  let response;
  try {
    response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `mirel-media/${idempotency}` },
      body: JSON.stringify({ from: config.from, to: [config.to], reply_to: data.email,
        subject: `mirel-media: ${data.partner_role.toLowerCase()} inquiry`, text })
    });
  } catch { throw new ContactError(502, 'We could not confirm your submission. Please try again.'); }
  if (!response.ok) throw new ContactError(502, 'We could not submit your inquiry right now. Please try again shortly.');
  const result = await response.json().catch(() => null);
  if (!result?.id) throw new ContactError(502, 'We could not confirm your submission. Please try again.');
}
