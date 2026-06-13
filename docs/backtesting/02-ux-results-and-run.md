# UX — Results Report & the Run/Notify Experience

> **Scope.** This spec covers the two surfaces a backtest user lives in after they press **Run**: the **Results / Report screen** (the verdict, evidence, drill-down, share card, and every empty/low-coverage state) and the **Run + Notify experience** (the running modal, the close-and-notify loop, error/loading states, deep-linking, and the motion language). It is written to be built _verbatim_ by an implementation workflow.
>
> **Universe.** A new, standalone, public **Backtesting** area reached from the marketing-site header (like `/community`), **not** inside the logged-in `/app` journal. Only three instruments: **NIFTY, BANKNIFTY, SENSEX** (index spot + weekly/monthly options).
>
> **Hard product rule (applies to every screen below).** Never gate login to _run_. Anonymous users build, run, watch live progress, and read the full report. Login is nudged **only** at **save / share / "email me when done."**
>
> **The moat.** Options data is ~40–68% complete (worst: SENSEX) and some captured strikes are sparse/illiquid. Honest, calm, one-tap-fixable handling of patchy/illiquid strikes — surfaced as a `CoverageBadge` that travels into the report, the share card, and the email — is **the** thing AlgoTest / Sensibull / Opstra / Tradetron / Streak do **not** do. It is non-negotiable on every surface in this document.

---

## Table of contents

**Part A — Results / Report screen**

- [A0. Design thesis](#a0-design-thesis-opinionated-non-negotiable)
- [A1. Full-page layout — desktop](#a1-full-page-layout--desktop-1024px)
- [A2. Run header (sticky)](#a2-run-header-sticky-56px)
- [A3. Tier 1 — The Verdict band](#a3-tier-1--the-verdict-band)
- [A4. Tier 2 — The Evidence (tabs)](#a4-tier-2--the-evidence-radix-tabs)
- [A5. Tier 3 — The Drill-down](#a5-tier-3--the-drill-down-collapsed-accordion-lazy)
- [A6. Shareable public report card](#a6-shareable-public-report-card)
- [A7. Mobile layout](#a7-mobile-layout-640px-mobile-first-pwa)
- [A8. Empty / low-coverage / error states](#a8-empty--low-coverage--error-states-the-patchy-data-reality)

**Part B — Run + Notify experience**

- [B0. Mental model & the three execution lanes](#b0-mental-model--the-three-execution-lanes)
- [B1. RUN states — the state machine](#b1-run-states--the-state-machine)
- [B2. The RUNNING modal](#b2-the-running-modal--primary-surface)
- [B3. Backgrounded run — the docked mini-pill](#b3-backgrounded-run--the-docked-mini-pill)
- [B4. Toast — "results are ready"](#b4-toast--the-results-are-ready-moment)
- [B5. In-app bell notification](#b5-in-app-bell-notification)
- [B6. Error & empty states](#b6-error--empty-states--the-differentiator)
- [B7. Deep-linking back to results](#b7-deep-linking-back-to-results)
- [B8. Streaming / partial results](#b8-streaming--partial-results)

**Cross-cutting**

- [C9. Motion-design language](#c9-motion-design-language)
- [C10. Component & build inventory](#c10-component--build-inventory)

---

## Conventions & shared reuse (read once)

**Route map (all public, anonymous-runnable):**

| Surface                                  | Route                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Results / report                         | `src/app/(public)/backtesting/results/[runId]/page.tsx`                     |
| Canonical run (deep-link, mid-run aware) | `src/app/backtesting/runs/[runId]/page.tsx`                                 |
| Short shareable card + OG image          | `src/app/(public)/backtesting/r/[shareId]/page.tsx` + `opengraph-image.tsx` |
| Feature code                             | `src/features/backtesting/results/` and `src/features/backtesting/`         |

**Stack reuse.** Recharts 2.15, `motion@12`, `@number-flow/react`, `@tanstack/react-virtual` + `react-table`, Radix UI primitives, TanStack Query, semantic tokens (`bg`, `surface`, `surface-2`, `accent`, `profit`, `loss`, `muted`, `border`), `Card` / `StatCard` / `EmptyState`.

**Reuse verbatim (no new UI):**

- `c:\Users\raash\Desktop\trading-journal\src\lib\options\payoff.ts` — `buildPayoffCurve`, `classifyStrategy`.
- `c:\Users\raash\Desktop\trading-journal\src\lib\options\analytics.ts` — `MIN_SAMPLE`, bucketing helpers.
- `c:\Users\raash\Desktop\trading-journal\src\lib\montecarlo\simulate.ts` + `montecarlo.worker.ts` — `extractRSamples`, `runSimulation`, `MIN_TRADES` (the Monte-Carlo cone, already worker-bound).
- `c:\Users\raash\Desktop\trading-journal\src\lib\charges\charges.ts` — per-trade STT / GST / stamp / brokerage by broker.
- `useMonteCarlo` hook pattern (request-id supersession, lazy worker, synchronous fallback) — cloned for `useBacktest`.
- The `/community` public-universe pattern: `src/app/community` + `src/components/shared/site-header.tsx` + `src/components/shared/nav-links.tsx`.
- The `notifications` table + `useNotifications` poll + `NotificationsBell`, `sendEmail` + `emailLayout` + throttle, `rateLimit(key, limit, windowSec)`, the toast primitive, the mobile bottom-sheet primitive.

**Extend existing:** `StatCard` (add `delta` / `trend` props) · `EmptyState` (used as-is) · `Card` family · `EquityCone` (base for `MonteCarloCone`).

**New pure-math modules (mirror existing `src/lib` style, fully unit-testable):**

- `src/lib/backtest/metrics.ts` — Sharpe / Sortino / Calmar / Omega / Ulcer / expectancy / profit-factor / streaks / VaR over the trade-day series.
- `src/lib/backtest/drawdown.ts` — underwater series + top-5 episodes.
- `src/lib/backtest/coverage.ts` — requested-vs-served strike accounting → the `coverage %` that drives every badge.

**A trade = a trading-day / cycle** (AlgoTest convention) for index-options strategies. Every count is labelled "trade-days" so users never read "412 trades = 412 days" as a bug.

---

---

# Part A — Results / Report screen

## A0. Design thesis (opinionated, non-negotiable)

1. **VERDICT → EVIDENCE → DRILL-DOWN.** Three vertical tiers. The user answers _"is this any good?"_ in under 3 seconds from the band alone, before touching a tab.
2. **Honesty is the product moat.** A `CoverageBadge` lives in the verdict band, on the share card, **and** inline on every chart that depends on patchy strikes. We name `served vs requested` strike and `coverage %` the way Pine names `na` — never a silent empty chart.
3. **Equity and drawdown always share the time axis.** One composed chart, drawdown as red shading underneath (TradingView canon).
4. **Ratios are demoted.** Net P&L, Return/Max-DD, Expectancy, Win%, Max-DD, Sharpe in the band (6 cards, Composer-tight). Sortino / Calmar / Omega / Ulcer / tail / VaR are tucked into a collapsed "All metrics" table in Tier 3.
5. **Benchmark is opt-in**, default OFF; default series = the run's own index buy-&-hold (NIFTY / BANKNIFTY / SENSEX spot).
6. **Login nudges only at save / share / notify.** The report renders fully for anonymous users. Results are _computed_, never optimistic; only the save/bookmark toggle uses `useOptimistic`.
7. **Trade = trading-day / cycle.** Labelled explicitly in the blotter header.

---

## A1. Full-page layout — desktop (≥1024px)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ‹ Builder      Short Straddle · NIFTY · 1m · 02 Jan 2024 – 31 May 2026        │  ← run header (sticky)
│                                  [↻ Re-run] [⚙ Edit strategy] [↗ Share] [☆ Save]│
├──────────────────────────────────────────────────────────────────────────────┤
│ TIER 1 — THE VERDICT                                                           │
│ ┌────────────────────────────────────────────────────────────────────────┐   │
│ │ ✓ Profitable over 2.4 yrs, but a 22% drawdown would have tested you.     │   │ ← 1-line plain verdict
│ │ ────────────────────────────────────────────────────────────────────────│   │
│ │ [▢ Coverage 82%]  [▢ 412 trade-days]  [▢ 2024–2026]  [▢ DD controlled ✓] │   │ ← honesty / quality chips
│ │   [▢ Slippage modelled]  [▢ Charges incl. (Zerodha)]                     │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
│ ┌────────┬────────┬────────┬────────┬────────┬────────┐                       │
│ │NET P&L │RET/MAXDD│EXPECT. │ WIN %  │MAX DD  │ SHARPE │   ← 6 animated stat   │
│ │₹2.4L ▲ │  2.8×  │ ₹620/d │ 64.2%  │−22.1% ▼│  1.41  │     cards (NumberFlow)│
│ │ +18.2% │        │ 0.42R  │262/412 │ 14 days│        │                       │
│ └────────┴────────┴────────┴────────┴────────┴────────┘                       │
│ ┌────────────────────────────────────────────────────────────────────────┐   │
│ │  EQUITY CURVE  ·  cumulative net P&L          [compare ⌄ NIFTY B&H ▢]    │   │
│ │     ╱╲        ╱─────╲      ╱──────                                        │   │ ← HERO: equity (area)
│ │ ╱──╯  ╲────╱        ╲───╱            (faint dashed = NIFTY B&H if on)     │   │   + drawdown shaded
│ │░░░░░░▒▒▒▒▒▒░░░░░░░░░▓▓▓▓▒▒▒░░░░░░░░░░  ← underwater band (shared X axis)   │   │   beneath, shared axis
│ │ Jan'24      Jul'24      Jan'25      Jul'25      Jan'26                    │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────────────────┤
│ TIER 2 — THE EVIDENCE     [ Returns | Risk | Calendar | Payoff ]  ← tab strip  │
│ ┌──────────────────────────────────┬─────────────────────────────────────┐    │
│ │ Monthly returns heatmap          │ Return-per-trade distribution        │    │
│ │  J F M A M J J A S O N D          │      ▁▃▅█▇▅▃▁                        │    │
│ │24 ▢▣▣▢▣█▢▣▣▣▢▣                    │   ───┴──┴──0──┴──┴───                │    │
│ │25 ▣▢█▣▣▢▣▣▢▣█▢                    │  loss        │       win             │    │
│ │26 ▣▣▢▣▣ · · · · · ·  (no data)    │  skew −0.3 · fat left tail           │    │
│ └──────────────────────────────────┴─────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────────────────────┤
│ TIER 3 — THE DRILL-DOWN  (lazy, collapsed by default)                          │
│ ▸ Trade-by-trade log (412)          ▸ Per-leg breakdown                        │
│ ▸ MAE / MFE scatter                 ▸ All metrics (Sortino, Calmar, Omega…)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Grid.** 12-col, 24px gutters. Tier-1 stat strip = 6 cards via `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`. Tier-2 evidence = `lg:grid-cols-2`. Hero chart spans full width.

**Tier ownership.** `ResultsPage` is the orchestrator: it owns lazy tab mounting (do not compute heatmaps/cones until the tab is selected) and wraps each Tier-2/3 card in an `AsyncBoundary` so a single bad data slice degrades one card, never the page (see [A8.3](#a83-compute-error)).

---

## A2. Run header (sticky, 56px)

- **Left:** back chevron → builder (preserves wizard state from `localStorage`), then strategy name (from `classifyStrategy`) + breadcrumb `index · interval · date range`.
- **Right action cluster:** `Re-run` (secondary), `Edit strategy` (secondary), `Share` (accent outline), `Save` (accent solid, star icon).
  - **Save and Share are the only login gates.** An anonymous click opens a `LoginNudgeSheet` — _"Sign in to save this backtest and get notified when long runs finish."_
  - `Save` toggle is the **only** place `useOptimistic` is used in this screen (star fills instantly; reverts on failure).
- **Mobile collapse:** back chevron + truncated name + a `⋯` overflow menu (`DropdownMenu`) holding Re-run / Edit / Share / Save.

---

## A3. Tier 1 — The Verdict band

### A3a. `VerdictHeadline`

One generated plain-English sentence + emoji status glyph. **Template-driven, NOT an LLM call** (zero cost, deterministic):

| Condition                       | Sentence                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| `netPnl > 0 && maxDdPct < 0.15` | "✓ Profitable over {span}, with a manageable {ddPct} drawdown."                                     |
| `netPnl > 0 && maxDdPct ≥ 0.15` | "✓ Profitable over {span}, but a {ddPct} drawdown would have tested you."                           |
| `netPnl ≤ 0`                    | "✕ This strategy lost money over {span} ({netPnl}). The losing months cluster around {worstMonth}." |
| `trades < 30`                   | prefix → "⚠ Only {n} trade-days — treat these results as a hint, not a verdict."                    |

The `trades < 30` prefix composes with the P&L line (e.g. `⚠ Only 18 trade-days … ✓ Profitable over …`).

### A3b. `QualityChipRow` (adapt QuantConnect's red/green pass-fail tests — our biggest trust differentiator)

Pill chips, color-coded `pass | warn | fail`. Each chip has a tooltip explaining the threshold.

```
[▢ Coverage 82% ✓]  [▢ 412 trade-days ✓]  [▢ 2024–2026]  [▢ DD controlled ✓]  [▢ Slippage modelled ✓]
```

| Chip                    | Source                                                                | Rule                                                                   | Tone                                                                                               |
| ----------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Coverage**            | `coverage.ts` — served strikes ÷ requested strikes across all entries | `≥80%` green · `50–80%` amber · `<50%` red                             | pass/warn/fail. Click → scrolls to "Coverage detail" disclosure (which dates/strikes substituted). |
| **Significant period**  | date span                                                             | `≥ 1 yr` green (QC threshold relaxed from 5yr for our shorter dataset) | pass/warn                                                                                          |
| **Significant trading** | trade-day count                                                       | `≥100` green · `30–100` amber · `<30` red                              | pass/warn/fail                                                                                     |
| **DD controlled**       | `drawdown.ts` maxDD                                                   | `<15%` green · `15–25%` amber · `>25%` red                             | pass/warn/fail                                                                                     |
| **Slippage / Charges**  | `charges.ts`                                                          | always green when modelled, naming the broker                          | informational → render in `neutral` tone (charges, date-range chip)                                |

`<CoverageBadge>` is a **standalone exported component**, reused on the share card ([A6](#a6-shareable-public-report-card)), inline on charts ([A4](#a4-tier-2--the-evidence-radix-tabs)), the running modal ([B2](#b2-the-running-modal--primary-surface)), and the email ([B7.2](#b72-the-email)).

### A3c. `VerdictStatStrip` — 6 `StatCard`s (extend existing `StatCard`)

`StatCard` already does NumberFlow + auto profit/loss tone. **Add a `delta`** (small badge) **and `trend`** (arrow) prop. Six cards, fixed order:

| #   | Label           | Value        | Sub               | Tone                  |
| --- | --------------- | ------------ | ----------------- | --------------------- |
| 1   | NET P&L         | `₹2,40,120`  | `+18.2% ROI`      | auto                  |
| 2   | RETURN / MAX-DD | `2.8×`       | —                 | neutral (green if ≥2) |
| 3   | EXPECTANCY      | `₹620 / day` | `0.42R`           | auto                  |
| 4   | WIN %           | `64.2%`      | `262 / 412`       | neutral               |
| 5   | MAX DRAWDOWN    | `−22.1%`     | `14-day recovery` | loss                  |
| 6   | SHARPE          | `1.41`       | —                 | neutral               |

**Why this six.** Return/Max-DD and Expectancy lead because AlgoTest's optimiser and Indian options sellers rank on exactly those; Sharpe is demoted to position 6 (a single Sharpe lies — the rolling one lives in Tier 2). Use `format: inrFormat` for the ₹ cards.

### A3d. `HeroEquityChart` (the single most important chart)

Recharts `ComposedChart`, three series on a shared X (trading day):

1. **`Area` equity** (cumulative net P&L) — `var(--profit)`/`var(--loss)` by final sign, gradient fill `id="equityFill"` (copy the exact gradient pattern from `equity-chart.tsx`).
2. **`Area` underwater drawdown** rendered _beneath_ on a secondary Y axis (`orientation="right"`, hidden), filled `var(--loss)` at `0.12` opacity. `drawdown = equity − runningPeak`, always ≤ 0.
3. **Optional `Line` benchmark** — dashed `strokeDasharray="4 4"`, `var(--muted)`, only when the compare toggle is on.

**Controls.** A `compare ⌄` popover (`@radix-ui/react-popover`) with a switch per benchmark (NIFTY B&H default, then BANKNIFTY, SENSEX). Top-5 drawdown periods get faint vertical `ReferenceArea` bands tinted by severity (QuantConnect's "top-5 DD highlighted"). Crosshair `Tooltip` shows `date · equity · drawdown · "day 142 of 412."`

---

## A4. Tier 2 — The Evidence (Radix `Tabs`)

Four tabs: **Returns · Risk · Calendar · Payoff.** Each tab **lazy-mounts** (don't compute heatmaps until selected). Every chart whose data is partial carries an inline `CoverageBadge` in its card header.

### A4a. Returns tab

```
┌─────────────────────────────────┬────────────────────────────────────┐
│ MONTHLY RETURNS HEATMAP          │ RETURN-PER-TRADE DISTRIBUTION        │
│       J  F  M  A  M  J ...        │        ▁▃▅█▇▅▃▁                     │
│  2024 +2 −1 +4 ▢  +6 −2 ...       │     ───┴────┴──0──┴────┴───          │
│  2025 +1 +3 +8 −2 ...             │    avg win ₹1.8k · avg loss −₹2.4k   │
│  2026 +2 +1 · · · ·  (5/12 mo)    │    skew −0.31 · payoff 0.75         │
├─────────────────────────────────┴────────────────────────────────────┤
│ ANNUAL (EOY) RETURNS         │ DAILY RETURNS (profit/loss bars)        │
│  2024 ████ +14%              │  ▎▏▎█▏▎▍ … (one bar per trade-day)      │
│  2025 ██████ +21%   ‹avg›    │                                         │
└──────────────────────────────────────────────────────────────────────┘
```

- **`MonthlyHeatmap`** — `<table>` 12 cols × N year-rows; cell bg = diverging scale `color-mix(in srgb, var(--profit) {mag}%, var(--surface))` for positive, `--loss` for negative. **Missing months render as a hatched `▢` cell labelled "no data"** with the year-row footer showing _"5/12 months covered."_ Honest-empty at cell granularity.
- **`DistributionHistogram`** — Recharts `BarChart`, bars `var(--profit)`/`var(--loss)` by sign, zero reference line; caption surfaces skew + payoff ratio.
- **`AnnualBars`** — annual EOY bars + a `ReferenceLine` for the average.
- **`DailyReturnsBars`** — one bar per trade-day.

### A4b. Risk tab — the honesty headliner

```
┌────────────────────────────────────────────────────────────────────┐
│ DRAWDOWN PERIODS  (top 5 highlighted)                                │
│ 0 ─────╲      ╱──╲    ╱────                                          │
│        ╲────╱    ╲──╱       ① −22% 14d  ② −15% 9d  ③ −11% 6d         │
├──────────────────────────────────┬───────────────────────────────────┤
│ ROLLING SHARPE (60-day)           │ MONTE-CARLO DRAWDOWN CONE          │
│  ──╲╱──╲    ╱╲                    │   p95 ▒▒▒▒▒▒▒▒                      │
│      "a single Sharpe lies"       │   p50 ━━━━━━━━  95%ile DD: −31%     │
│                                   │   p5  ░░░░░░░░  ruin: 4%            │
└──────────────────────────────────┴───────────────────────────────────┘
```

- **`DrawdownPeriods`** — underwater area from `drawdown.ts`; top-5 episodes coloured + ranked with depth/duration callouts.
- **`RollingSharpe`** — `Line` with the literal subtitle _"A single Sharpe number hides regime changes."_
- **`MonteCarloCone`** — **reuse `src/lib/montecarlo/simulate.ts` + `montecarlo.worker.ts` verbatim.** Feed per-trade-day R-multiples via `extractRSamples` into the worker; render the p5/p25/p50/p75/p95 cone with the existing `<EquityCone>` as a base. Headline `worstMaxDrawdown` as _"95th-percentile drawdown: −31%"_ and `riskOfRuin` as a chip. **Gate behind `MIN_TRADES = 30`** — under that, show the honest empty state instead of a misleading cone.

### A4c. Calendar tab (India-specific — out-design AlgoTest here)

```
┌──────────────────────────┬──────────────────────────┬────────────────┐
│ DAY-OF-WEEK P&L          │ TIME-OF-DAY ENTRY P&L     │ EXPIRY SPLIT   │
│ Mon ███ +₹38k             │ 09:15 ██                  │ Expiry  ██ +52%│
│ Tue ██  +₹21k             │ 09:30 ████                │ Non-exp ████+48%│
│ Wed █   +₹9k              │ 10:00 █                   │                │
│ Thu ████ +₹61k (expiry?)  │ 14:30 ███                 │  n=88 / n=324  │
│ Fri ▼█  −₹7k              │ 15:15 ▌                   │                │
└──────────────────────────┴──────────────────────────┴────────────────┘
```

- **`DayOfWeekBars`**, **`TimeOfDayHeatmap`** (bucket entries by 15-min slots), and **`ExpiryVsNonExpiry`** — high signal for index-options traders (Thursday/Tuesday expiry effects). Each cell/bar shows `n` so low-sample slots are visibly flagged (`MIN_SAMPLE` from `analytics.ts`; below it, render greyed + "low sample").

### A4d. Payoff tab

- **`PayoffAtEntry`** — reuse `buildPayoffCurve` from `payoff.ts` over the entry-day legs; render max-profit / max-loss / breakevens / unbounded labels exactly as the trade-detail diagram does.
- **`RealisedLegOverlay`** — show the realised per-leg P&L overlaid so users see _"designed payoff vs what actually happened."_

---

## A5. Tier 3 — The Drill-down (collapsed `<Accordion>`, lazy)

### A5a. `TradeLog` — virtualized blotter (`@tanstack/react-virtual` + `react-table`)

Header label: **"Trade log (412 trading days)"** — explicitly disambiguates the AlgoTest day-as-trade convention.

```
DATE        ENTRY  EXIT   STRIKE(S)      PREMIUM  EXIT REASON   P&L      CHARGES
02 Jan 24   09:20  15:15  21800 CE/PE    ₹312     Target        +₹1,840  −₹118
03 Jan 24   09:20  11:42  21850 CE/PE    ₹298     MTM SL        −₹2,310  −₹121
04 Jan 24   09:20  15:15  21900 CE/PE *  ₹305     Time exit      +₹620   −₹117  ⚠ nearest strike
```

- Row height **48px comfortable / 40px dense** (toggle). Numbers right-aligned, `font-money`. P&L coloured. Charges from `src/lib/charges`.
- `*` + amber row tint where a substitute strike was used (requested vs served in tooltip) — coverage honesty at the row level.
- Sticky header `z-index:10`. Column sort. Click row → expands per-day leg detail inline.
- **CSV export** (minute-wise MTM) — AlgoTest parity.

### A5b. `PerLegBreakdown`

Realised P&L + win% + avg per leg (CE vs PE, by strike-selection), with the `payoff.ts` diagram beside it. Largely absent in Western tools — our differentiator for multi-leg.

### A5c. `MaeMfeScatter`

Recharts `ScatterChart`; each dot a trade-day, green = win / red = loss, X = MAE, Y = final P&L. Caption: _"Dots far left of the diagonal = your stop cut winners early."_ **Hidden until `n ≥ 30`** (honest about sample size).

### A5d. `AllMetricsTable`

The full institutional set, tucked away: Sortino, Calmar, Omega, Ulcer index, tail ratio, skew, kurtosis, VaR(95), recovery factor, max win/loss streak, profit factor, Kelly. Two-col label/value table; **never shown above the fold** so the no-code user is never overwhelmed. Source: `metrics.ts`.

---

## A6. Shareable public report card

**Route:** `/backtesting/r/[shareId]` (short, OG-friendly). The OG preview is generated server-side via Next `ImageResponse`; the page itself is a read-only, login-free render.

```
┌───────────────────────────────────────────────┐
│  thetrademarkk.com/backtesting                  │
│  ┌─────────────────────────────────────────┐  │
│  │  SHORT STRADDLE · NIFTY · 1m              │  │
│  │  02 Jan 2024 – 31 May 2026                │  │
│  │                                           │  │
│  │     ╱╲    ╱────╲   ╱──── equity curve     │  │  ← static SVG snapshot
│  │  ╱─╯  ╲──╯      ╲─╱                        │  │     (no JS needed for OG)
│  │                                           │  │
│  │  NET +₹2.4L   WIN 64%   MAX DD −22%       │  │  ← 3 headline stats only
│  │  Ret/DD 2.8×  Sharpe 1.41                 │  │
│  │                                           │  │
│  │  [▢ Coverage 82%]  [▢ 412 trade-days]     │  │  ← honesty travels with it
│  │  ⚠ Past performance ≠ future results.     │  │
│  └─────────────────────────────────────────┘  │
│  [↗ Open in builder & tweak]  [Run your own]   │  ← acquisition CTAs
└───────────────────────────────────────────────┘
```

**Rules.**

- Only **3–5 stats** (Composer factsheet discipline).
- The `CoverageBadge` and the past-performance disclaimer are **mandatory and cannot be cropped out** — they're part of the share frame, not the report body.
- CTA **"Open in builder & tweak"** deep-links to a pre-filled builder (fork-and-modify, Composer's winning on-ramp).
- The `opengraph-image.tsx` `ImageResponse` mirrors the same headline stats + coverage badge so the Twitter / WhatsApp preview is itself honest.
- `ShareCardActions` handles copy-link / open-in-builder / run-your-own.

---

## A7. Mobile layout (<640px, mobile-first PWA)

Single column, everything stacks. Tier-2 tabs become a horizontally-scrollable segmented control; charts get a "tap to expand" → modal **bottom sheet** (`#000`/20% scrim, ≤16:9 initial height, drag handle + tap-out + X) for full-screen inspection.

```
┌──────────────────────┐
│ ‹  Short Straddle  ⋯ │
├──────────────────────┤
│ ✓ Profitable, 22% DD │
│ [Cov 82%][412 days]  │
│ ┌────────┬─────────┐ │
│ │NET P&L │ WIN %   │ │  ← 2-col stat grid
│ │₹2.4L ▲ │ 64.2%   │ │     (3 rows = 6 cards)
│ ├────────┼─────────┤ │
│ │RET/DD  │ MAX DD  │ │
│ │ 2.8×   │ −22.1%  │ │
│ ├────────┼─────────┤ │
│ │EXPECT. │ SHARPE  │ │
│ │₹620/d  │ 1.41    │ │
│ └────────┴─────────┘ │
│ ┌──────────────────┐ │
│ │ equity ╱╲╱──     │ │  ← hero, tap → sheet
│ │ ░░▒▒░░▓▓░░         │ │
│ └──────────────────┘ │
│ [Returns|Risk|Cal|▸] │  ← scrollable tabs
│ ...                  │
└──────────────────────┘
```

The **trade-log blotter on mobile** drops to a card-per-day list (not a wide table) inside the accordion; columns collapse to `Date · P&L · reason`, expand-on-tap for the rest.

---

## A8. Empty / low-coverage / error states (the patchy-data reality)

Three explicit, distinct states — **never a blank chart.**

### A8.1. Valid run, low coverage (the common case)

Chart still renders from available strikes, topped by an amber `CoverageBadge` and an inline `CoverageNote`:

> _"Nearest available strike used on 88 of 412 days (requested 22500 → served 22550). Affected days marked ⚠ in the log."_ CTA: **"See affected dates."**

Heatmaps use `EmptyState`-style hatched cells for missing months.

### A8.2. Run produced no trades

(filters too tight / strike never available) — `EmptyState` icon + copy:

> _"This strategy never found a tradeable entry — every requested strike was missing in {range}. Try a nearer-ATM offset or a covered expiry."_ CTA: **"Edit strikes."**

### A8.3. Compute error

(Pyodide / duckdb fault) — **component-level error boundary (`AsyncBoundary` → `ResultsErrorBoundary`), not full-page.** One bad slice degrades a single card with a `Retry` button. Translate the raw traceback into a plain card:

> _"Couldn't load the 22500 CE slice. This strike isn't in the dataset."_

### A8.4. Below `MIN_TRADES` (30)

Monte-Carlo, MAE/MFE, and Sharpe-derived chips are **suppressed** with _"Need 30+ trade-days for this to be meaningful,"_ via `LowSampleGuard` — never shown misleadingly.

### A8.5. Standing footer disclaimer (always visible, not dismissible)

> **"Backtests are hypothetical, use historical data with patchy options coverage, and exclude liquidity/impact beyond modelled slippage. Past performance is not indicative of future results."**

---

---

# Part B — Run + Notify experience

## B0. Mental model & the three execution lanes

A "run" is one of two engines, but the **RUN+NOTIFY surface is identical** for both — the user never learns two patterns.

| Engine                                                                                            | Where it runs     | Cost    | Notify path                                            |
| ------------------------------------------------------------------------------------------------- | ----------------- | ------- | ------------------------------------------------------ |
| **No-code builder** (DuckDB-WASM resolves slices → deterministic JS/TS simulator in a Web Worker) | Client, always    | $0      | Local — instant, never needs email                     |
| **BYOC Python** (Pyodide + duckdb-wasm)                                                           | Client by default | $0      | Local — instant                                        |
| **Server tier** (future paid: Vercel Sandbox microVM, deny-all network)                           | Server            | metered | `after()` + Resend + `notifications` row + client poll |

The brief's hard rule — **never gate login to run** — shapes everything below: the run completes client-side for the 99% case, so "notify" is really two distinct experiences:

- **CLIENT run (default):** there is nothing to notify across devices — the worker is in _this_ tab. "Notify" degenerates into: keep computing if the user collapses the modal, and surface a **toast + results-ready pulse** when they're elsewhere in the app. No bell row, no email (unless they explicitly opt into "email me a copy").
- **SERVER run (opt-in, login-required):** the genuine fire-and-forget case. Close the laptop, get a bell notification + email with a deep link.

Design both. **Lead with the client case** because it's the common one; make the server case feel like a natural extension, not a different product.

---

## B1. RUN states — the state machine

One canonical status enum, mirrored from `SimStatus` (`idle | running | done | error`) but widened for the backtest domain. This drives the modal, the toast, the bell, and the results page identically.

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
  idle ──Run──▶ validating ──ok──▶ booting ──▶ resolving-data ──▶ simulating ──▶ aggregating ──▶ done
                    │                  │              │                │              │            │
                    │ invalid-combo    │ wasm-fail    │ no-data        │ run-error    │            │
                    ▼                  ▼              ▼                ▼              │            │
                error:invalid     error:engine   empty:no-coverage  error:runtime    │            │
                                                       │                              │            │
                                                       └── degraded (nearest-strike) ─┘            │
                                                                                                   ▼
                                                                                       partial ──▶ done
```

State definitions (the literal `BacktestStatus` union):

- **`validating`** — synchronous, pre-flight. Lot sizes (NIFTY 75 / BANKNIFTY 35 / SENSEX 20), date-range sanity, ≥1 leg, expiry exists in the dataset manifest. ~0–50ms. Catches `error:invalid` before any heavy work.
- **`booting`** — one-time-ish runtime warm-up. No-code: spin the worker (~instant). BYOC: **Pyodide cold-start (the multi-second wait)** + duckdb-wasm init. The only genuinely slow non-compute phase → dedicated reassuring copy.
- **`resolving-data`** — duckdb-wasm range-reads the narrow `timestamp+strike` parquet slice from HF. Emits **coverage telemetry**: requested vs served strikes, coverage %, which expiries hit. This is where `empty:no-coverage` or `degraded` is decided.
- **`simulating`** — the per-bar / per-trade loop. Emits the live progress payload (below). The long pole for big date ranges.
- **`aggregating`** — compute metrics, drawdown, Monte-Carlo cone (reuse `src/lib/montecarlo`), charges (`src/lib/charges`). Fast.
- **`partial`** — _optional optimistic state._ Results renderable but a deferred tier (MC cone, MAE/MFE) still computing. Lets us show the equity curve the instant the sim loop ends.
- **`done`** — terminal success.
- **Error/empty terminals:** `error:invalid`, `error:engine`, `empty:no-coverage`, `error:runtime`. Each gets a bespoke, actionable surface ([B6](#b6-error--empty-states--the-differentiator)).

### B1.1. The live progress payload (worker → UI contract)

Extend the worker message protocol beyond `WorkerResponse`'s terminal `ok/error` with **progress ticks**. This is the single most important data contract in the spec — it's what makes "running" show _real work_, not a fake spinner.

```ts
// src/features/backtesting/engine/messages.ts
export type BacktestProgress = {
  id: number; // request id — supersession, same as useMonteCarlo
  phase: "booting" | "resolving-data" | "simulating" | "aggregating";
  // ── real-work counters (the trust signal) ──
  daysTotal: number; // trading days in range
  daysDone: number;
  barsDone: number; // 1-min bars processed
  tradesFound: number; // entries taken so far
  // ── live preview metric (optional, cheap) ──
  runningPnlR?: number; // running MTM in ₹, drives the live ticker
  // ── coverage, surfaced AS IT resolves ──
  coverage?: { requested: number; served: number; pct: number; nearestUsed: number };
  // ── timing ──
  etaMs?: number | null; // null until we have ≥2 ticks to extrapolate
};

export type BacktestTick =
  | { kind: "progress"; data: BacktestProgress }
  | { kind: "partial"; id: number; result: PartialResult } // optimistic render
  | { kind: "done"; id: number; result: BacktestResult }
  | { kind: "empty"; id: number; reason: EmptyReason; suggestion?: NearestStrike }
  | { kind: "error"; id: number; error: BacktestError };
```

**Tick cadence.** Throttle to **≤1 progress post / 100ms** (rAF-aligned on the UI side) — matching QuantConnect's "rate-limit debug spam to once/second" but tighter for a smooth bar. The worker batches counters between posts. **Never post per-bar** — that floods `postMessage`.

**ETA algorithm.** After the 2nd tick, `etaMs = (daysTotal − daysDone) * msPerDay_ewma`, where `msPerDay_ewma` is an exponentially-weighted moving average (α = 0.3) of recent per-day wall time. Show ETA only once it stabilises (≥3 ticks); before that show **"Estimating…"**. Round display to human buckets (`~8s left`, `under a minute`, `~2 min`). **Never** show a precise countdown that jitters — that destroys trust faster than no ETA.

### B1.2. The run hook

`useBacktest` is a near-clone of `useMonteCarlo` (request-id supersession, lazy worker, synchronous-fallback, terminate-on-unmount) with the progress channel added:

```ts
export interface UseBacktest {
  status: BacktestStatus;
  progress: BacktestProgress | null; // live, replaced each tick
  result: BacktestResult | null; // populated on partial → done
  error: BacktestError | null;
  empty: { reason: EmptyReason; suggestion?: NearestStrike } | null;
  run: (input: BacktestInput) => void; // bumps reqId; cancels in-flight
  cancel: () => void; // terminate + reqId bump → ignore late posts
}
```

**Crucial:** the worker keeps running when the modal closes. The hook lives in a **context provider mounted at the backtesting-area layout**, not in the modal component. Closing the modal unmounts the _modal_, not the hook. That's what makes "close and come back" work for client runs without any server.

---

## B2. The RUNNING modal — primary surface

A centered modal (desktop) / full-height bottom sheet (mobile — modal sheet, scrim `#000`/20%, drag-handle + X). It opens the instant **Run** is pressed and transitions through phases in place. **No layout reflow between phases** — phase changes swap content inside a fixed-height frame so the modal never jumps.

### B2.1. Desktop wireframe — `simulating` phase

```
┌────────────────────────────────────────────────────────────────────┐
│  Running backtest                                          [ — ] [×] │  ← — = minimize to toast, × = cancel
├────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Short Straddle · NIFTY · 1m · 01 Jan 2024 – 31 May 2026            │  ← strategy chip line (echoes the build)
│                                                                      │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │ ████████████████████████████░░░░░░░░░░░░░░░░░  64%           │   │  ← progress bar, accent fill, decelerate ease
│   └────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   Simulating trades…                                  ~9s left       │  ← phase label (left) · ETA (right, tabular nums)
│                                                                      │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│   │  312 / 488   │  │    1.24M     │  │     147      │              │  ← LIVE COUNTERS — the trust signal
│   │ trading days │  │  bars read   │  │ trades found │              │     each number rolls/ticks up (not snaps)
│   └──────────────┘  └──────────────┘  └──────────────┘              │
│                                                                      │
│   ┌────────────────────────────────────────────────────────────┐   │
│   │  Running MTM                                                 │   │  ← OPTIONAL live sparkline of running P&L
│   │      ╱╲      ╱╲╱╲                                            │   │     draws left→right as days process;
│   │  ╱╲╱  ╲╱╲╱╲╱     ╲╱╲    ₹ +18,240  ▲                         │   │     this is the "Composer real-time feedback"
│   └────────────────────────────────────────────────────────────┘   │     borrowed for the running state
│                                                                      │
│   ◇ Coverage 82% · using nearest strike on 14 days   [details ▾]    │  ← coverage chip, honest, appears once known
│                                                                      │
│   You can close this — we'll keep computing and ping you when done.  │  ← reassurance line (client run copy)
│                                                                      │
│              [ Run in background ]            [ Cancel ]             │
└────────────────────────────────────────────────────────────────────┘
```

**The live counters are the heart of the running experience.** They answer _"is this actually doing something, or hung?"_ — the #1 anxiety. Numbers **roll** (interpolate) toward their target on each tick rather than snapping, using a spring (`stiffness: 235, damping: 10`) on the displayed value. Use `font-money` / `tabular-nums` so digits don't reflow as they tick.

**Progress bar** uses the **decelerate curve** `cubic-bezier(0, 0, 0.2, 1)` and animates `width` toward the true `daysDone/daysTotal` ratio over ~250ms per update, so a burst of ticks reads as smooth acceleration, not strobing. **Never let it go backwards;** if a new phase resets the denominator, the bar holds and the label changes.

**Phase-specific copy** (replaces "Simulating trades…"):

| Phase               | Copy                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `booting` (no-code) | "Spinning up the engine…"                                                                                                                                                |
| `booting` (BYOC)    | **"Loading Python in your browser… (first run takes a few seconds)"** — name the cold-start so the wait feels intentional. Show an indeterminate shimmer bar (no % yet). |
| `resolving-data`    | "Pulling NIFTY 01 Jan 2024 – 31 May 2026 from the dataset…"                                                                                                              |
| `simulating`        | "Simulating trades…"                                                                                                                                                     |
| `aggregating`       | "Crunching results & risk…"                                                                                                                                              |

### B2.2. Cancel vs Run-in-background — two distinct affordances

- **`[ Cancel ]` / `[×]`** — `cancel()`: terminate the worker, bump reqId, discard. **Confirm only if `>50%` done** ("Cancel this run? Progress will be lost.") via an inline 2-button swap inside the footer — never a nested dialog.
- **`[ Run in background ]` / `[ — ]`** — collapses the modal to a docked **mini-progress pill** ([B3](#b3-backgrounded-run--the-docked-mini-pill)) and lets the user keep building or browse the area. The worker is untouched. This is the client-run "notify" — the work was never going anywhere, we just got out of the way.

### B2.3. Mobile bottom-sheet wireframe — `simulating`

```
        ╭─────────────────────────╮
        │           ▔▔▔            │  ← drag handle
        │  Running backtest    [×] │
        ├─────────────────────────┤
        │ Short Straddle · NIFTY   │
        │ 1m · Jan'24–May'26       │
        │                          │
        │ ███████████░░░░  64%     │
        │ Simulating…    ~9s left  │
        │                          │
        │  ┌──────┐ ┌──────┐       │
        │  │312/488│ │ 147  │      │  ← 2 counters on mobile (bars hidden,
        │  │ days  │ │trades│      │     least useful on small screen)
        │  └──────┘ └──────┘       │
        │                          │
        │ ◇ Coverage 82%           │
        │                          │
        │ Close — we'll ping you   │
        │ when it's done.          │
        │                          │
        │ [Run in background]      │
        │ [Cancel]                 │
        ╰─────────────────────────╯
```

### B2.4. Skeletons during `aggregating` → `done`

When `simulating` ends, **do not spin.** Transition the modal into the results layout with **skeletons** for each result card (shimmer placeholders sized to the real cards — equity hero, stat strip, MC cone), then crossfade real content in as `partial`/`done` arrive. This is the "skeletons reduce perceived load ~20–30% vs spinner" principle, and it makes the running→results handoff feel like an **arrival**, not a reload. Skeletons **only on structured cards** (hero chart, stat strip, tables) — never on freeform text.

---

## B3. Backgrounded run — the docked mini-pill

When the user hits **Run in background** (or **—**), the modal **morphs** (shared-layout transition, `layoutId="run-surface"`) into a compact pill docked **bottom-right** (desktop) / **above the bottom nav** (mobile). Persists across the whole backtesting area via the layout-level provider.

```
Desktop, bottom-right:
                                          ┌─────────────────────────────────┐
                                          │ ◐ Short Straddle · 64%   [↗] [×] │  ← ◐ = animated phase ring
                                          │   ████████████░░░░  ~9s          │     ↗ = re-expand modal
                                          └─────────────────────────────────┘     × = cancel

On done:
                                          ┌─────────────────────────────────┐
                                          │ ✓ Short Straddle — done   [View] │  ← turns profit-green, gentle pulse
                                          │   +12.4% · 488 days · DD 6%      │     auto-dismiss after 12s → bell
                                          └─────────────────────────────────┘
```

- The phase ring **◐** is an SVG `stroke-dashoffset` arc animating to `daysDone/daysTotal`, accent-colored, with a slow rotation during `booting`/indeterminate phases.
- On **done**, the pill recolors to `--profit`, shows the headline verdict (return %, days, max DD), gives a primary **`[View]`** button, and emits a **toast** ([B4](#b4-toast--the-results-are-ready-moment)) + a **bell entry** ([B5](#b5-in-app-bell-notification)). It auto-collapses after 12s but the bell entry persists.
- On **error/empty**, the pill turns `--loss` / amber and the button becomes **`[See what happened]`** opening the error surface ([B6](#b6-error--empty-states--the-differentiator)).

---

## B4. Toast — the "results are ready" moment

Triggered when a run reaches `done`/`error`/`empty` **and** the running modal is not focused/open (i.e. the user backgrounded it or navigated away). Bottom-center desktop, top below header on mobile. Uses the same toast primitive as the rest of the app.

```
┌──────────────────────────────────────────────────────┐
│ ✓  Backtest ready — Short Straddle              [View] │   ← success: profit-tinted left border
│    +12.4% · Return/DD 2.1 · 488 trade-days             │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│ ◇  No data for that selection            [Fix it]      │   ← empty: amber left border
│    NIFTY 22500 CE 26-Jun isn't in the dataset          │
└──────────────────────────────────────────────────────┘
```

- **Slide+fade in** with decelerate `cubic-bezier(0, 0, 0.2, 1)` @ 250ms; exit with accelerate `cubic-bezier(0.4, 0, 1, 1)` @ 195ms (shorter exits, per Material).
- Success toast **auto-dismisses after 6s**; error/empty toasts are **sticky** (require dismiss or action) — you never want a user to miss why their run produced nothing.
- **`[View]`** deep-links to the result ([B7](#b7-deep-linking-back-to-results)). Clicking marks the matching bell entry read.
- Respect `prefers-reduced-motion`: opacity-only, no slide.

---

## B5. In-app bell notification

### B5.1. Schema — reuse `notifications`, add a `backtest` type

The existing `notifications` table is type-agnostic (`type` is free text; `postId`/`commentId` nullable). **Add one column** rather than a new table, so the bell, grouping, and mark-read API all work unchanged:

```sql
ALTER TABLE notifications ADD COLUMN backtest_id TEXT;  -- nullable, FK-by-convention to backtest_runs.id
```

Add `"backtest"` to the `NotificationView["type"]` union and a verb to the `VERBS` map in `notifications.ts`:

```ts
const VERBS = {
  like: "liked your post",
  // …
  backtest: "Your backtest finished", // self-authored: actor === recipient
};
```

Backtest notifications are **self-authored** (`actorId === userId`), so `groupActorLabel` is **bypassed** for this type — render the strategy name instead of an actor name. The grouping key stays `type|postId|read`; with `postId` null and distinct `backtest_id`, each finished run is its own row (good — you don't want "you and 3 others ran a backtest"). The `notification-row` component branches on `type === "backtest"` to render the verdict micro-strip and link to `/backtesting/runs/{backtest_id}` instead of a post.

### B5.2. When does a bell row get created?

| Run type                                | Bell row?                                                                                              | Email?                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Client run, user stayed in modal        | **No** (modal already showed result)                                                                   | No                                        |
| Client run, user backgrounded/navigated | **Yes** — created client-side via `POST /api/backtesting/notifications` on `done`, _only if logged in_ | Only if user opted into "email me a copy" |
| Anonymous client run                    | **No** bell (no account). Toast + pill only.                                                           | No                                        |
| Server run (always logged-in)           | **Yes** — created server-side in `after()`                                                             | Yes, via Resend                           |

For anonymous users the bell is hidden (matches `NotificationsBell` returning `null` without a session). Their notify surface is purely the in-tab toast/pill — acceptable because client runs finish in seconds and the result is right there. The login nudge appears in the results view (_"Sign in to save this run & get notified next time"_).

### B5.3. Bell row wireframe (the `backtest` variant)

```
┌────────────────────────────────────────────────────┐
│ Notifications                          Mark all read │
├────────────────────────────────────────────────────┤
│ ▣  Short Straddle finished              · 2m         │  ← ▣ = chart-glyph avatar instead of user avatar
│    +12.4% · DD 6% · 488 days                profit▲  │     unread = accent left-bar + bg tint
├────────────────────────────────────────────────────┤
│ ◇  Iron Condor — no data for selection  · 1h         │  ← amber glyph for empty/error outcomes
│    SENSEX 26-Jun coverage too low                    │
├────────────────────────────────────────────────────┤
│ ❤  Asha and Vik liked your post         · 3h         │  ← existing community rows, unchanged, interleaved
└────────────────────────────────────────────────────┘
        View all notifications
```

Unread badge increments via the existing TanStack-Query `useNotifications` poll. Opening a backtest row marks it read (existing `markRead.mutate(g.ids)`) and routes to `/backtesting/runs/{id}`.

---

## B6. Error & empty states — the differentiator

Per the brief, honest missing-data handling is where we beat all five competitors. **Three distinct, never-blurred states**, each with a dedicated visual and a concrete next action. **Never dump a raw Pyodide/DuckDB traceback.**

### B6.1. `error:invalid` — caught in `validating`, before any work

Inline, in the builder Review step (doesn't even open the run modal). Field-level, plain-language:

```
┌────────────────────────────────────────────────────────────┐
│  ⚠  Can't run yet                                            │
│                                                              │
│  • Leg 2 lots must be a multiple of 35 (BANKNIFTY lot size). │  ← maps lot-size rule
│  • End date is before start date.                            │
│  • Exit time (09:15) is before entry time (09:25).           │
│                                                              │
│  Fix these and Run again.                          [Got it]  │
└────────────────────────────────────────────────────────────┘
```

### B6.2. `empty:no-coverage` — valid run, no data (THE most important state)

This is the patchy-strike reality. Make it reassuring and **actionable with a one-tap fix**, never a dead end. **Amber treatment, not red** — nothing is "broken."

```
┌────────────────────────────────────────────────────────────────────┐
│                          ◇                                           │
│              No data for that selection                              │
│                                                                      │
│   SENSEX 80500 CE for the 26-Jun expiry isn't in the dataset.        │
│   This strike was never captured — it's not an error.                │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐ │
│   │  Nearest available strike: 80400 CE   (71% coverage)   [Use →] │ │  ← one-tap swap & re-run
│   └──────────────────────────────────────────────────────────────┘ │
│                                                                      │
│   Or:  [ Widen date range ]   [ Pick from coverage map ]            │  ← coverage heatmap picker
│                                                                      │
│   ◇ Why does this happen?  Options data is ~40–68% complete; we      │  ← honest, educational disclosure
│     show coverage up front so you never chase an empty strike.       │
└──────────────────────────────────────────────────────────────────────┘
```

The **`[Use →]`** button rewrites that leg's strike and immediately re-runs — collapsing the entire "why is it empty / what do I do" loop into one click. The nearest-strike + coverage % come straight from the `resolving-data` telemetry, so this is data we already have.

### B6.3. `degraded` — ran successfully, but on substituted/sparse strikes

**Not an error state** — results render normally, but a **persistent coverage banner** sits atop the results and a per-day coverage strip is available. This is the "honesty chip" from the results screen, carried into the run flow.

```
┌────────────────────────────────────────────────────────────────────┐
│ ◇ Ran on nearest-available strikes for 14 of 488 days (82% coverage).│
│   Treat these results as indicative.        [See affected dates ▾]   │
└────────────────────────────────────────────────────────────────────┘
```

### B6.4. `error:engine` & `error:runtime` — something actually broke

- **`error:engine`** (Worker won't build / WASM failed / OOM): _"We couldn't start the engine in this browser."_ Offer **`[Retry]`** and, for BYOC OOM on a huge range, _"Try a shorter date range or the (coming) server run."_ The `useMonteCarlo` synchronous-fallback pattern applies for the no-code engine.
- **`error:runtime`** (BYOC user code threw): **translate the traceback.** Show a plain-English card with the mapped cause on top, the offending API symbol linked to its doc card (Pine Ctrl-Click idea reused for errors), and the **raw traceback collapsed** behind "Show details" for the technical user. Don't blindly trust the line number — show ±2 lines of context.

```
┌────────────────────────────────────────────────────────────────────┐
│  ⚠  Your strategy hit an error while running                         │
│                                                                      │
│  KeyError: 'close'  on line 23                                       │
│  → The column is called `c`, not `close`, in our 1-minute frame.     │  ← translated, domain-aware
│    Try:  df["c"]    [open data reference]                            │
│                                                                      │
│  ▸ Show full traceback                                               │  ← collapsed raw Pyodide trace
│                                                  [Edit code] [Retry] │
└────────────────────────────────────────────────────────────────────┘
```

All four error/empty surfaces also fire the **sticky toast** + (if logged-in) a **bell row** with the amber glyph, so a backgrounded failure is never silently lost.

---

## B7. Deep-linking back to results

Every server run and every saved client run gets a canonical URL:

```
/backtesting/runs/{runId}               ← canonical result page (server-rendered shell + client hydration)
/backtesting/runs/{runId}?from=email    ← attribution
```

- **Bell row, toast `[View]`, email CTA, and pill `[View]`** all route here.
- For **server runs**, the page reads `backtest_runs` (status, result blob/pointer). If a user opens the link while status is still `running`, the page shows the **same running surface** (progress reconstructed from the latest `progress_snapshot` column + client polling) — so a deep-link mid-run is graceful, not a 404 or empty page.
- For **client runs**, results live in memory / IndexedDB. **"Save"** (login-gated) persists a row so the link survives a refresh. Until saved, the deep-link is in-session only and the page falls back to _"This run wasn't saved — [Re-run it]"_ using the persisted strategy JSON (we already autosave the builder to `localStorage`).
- **Polling:** client polls `GET /api/backtesting/runs/{id}` every **3s while `running`**, backing off to 10s after 60s, stopping on terminal status. On a `focus` event, poll immediately.

### B7.1. Server-run lifecycle (the genuine fire-and-forget)

```
POST /api/backtesting/runs                       rateLimit("bt-run:"+userId, 5, 60)  ← reuse rate-limit infra
  │  security-check user code (server tier only)
  │  INSERT backtest_runs {status:'running', progress_snapshot, ...}
  │  ── inline attempt up to 300s ──
  │     run in Vercel Sandbox microVM (deny-all network)
  │     write progress_snapshot every ~2s (powers deep-link mid-run)
  ├─ finishes <300s → status:'done', then:
  │     after(() => { insert notifications row; sendEmail(...) })   ← Next.js after()
  └─ could exceed 300s → enqueue Upstash QStash job; status stays 'running';
        QStash callback finalizes + after()-style notify
```

The `notifications` row is inserted server-side in `after()`; the email goes through the existing `sendEmail` + `emailLayout`, throttled like other transactional mail.

### B7.2. The email

Built with the existing `emailLayout(title, body, ctaText, ctaUrl)` — keeps the brand shell (`#0A0A0B` bg, `#FAFAFA` text, `#8B5CF6` button) for free.

```
Subject:  ✓ Your backtest is ready — Short Straddle (+12.4%)

┌──────────────────────────────────────────┐
│  TradeMarkk                                │
│  Your backtest is ready                    │   ← title
│                                            │
│  Short Straddle on NIFTY                   │   ← body (HTML)
│  01 Jan 2024 – 31 May 2026 · 1-min         │
│                                            │
│  Return        +12.4%                      │   ← 4-metric verdict strip,
│  Return / DD    2.1                        │      the same headline trio
│  Max drawdown   6.0%                        │      as the results hero
│  Trade-days     488                        │
│                                            │
│  ◇ Ran on nearest strikes for 14 days       │   ← coverage honesty carries into email
│    (82% coverage).                          │
│                                            │
│      [  View full results  ]               │   ← ctaUrl = /backtesting/runs/{id}?from=email
│                                            │
│  Past performance ≠ future results.        │   ← mandatory disclaimer in every result email
│  Mark your trade, every day.               │
└──────────────────────────────────────────┘
```

Error/empty server runs email too, with an amber subject (`◇ Your backtest found no data — Iron Condor`) and a CTA to the fix-it state. **Email is opt-in by default for server runs** (you launched it precisely to walk away) and an **opt-in checkbox for client runs** (_"Email me a copy when done"_).

---

## B8. Streaming / partial results

Two layers of progressive reveal, both already enabled by the tick protocol:

1. **During the run (in-modal):** the **running-MTM sparkline** ([B2.1](#b21-desktop-wireframe--simulating-phase)) and the **trades-found counter** are a genuine live preview — they draw as days process. This is the Composer "real-time feedback as you change the strategy" feel, adapted to a single run. Cheap: the worker already has the running equity; it just posts a downsampled point every tick.
2. **At completion (`partial` → `done`):** emit `partial` the instant the **sim loop** ends — equity curve, stat strip, trade blotter are renderable. The expensive **Monte-Carlo cone** (10k paths via `src/lib/montecarlo`) and **MAE/MFE scatter** compute in a follow-up `aggregating` pass and stream in behind their own skeletons. The user sees the verdict in ~half the total time; the deep-tier charts fill in under shimmer.

Optimistic UI is used **only** for save / share / bookmark of a finished run (React 19 `useOptimistic`) — **never** for the computed result itself (results are computed, not asserted).

---

---

# Cross-cutting

## C9. Motion-design language

House tokens already exist (`cubic-bezier(0.21, 0.65, 0.36, 1)` as the signature ease; view-transition `cubic-bezier(0.4, 0, 0.2, 1)` @ 400ms; a global `prefers-reduced-motion` guard at `globals.css`). **Extend with named tokens** in the `@theme inline` block of `globals.css` so ~80% of run-flow + results motion reuses them:

```css
@theme inline {
  /* easing */
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1); /* most on-screen movement */
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1); /* entrances: modal, toast, panels */
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1); /* exits: dismiss, close */
  --ease-signature: cubic-bezier(0.21, 0.65, 0.36, 1); /* existing house curve, hero reveals */
  /* durations */
  --dur-fast: 150ms;
  --dur-base: 200ms;
  --dur-mobile: 300ms;
  --dur-large: 375ms;
}
```

Framer Motion spring for direct-manipulation + counters: `{ type: "spring", stiffness: 235, damping: 10, mass: 1 }`.

### Results screen motion

| Element                       | Motion                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------- |
| Verdict band on arrival       | `slide-up` (existing keyframe), 250ms decelerate; stat cards stagger 40ms each    |
| StatCard numbers              | NumberFlow rolls 0 → value, 600ms, on first viewport entry (IntersectionObserver) |
| Quality chips                 | fade + scale-in, spring `{stiffness:235, damping:10}`, staggered                  |
| Equity curve draw             | path `pathLength` 0→1, 700ms decelerate (the "reveal" feel)                       |
| Tab switch                    | content cross-fade 150ms; underline indicator springs                             |
| Tier-3 accordion              | height auto 250ms standard ease                                                   |
| Builder → Results transition  | under 375ms so it reads as _arrival_, not reload                                  |
| Chart → bottom-sheet (mobile) | sheet springs up from bottom, scrim fades 200ms                                   |

### Run/notify motion

| Element                   | Property                                        | Easing / spring         | Duration                                        |
| ------------------------- | ----------------------------------------------- | ----------------------- | ----------------------------------------------- |
| Run modal open            | opacity + scale 0.96→1 + translateY 8→0         | `--ease-decelerate`     | `--dur-base` (200ms)                            |
| Run modal close           | opacity + scale 1→0.98                          | `--ease-accelerate`     | 150ms                                           |
| Phase content swap        | crossfade (no height change)                    | `--ease-standard`       | `--dur-fast`                                    |
| Progress bar fill         | width                                           | `--ease-decelerate`     | 250ms per update                                |
| **Live counters**         | displayed value interpolate                     | **spring 235/10**       | —                                               |
| Phase ring (pill)         | `stroke-dashoffset`                             | `--ease-standard`       | 300ms; slow spin when indeterminate             |
| Modal → pill (background) | shared `layoutId="run-surface"`                 | spring 235/10           | —                                               |
| Running-MTM sparkline     | path draw (`pathLength` 0→1 of new segment)     | `--ease-standard`       | per-tick, ~120ms                                |
| **running → results**     | crossfade modal body → results, skeletons first | `--ease-signature`      | `--dur-large` (375ms) — feels like an _arrival_ |
| Toast in / out            | translateY + opacity                            | decelerate / accelerate | 250ms / 195ms                                   |
| Bell badge increment      | scale 1→1.25→1 (pop)                            | spring                  | —                                               |
| Pill done recolor         | bg accent→profit + 1 gentle pulse               | `--ease-standard`       | 300ms                                           |

**Discipline rules.** Never exceed ~400ms for anything frequently seen; exits are always shorter than entrances; the only spring-physics motion is direct-manipulation feedback (counters, the modal↔pill morph, badge pop) — entrances/exits stay duration-based.

**`prefers-reduced-motion`.** Counters **snap** to value (no roll), the sparkline draws instantly, NumberFlow snaps, path-draws snap, all slides become opacity-only; the existing global `0.01ms` guard handles the rest. Honor it everywhere — the running modal is high-frequency and a strobing bar would be hostile.

---

## C10. Component & build inventory

### Results screen — new components (`src/features/backtesting/results/components/`)

- Orchestration: `ResultsPage` (lazy tab mounting) · `RunHeader` · `LoginNudgeSheet`
- Verdict: `VerdictHeadline` · `QualityChipRow` · `CoverageBadge` (exported, reused everywhere) · `VerdictStatStrip`
- Hero: `HeroEquityChart` · `BenchmarkComparePopover`
- Tabs: `ReturnsTab` (`MonthlyHeatmap`, `DistributionHistogram`, `AnnualBars`, `DailyReturnsBars`) · `RiskTab` (`DrawdownPeriods`, `RollingSharpe`, `MonteCarloCone`) · `CalendarTab` (`DayOfWeekBars`, `TimeOfDayHeatmap`, `ExpiryVsNonExpiry`) · `PayoffTab` (`PayoffAtEntry`, `RealisedLegOverlay`)
- Drill-down: `TradeLog` (virtualized) · `PerLegBreakdown` · `MaeMfeScatter` · `AllMetricsTable`
- Share: `app/(public)/backtesting/r/[shareId]/page.tsx` + `opengraph-image.tsx` (`ImageResponse`) + `ShareCardActions`
- States: extend shared `EmptyState`; new `CoverageNote`, `LowSampleGuard`, `ResultsErrorBoundary` (`AsyncBoundary`)

### Run/notify — new files (all absolute, following existing conventions)

- `c:\Users\raash\Desktop\trading-journal\src\features\backtesting\engine\messages.ts` — `BacktestProgress` / `BacktestTick` / `BacktestStatus` / `BacktestError` / `EmptyReason` contracts ([B1.1](#b11-the-live-progress-payload-worker--ui-contract)).
- `c:\Users\raash\Desktop\trading-journal\src\features\backtesting\engine\backtest.worker.ts` — clone of `montecarlo.worker.ts`, posts progress ticks.
- `c:\Users\raash\Desktop\trading-journal\src\features\backtesting\hooks\use-backtest.ts` — clone of `use-monte-carlo.ts` + progress channel + `cancel()` ([B1.2](#b12-the-run-hook)); mounted via a layout-level provider so it survives modal close.
- `c:\Users\raash\Desktop\trading-journal\src\features\backtesting\components\run-modal.tsx`, `run-pill.tsx`, `run-counters.tsx`, `running-sparkline.tsx`, `empty-no-coverage.tsx`, `coverage-banner.tsx`, `runtime-error-card.tsx` ([B2](#b2-the-running-modal--primary-surface), [B3](#b3-backgrounded-run--the-docked-mini-pill), [B6](#b6-error--empty-states--the-differentiator)).
- `c:\Users\raash\Desktop\trading-journal\src\app\backtesting\runs\[runId]\page.tsx` — deep-link result page incl. mid-run reconstruction ([B7](#b7-deep-linking-back-to-results)).
- `c:\Users\raash\Desktop\trading-journal\src\app\api\backtesting\runs\route.ts` + `[id]\route.ts` — server-run create/poll, `rateLimit("bt-run:"+userId,5,60)`, `after()` notify ([B7.1](#b71-server-run-lifecycle-the-genuine-fire-and-forget)).
- `c:\Users\raash\Desktop\trading-journal\src\app\api\backtesting\notifications\route.ts` — client-run bell insert (logged-in only) ([B5.2](#b52-when-does-a-bell-row-get-created)).
- `c:\Users\raash\Desktop\trading-journal\src\features\backtesting\email\run-ready-email.ts` — wraps `emailLayout` ([B7.2](#b72-the-email)).

### Edit, minimal

- `c:\Users\raash\Desktop\trading-journal\src\server\db\platform-schema.ts` — `notifications.backtestId = text("backtest_id")`; new `backtestRuns` table (`id`, `userId`, `status`, `strategyJson`, `progressSnapshot`, `resultBlob`/pointer, `coveragePct`, `createdAt`, `finishedAt`).
- `c:\Users\raash\Desktop\trading-journal\src\features\community\notifications.ts` — add `backtest` to `VERBS` + `NotificationView["type"]`; self-authored bypass in `groupActorLabel`.
- `c:\Users\raash\Desktop\trading-journal\src\features\community\components\notification-row.tsx` — `type === "backtest"` branch (verdict micro-strip, route to `/backtesting/runs/{id}`).
- `c:\Users\raash\Desktop\trading-journal\src\styles\globals.css` — add the named easing/duration tokens ([C9](#c9-motion-design-language)).

### New pure-math modules (unit-testable, mirror existing `src/lib` style)

- `c:\Users\raash\Desktop\trading-journal\src\lib\backtest\metrics.ts` — Sharpe / Sortino / Calmar / Omega / Ulcer / expectancy / profit-factor / streaks / VaR over the trade-day series.
- `c:\Users\raash\Desktop\trading-journal\src\lib\backtest\drawdown.ts` — underwater series + top-5 episodes.
- `c:\Users\raash\Desktop\trading-journal\src\lib\backtest\coverage.ts` — requested-vs-served strike accounting → the `coverage %` driving every badge.

### Reuse as-is (no new UI)

`useMonteCarlo` pattern + `src/lib/montecarlo` (cone) · `src/lib/charges` (STT/GST/brokerage in `aggregating` + blotter) · `src/lib/options/payoff.ts` (per-leg payoff in results) · `sendEmail` / `emailLayout` / throttle · `rateLimit` · `NotificationsBell` / `useNotifications` poll · the toast primitive · the mobile bottom-sheet primitive · the `/community` public-universe pattern (`site-header.tsx`, `nav-links.tsx`).

---

## Design thesis (for the implementer to keep in view)

**Results screen.** Verdict in 3 seconds, evidence one tab away, drill-down only if asked. Honesty (`CoverageBadge`, hatched missing cells, `*` substitute rows, the standing disclaimer) is woven through every tier and travels onto the share card and into the email — it is the moat, not a footnote.

**Run/notify.** The running state earns trust by showing _real, counting work_ (days / bars / trades ticking up + a live MTM sparkline) and an honest, stabilized ETA. The user can walk away because the client worker keeps computing and a toast + bell + (opt-in) email bring them back via one canonical deep-link. The patchy-data reality is a calm, one-tap-fixable amber state (`empty:no-coverage` → nearest-strike), not a failure.

All of it sits on infra that already exists (the `useMonteCarlo` worker pattern, the `notifications` table, Resend, `rateLimit`, the motion tokens), so the team builds **surfaces, not plumbing** — which is exactly where we out-design AlgoTest, Sensibull, Opstra, Tradetron, and Streak.
