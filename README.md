# mirel-media

English-language performance marketing, lead generation and traffic partnerships website. Version 0.1.0 is a working project foundation; production email activation and browser acceptance are pending.

The approved navy, blue-grey and lilac design, original artwork, responsive layout, partner tabs and motion controls are preserved. The frontend uses plain HTML/CSS/JavaScript. A Node.js server serves the site and handles contact submissions through Gmail API. No runtime packages or database are required.

## Run locally

Requires Node.js 24 or later.

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Open http://localhost:3000. There is no dependency installation step. Until the mail settings are supplied, the site renders normally and the form visibly reports that it is unavailable. No inquiry is silently saved or reported as sent.

## Enable email

Follow [the Google Workspace and Gmail API setup guide](docs/GMAIL_SETUP.md) first. It covers creating the mailbox, Namecheap DNS, Google Cloud, consent, a Desktop OAuth client, and a local state/PKCE authorization helper. Nothing assumes those accounts or credentials already exist.

Set the following in the ignored `.env` file locally, or in the hosting service's private environment variables:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | OAuth Desktop client ID, configured only on the server and local helper. |
| `GOOGLE_CLIENT_SECRET` | Matching OAuth client secret; private environment only. |
| `GOOGLE_REFRESH_TOKEN` | Obtained with `npm run gmail:authorize`, granting only `gmail.send`. |
| `GMAIL_SENDER` | Exactly `lior@mirel-media.com`; authorize this Workspace mailbox. |
| `CONTACT_TO` | Exactly `lior@mirel-media.com`; fixed server recipient. |
| `PUBLIC_ORIGIN` | Exact website origin, e.g. `https://your-domain.com`, without a path. |
| `NODE_ENV` | `production` when hosted. |
| `PORT` | Supplied by the host; defaults to 3000 locally. |
| `TRUST_PROXY` | Defaults to `false`. Enable only with one trusted proxy that controls/appends `X-Forwarded-For`. |

Restart after changing environment values. The visitor's validated email is used only as `Reply-To`; recipients and sender are controlled on the server. Mail is UTF-8 MIME plain text. There is no automatic reply to the visitor, mailbox-reading permission, service account, or domain-wide delegation.

A successful form response requires a Gmail message ID. Acceptance does not independently confirm inbox delivery. Verify an actual submission reaches the intended inbox before launching. Never paste secrets or tokens into GitHub, chat, screenshots or the frontend. `/api/contact/config` exposes only whether settings are present, and performs no Google credential check.

Ambiguous sends are never automatically retried. Matching submissions share an in-memory result for 24 hours, including uncertain results. This protection is limited to one running process; restarting, using another replica, changing the message/request ID, or waiting beyond retention can allow duplicates. See [operational limits](docs/LAUNCH.md#abuse-controls-and-operational-limits).

## Checks

```text
npm run check
npm test
```

Focused tests cover validation, origin checks, unconfigured behavior, honeypot, token refresh/expiry/revocation, Gmail errors and timeouts, Unicode MIME, duplicate suppression, rate limiting, static file boundaries, proxy handling, and the local OAuth helper. Google endpoints are mocked; tests do not load your `.env`, send mail or deploy. Browser layout/interaction QA and real delivery remain unverified.

## Create the private GitHub repository

The repository name selected for this project is `OzAvrahami/mirel-media`. GitHub repository creation was not available through the authoring connector, so the remote has **not** been created. After extracting the download into a new `mirel-media` directory, use an authenticated GitHub CLI:

```text
git init -b main
git add .
git commit -m "Initial mirel-media website and contact API"
gh repo create OzAvrahami/mirel-media --private --source=. --remote=origin --push
```

Run these in the extracted project directory. Do not run them inside another project or overwrite an existing `mirel-media` directory. The download excludes Git history and credentials. A `.env` file is ignored before any commit. Use `gh auth login` first if the CLI is not connected.

## Deploy

The included Dockerfile and `railway.json` support deployment from the GitHub repository. See [the launch guide](docs/LAUNCH.md). No Railway project has been created or deployed by this task.

The earlier ChatGPT Sites URL remains a separate static design preview with a clearly marked copy-only form. The standalone Node project in this repository is the production implementation; it must be hosted with its server to send mail. Uploading only `public/` cannot provide the contact API.

## Structure

| Path | Purpose |
| --- | --- |
| `public/` | English site, style sheets, client interactions and local assets |
| `server.mjs` | Static server, HTTP routing and security headers |
| `src/contact.mjs` | Configuration, validation, abuse controls and email transport |
| `scripts/gmail-authorize.mjs` | Local loopback OAuth authorization with state and PKCE |
| `test/` | HTTP integration and contact module tests |
| `docs/` | Launch and editorial notes |
| `.env.example` | Variable names with no credentials |

## Scope and assets

No client testimonials, campaign metrics, certifications or guarantees have been invented. Lior Idan remains the named personal contact; confirm commercial service details with him. Self-hosted Roboto fonts retain their Apache 2.0 license in `public/assets/FONT-LICENSE.txt`. The glass growth artwork was generated for this design. No analytics or third-party browser scripts are included.

## References

- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/workspace/gmail/api/guides/sending
- https://docs.railway.com/config-as-code/reference
- https://cli.github.com/manual/gh_repo_create
