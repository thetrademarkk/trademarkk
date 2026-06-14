# Architecture

A system map of TradeMarkk: a single Next.js app, a deliberately small server, two kinds
of database, and almost all the heavy lifting done **in the user's browser, on the user's
own data**. The guiding constraints are: lakhs of users on near-zero infra, and "your
journal stays yours" as an architectural property rather than a promise.

For the original product/architecture rationale see [PLAN.md](PLAN.md); for the
cross-cutting engineering rules see [ENGINEERING.md](ENGINEERING.md).

## The app

Next.js 15 (App Router) + React 19 + TypeScript, deployed to Vercel. There is **no
separate backend service** — the server is just Next.js Route Handlers.

Top-level route groups (`src/app/`):

- **`(marketing)/`** — the public, server-rendered, indexable surface: landing,
  `features`, `compare`, `faq`, `blog` (editorial + approved community posts, ISR),
  `docs`, `changelog`, `pulse` (live web-vitals), `privacy`, `terms`.
- **`app/`** — the journal application (client-rendered by design, `noindex`):
  `dashboard`, `trades`, `journal`, `analytics`, `insights`, `calendar`, `rules`,
  `playbooks`, `reports`, `settings`, `onboarding`, and a `backtesting` preview tab.
- **`community/`** — the public social layer (feed, posts, profiles `u/`, $cashtag
  streams `s/`, notifications, messages, leaderboard).
- **`admin/`** — the owner/admin panel (blog submissions, reports, feedback, analytics).
- **`api/`** — Route Handlers: `auth/[...all]` (Better Auth), `db/{provision,token,status}`
  (hosted-mode provisioning + token vending), `community/*`, `blog/*`, `track`, `feedback`.

The codebase is **feature-first**: each domain lives in `src/features/<feature>/` with its
own components, hooks, queries, schemas and a single public `index.ts`. Pure logic lives in
`src/lib/` with co-located tests; server-only code lives in `src/server/` guarded by the
`server-only` package so platform secrets can never reach the client bundle.

## The two-database model

This is the core idea. There are two *kinds* of database that never mix:

### Platform DB (one, central)

A single Turso/libSQL database, accessed server-side via Drizzle. It holds **only**:

- Better Auth tables (`user`, `session`, `account`, `verification`)
- `user_databases` — the mapping from a user to their journal DB name + hostname + mode
- Community + blog + admin + analytics tables (posts, comments, likes, follows,
  bookmarks, notifications, blocks, DMs, profiles, blog submissions, feedback, page events,
  web vitals, rate limits, …)

It **never** stores a single trade. (Provisioning of the platform client is lazy — the
libsql client is only constructed at request time, never at import/build time.)

### Journal DB (one per user, or BYOD, or in-browser)

The user's trades, rules, journal entries and attachments live in a separate journal
database whose schema is **identical** across all three storage modes:

- **Hosted (default):** on sign-up, the server uses the Turso **Platform API** to provision
  a **dedicated Turso database for that user**, recorded in `user_databases`. The browser
  then queries that DB **directly** using a short-lived, single-database token minted by
  `/api/db/token`. The server **never proxies queries** — this keeps Vercel compute near
  zero and is why per-user databases (not per-user rows in a shared table) are used:
  isolation is by construction, with no `WHERE user_id` to forget.
- **BYOD (bring your own database):** the user supplies their own Turso URL + token, stored
  **only in their browser** (`localStorage`, optionally AES-GCM encrypted behind a
  passphrase). The server is not involved at all.
- **Local / demo:** an in-browser SQLite database via **sql.js** (wasm) persisted to
  IndexedDB. No account, no network.

A `DbSession` abstraction sits over all three, so feature code never knows which mode it is
in. Because the schema is identical and primary keys are ULIDs (globally unique, sortable),
**switching modes is an idempotent, verifiable table copy** — supported in every direction,
in-app, with row-count/checksum verification before the switch commits.

```
                       ┌─────────────────────────────┐
   Browser ───auth───▶ │  Next.js Route Handlers      │ ───▶ Platform DB
   (journal app)       │  (Better Auth, provisioning, │      (auth + mapping +
        │              │   token vending, community)  │       community/blog/admin)
        │              └─────────────────────────────┘
        │   short-lived single-DB token
        └──────────────────────────────────────────▶ Journal DB
            direct libsql queries (server never sees them)   (hosted per-user / BYOD / local)
```

## Client-side compute philosophy

All the analytical heavy lifting runs **in the browser on the user's own data** — zero
platform load and nothing to leak server-side:

- **Charges engine** (`src/lib/charges/`) — paise-accurate brokerage, STT/CTT, exchange
  transaction, SEBI, GST and stamp duty across equity / options / futures / commodity /
  currency. Locked down with golden tests.
- **Stats** (`src/lib/stats/`) — win rate, profit factor, expectancy, R-distribution,
  streaks and more.
- **Options** (`src/lib/options/`) — payoff curves, strategy classification, expiry-day
  analytics.
- **Monte-Carlo** (`src/lib/montecarlo/`) — edge projection from the user's R-sample, run
  in a Web Worker.
- **Tax** (`src/lib/tax/`) — FY turnover and a tax-ready summary.
- **CSV import** — fills FIFO-paired into round trips, deduped on re-import.

Because these are pure functions over the user's data, they run the same way in hosted,
BYOD and local modes — and there is nothing for the server to compute or store.

## Backtesting data layer (in development)

The backtesting workspace is being built to keep the same client-side, zero-infra ethos.
The engine is designed to read partitioned historical option data through a thin
same-origin range-proxy (so the browser can range-read parquet that is otherwise CORS- and
Xet-blocked) behind a single `DataSource` seam, with coverage-honesty as a first-class
concept (every result annotated with how much real data backed it). The historical dataset
is still being prepared and brought online; until then the in-app tab is an honest preview.
The design docs live in [docs/backtesting/](backtesting/).

## Extension architecture

The companion Chrome extension (`extension/`, Vite + React, MV3) is a **thin client of the
same journal**, not a second app:

- **One side panel UI** that reuses the journal's save path — writes are **byte-identical**
  to a web trade via the shared `save-statements` module. The extension **never** migrates
  databases.
- **Auth** rides the app's existing cookie session (via host permission to the app origin);
  the extension origin is allowlisted on the server (`EXTENSION_ORIGIN`).
- **Versioned adapter registry** (`extension/src/brokers/`) — one pure adapter per broker
  (Kite, Upstox, Groww, Dhan, Fyers) that maps a broker's order-window DOM to a normalized
  captured order. Adapters **degrade silently** and never guess a trade's side.
- **Opt-in content scripts** — broker capture and tradebook import are registered
  **dynamically** via `chrome.scripting` only when the user enables them for a broker; the
  registration list is the source of truth, and disabling returns the host permission.
- **`storage.local` / `storage.session`** hold the app URL, BYOD credentials (this browser
  only) and short-lived staged captures.

Full details and the privacy posture per capability are in [extension.md](extension.md).

## Security model

(See [SECURITY.md](../SECURITY.md) for the reporting policy and the full threat model.)

- **Auth:** Better Auth sessions, `HttpOnly` + `SameSite=Lax` cookies; state-changing API
  routes additionally verify the `Origin` header (`src/server/origin-check.ts`). Email
  verification (when Resend is configured) gates hosted-DB provisioning; auth and
  provisioning routes are rate-limited.
- **Secrets:** the Turso **org/platform API token never leaves the server** (`server-only`
  guard). Hosted clients only ever get a **short-lived token scoped to their single DB**.
  BYOD credentials live only in the browser.
- **Isolation:** hosted mode is **database-per-user** — there is no shared table to leak
  across, and the platform DB holds no journal rows.
- **AuthZ:** the admin panel and moderation actions are gated to an **owner/admin
  allowlist** (`ADMIN_EMAILS`); a small set of platform-owned accounts are protected from
  moderation actions. Authors can only mutate their own posts/comments (checked
  server-side). The model is allowlist-based — no special privilege is hard-coded into the
  open-source code beyond reading that env var.
- **Injection / XSS:** all SQL values are parameterized; SQL identifiers from untrusted
  sources (backup import, mode-switch migration) are allowlist-validated. Community post
  bodies are plain text (no HTML); blog submissions are sanitized server-side to a strict
  allowlist before storage. `dangerouslySetInnerHTML` is used only for sanitized blog HTML,
  static JSON-LD, and the no-flash theme script.
- **CSP:** a strict Content-Security-Policy with **no third-party script hosts** —
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'` (inline = Next hydration + theme
  script; wasm = sql.js), `connect-src 'self' https: wss:` (BYOD journals talk to
  user-supplied libsql hosts directly), `frame-ancestors 'none'`, `object-src 'none'`. A
  nonce-based strict CSP is on the roadmap. (This is why `next dev`, which needs `eval`,
  can't hydrate the journal screens — use a prod build locally.)
