# mirel-media

English-language performance marketing, lead generation and traffic partnerships website. Plain HTML/CSS/JavaScript and a Node.js 24 server; no runtime packages or database. Project JavaScript uses ES modules (`"type": "module"`).

## Local development

```powershell
Set-Location D:\code\mirel-media
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open http://localhost:3000. Preserve existing private `.env` values. Without valid selected-provider settings, the website and `/healthz` remain available while the form reports that it is unavailable.

## Email selection

`EMAIL_PROVIDER` selects `resend` (default) or `gmail`. Names are trimmed and lowercased; missing, empty or whitespace-only values select Resend. Unknown providers disable the form and produce a server-only configuration diagnostic. Only the selected provider's credentials are validated. Restart after changing settings. There is no public toggle or automatic fallback.

| Provider | Required server variables |
| --- | --- |
| Resend | `RESEND_API_KEY`, `CONTACT_FROM`, `CONTACT_TO` |
| Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GMAIL_SENDER`, `CONTACT_TO` |

Follow [email setup](docs/EMAIL_SETUP.md) or [Gmail setup](docs/GMAIL_SETUP.md). Sender and recipient may be different valid addresses, configured only on the server. The validated visitor address is Reply-To. The Gmail helper reads `GMAIL_SENDER` independently of the selected provider and does not require an existing refresh token.

`PUBLIC_ORIGIN` must match the exact site origin (HTTPS in production). Set `NODE_ENV=production` when hosted. The server honors the host's `PORT`, defaulting to 3000 locally. Keep `TRUST_PROXY=false` unless the proxy behavior in [the launch guide](docs/LAUNCH.md) is confirmed.

Success requires a valid provider message ID and means API acceptance, not confirmed inbox delivery. Uncertain sends are not automatically retried. Resend uses the submission fingerprint as its idempotency key. See [operational limits](docs/LAUNCH.md#abuse-controls-and-operational-limits).

## Validation

```text
npm run check
npm test
```

Tests mock both providers and never load private `.env` values, send real email or deploy. They cover configuration isolation, configured addressing, HTTP protections, token refresh, Unicode, errors, timeouts, duplicate protection, the OAuth helper and production client behavior. Browser review uses a credential-free local preview. Live authorization and inbox delivery require separate manual verification.

## Hosting and structure

Use the existing GitHub/Railway workflow. This local change does not deploy. Docker and npm start `server.js`; `/healthz` remains the health endpoint. Preserve Railway's working target port 8080 and environment settings. If an external start-command override still names the former entry point, update it to `node server.js` when releasing. Repository-managed commands are already updated.

| Path | Purpose |
| --- | --- |
| `public/` | Site, responsive styles, artwork and client interactions |
| `server.js` | Static server, contact routing and HTTP protections |
| `src/contact.js` | Validation, Gmail transport, dispatch and duplicate protection |
| `src/email-config.js` | Selected-provider and helper configuration |
| `src/email-address.js` | Shared address validation |
| `src/resend.js` | Resend request serialization and transport |
| `scripts/gmail-authorize.js` | Local loopback OAuth with state and PKCE |
| `scripts/check.js`, `test/` | Checks and mocked tests |
| `docs/` | Setup and operational guidance |

The website presents mirel-media, with Lior Idan listed as the direct contact. The public business email requires activation or forwarding before publication; see [the launch guide](docs/LAUNCH.md). No client results, testimonials or guarantees are invented. Self-hosted fonts retain their license in `public/assets/FONT-LICENSE.txt`. No analytics or third-party browser scripts are included.
