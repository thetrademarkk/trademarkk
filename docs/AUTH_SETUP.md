# Auth setup — Google sign-in, password reset, email OTP

> **Status:** built + fully verified locally; accumulated, pending batch deploy
> and the owner's Google OAuth credentials. The reset + OTP flows are live the
> moment `RESEND_API_KEY` + `EMAIL_FROM` are set (already in `.env.local`);
> "Continue with Google" switches on the instant `GOOGLE_CLIENT_ID` +
> `GOOGLE_CLIENT_SECRET` are added (see §1). Nothing breaks while Google is absent.

TradeMarkk's hosted platform auth (Better Auth on the central platform DB) now
supports three self-serve flows. **Email/password works out of the box.** The
extras switch on the moment you add the relevant env vars — nothing breaks while
they're absent.

| Flow                        | Works today? | Needs                                           |
| --------------------------- | ------------ | ----------------------------------------------- |
| Email + password sign-up/in | Yes          | —                                               |
| Forgot password / reset     | Yes (\*)     | `RESEND_API_KEY` + `EMAIL_FROM` for real emails |
| Email OTP (verify by code)  | Yes (\*)     | `RESEND_API_KEY` + `EMAIL_FROM`                 |
| Continue with Google        | **Gated**    | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`     |

(\*) The flows are wired and tested. With email creds **absent**, the app still
builds and runs — the send callback no-ops (logs in dev), email verification is
skipped, and sign-up yields a session immediately. With email creds **present**
(as in `.env.local` now), real emails are sent.

---

## 1. Enable "Continue with Google" (all account types)

Until you add both Google credentials the button is **hidden** and the provider
is **not registered** — the page works with email/password as normal. Add the
two vars and the button appears and works for every account type. No code change.

### Google Cloud Console steps (one time)

1. Go to <https://console.cloud.google.com/> → create or pick a project.
2. **APIs & Services → OAuth consent screen**
   - User type: **External**, then **Publish** (so any Google user can sign in).
   - App name: `TradeMarkk`; support email: yours; add your domain under
     _Authorized domains_ (e.g. `thetrademarkk.com`).
   - Scopes: the defaults (`email`, `profile`, `openid`) are enough.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - **Authorized JavaScript origins:**
     ```
     https://thetrademarkk.com
     http://localhost:3000
     ```
   - **Authorized redirect URIs** (Better Auth's callback path is
     `/api/auth/callback/google`):
     ```
     https://thetrademarkk.com/api/auth/callback/google
     http://localhost:3000/api/auth/callback/google
     ```
     Use your actual production domain in place of `thetrademarkk.com`. If you
     also test on another port (e.g. `:3100`), add that origin + redirect too.
4. Click **Create** and copy the **Client ID** and **Client secret**.

### Paste the credentials

**Local** (`.env.local`):

```bash
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
```

**Vercel** (Project → Settings → Environment Variables, Production + Preview):
add the same two keys, then redeploy.

That's it. On next start the server registers Google, `/api/auth/config` reports
`{"google":true}`, and the button renders on both the sign-up and sign-in
screens. A Google sign-in for an email that already has a password account links
to the **same** user (account linking is on, and Google verifies email
ownership), so there's no duplicate-account dead end.

> Note: the old `NEXT_PUBLIC_GOOGLE_AUTH` flag is no longer the source of truth —
> the button now derives from whether the server actually has the credentials
> (via `/api/auth/config`), so it can never show without a working provider
> behind it. You can leave `NEXT_PUBLIC_GOOGLE_AUTH` unset.

---

## 2. Forgot password / reset

- On the sign-in screen, **Forgot password?** → enter email → the app always
  shows a neutral _"If an account exists for that email, a reset link is on its
  way."_ (no account enumeration).
- The email links to `/reset-password?token=…`; the reset page enforces the same
  password rules as sign-up (8+ chars) and the token is one-time-use with an
  expiry (Better Auth's `emailAndPassword.sendResetPassword`).
- **Env:** `RESEND_API_KEY` + a verified `EMAIL_FROM` (e.g.
  `TradeMarkk <noreply@thetrademarkk.com>`). With these blank, the reset still
  works mechanically but no email leaves the box (dev/e2e only).

## 3. Email OTP (verify by 6-digit code)

- After sign-up, when email verification is on, the user gets a **6-digit code**
  and enters it inline (mobile-friendly OTP boxes, paste-supported). On success
  they're signed in and provisioned.
- Code is 6 digits, expires in 10 minutes, allows 5 attempts, with a resend
  cooldown. Backed by Better Auth's `emailOTP` plugin (codes live in the
  existing `verification` table — no schema change).
- **Env:** same `RESEND_API_KEY` + `EMAIL_FROM` as reset.

### Abuse protection (already on, no setup)

Three independent layers guard the email flows: a durable **per-account**
cooldown + daily cap (stored on the user row), a durable **per-IP** limit in the
auth route wrapper, and Better Auth's own per-instance limiter. Blocked
password-reset / OTP-issue requests return a look-normal success (anti-enumeration).

---

## Environment variable summary

```bash
# Email (reset + OTP). Present now in .env.local.
RESEND_API_KEY=...
EMAIL_FROM="TradeMarkk <noreply@yourdomain.com>"   # sender must be a Resend-verified domain

# Google sign-in (ADD THESE to switch the button on — all account types).
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...

# Auth core (already set).
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=https://thetrademarkk.com         # your deployment origin
NEXT_PUBLIC_APP_URL=https://thetrademarkk.com     # must match BETTER_AUTH_URL
```

## Content-Security-Policy

No CSP change is needed for Google. The "Continue with Google" flow is a
server-side **redirect** to `accounts.google.com` (a top-level navigation, not an
embedded script or form post), and `connect-src` already allows `https:`. The
button's logo is an inline SVG. If a future change embeds Google's GSI script or
One Tap iframe, that _would_ require widening `script-src`/`frame-src` — treat
any such loosening as an explicit owner-review decision, don't add it silently.

## Notes for testing (not for production)

`AUTH_TEST_HOOK=1` exposes a `/api/auth/test-token` endpoint so the e2e suite can
read the latest reset token / OTP from the DB without a real inbox. It returns
404 unless that env var is set — **never set it in a real deployment.**
