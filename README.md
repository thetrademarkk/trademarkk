# 📈 TradeMarkk — mark your trade, every day.

Free, open-source trading journal for Indian intraday & FnO traders. Track trades, mistakes
and rules — and keep your data in **your own database**.

## Why TradeMarkk

- **15-second trade logging** with NIFTY/BANKNIFTY strikes and the full Indian charges engine
  (brokerage, STT, exchange, SEBI, GST, stamp duty) built in.
- **Rules & mistakes engine** — daily rule checklist, adherence tracking, and the ₹ cost of
  every broken rule.
- **Daily journal** — pre-market plan, live notes, post-market review, mood, streaks.
- **Analytics** — equity curve, P&L calendar, win rate, profit factor, expectancy,
  R-distribution, time-of-day edge.
- **Broker CSV import** — Zerodha Console & friends; fills are FIFO-paired into round trips,
  re-imports dedupe.
- **Three storage modes, switch anytime (verified, in-app):**
  - ☁️ **Hosted** — sign up, we provision an isolated Turso DB per user (token-vending: the
    browser talks to Turso directly; our backend never proxies queries).
  - 🔐 **BYOD** — bring your own free Turso DB. Credentials never leave the browser.
  - 💻 **Local/demo** — SQLite in the browser (wasm + IndexedDB), zero accounts.
- **PWA** — installable, dark-first, 4 themes, color-blind-safe P&L mode, fully responsive.
- **Chrome extension** — a side panel that logs trades and ticks your daily rules without
  leaving your broker's page, writing to the same journal DB. See
  [docs/extension.md](docs/extension.md).

## Stack

Next.js (App Router) · Tailwind v4 · Better Auth · Drizzle · Turso/libSQL · TanStack Query ·
Zustand · Recharts · sql.js · Serwist. See [docs/PLAN.md](docs/PLAN.md) for the full architecture, [docs/COMMUNITY_PLAN.md](docs/COMMUNITY_PLAN.md) for the community design, and [docs/ENGINEERING.md](docs/ENGINEERING.md) for engineering standards.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in (see below)
npm run migrate:platform     # creates auth tables on your platform Turso DB
npm run dev
```

### Environment variables

| Variable                                              | Required        | Purpose                                              |
| ----------------------------------------------------- | --------------- | ---------------------------------------------------- |
| `TURSO_PLATFORM_DB_URL` / `TURSO_PLATFORM_DB_TOKEN`   | ✅              | Platform DB (auth + db-mapping only)                 |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL`              | ✅              | Auth sessions                                        |
| `TURSO_PLATFORM_API_TOKEN` / `TURSO_ORG_SLUG`         | for hosted mode | Provisions per-user DBs & mints scoped tokens        |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`           | optional        | Google sign-in (set `NEXT_PUBLIC_GOOGLE_AUTH=1` too) |
| `RESEND_API_KEY` / `EMAIL_FROM`                       | optional        | Email verification & password reset (skipped in dev) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | optional        | Distributed rate limiting                            |

Without `TURSO_PLATFORM_API_TOKEN`, hosted mode returns a clear 503 — BYOD and demo modes
work regardless.

### Scripts

`npm run dev` · `npm run build` · `npm test` (Vitest) · `npm run typecheck` · `npm run lint`
· `npm run migrate:platform`

## Security model

- The Turso **org token never leaves the server** (`server-only` guarded).
- Hosted clients receive **short-lived tokens scoped to their single DB**.
- BYOD credentials live in `localStorage` only, optionally AES-GCM encrypted with a passphrase.
- Email verification gates DB provisioning; auth routes are rate limited.

## License

MIT
