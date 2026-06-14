# Self-hosting TradeMarkk

TradeMarkk is built to run on near-zero infrastructure: a single Next.js app (deployable
to Vercel's free tier) plus a small **platform** database on [Turso](https://turso.tech)'s
free tier. Journal data does **not** sit in your servers — it lives in a per-user Turso
database (hosted mode), the user's own Turso database (BYOD), or the user's browser
(local mode). This guide walks through standing up your own deployment.

Related docs: [ARCHITECTURE.md](ARCHITECTURE.md) · [AUTH_SETUP.md](AUTH_SETUP.md) ·
[CONTRIBUTING.md](../CONTRIBUTING.md).

## What you need

- A [GitHub](https://github.com) account (to fork the repo)
- A [Vercel](https://vercel.com) account (or any Node 22+ host)
- A [Turso](https://turso.tech) account (free tier is enough to start)
- Optionally: a [Resend](https://resend.com) account (email), a Google Cloud OAuth client
  (Google sign-in), and an [Upstash](https://upstash.com) Redis (distributed rate limits)

## The two databases (read this first)

TradeMarkk uses **two kinds** of database — keep them straight:

| | **Platform DB** | **Journal DB** |
| --- | --- | --- |
| How many | One, shared | One **per user** (hosted) / the user's own (BYOD) / in-browser (local) |
| Holds | Auth (users/sessions), db-name mapping, community content, blog/admin, analytics | The user's trades, rules, journal entries, attachments |
| You provision | Yes — this is the only DB you create and migrate | Hosted ones are auto-provisioned per user; BYOD/local ones are the user's |
| Env vars | `TURSO_PLATFORM_DB_*` | none (hosted ones use the API token; BYOD/local need no server config) |

The platform DB never stores a single trade. See
[ARCHITECTURE.md](ARCHITECTURE.md#the-two-database-model).

## 1. Fork and clone

```bash
# Fork github.com/thetrademarkk/trademarkk on GitHub, then:
git clone https://github.com/<you>/trademarkk.git
cd trademarkk
npm install --legacy-peer-deps
```

## 2. Create the platform database (Turso)

Using the [Turso CLI](https://docs.turso.tech/cli):

```bash
turso db create trademarkk-platform
turso db show trademarkk-platform --url      # -> TURSO_PLATFORM_DB_URL
turso db tokens create trademarkk-platform   # -> TURSO_PLATFORM_DB_TOKEN
```

(You can also do all of this from the Turso web dashboard — create a database, then copy
its URL and a database token.)

## 3. Configure environment

Copy the example file and fill it in:

```bash
cp .env.example .env.local
```

### Required

| Variable | Value |
| --- | --- |
| `TURSO_PLATFORM_DB_URL` | The platform DB URL from step 2 (`libsql://…` or `https://…`) |
| `TURSO_PLATFORM_DB_TOKEN` | The platform DB token from step 2 |
| `BETTER_AUTH_SECRET` | A long random string (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | Your deployment origin (e.g. `https://your-app.example.com`; locally `http://localhost:3000`) |
| `NEXT_PUBLIC_APP_URL` | Same as `BETTER_AUTH_URL` |

### Optional — hosted mode (per-user DB provisioning)

If you want users to be able to **sign up and get an isolated database automatically**
(the default mode at thetrademarkk.com), give the app a Turso **Platform API** token so it
can create databases and mint scoped tokens in your Turso organization:

| Variable | Value |
| --- | --- |
| `TURSO_PLATFORM_API_TOKEN` | A Turso **platform API** token (`turso auth api-tokens mint trademarkk`) |
| `TURSO_ORG_SLUG` | Your Turso organization slug |
| `TURSO_GROUP` | The Turso group new DBs are created in (default `default`) |

Without these, hosted mode returns a clear error and the app still fully supports **BYOD**
and **local/demo** modes — a perfectly good privacy-first deployment with zero per-user
provisioning.

### Optional — auth extras, email, rate limiting

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `NEXT_PUBLIC_GOOGLE_AUTH` | Google sign-in — see [AUTH_SETUP.md](AUTH_SETUP.md#google-sign-in-optional) |
| `RESEND_API_KEY` / `EMAIL_FROM` | Email verification & password reset — see [AUTH_SETUP.md](AUTH_SETUP.md#emailpassword) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Distributed rate limiting (in-memory fallback otherwise) |
| `ADMIN_EMAILS` | Comma-separated admin/owner allowlist (admin panel + moderation) |

> **Never commit `.env.local`** or paste real tokens into docs or issues. `.env.example`
> ships with empty placeholders only.

## 4. Migrate the platform database

This creates the Better Auth tables, the `user_databases` mapping, and all community /
blog / analytics tables on your platform DB:

```bash
npm run migrate:platform
```

The migration is idempotent — re-run it safely after pulling changes that add tables or
columns.

## 5. Run locally

```bash
npm run dev          # marketing site at http://localhost:3000
```

> **Important — the strict CSP and `next dev`.** The app ships a strict
> Content-Security-Policy with no `unsafe-eval`. Next.js **dev mode** (React Fast Refresh)
> relies on `eval`, so the **journal app screens** (`/app/*`) won't hydrate under
> `npm run dev`. The marketing pages work fine in dev. To exercise auth, onboarding and
> the journal locally, run a **production build** on a port whose origin matches your env:
>
> ```bash
> NEXT_PUBLIC_APP_URL=http://localhost:3000 BETTER_AUTH_URL=http://localhost:3000 npm run build
> npm start            # serves the prod build at http://localhost:3000
> ```
>
> See [local-verification notes in CONTRIBUTING.md](../CONTRIBUTING.md#running-things-locally).

## 6. Deploy to Vercel

1. In Vercel, **Add New → Project** and import your fork.
2. Add **every** environment variable from your `.env.local` to the Vercel project
   (Production, and Preview if you use it). Set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL`
   to your **production** domain.
3. Deploy. Vercel auto-detects Next.js — no custom build command is needed.
4. After the first deploy, make sure you have run `npm run migrate:platform` against the
   **same** platform DB the deployment uses (run it locally with that DB's credentials, or
   as a one-off job).
5. If you enabled Google sign-in, add your production redirect URI in the Google console
   (see [AUTH_SETUP.md](AUTH_SETUP.md#google-sign-in-optional)).

Any Node 22+ host works too; the only requirement is the Next.js runtime plus the
environment variables above.

## The three run modes (what your users get)

- **Hosted (default):** the user signs up; the app provisions an isolated Turso database
  for them and the browser talks to it directly with a short-lived, single-database token.
  Requires the Turso Platform API token (step 3).
- **BYOD (bring your own database):** the user creates their own free Turso database and
  pastes the URL + token, which are stored **only in their browser** (optionally encrypted
  with a passphrase). Your server never sees them. Works with no API token configured.
- **Local / demo:** an in-browser SQLite database (sql.js wasm + IndexedDB). No account,
  no network, nothing leaves the device. Great for trying the product.

All three use the **identical** journal schema, so users can switch between them in-app in
any direction (with an integrity-checked copy). See
[ARCHITECTURE.md](ARCHITECTURE.md) and [PLAN.md](PLAN.md) for the details.

## Optional: the Chrome extension

The companion extension is built from this same repo. Build it with `npm run ext:build`
and load `extension/dist/` unpacked in Chrome. For a fork, point the extension at your own
deployment and allowlist its extension origin via `EXTENSION_ORIGIN` — see
[extension.md](extension.md).

## Optional: backtesting data

The backtesting workspace is in active development and depends on a historical
index-options dataset that is still being prepared. There is nothing to configure for it
yet; the in-app tab shows a transparent preview until the dataset is online.
