# TradeMarkk

**Mark your trade, every day.**

A free, open-source, privacy-first trading journal for Indian traders — built for
**every** trader type: intraday equity, swing & positional, F&O (options/futures),
MCX commodity and CDS currency. Track trades, mistakes and rules with a paise-accurate
charges engine, learn from a community, and backtest your setups — while keeping
your data in **your own database**.

**Live:** [thetrademarkk.com](https://thetrademarkk.com) · **License:** MIT ·
**Source:** [github.com/thetrademarkk/trademarkk](https://github.com/thetrademarkk/trademarkk)

---

## What it is

TradeMarkk is the trade journal a profitable trader would build for themselves, then
give away. It is open source end to end — there is no paid tier hiding the good parts,
and "your journal stays yours" is an architectural guarantee, not a marketing line:
in BYOD and local modes, not a single trade ever touches our servers.

## Features

### Journal — for all trader types

- **15-second trade logging.** Type a contract name (`BANKNIFTY24JUN52000CE`,
  `NIFTY 25 JUN 2026 24500 CALL`, `NSE:SBIN-EQ`, or a plain symbol) and it's parsed
  into segment, strike, expiry and option type automatically.
- **Every segment, charged correctly.** Equity (intraday/delivery), options, futures,
  MCX commodity and CDS currency — each with the right brokerage, **STT/CTT, exchange
  txn, SEBI, GST, stamp duty** computed to the paise.
- **Multi-leg trades.** Scale-in/out and partial exits are modelled as fills; the
  headline shows weighted-average entry/exit and open/closed state.
- **Rules & mistakes engine.** A daily rule checklist with a followed / broken /
  not-applicable tri-state, adherence tracking, and the **₹ cost of every broken rule**.
- **Daily journal.** Pre-market plan, live notes, post-market review, mood and streaks.
- **Broker CSV import.** Zerodha Console & friends — fills are FIFO-paired into round
  trips, re-imports dedupe.

### Insights & analytics

- Equity curve, P&L calendar, win rate, profit factor, expectancy, R-distribution and
  time-of-day edge.
- **Tilt / discipline insights** — emotions-vs-P&L, mistake-cost analysis, and
  expiry-day-vs-other-days options analytics.
- **Monte-Carlo** projection of your edge from your own R-sample.
- **FY tax pack** — financial-year turnover and a tax-ready summary built from your
  trades.

### Community

A public, opt-in social layer (a free account, usable in **any** storage mode). Posts
with optional **Trade Card** snapshots shared from your journal (with an opt-in ₹P&L
toggle), threaded comments, reactions, follows, bookmarks, in-app notifications,
public profiles, direct messages, $cashtag streams — plus reporting and moderation.
Sharing to the community is always explicit; your journal never auto-publishes.

### Backtesting

A full backtesting workspace: a no-code five-step strategy builder with a live payoff
diagram and an interactive strike ladder, a deterministic 1-minute bar-replay engine
(paise-accurate charges, honest fill modelling, expiry-at-last-traded-price), a
verdict→evidence→drill-down results view with a tap-to-derive charge waterfall,
walk-forward + Monte-Carlo robustness with a deflated-Sharpe overfitting caution,
founder-vetted example strategies, and a "compare against your real journal" overlay.
**Coverage honesty is the moat** — every result surfaces how much real data backed it.
The historical-options dataset is being brought online; strategies that need
not-yet-published data show a transparent coverage state rather than fabricated results.

### Multi-broker Chrome extension

A companion MV3 side panel that logs trades and ticks your daily rules **without leaving
your broker's page**, writing to the **same** journal database (byte-identical to a web
trade). Opt-in order-window capture for **Zerodha Kite, Upstox, Groww, Dhan and Fyers**,
Kite tradebook/positions import, chart-screenshot attach and pre-trade plan capture.
See [docs/extension.md](docs/extension.md).

### Privacy by design — three storage modes, switch anytime

| Mode                               | Where your journal lives                                                                                                                                                                     | Accounts                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Hosted** (default)               | An **isolated Turso database per user**, provisioned for you. The browser talks to Turso directly via a short-lived, single-database token — our backend never proxies or sees your queries. | Sign up (email/password or Google) |
| **BYOD** (bring your own database) | **Your own** Turso database; URL + token stay in your browser only.                                                                                                                          | Optional                           |
| **Local / demo**                   | SQLite in the browser (sql.js wasm + IndexedDB).                                                                                                                                             | None                               |

Mode switching works in **all directions, in-app**, with an integrity-checked copy
engine — see [docs/PLAN.md](docs/PLAN.md). A free community account works in every mode.

### Platform polish

Installable **PWA**, dark-first design with four themes, a **color-blind-safe** P&L
palette, full keyboard a11y, mobile-first responsive layout, and a public
first-party **/pulse** page of real field web-vitals (no third-party trackers).

## Screenshots

Browser-extension store assets (real, generated screenshots) live in
[`extension/store-assets/screenshots/`](extension/store-assets/screenshots) and
[`extension/store-assets/promo/`](extension/store-assets/promo). Marketing screenshots
of the web app will be added to this section.

## Tech stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript
- **UI:** Tailwind CSS v4, Radix UI, lucide icons, Motion, Recharts, TanStack Table/Virtual
- **State/data:** TanStack Query, Zustand, React Hook Form + Zod
- **Auth:** Better Auth (email/password + Google)
- **Database:** Drizzle ORM over Turso / libSQL (server) and sql.js (browser, local mode)
- **Extension:** Vite + React, MV3

## Quick start

```bash
npm install --legacy-peer-deps
cp .env.example .env.local      # fill in (see the table below)
npm run migrate:platform        # create the platform (auth) tables on your Turso DB
npm run dev
```

> Note: `npm run dev` (Next.js dev mode) uses `eval`, which the app's strict CSP blocks,
> so the journal app screens won't hydrate under `next dev`. The marketing site works in
> dev; to exercise auth/onboarding locally, run a **production build** instead
> (`npm run build && npm start`). See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) and
> [CONTRIBUTING.md](CONTRIBUTING.md).

### Environment variables

| Variable                                              | Required        | Purpose                                                             |
| ----------------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| `TURSO_PLATFORM_DB_URL` / `TURSO_PLATFORM_DB_TOKEN`   | yes             | Platform DB (auth + db-mapping only — never journal data)           |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL`              | yes             | Auth sessions                                                       |
| `NEXT_PUBLIC_APP_URL`                                 | yes             | Public origin of the deployment                                     |
| `TURSO_PLATFORM_API_TOKEN` / `TURSO_ORG_SLUG`         | for hosted mode | Provisions per-user DBs and mints scoped tokens                     |
| `ADMIN_EMAILS`                                        | optional        | Comma-separated owner/admin allowlist (admin panel + moderation)    |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`           | optional        | Google sign-in (set `NEXT_PUBLIC_GOOGLE_AUTH=1` to show the button) |
| `RESEND_API_KEY` / `EMAIL_FROM`                       | optional        | Email verification & password reset (skipped if unset)              |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | optional        | Distributed rate limiting (in-memory fallback otherwise)            |

The full variable list is in [`.env.example`](.env.example) and
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md). Without `TURSO_PLATFORM_API_TOKEN`, hosted
mode returns a clear error — BYOD and local/demo modes still work.
**Never commit `.env.local`.**

### Scripts

| Script                        | What it does                                                 |
| ----------------------------- | ------------------------------------------------------------ |
| `npm run dev`                 | Next.js dev server (marketing only — see the CSP note above) |
| `npm run build` / `npm start` | Production build / serve                                     |
| `npm test`                    | Vitest unit tests (charges, stats, fill-pairing, …)          |
| `npm run typecheck`           | `tsc --noEmit` for the app                                   |
| `npm run ext:typecheck`       | `tsc` for the extension                                      |
| `npm run lint`                | ESLint (`next lint`)                                         |
| `npm run migrate:platform`    | Create/upgrade the platform DB tables                        |
| `npm run ext:build`           | Build the Chrome extension bundles                           |
| `npm run ext:package`         | Build the Chrome Web Store upload zip                        |

## Documentation

- [docs/README.md](docs/README.md) — the documentation index
- [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) — deploy your own TradeMarkk
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the system fits together
- [docs/PLAN.md](docs/PLAN.md) — product & architecture plan
- [docs/ENGINEERING.md](docs/ENGINEERING.md) — engineering standards
- [docs/extension.md](docs/extension.md) — the Chrome extension
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute
- [SECURITY.md](SECURITY.md) — security & responsible disclosure

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the
branch → PR → CI → merge workflow, local setup, and the test/lint gates every change
must pass.

## License

[MIT](LICENSE)
