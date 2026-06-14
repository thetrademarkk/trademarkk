# Authentication setup

TradeMarkk uses [Better Auth](https://better-auth.com) on the platform database for
sign-up, sign-in, sessions, email verification and password reset. Email/password works
out of the box; Google sign-in and transactional email are optional add-ons.

See also: [SELF_HOSTING.md](SELF_HOSTING.md) (full deploy) ·
[ARCHITECTURE.md](ARCHITECTURE.md#security-model) (security model).

## Required for any auth

| Variable | Purpose |
| --- | --- |
| `BETTER_AUTH_SECRET` | Signing secret for sessions/cookies. Generate a long random string (e.g. `openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | The deployment's own origin, e.g. `https://your-app.example.com` (locally `http://localhost:3000`). State-changing auth requests from other origins are rejected. |
| `NEXT_PUBLIC_APP_URL` | Public origin used by the browser auth client. Keep it equal to `BETTER_AUTH_URL`. |
| `TURSO_PLATFORM_DB_URL` / `TURSO_PLATFORM_DB_TOKEN` | The platform DB that stores the Better Auth tables (`user`, `session`, `account`, `verification`). Run `npm run migrate:platform` to create them. |

> When running locally, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must match the port
> you actually serve on, or the browser session never resolves.

## Email/password

Enabled by default (minimum 8-character passwords).

- If `RESEND_API_KEY` is **unset**, email verification is **off** — sign-up returns a
  session immediately. This is the convenient default for local development and CI.
- If `RESEND_API_KEY` is **set** (with `EMAIL_FROM`), email verification is **required**:
  sign-up sends a verification link, and DB provisioning is gated on a verified email
  (abuse control). Password-reset emails are also sent via Resend.

| Variable | Required | Purpose |
| --- | --- | --- |
| `RESEND_API_KEY` | optional | [Resend](https://resend.com) API key for transactional email |
| `EMAIL_FROM` | optional | From address, e.g. `TradeMarkk <noreply@your-domain.com>` (must be a Resend-verified sender) |

## Google sign-in (optional)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create an
   **OAuth 2.0 Client ID** (type: Web application).
2. Add your origin to **Authorized JavaScript origins**
   (e.g. `https://your-app.example.com`).
3. Add the **Authorized redirect URI**:
   `https://your-app.example.com/api/auth/callback/google`
   (locally: `http://localhost:3000/api/auth/callback/google`).
4. Set the env vars:

   | Variable | Purpose |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | OAuth client ID |
   | `GOOGLE_CLIENT_SECRET` | OAuth client secret |
   | `NEXT_PUBLIC_GOOGLE_AUTH` | Set to `1` so the "Continue with Google" button is shown |

The Google provider is only registered server-side when **both** `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are present. Account linking is enabled: signing in with Google
for an email that already has a password account resolves to the same user.

## Admin / owner allowlist (optional)

`ADMIN_EMAILS` is a comma-separated allowlist of accounts that may access the admin panel
(`/admin`) and the moderation queues. Leave it empty on a fork until you want an admin.

```env
ADMIN_EMAILS=you@example.com
```

## Rate limiting (optional)

Auth and provisioning routes are rate-limited. Set Upstash Redis credentials for durable,
distributed limits in production; without them, an in-memory per-instance fallback is used.

| Variable | Purpose |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Distributed rate-limit store |
