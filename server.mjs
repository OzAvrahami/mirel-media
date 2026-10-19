import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { isIP } from 'node:net';
import { ContactError, MAX_BODY_BYTES, readConfig, validateInquiry, createInquirySender, createRateLimiter } from './src/contact.mjs';

const publicDir = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

export function createServer({ env = process.env, fetchImpl = fetch, limiter = createRateLimiter() } = {}) {
  const config = readConfig(env);
  const sendInquiry = createInquirySender(config, { fetchImpl });
  const globalLimiter = createRateLimiter({ limit: 60, windowMs: 600_000 });
  const json = (res, status, body, extra = {}) => {
    res.writeHead(status, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, config.origin);
      if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { status: 'ok' });
      if (url.pathname === '/api/contact/config' && req.method === 'GET') return json(res, 200, { enabled: config.configured });
      if (url.pathname === '/api/contact') {
        if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });
        if (req.headers.origin !== config.origin) return json(res, 403, { error: 'Please send your inquiry from this website.' });
        if (!config.configured) return json(res, 503, { error: 'The contact form is temporarily unavailable. Please try again later.' });
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Please submit the form on this website.' });
        let address = req.socket.remoteAddress || 'unknown';
        if (config.trustProxy) {
          const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1).trim();
          if (isIP(forwarded)) address = forwarded;
        }
        if (!limiter(address) || !globalLimiter('site')) return json(res, 429, { error: 'Too many attempts. Please try again in ten minutes.' }, { 'Retry-After': '600' });
        if (Number(req.headers['content-length']) > MAX_BODY_BYTES) return json(res, 413, { error: 'Your message is too long. Please shorten it.' });
        let size = 0; const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) { json(res, 413, { error: 'Your message is too long. Please shorten it.' }); req.resume(); return; }
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new ContactError(400, 'Please check your inquiry and try again.'); }
        const data = validateInquiry(input);
        if (data.website_url) return json(res, 400, { error: 'We could not accept this submission.' });
        await sendInquiry(data);
        return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid URL.' }); }
      if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part.startsWith('.')))
        return json(res, 404, { error: 'Not found.' });
      const filename = path.resolve(publicDir, decoded === '/' ? 'index.html' : `.${decoded}`);
      if (!filename.startsWith(publicDir + path.sep) && filename !== path.join(publicDir, 'index.html')) return json(res, 404, { error: 'Not found.' });
      const type = MIME[path.extname(filename)];
      if (!type) return json(res, 404, { error: 'Not found.' });
      const content = await readFile(filename).catch(() => null);
      if (!content) return json(res, 404, { error: 'Not found.' });
      res.writeHead(200, { ...HEADERS, 'Content-Type': type, 'Content-Length': content.length,
        'Cache-Control': /\.(png|woff2)$/.test(filename) ? 'public, max-age=86400' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      json(res, error instanceof ContactError ? error.status : 500,
        { error: error instanceof ContactError ? error.message : 'Something went wrong. Please try again.' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = readConfig(process.env);
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`mirel-media is listening on port ${port}.`);
    if (!config.configured) console.log('Email is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GMAIL_SENDER and CONTACT_TO. See docs/GMAIL_SETUP.md.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
