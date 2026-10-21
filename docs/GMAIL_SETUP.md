# Google Workspace and Gmail API setup

The implementation is ready for configuration and tested with mocked Google endpoints. No Google account, Cloud project, OAuth credentials, DNS changes, real email delivery or deployment have been created or verified by this migration. The existing website design is preserved.

## 1. Create and activate the business mailbox

1. If needed, sign up for Google Workspace for `your-domain.com`. In Google Admin, create the user `sender@your-domain.com`, assign a license with Gmail, and enable Gmail for that user. A domain registration or forwarding alias alone is not a Workspace Gmail mailbox.
2. Complete Google's domain ownership verification using the TXT record shown in Admin. If Namecheap hosts the authoritative DNS, use **Domain List > Manage > Advanced DNS**. If the domain uses another provider's nameservers, edit records there instead.
3. Follow Google's Gmail activation wizard and configure the supplied MX records. New Workspace setups use `smtp.google.com`, priority `1`, host `@`; use the actual instructions for your account. Namecheap has a **Mail Settings** section for MX configuration. Preserve website A/CNAME records and unrelated DNS. Replace conflicting mail routing only as part of the intended mailbox migration.
4. Finish Gmail activation in Admin, then sign in to Gmail as `sender@your-domain.com`. Before testing the website, confirm this mailbox can send and receive normal email. Complete the Admin email-authentication setup for your domain (SPF, DKIM and DMARC) using Google's current instructions.

Sources: [Google MX setup](https://support.google.com/a/answer/9222085?hl=en-tt), [Namecheap Workspace mail setup](https://www.namecheap.com/support/knowledgebase/article.aspx/9230/177/how-to-activate-google-workspace-for-mail/).

## 2. Create or select a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) using an account permitted to administer the Workspace organization.
2. Select an appropriate project or create a dedicated project named, for example, `mirel-media-contact`. Prefer a project owned by the Workspace organization so an Internal OAuth audience is available. Keep access limited to the operators who need it.
3. In **APIs & Services > Library**, find **Gmail API** and enable it for this project.
4. Open **Google Auth platform** and initialize its configuration if prompted. Under **Branding**, enter the app name `mirel-media contact`, a monitored support address, and developer contact details.

Source: [Google OAuth configuration](https://developers.google.com/workspace/guides/configure-oauth-consent).

## 3. Set the audience and minimum scope

- Prefer **Audience > Internal** for an organization-owned project used only by your Workspace mailbox. Website visitors do not authorize Google access; only the mailbox owner does. Internal use can qualify for Google's verification exception, but Workspace administrator approval may still be required.
- If Internal is unavailable, use **External**. While in **Testing**, add `sender@your-domain.com` as a test user. Testing is unsuitable for unattended production: refresh tokens for this Gmail scope expire after seven days. Before ongoing use, move the app to **In production**, satisfy Google's applicable verification/policy requirements or a documented exception, then obtain a fresh refresh token. Publishing alone does not mean Google verification is complete. External unverified apps can retain warnings and user caps.
- Under **Data Access**, add only `https://www.googleapis.com/auth/gmail.send`. Remove other requested scopes. Do not add mailbox-reading scopes, `gmail.modify`, `gmail.compose`, full mail access, or identity/profile scopes. No service account or domain-wide delegation is needed.
- If Workspace API controls block consent, ask the administrator to allow this OAuth client and its send-only access. Do not solve this by granting wider access.

Sources: [Gmail scope classification](https://developers.google.com/workspace/gmail/api/auth/scopes), [verification and exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## 4. Create the OAuth client and local environment

In **Google Auth platform > Clients > Create client**, choose **Desktop app**, and name it `mirel-media local authorization`. This client is for the operator's local helper; the website has no public OAuth callback. Save the client ID and client secret directly into your private `.env` using a local editor. Do not download credential JSON into the repository.

The helper uses `http://127.0.0.1:<temporary-port>/oauth2callback`. Desktop clients support a loopback IP with a dynamic port, so there is no manually registered production redirect URI or JavaScript origin. Do not choose Web application, use the website URL as this redirect, or use the deprecated copy/paste authorization-code flow. The helper uses a random state and S256 PKCE.

Source: [Google Desktop OAuth flow and loopback redirects](https://developers.google.com/identity/protocols/oauth2/native-app).

From PowerShell in this project, with Node.js 24 or later:

```powershell
Set-Location D:\code\mirel-media
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Preserve any existing `.env` settings. Add/update these values in that file; leave the refresh token blank until authorization:

```dotenv
EMAIL_PROVIDER=gmail
NODE_ENV=development
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GMAIL_SENDER=sender@your-domain.com
CONTACT_TO=inquiries@your-domain.com
TRUST_PROXY=false
```

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be the values from the same Desktop client. Use GMAIL_SENDER for the actual mailbox you will authorize and CONTACT_TO for the intended recipient; they may differ. Examples are placeholders. Resend settings may remain in the environment; the Gmail runtime ignores them. The existing local `.env` was not modified by this task.

The helper reads GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GMAIL_SENDER independently of EMAIL_PROVIDER. You can authorize Gmail while Resend remains selected, without CONTACT_TO or an existing refresh token. Set EMAIL_PROVIDER=gmail and restart only when ready to switch the runtime.

## 5. Authorize the intended mailbox once

1. Run `npm run gmail:authorize` on your local computer, from the project directory. Do not run it as a public web service or in the hosted container. Avoid stale shell environment overrides: Node gives existing process variables precedence over `.env`.
2. Open the printed Google authorization URL in a browser on the same computer within five minutes. Select **the account configured in GMAIL_SENDER** even if another Google account is already signed in. The account hint is not proof of which account you selected.
3. Confirm the app requests only permission to send email. Grant consent. Google redirects to the temporary loopback listener; state is checked before the authorization code is exchanged with PKCE.
4. On success, the helper saves `GOOGLE_REFRESH_TOKEN` directly into the ignored `.env`, preserving unrelated settings. It prints no client secret, authorization code, access token or refresh token, and sends no email. Tokens are never returned to the callback page. A denied or failed authorization leaves the prior token untouched unless saving itself fails.
5. The helper requests no mailbox identity/read permission. It cannot independently inspect the selected account. The server sends using the configured mailbox's explicit Gmail user path; a token for a different mailbox must not be used. If you selected the wrong account, revoke that unintended grant and run the helper again as the business mailbox.

Keep `.env` accessible only to your Windows user and authorized operators; on Windows, review the file's **Properties > Security** permissions. The helper sets restrictive POSIX file permissions where supported, but that does not replace Windows ACLs. Keep tokens in a password/secret manager when transferring them to hosting. Never put credentials in chat, source code, terminal commands/history, logs, screenshots or browser bundles.

If there is no refresh token, or the helper rejects a broader grant, review the project's scopes and consent. Prefer this dedicated send-only project. If necessary, revoke the old app grant in the mailbox's Google Account permissions and authorize again; revoking an existing grant also affects services using it. Do not repeatedly generate tokens during routine server restarts.

## 6. Configure local and hosted runtime values

Run `npm run dev` locally after authorization. Changing `.env` requires a server restart. In Railway **Service > Variables** (or your host's private server environment), configure:

| Variable | Required value |
| --- | --- |
| `EMAIL_PROVIDER` | `gmail` (otherwise Resend is the default) |
| `GOOGLE_CLIENT_ID` | Same Desktop client ID used for authorization |
| `GOOGLE_CLIENT_SECRET` | Its matching client secret |
| `GOOGLE_REFRESH_TOKEN` | Refresh token saved by the helper; copy privately from `.env` |
| `GMAIL_SENDER` | Actual Gmail account authorized by the helper |
| `CONTACT_TO` | Intended recipient; can differ from GMAIL_SENDER |
| `PUBLIC_ORIGIN` | Exact deployed HTTPS origin without a path, e.g. `https://mirel-media.com` only if that is the actual site origin |
| `NODE_ENV` | `production` |
| `PORT` | Use the host-provided value; local default is `3000` |
| `TRUST_PROXY` | `false` unless the single trusted proxy behavior described in [LAUNCH.md](LAUNCH.md) is confirmed |

Do not use frontend/public environment prefixes or build-time injection. The Docker image copies no `.env` or authorization helper. Runtime secrets belong in hosting variables. Restart/redeploy when you decide to activate the new configuration; this migration does not deploy anything.

## 7. Verify delivery separately

1. Run `npm run check` and `npm test`. All Google endpoints are mocked; these checks send no email and require no credentials.
2. Check `/api/contact/config`. `{"enabled":true}` means local settings passed validation, **not** that the Google credentials or mailbox work. `/healthz` is only a process health check.
3. When you are ready to send a real test, submit one inquiry through the website with an email address you control. This is a manual live test, separate from the automated checks.
4. Confirm the UI reports success, inspect the business mailbox (including spam and Sent), and verify the received message's sender/recipient and that **Reply** targets the visitor's test address. Confirm Unicode content is intact. A Gmail message ID confirms API acceptance; the recipient inbox check verifies delivery.
5. If the result is uncertain, check the mailbox before trying again. See [duplicate-prevention limits](LAUNCH.md#abuse-controls-and-operational-limits). Do not assume a timeout means Gmail did not send.

Refresh tokens are not permanent guarantees: revocation, inactivity, password/security changes, organizational policies and Google's token limits can invalidate them. When authorization stops working, check the account/project/admin settings, rerun the local helper if necessary, update the hosting refresh token privately, and restart. The application never logs Google's raw error body or retries a failed send automatically.

Sources: [Google token lifecycle](https://developers.google.com/identity/protocols/oauth2#expiration), [Gmail send contract](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send), [MIME and base64url encoding](https://developers.google.com/workspace/gmail/api/guides/sending).
