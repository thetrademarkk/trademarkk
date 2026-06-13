# System Architecture & Implementation Map

This is an **implementation-ready architecture** for a new, standalone, public **`/backtest` universe** for TradeMarkk — a no-code options strategy builder plus a bring-your-own-code (BYOC) lane, both running **client-side by default** (Web Worker + duckdb-wasm + Pyodide pulling 1-minute parquet from HuggingFace), with an opt-in server tier for heavy runs.

It is grounded in the **actual codebase** (Next.js 15 App Router, Drizzle on Turso/libsql, Better Auth, the `/community` public-universe pattern, the Monte-Carlo Web Worker pattern, `notify()`, `rateLimit()`, `computeCharges()`, `buildPayoffCurve()`). Every path below is absolute-from-`src` and every reuse target is a file that exists today.

> **Read order for implementers:** §0 decisions → §1 file tree → §2/§3 data models → §4 persistence → §5 API → §6 jobs/notify → §7 auth/nudge → §8 calendar → §9 reuse map → §10 CSP/bundle → §11 wireframes → §12 build order.

---

## 0. Top-level decisions (opinionated, load-bearing)

1. **Universe location.** New route group `src/app/backtest/**`, **sibling to `src/app/community`**, NOT under `/app`. The existing `src/app/app/backtesting/page.tsx` placeholder is **deleted** and a permanent redirect `/app/backtesting → /backtest` is added in `next.config.ts`.
2. **Default execution is 100% client-side.** Both the no-code builder and BYOC execute in a **Web Worker** in the browser: a pure TS engine for the no-code builder; Pyodide + duckdb-wasm for BYOC. Data is range-read from HuggingFace `hf://`/`resolve/main` parquet via duckdb-wasm. Anonymous, $0, safe. **No server route is required to RUN** a backtest in the default path.
3. **Saved results live in NEW platform-DB tables** (`backtest_strategies`, `backtest_runs`), alongside `community`/`feedback`/`notifications` — **NOT** the per-user journal DB (rationale in §4).
4. **Login is never gated upfront.** Anonymous runs complete; login is nudged **only at save / share / notify** (§7). An anonymous run is held in zustand + IndexedDB and **claimed** (persisted) with one POST after auth.
5. **Server compute is an opt-in escape hatch** (huge ranges, future paid tier): inline ≤ 300s + `after()` + Upstash QStash only when a run could exceed 300s. The no-code builder essentially never needs it; BYOC server-tier might. QStash is gated behind env presence and degrades gracefully to "run client-side" when absent.
6. **The market calendar is a static generated JSON asset** in `public/` (NSE/BSE holidays + expiry rules), consumed by both worker and server. Zero runtime cost.

**Verified facts the spec relies on (absolute paths):**

| Fact                                                                                                 | Source                                                                    |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Public universe = layout wraps children with `<SiteHeader>` + `<QueryProvider>`                      | `src/app/community/layout.tsx`                                            |
| Nav array to extend with `/backtest`                                                                 | `src/components/shared/nav-links.tsx` (`NAV`)                             |
| Worker idiom `new Worker(new URL("@/lib/.../x.worker", import.meta.url), { type: "module" })`        | `src/features/analytics/hooks/use-monte-carlo.ts`                         |
| Central `notifications` table, written via `notify()`                                                | `src/server/db/platform-schema.ts`, `src/server/community.ts`             |
| Platform migration = idempotent `CREATE TABLE IF NOT EXISTS` list (no drizzle-kit push)              | `scripts/migrate-platform.ts`                                             |
| `getSession()` = `auth.api.getSession({ headers })`                                                  | `src/server/community.ts`                                                 |
| `rateLimit(key, limit, windowSec)`; origin guard `isAllowedOrigin`; IDs via `newId()` (ULID)         | `src/server/rate-limit.ts`, `src/server/origin-check.ts`, `src/lib/id.ts` |
| CSP already allows `'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self' https: wss:` | `next.config.ts`                                                          |
| `after()` / QStash not yet used anywhere                                                             | (introduced here)                                                         |

---

## 1. File tree — the complete map

```
src/
├── app/
│   ├── backtest/                                  # ── NEW PUBLIC UNIVERSE (sibling of community/) ──
│   │   ├── layout.tsx                             # SiteHeader + QueryProvider; footer w/ disclaimer
│   │   ├── page.tsx                               # Landing (server): hero + template gallery + recent runs
│   │   ├── backtest-home.tsx                      # ("use client") landing client shell (mirrors community-home.tsx)
│   │   ├── build/
│   │   │   └── page.tsx                           # No-code builder (wizard + persistent live preview). Anonymous OK.
│   │   ├── code/
│   │   │   └── page.tsx                           # BYOC: Monaco editor + data catalog + run console. Anonymous OK.
│   │   ├── r/
│   │   │   └── [id]/
│   │   │       ├── page.tsx                       # Saved/shared result permalink (server component; OG metadata)
│   │   │       └── result-view.tsx               # ("use client") results dashboard reading the saved snapshot
│   │   ├── strategies/
│   │   │   └── page.tsx                           # "My strategies & runs" (auth-gated list; signed-in only)
│   │   └── _components/                           # landing-only marketing bits
│   │       ├── template-gallery.tsx
│   │       └── coverage-hero.tsx
│   │
│   └── api/
│       └── backtest/                              # ── API ROUTES ──
│           ├── strategies/
│           │   ├── route.ts                       # GET list / POST create+upsert a saved strategy
│           │   └── [id]/route.ts                  # GET one / PATCH / DELETE
│           ├── runs/
│           │   ├── route.ts                       # POST persist a CLIENT-computed run (the "claim/save" path)
│           │   └── [id]/
│           │       ├── route.ts                   # GET a saved run (owner or shared) / DELETE
│           │       ├── share/route.ts             # POST toggle public share → returns /backtest/r/[id]
│           │       └── status/route.ts            # GET poll status for SERVER-executed runs
│           ├── server-run/route.ts                # POST start a SERVER run (opt-in): inline ≤300s + after()/QStash
│           ├── jobs/callback/route.ts             # POST QStash webhook → finalize a long server run + notify
│           └── coverage/route.ts                  # GET cached strike-coverage manifest (edge-cached)
│
├── components/
│   └── shared/
│       └── nav-links.tsx                          # EDIT: add { href: "/backtest", label: "Backtest" } to NAV
│
├── features/
│   └── backtest/                                  # ── ALL FEATURE UI + CLIENT LOGIC ──
│       ├── index.ts                               # barrel: public exports for the route files
│       │
│       ├── builder/                               # NO-CODE WIZARD (primary surface)
│       │   ├── strategy-builder.tsx               # ("use client") wizard shell: stepper + router + live preview rail
│       │   ├── builder-store.ts                   # zustand store for in-progress StrategyDef (autosaved → localStorage)
│       │   ├── steps/
│       │   │   ├── step-market.tsx                # index + interval + date range + coverage badge
│       │   │   ├── step-legs.tsx                  # leg cards; tabbed strike selector (ATM±/%/Premium/Delta/Exact)
│       │   │   ├── step-timing.tsx                # entry/exit time, days-of-week, days-from-expiry
│       │   │   ├── step-risk.tsx                  # per-leg SL/TGT/trail + overall MTM + re-entry presets
│       │   │   └── step-review.tsx                # summary + "Run backtest" CTA
│       │   ├── leg-card.tsx                       # single leg row; uses StrikeSelector
│       │   ├── strike-selector.tsx                # tabbed one-control strike picker (AlgoTest breadth, one widget)
│       │   ├── coverage-badge.tsx                 # coverage/confidence chip (served-vs-requested strike, %)
│       │   ├── live-preview.tsx                   # right rail: payoff graph + target-day/expiry table + PoP + Greeks
│       │   └── templates.ts                       # outlook-grouped starter StrategyDefs (Bull/Bear/Neutral/Volatile)
│       │
│       ├── code/                                  # BRING-YOUR-OWN-CODE
│       │   ├── code-workbench.tsx                 # ("use client") Monaco + data catalog rail + run console
│       │   ├── monaco-loader.tsx                  # lazy dynamic import of @monaco-editor/react (not in builder bundle)
│       │   ├── data-catalog.tsx                   # right-rail catalog: 3 indices, expiries, coverage heatmap, snippet
│       │   ├── api-stub.ts                         # curated TS/py type-stub string for the ~6 data API fns (intellisense)
│       │   ├── starter-strategies.ts              # 3–5 runnable Python templates wired to well-covered expiries
│       │   └── error-translator.ts                # maps Pyodide tracebacks → plain-English ErrorCard payloads
│       │
│       ├── results/                               # SHARED RESULTS DASHBOARD (verdict→evidence→drill-down)
│       │   ├── results-dashboard.tsx              # tier-1 verdict + tabbed tier-2/3; reads a RunResult
│       │   ├── verdict-strip.tsx                  # 6 headline stats + quality/coverage chips
│       │   ├── equity-drawdown-chart.tsx          # equity + underwater on SHARED time axis (recharts)
│       │   ├── monthly-heatmap.tsx                # monthly returns heatmap
│       │   ├── distribution-chart.tsx             # per-trade return histogram
│       │   ├── montecarlo-cone.tsx                # reuses src/lib/montecarlo via useMonteCarlo()
│       │   ├── india-breakdowns.tsx               # day-of-week / time-of-day / expiry-vs-non-expiry heatmaps
│       │   ├── trade-blotter.tsx                  # virtualized trades table (@tanstack/react-virtual + react-table)
│       │   ├── per-leg-breakdown.tsx              # multi-leg realized P&L + payoff (reuses lib/options/payoff)
│       │   └── mae-mfe-scatter.tsx                # power-user MAE/MFE scatter
│       │
│       ├── run/                                   # RUN ORCHESTRATION (client)
│       │   ├── use-backtest-run.ts                # the hook builder & code call: run()→status→RunResult
│       │   ├── run-progress.tsx                   # "loading runtime… pulling NIFTY 26-Jun slice…" progress UI
│       │   ├── save-share-bar.tsx                 # appears when results ready; triggers login-nudge if anonymous
│       │   └── login-nudge.tsx                    # "save/share/notify needs an account" → /app/onboarding
│       │
│       ├── server-run/                            # SERVER-TIER UI (opt-in)
│       │   ├── server-run-banner.tsx              # "This run is large — run on our servers & we'll email you" opt-in
│       │   └── use-server-run.ts                  # POST /server-run, poll /runs/[id]/status, render on done
│       │
│       └── shared/
│           ├── instruments.ts                     # NIFTY/BANKNIFTY/SENSEX: lot size, strike step, tick, expiry rule
│           ├── strategy-def.ts                    # StrategyDef zod schema + TS types (strategy JSON data model)
│           ├── run-result.ts                      # RunResult zod schema + TS types (saved-results snapshot model)
│           ├── format.ts                          # ₹/INR + % formatters (thin wrappers; reuse lib/utils)
│           └── disclaimers.tsx                    # past-performance / overfitting disclaimer block (reused everywhere)
│
├── lib/
│   └── backtest/                                  # ── PURE ENGINE + DATA (no React, unit-tested in isolation) ──
│       ├── engine/
│       │   ├── simulate.ts                         # PURE no-code engine: StrategyDef + candles → RunResult. The core.
│       │   ├── simulate.test.ts
│       │   ├── strike-selection.ts                 # ATM±/% /premium/delta/exact → resolved strike (+ nearest-available)
│       │   ├── strike-selection.test.ts
│       │   ├── risk.ts                             # per-leg SL/TGT/trail + overall MTM + re-entry state machine
│       │   ├── risk.test.ts
│       │   ├── metrics.ts                          # equity, drawdown, win%, expectancy, Return/MaxDD, Sharpe, streaks
│       │   ├── metrics.test.ts
│       │   └── fills.ts                            # entry/exit fill model (slippage hook) → integrates lib/charges
│       ├── data/
│       │   ├── schema.ts                           # Sym, Interval, IndexBar, OptionBar, StrikeResolution, CoverageReport
│       │   ├── urls.ts                             # HF path builders (hf:// server, resolve/main browser) + DATASET_VERSION
│       │   ├── sql.ts                              # parameterized SQL templates (index, leg, chain, atm, coverage, gaps)
│       │   ├── duck-browser.ts                     # getDuck(), query→Arrow helpers, lazy init
│       │   ├── duck-server.ts                      # server-only httpfs/hf:// client (manifest job + paid tier)
│       │   ├── client.ts                           # OptionsDataClient: the 6-fn API (browser)
│       │   ├── resolve.ts                          # resolveStrike, atm/snapToStrike, liquidity floors, STRIKE_STEP/LOT
│       │   ├── coverage.ts                         # manifest fetch/derive, confidence score, gap detection + fill policy
│       │   ├── coverage.test.ts
│       │   └── cache/
│       │       ├── opfs.ts                         # OPFS arrow-blob store + LRU evictor + 250MB budget
│       │       └── idb.ts                          # IndexedDB fallback (mirrors local.ts pattern)
│       ├── calendar/
│       │   ├── market-calendar.ts                  # trading days, expiry resolution, days-from-expiry (reads the JSON)
│       │   ├── market-calendar.test.ts
│       │   └── expiry-rules.ts                     # weekly/monthly expiry rules per index (incl. NSE 2024+ changes)
│       └── pyodide/
│           ├── pyodide-host.ts                     # Pyodide bootstrap + duckdb bridge + injected data API impl
│           └── runtime-api.py                      # Python module: load_index/load_option/resolve_strike/atm_strike/...
│
├── workers/                                       # ── WEB WORKERS (own chunks) ──
│   ├── backtest.worker.ts                          # runs lib/backtest/engine/simulate off-thread (no-code path)
│   └── pyodide.worker.ts                            # hosts Pyodide + duckdb-wasm; runs user Python (BYOC path)
│
└── server/
    ├── db/
    │   └── platform-schema.ts                      # EDIT: append backtestStrategies, backtestRuns tables (§4)
    ├── backtest.ts                                 # NEW: saveRun, getRun, shareRun, assertOwnerOrShared
    └── backtest-jobs.ts                            # NEW: server-tier job lifecycle (start/finalize/fail/notify)

public/
└── backtest/
    └── calendar/
        └── nse-bse-calendar.json                   # generated: holidays + expiry anchors, 2021–2027
    # (duckdb-wasm + pyodide assets are served from CDN/jsDelivr by default; see §10)

scripts/
├── migrate-platform.ts                             # EDIT: append CREATE TABLE IF NOT EXISTS for the 2 backtest tables
└── gen-market-calendar.mjs                          # NEW: generates public/backtest/calendar/nse-bse-calendar.json

docs/
└── backtesting/
    └── 08-architecture.md                          # THIS FILE
```

---

## 2. Strategy JSON data model — `src/features/backtest/shared/strategy-def.ts`

The single source of truth for a no-code strategy. Zod-validated (mirrors the `z.object` convention from `src/app/api/feedback/route.ts`). **Versioned** so saved strategies survive schema evolution.

```ts
// All money in rupees (numbers). Times are IST "HH:mm". Dates "YYYY-MM-DD".
export const STRATEGY_DEF_VERSION = 1;

export type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
export type Interval = "1m" | "3m" | "5m" | "15m"; // resampled from 1m parquet client-side
export type OptionType = "CE" | "PE";
export type Side = "BUY" | "SELL";

// One tabbed strike control → a discriminated union (UI = one widget, model = explicit & exhaustive).
export type StrikeSelector =
  | { mode: "ATM_OFFSET"; steps: number } // +1 = 1 strike OTM, -1 = 1 ITM
  | { mode: "PCT_OFFSET"; pct: number } // +0.5 = 0.5% from ATM
  | { mode: "PREMIUM"; target: number; tolerance?: number } // closest premium ₹
  | { mode: "DELTA"; target: number; tolerance?: number } // ~0.50 etc. (APPROX — surfaced honestly)
  | { mode: "EXACT"; strike: number };

export interface LegDef {
  id: string;
  optionType: OptionType;
  side: Side;
  lots: number; // lot size derived from index (instruments.ts)
  strike: StrikeSelector;
  expiryRule: "WEEKLY" | "NEXT_WEEKLY" | "MONTHLY"; // resolved per trade-day via calendar
  // per-leg risk (all optional; progressive disclosure)
  slPct?: number;
  slPts?: number;
  slUlPct?: number;
  slUlPts?: number;
  tgtPct?: number;
  tgtPts?: number;
  tgtUlPct?: number;
  tgtUlPts?: number;
  trail?: { x: number; y: number; unit: "PCT" | "PTS" }; // AlgoTest Trail X/Y, plain-language in UI
  reentry?: { kind: "ASAP" | "COST" | "MOMENTUM"; max: number; stopTime?: string };
  squareOff: "PARTIAL" | "COMPLETE"; // does this leg's SL exit only itself or the whole strategy
}

export interface StrategyDef {
  version: number; // STRATEGY_DEF_VERSION
  name: string;
  index: IndexSymbol;
  interval: Interval;
  range: { start: string; end: string }; // YYYY-MM-DD
  entryTime: string; // "09:25"
  exitTime: string; // "15:15"
  daysOfWeek?: number[]; // 1..5 (Mon..Fri); omit = all
  daysFromExpiry?: number[]; // e.g. [0,1] = expiry & day-before only
  legs: LegDef[];
  overall?: {
    // strategy-level MTM risk
    slRs?: number;
    tgtRs?: number; // absolute ₹ MTM SL / target
    trailingRs?: { lockMin: number; trailBy: number }; // Lock & Trail
    maxLossRs?: number;
  };
  // execution realism (defaults seeded; reuses lib/charges)
  charges?: { broker: string }; // ChargeProfile key
  slippage?: { pts: number };
}
```

**Zod schema** (parsed at every API boundary and on localStorage rehydrate):

```ts
import { z } from "zod";

const strikeSelector = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("ATM_OFFSET"), steps: z.number().int().min(-20).max(20) }),
  z.object({ mode: z.literal("PCT_OFFSET"), pct: z.number().min(-25).max(25) }),
  z.object({
    mode: z.literal("PREMIUM"),
    target: z.number().positive(),
    tolerance: z.number().positive().optional(),
  }),
  z.object({
    mode: z.literal("DELTA"),
    target: z.number().min(0).max(1),
    tolerance: z.number().positive().optional(),
  }),
  z.object({ mode: z.literal("EXACT"), strike: z.number().int().positive() }),
]);

export const legDefSchema = z.object({
  id: z.string(),
  optionType: z.enum(["CE", "PE"]),
  side: z.enum(["BUY", "SELL"]),
  lots: z.number().int().min(1).max(100),
  strike: strikeSelector,
  expiryRule: z.enum(["WEEKLY", "NEXT_WEEKLY", "MONTHLY"]),
  slPct: z.number().optional(),
  slPts: z.number().optional(),
  slUlPct: z.number().optional(),
  slUlPts: z.number().optional(),
  tgtPct: z.number().optional(),
  tgtPts: z.number().optional(),
  tgtUlPct: z.number().optional(),
  tgtUlPts: z.number().optional(),
  trail: z.object({ x: z.number(), y: z.number(), unit: z.enum(["PCT", "PTS"]) }).optional(),
  reentry: z
    .object({
      kind: z.enum(["ASAP", "COST", "MOMENTUM"]),
      max: z.number().int().min(0).max(10),
      stopTime: z.string().optional(),
    })
    .optional(),
  squareOff: z.enum(["PARTIAL", "COMPLETE"]),
});

export const strategyDefSchema = z.object({
  version: z.literal(STRATEGY_DEF_VERSION),
  name: z.string().min(1).max(120),
  index: z.enum(["NIFTY", "BANKNIFTY", "SENSEX"]),
  interval: z.enum(["1m", "3m", "5m", "15m"]),
  range: z.object({ start: z.string(), end: z.string() }),
  entryTime: z.string().regex(/^\d{2}:\d{2}$/),
  exitTime: z.string().regex(/^\d{2}:\d{2}$/),
  daysOfWeek: z.array(z.number().int().min(1).max(5)).optional(),
  daysFromExpiry: z.array(z.number().int()).optional(),
  legs: z.array(legDefSchema).min(1).max(10),
  overall: z
    .object({
      slRs: z.number().optional(),
      tgtRs: z.number().optional(),
      trailingRs: z.object({ lockMin: z.number(), trailBy: z.number() }).optional(),
      maxLossRs: z.number().optional(),
    })
    .optional(),
  charges: z.object({ broker: z.string() }).optional(),
  slippage: z.object({ pts: z.number() }).optional(),
});
```

**Why a discriminated union for `StrikeSelector`:** the UI is one tabbed control (avoiding AlgoTest's five raw fields), but the model stays explicit and exhaustively type-checkable — the engine `switch`es on `mode`, and `z.discriminatedUnion` gives precise parse errors.

---

## 3. Saved-results data model — `src/features/backtest/shared/run-result.ts`

`RunResult` is the **computed snapshot** the results dashboard renders and the server persists. It is intentionally self-contained (re-renders without recompute; makes `/backtest/r/[id]` permalinks cheap and shareable). Heavy arrays (minute-wise MTM) are stored compactly and lazily.

```ts
export const RUN_RESULT_VERSION = 1;

export interface TradeRow {
  tradeDay: string; // YYYY-MM-DD
  entryTs: string;
  exitTs: string;
  legs: {
    strike: number;
    optionType: OptionType;
    side: Side;
    entry: number;
    exit: number;
    lots: number;
  }[];
  grossPnl: number;
  charges: number;
  netPnl: number;
  exitReason: "TIME" | "SL" | "TGT" | "TRAIL" | "MTM_SL" | "MTM_TGT" | "EOD";
  gapFilled?: boolean; // an entry/exit instant landed in a data gap (snapped to last real bar)
}

export interface LegResult {
  legId: string;
  strike: number;
  optionType: OptionType;
  side: Side;
  realizedPnl: number;
  winRatePct: number;
  n: number;
}

export interface RunResult {
  version: number; // RUN_RESULT_VERSION
  strategyDef: StrategyDef; // the exact inputs (reproducibility)
  engine: "builder" | "pyodide" | "server";
  computedAt: string; // ISO

  coverage: {
    // HONESTY layer — first-class (see data-layer §7)
    requestedStrikes: number;
    servedStrikes: number;
    coveragePct: number; // 0..1
    confidence: number; // 0..100 composite (see §3a)
    band: "High" | "Medium" | "Low";
    substitutions: { tradeDay: string; requested: number; served: number; distancePts: number }[];
    illiquidDays: string[];
    excludedDays: string[]; // whole-day-missing for a resolved leg → excluded
    filledBarFraction: number; // share of forward-filled minutes
  };

  headline: {
    // tier-1 verdict (6 stats)
    netPnlRs: number;
    netPnlPct: number;
    returnOverMaxDd: number;
    maxDrawdownRs: number;
    expectancyRs: number;
    winRatePct: number;
    sharpe: number;
  };

  quality: {
    // QuantConnect-style pass/fail chips
    significantPeriod: boolean;
    significantTrades: boolean;
    drawdownControlled: boolean;
    sufficientCoverage: boolean;
  };

  equityCurve: { t: string; equity: number; drawdown: number }[]; // daily
  monthlyReturns: { ym: string; pct: number }[];
  tradeReturns: number[]; // per-trade-day P&L (histogram + MC seed)
  breakdowns: {
    dayOfWeek: { dow: number; pnl: number; n: number }[];
    timeOfDay?: { bucket: string; pnl: number }[];
    expiry: { expiry: number; nonExpiry: number };
  };
  trades: TradeRow[]; // blotter rows
  perLeg?: LegResult[]; // multi-leg realized P&L
  mtmMinuteUrl?: string; // optional pointer to a lazily-fetched minute CSV/blob
}
```

### 3a. Confidence score (consumed by the verdict chips)

The composite confidence drives the honesty chips at the top of the results screen (the QuantConnect red/green-test pattern adapted for our patchy data reality):

```
confidence = round(100 * (
    0.45 * avgServedLegCoverage      // how complete the legs we actually traded were
  + 0.25 * (1 - filledBarFraction)   // penalize forward-filled minutes
  + 0.20 * (1 - excludedDayFraction) // penalize dropped days
  + 0.10 * exactStrikeFraction       // reward hitting requested strikes, not substitutes
))
band = confidence >= 80 ? "High" : confidence >= 55 ? "Medium" : "Low"
```

The **Monte-Carlo cone is derived on the client** from `tradeReturns` via the existing `useMonteCarlo()` worker — **not stored** — keeping the snapshot small (a few KB of JSON).

---

## 4. Where saved results live — NEW platform-DB tables (recommended, not optional)

**Store backtest strategies + runs in two NEW tables in the platform DB** (`src/server/db/platform-schema.ts`), alongside `community`/`feedback`/`notifications` — **NOT** in the per-user journal DB.

**Rationale (decisive):**

- **Public sharing requires central storage.** `/backtest/r/[id]` must be readable by anyone with the link (and the OG crawler). Per-user journal DBs are private, BYOD, and may live in the user's own infra — unreachable for a public permalink. Community content already lives centrally for exactly this reason.
- **Anonymous-first flow.** A run is computed before any login. The journal DB only exists _after_ email verification + provisioning (`auth.ts` gates provisioning on verification). Backtests must persist without a journal DB existing.
- **Backtest data is public-universe data, not journal data.** The invariant "journal data never lives in the platform DB" — backtests are the inverse: a public universe like community, so they belong with community in the platform DB.
- **Cost.** Snapshots are small JSON (a few KB each). Negligible on the shared platform Turso DB.

**Append to `src/server/db/platform-schema.ts`:**

```ts
/** Saved no-code/BYOC strategy definitions (public-universe data). */
export const backtestStrategies = sqliteTable("backtest_strategies", {
  id: text("id").primaryKey(), // newId() ULID
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  index: text("index").notNull(), // NIFTY|BANKNIFTY|SENSEX
  engine: text("engine").notNull().default("builder"), // builder|pyodide
  definition: text("definition").notNull(), // StrategyDef JSON (or code string for BYOC)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Computed backtest run snapshots. Public when shareSlug is set. */
export const backtestRuns = sqliteTable("backtest_runs", {
  id: text("id").primaryKey(), // == public permalink id (/backtest/r/[id])
  userId: text("user_id")
    .notNull() // claimed on save (anonymous runs never reach the DB)
    .references(() => user.id, { onDelete: "cascade" }),
  strategyId: text("strategy_id"), // optional link to a saved strategy
  index: text("index").notNull(),
  engine: text("engine").notNull(), // builder|pyodide|server
  status: text("status").notNull().default("done"), // queued|running|done|error (server runs only)
  // server-run bookkeeping (NULL for client runs):
  jobId: text("job_id"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  error: text("error"),
  result: text("result"), // RunResult JSON (NULL until done)
  shareSlug: text("share_slug").unique(), // set → publicly viewable; NULL → owner-only
  createdAt: text("created_at").notNull(),
});
```

**Append to `scripts/migrate-platform.ts`** (the established platform-migration mechanism — drizzle-kit is not used for the platform DB):

```ts
await db.run(sql`CREATE TABLE IF NOT EXISTS backtest_strategies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  index TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT 'builder',
  definition TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`);

await db.run(sql`CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  strategy_id TEXT,
  index TEXT NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  job_id TEXT, started_at TEXT, finished_at TEXT, error TEXT,
  result TEXT,
  share_slug TEXT UNIQUE,
  created_at TEXT NOT NULL
)`);

await db.run(
  sql`CREATE INDEX IF NOT EXISTS idx_bt_runs_user ON backtest_runs(user_id, created_at)`
);
await db.run(
  sql`CREATE INDEX IF NOT EXISTS idx_bt_strats_user ON backtest_strategies(user_id, updated_at)`
);
```

**Notifications reuse the existing `notifications` table** with two new `type` values — `backtest_done`, `backtest_failed`. **No new notification table.**

---

## 5. API routes (contracts)

Every route follows the same guard chain, **mirroring `src/app/api/feedback/route.ts` exactly**:

```
isAllowedOrigin(req) → getSession({ headers }) → rateLimit(key, limit, windowSec) → zod-parse body → act → typed JSON
```

| Route                            | Method | Auth                                  | Body / returns                                                                 |
| -------------------------------- | ------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| `/api/backtest/strategies`       | GET    | required                              | `→ StrategyListItem[]` (caller's strategies)                                   |
| `/api/backtest/strategies`       | POST   | required                              | `StrategyDef → { id }` (create or upsert)                                      |
| `/api/backtest/strategies/[id]`  | GET    | owner                                 | `→ { id, definition, ... }`                                                    |
| `/api/backtest/strategies/[id]`  | PATCH  | owner                                 | partial `StrategyDef → { id }`                                                 |
| `/api/backtest/strategies/[id]`  | DELETE | owner                                 | `→ { ok: true }`                                                               |
| `/api/backtest/runs`             | POST   | **required (this is the save/claim)** | `{ strategyDef, result: RunResult } → { id }` — persists a CLIENT-computed run |
| `/api/backtest/runs/[id]`        | GET    | owner OR `shareSlug` set              | `→ RunResult`                                                                  |
| `/api/backtest/runs/[id]`        | DELETE | owner                                 | `→ { ok: true }`                                                               |
| `/api/backtest/runs/[id]/share`  | POST   | owner                                 | `{ enabled } → { url }` (mints/clears `shareSlug`)                             |
| `/api/backtest/runs/[id]/status` | GET    | owner                                 | `→ { status, progress?, error? }` (server runs)                                |
| `/api/backtest/server-run`       | POST   | required                              | `{ strategyDef } → { id, status }` (starts server run)                         |
| `/api/backtest/jobs/callback`    | POST   | QStash-signed                         | webhook → finalize + `notify()`                                                |
| `/api/backtest/coverage`         | GET    | none (edge-cached)                    | `?index=&start=&end= → CoverageManifest`                                       |

**The default no-code and BYOC runs NEVER call a run API** — they compute in-worker. The only writes are at save / share. Rate-limit keys: `bt:save:<userId>` (e.g. 30/hour), `bt:coverage:<ip>` (e.g. 120/min, generous because edge-cached), `bt:server-run:<userId>` (e.g. 5/hour).

**Route handler skeleton** (every write route):

```ts
// src/app/api/backtest/runs/route.ts
import { after } from "next/server";
import { isAllowedOrigin } from "@/server/origin-check";
import { getSession } from "@/server/community";
import { rateLimit } from "@/server/rate-limit";
import { saveRun } from "@/server/backtest";
import { strategyDefSchema } from "@/features/backtest/shared/strategy-def";
import { runResultSchema } from "@/features/backtest/shared/run-result";
import { z } from "zod";

const body = z.object({ strategyDef: strategyDefSchema, result: runResultSchema });

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const session = await getSession(req.headers);
  if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
  const limited = await rateLimit(`bt:save:${session.user.id}`, 30, 3600);
  if (!limited.ok) return Response.json({ error: "rate_limited" }, { status: 429 });

  const parsed = body.safeParse(await req.json());
  if (!parsed.success)
    return Response.json({ error: "invalid", issues: parsed.error.issues }, { status: 400 });

  const id = await saveRun(session.user.id, parsed.data.strategyDef, parsed.data.result);
  return Response.json({ id });
}
```

---

## 6. Async-job + notification design

Two execution lanes.

**Lane A — Client (default, ~99% of runs).** No server involvement. `use-backtest-run.ts` posts the `StrategyDef` (or code string) to `workers/backtest.worker.ts` (or `workers/pyodide.worker.ts`), which lazy-boots duckdb-wasm, range-reads HF slices, runs `lib/backtest/engine/simulate.ts`, streams progress messages, and posts back a `RunResult`. **Mirrors the `useMonteCarlo` worker hook exactly.** Cost = $0, scales infinitely.

```
useBacktestRun.run(def)
  → worker.postMessage({ type: "run", def })
  → worker: getDuck() → range-read HF parquet → simulate() → progress msgs → { type: "done", result }
  → hook resolves RunResult → results-dashboard renders → save-share-bar appears (login-nudge if anon)
```

**Lane B — Server (opt-in escape hatch; huge ranges / future paid tier).** `POST /api/backtest/server-run`:

```
client POST → create backtest_runs row (status=queued) → estimate cost
   ├─ if estimated ≤ 300s:
   │     run inline in the route; if it finishes → status=done, return result.
   │     if it approaches the budget → persist partial + after(() => finishOnServer())
   │
   └─ if estimated > 300s (rare; future paid tier):
         enqueue Upstash QStash job (publishes to /api/backtest/jobs/callback) → return { id, status:"queued" }
         client polls /runs/[id]/status (TanStack Query refetchInterval) until done.

finalize (either path) → write RunResult + status=done →
   notify({ userId, actorId: userId, type: "backtest_done", postId: runId }) +
   sendEmail(user.email, "Your backtest is ready", emailLayout(..., url=/backtest/r/[id]))
on error → status=error + error msg → notify(type:"backtest_failed") + (no email spam) in-app only
```

**Reuses:** `after` from `next/server`; `notify()` (`src/server/community.ts`); `sendEmail` + `emailLayout` (`src/server/email.ts`); the existing `notifications` table + `NotificationsBell`. **QStash is added only behind `serverEnv.upstashUrl` presence** (the env pattern already used in `src/server/rate-limit.ts`) — if absent, the >300s path **degrades gracefully** to "run client-side" with an honest message, keeping near-zero infra cost as a hard constraint.

**Server module ownership:**

- `src/server/backtest.ts` — `saveRun(userId, def, result)`, `getRun(id, session)`, `shareRun(id, enabled)`, `assertOwnerOrShared(run, session)`.
- `src/server/backtest-jobs.ts` — `startServerRun(userId, def)`, `finalizeRun(id, result)`, `failRun(id, error)`; estimate + QStash enqueue.

---

## 7. Auth + login-nudge integration

- Builder (`/backtest/build`) and code (`/backtest/code`) are **fully usable anonymously** — no `getSession` gate at the page level.
- The in-progress `StrategyDef` **autosaves to `localStorage`** via `builder-store.ts` (the codebase already persists drafts: `src/stores/draft-store.ts`, `plans-store.ts`). Lossless Back across wizard steps.
- A completed anonymous `RunResult` is held in zustand + written to **IndexedDB** (so a refresh doesn't lose it).
- `save-share-bar.tsx` renders only when results are ready. If anonymous, clicking **Save / Share / Notify** opens `login-nudge.tsx` → routes to `/app/onboarding` with `?returnTo=/backtest&claim=<idbKey>`.
- After auth (Better Auth, existing flow), a one-shot effect reads the IndexedDB run and `POST /api/backtest/runs` to **claim** it (persist with the now-known `userId`), then redirects to `/backtest/r/[id]`.
- `/backtest/strategies` (saved list) **IS auth-gated** — server-side `getSession()`; redirect to onboarding if absent.

```
Anonymous build/run ─► RunResult (zustand + IndexedDB)
        │
        ├─ Save/Share/Notify clicked ─► login-nudge ─► /app/onboarding?returnTo=/backtest&claim=<idbKey>
        │                                                        │
        │                                              Better Auth (verify) ──► provisioned
        │                                                        │
        └──────────────────────────────────────────► one-shot claim effect:
                                                       read IDB[claim] → POST /api/backtest/runs
                                                       → redirect /backtest/r/[id]
```

---

## 8. Market-calendar module — `src/lib/backtest/calendar/`

- **`scripts/gen-market-calendar.mjs`** (build/CI script) emits `public/backtest/calendar/nse-bse-calendar.json`:

```jsonc
{
  "version": 1,
  "holidays": { "NSE": ["2024-01-26", "..."], "BSE": ["..."] },
  "expiryAnchors": {
    "NIFTY": {
      "weekly": "THU",
      "monthly": "lastTHU",
      "changes": [{ "from": "2024-09-01", "weekly": "THU" }],
    },
    "BANKNIFTY": {
      "weekly": "WED",
      "monthly": "lastWED",
      "changes": [{ "from": "2024-11-20", "weekly": null }],
    },
    "SENSEX": { "weekly": "FRI", "monthly": "lastFRI", "changes": [] },
  },
}
```

- **`expiry-rules.ts`** resolves weekly/monthly expiry for a trade-day, honoring NSE/BSE weekday shifts (the `changes` array makes the rule **date-aware**, not hard-coded). Holidays roll expiry to the previous trading day.
- **`market-calendar.ts`** exposes:
  - `tradingDays(start, end, exchange): string[]`
  - `resolveExpiry(index, tradeDay, rule): string`
  - `daysFromExpiry(tradeDay, expiry): number`

  Both the worker and the server import it (pure, no React). The JSON is fetched once and cached.

- Reuses the `daysToExpiry` logic shape from `src/lib/options/payoff.ts`.

---

## 9. Composition with existing code (reuse map)

| Existing module (absolute path)                                                                                     | Reused for                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/components/shared/site-header.tsx` + `src/components/shared/nav-links.tsx`                                     | `/backtest` chrome — **edit `NAV` to add Backtest**               |
| `src/app/community/layout.tsx` (pattern)                                                                            | `src/app/backtest/layout.tsx` shape                               |
| `src/providers/query-provider.tsx`                                                                                  | TanStack Query for status polling / saved lists / coverage fetch  |
| `src/lib/charges/charges.ts` (`computeCharges`)                                                                     | realistic STT/GST/brokerage in `engine/fills.ts`                  |
| `src/lib/options/payoff.ts` (`buildPayoffCurve`, `classifyStrategy`, `daysToExpiry`, `PayoffLeg`, `intrinsicValue`) | live preview rail + per-leg breakdown + auto-naming the structure |
| `src/lib/montecarlo/*` + `useMonteCarlo`                                                                            | the MC drawdown cone (zero new worker)                            |
| `src/lib/stats/stats.ts`                                                                                            | win%/expectancy/streak helpers in `engine/metrics.ts`             |
| `src/server/community.ts` (`notify`, `getSession`)                                                                  | run-ready notification + auth                                     |
| `src/server/email.ts` (`sendEmail`, `emailLayout`)                                                                  | run-ready email                                                   |
| `src/server/rate-limit.ts`, `src/server/origin-check.ts`, `src/server/ssrf.ts`                                      | every API route guard + HF egress allowlist (paid tier)           |
| `src/lib/id.ts` (`newId`), `notifications` table                                                                    | run/strategy IDs + in-app notifications                           |
| `src/lib/db/adapters/local.ts`                                                                                      | the WASM-DB-in-IndexedDB pattern the OPFS/IDB cache mirrors       |
| `src/components/shared/empty-state.tsx`, `error-fallback.tsx`, `ui/skeleton.tsx`                                    | honest empty/loading/error states (incl. patchy-coverage)         |
| `src/components/layout/command-palette.tsx` (cmdk)                                                                  | optional Cmd+K "New backtest / switch index"                      |

**New deps required:** `@duckdb/duckdb-wasm` (browser), `@duckdb/node-api` (server manifest + paid tier), `@monaco-editor/react` (BYOC, lazy), Pyodide (BYOC lane only, loaded from CDN inside the worker). Everything else reuses current deps (`recharts`, `vaul`, Radix, TanStack Query/Virtual, zustand).

---

## 10. Bundle + CSP/headers notes (load-bearing)

- **CSP already supports the stack:** `'wasm-unsafe-eval'` (Pyodide + duckdb WASM compile), `worker-src 'self' blob:`, `connect-src 'self' https: wss:` (HF range-reads + jsDelivr CDN). **No CSP change needed for the WASM to run.**
- **Add COOP/COEP only on `/backtest`** via a scoped `headers()` entry in `next.config.ts` so Pyodide can use threads/SharedArrayBuffer if enabled:

```ts
// next.config.ts → headers()
{
  source: "/backtest/:path*",
  headers: [
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
  ],
}
```

Scope it to `/backtest/:path*` so it never touches community/journal pages (which load cross-origin libsql).

- **Redirect** (`next.config.ts → redirects()`): `{ source: "/app/backtesting", destination: "/backtest", permanent: true }`.
- **Lazy-load everything heavy.** Monaco, Pyodide, and duckdb-wasm are dynamic `import()`ed inside the worker / `monaco-loader.tsx` — never in the builder's first paint. The no-code builder ships with **zero WASM in its initial bundle**; only `/backtest/code` pulls Pyodide, and only on Run.
- **Charts:** reuse `recharts` (already a dep) — no ECharts.
- **Byte budget:** cold backtest (one index, one expiry, one resolved leg, one month, 1m) targets **< 2 MB** transferred via predicate + projection pushdown; OPFS resolved-slice cache capped at **250 MB** (LRU); DuckDB `SET memory_limit='512MB'`.

---

## 11. UI wireframes

**No-code builder — `/backtest/build` (desktop):**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ TradeMarkk  Features Community Pulse [Backtest] Docs …          [Sign in]   │  ← SiteHeader
├───────────────────────────────────────────────────────────────────────────┤
│  ● Market ─ ○ Legs ─ ○ Timing & Risk ─ ○ Review        Step 2 / 4          │  ← persistent stepper
├──────────────────────────────────────────┬────────────────────────────────┤
│  STEP: Legs                               │  LIVE PREVIEW (persistent rail) │
│ ┌──────────────────────────────────────┐ │  ┌───────────────────────────┐  │
│ │ Leg 1   [SELL] [CE]   75 (1 lot)     │ │  │      payoff curve  ╱╲      │  │
│ │ Strike: [ATM±][%][Premium][Delta][X] │ │  │     ╱        ╲             │  │
│ │   ATM + [ 0 ]            ✓ 22500     │ │  └───────────────────────────┘  │
│ │ ⚠ nearest available 22550 (71%)      │ │  Max P ₹6,240   Max L −₹3,100   │
│ └──────────────────────────────────────┘ │  Breakeven 22,460   PoP 63%     │
│ ┌──────────────────────────────────────┐ │  ┌ Target day | Expiry day ──┐  │
│ │ Leg 2   [SELL] [PE]   75 (1 lot) …   │ │  │  slider ●───────  +1.2%   │  │
│ └──────────────────────────────────────┘ │  └───────────────────────────┘  │
│  [+ Add leg]                              │  Δ −0.02 Θ +180 Γ … IV 12.4%    │
├──────────────────────────────────────────┴────────────────────────────────┤
│            [ Back ]                                   [ Next: Timing ▶ ]    │
└─────────────────────────────────────────────────────────────────────────── ┘
```

**Mobile builder:** the live preview becomes a **Vaul bottom-sheet** (`vaul` is a dep) — drag handle + tap-out dismiss; steps stack full-width; sticky `Back / Next` footer.

**Step 1 "Market" — coverage badge for the chosen index+range:**

```
┌──────────────────────────────────────────────────────────────────┐
│  Step 1 of 4 — Market                                    [1│2│3│4] │
├──────────────────────────────────────────────────────────────────┤
│  Index     [ NIFTY ▾ ]   Candle  [ 1m ▾ ]                          │
│  Range     [ 01 Jan 2026 ]  →  [ 31 Mar 2026 ]   ( 58 trading days)│
│  ┌── Data coverage for this selection ───────────────────────────┐│
│  │  ● High confidence · 84% strike coverage in ±300pt band        ││
│  │  ▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇░░░░  NIFTY weeklies well-covered         ││
│  │  ⚠ 3 expiries below 60% — flagged when you pick a strike there  ││
│  │                                          [ see coverage map → ] ││
│  └────────────────────────────────────────────────────────────────┘│
│                                              [ Back ]   [ Next → ] │
└──────────────────────────────────────────────────────────────────┘
```

**Leg nearest-strike chip (Step 2):**

```
┌── Leg 1 ───────────────────────────────────────────────────────────┐
│  ◉ Sell   ○ Buy      CE / [PE]      Lots [ 1 ]  (= 75 qty)          │
│  Strike   [ ATM±  ‹ % offset › Premium  Delta  Exact ]   ATM  [-2▾] │
│           → requested 21400 PE                                      │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ⚠ 21400 PE not in dataset — using 21450 PE (50pt away · 71%)   │ │
│  │   [ keep nearest ]   [ pick another ]   [ why? ]               │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Coverage map modal (strike-availability heatmap — BYOC catalog reuses it):**

```
┌── NIFTY · 29 Jan 2026 expiry · 01–29 Jan ─────────────────────────────┐
│        CE                                  PE                          │
│ 21600 ▓▓▓▓▓▓▓▓▓░  92%      21600 ▓▓▓▓▓▓▓▓░░  78%                       │
│ 21550 ▓▓▓▓▓▓▓▓▓▓  98%      21550 ▓▓▓▓▓▓▓▓▓░  90%                       │
│ 21500 ▓▓▓▓▓▓▓▓▓▓  98% ATM  21500 ▓▓▓▓▓▓▓▓▓▓  95%  ← ATM               │
│ 21450 ▓▓▓▓▓▓░░░░  61%      21450 ▓▓▓▓▓▓▓░░░  71%                       │
│ 21400 ░░░░░░░░░░   —       21400 ▓▓▓▓░░░░░░  41% illiquid              │
│  legend: ▓ present · ░ missing/illiquid · — strike absent             │
│  [ click any cell → insert query snippet ]            [ close ]       │
└───────────────────────────────────────────────────────────────────────┘
```

**Results — `/backtest/r/[id]`:**

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Short Straddle · NIFTY · 1m · 2021–2026                  [Save] [Share ▾]  │
│  "Profitable but drawdown is steep."                                        │
│  [ ● Confidence 78 · Medium ] [ 84% coverage ] [ 56 trade-days ✓ ]          │  ← honesty chips (§3a)
│  [ 2 days excluded (no data) ] [ 1 leg used nearest strike ]                │
│  ₹1,24,300 (+18.4%)  │ Ret/MaxDD 2.3 │ MaxDD ₹54k │ Exp ₹302 │ Win 61% │ SR 1.1│
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │  equity ▁▂▄▆█▇▆█  (shared time axis)                                      │ │
│ │  drawdown ▔▔▁▂▁▔▔  (underwater, same axis)                               │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│  [ Returns ] [ Risk ] [ India ] [ Trades ] [ Per-leg ] [ Advanced ]         │  ← tier-2/3 tabs
│  Monthly heatmap · distribution · MC cone (95th-pct DD) · DoW/expiry splits  │
├───────────────────────────────────────────────────────────────────────────┤
│  ⚠ Past performance ≠ future results. This is educational, not advice.      │  ← disclaimers.tsx
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Implementation order (workflow can follow directly)

1. **Scaffold + nav.** Delete `src/app/app/backtesting/page.tsx`; add redirect + scoped COOP/COEP header in `next.config.ts`; add `/backtest` to `NAV` in `src/components/shared/nav-links.tsx`; create `src/app/backtest/layout.tsx` (clone community layout) + `page.tsx` + `backtest-home.tsx`.
2. **Shared models.** `features/backtest/shared/{strategy-def,run-result,instruments}.ts` (+ zod schemas in §2/§3).
3. **Pure engine + tests.** `lib/backtest/engine/*`, `lib/backtest/calendar/*`, `scripts/gen-market-calendar.mjs` → JSON. Unit-test in isolation (codebase convention: pure libs are heavily tested).
4. **Data layer.** `lib/backtest/data/{schema,urls,sql,duck-browser,client,resolve,coverage}.ts` + `cache/{opfs,idb}.ts`.
5. **Workers.** `workers/backtest.worker.ts` (wraps engine) + `run/use-backtest-run.ts` (clone `useMonteCarlo` hook).
6. **No-code builder UI.** `builder/*` wizard + live preview (reuse `buildPayoffCurve`).
7. **Results dashboard.** `results/*` (reuse montecarlo, payoff, charges, stats).
8. **Persistence.** Append 2 tables to `platform-schema.ts` + `migrate-platform.ts`; `server/backtest.ts`; `/api/backtest/{strategies,runs}` routes; login-nudge + claim flow.
9. **BYOC.** `code/*` + `workers/pyodide.worker.ts` + `lib/backtest/pyodide/*` + data catalog + error translator + starter strategies.
10. **Server tier (last).** `server/backtest-jobs.ts`, `/api/backtest/server-run`, `/jobs/callback`, status polling, `notify()` + email. QStash behind env presence.
11. **Docs + disclaimers.** This file + `docs/BACKTEST.md` data-API reference; `disclaimers.tsx` wired into builder + results.

**Key reusable-file references for the team (absolute paths):**

- Worker hook template — `src/features/analytics/hooks/use-monte-carlo.ts`
- API route template — `src/app/api/feedback/route.ts`
- Public-universe layout template — `src/app/community/layout.tsx`
- notify + email — `src/server/community.ts` + `src/server/email.ts`
- payoff / charges / montecarlo / stats libs — `src/lib/options/payoff.ts`, `src/lib/charges/charges.ts`, `src/lib/montecarlo/*`, `src/lib/stats/stats.ts`
- platform migration — `scripts/migrate-platform.ts`
- WASM-DB-in-IndexedDB pattern — `src/lib/db/adapters/local.ts`

---

### Acceptance criteria (architecture-level "done")

1. `/backtest`, `/backtest/build`, `/backtest/code` render the SiteHeader chrome and are fully usable **anonymously**; `/app/backtesting` 308-redirects to `/backtest`.
2. A no-code run executes entirely in `workers/backtest.worker.ts` with **no run API call**; results render from an in-memory `RunResult`.
3. An anonymous run survives refresh (IndexedDB) and is **claimed** with a single `POST /api/backtest/runs` after login, landing on `/backtest/r/[id]`.
4. `/backtest/r/[id]` is publicly readable **iff** `shareSlug` is set; OG metadata renders server-side.
5. Both `backtest_strategies` and `backtest_runs` are created idempotently by `scripts/migrate-platform.ts`; no journal-DB write ever occurs for backtests.
6. Every API route enforces `isAllowedOrigin → getSession → rateLimit → zod-parse`.
7. The `/backtest` route group carries COOP/COEP; no other route does.
8. Patchy coverage is never a silent empty: every strike resolves to `{ served, distancePts, coveragePct }` and surfaces a chip; the results header shows the composite **Confidence** score and band.
