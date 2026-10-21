# Email providers

All mail runs on the server. `EMAIL_PROVIDER=resend` is the default; use `EMAIL_PROVIDER=gmail` for the alternative. Case and surrounding whitespace are normalized. An omitted/empty value selects Resend even if Gmail credentials exist. Unknown values disable sending and log a configuration error without echoing the value. The homepage and health endpoint continue working.

## Resend setup

1. Create/select a Resend account. Add a sending domain you control and follow its [domain verification instructions](https://resend.com/docs/dashboard/domains/introduction). At Namecheap, edit the authoritative DNS records shown by Resend. Preserve website records and existing mailbox routing, including Google Workspace MX records.
2. Create a sending API key, restricted to the required domain where available. Store it privately as `RESEND_API_KEY`. Never put secrets in Git, chat, screenshots or browser code.
3. Set `EMAIL_PROVIDER=resend`, `CONTACT_FROM` to a sender on the verified domain, and `CONTACT_TO` to the intended recipient. They can differ. Both must be plain email addresses without display names or lists. Account/testing restrictions may limit recipients until verification is complete.
4. Preserve the existing `.env`; add/update values in a local editor. On hosting, use private runtime variables. Set the correct `PUBLIC_ORIGIN`, then restart the server. No Google credentials are required for Resend.
5. `/api/contact/config` exposes only `enabled`: local configuration validation, not API-key verification. `/healthz` indicates server health, not mail readiness. Startup diagnostics name settings but never print their values or raw provider responses.

The server sends plain text through [Resend's send API](https://resend.com/docs/api-reference/emails/send-email). Visitors cannot choose sender, recipient or provider. Their validated email becomes Reply-To. Success requires a valid message ID; API acceptance does not prove inbox delivery.

## Gmail alternative

Set `EMAIL_PROVIDER=gmail` and supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GMAIL_SENDER` and `CONTACT_TO`. Follow [GMAIL_SETUP.md](GMAIL_SETUP.md). Resend credentials and `CONTACT_FROM` are ignored by the Gmail runtime.

The helper reads the Gmail sender and client credentials even when Resend is selected. It needs no existing refresh token. It requests only `gmail.send`, validates state and PKCE, and never sends a test email. Select the intended mailbox yourself: the account hint is not identity verification. Runtime sends address that explicit Gmail user, not `me`.

## Errors and duplicate protection

- No automatic retries or provider fallback, including authentication failures.
- Definite 4xx rejections (authentication, validation, quota/rate limits) return a generic error; an explicit later attempt is possible. Gmail 401 also clears its cached access token.
- Network failures, timeouts, HTTP 408/5xx, malformed success responses and Resend 409 conflicts remain uncertain and are cached. `concurrent_idempotent_requests` can mean another send is running; `invalid_idempotent_request` means a key was used with different content. Neither is success. The application never rotates the key or retries to work around a conflict. See [Resend error definitions](https://resend.com/docs/api-reference/errors).
- The SHA-256 fingerprint includes request ID, provider and complete stable payload: configured sender/recipient, Reply-To, subject and text. It is Resend's `Idempotency-Key`. Fingerprinting and request serialization share a function, so a reused key describes an identical payload. Changing sender, recipient or content changes the key.
- [Resend retains keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys), protecting identical requests across restarts/replicas during that window. Local suppression retains confirmed and uncertain results for 24 hours after completion, with a bounded 10,000-entry cache. Gmail has no provider idempotency key.
- Changing provider, payload or request ID, or retrying after retention, can send another message. Do not switch providers to recover an uncertain send without checking the provider/mailbox manually. The application cannot inspect a mailbox or confirm final delivery.

## Manual delivery verification

Automated tests use mocked endpoints and never load private credentials. No real email is sent by checks. Once an operator configures the selected provider and authorizes a live test, submit one inquiry, confirm API acceptance, then separately check the recipient inbox/spam folder and Reply-To behavior. For an uncertain outcome, inspect the provider dashboard/mailbox before retrying. Keep this separate from implementation review.
