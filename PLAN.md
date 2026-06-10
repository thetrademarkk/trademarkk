# Open-Source Trading Journal — Product & Architecture Plan

> **Vision:** A free, open-source trading journal for intraday and FnO traders. Users journal
> daily trades, track mistakes, enforce their own rules, and review performance. **Goal:
> onboard lakhs of users** — so onboarding must be zero-friction — while keeping infra cost
> near zero and offering a "your data stays yours" privacy option.

---

## 1. Architecture — Dual mode: Hosted (default) + BYOD (privacy option)

### 1.1 The two modes

| | **Hosted mode (default)** | **BYOD mode (privacy option)** |
|---|---|---|
| Onboarding | Normal sign-up: email/password or Google. Journaling in < 60 seconds. | User creates a free Turso account, pastes their DB URL + token (guided wizard). |
| Where data lives | A **dedicated Turso database per user**, provisioned by us in our Turso org | The user's own Turso database |
| Who authenticates | Our backend (Better Auth) | Possession of their Turso token = identity (Turso validates every request) |
| Pitch to user | "Just sign up, it's free" | "Don't want to share your data with us? Bring your own database — we never see a single trade." |
| Cost to us | Our Turso org (free tier first, paid later — accepted) | ₹0 forever |
| Switching | **Either direction, anytime, in-app** (see §1.5) | |

### 1.2 Why per-user databases (not per-user tables in one DB)

1. **Identical schema in both modes.** A hosted DB and a BYOD DB are byte-compatible.
   The entire data layer is written once; only the connection credentials differ.
2. **Mode switching becomes a table copy**, not a "extract user_id rows from a shared DB"
   surgery. Idempotent, resumable, verifiable.
3. **Isolation by construction.** No `WHERE user_id = ?` to forget; a bug can never leak
   one user's trades to another. Turso is explicitly designed for DB-per-tenant.
4. **Export/delete = hand over / drop the DB.** Clean GDPR-style story.
5. **Per-user usage metering** comes free from Turso's per-DB stats.

### 1.3 The token-vending backend (the key cost decision)

The backend does **not** proxy queries. If every read/write went through our API routes,
each query would be a Vercel function invocation — at lakhs of users that's exactly the
infra bill we're avoiding, plus added latency.

Instead, the backend only **authenticates users and vends scoped tokens**:

```
                 ┌──────────────────────── Vercel ────────────────────────┐
                 │  Next.js app (static/SSG)  +  API route handlers       │
                 │   /api/auth/*      Better Auth (sessions, OAuth)       │
                 │   /api/db/token    mint short-lived token (user's DB)  │
                 │   /api/db/provision  create DB on first login          │
                 └────────────┬───────────────────────────────────────────┘
                              │ Turso Platform API (org token — server-only)
                              ▼
   Browser ──direct HTTPS──▶ user's hosted Turso DB   (hosted mode)
   Browser ──direct HTTPS──▶ user's own Turso DB      (BYOD mode)
```

- **Hosted mode:** after login, the client calls `/api/db/token` and receives a
  **read-write token scoped to that user's DB only**, expiring in ~7 days (silently
  refreshed while the session is valid). All queries then go browser → Turso directly.
- **BYOD mode:** no backend involvement at all. Credentials live only in the user's
  browser (localStorage, optional WebCrypto passphrase encryption). They never touch
  our servers.
- Result: backend compute = auth events + one token mint per session. Vercel free/pro
  tier survives enormous user counts because the hot path (queries) never touches us.

### 1.4 Platform database (ours — the only central DB)

One small Turso DB holding **auth and account metadata only — never journal data**:

```
users             — id (ULID), email, name, email_verified, created_at
sessions / oauth_accounts / verification_tokens   — Better Auth tables
user_databases    — user_id, turso_db_name, region, status (active/archived),
                    storage_mode ('hosted' | 'byod'), created_at
usage_meta        — user_id, db_size_bytes, last_active_at   (for dormancy archiving)
```

Tiny rows, auth-frequency traffic — fits Turso's free tier for a very long time.

### 1.5 Mode switching (both directions, in-app)

The browser can connect to **both** databases at once, so migration runs **client-side**
with a progress UI — no server compute, no data through our backend:

- **Hosted → BYOD:** user pastes their Turso creds → app runs migrations on their DB →
  copies all tables in batches (upserts keyed on ULID primary keys → idempotent and
  resumable) → verifies row counts + per-table checksums → flips `storage_mode` →
  hosted DB enters a 30-day grace period, then is deleted.
- **BYOD → Hosted:** user signs up / logs in → backend provisions a DB + token → same
  client-side copy in reverse → verify → flip. **We never delete their own DB** — it
  stays theirs as a snapshot.
- Safety rails: schema versions reconciled before copy (run migrations on both sides),
  attachment blobs batched by size, interrupted runs resume from the last verified table,
  nothing is flipped until verification passes.

> **Schema rule that makes this work: every primary key is a ULID** (sortable, globally
> unique). Cross-DB copies become idempotent upserts; retries are safe.

### 1.6 Cost trajectory (honest numbers)

- **Vercel:** static pages + thin auth API → free/hobby for a long time; Pro (~$20/mo)
  at real scale. Accepted.
- **Turso:** free tier covers roughly the first ~500 hosted DBs; beyond that, paid plans
  (historically ~$25–30/mo for thousands of DBs; verify current pricing). Levers to pull:
  **apply for Turso's open-source/startup credits** (they sponsor OSS projects — strong
  fit for us), auto-archive dormant DBs, cap hosted attachment storage (e.g., 50 MB/user,
  client-compressed WebP) while BYOD stays unlimited — a natural nudge toward BYOD for
  power users.
- **Email (verification/reset):** Resend free tier (3k/mo), upgrade later.
- BYOD users cost ₹0 regardless of count — every BYOD convert is free scale.

### 1.7 Security model

- **Hosted users:** we custody auth data + their journal DB (we host it; that's the deal
  they chose). Tokens vended to the client are scoped to *their single DB* and short-lived.
  The Turso **org/platform token never leaves the server** (env var).
- **BYOD users:** zero custody — tokens stay in their browser, full stop.
- Provisioning abuse (scripted signups creating DBs): **email verification required
  before DB provisioning**, IP rate limiting on auth routes (@upstash/ratelimit free tier).
- Strict CSP, no untrusted third-party scripts, dependency audit in CI.

### 1.8 Demo mode (still free, still instant)

"Try without signing up" runs SQLite **in the browser** (wa-sqlite + OPFS) with sample
data. One click later, the same copy engine (§1.5) moves local data into a hosted or
BYOD database. Landing page → playing with a live journal in ~5 seconds.

---

## 2. Backend stack (decision + rationale)

**Chosen: Next.js full-stack on Vercel — Route Handlers + Server Actions. No separate
backend service.**

| Component | Choice | Why |
|---|---|---|
| API | **Next.js Route Handlers** (`app/api/*`) | The backend surface is thin (auth, provisioning, token vending) — a separate NestJS/Fastify service on Railway/Fly would add a second deployment, a second bill, and zero benefit at this size. Same repo, same TypeScript, preview deploys include the API. |
| Auth | **Better Auth** (email/password + Google OAuth) with Drizzle adapter on the platform DB | Open-source, self-hosted, no per-user pricing (Clerk/Auth0 would charge per MAU — fails the cost goal). Sessions, email verification, password reset, OAuth out of the box. |
| DB access (server) | **Drizzle ORM** + `@libsql/client` | Same schema definitions shared with the client data layer |
| DB provisioning | **Turso Platform API** (`@tursodatabase/api`) | Create per-user DBs, mint scoped short-lived tokens, fetch usage stats, archive/delete |
| Validation | **Zod** on every route input | Shared schemas with the frontend |
| Rate limiting | **@upstash/ratelimit** (Upstash Redis free tier) | Auth + provisioning routes only |
| Email | **Resend** + React Email templates | Verification, password reset |
| Region | Turso group in the region nearest India (Mumbai/Singapore, per availability) | FnO users are India-first; latency matters |

**API surface (complete — it stays this small):**

```
POST /api/auth/*            Better Auth (signup, login, OAuth, verify, reset)
POST /api/db/provision      create hosted DB after email verification (idempotent)
POST /api/db/token          mint scoped RW token for the session user's DB
GET  /api/db/status         db name, region, size, storage_mode
POST /api/mode/switch       record mode flip after client-side migration verifies
POST /api/account/delete    delete account; schedule hosted DB deletion (30-day grace)
```

**Env vars (what you'll provide):**

```
TURSO_PLATFORM_API_TOKEN=   # org-level token — server only, never exposed
TURSO_ORG_SLUG=
TURSO_PLATFORM_DB_URL=      # the platform/auth DB
TURSO_PLATFORM_DB_TOKEN=
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=
GOOGLE_CLIENT_ID= / GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
UPSTASH_REDIS_REST_URL= / UPSTASH_REDIS_REST_TOKEN=
```

---

## 3. Frontend stack & libraries

### 3.1 Core

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router, latest)** on Vercel | SSG/ISR for SEO pages, RSC, Metadata API, `next/image`, `next/font`, single repo with the API |
| Language | **TypeScript, `strict: true`** | Non-negotiable for contributors |
| DB client (browser) | `@libsql/client/web` + **Drizzle ORM** | One data layer for both modes; only the connection source differs |
| Data layer | **TanStack Query** | Cache, optimistic updates, offline-friendly |
| UI state | **Zustand** (UI-only) + React Context (theme, DB session) | Minimal |
| Forms | **react-hook-form + Zod** | Shared schemas validate forms *and* CSV imports |
| Styling | **Tailwind CSS v4** | Design tokens as CSS variables, themes |
| License | **MIT** | Maximum adoption |

**The mode abstraction (single most important frontend design decision):**

```ts
// DbSessionProvider resolves ONE interface for the whole app:
type DbSession =
  | { mode: "hosted"; client: LibsqlClient }   // token vended by /api/db/token
  | { mode: "byod";   client: LibsqlClient }   // creds from localStorage
  | { mode: "local";  client: LibsqlClient }   // wa-sqlite/OPFS demo mode
// Every feature query receives `client` — features never know which mode they're in.
```

### 3.2 UI / component libraries

| Library | Used for |
|---|---|
| **shadcn/ui** (Radix primitives) | Base component system — owned code, fully themeable |
| **Lucide** | Icons |
| **next-themes** | Dark/light/variant switching, no-flash |
| **TanStack Table + Virtual** | Headless trades table; virtualized rows for 1000s of trades |
| **Recharts** | Analytics charts (equity curve, distributions) |
| **lightweight-charts** (TradingView OSS) | Candlestick chart on trade detail |
| **react-day-picker** | Calendar heatmap base / date pickers |
| **cmdk** | ⌘K command palette |
| **sonner** / **vaul** / **Embla** | Toasts / mobile bottom sheets / swipeable KPI cards |

### 3.3 Animation libraries

| Library | Used for |
|---|---|
| **Motion** (Framer Motion) | Page transitions, layout animations, micro-interactions |
| **NumberFlow** (`@number-flow/react`) | Animated rolling P&L/KPI numbers |
| **tailwindcss-animate** | Simple enter/exit utilities |
| **Magic UI / Aceternity-style components** | Landing-page flair only (hero, bento, marquee) |

**Animation rules:** micro-interactions 150–250 ms; springs for layout shifts; animate
opacity/transform only; respect `prefers-reduced-motion`; zero animation cost on the
quick-add critical path.

---

## 4. SEO, crawling, performance & PWA

### 4.1 Two rendering surfaces

| Surface | Routes | Rendering | Indexable |
|---|---|---|---|
| **Marketing/content** | `/`, `/features`, `/docs/*`, `/blog/*`, `/changelog`, `/compare/*`, `/faq` | **SSG/ISR — full server-rendered HTML** | ✅ The SEO surface |
| **The app** | `/app/*` | Client components (journal data is private; BYOD creds are browser-only) | ❌ `noindex`, excluded from sitemap |

### 4.2 SEO checklist (built in from Phase 0)

- **Metadata API**: per-route `generateMetadata` — title template, descriptions, canonicals.
- **`app/sitemap.ts`** (marketing/docs/blog only) + **`app/robots.ts`** (`Disallow: /app`).
- **Open Graph + Twitter cards** everywhere public; **dynamic OG images** via `next/og`.
- **JSON-LD**: `SoftwareApplication` (home), `FAQPage`, `Article` (blog), `BreadcrumbList` (docs).
- **Content engine**: MDX blog + docs (Fumadocs); programmatic comparison pages
  (`/compare/tradezella-alternative`…) and intent pages ("free trading journal for Indian
  FnO traders") — the highest-leverage organic growth play for a free tool.
- Semantic HTML + a11y (also a ranking signal); `hreflang`-ready for Hindi later.

### 4.3 Core Web Vitals & performance budget

**Targets:** LCP < 2.0 s, INP < 200 ms, CLS < 0.05, Lighthouse ≥ 95 on marketing pages.

- `next/font` self-hosted Geist/Geist Mono; `next/image` with AVIF/WebP.
- Marketing pages pure RSC/SSG — near-zero JS shipped.
- App: route-level code splitting; `next/dynamic` for charts and CSV parser; lazy-load
  below the fold; `date-fns` not moment-class libs; tree-shakeable imports only.
- **Lighthouse CI + bundle-size check in GitHub Actions** — PRs fail on budget regressions.
- RUM: `@vercel/speed-insights` + Vercel Web Analytics (cookieless).

### 4.4 PWA

- **`app/manifest.ts`**: maskable icons, theme colors, screenshots, **shortcuts**
  ("Add trade", "Today's journal").
- **Serwist service worker**: precached shell, offline fallback, persisted TanStack Query
  cache → last-loaded data readable offline (write queue = stretch goal).
- In-app install prompt after the first logged trade; iOS A2HS meta tags.

---

## 5. Engineering standards

> Enforced by ESLint config + CI, not goodwill.

### 5.1 Folder structure (feature-first, full-stack)

```
src/
├── app/                          # ROUTES ONLY — thin files composing features
│   ├── (marketing)/              # public, SSG, indexable
│   ├── (app)/app/                # the journal — client-side, noindex
│   │   ├── dashboard/ trades/ journal/ calendar/ analytics/
│   │   ├── rules/ playbooks/ reports/ settings/ onboarding/
│   ├── api/                      # backend surface (§2)
│   │   ├── auth/[...all]/ db/ mode/ account/
│   ├── sitemap.ts  robots.ts  manifest.ts  layout.tsx
├── features/                     # FEATURE MODULES
│   ├── trades/
│   │   ├── components/ hooks/ queries/ utils/ schemas.ts types.ts index.ts
│   ├── journal/ rules/ analytics/ dashboard/ playbooks/
│   ├── onboarding/ reports/ settings/ calendar/
│   ├── auth/                     # sign-in/up forms, session hooks
│   └── migration/                # mode-switch wizard + copy engine (client-side)
├── server/                       # SERVER-ONLY code (import-guarded)
│   ├── auth.ts                   # Better Auth config
│   ├── turso-platform.ts         # provisioning, token vending, usage
│   ├── rate-limit.ts  email/     # Resend + React Email templates
├── components/
│   ├── ui/  layout/  shared/     # shadcn / AppShell, Sidebar, BottomNav / StatCard…
├── lib/
│   ├── db/                       # schema (drizzle, shared), migration runner
│   │   └── adapters/             # hosted.ts, byod.ts, opfs.ts → one DbSession interface
│   ├── charges/  stats/          # pure functions, fully unit-tested
├── hooks/  providers/  stores/   # global hooks / Theme+Query+DbSession / zustand
├── config/                       # site.ts, nav.ts, themes.ts, brokers.ts
├── styles/  types/
```

### 5.2 Component & file rules

1. **Small files:** components ≤ ~150 lines; any file > 250 lines must split.
2. **Single responsibility:** one component per file; kebab-case files, PascalCase components.
3. **Logic in hooks, not JSX;** pure business logic (charges, stats, fill-pairing, copy
   engine) in `lib/`/`utils/` as pure functions with co-located Vitest tests.
4. **Feature isolation:** cross-feature imports only via `index.ts` public APIs —
   enforced with `eslint-plugin-boundaries` + `import/no-cycle`.
5. **Server code stays in `src/server/`** — guarded with the `server-only` package so it
   can never leak into client bundles (the platform token depends on this).
6. **RSC by default on marketing; `"use client"` at the smallest leaf in the app.**
7. **State placement:** DB data → TanStack Query only; session/theme → Context; ephemeral
   UI → Zustand; forms → react-hook-form. Never mirror query data into a store.
8. **Validation at the edges:** all user input, CSV imports, and API bodies parse through
   Zod; inner code trusts types.
9. **No magic values:** tokens from CSS variables; constants in `config/`; broker charge
   rates in `config/brokers.ts` (data, not code).
10. **Accessibility is review-blocking.**

### 5.3 Tooling & CI gates

ESLint (typescript-eslint strict) + Prettier + import ordering (zero warnings) · Husky +
lint-staged · Conventional Commits → changelog · CI: typecheck → lint → Vitest → build →
Lighthouse CI → bundle-size · Playwright smoke tests: signup→first trade, BYOD connect,
quick-add, journal save, **mode switch with verification**.

---

## 6. Data model

### 6.1 User journal DB (identical schema in hosted, BYOD, and local modes)

> All primary keys are **ULIDs** — this is what makes cross-DB migration idempotent.

```
accounts          — trading accounts (multiple brokers): name, broker, starting_capital
instruments       — symbol, exchange (NSE/BSE), segment (EQ/FUT/OPT), expiry, strike, option_type
trades            — account_id, instrument_id, direction, status, planned_entry/sl/target,
                    opened_at, closed_at, gross_pnl, charges, net_pnl, r_multiple,
                    setup_id (playbook), confidence (1–5), notes, updated_at
trade_fills       — trade_id, side, qty, price, time   → partial fills & multi-leg strategies
tags              — name, kind ('mistake' | 'emotion' | 'custom'), color
trade_tags        — trade_id, tag_id
journal_entries   — date, premarket_plan, market_notes, postmarket_review, mood (1–5),
                    followed_plan (bool)
rules             — text, active, category (risk/entry/exit/discipline), created_at
rule_checks       — date, rule_id, status (followed/broken/n.a.), trade_id?, note
playbooks         — name, description, criteria (markdown), example_image
attachments       — trade_id | journal_date, blob (webp ≤300 KB), caption
settings          — key/value: capital, default risk %, charges profile, theme
schema_migrations — version, applied_at
```

### 6.2 Platform DB (ours — auth/metadata only, §1.4)

`users · sessions · oauth_accounts · verification_tokens · user_databases · usage_meta`

**Indian FnO charges engine:** configurable charge profiles per account (brokerage,
STT, exchange txn, GST, SEBI, stamp duty) with presets for Zerodha/Upstox/Angel/Dhan/
Fyers; rates live in config, not code. Net P&L auto-computed.

---

## 7. Screens & features

### 7.1 Navigation map

```
Desktop:  left sidebar (collapsible)             Mobile:  bottom tab bar + FAB
─────────────────────────────────                ───────────────────────────
 Dashboard                                        [Dashboard] [Trades] (+) [Journal] [More]
 Trades                                            "+" = quick-add trade (FAB)
 Journal                                           More → Analytics, Rules, Calendar,
 Calendar                                                  Playbooks, Reports, Settings
 Analytics
 Rules & Mistakes
 Playbooks
 Reports
 Settings
```

### 7.2 Onboarding (first run)

- **Primary CTA: "Start journaling — free"** → email/Google sign-up → email verification →
  DB auto-provisioned → guided first steps. Under a minute to first trade logged.
- **Secondary path: "Use your own database"** → privacy pitch ("we never see your data") →
  Turso wizard with copy-paste CLI commands, link to Turso signup, validate button,
  auto-migration.
- **Tertiary: "Try the demo"** → instant in-browser journal with sample data (no signup).
- Setup steps after either path: starting capital, default risk %, broker/charges profile,
  timezone (IST default), first 3 rules from templates.

### 7.3 Dashboard

KPI cards (Net P&L, win rate, profit factor, expectancy, avg R, streak, rule-adherence %)
with NumberFlow count-ups · equity curve with drawdown shading · monthly P&L calendar
heatmap · top mistakes this week (frequency + ₹ cost) · recent trades · today's rule
checklist widget.

### 7.4 Trades list

Desktop dense table (TanStack Table + Virtual): date, instrument, direction, qty,
entry/exit, net P&L, R, setup, tags, hold time · mobile card list · filters (date range,
account, segment, setup, tag, win/loss, direction) · bulk actions · **CSV import** from
Zerodha Console, Upstox, Angel One, Dhan, Fyers, Groww with column-mapping UI,
auto-pairing of fills into trades, dedupe on re-import.

### 7.5 Add / Edit trade

**Quick add** (FAB / `T`): instrument search (NIFTY/BANKNIFTY/SENSEX chains — expiry,
strike, CE/PE), direction, qty, entry, exit — < 15 seconds. **Full form:** planned
entry/SL/target (→ planned R), multi-leg fills, charges auto-calc, playbook, confidence,
emotion + mistake tags, clipboard-paste screenshots, markdown notes. **Detail page:**
P&L breakdown (gross → charges → net), R achieved vs planned, candlestick context
(lightweight-charts), what-went-right/wrong prompts, link to that day's journal.

### 7.6 Daily journal

Pre-market (bias, levels, watchlist, max daily loss, plan) · during-market timestamped
notes · post-market review (worked/didn't/lessons/tomorrow's focus) · mood 1–5 ·
"followed my plan?" toggle · day's trades auto-attached · journaling streak indicator.

### 7.7 Rules & Mistakes (the differentiator)

User-defined rules with daily checklist; violations optionally linked to the trade that
broke them · adherence % over time · **₹ cost of each broken rule** · "your most
expensive habit" callout · mistake taxonomy (revenge trade, oversized, chased, early
exit, no SL…) with frequency trend, cost per category, month-over-month improvement.

### 7.8 Analytics

By setup, instrument, day-of-week, **time-of-day buckets** (critical for intraday), hold
duration, long/short, CE/PE · R-multiple histogram, P&L distribution, streak lengths ·
max drawdown, daily-loss-limit breaches, risk per trade vs configured limit · global
date-range/account filter.

### 7.9 Calendar
Month heatmap (P&L intensity); week strip on mobile; day click → trades + journal + rules.

### 7.10 Playbooks
Setup definitions (criteria checklist, example charts) · auto stats per playbook ·
"unassigned trades" nudge.

### 7.11 Reports & data
Auto weekly/monthly review (P&L, best/worst, adherence, mistakes, highlights) → PDF /
shareable image with P&L-blur option · full export: CSV per table + raw SQLite dump ·
import = backup/restore.

### 7.12 Settings
Account & sessions · **Data & privacy: storage mode switch (hosted ⇄ BYOD) wizard** ·
connection status / re-key / QR export (BYOD) · accounts & charge profiles · capital &
risk defaults · tag management · theme picker · analytics opt-out · export/import ·
danger zone (delete account → 30-day grace on hosted DB).

---

## 8. UI & design system

### 8.1 Principles

1. **Dark-first.** Light theme secondary.
2. **Numbers are the UI.** `tabular-nums` everywhere; P&L in Geist Mono.
3. **Dense but breathable.** 8-pt grid; 1 px borders over shadows.
4. **Color = meaning only.** Green/red reserved for P&L; one accent for interaction.
5. **Fast paths.** `T` new trade, `J` journal, `⌘K` palette, paste screenshots, <15 s quick-add.
6. **Motion with restraint.** Confirm and guide, never decorate; honor reduced-motion.

### 8.2 Dark theme palette (default: "Carbon")

| Token | Value | Use |
|---|---|---|
| `bg` | `#0A0A0B` | App background |
| `surface` | `#131316` | Cards, panels |
| `surface-2` | `#1B1B1F` | Hovers, inputs |
| `border` | `#26262B` | Hairlines |
| `text` / `text-muted` | `#FAFAFA` / `#A1A1AA` | Primary / secondary |
| `profit` / `loss` | `#34D399` / `#F87171` | Gains / losses |
| `accent` | `#8B5CF6` (violet-500) | Interactive elements |
| `warning` | `#FBBF24` | Rule violations |

Variants via next-themes: **Carbon**, **Midnight** (`#0B1220` base), **OLED** (`#000`),
**Light** (zinc-50) + **color-blind-safe mode** (blue `#60A5FA` / orange `#FB923C`).
Typography: **Geist** UI (14 px base, 13 px tables), **Geist Mono** for money/R — both
via `next/font`.

### 8.3 Component language

shadcn/ui customized (10 px radius, 1 px borders) · thin chart lines, low-opacity
gradient fills, tooltips in surface-2 · tag chips at 12% hue opacity · empty states with
one action · skeletons everywhere async · optimistic writes · vaul sheets on mobile,
Radix dialogs on desktop — same inner components.

### 8.4 Responsive strategy

| Breakpoint | Layout |
|---|---|
| ≥ 1280 px | Sidebar (240 px ⇄ 64 px rail) + topbar (date-range/account). Multi-col dashboard. Tables. |
| 768–1279 px | Icon rail; 2-col dashboard; tables drop low-priority columns. |
| < 768 px | Bottom tabs (Dashboard, Trades, **+**, Journal, More); FAB; tables → cards; swipeable KPI cards (Embla); calendar → week strip; forms = full-screen sheets. |

---

## 9. Competitive reference

| Product | Learn from | We differ |
|---|---|---|
| TradeZella | Polished dashboard, playbooks UX | Free, open-source, BYOD option, India-FnO-first |
| Tradervue | Mature filtering & reports | Their UI is dated; ours is dark, modern |
| Edgewonk | Discipline/emotion analytics depth | Desktop-only feel; we're web + PWA |
| TraderSync | Broker import breadth | We do Indian brokers first |
| Stonk Journal | Free & simple | Too shallow; we add the rules/mistakes engine |

**Positioning:** "The open-source trading journal — sign up in a minute, or bring your
own database and we never see your data" + the deepest rules-and-mistakes discipline
engine, tuned for Indian intraday/FnO.

---

## 10. Roadmap

**Phase 0 — Foundation (week 1–2)**
Repo + CI gates, scaffold (Next.js, Tailwind, shadcn), design tokens/themes, folder
structure, Drizzle schemas (user DB + platform DB), in-browser migration runner,
**Better Auth setup, DB provisioning + token vending routes**, demo/local mode (OPFS).
SEO skeleton: metadata defaults, sitemap/robots/manifest, SSG landing, Lighthouse CI.

**Phase 1 — MVP (week 3–6)**
Hosted-mode signup → provisioned DB → first trade in <60 s · quick-add + full trade form
(charges engine) · trades list · trade detail · daily journal · dashboard (KPIs, equity
curve, heatmap) · settings · themes · fully responsive · PWA manifest. **Ship it.**

**Phase 2 — BYOD + discipline engine (week 7–10)**
**BYOD connect wizard + mode-switch migration engine (both directions, verified)** ·
rules + checklist + adherence analytics · mistake taxonomy & cost analytics · calendar ·
CSV imports (Zerodha first) · attachments · service worker offline shell.

**Phase 3 — Depth + content (week 11–14)**
Full analytics · playbooks · weekly/monthly reports + PDF · connection QR multi-device ·
color-blind mode · command palette · SEO content engine: docs, blog, comparison pages,
OG images, JSON-LD.

**Phase 4 — Community & scale**
Deploy-to-Vercel self-host button · CONTRIBUTING + good-first-issues · dormant-DB
archiving · Turso OSS-credits application · storage adapters (Postgres/Supabase) by
community · i18n (Hindi, hreflang) · TradeZella/Tradervue import · public demo.

---

## 11. Open-source operations

- **License:** MIT.
- **Repo hygiene:** README (GIF demo + deploy button), ARCHITECTURE.md, issue templates,
  GitHub Discussions, Vercel preview deploys on PRs.
- **Telemetry:** cookieless Vercel Analytics by default; PostHog events anonymous,
  disclosed, opt-out-able — trust is the product.
- **Security:** strict CSP, `server-only` guard on platform-token code, dependency audit
  in CI, SECURITY.md disclosure policy.
- **Self-hosters** get the full dual-mode stack with their own env vars — the deploy
  button asks for the same env list as §2.
