import { domainToASCII } from 'node:url';

// Only an addr-spec goes into Reply-To. Unicode domains become ASCII; Unicode
// message content is MIME encoded. SMTPUTF8 local parts are deliberately rejected.
export function emailAddress(value) {
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