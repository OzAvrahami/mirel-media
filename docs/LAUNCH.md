# Launch and email activation

## Current state

- Local source project and local Git repository prepared.
- All page and dynamic copy reviewed in US English; see COPY_REVIEW.md.
- Mail API implemented and tested with mocked provider responses.
- Remote GitHub repository creation, Railway deployment, sender-domain verification, recipient address and real mail delivery remain pending.
- Browser QA was unavailable. Review desktop/mobile layout, keyboard navigation and form feedback before client launch.

## Railway

1. Create a project from the private GitHub repository after it has been pushed.
2. The Dockerfile starts `server.mjs`; the health check is `/healthz`.
3. Generate or attach the intended domain.
4. Add `NODE_ENV=production`, `PUBLIC_ORIGIN` with that HTTPS origin, `RESEND_API_KEY`, `CONTACT_FROM` and `CONTACT_TO` in service variables. The host supplies `PORT`.
5. Deploy and confirm `/api/contact/config` returns `{"enabled":true}`. This indicates configuration is present, not that the provider credentials/domain have been verified by an actual send.
6. Submit one authorized test inquiry and check the intended recipient inbox and the Reply action. Check junk/spam if necessary.

The default rate limiter uses the socket address. Behind a proxy, visitors may share a limit until the trusted proxy setting is configured. Only enable `TRUST_PROXY=true` after confirming there is one trusted proxy hop that appends or overwrites the forwarded client address. The code uses the rightmost forwarded address, not an arbitrary user-supplied first address.

## Abuse controls and operational limits

Five attempts per client in ten minutes, a separate cap of 60 attempts per process in ten minutes, a honeypot, a 16 KiB body limit, field length limits, same-origin browser checks, a ten-second provider timeout and provider idempotency keys are included. Requests cannot choose arbitrary recipients or send HTML. Server logs do not print inquiry content or email addresses.

The rate limits are in memory and reset on restart. Start with one application replica. For multiple replicas or substantial abuse, replace the limiter with shared storage and add an appropriate challenge/WAF. Origin checking is a browser protection, not identity verification.

There is no database, local inquiry queue, visitor account system or marketing opt-in flow. Only the mail provider receives successful submissions. Provider failures remain visible; entered fields are preserved for a retry.

## Owner inputs

- Real recipient email address.
- Sending domain and DNS access for its verification.
- Resend sending key supplied only through local/hosting secret configuration.
- Final production domain and confirmation of the business copy.
