import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, lstat, chmod } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GMAIL_SCOPE, TOKEN_URL } from '../src/contact.js';
import { readGmailAuthorizationConfig } from '../src/email-config.js';

// Local operator tool only. This script is not copied into the production image.
export async function startAuthorization({ clientId, clientSecret, sender, saveToken,
  fetchImpl = fetch, lifetimeMs = 300_000, tokenTimeoutMs = 10_000 } = {}) {
  ({ clientId, clientSecret, sender } = readGmailAuthorizationConfig({
    GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GMAIL_SENDER: sender
  }));
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  let finish;
  const completion = new Promise(resolve => { finish = resolve; });
  let used = false;
  let redirectUri;
  let expiry;
  const stop = result => {
    clearTimeout(expiry);
    server.close();
    finish(result);
  };
  const server = http.createServer(async (req, res) => {
    const reply = (status, text) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff', Connection: 'close' });
      res.end(text);
    };
    let url;
    try { url = new URL(req.url, redirectUri); } catch { return reply(400, 'Invalid callback URL.'); }
    if (req.method !== 'GET' || req.headers.host !== new URL(redirectUri).host || url.pathname !== '/oauth2callback')
      return reply(404, 'Not found.');
    const receivedState = Buffer.from(url.searchParams.get('state') || '');
    if (url.searchParams.getAll('state').length !== 1 || receivedState.length !== Buffer.byteLength(state) || !timingSafeEqual(receivedState, Buffer.from(state)))
      return reply(400, 'Invalid authorization state. Return to the original authorization link.');
    if (used) return reply(409, 'This authorization callback has already been used.');
    used = true;
    clearTimeout(expiry);
    try {
      const code = url.searchParams.get('code');
      if (url.searchParams.has('error') || !code || url.searchParams.getAll('code').length !== 1) throw new Error();
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(tokenTimeoutMs),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code,
          code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }).toString()
      });
      if (!response.ok) throw new Error();
      const result = await response.json();
      if (result.scope !== GMAIL_SCOPE || typeof result.refresh_token !== 'string' ||
          !/^[\x21-\x7e]+$/.test(result.refresh_token) || /["'`#\\]/.test(result.refresh_token)) throw new Error();
      await saveToken(result.refresh_token);
      reply(200, 'Authorization saved locally. No email was sent. Close this tab and return to your terminal.');
      stop(true);
    } catch {
      reply(400, 'Authorization could not be saved. Check your client, account, consent and scope settings, then run the helper again.');
      stop(false);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
  expiry = setTimeout(() => { server.closeAllConnections(); stop(false); }, lifetimeMs);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: GMAIL_SCOPE, access_type: 'offline', prompt: 'consent', login_hint: sender,
    state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { url: url.href, completion, close: () => { server.closeAllConnections(); stop(false); } };
}

export async function saveRefreshToken(filename, token) {
  if (typeof token !== 'string' || !/^[\x21-\x7e]+$/.test(token) || /["'`#\\]/.test(token))
    throw new Error('Invalid token format.');
  // Refuse symlinks and preserve every unrelated .env setting. Never print tokens.
  if (!(await lstat(filename)).isFile()) throw new Error('Expected an existing regular .env file.');
  const existing = await readFile(filename, 'utf8');
  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const lines = existing.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?GOOGLE_REFRESH_TOKEN\s*=/.test(line));
  const next = lines.join(newline).replace(/\s*$/, '') + `${newline}GOOGLE_REFRESH_TOKEN=${token}${newline}`;
  await chmod(filename, 0o600);
  await writeFile(filename, next, { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const filename = fileURLToPath(new URL('../.env', import.meta.url));
    const authorization = await startAuthorization({ ...readGmailAuthorizationConfig(process.env),
      saveToken: token => saveRefreshToken(filename, token) });
    console.log('Open this URL locally within five minutes. Select the account configured in GMAIL_SENDER and approve only sending email. The login hint does not verify account identity:');
    console.log(authorization.url);
    if (await authorization.completion) {
      console.log('GOOGLE_REFRESH_TOKEN saved to the ignored local .env. Restart the server. No email was sent.');
    } else {
      console.error('Authorization failed or expired. See docs/GMAIL_SETUP.md. No token is printed.');
      process.exitCode = 1;
    }
  } catch {
    console.error('Could not start authorization. Check GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GMAIL_SENDER in the private .env and docs/GMAIL_SETUP.md.');
    process.exitCode = 1;
  }
}
