# Launch and email activation

## Current state

The existing GitHub/Railway application is preserved. This local change does not deploy or change Railway settings. Provider switching and responsive design have mocked/local checks; real API credentials and inbox delivery still require separate operator verification. See [EMAIL_SETUP.md](EMAIL_SETUP.md) and [GMAIL_SETUP.md](GMAIL_SETUP.md).

## Railway

Before publishing the public `mailto:lior@mirel-media.com` link, activate that mailbox or configure forwarding and verify receipt separately. The owner reports local Resend form delivery working; that does not activate the public business mailbox. Public contact links do not change the server-configured `CONTACT_TO`, sender or visitor Reply-To.

- Repository-managed Docker/npm startup uses `server.js`; the health check remains `/healthz`. Keep the current domain target port **8080**, host-provided `PORT`, and deployment policy unchanged.
- If an external Railway start-command override references the former server entry point, update it to `node server.js` when releasing. Overrides using `npm start` need no change. This task does not modify the external override.
- Configure `NODE_ENV=production`, the exact HTTPS `PUBLIC_ORIGIN`, and private variables for the selected provider. `EMAIL_PROVIDER` defaults to Resend; explicitly select Gmail to retain Gmail delivery. Restart after changing values. Never expose mail variables in frontend builds.
- Check `/api/contact/config` for local configuration readiness, not credential validity or delivery. Invalid mail settings leave the website and `/healthz` running. The local OAuth helper is not included in the Docker image.
- Perform a real inquiry/inbox/Reply-To check only when the operator authorizes live delivery testing. No automated check sends email.

Only enable `TRUST_PROXY=true` after confirming one trusted proxy hop appends or overwrites the forwarded address. The limiter uses the rightmost forwarded address; otherwise it uses the socket address. Preserve the existing production setting.

## Abuse controls and operational limits

Five attempts per client in ten minutes, a separate 60-attempt process cap, honeypot, 16 KiB request limit, field lengths and same-origin checks are retained. Token refresh times out after five seconds; either provider send times out after ten seconds, including response reading. Visitors cannot choose sender, recipient or provider. No raw response bodies, inquiry content or credentials are logged.

Gmail access tokens stay in server memory. Concurrent requests share refreshes; 401 invalidates the cached token. Subsequent explicit attempts may refresh, but no failed request is automatically retried. Revoked authorization requires operator repair. The helper requests only gmail.send with state and PKCE, never reading permissions or domain-wide delegation.

Both providers return success only after a valid message ID. This confirms API acceptance, not recipient delivery. Ordinary 4xx rejections allow an explicit later attempt. HTTP 408/5xx, malformed successful responses, network timeouts and Resend 409 conflicts are treated as uncertain. There is no automatic fallback or resend queue.

The process stores at most 10,000 pending/confirmed/uncertain submission fingerprints. Pending entries do not expire mid-send; completed results remain for 24 hours. At capacity new submissions fail closed. Identical request ID and payload share one result. Definitive pre-send failures and rejections are removed for explicit retry. Rate limits apply even to duplicates.

Resend also receives this fingerprint as its idempotency key, protecting identical payloads across processes for the provider's 24-hour window. It includes provider, configured sender, recipient, visitor Reply-To, subject and text. Changing any of these or the request ID creates a different submission. Idempotency conflicts are retained as uncertain, never bypassed with a new key. See [provider-specific details](EMAIL_SETUP.md#errors-and-duplicate-protection).

Gmail has no documented idempotency key. Its stable MIME Message-ID is correlation only. Process restarts, deployments, multiple replicas, expiry or changing provider/content/request ID can therefore permit duplicates. Local rate limits also reset on restart. Start with one replica and use shared durable coordination before promising stronger guarantees. Origin checks protect browser requests; they are not identity verification.

There is no database or persisted inquiry queue. Mail passes only to the selected provider. Failure preserves form fields. An uncertain result warns that another submission could duplicate a message; inspect the mailbox/provider before retrying. The application cannot read the mailbox.
