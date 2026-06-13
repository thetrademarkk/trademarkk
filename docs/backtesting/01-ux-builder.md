# UX — Journey, IA & the No-Code Builder

> **Status:** Build-ready design spec. This is the flagship UX document for the TradeMarkk Backtesting universe — read it before writing a line of code in `src/app/backtesting/**`.
>
> **Scope:** A new, standalone, **PUBLIC** `/backtesting` universe — a peer to `/community` and `/blog`, reached from the marketing site header. It is **NOT** inside the logged-in `/app` journal. Two ways in: a **No-Code Builder** (primary) and **Bring-Your-Own-Code**. This doc owns the full Information Architecture, the user journeys, and the complete No-Code Builder spec with ASCII wireframes for every step plus the mobile bottom-sheet variant.
>
> **Codebase anchors (verified):** `src/components/shared/site-header.tsx` (shared header with a `cta` slot), `src/components/shared/nav-links.tsx` (the `NAV` array to extend), `src/app/community/layout.tsx` (the public-universe layout to clone), `src/app/app/backtesting/page.tsx` (the placeholder to **remove + redirect**), `src/lib/options/payoff.ts` (`buildPayoffCurve`, `classifyStrategy`, `legPayoffAt`; `PayoffLeg.qty` is lot-scaled), `src/lib/charges/charges.ts` (`computeCharges(profile, t)`), `src/lib/montecarlo/*` (Web-Worker equity cone), `src/server/rate-limit.ts`, the `notifications` table + Resend infra.
>
> **Constraints (from the brief):** near-zero infra cost; open-source; mobile-first PWA; educational (overfitting / "past performance" disclaimers are first-class). Only 3 instruments: **NIFTY (lot 75)**, **BANKNIFTY (lot 35)**, **SENSEX (lot 20)** — index spot + weekly/monthly options. Data is the public HuggingFace dataset `thetrademarkk/india-index-options-1m`, queried on-demand via duckdb-wasm; **option-strike coverage is patchy (~40–68% missing, worst on SENSEX)** so honest missing/illiquid-strike handling is a hard requirement, not a nicety.

---

## 0. The one-paragraph thesis

The Backtesting universe is a **public, anonymous-first, $0-to-run** product that lives beside `/community` and `/blog`. A trader lands, picks **one of two ways to backtest** (No-Code Builder or Bring-Your-Own-Code), builds + runs entirely **client-side** (duckdb-wasm + Pyodide pulling HuggingFace slices), sees **beautiful, honest results without ever logging in**, and is **nudged to log in only at the moment of value** — save, share, schedule, or get notified. Everything up to and including a rendered result is public and free. Login gates only persistence, sharing, scheduling, and email/notify. The journal and community are _adjacent universes_ you cross-link into, never prerequisites. Our moat is **coverage honesty**: we are the only tool of the five (AlgoTest, Sensibull, Opstra, Tradetron, Streak) that tells you what data actually exists _before_ you build, _while_ you choose a strike, and _after_ you run.

---

# PART A — JOURNEY & INFORMATION ARCHITECTURE

## 1. Sitemap — the route map (public vs gated)

### 1.1 Top-level placement in the header

The header nav (`src/components/shared/nav-links.tsx`) currently is:

```ts
const NAV = [
  { href: "/features", label: "Features" },
  { href: "/community", label: "Community" },
  { href: "/pulse", label: "Pulse" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
];
```

**Edit:** insert Backtesting at **index 2** (right after Community — it is a flagship universe, not a footer afterthought):

```ts
const NAV = [
  { href: "/features", label: "Features" },
  { href: "/community", label: "Community" },
  { href: "/backtesting", label: "Backtesting" }, // ← NEW (index 2)
  { href: "/pulse", label: "Pulse" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
];
```

`nav-links.tsx` already does active-state via `pathname.startsWith(href + "/")`, so `/backtesting/*` highlights "Backtesting" automatically — no other change is needed. On `md+` screens all 7 fit; below `md` the nav lives in the mobile sheet — add Backtesting there too.

### 1.2 Full route tree

Legend: 🌐 fully public (anonymous OK) · 🔓 public but writes nudge login · 🔒 requires session · ↪ redirect

```
/backtesting                                  🌐  S1 Landing (hero, two-ways, sample, trust, CTA)
│
├── /backtesting/build                         🔓  S3 No-Code Builder wizard (anon builds + runs)
│   ├── ?template=<id>                          🔓  Prefill legs from a template
│   ├── ?strategy=<slug>                        🔓  Prefill from a named/shared strategy
│   └── ?from=<runId>                           🔓  "Duplicate & tweak" entry
│
├── /backtesting/code                           🔓  S4 Bring-Your-Own-Code editor (anon writes + runs)
│   └── ?template=<id>                           🔓  Open a runnable starter (e.g. short-straddle)
│
├── /backtesting/run/[runId]                     🔓  S6 Results page (shareable, public-readable)
│   │                                                 anon run  → ephemeral client runId (localStorage)
│   │                                                 saved run → server runId (public unless private)
│   └── /compare?ids=a,b,c                         🔓  S8 Compare 2–4 runs side by side
│
├── /backtesting/explore                          🌐  S9 Gallery of PUBLIC saved runs + featured strategies
│   └── ?index=NIFTY&sort=return                   🌐  Filter/sort (by return / Sharpe / max-DD)
│
├── /backtesting/strategies/[slug]                🌐  Strategy detail (named config + its best run)
│
├── /backtesting/templates                        🌐  S10 Template gallery (outlook-grouped)
│   └── /templates/[id]                            🌐  Template detail → "Use this" → /build?template=id
│
├── /backtesting/data                             🌐  S11 Data-coverage explorer (the honesty differentiator)
│   └── ?index=BANKNIFTY                            🌐  Per-index expiry list + strike-coverage heatmap
│
├── /backtesting/docs                             🌐  S12 Mini-docs hub
│   ├── /docs/api                                  🌐  The ~6 BYOC functions (load_index, load_option…)
│   ├── /docs/glossary                             🌐  Plain-English AlgoTest jargon (ATM Pt, RE COST…)
│   └── /docs/methodology                          🌐  Slippage/charges model, fills, limitations
│
├── /backtesting/saved                            🔒  S13 My saved backtests (signed-in dashboard)
│
└── /backtesting/og/[runId]                        🌐  Dynamic OG image for a shared run (route handler)

API (route handlers, server):
/api/backtest/runs            POST 🔒 save a run   ·  GET 🌐 list public
/api/backtest/runs/[id]       GET  🌐 (public/owner) · PATCH/DELETE 🔒 owner
/api/backtest/server-run      POST 🔒 (paid tier — security-checked Vercel Sandbox)
/api/backtest/notify          POST 🔒 (subscribe to run-complete email/notification)

Redirects (kill the dead placeholder):
/app/backtesting              ↪ 308 → /backtesting
/app/app/backtesting          ↪ 308 → /backtesting   (legacy)
```

### 1.3 Public vs gated — the rule, stated once

| Action                                                        | Anonymous                                        | Signed-in       |
| ------------------------------------------------------------- | ------------------------------------------------ | --------------- |
| View landing, templates, data explorer, docs, explore gallery | ✅                                               | ✅              |
| Build a strategy (no-code) / write code (BYOC)                | ✅                                               | ✅              |
| **Run** a backtest (client-side)                              | ✅                                               | ✅              |
| **View** any result (own or shared)                           | ✅                                               | ✅              |
| **Save** a run / strategy                                     | ❌ nudge                                         | ✅              |
| **Share** with a stable public URL                            | ❌ nudge (ephemeral in-session link still works) | ✅              |
| **Compare** runs from history                                 | ⚠️ only runs held in this session                | ✅ full history |
| **Schedule** / server-run (>300s) / **email-notify**          | ❌ nudge                                         | ✅              |
| Publish to Explore gallery / link to journal/community        | ❌ nudge                                         | ✅              |

> **Hard rule (from the brief): never gate login upfront.** The login wall appears _only_ on a save/share/schedule/notify intent, and the run result is already on screen behind the modal so the user sees exactly what they'd lose by walking away.

---

## 2. Site-level IA — how Backtesting relates to journal & community

```
                         ┌──────────────────────────────────────────────┐
                         │            PUBLIC UNIVERSES (one header)        │
                         │  marketing /  ·  /community  ·  /backtesting    │
                         └──────────────────────────────────────────────┘
                                  │ anon-first, $0, educational
        cross-links (never prerequisites) │
   ┌──────────────────────┬───────────────┴───────────────┬───────────────────┐
   ▼                      ▼                                 ▼                   ▼
COMMUNITY            BACKTESTING                         JOURNAL (/app)      BLOG/DOCS
"share a result      "validate an idea"                  "your real trades" "learn"
 post" ◀────────────▶ "post this backtest to community"  ───┐
                     "backtest a journaled playbook" ◀──────┘
```

Three concrete cross-universe bridges (all opt-in, all post-result, all login-gated writes):

1. **Backtest → Community.** On a result page: _"Share to community"_ composes a community post with the run's OG card + link (reuses the structured trade-card pattern).
2. **Journal → Backtest.** In the journal, a saved _playbook/setup_ gets a _"Backtest this setup"_ action that deep-links to `/backtesting/build?strategy=<derived>`. This fulfils the dead `/app/app/backtesting` placeholder's promise ("the setups you journal are the setups you test") — but the _engine_ lives in the public universe.
3. **Backtest → Journal.** After a strong result: _"Add to my playbook"_ writes the config into the journal so the trader can paper/live-trade it.

> **Opinion:** Do **not** duplicate the engine inside `/app`. **One engine, public.** The journal merely _links in_ with prefilled params and _links out_ by saving a config. This keeps infra at $0 and avoids two codebases.

---

## 3. Screen inventory (the complete list)

| #   | Screen                 | Route                                        | Type           | Key states                                             |
| --- | ---------------------- | -------------------------------------------- | -------------- | ------------------------------------------------------ |
| S1  | Landing                | `/backtesting`                               | Marketing      | first-visit / returning-anon / signed-in               |
| S2  | Mode choice            | inline `#choose` on S1 + standalone fallback | Decision       | hover-preview both cards                               |
| S3  | No-Code Builder wizard | `/backtesting/build`                         | App            | 4 steps + Review + live preview; empty/coverage states |
| S4  | BYOC code editor       | `/backtesting/code`                          | App            | cold-start / running / 3 error states                  |
| S5  | Running / progress     | overlay within S3·S4, then S6                | Transitional   | streaming named stages, cancel                         |
| S6  | Results                | `/backtesting/run/[id]`                      | App            | verdict → evidence → drilldown; coverage chips         |
| S7  | Login-nudge modal      | overlay on S6 (and on save intent)           | Modal          | save / share / schedule / notify variants              |
| S8  | Compare runs           | `/backtesting/run/compare`                   | App            | 2–4 columns                                            |
| S9  | Explore gallery        | `/backtesting/explore`                       | Gallery        | empty / loading / filtered                             |
| S10 | Template gallery       | `/backtesting/templates`                     | Gallery        | outlook-grouped                                        |
| S11 | Data coverage explorer | `/backtesting/data`                          | Tool           | heatmap; sparse-strike honesty                         |
| S12 | Docs hub               | `/backtesting/docs/*`                        | Content        | —                                                      |
| S13 | My saved backtests     | `/backtesting/saved`                         | Dashboard (🔒) | empty (onboarding) / populated                         |
| S14 | Mobile bottom-sheets   | within S3/S4                                 | Mobile         | leg editor, strike picker, date picker                 |

Full ASCII wireframes for **S1 (landing)** and **S2 (mode choice)** are in §6. The complete **No-Code Builder (S3)** spec — every step, with wireframes — is **Part B** (§9–§17). The BYOC editor (S4) and Results (S6) internals are speced in sibling docs; here their **entry/exit contracts and states** are defined in the journey maps (§5) so the IA is complete.

---

## 4. State model — first-run vs returning vs signed-in

Detected client-side (mirror the journal's `getStoredMode()` pattern from `src/lib/db/byod-store`, but with a **parallel, lightweight flag** so we **never** force a journal redirect here — the backtesting universe must stay reachable even for users with a connected journal).

```
localStorage keys (client):
  tmk.bt.visited         "1"                → has seen the landing before
  tmk.bt.lastMode        "nocode" | "code"  → which builder they last used
  tmk.bt.draft.<mode>    {…}                → autosaved wizard/editor state (lossless Back)
  tmk.bt.recentRuns      [{id,label,ts,index,pnl,coverage}]  → in-session run history (max ~10)

session (server, if signed-in):
  better-auth session    → unlocks save/share/schedule/notify + /saved + /api writes
```

### State matrix

| Signal                                     | Landing hero                                                                               | Mode cards                            | Primary CTA                                 | Notes                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| **First-run** (`!visited`, no session)     | Full hero + "two ways" explainer + sample result + trust row                               | Both expanded with 1-line "best for…" | "Build a strategy — free, no signup"        | Educational disclaimers prominent           |
| **Returning anon** (`visited`, no session) | Compact hero + **"Resume your draft"** banner if `draft.*` exists + **"Recent runs"** rail | Pre-highlight `lastMode`              | "Resume" if draft, else "New backtest"      | Recent runs from `recentRuns` localStorage  |
| **Signed-in** (session)                    | Compact hero + **"Saved backtests (N)"** + recent                                          | Pre-highlight `lastMode`              | "New backtest" + secondary "My saved" → S13 | No nudges; save/share are inline, not modal |

> **Opinion:** **Do not redirect** signed-in users away from `/backtesting` (unlike the marketing root, which redirects to `/app/dashboard`). The backtesting landing is a real destination for everyone. Only swap the hero density and CTAs.

---

## 5. User journey maps

### 5.1 New user (anonymous → build → run → RESULTS → nudge) — the golden path

```
STAGE        ENTRY                        SCREEN          GOAL / EMOTION              EXIT / NUDGE
──────────────────────────────────────────────────────────────────────────────────────────────
0 DISCOVER   Header "Backtesting" /       S1 Landing      "Can I test an idea         scroll → "two ways"
             marketing link / SEO                          for free, fast?"            choice block (#choose)
                                                          curious, slightly skeptical
──────────────────────────────────────────────────────────────────────────────────────────────
1 CHOOSE     Click a mode card            S2 Mode choice  "Which fits me?"            → /build (most) or
                                                          no-code = relief             → /code (technical)
                                                          code = control
──────────────────────────────────────────────────────────────────────────────────────────────
2 BUILD      /build?template=… or scratch S3 Builder      "This is easier than        Live preview reassures;
             (default = a covered range   (4 steps +       AlgoTest." progressive      coverage chip shows
              so first run never empty)    Review +        disclosure keeps calm       data is real
                                           live payoff)
             ─ Step1 Setup:  NIFTY · 1m · last 3 mo (smart default, well-covered)
             ─ Step2 Legs:   ATM default; "Advanced strike" discloses premium/delta/exact
             ─ Step3 Timing: 09:20 → 15:15 fixed-time; DTE/day-of-week behind disclosure
             ─ Step4 Risk:   simple overall MTM SL/tgt; per-leg behind disclosure
             ─ Step5 Review: plain-language summary + coverage badge for the exact range
──────────────────────────────────────────────────────────────────────────────────────────────
3 RUN        Click "Run backtest"         S5 Progress     "Is it working?"            streams: "Loading Python
             (NO login asked)             (inline overlay) trust via honest progress   runtime… pulling NIFTY
                                                          <375ms feel to arrival       slice… simulating"
                                                                                       cold-start framed as
                                                                                       intentional, cancelable
──────────────────────────────────────────────────────────────────────────────────────────────
4 RESULTS    Auto-transition              S6 Results      "Is this any good?"         VERDICT in <3s:
             /run/<ephemeralId>           (verdict→         delight + honesty          equity+drawdown hero,
                                           evidence→                                    coverage chips up top,
                                           drilldown)                                   6 headline stats
             Honest empty/degraded state if coverage low: "Nearest strike used
             (24500→24450, 62% coverage)" — never silent.
──────────────────────────────────────────────────────────────────────────────────────────────
5 NUDGE      User clicks Save/Share/      S7 Nudge modal  "I want to keep this"       Login (better-auth).
             Notify/Schedule              (result visible  motivated, low-friction     Result NOT lost:
             ── this is the ONLY gate ──   behind modal)   because value already       ephemeral run persists
                                                           delivered                    to server on auth.
──────────────────────────────────────────────────────────────────────────────────────────────
6 RETAIN     Post-login                   S6 (saved) →     "What now?"                 → Share to community,
                                          S13 saved        ownership                    → Add to journal playbook,
                                                                                       → Compare, → Schedule
```

**Critical anonymous-run mechanics (implementation contract):**

- Every run gets an **ephemeral `runId`** (uuid) the instant it starts, so `/backtesting/run/[id]` is routable and the result is deep-linkable _within the session_.
- The result payload (config + computed metrics + series) is cached to `localStorage` (`recentRuns` + a per-run blob, capped). This is what makes "Back" lossless and "Recent runs" possible without a server.
- On **login at the nudge**, the in-memory/localStorage run is **POSTed to `/api/backtest/runs`** and the ephemeral id is swapped for a stable server id (302 to the new URL). The user **never re-runs**.
- **Share** for anon: offers a _copy-link_ that works only while the tab/session lives + an inline nudge ("Log in for a permanent link"). Honest, not a dead button.

### 5.2 Returning user

```
A) RETURNING ANON with a draft
   Header → S1 (compact) → "Resume your NIFTY draft?" banner → S3 rehydrated from
   tmk.bt.draft.nocode → Run → S6. Recent-runs rail lets them reopen prior session runs.

B) RETURNING ANON, no draft
   Header → S1 (compact, "Recent runs" rail from localStorage) → click a recent run
   reopens S6 (recomputed if cache evicted) OR "New backtest" → S2.

C) SIGNED-IN RETURNING
   Header → S1 (compact, "Saved (N)") → S13 /saved (their library) → open a saved run
   (S6) or "Duplicate & tweak" (S3 with ?from=runId) → Run → save is INLINE (no modal,
   optimistic) → optionally Schedule / Compare / Share-to-community.
```

> **Opinion on optimistic UI:** apply `useOptimistic` to **save / bookmark / rename / toggle-public** — reversible, low-risk. **Never** apply it to the run result itself (results are _computed_, not asserted).

### 5.3 The login-nudge state machine (S7)

```
       run finished, result on screen (anon)
                    │
   ┌────────────────┼─────────────────┬───────────────┐
   ▼                ▼                 ▼               ▼
 [Save]          [Share]          [Notify me]     [Schedule]
   │                │                 │               │
   └──────► S7 modal (contextual headline + the result thumbnail) ◄──────┘
                    │
        ┌───────────┴───────────┐
        ▼                        ▼
   sign in / sign up        "Maybe later" → dismiss, result stays,
   (better-auth)             ephemeral link copied to clipboard
        │
        ▼
   POST run → stable id → return to S6 with success toast
   (intended action auto-completes: e.g. share link now permanent)
```

---

## 6. ASCII wireframes — Landing (S1) & Mode choice (S2)

### 6.1 — S1 Landing (`/backtesting`) — first-run, mobile-first then desktop

**Desktop (max-w-5xl, matches the SiteHeader container):**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  ◆ TradeMarkk   Features  Community  [Backtesting]  Pulse  Docs  Blog  FAQ │ ← shared SiteHeader
│                                              ☼  ⌥github   [ My journal ▸ ]  │   cta slot = journal link
├───────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─ hero-glow ───────────────────────────────────────────────────────┐    │
│   │  ▣ BACKTESTING · NIFTY · BANKNIFTY · SENSEX                         │    │
│   │                                                                     │    │
│   │   Backtest options strategies.                                      │    │
│   │   Free. In your browser. No signup.                                 │    │
│   │                                                                     │    │
│   │   5 years of 1-minute NIFTY, BANKNIFTY & SENSEX data — runs         │    │
│   │   entirely on your machine, costs you nothing, shares nothing.      │    │
│   │                                                                     │    │
│   │   [ Build a strategy  ▸ ]   [ Write code  </> ]   ↓ see a sample    │    │
│   │      no-code, 4 steps         Python, in-browser                    │    │
│   │                                                                     │    │
│   │   ⚡ runs client-side   🔒 your data stays local   ◎ open source    │    │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ── "Two ways to backtest" (anchor #choose) ──────────────────────────    │
│   ┌───────────────────────────────┐   ┌───────────────────────────────┐    │
│   │ ▣  NO-CODE BUILDER             │   │ </>  BRING YOUR OWN CODE       │    │
│   │  Most popular                  │   │  For coders                    │    │
│   │                                │   │                                │    │
│   │  Point-and-click legs, strikes │   │  Write Python, we run it in    │    │
│   │  by ATM / premium / delta.     │   │  your browser. Pull data with  │    │
│   │  Live payoff as you build.     │   │  a 6-function API.             │    │
│   │                                │   │                                │    │
│   │  Best for: spreads, straddles, │   │  Best for: custom logic,       │    │
│   │  iron condors, fixed-time.     │   │  indicators, your own rules.   │    │
│   │                                │   │                                │    │
│   │  ┌ mini live-payoff preview ┐  │   │  ┌ mini code+chart preview  ┐  │    │
│   │  │      ╱‾‾‾‾╲               │  │   │  │ def strategy(ctx):       │  │    │
│   │  │  ___╱      ╲___          │  │   │  │   ce = load_option(...)  │  │    │
│   │  └──────────────────────────┘  │   │  └──────────────────────────┘  │    │
│   │       [ Start building ▸ ]     │   │       [ Open editor ▸ ]        │    │
│   └───────────────────────────────┘   └───────────────────────────────┘    │
│                                                                             │
│   ── Sample result (real run, anonymized) ─────────────────────────────    │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  "9:20 short straddle · NIFTY · 2021–2026"        [ Open this run ▸ ] │  │
│   │  ┌ equity curve ───────────────────────╮  Total P&L   +₹3.2L  (+64%) │  │
│   │  │        ╱‾‾‾‾‾╲      ╱‾‾‾‾‾‾‾         │  Return/MaxDD     2.8       │  │
│   │  │   ____╱       ╲____╱                 │  Max Drawdown   −₹48k       │  │
│   │  ├ drawdown (shared axis) ──────────────┤  Win %             58%      │  │
│   │  │  ▔▔▔▔╲___╱▔▔▔▔▔▔▔▔▔▔                 │  Expectancy   +₹410/day     │  │
│   │  └───────────────────────────────────╯  Coverage  ▮▮▮▮▯ 82%          │  │
│   │  ⚠ Educational only · past performance ≠ future results               │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ── Why trust these numbers ──────────────────────────────────────────    │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│   │ Real STT/GST │ │ Honest about │ │ Monte-Carlo  │ │ Open source  │      │
│   │ & slippage   │ │ missing      │ │ drawdown     │ │ — audit the  │      │
│   │ baked in     │ │ strikes      │ │ (10k paths)  │ │ engine       │      │
│   └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘      │
│                                                                             │
│   ── Explore / Templates / Data ───────────────────────────────────────    │
│   [ Browse public runs → /explore ] [ Templates → ] [ Data coverage → ]     │
│                                                                             │
│   ┌─ CTA band ─────────────────────────────────────────────────────────┐   │
│   │  Build your first backtest in 60 seconds. No signup until you save. │   │
│   │                                   [ Build a strategy ▸ ]            │   │
│   └─────────────────────────────────────────────────────────────────────┘  │
├───────────────────────────────────────────────────────────────────────────┤
│  footer · MIT · Educational only — nothing here is investment advice.       │
└───────────────────────────────────────────────────────────────────────────┘
```

**Mobile (≤640px) — same sections stacked; hero CTAs full-width; mode cards stack:**

```
┌─────────────────────────────┐
│ ◆ TradeMarkk        ☼  ⌥  ▸ │ ← header; nav in sheet
├─────────────────────────────┤
│ ▣ NIFTY·BANKNIFTY·SENSEX     │
│                              │
│ Backtest options             │
│ strategies. Free. In your    │
│ browser. No signup.          │
│                              │
│ [ Build a strategy ▸ ]       │ ← full-width
│ [ Write code </> ]           │ ← full-width
│ ↓ see a sample               │
│ ⚡ client-side 🔒 local ◎ OSS │
├─────────────────────────────┤
│ Two ways to backtest         │
│ ┌─ NO-CODE BUILDER ────────┐ │
│ │ Most popular             │ │
│ │ …live payoff preview…    │ │
│ │ [ Start building ▸ ]     │ │
│ └──────────────────────────┘ │
│ ┌─ BRING YOUR OWN CODE ────┐ │
│ │ For coders               │ │
│ │ …code preview…           │ │
│ │ [ Open editor ▸ ]        │ │
│ └──────────────────────────┘ │
├─────────────────────────────┤
│ Sample result               │
│ ┌ equity ────────────────┐  │
│ │  ╱‾‾╲   +₹3.2L (+64%)   │  │
│ │ ╱    ╲  R/DD 2.8        │  │
│ └────────────────────────┘  │
│ Coverage ▮▮▮▮▯ 82%          │
│ ⚠ Educational only          │
├─────────────────────────────┤
│ Why trust · 4 chips (2×2)    │
│ Explore · Templates · Data   │
│ [ Build a strategy ▸ ]       │
└─────────────────────────────┘
```

**Returning-anon variant** (replaces the hero copy block; everything else identical):

```
│   ┌─ resume banner ────────────────────────────────────────────────┐
│   │ ⟳ You were building a NIFTY straddle.   [ Resume ▸ ] [ Discard ]│
│   └────────────────────────────────────────────────────────────────┘
│   Recent runs:  [NIFTY straddle +64% ▸] [BN condor −12% ▸] [SENSEX … ▸]
```

**Signed-in variant** (hero secondary line; no nudges anywhere):

```
│   [ New backtest ▸ ]   [ My saved (7) → /saved ]
│   Recent: [ … saved runs … ]
```

### 6.2 — S2 Mode choice (the decision surface)

Primary placement is the **inline `#choose` block on S1** (wired above). A **standalone** version is used when arriving via a "Choose a mode" deep-link or a generic "Backtest" CTA elsewhere. It is a focused, full-bleed decision screen:

```
┌───────────────────────────────────────────────────────────────────────────┐
│  ◆ TradeMarkk  …nav…                                    ☼ ⌥ [ My journal ] │
├───────────────────────────────────────────────────────────────────────────┤
│                          How do you want to backtest?                       │
│            Both run free, in your browser. You can switch anytime.          │
│                                                                             │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  ▣   NO-CODE BUILDER             │  │  </>   BRING YOUR OWN CODE       │ │
│  │      ─ Recommended ─             │  │                                  │ │
│  │                                  │  │                                  │ │
│  │  Build multi-leg strategies by   │  │  Write a Python strategy. We run │ │
│  │  clicking. Pick strikes by       │  │  it in your browser with a tiny  │ │
│  │  ATM±, %, premium or delta.      │  │  data API — zero server, zero    │ │
│  │  Watch the payoff update live.   │  │  cost, zero data leaving your    │ │
│  │                                  │  │  machine.                        │ │
│  │  ✓ 4-step guided wizard          │  │  ✓ Monaco editor + 6-fn API stub │ │
│  │  ✓ Live payoff + PoP + Greeks    │  │  ✓ Runnable starter templates    │ │
│  │  ✓ AlgoTest-grade risk controls  │  │  ✓ Ctrl-click any fn → docs      │ │
│  │  ✓ Honest missing-strike handling│  │  ✓ Plain-English error cards     │ │
│  │                                  │  │                                  │ │
│  │  Best for traders who think in   │  │  Best for traders who code and   │ │
│  │  legs, spreads & fixed times.    │  │  want custom logic / indicators. │ │
│  │                                  │  │                                  │ │
│  │  ┌ live mini-payoff ──────────┐  │  │  ┌ editor preview ────────────┐  │ │
│  │  │     ╱‾‾‾‾╲                 │  │  │  │ ce = nearest_strike(...)   │  │ │
│  │  │ ___╱      ╲___            │  │  │  │ pnl = backtest(legs)       │  │ │
│  │  └────────────────────────────┘  │  │  └────────────────────────────┘  │ │
│  │                                  │  │                                  │ │
│  │      [ Start building  ▸ ]       │  │      [ Open the editor  ▸ ]      │ │
│  └──────────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                             │
│   New to backtesting?  Start with a template → /backtesting/templates       │
│   ⚠ Educational tool. Backtests can be over-fit; past ≠ future.             │
└───────────────────────────────────────────────────────────────────────────┘
```

Interaction notes for S2:

- **Hover/tap** a card → its mini-preview animates (decelerate `cubic-bezier(0,0,0.2,1)`, ~200ms); the chosen card springs forward (`stiffness:235, damping:10`).
- Cards are **`<a>`/`<Link>`** to `/build` and `/code` — fully crawlable, work without JS.
- `tmk.bt.lastMode` pre-highlights the returning user's prior choice with a subtle "Last used" chip.
- Keyboard: `1`/`B` → builder, `2`/`C` → code (surfaced in a tiny hint + the ⌘K palette).

---

## 7. Navigation & chrome decisions

1. **Clone the community layout** (`src/app/community/layout.tsx`) into `src/app/backtesting/layout.tsx`: same `SiteHeader`, wrapped in `QueryProvider`, with a backtesting-specific `cta` slot. The CTA differs by state:
   - anon/returning: `[ My journal ▸ ]` (outline) — same as community, keeps the cross-link.
   - signed-in: add a `[ Saved ]` quick link.
   - Always: keep `ThemeToggle` + GitHub icon from `SiteHeader`.
2. **Footer:** add a **"Backtesting"** group to the marketing footer `FOOTER_GROUPS` (`/backtesting`, `/backtesting/templates`, `/backtesting/explore`, `/backtesting/data`, `/backtesting/docs`). Keep the universal "Educational only" line.
3. **Active-state:** no change beyond adding the NAV entry — `nav-links.tsx` already matches prefixes.
4. **⌘K palette** (delight): scope commands — _New backtest_, _Switch index → BANKNIFTY_, _Open template…_, _Compare runs_, _Go to data coverage_, _Open a recent run_. Anonymous-safe; gated commands (Save/Schedule) trigger the nudge.
5. **Within-builder sub-nav:** the wizard stepper (`Setup · Legs · Timing · Risk · Review`) is the only "nav" inside S3; BYOC uses editor chrome (file/run/data-catalog rail), not the wizard.

---

## 8. SEO, metadata & sharing

- `/backtesting`, `/templates/*`, `/strategies/*`, `/explore`, `/data` are **statically/ISR rendered and indexable** (clone the `revalidate = 60` + ISR-seed pattern from `community/page.tsx`). Builder/editor/results are app-like and `noindex` **except public saved runs** and **strategy detail** pages, which are the SEO surface — "NIFTY short straddle backtest 2021–2026".
- **JSON-LD:** `SoftwareApplication` for the landing (mirror the marketing root); clear "educational" framing on data/methodology docs.
- **Dynamic OG image** per shared run via `/backtesting/og/[runId]` (route handler) — equity curve + headline stats + coverage chip. This makes a shared backtest delightful in WhatsApp/Twitter (the dominant Indian-trader share channels).
- **Disclaimers** are first-class, not fine print: a persistent "Educational · past ≠ future · backtests can over-fit" line in the footer and on every result.

---

# PART B — THE NO-CODE BACKTEST BUILDER (S3)

> **Surface:** `/backtesting/build` (public, anonymous-first). Builder state lives in URL-hash + `localStorage` (`tmk.bt.draft.nocode`), never gated.
> **Route shape:** `/backtesting` (landing) → `/backtesting/build` (builder) → `/backtesting/run/[id]` (results).
> **Design thesis:** AlgoTest's risk/strike engine + Sensibull's live-payoff joy + Streak's friendly dropdowns, delivered as a **4-step (+Review) progressive-disclosure wizard with a persistent live preview**, winning outright on **honest missing-strike/coverage handling**.

---

## 9. Global frame — the shell every step lives in

The builder is **never** a sequence of full-page swaps. It is one persistent two-pane shell: **left = step content** (changes), **right = live preview rail** (always mounted, never unmounts, animates its internals). This is the single most important structural decision — it's what makes it feel like Sensibull (joyful, live) instead of AlgoTest (a form you submit).

### 9.1 Desktop layout (≥1024px) — 12-col grid, 24px gutters

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│  ◀ TradeMarkk  Backtest                              [Coverage 82% ▾]   ⌘K   [Save ☆]  (?)  │ ← top bar (sticky, 56px)
├──────────────────────────────────────────────────────────────────────────────────────────┤
│  ●━━━━━━●──────○──────○                                              Short Straddle · NIFTY │ ← stepper (sticky, 48px)
│  Setup   Legs   Timing  Risk·Run                                     2 legs · 17 Apr–13 Jun │
├───────────────────────────────────────────┬──────────────────────────────────────────────┤
│                                            │  LIVE PREVIEW  (right rail, span 5, sticky)    │
│   STEP CONTENT (left, span 7)              │                                                │
│                                            │   Payoff at expiry            [Expiry|Target]  │
│   ┌──────────────────────────────────┐     │   ┌────────────────────────────────────────┐  │
│   │                                  │     │   │            ╱‾‾‾‾‾‾‾                       │  │
│   │  (step-specific cards here)      │     │   │  ─────────●──────────●───────  (P&L=0)   │  │
│   │                                  │     │   │  ╲___╱                      ╲___         │  │
│   └──────────────────────────────────┘     │   └────────────────────────────────────────┘  │
│                                            │   Max P +₹18,750  Max L −₹41,250  POP 64%      │
│                                            │   BE 22,310 / 22,690   Margin ≈ ₹1.34L         │
│                                            │   ┌─ Greeks ───────────────────────────────┐  │
│                                            │   │ Δ +2  Θ +1,240/d  Γ −0.4  Vega −890     │  │
│                                            │   └────────────────────────────────────────┘  │
│                                            │   [▸ Target-day P&L table]                     │
│                                            │                                                │
│   [ ← Back ]                  [ Continue → ]│   ⓘ Premiums est. from 1m data on entry date   │
└───────────────────────────────────────────┴──────────────────────────────────────────────┘
```

- **Right rail is ~440px**, sticky at `top: 104px` (below the two sticky bars), independently scrollable.
- The rail's payoff graph recomputes on every leg/strike change via the existing `buildPayoffCurve()` — debounced 120ms, redraw uses the **decelerate curve** `cubic-bezier(0,0,0.2,1)` at 220ms (path morphs, not a hard cut).
- Strategy auto-label (top-right of stepper) comes from `classifyStrategy()` — "Short Straddle", "Iron Condor", etc., updating live. Falls to "Custom" gracefully.
- `PayoffLeg.qty` is **lot-scaled** (one NIFTY lot → qty 75). Store legs in that convention so the preview math and the run engine agree exactly.

### 9.2 Stepper component

Five nodes (four build steps + Review), **never micro-steps** (NN/G: 3–4 top-level decisions). Numbered + labelled. Completed = filled accent dot + check; current = ring; future = hollow muted. Clicking a **completed** node jumps back **losslessly** (state is one store; no data dropped). Future nodes are disabled until their predecessor validates.

```
●━━━━━━━●───────○───────○───────○
✓Setup  ●Legs   Timing  Risk    Review
```

Tokens: completed/current track `bg-accent`, future track `bg-border`, current ring `ring-2 ring-accent`. Mobile collapses to `2 / 5 · Legs` text + a thin top progress bar.

### 9.3 Cross-cutting rules (apply to every step)

- **Smart defaults everywhere** so Step 1 + "Run" alone produces a meaningful backtest (the AlgoTest "wall of fields" antidote).
- **Validate on Continue**, inline, blocking; never validate-on-keystroke for numbers (it punishes mid-typing). Errors clear on Back.
- **Autosave** every field change to `localStorage` (`tmk.bt.draft.nocode`); a faint "Saved" tick pulses in the top bar. Refresh/return rehydrates the exact draft.
- **`prefers-reduced-motion`**: payoff redraws become instant cross-fades; spring-ins become 1-frame fades.
- **Coverage chip** (top bar) is global and live — see §16. It is our signature honesty primitive.

---

## 10. Step 1 — Setup (index · interval · date range)

Calmest screen in the product. Three decisions, each with a strong default, and an immediate coverage verdict so the user learns "what exists" before building anything.

```
┌────────────────────────────────────────────────────────┐
│  Set up your backtest                                    │
│  Pick a market, candle size and date range.             │
│                                                          │
│  INDEX                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │
│  │   NIFTY      │ │  BANKNIFTY   │ │   SENSEX     │     │
│  │   ●          │ │              │ │              │     │
│  │ lot 75       │ │ lot 35       │ │ lot 20       │     │
│  │ 2021–now ✓   │ │ 2021–now ✓   │ │ 2022–now     │     │
│  └──────────────┘ └──────────────┘ └──────────────┘     │
│                                                          │
│  CANDLE INTERVAL                                         │
│  ( 1m ) [ 3m ] [ 5m ] [ 15m ]      ⓘ 1m = most precise   │
│                                                          │
│  DATE RANGE                                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │  From  [ 17 Apr 2026 ]    To  [ 13 Jun 2026 ]    │    │
│  │  Quick:  (1M) [3M] [6M] [1Y] [YTD] [Max]         │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌── Data confidence ──────────────────────────────┐    │
│  │  ●●●●●●●●○○  82%   Good coverage for this range   │    │
│  │  Index spot: complete · Options strikes: 82% of  │    │
│  │  ATM±10 present. Some far strikes thin — we'll   │    │
│  │  snap to the nearest liquid strike. [See map ▸]  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│                                       [ Continue → ]     │
└────────────────────────────────────────────────────────┘
```

**Index cards (radio, single-select).** Big tap targets. Each shows **auto lot size** (NIFTY 75 / BANKNIFTY 35 / SENSEX 20 — sourced from config, displayed read-only) and a coverage hint. SENSEX honestly shows "2022–now" (data starts later) and gets an **amber tint**, not a green tick — honesty from the first screen.

**Interval segmented control.** Default **1m** (richest). Tooltip: "Coarser candles run faster but miss intraday SL/target hits." Selecting a coarser interval is allowed but shows a one-line caveat under it when a per-leg SL is later set.

**Date range.** Default = **last 3 months** ending at the most recent complete trading day (so the first run is fast and well-covered). Native-feeling dual calendar with quick chips. "Max" clamps to the chosen index's true start (NIFTY/BANKNIFTY 2021, SENSEX 2022). Disallowed: end < start (inline); range > index coverage (clamps with a toast "Trimmed to available data").

**Data-confidence panel (the differentiator).** A 10-segment bar + % + plain sentence. Updates live as index/range change (a cheap **pre-aggregated coverage index** queried via duckdb-wasm, not a full scan). `[See map ▸]` opens the strike-coverage heatmap modal (§16.2). This is the screen where we beat all five competitors: none of them tell you coverage _before_ you build.

**Validation / continue.** Always satisfiable (defaults are valid), so Continue is enabled immediately. If coverage < 40%, Continue still works but the button gets a sibling hint: "Low coverage — results may be sparse."

---

## 11. Step 2 — Leg builder (the centrepiece)

This is where we out-design AlgoTest. AlgoTest exposes 5 raw strike fields per leg; we ship **one tabbed strike control + a visual strike ladder**. Begin with a **template gallery** (Sensibull's fastest on-ramp), then per-leg cards.

### 11.1 Template gallery (Step 2 entry, or "Build from scratch")

Shown first when no legs exist. Outlook-grouped (Sensibull pattern). Selecting one pre-fills legs at sensible ATM offsets and jumps to the leg list with a spring-in.

```
┌────────────────────────────────────────────────────────────────┐
│  Start from a template            or  [ + Build from scratch ]   │
│                                                                  │
│  NEUTRAL                                                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ Short        │ │ Short        │ │ Iron Condor  │             │
│  │ Straddle     │ │ Strangle     │ │              │             │
│  │  ╱‾‾╲        │ │ ╱‾‾‾‾╲       │ │ _╱‾‾‾╲_      │             │
│  │ 2 legs · sell│ │ 2 legs · sell│ │ 4 legs       │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
│  BULLISH                          BEARISH                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ Bull Call    │ │ Bull Put     │ │ Bear Call    │  ...        │
│  │ Spread       │ │ Spread       │ │ Spread       │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
│  VOLATILE                                                        │
│  ┌──────────────┐ ┌──────────────┐                              │
│  │ Long Straddle│ │ Long Strangle│                              │
│  └──────────────┘ └──────────────┘                              │
└────────────────────────────────────────────────────────────────┘
```

Each tile renders a **mini payoff sparkline** (same `buildPayoffCurve`, tiny). Hover/long-press shows "Sells both ATM options; profits if price stays range-bound." Templates map directly to the `StrategyLabel`s the payoff lib already classifies, so the auto-label round-trips correctly.

### 11.2 Leg list + leg card

```
┌──────────────────────────────────────────────────────────────────────┐
│  Legs  (2)                                  Short Straddle      [ + Add leg ] │
│                                                                        │
│  ┌─ Leg 1 ──────────────────────────────────────────────── [⧉] [🗑] ─┐│
│  │  ( BUY  ●SELL )   ( ●CE  PE )    Lots [ – ] 1 [ + ]  = 75 qty       ││
│  │                                                                    ││
│  │  Strike                                                            ││
│  │  ┌ ATM ±offset │ Premium ₹ │ Delta │ Exact ┐  ← mode tabs          ││
│  │  │  ATM±offset (selected)                   │                       ││
│  │  └──────────────────────────────────────────┘                       ││
│  │     [ −2 ] [ −1 ] [ ATM ] [ +1 ] [ +2 ]    → 22,500 CE             ││
│  │              ▲ selected                                            ││
│  │     Served: 22,500 CE  ●live  · LTP est ₹142  · cov 96%            ││
│  └────────────────────────────────────────────────────────────────────┘│
│                                                                        │
│  ┌─ Leg 2 ──────────────────────────────────────────────── [⧉] [🗑] ─┐│
│  │  ( BUY  ●SELL )   ( CE  ●PE )    Lots [ – ] 1 [ + ]  = 75 qty       ││
│  │  Strike  [ ATM±offset ▸ ATM ]   → 22,500 PE  · cov 94%             ││
│  └────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

**Leg card controls (left→right, the natural reading/build order):**

1. **Buy/Sell** segmented toggle. Sell = `loss`-token tinted border on the card edge (sells carry assignment/unlimited-risk semantics), Buy = `profit`-token tint. Subtle, not alarming.
2. **CE/PE** segmented toggle.
3. **Lots stepper** with auto **qty** readout (`lots × lotSize`). Stored lot-scaled to match `PayoffLeg.qty` convention exactly (one NIFTY lot → qty 75). Long-press −/+ to accelerate. Max 50 lots (soft cap, warns on margin).
4. **Strike selector** — the hero control (§11.3).
5. **Duplicate (⧉)** and **Delete (🗑)**. Duplicate is the fast path to spreads (clone, flip Buy/Sell, bump offset).

Adding a leg springs a new card in (`stiffness:235, damping:10`). Max 6 legs (covers every catalogued structure incl. iron condor + ratio).

### 11.3 Strike selector — single tabbed control + visual strike ladder

The breadth of AlgoTest (points / % / premium / delta / exact) compressed into **one tabbed control** with **progressive disclosure**: ATM±offset is the only mode visible by default; Premium / Delta / Exact sit behind the tab row (advanced). Every mode resolves to a concrete _served_ strike with a coverage chip.

**Mode A — ATM ± offset (default).** A horizontal **strike ladder** — the delightful, tactile core. Each rung is a real available strike; ATM is centred and emphasised; rungs you can't trade (missing/illiquid) are dimmed with a dashed border.

```
   ITM ←                  ATM                  → OTM
  ┌────┬────┬────┬═════╗┌════┬════┬┄┄┄┄┬════┐
  │22300│22400│22450│22500║│22550│22600│22650│22700│
  │ CE  │ CE  │ CE  ║ ATM ║│ CE  │ CE  │(thin)│ CE  │
  │ ₹312│ ₹241│ ₹190║₹142 ║│ ₹104│ ₹74 │ ₹51 │ ₹34 │
  │cov98│cov97│cov96║cov96 ║│cov95│cov91│cov58│cov88│
  └────┴────┴────┴═════╝└════┴════┴┄┄┄┄┴════┘
                  ▲ selected (ATM)        ▲ 22650 dimmed: 58% coverage
   offset:  −2   −1   ATM   +1   +2   +3   +4   +5
```

- Drag/tap a rung to select; arrow keys step; ATM key recentres. The selected rung lifts (`y:-2`, spring) and shows a connecting line down to the payoff kink in the right rail (delight: you _see_ which strike you're moving).
- Each rung shows **est. premium** and **coverage %** for the chosen date range, computed live. This makes the patchy-data reality legible _at the moment of choosing_, which none of the five competitors do.
- Offset is the **stored value** (ATM±n strikes), resolved to an absolute strike per-day at run time — so the strategy is date-range-portable.

**Mode B — Premium ₹ (advanced tab).** "Pick the strike whose premium is closest to ₹**\_". Number input + a live readout: "Closest available: 22,600 CE @ ~₹74 (you asked ₹70)". Optional range (₹**–₹\_\_). Mirrors AlgoTest's Closest-Premium / Premium-Range.

```
┌ ATM±offset │ ●Premium ₹ │ Delta │ Exact ┐
│  Target premium  [ ₹ 70 ]   ( ± ₹10 )    │
│  → Served: 22,600 CE  est ₹74  · cov 91% │
│  ⓘ Resolved per day from 1m close nearest entry time │
└──────────────────────────────────────────┘
```

**Mode C — Delta (advanced tab).** "Closest to Δ \_\_\_" (enter 30 → 0.30). Slider 5–95 + numeric. Readout: "≈ 22,650 CE, Δ 0.31". Carries a **low-confidence chip** because delta requires an IV estimate over patchy data — honesty again. Tooltip explains we estimate Δ from a fitted IV; "use ATM±offset or Premium for the most reliable selection."

**Mode D — Exact.** Direct strike entry with autocomplete from the available-strike list; typing a missing strike shows the **served-vs-requested** banner inline (§16.1).

**Served-strike honesty banner (any mode, when requested ≠ served):**

```
  ⚠ Requested 22,650 — only 58% coverage in this range.
    Using 22,700 (88% coverage) instead.   [ Use 22,650 anyway ] [ Keep 22,700 ]
```

This is the defining empty/degraded state and it appears **inline at the leg**, not as a post-run surprise.

### 11.4 Live preview reaction

As legs change, the right rail's payoff morphs, `Max P / Max L / POP / breakevens / margin / Greeks` recompute, and the strategy auto-label updates. Net credit/debit shows as a pill: `Net credit ₹284 (₹21,300)`. Unbounded tails render as `Max loss: Unlimited` (from the payoff lib's `lossUnbounded`) in `loss` color with a small "▲ uncapped" badge — directly honest about short-call risk.

**Validation to continue:** ≥1 leg; every leg has a served strike; warn (don't block) if all legs are the same side+type (degenerate). Soft nudge if the net position is unhedged-short ("This has unlimited risk — consider a hedge leg or set an Overall MTM stop in the next step").

---

## 12. Step 3 — Timing (entry / exit; fixed-time first, indicator-ready)

Fixed-time entry/exit is the default and the only fully-built path at launch; indicator-based entries are visibly "Coming soon" but architected-for (so the spec doesn't need rework).

```
┌──────────────────────────────────────────────────────────────────┐
│  When do you enter and exit?                                       │
│                                                                    │
│  ENTRY                                                             │
│  ( ●Fixed time )  [ Indicator  · soon ]                            │
│  ┌──────────────────────────────────────────────────────────┐     │
│  │  Enter at   [ 09:20 ]   IST   ⓘ first candle after open    │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                    │
│  EXIT                                                              │
│  Square off at  [ 15:15 ]   IST                                    │
│  ☑ Also exit on expiry-day at  [ 15:20 ]                            │
│                                                                    │
│  ┌─ Advanced  (when does this strategy run?) ────────  [ ▾ ] ─┐    │
│  │  Days of week    [✓Mon][✓Tue][✓Wed][✓Thu][✓Fri]            │    │
│  │  Days from expiry  ( All )  ▸  only [ 0 ] to [ 4 ] DTE      │    │
│  │  Entry on first trading day only  [ off ]                  │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                          [Continue→]│
└──────────────────────────────────────────────────────────────────┘
```

- **Entry/Exit times:** time pickers defaulting **09:20 / 15:15** (IST, the common intraday window). Validation: entry < exit, both within 09:15–15:30, snapped to the chosen candle interval (with a toast if snapped).
- **Days-of-week** and **Days-from-expiry (DTE filter)** live behind an "Advanced" disclosure (the calm default is "every weekday, every day to expiry"). DTE reuses the existing `dteBucketKey` / `daysToExpiry` vocabulary. This matches AlgoTest's "Specific Days" + "Days from Expiry" without the clutter.
- **Indicator tab** is rendered but disabled with a `soon` chip and a one-line teaser ("RSI/EMA/VWAP entry rules — on the roadmap"), so users see the ambition and we reserve the layout.
- The right-rail preview gains a small **"entry/exit window"** annotation, but the payoff (expiry math) is unchanged by timing — add a one-liner: "Timing affects realized P&L in results, not this expiry diagram."

---

## 13. Step 4 — Risk (per-leg + overall MTM + re-entry)

AlgoTest's risk engine is best-in-class but jargon-heavy ("RE ASAP ↩", "Trail X/Trail Y"). We keep the power, replace jargon with **plain-language presets + tooltips**, and split into two calm groups with progressive disclosure. Default = **simple overall MTM**, per-leg risk disclosed on demand.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Manage risk                                                           │
│                                                                        │
│  OVERALL (whole-strategy MTM)                          [ simple ●●○ ]  │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │  Stop loss    [ ₹ 10,000 ]  ( ₹ | % of margin )                │     │
│  │  Target       [ ₹ 15,000 ]                                     │     │
│  │  ┌ Advanced ▾ ──────────────────────────────────────────┐     │     │
│  │  │ Trailing  ☑  Lock ₹[5,000] profit, then trail by ₹[2,000]│   │     │
│  │  │ Max loss (hard)  [ ₹ 20,000 ]                          │     │     │
│  │  └────────────────────────────────────────────────────────┘     │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                                                        │
│  PER-LEG  (optional)                                   [ + Add rules ] │
│  ┌─ Leg 1 · 22,500 CE Sell ───────────────────────────  [ ▾ ] ──┐     │
│  │  Stop loss   [ 35 ] ( ●% │ Pts )   on ( ●Premium │ Underlying ) │   │
│  │  Target      [ 70 ] ( ●% │ Pts )                               │     │
│  │  ┌ Advanced ▾ ────────────────────────────────────────────┐   │     │
│  │  │ Trailing:  when price moves [20]% in favour, tighten     │   │     │
│  │  │            SL by [10]%        ⓘ "Trail 20→10"            │   │     │
│  │  │ On SL hit:  ( ●Square off this leg │ Square off all )    │   │     │
│  │  │ Re-entry:   [ None ▾ ]   ⓘ                               │   │     │
│  │  │   • None                                                 │   │     │
│  │  │   • Re-enter at new ATM        (RE ASAP)                 │   │     │
│  │  │   • Re-enter at the same price (RE Cost)                 │   │     │
│  │  │   • Re-enter on momentum       (RE Momentum)             │   │     │
│  │  │   Max re-entries [ 2 ]   Stop re-entry after [ 14:30 ]   │   │     │
│  │  └──────────────────────────────────────────────────────────┘   │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                       [ Review & run → ]│
└──────────────────────────────────────────────────────────────────────┘
```

**Overall MTM (always visible, simple by default):** SL + Target in **₹ or % of margin**. Behind "Advanced": **Trailing / Lock-&-Trail** ("Lock ₹X profit, then trail by ₹Y" — AlgoTest's Lock-Min-Profit / Trail-Min-Profit in English) and a hard **Max loss**. Smart-default seeds (strategy SL ≈ 1.5–2× premium collected) shown as ghosted placeholders, not forced values.

**Per-leg (opt-in, collapsed):** Each leg gets a row only when the user clicks "Add rules". Inside:

- **SL / Target**, each in **% or Pts**, against **Premium or Underlying** (AlgoTest's two-axis control, but as two clean segmented toggles, not four raw fields). Smart defaults: SL 35%, Target 70% as placeholders.
- **Trailing** as plain language: "when price moves X% in favour, tighten SL by Y%", with the AlgoTest term ("Trail 20→10") shown small as a learnability bridge.
- **On SL hit: Square off this leg / Square off all** — AlgoTest's Partial-vs-Complete, named plainly.
- **Re-entry** as a dropdown of **plain-language presets** (never raw "RE ASAP ↩"): None / Re-enter at new ATM / Re-enter at same price / Re-enter on momentum, each with a tooltip and the AlgoTest term in parentheses for power-user recognition. Max re-entries (≤5) + stop-time.

**Validation:** target > 0, SL > 0; warn if a leg SL on a _short_ leg is unset and there's no overall stop ("Naked short with no stop — add one?"); warn if target < SL on the same reference. **None block** — the user can always run; we just nudge.

**Right rail in Step 4:** payoff unchanged, but overlay the **Overall SL/Target as horizontal P&L guide-lines** on the payoff's y-axis (`+₹15,000 target` green dashed, `−₹10,000 SL` red dashed) so the risk numbers are visually anchored to the same chart — a small touch none of the competitors do.

---

## 14. Step 5 — Review & run

A dedicated final summary (wizard best practice: always a Review step). Read-only recap with **inline edit jumps**, a final coverage verdict, and the big Run button. Run is **anonymous-allowed**; login nudges only after results render.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Review your backtest                                                  │
│                                                                        │
│  ┌──────────────────────────┬───────────────────────────────────────┐ │
│  │  Short Straddle · NIFTY   │   (live payoff, large)                 │ │
│  │  17 Apr – 13 Jun 2026     │        ╱‾‾‾‾‾‾‾╲                        │ │
│  │  1m candles               │   ────●─────────●────                  │ │
│  │                  [edit ✎] │                                        │ │
│  ├──────────────────────────┤   Max P +₹18,750  Max L −₹41,250        │ │
│  │  LEGS                     │   POP 64%  BE 22,310/22,690            │ │
│  │  • Sell 1× 22,500 CE      │   Margin ≈ ₹1.34L                       │ │
│  │  • Sell 1× 22,500 PE [✎]  │                                        │ │
│  ├──────────────────────────┴───────────────────────────────────────┤ │
│  │  TIMING  09:20 → 15:15 IST · Mon–Fri · all DTE              [✎]    │ │
│  │  RISK    Overall SL ₹10k / Tgt ₹15k · per-leg SL 35%        [✎]    │ │
│  │  CHARGES Zerodha profile · brokerage+STT+GST modelled       [▾]    │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │  ┌ Data confidence ─────────────────────────────────────────────┐  │ │
│  │  │ ●●●●●●●●○○ 82% · ~42 trading days · 2 strikes snapped         │  │ │
│  │  │ ⓘ Far-OTM days will use nearest liquid strike. [details ▸]    │  │ │
│  │  └──────────────────────────────────────────────────────────────┘  │ │
│  │                                                                    │ │
│  │  ⚠ Backtests can overfit. Past results ≠ future returns.           │ │
│  │                                          [ ◀ Back ]  [ ▶ Run backtest ] │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

- **Charges** default to a sensible broker profile (Zerodha) using the existing `computeCharges(profile, t)` engine; expandable to switch broker/product so results are net-of-cost (a credibility edge over Sensibull/Opstra).
- **Overfitting / past-performance disclaimer** is unmissable here (educational mandate), not buried.
- **Run** → transitions (≤375ms "arrival" feel) to the running state.

### 14.1 Running → results (the run loop)

```
┌──────────────────────────────────────────────┐
│   Running your backtest…                       │
│   ┌────────────────────────────────────────┐  │
│   │ ✓ Loading runtime                       │  │
│   │ ✓ Pulling NIFTY 1m · 17 Apr–13 Jun      │  │
│   │ ◐ Simulating 42 trading days  ▓▓▓▓░░ 71% │  │
│   └────────────────────────────────────────┘  │
│   Runs in your browser — your strategy never   │
│   leaves this device.                          │
│   [ Cancel ]                                   │
└────────────────────────────────────────────────┘
```

Streams the duckdb-wasm / Pyodide cold-start as **intentional progress** (named stages), not a spinner — so the wait reads as work. On completion → results screen renders; **only then** a non-blocking toast nudges login: "Save this backtest · Get notified · Share →" (anonymous-first honored). Long server runs (paid tier) flip to "We'll email you when it's done" + an in-app notification via the existing Resend / `notifications` infra.

---

## 15. Mobile (primary; PWA, ≤640px) — bottom-sheet builder

The right rail can't be persistent on mobile, so the **live payoff becomes a sticky bottom summary bar that expands into a modal bottom sheet**. Each step is a full-height scroll; leg editing and strike selection happen in **modal bottom sheets** (Material spec: scrim `#000` @ 20%, ≤16:9 initial height, drag handle + tap-out + X, swipe-up to full with internal scroll).

```
┌─────────────────────────────┐
│ ◀  Backtest      2/5 · Legs  │ ← top bar
│ ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░       │ ← thin progress
├─────────────────────────────┤
│  Legs (2)     Short Straddle │
│  ┌─ Leg 1 ─────────────────┐ │
│  │ SELL · CE · 1 lot        │ │
│  │ 22,500 CE · cov 96%      │ │
│  │            [ Edit ]  [🗑] │ │
│  └──────────────────────────┘ │
│  ┌─ Leg 2 ─────────────────┐ │
│  │ SELL · PE · 22,500 · 94% │ │
│  └──────────────────────────┘ │
│  [ + Add leg ]               │
│                              │
│ . . . . . . . . . . . . . . .│
├─────────────────────────────┤ ← sticky summary bar (tap → expand)
│ ╱‾‾╲  +₹18.7k / −₹41.2k  POP │ │
│      64%        [ Preview ▴ ]│ │
├─────────────────────────────┤
│ [ ← Back ]      [ Continue → ]│
└─────────────────────────────┘
```

**Leg-edit bottom sheet (tap "Edit"):**

```
            (scrim #000 @20%)
┌─────────────────────────────┐
│            ───               │ ← drag handle
│  Leg 1                    ✕  │
│  ( BUY  ●SELL ) ( ●CE  PE )  │
│  Lots  [ – ] 1 [ + ] = 75    │
│                              │
│  Strike                      │
│  ┌ ATM± │ ₹ │ Δ │ Exact ┐    │
│  ◀ ───●─────────────── ▶     │ ← horizontal swipeable strike ladder
│   22450  [22500] 22550 ...   │
│   ₹190    ₹142   ₹104        │
│   cov97   cov96  cov95       │
│        ▲ ATM (snapped)       │
│  Served 22,500 CE · 96%      │
│                              │
│      [ Done ]                │
└─────────────────────────────┘
```

The strike ladder becomes a **horizontally swipeable carousel** with snap-to-rung; ATM is centred on open. Premium/Delta/Exact are tabs within the sheet (progressive disclosure preserved). "Preview ▴" expands the payoff into its own full-height sheet with the Target-day/Expiry-day toggle and POP/Greeks. Everything dismissible by swipe-down, X, tap-out, or Android back; identical behavior everywhere (consistency rule).

---

## 16. Coverage primitives — the honesty system (our moat)

Coverage is a **first-class, ever-present signal** that no competitor offers. It appears at four escalating levels of granularity, all reading from the same pre-aggregated coverage index queried via duckdb-wasm.

### 16.1 The four touchpoints

```
Level 1  SETUP verdict        Step 1 panel: "●●●●●●●●○○ 82% · good coverage for this range"
Level 2  PER-RUNG %           Strike ladder: each rung shows "cov 96%" / dimmed if < threshold
Level 3  SERVED-vs-REQUESTED  Inline leg banner when requested ≠ served strike (§11.3)
Level 4  RESULTS chips        S6 verdict: "Nearest strike used (24500→24450, 62% coverage)"
```

The top-bar **Coverage chip** (`[Coverage 82% ▾]`) is a live rollup of the _current_ config; clicking it expands a popover summarizing which strikes will snap and links to the `/data` explorer.

### 16.2 Strike-coverage heatmap modal (`[See map ▸]`)

```
┌─ Coverage map · NIFTY · 17 Apr–13 Jun 2026 ──────────────────── ✕ ─┐
│  Strikes (rows) × trading days (cols).  ▓ liquid  ▒ thin  ░ missing  │
│                                                                      │
│  22700 ▓▓▓▓▓▒▒▓▓▓▓▓▓▓▓▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   88%               │
│  22650 ▓▒░░▒▒░░░▒▒░░▒▒░░▒▒▓▓▒░░▒▒░░▒▒░░▒▒░░▒▒░░▒   58%  ← sparse      │
│  22600 ▓▓▓▓▓▓▓▓▓▓▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▓▓▓▓▓▓▓▓▓▓▓▓▓   91%               │
│  22550 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   95%               │
│ [22500]▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   96%  ← ATM         │
│  22450 ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   96%               │
│                                                                      │
│  ⓘ On days a chosen strike is missing, we snap to the nearest        │
│    liquid strike and flag it in the trade log. Index spot is complete.│
│                                            [ Open full /data explorer ▸ ]│
└──────────────────────────────────────────────────────────────────────┘
```

### 16.3 Three states for every data-bound element

Build as reusable primitives, reusing existing `LoadingSkeleton` / `EmptyState` / `ErrorFallback` from `components/shared`:

- **Loading:** skeleton ladder rungs / skeleton payoff (shimmer), **not spinners**.
- **Empty / degraded:** the honest coverage states — "No liquid strike near 22,650 in this range — using 22,700 (88%)." Coverage chips everywhere.
- **Error:** component-level boundary — one bad option slice degrades **one leg card**, never the whole builder, with a "Retry slice" action.

---

## 17. Keyboard & command flow (power-user escape hatch)

The wizard is the default, but repeat backtesters need speed (NN/G: wizards infuriate experts). We provide:

- **Tab order** strictly left→right, top→bottom within a step; `Enter` = Continue when the step is valid; `Shift+Enter` = Back.
- **Strike ladder:** `←/→` step offset, `Home` = deep ITM, `End` = deep OTM, `0`/`a` = ATM, `1`–`9` jump to that OTM offset.
- **Leg list:** `n` = new leg, `d` = duplicate focused leg, `Del` = delete, `b`/`s` toggle Buy/Sell, `c`/`p` toggle CE/PE, `+`/`-` lots.
- **⌘K / Ctrl+K command palette** (grouped buckets: Commands / Navigate / Templates / Recent): "New backtest", "Switch index → BANKNIFTY", "Apply template: Iron Condor", "Jump to Risk", "Run", "Save", "Export CSV". Fuzzy search; ARIA-announces state. Gated commands trigger the nudge.
- **"Edit all" power mode** (link in top bar, `g a`): collapses the wizard into a single dense AlgoTest-style scroll where every field is visible at once — for experts who want it. Same store, so switching modes is lossless. This resolves the novice/expert tension explicitly.

---

## 18. States, motion & tokens (implementation contract)

**Motion** (tokens, ≥80% reuse): default `--ease-standard: cubic-bezier(.4,0,.2,1)`; payoff/panel entrances `--ease-decel: cubic-bezier(0,0,.2,1)` @ 220ms; dismissals `--ease-accel: cubic-bezier(.4,0,1,1)` @ 195ms; leg-card / strike-rung springs `stiffness:235, damping:10, mass:1`. Cap any frequent transition ≤375ms. Honor `prefers-reduced-motion`.

**Semantic tokens** (match existing `globals.css`): surfaces `bg / surface / surface-2 / border`; text `foreground / muted`; brand `accent / accent-fg / accent-solid`; P&L `profit / loss`; coverage/degraded states use `warning`. **No raw hex anywhere.**

**Reuse map:**

| Need                                | Existing module                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Payoff math + auto-label            | `src/lib/options/payoff.ts` — `buildPayoffCurve`, `classifyStrategy`, `legPayoffAt`; `PayoffLeg.qty` is lot-scaled |
| Net-of-cost results                 | `src/lib/charges/charges.ts` — `computeCharges(profile, t)`                                                        |
| Monte-Carlo drawdown cone (results) | `src/lib/montecarlo/*` (already runs in a Web Worker)                                                              |
| Lot sizes                           | config — NIFTY 75 / BANKNIFTY 35 / SENSEX 20                                                                       |
| Public shell + header               | `src/components/shared/site-header.tsx` + `nav-links.tsx` (add the `Backtesting` NAV entry)                        |
| Public-universe layout              | clone `src/app/community/layout.tsx`                                                                               |
| DTE filter vocabulary               | `dteBucketKey` / `daysToExpiry`                                                                                    |
| Rate limiting (server runs)         | `src/server/rate-limit.ts`                                                                                         |
| Notify / email                      | `notifications` table + Resend infra                                                                               |
| Loading / empty / error UI          | `LoadingSkeleton` / `EmptyState` / `ErrorFallback` in `components/shared`                                          |

---

## 19. Opinionated calls (so the team isn't left choosing)

1. **One engine, public.** Remove `src/app/app/backtesting/page.tsx`; 308-redirect both `/app/backtesting` and `/app/app/backtesting` → `/backtesting`. The journal _links into_ the public builder; it does not host a second engine.
2. **No upfront login, ever.** The nudge fires only on save/share/schedule/notify, with the result visible behind the modal. This is the single most important UX rule and the brief mandates it.
3. **Ephemeral runIds from second zero**, persisted to `localStorage`, swapped to server ids on auth — so "Back," "Recent runs," and in-session sharing all work without a server and nothing is ever re-run after login.
4. **Default the first build to a well-covered range** (NIFTY, last 3 months) so the very first run _never_ hits an empty state — coverage honesty is for the edges, not the first impression.
5. **Coverage is a first-class citizen everywhere** — landing sample, Setup verdict, per-rung %, served-vs-requested banner, results chips, and a dedicated `/data` explorer. This is the differentiator none of AlgoTest/Sensibull/Opstra/Tradetron/Streak offer.
6. **Backtesting is a peer universe, not a journal feature.** It sits in the public header beside Community, shares the chrome, and cross-links both ways — but is reachable and fully usable by people who never open the journal.
7. **Mobile-first PWA throughout** — AlgoTest has no app; the whole thing is a polished mobile PWA, so every wireframe above ships its mobile layout as a peer, not an afterthought.

---

## 20. Why this beats AlgoTest (the opinionated summary)

1. **One tabbed strike control + a tactile strike ladder** vs AlgoTest's five raw fields — same power, a fraction of the cognitive load, and you _see_ premiums/coverage as you choose.
2. **Coverage is a first-class, ever-present signal** (Setup verdict → per-rung % → served-vs-requested banner → results chips). No competitor handles patchy data honestly; this is our moat.
3. **Plain-language risk presets** ("Re-enter at new ATM", "Lock ₹5k then trail ₹2k", "Trail 20→10") replace AlgoTest's "RE ASAP ↩" jargon — power preserved, learnability won.
4. **Persistent live payoff joy** (Sensibull) fused with a **progressive-disclosure wizard** (calm by default) and a **power "Edit all" mode + ⌘K** (experts not punished).
5. **Mobile-first bottom-sheet builder** — AlgoTest has no app at all.
6. **Anonymous run, $0 client-side, login nudged only at results** — effortless on-ramp, honest about overfitting at the finish.

---

## 21. Build checklist (routes/files to create)

```
src/app/backtesting/layout.tsx                 (clone community layout; bt-specific cta)
src/app/backtesting/page.tsx                   S1 landing (ISR, JSON-LD, state-aware hero)
src/app/backtesting/_components/               hero, mode-cards, sample-result, trust-row,
                                               returning-banner, recent-runs-rail
src/app/backtesting/build/page.tsx             S3 wizard (this doc owns internals)
src/app/backtesting/code/page.tsx              S4 BYOC editor (sibling doc owns internals)
src/app/backtesting/run/[id]/page.tsx          S6 results (public-readable)
src/app/backtesting/run/compare/page.tsx       S8
src/app/backtesting/explore/page.tsx           S9 (ISR gallery)
src/app/backtesting/templates/(page+[id])      S10
src/app/backtesting/data/page.tsx              S11 coverage explorer
src/app/backtesting/docs/**                    S12
src/app/backtesting/saved/page.tsx             S13 (🔒)
src/app/backtesting/og/[runId]/route.tsx       dynamic OG
src/components/shared/nav-links.tsx            EDIT: add {href:"/backtesting",label:"Backtesting"} at idx 2
src/app/(marketing)/layout.tsx                 EDIT: add "Backtesting" footer group
src/app/app/backtesting/page.tsx               DELETE
next.config / middleware                       308 redirects for legacy /app[/app]/backtesting
src/lib/backtesting/run-store.ts               localStorage ephemeral-run cache + recentRuns
src/components/backtesting/builder/            shell, stepper, live-rail, leg-card,
                                               strike-ladder, coverage-chip, served-banner
src/components/backtesting/login-nudge.tsx     S7 modal (save/share/schedule/notify variants)
api: /api/backtest/runs[/id], /server-run, /notify
reuse: src/lib/montecarlo/*, src/lib/options/payoff.ts, src/lib/charges/charges.ts,
       notifications table, src/server/rate-limit.ts
```

**Build order for the team:** (1) global shell + stepper + live-rail wired to `buildPayoffCurve`; (2) Step 2 leg card + strike ladder (highest-risk, highest-delight — prototype first); (3) Steps 1/3/4 forms with smart defaults; (4) coverage primitives + served-strike banner; (5) Review/Run + progress streaming; (6) mobile bottom sheets; (7) ⌘K + Edit-all power mode.

---

_This is the complete UX spec: sitemap with public/gated annotations (§1), site-level relationship to journal/community (§2), screen inventory (§3), first-run/returning/signed-in state model (§4), the new + returning + nudge journey maps (§5), full ASCII wireframes for landing + mode choice (§6), nav/SEO decisions (§7–8), then the exhaustive No-Code Builder spec — global shell (§9), every step S1–Review with wireframes (§10–14), the mobile bottom-sheet builder (§15), coverage primitives (§16), keyboard/power-user flow (§17), motion/token/reuse contract (§18), opinionated calls (§19), the competitive summary (§20), and the build checklist mapped to verified files (§21). Educational tool only — backtests can over-fit; past performance ≠ future results._
