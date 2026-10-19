# Launch and email activation

## Current state

- Local source project and local Git repository prepared.
- All page and dynamic copy reviewed in US English; see COPY_REVIEW.md.
- Mail API implemented and tested with mocked provider responses.
- Google Workspace mailbox setup, DNS activation, Google Cloud/OAuth configuration and real mail delivery remain pending. The intended sender and recipient are both `lior@mirel-media.com`.
- This migration does not create remote repositories, deploy to Railway, or change existing hosting workflows.
- Browser QA was unavailable. Review desktop/mobile layout, keyboard navigation and form feedback before client launch.

## Railway

1. Create a project from the private GitHub repository after it has been pushed.
2. The Dockerfile starts `server.mjs`; the health check is `/healthz`.
3. Generate or attach the intended domain.
4. Complete [Gmail setup](GMAIL_SETUP.md). Add `NODE_ENV=production`, `PUBLIC_ORIGIN` with that HTTPS origin, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GMAIL_SENDER=lior@mirel-media.com` and `CONTACT_TO=lior@mirel-media.com` in private service variables. The host supplies `PORT`. Remove obsolete provider variables from the host.
5. When you are ready to deploy, confirm `/api/contact/config` returns `{"enabled":true}`. This indicates configuration is present, not that Google authorization or delivery has been verified. The OAuth helper runs only on your local computer and is not included in the Docker image.
6. Submit one authorized test inquiry and check the intended recipient inbox and the Reply action. Check junk/spam if necessary.

The default rate limiter uses the socket address. Behind a proxy, visitors may share a limit until the trusted proxy setting is configured. Only enable `TRUST_PROXY=true` after confirming there is one trusted proxy hop that appends or overwrites the forwarded client address. The code uses the rightmost forwarded address, not an arbitrary user-supplied first address.

## Abuse controls and operational limits

Five attempts per client in ten minutes, a separate cap of 60 attempts per process in ten minutes, a honeypot, a 16 KiB body limit, field length limits and same-origin browser checks are included. Token refresh has a five-second timeout; Gmail send has a ten-second timeout including reading the response. Requests cannot choose arbitrary senders or recipients or send HTML. Server logs do not print inquiry content, Google response bodies or credentials.

Access tokens are cached only in server memory and refreshed before expiry. Concurrent requests share a refresh. There are no automatic token or send retries. A Gmail 401 clears the cached access token; a subsequent explicit submission refreshes it. Revoked/expired refresh authorization must be repaired by the operator using the local helper. Google 403/429 and other definite rejections return a generic error without exposing provider details. Network failures, send timeouts, 5xx responses and malformed success responses are treated as uncertain, never as success.

Gmail's send API has no documented idempotency-key facility. The server keeps at most 10,000 submission fingerprints/results, sharing pending requests and retaining confirmed or ambiguous results for 24 hours after completion. At capacity it refuses new submissions. Repeating an identical request ID and payload returns the original confirmed result or the original uncertain error without another send. Pre-send failures and definite API rejections may be explicitly retried. Rate limits still apply to repeat submissions.

Duplicate prevention is **not durable or shared**. Restarting, deploying, multiple replicas, expiration, or changing the payload/request ID can result in another send. The stable MIME Message-ID is for correlation and does not guarantee Gmail deduplication. After an uncertain outcome, the owner should check the mailbox manually before resubmitting; this app cannot read it. Add durable shared coordination before promising stronger guarantees. There is no automatic resend queue.

The rate limits are in memory and reset on restart. Start with one application replica. For multiple replicas or substantial abuse, replace the limiter with shared storage and add an appropriate challenge/WAF. Origin checking is a browser protection, not identity verification.

There is no database, local inquiry queue, visitor account system or marketing opt-in flow. Inquiries are transmitted to Google for delivery; the app does not persist them to disk. Provider failures remain visible and entered fields are preserved. The English uncertainty message warns that another submission could duplicate a message.

## Owner inputs

- Google Workspace account, licensed Gmail mailbox `lior@mirel-media.com`, and DNS access for `mirel-media.com`.
- A Cloud project, OAuth client and send-only refresh token supplied only through local/hosting secret configuration.
- Final production domain and confirmation of the business copy.
