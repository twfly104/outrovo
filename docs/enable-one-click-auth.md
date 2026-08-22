# Enable one-click "Authorize" (Google + Microsoft)

The Settings page shows one-click **Authorize with Google / Microsoft** tiles
whenever these env vars exist on the server. Without them, the tiles fall back
to the minimal email + app-password form. This is a ~10 minute, one-time setup
per provider. All of it happens in the provider consoles — no code changes.

## Google (Gmail / Workspace)

1. Open https://console.cloud.google.com/apis/credentials with the Google
   account that owns the product.
2. Create (or pick) a project → **OAuth consent screen**: External, fill in
   app name, support email, and the authorized domain of your production URL.
3. **Credentials → Create credentials → OAuth client ID** → type: Web
   application.
4. Under **Authorized redirect URIs** add exactly:
   `https://<your-production-domain>/api/app/oauth/google/callback`
   (for the current deployment: `https://outrovo.onrender.com/api/app/oauth/google/callback`)
5. Add the scopes `https://www.googleapis.com/auth/gmail.send`, `openid`,
   `email` on the consent screen. Send-only is enough — replies arrive via the
   inbound webhook (`/api/email/receive`), never via the Gmail API. While the
   app is in "Testing" status it works for any Google account you add as a
   test user; move to "In production" when ready.
6. Copy the generated **Client ID** and **Client secret** and set them as env
   vars on the server (Render → Environment):
   - `GOOGLE_CLIENT_ID` = …apps.googleusercontent.com
   - `GOOGLE_CLIENT_SECRET` = …
   - `PUBLIC_URL` = `https://outrovo.onrender.com` (must match the redirect URI)
7. Restart the service. The Google tile now opens the real consent screen in a
   popup; the user clicks Authorize once and the inbox is connected.

## Microsoft (Microsoft 365 / Outlook.com)

1. Open https://entra.microsoft.com → **Identity → Applications → App
   registrations → New registration**.
2. Name it anything; Supported account types: **Accounts in any organizational
   directory and personal Microsoft accounts** (so Outlook.com users work too).
3. Add a **Web** redirect URI:
   `https://<your-production-domain>/api/app/oauth/microsoft/callback`
4. **Certificates & secrets → New client secret** → copy the *Value* (shown once).
5. **API permissions → Add** → Microsoft Graph / Exchange delegated:
   `openid`, `email`, `offline_access`, and `SMTP.Send` (or
   `https://outlook.office.com/SMTP.Send`).
6. Set env vars on the server:
   - `MS_CLIENT_ID` = Application (client) ID from the Overview page
   - `MS_CLIENT_SECRET` = the secret value from step 4
   - `PUBLIC_URL` = `https://outrovo.onrender.com`
7. Restart the service.

## Notes
- Tokens are stored AES-256-GCM-encrypted exactly like app passwords, and the
  access token auto-refreshes via each provider's token endpoint.
- To disable one-click again, unset the env vars — the tiles fall back to the
  app-password form with no downtime.
- Test overrides exist for CI: `GOOGLE_AUTH_URL`, `GOOGLE_TOKEN_URL`,
  `GOOGLE_USERINFO_URL`, `MS_AUTH_URL`, `MS_TOKEN_URL` (see AGENTS.md).
