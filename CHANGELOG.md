# Changelog

## Provider switching and compact layout — Unreleased

- Completed Resend as the default transport with an environment-selected Gmail alternative, selected-provider validation, configurable addressing and conservative error handling.
- Shared the stable outgoing payload with Resend fingerprinting/idempotency; retained bounded duplicate suppression and Gmail send-only OAuth protections.
- Made local Gmail authorization independent of provider selection and an existing refresh token.
- Renamed project-owned ES modules, scripts and tests to `.js` and updated runtime, Docker and documentation references.
- Reduced responsive typography, brand/sculpture sizing, artwork height and section spacing while preserving readable controls and motion behavior.
- Added mocked provider/configuration/error coverage; no live email, deployment or private environment changes.

The entries below describe earlier implementations. Provider selection and configurable addresses above supersede the former Gmail-only restrictions.

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
