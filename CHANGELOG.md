# Changelog

## Gmail API migration — Unreleased

- Replaced the original email transport with server-only Gmail API and send-only OAuth refresh tokens.
- Added a local Desktop OAuth helper with loopback callback, state validation and PKCE.
- Locked sender and recipient to `lior@mirel-media.com`, with validated visitor Reply-To and Unicode-safe MIME.
- Added bounded process-local duplicate protection, safe timeouts, and mocked Google/OAuth tests.
- Updated English setup documentation for Google Workspace, Namecheap DNS, Cloud consent and production token requirements.
- Real Google authorization and inbox delivery remain unverified; no deployment or real email was performed.

The original implementation history below is retained as a historical record.

## 0.1.0 — Unreleased

- Established standalone mirel-media project from the approved design.
- Added a Node.js contact API with Resend integration and honest success/error states.
- Added validation, recipient restrictions, rate limiting, honeypot and idempotency support.
- Reviewed all English copy and standardized US spelling.
- Added tests, GitHub checks, Docker/Railway configuration and setup documentation.
- Pending production credentials, real mail verification and browser acceptance.
