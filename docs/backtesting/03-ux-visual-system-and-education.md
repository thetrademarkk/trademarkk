# UX — Visual System, Motion, Accessibility & Education

This is the build-ready design spec for the standalone, public **`/backtesting`** universe — a marketing-header sibling to `/community`, **not** a page inside the logged-in `/app` journal. It covers two halves that an implementation workflow builds verbatim:

- **Part A — Visual Design System & Polish Bar:** tokens, primitives, components, motion, accessibility, mobile/PWA. _Extend, don't reinvent._
- **Part B — Onboarding & Education UX:** the guided first run, the glossary, the responsible-results trust layer, and the BYOC on-ramp. _The blank canvas is banned; missing data is named and honest; login is a reward, not a gate._

Every color/spacing/motion reference uses the **existing Tailwind v4 semantic tokens** (`bg`, `surface`, `surface-2`, `accent`, `profit`, `loss`, `muted`, `border`, `warning`) and the **existing primitive library** (`src/components/ui/*`, `src/components/shared/*`). The universe inherits all four themes (`light`, `carbon`, `midnight`, `oled`), the color-blind P&L mode (`[data-pl="cb"]`), the focus rings, and the global reduced-motion handling **for free** by speaking only in shipped tokens.

**The three things the universe genuinely adds** — and where the entire polish budget goes:

1. The **coverage badge / heatmap honesty primitive** (no competitor ships it).
2. The **single tabbed strike selector** (AlgoTest breadth, via Radix `Tabs`).
3. The **persistent live-payoff rail** with spring delight (Sensibull-grade joy).

Everything else is composition of primitives that already exist.

---

# PART A — VISUAL DESIGN SYSTEM & POLISH BAR

## 0. Foundations — what's already there, what to add

### 0.1 Token inventory (reuse verbatim — do NOT introduce hex)

From `src/styles/globals.css` `@theme inline`, these Tailwind utilities resolve to CSS vars and re-theme automatically across all four themes:

| Utility class                      | Token          | Use in backtesting                                   |
| ---------------------------------- | -------------- | ---------------------------------------------------- |
| `bg-bg`                            | `--bg`         | Universe page background                             |
| `bg-surface`                       | `--surface`    | Cards, sheets, chart shells, right rail              |
| `bg-surface-2`                     | `--surface-2`  | Inputs, tab tracks, skeletons, leg-chip wells, hover |
| `border` / `border-border`         | `--border`     | Every divider, card edge, chart grid                 |
| `text-foreground`                  | `--text`       | Primary text, hero numbers                           |
| `text-muted`                       | `--text-muted` | Labels, axis ticks, secondary copy                   |
| `text-profit` / `bg-profit`        | `--profit`     | Buy legs, gains, equity-up                           |
| `text-loss` / `bg-loss`            | `--loss`       | Sell legs, losses, drawdown                          |
| `text-accent` / `bg-accent`        | `--accent`     | Selection, focus ring, active nav, primary line      |
| `bg-accent-solid` `text-accent-fg` | solid CTA      | Run button, primary CTAs (WCAG-safe fill)            |
| `text-warning` / `bg-warning`      | `--warning`    | Coverage caution, low-liquidity, disclaimers         |

Verified values (so reviewers can sanity-check contrast, never hardcode): `--profit #059669` / `--loss #dc2626` / `--accent #7c3aed` / `--warning #d97706` in `light`; profit/loss brighten to `#34d399` / `#f87171` in dark themes; `[data-pl="cb"]` remaps to blue `#60a5fa` / orange `#fb923c` (dark) and `#2563eb` / `#ea580c` (light). `--accent-solid` exists precisely so white-on-accent CTAs stay ≥4.5:1 on dark.

> **Hard rule:** Profit/loss is the ONLY semantic color pairing allowed for P&L. It already flips to blue/orange under `[data-pl="cb"]` — so **never** hardcode green/red; always use `text-profit` / `text-loss` / `bg-profit/15` etc. so color-blind users inherit it for free.

### 0.2 Tokens to ADD to `globals.css` (the only additions)

Append three motion tokens + one radius to `@theme inline` (which already defines `--radius-lg: 10px`, `--animate-fade-in`, `--animate-slide-up`) and define the easing curves as global CSS vars. These are the missing primitives the research mandates (Material easing, spring snap, the `running → results` arrival). Add under the existing `--animate-*` lines:

```css
@theme inline {
  /* …existing: --radius-lg: 10px; --animate-fade-in; --animate-slide-up… */
  --radius-xl: 14px; /* sheets, chart shells, hero cards */
  --animate-pop-in: pop-in 0.22s var(--ease-decelerate) both; /* leg cards */
  --animate-count-tick: count-tick 0.3s var(--ease-standard) both;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1); /* default on-screen move   */
  --ease-decelerate: cubic-bezier(0, 0, 0.2, 1); /* entrances (sheets/cards) */
  --ease-accelerate: cubic-bezier(0.4, 0, 1, 1); /* exits/dismissals         */
}

@keyframes pop-in {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@keyframes count-tick {
  from {
    opacity: 0.4;
  }
  to {
    opacity: 1;
  }
}
@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
} /* skeleton sweep */
```

The existing `@media (prefers-reduced-motion: reduce)` block already zeroes all `animation-duration` / `transition-duration` globally — these new animations inherit that for free. **Do not add reduced-motion guards per component; the global CSS rule covers them** (the one exception: JS-driven Framer values — see §4).

**Framer Motion spring preset** (the project ships `motion` v12). Create `src/lib/backtesting/motion.ts` as the single source so ≥80% of interactions reuse it (token discipline):

```ts
// src/lib/backtesting/motion.ts
export const springSnappy = { type: "spring", stiffness: 235, damping: 10, mass: 1 } as const; // leg add, slider thumb
export const springSoft = { type: "spring", stiffness: 170, damping: 22 } as const; // panel/rail
export const easeStd = { duration: 0.2, ease: [0.4, 0, 0.2, 1] } as const; // generic
export const easeEnter = { duration: 0.25, ease: [0, 0, 0.2, 1] } as const; // equity reveal
```

### 0.3 Type & numerics (already correct — keep using)

- `body` is `font-variant-numeric: tabular-nums` globally → all numbers align in tables. Keep.
- **All money / strikes / premiums / P&L** use `.font-money` (Geist Mono, tabular, `-0.01em`). Mandatory in stat tiles, leg chips, strike ladder, blotter.
- Section / column micro-headers use `.micro-label` (11px, 600, `+0.08em`, uppercase, muted). Reuse for every tile label and chart-band title.
- Use `@number-flow/react` (already a dep) for the hero result numbers and the live payoff Max P/L — rolling digits are the "delight" on a fresh run.

### 0.4 Radius / elevation / spacing scale (opinionated, consistent)

| Element                                  | Radius                                            | Elevation                |
| ---------------------------------------- | ------------------------------------------------- | ------------------------ |
| Inputs, chips, segmented control, badges | `rounded-lg` (10px) / `rounded-md` (chips/badges) | none / `shadow-sm`       |
| Cards, stat tiles, chart shells          | `rounded-lg`                                      | `shadow-sm`              |
| Sheets, hero result card, modals         | `rounded-xl` (14px) / `rounded-t-2xl` (sheet)     | `shadow-xl`              |
| Slider thumb, dots, coverage pips        | `rounded-full`                                    | `shadow-lg` (thumb only) |

Spacing: cards `p-4`; sheets/dialogs `p-5`; tile grids `gap-3` mobile / `gap-4` desktop; wizard step body `space-y-5`.

---

## 1. Layout shells

### 1.1 Universe chrome (match `/community`)

Reuse `SiteHeader` and add a `Backtesting` entry to `NAV` in `src/components/shared/nav-links.tsx` (between Community and Pulse). The universe is a public, marketing-adjacent area, so it inherits the marketing header, **not** the `/app` sidebar. Active state is already styled: `bg-accent/12 font-medium text-accent`.

```ts
// src/components/shared/nav-links.tsx — add to NAV
{ href: "/backtesting", label: "Backtesting" },
```

### 1.2 Builder layout — wizard + persistent live preview

Desktop ≥ `lg`: two columns. Left = wizard steps (`max-w-[640px]`). Right = sticky live-preview rail (`w-[360px]`, `lg:sticky lg:top-20`). Below `lg`: the rail collapses into a **bottom sheet** (a "Preview" FAB) — the live payoff is too valuable to drop on mobile, but it must not steal the fold.

```
┌─ SiteHeader (shared) ────────────────────────────────────────────────┐
│  TradeMarkk   Features  Community  Backtesting  Pulse  …    [Sign in] │
├───────────────────────────────────────────────────────────────────────┤
│  Backtest a strategy            coverage: NIFTY 82% · 2021–2026  ▮      │
│ ┌──── wizard (steps) ─────────────────┐ ┌──── live preview (sticky) ─┐ │
│ │ ① Setup  ② Legs  ③ Timing  ④ Risk   │ │  PAYOFF                    │ │
│ │ ●────────●────────○────────○  Review│ │  ╱╲      Max P 12,400      │ │
│ │                                     │ │ ╱  ╲___  Max L −6,200      │ │
│ │  [ step body ]                      │ │ BE 24,180 / 24,820 · PoP 61│ │
│ │                                     │ │ ─────────────────────────  │ │
│ │                                     │ │  Target day ⟷ Expiry  [%]  │ │
│ │            [ Back ]    [ Next → ]   │ │  margin ₹1.1L · θ −420/day │ │
│ └─────────────────────────────────────┘ └────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────┘
```

**Stepper rail:** `●` filled `bg-accent`; completed `bg-accent` + check; future `bg-surface-2 border`. Connector line `bg-border` → `bg-accent` as steps complete (animate width with `easeStd`). Numbered **and** labelled (research: numbered orientation beats unlabelled dots). A persistent **"All settings" toggle** in the header switches to the single-screen expert view (AlgoTest-style) — wizard is default; power users escape via this toggle or `Cmd+K`.

### 1.3 Results layout — Verdict → Evidence → Drill-down

```
┌─ VERDICT (above fold, no tabs) ────────────────────────────────────────┐
│  ✔ Profitable over 412 trade-days, but drawdown-heavy.                  │
│  [ coverage 82% ]·[ 412 trade-days ]·[ 2021–2026 ]·[ DD controlled ⚠ ] │
│  ┌── equity curve ───────────────────────────────────┐  ┌ stat strip ┐ │
│  │      ╱╲    ╱╲                                       │  │ P&L  +1.2L │ │
│  │   ╱╲╱  ╲╱╲╱  ╲___                                  │  │ Ret/DD 2.1 │ │
│  │  ──────────────────────── benchmark (opt-in) ⌁     │  │ MaxDD −58k │ │
│  ├── underwater (shared X-axis) ─────────────────────┤  │ Exp  1.34  │ │
│  │  ▼▼▼▼      ▼▼▼▼▼▼                                   │  │ Win  58%   │ │
│  └────────────────────────────────────────────────────┘  │ Sharpe 1.1 │ │
│  [ monthly heatmap band ]                                 └────────────┘ │
├─ EVIDENCE (tabs) ─ Returns · Risk · Calendar ──────────────────────────┤
├─ DRILL-DOWN (deferred tabs) ─ Trades · Per-leg · MAE/MFE · All metrics ─┤
└──────────────────────────────────────────────────────────────────────────┘
```

Stat strip = exactly **6** `StatCard`s (`src/components/shared/stat-card.tsx`, with `NumberFlow`). Equity + underwater share **one** time axis (a single Recharts `ComposedChart`, or two stacked charts with a synced `XAxis` via `syncId`).

---

## 2. Component inventory (concrete classes)

### 2.1 Stat tile — reuse `StatCard`, extend with delta + spark

`StatCard` already exists (animated `NumberFlow`, `tone="auto"` flips profit/loss). For results, add one comparison + **at most one** visual (sparkline OR trend arrow, never both — dashboard rule). Build `BacktestStatTile` wrapping `StatCard`:

```
┌──────────────────┐   label:   .micro-label
│ RETURN / MAX DD   │   value:   text-2xl font-semibold font-money
│ 2.14×        ↑    │   delta:   text-xs text-profit/text-loss
│ vs NIFTY B&H 1.2× │   sub:     text-xs text-muted truncate
└──────────────────┘
```

`tone="auto"` for P&L tiles; `tone="neutral"` for ratios (Sharpe / Expectancy stay foreground, **never** colored). Grid: `grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6`.

### 2.2 Leg chip / leg card

A leg is a row-card. Buy = `profit`, Sell = `loss`, CE/PE as a small mono badge. Use the existing `Badge` variants.

```
┌─────────────────────────────────────────────────────────┐
│ ◧ SELL  ·  NIFTY  CE  ·  ATM +0   ·  1 lot (75)      ⋮ ✕ │
│   served 24,500 · ₹128.40 · Δ0.49 · [ coverage 88% ]     │
└─────────────────────────────────────────────────────────┘
```

```tsx
// Buy / Sell direction tag (the load-bearing color)
<span className={cn(
  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold",
  side === "BUY" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"
)}>{side}</span>

// CE / PE option-type pill — neutral, mono
<span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-money text-foreground">CE</span>

// leg card shell
<div className="rounded-lg border bg-surface p-3 shadow-sm">
```

Legs animate in with `motion` `springSnappy` (`animate-pop-in` for the non-JS fallback). A `4px` left accent bar tinted profit/loss (`before:` pseudo) gives instant buy/sell scannability without relying on hue alone (color-blind: the **BUY/SELL text label is the primary signal**; color is secondary).

### 2.3 Strike ladder

Vertical scroll list, ATM pinned/centered; coverage encoded as opacity + a pip — **not** as the only signal. This is the universe's signature differentiator (honest missing-strike handling).

```
       CE                STRIKE              PE
   ₹212  ▓▓▓▓ 91%   ┌─ 24,300 ─┐      ₹ 41  ▓░░░ 34%
   ₹165  ▓▓▓░ 78%   │  24,400  │      ₹ 58  ▓▓░░ 52%
   ₹128  ▓▓▓▓ 88% ◀─┤ 24,500 ATM├─▶   ₹ 96  ▓▓▓░ 81%   ← ATM row, accent ring
   ₹ 94  ▓▓░░ 55%   │  24,600  │      ₹138  ▓▓▓▓ 90%
   ₹ —    ──── 0%   └─ 24,700 ─┘      ₹190  ▓▓▓▓ 93%   ← missing strike, muted
```

- **ATM row:** `ring-1 ring-accent bg-accent/8`, sticky-centered on open.
- **Coverage pip:** 4-segment bar; fill = `bg-profit` (≥70%), `bg-warning` (40–69%), `bg-loss/60` (<40%). Always paired with the numeric `%` (text) so it never relies on color alone.
- **Missing strike** (`0%`): row `opacity-50`, premium shows `—`, still tappable but on select surfaces a coverage callout (§2.8). Selecting an unavailable strike auto-suggests the nearest covered one ("24,700 unavailable → nearest 24,650, 81%").
- Each strike row is a `<button role="option">`; ladder is `role="listbox"` with roving `aria-activedescendant`; arrow-key up/down moves selection, PageUp/Down jumps 5 strikes.

### 2.4 Segmented control (strike-mode tabs, target-day/expiry, %/Pts)

Reuse `Tabs` / `TabsList` / `TabsTrigger` — it's already a segmented control (`bg-surface-2 p-1`, active `bg-surface shadow`). The single tabbed strike selector (AlgoTest breadth in one control) is exactly this:

```tsx
<TabsList className="w-full">
  <TabsTrigger value="atm">ATM ±</TabsTrigger>
  <TabsTrigger value="pct">% off</TabsTrigger>
  <TabsTrigger value="premium">Premium</TabsTrigger>
  <TabsTrigger value="delta">Delta</TabsTrigger>
  <TabsTrigger value="exact">Exact</TabsTrigger>
</TabsList>
```

Default tab = **ATM ±** (progressive disclosure: novices never see delta/premium unless they reach for it). For ≥5 segments on mobile, allow horizontal scroll (`overflow-x-auto`) rather than wrapping. Selecting a segment slides the active pill with `springSnappy`.

### 2.5 Sliders (target slider, SL/Target, MTM)

No slider primitive ships today — add `src/components/ui/slider.tsx` on `@radix-ui/react-slider` (install it; it's the only missing Radix package), styled to match `Switch` / `Progress` tokens:

```tsx
<SliderPrimitive.Track className="relative h-1.5 w-full grow rounded-full bg-surface-2">
  <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
</SliderPrimitive.Track>
<SliderPrimitive.Thumb className="block h-4 w-4 rounded-full bg-white shadow-lg border-2 border-accent
  transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
  active:scale-110" />
```

- The payoff **target slider** colors its Range profit/loss either side of breakeven: use two ranges or a gradient `from-loss via-surface-2 to-profit`.
- Thumb scales `1.1` on grab via `springSnappy` (the "delight" on direct manipulation).
- A live `font-money` value chip follows the thumb (`Tooltip`-style, `bg-foreground text-bg`).
- Keyboard: arrows ±step, Shift+arrow ±10×, Home/End to bounds — Radix gives this; just ensure `aria-label` + `aria-valuetext` carry the ₹/% unit.

### 2.6 Sheets (mobile leg editor, strike picker, date range)

Reuse `SheetContent` (`src/components/ui/sheet.tsx`, vaul) — already correct: `rounded-t-2xl`, drag handle, `max-h-[92vh]`, `bg-black/70` scrim, internal scroll. **Rules:**

- Modal bottom sheet for every builder editor on mobile (leg, strike ladder, date range, risk presets).
- Initial height should not exceed ~16:9; expand-on-swipe with internal scroll (vaul handles snap points — set `snapPoints={[0.5, 0.92]}`).
- Always provide tap-out + a visible action footer (`Done` primary), not just the drag handle (the handle "is easy to ignore").
- On `≥ md`, render the **same form** inside `Dialog` instead (the codebase's established "Sheet on mobile / Dialog on desktop" pattern — forms render identically).

### 2.7 Chart shell

A consistent wrapper for every chart (equity, payoff, drawdown, heatmaps). Build `ChartShell`:

```
┌─────────────────────────────────────────────┐
│ PAYOFF AT EXPIRY              [Target⟷Expiry] │  header: .micro-label + segmented
│  ─────────────────────────────────────────── │
│            ╱╲                                 │  body: ResponsiveContainer
│         ╱╲╱  ╲___                             │
│  ─────────────────────────────────── 0 line  │  zero line: stroke var(--border)
│  ─────────────────────────────────────────── │
│  ▢ strategy   ⌁ NIFTY B&H        coverage 82% │  footer: legend + coverage chip
└─────────────────────────────────────────────┘
```

```tsx
<section className="rounded-lg border bg-surface p-4 shadow-sm">
  <header className="mb-3 flex items-center justify-between">
    <h3 className="micro-label">PAYOFF AT EXPIRY</h3>
    {/* optional segmented control / toggle */}
  </header>
  <div className="h-[260px]">{/* ResponsiveContainer */}</div>
  <footer className="mt-3 flex items-center justify-between text-xs text-muted">…</footer>
</section>
```

**Recharts theming (reuse exactly from `src/components/charts/trend-charts.tsx` — already correct):**

- `tickStyle = { fill: "var(--text-muted)", fontSize: 11 }`
- `CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false}`
- `tooltipStyle` = `bg surface-2 / 1px border / radius 8 / 12px`, `labelStyle color text-muted`
- Equity line: `stroke="var(--accent)" strokeWidth={1.5}` + gradient fill `accent 0.25 → 0`.
- Profit/loss areas on payoff: fill `var(--profit)` / `var(--loss)` at `0.18` opacity, split at breakeven.
- Drawdown / underwater: `var(--loss)` fill `0.15`, mirrored below zero, **shares the equity `XAxis`** (one `syncId`).
- Benchmark overlay: opt-in toggle (default off), dashed `strokeDasharray="4 4" stroke="var(--text-muted)"`.
- Monthly heatmap cells: `bg-profit` / `bg-loss` with opacity = magnitude (`/15` … `/90`); zero = `bg-surface-2`. Each cell carries a text P&L on hover/focus (color-blind: never color-only).
- All chart numbers in INR via `formatINR`; locale `en-IN`.

Recharts (~40KB, already a dep) is the chart lib — **do not add ECharts**. The Monte-Carlo cone reuses the `src/lib/montecarlo` worker; render the 95th-percentile band as a `loss/15` envelope around the median line.

### 2.8 Coverage badge (the signature primitive)

The honesty primitive no competitor ships. Build `CoverageBadge` on top of `Badge`, thresholded:

```tsx
function coverageVariant(pct: number) {
  return pct >= 70 ? "profit" : pct >= 40 ? "warning" : "loss";
}
<Badge variant={coverageVariant(pct)} className="gap-1 font-money">
  <Signal className="size-3" /> {pct}%
</Badge>;
```

Three escalating forms:

1. **Chip** (inline): `[ coverage 82% ]` — leg chips, chart footers, verdict row.
2. **Served-vs-requested callout** (when nearest-strike substitution happens):

```
┌────────────────────────────────────────────────┐
│ ⚠ Requested 24,700 CE isn't in the dataset.      │  bg-warning/10 border-warning/30
│   Using 24,650 CE instead — 81% coverage.        │  text-sm, action link
│                                  [ Use 24,650 → ]│
└────────────────────────────────────────────────┘
```

3. **Coverage heatmap** (data catalog / strike-ladder pips): per-strike availability, profit → warning → loss thresholds, **always with the numeric %**.

Place a universe-level coverage indicator in the builder header (`coverage: NIFTY 82% · 2021–2026`) so users learn what exists _before_ building.

### 2.9 States — loading / empty / error (three explicit states everywhere)

- **Loading:** skeletons on structured surfaces only (tables, tiles, chart shells), never spinners. Reuse `Skeleton` (`animate-pulse rounded-lg bg-surface-2`). For the equity-chart placeholder, a shimmering rectangle at the final chart height (no layout shift). Add a subtle `shimmer` sweep overlay for hero surfaces.
- **Pyodide cold-start:** stream intentional progress, not a spinner — a stepped status line (`Loading Python runtime…` → `Pulling NIFTY 26-Jun slice…` → `Running 412 days…`) with a thin `Progress` bar (`bg-accent`). Makes the wait feel like arrival. (Full treatment in §B-3a.)
- **Empty:** reuse `EmptyState` (`src/components/shared/empty-state.tsx`) — icon-in-circle + specific headline + 1 CTA. Headlines must be specific: _"You haven't run any backtests yet"_, never _"No data"_.
- **Valid-run-but-no-data** (the patchy-coverage state — a DISTINCT third state): not an error, a reassuring actionable card. `bg-surface border border-dashed`, warning icon, copy: _"No fills for NIFTY 24,700 CE on 26-Jun — this strike isn't in the dataset. Try 24,650 (81% coverage)."_ + `[ Use nearest strike ]` CTA.
- **Error (translated traceback):** never dump a Pyodide traceback. Map it to a plain-English card — `bg-loss/10 border-loss/30`, headline + the offending API symbol linked to its doc card. Use component-level error boundaries (reuse `error-fallback.tsx`) so one bad options slice degrades a **single chart card**, not the whole results page.

### 2.10 Verdict / quality chips (QuantConnect-style honesty tests)

Render pass/warn chips above the fold using `Badge` variants:

```
[ ✓ Sufficient coverage 82% ]  [ ✓ 412 trade-days ]  [ ⚠ Drawdown −58k high ]  [ ✓ 2021–2026 ]
```

`profit` = pass, `warning` = caution, `loss` = fail. Thresholds: coverage ≥70%, trade-days ≥100, max-DD < 10% of capital, range ≥3 yr. These double as the educational / overfitting guardrails. (Detailed thresholds + tone rules in §B-7a.)

---

## 3. Motion guidelines

| Interaction                 | Technique                                | Value                                                           |
| --------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| Sheet / dialog enter        | decelerate                               | `--ease-decelerate`, 225ms (mobile) / 200ms (desktop)           |
| Sheet / dialog exit         | accelerate                               | `--ease-accelerate`, 195ms                                      |
| Leg card add/remove         | Framer spring                            | `springSnappy` (stiff 235 / damp 10); fallback `animate-pop-in` |
| Slider thumb grab           | spring scale                             | `springSnappy`, `active:scale-110`                              |
| Wizard step change          | slide + fade                             | `--ease-standard`, 200ms; X-translate ±12px                     |
| Stepper connector fill      | width transition                         | `--ease-standard`, 250ms                                        |
| Equity / payoff reveal      | path draw + fade                         | `easeEnter`, 250ms; Recharts `isAnimationActive`                |
| Result numbers              | NumberFlow roll                          | `@number-flow/react`, ~300ms                                    |
| `running → results`         | container fade-up                        | `easeEnter`, ≤375ms (feels like arrival, not reload)            |
| Theme switch                | existing `.theme-fade` + view-transition | 400ms `--ease-standard` (already shipped)                       |
| Hover lift (template cards) | reuse `.glow-card`                       | existing; pointer-fine + motion-tolerant only                   |

**Discipline:** ≥80% of transitions use the four tokens/presets in §0.2. One-off curves require justification. **Never exceed 400ms** on frequently-seen transitions. Cap concurrent springs (don't spring 8 legs simultaneously — stagger 30ms). The global reduced-motion rule already neutralizes all CSS animations above — verify each new animation degrades to instant, never to broken layout.

### Signature "delight" micro-interactions (ship these)

1. **Live payoff redraw** as each leg/strike/slider changes — decelerate, ≤200ms; the Sensibull-grade joy.
2. **Strike-ladder magnet:** on selecting a strike, the ATM ring springs to the new row.
3. **Coverage pip fill** animates left→right when a strike resolves (`count-tick`).
4. **Run button → progress morph:** the `Run` CTA expands into the inline progress bar in place (shared layout), then collapses into the verdict card.
5. **NumberFlow hero stats** roll up on results arrival.
6. **Cmd+K command palette** (`cmdk`, already a dep): "New backtest", "Switch index → BANKNIFTY", "Compare runs", "Export", jump to saved strategies — grouped buckets, fuzzy, ARIA-announced. The power-user escape hatch.

---

## 4. Accessibility (WCAG AA — non-negotiable)

- **Focus:** every interactive element keeps the existing `focus-visible:ring-2 focus-visible:ring-accent` (already on Button / Input / Switch). Strike rows, segmented tabs, slider thumbs, chip CTAs all inherit it. Never remove outlines without a visible replacement.
- **Color-blind P&L:** built-in via `[data-pl="cb"]` (blue/orange). **Therefore every P&L surface must use `text-profit` / `text-loss` / `bg-profit|loss/*` tokens — never literal green/red.** Additionally, never encode meaning by color _alone_: Buy/Sell carry text labels; coverage carries a number; payoff up/down carry the zero-line reference; heatmap cells carry P&L text.
- **Contrast:** body text ≥4.5:1, large numbers ≥3:1 across all four themes (tokens already tuned; `--accent-solid` exists precisely so white-on-accent CTAs stay ≥4.5:1 on dark). Muted text (`--text-muted`) is for ≥4.5:1 secondary copy only — never for the sole label of an actionable.
- **Strike ladder a11y:** `role="listbox"` + `role="option"`, `aria-activedescendant`, roving tabindex, arrow / PageUp-Down keys, `aria-label` includes strike + premium + coverage ("24,500 CE, ₹128.40, 88% coverage").
- **Sliders:** Radix gives keyboard + ARIA; set `aria-valuetext` to the human value ("₹40 target" / "+0.5%"), not the raw number.
- **Sheets / dialogs:** Radix/vaul trap focus, restore on close, support Esc + system-back; announce open/close. Drag-to-dismiss must have a keyboard/AT equivalent (visible close + tap-out).
- **Charts:** every chart shell has a visually-hidden data summary (`sr-only` sentence with key stats) and the blotter table as the accessible equivalent of the equity curve. Tooltips are supplementary, never the only path to a value.
- **Reduced motion:** covered globally for CSS; **confirm Framer Motion components read `useReducedMotion()`** and drop springs to instant (the CSS rule covers CSS animations, **not** JS-driven Framer values — guard those in JS).
- **Touch targets:** ≥44×44px for all primary mobile controls (leg ⋮/✕, slider thumb hit-area, sheet footer buttons). The default `Button` `h-9` (36px) needs `size="lg"` (h-11) or a larger hit-area on mobile primaries.

---

## 5. Mobile-first / PWA specifics

- **Mobile is the default render**, desktop is the enhancement. The builder is a vertical stack of sheets; the live preview is a dismissible bottom sheet behind a "Preview" FAB (fixed bottom-right, `bg-accent-solid text-accent-fg shadow-xl rounded-full size-14`).
- **Editors are modal bottom sheets** (vaul `SheetContent`); dialogs only at `≥ md`.
- **Stat grid** reflows `grid-cols-2` (mobile) → `sm:grid-cols-3` → `lg:grid-cols-6`. Use the existing `--breakpoint-xs: 480px` to keep tight action rows from overflowing ~360px phones.
- **Charts** drop to `h-[200px]`, hide secondary axes, widen `minTickGap`, and the right-rail benchmark legend collapses to an icon toggle.
- **Sticky footers:** wizard `Back/Next` and sheet `Done` pin to the bottom with `pb-[env(safe-area-inset-bottom)]` (PWA notch safety).
- **Tables (blotter)** become horizontally scrollable cards on mobile; numbers right-aligned, `font-money`; sticky header `z-10`.
- **Performance = delight (Linear thesis):** lazy-load Pyodide/duckdb-wasm (never block the builder UI on the WASM blob), cache HF slices in IndexedDB, render partial results progressively, and never block on a server round-trip for anonymous runs. Skeletons reserve final dimensions to prevent layout shift on a 3G phone.
- **Optimistic UI** only on reversible actions (save/bookmark/share, toggle a leg) via React 19 `useOptimistic` — **never** on the computed backtest result itself.

---

## 6. What to install / create (delta from current repo)

**Install (one package):** `@radix-ui/react-slider` (the only missing Radix primitive).

**Create (Part A):**

- `src/components/ui/slider.tsx` (Radix slider, tokened per §2.5)
- `src/lib/backtesting/motion.ts` (spring/ease presets, §0.2)
- `src/components/backtesting/coverage-badge.tsx` (§2.8)
- `src/components/backtesting/leg-card.tsx`, `strike-ladder.tsx`, `chart-shell.tsx`, `backtest-stat-tile.tsx`, `verdict-chips.tsx`, `no-data-state.tsx`, `cold-start-progress.tsx`, `command-palette.tsx` (`cmdk`)

**Edit (Part A):**

- `src/styles/globals.css` — add the motion tokens + `--radius-xl` + 3 keyframes (§0.2). **No new color tokens.**
- `src/components/shared/nav-links.tsx` — add `{ href: "/backtesting", label: "Backtesting" }`.

**Reuse as-is:** `Button`, `Badge`, `Card`, `Tabs` (as segmented control), `Sheet`, `Dialog`, `Switch`, `Skeleton`, `Progress`, `Input`, `StatCard`, `PnlText`, `EmptyState`, `SiteHeader`, `error-fallback.tsx`, the `trend-charts.tsx` Recharts theming constants, `src/lib/montecarlo` (worker), `src/lib/options/payoff.ts`, `src/lib/charges`, `formatINR`, `cn`.

---

# PART B — ONBOARDING & EDUCATION UX

**Surface:** the public, standalone `/backtesting` universe. **Audience:** Indian intraday/F&O traders, mostly semi-technical, ranging from "never backtested" to "AlgoTest power user." **North star:** _a complete novice runs their first credible backtest and understands what the numbers mean — without ever feeling lectured, gated, or stupid._ **Design law:** the blank canvas is the enemy; missing data must be a named, honest state; speed is delight; nudge login only at save/share.

This part is opinionated. Where options exist, one is picked. All color/spacing references use the same semantic tokens and primitives as Part A; motion uses the §0.2 tokens (enter `cubic-bezier(0,0,0.2,1)` ~200ms; spring `stiffness:235, damping:10` for added legs).

## B-0. The onboarding philosophy (the spine everything hangs off)

Five principles, in priority order. Every screen below is justified against these.

1. **Show, don't gate.** No signup wall, no "watch this 4-min video" interstitial. The first meaningful action a visitor can take is _run a real backtest in three clicks_. Education is delivered **in the flow of work**, never as a blocking prerequisite.
2. **One runnable thing, always.** Following QuantConnect's most-resented failure ("examples never run"): every entry point opens on a strategy that _runs end-to-end on real, well-covered data the instant it loads_. The blank builder is never the default first view.
3. **Progressive disclosure of complexity AND of education.** Novices see ATM / simple-MTM / fixed-time and short plain-language labels. The jargon, the formulas, the per-leg trailing logic, and the deeper "why" tooltips are all one click away, never in your face.
4. **Honesty is the brand.** Coverage chips, sample-size caveats, and overfitting warnings are not legal cover — they are the _trust differentiator_ none of the five competitors ship. They appear contextually and proportionally (louder when the result is genuinely fragile, silent when it's robust).
5. **Confidence is earned through a loop, not a tour.** The novice→confident arc is: _see it work → understand one number → change one thing → see it change → understand why._ We instrument and design for that loop, not a 12-step coachmark parade (those get dismissed).

## B-1. The novice's journey — the confidence arc

The whole design serves this five-stage arc. Each stage has an explicit "graduation" signal that unlocks/relaxes the next.

```
  STAGE 0          STAGE 1            STAGE 2           STAGE 3            STAGE 4
  ARRIVE     →     FIRST RUN     →    FIRST EDIT   →    FIRST BUILD   →    FIRST TRUST
  (landing)        (1-click demo)     (tweak a leg)     (own strategy)     (reads results
                                                                            critically)

  Sees a working   Runs a curated     Changes strike/   Opens blank-ish    Notices coverage,
  result + a       example, watches   SL, re-runs,      builder, adds      sample size, and
  "Run this" CTA   results animate    sees delta in     legs with smart    overfitting flags
                   in                 the numbers       defaults           UNPROMPTED
       │                │                  │                 │                  │
  graduation:      graduation:        graduation:       graduation:        graduation:
  clicks Run       result rendered    re-run happened   run succeeded      hovers/expands a
                                                                            caveat, or toggles
                                                                            OOS test
```

**Design implication:** onboarding state is a tiny local profile (localStorage, anonymous-safe), `bt_onboarding = { stage, dismissedTips:[], hasRun, hasEdited, hasBuilt, glossaryOpened }`. This drives _what_ contextual education shows — **not** a modal wizard that runs once and dies. It degrades gracefully: cleared storage just means a friendly re-intro, never a broken state. (Full schema in §B-12.)

## B-2. Landing → the "Run this" on-ramp (Stage 0→1)

The `/backtesting` index page must do one job: get a complete stranger to a rendered result in under 15 seconds. Reject the "feature grid + Sign up" marketing template.

**Layout (desktop ≥1024px):**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [TradeMarkk]   Features  Community  Backtest•  Pulse  Docs        [Sign in]│  ← shared site-header, "Backtest" active
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   Backtest options strategies on 5 years of                                │
│   NIFTY, BANKNIFTY & SENSEX data.  Free. No signup.                        │
│   Honest about what the data can and can't tell you.        ← H1 + subhead │
│                                                                            │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │  ▶  Try a backtest right now                          [no signup] │    │  ← PRIMARY CTA card
│   │                                                                    │    │
│   │   9:20 Short Straddle · NIFTY · last 60 trading days               │    │  ← a REAL, pre-wired,
│   │   ┌───────────────── live mini equity preview ──────────────┐      │    │     well-covered example
│   │   │      ╱╲      ╱╲╱                                         │      │    │     (static thumbnail until
│   │   │   ╱╲╱   ╲╱╲╱                          [▶ Run this]       │      │    │      clicked → animates)
│   │   └──────────────────────────────────────────────────────────┘     │    │
│   │   ◍ Strike coverage 88%   ◍ 60 trade-days   ◍ runs in your browser  │    │  ← trust chips, present from t=0
│   └──────────────────────────────────────────────────────────────────┘    │
│                                                                            │
│   Or start from:  [ Build from scratch ]   [ Bring your own code ]         │  ← secondary, de-emphasized
│                                                                            │
│   ───────────────────────────────────────────────────────────────────    │
│   Popular starting points                              (curated gallery ↓) │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐                          │
│   │Bull put │ │Iron     │ │ORB CE   │ │Expiry-  │   …                      │
│   │spread   │ │condor   │ │buy      │ │day fade │                          │
│   │ ◍ 84%   │ │ ◍ 79%   │ │ ◍ 91%   │ │ ◍ 86%   │                          │
│   └─────────┘ └─────────┘ └─────────┘ └─────────┘                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Opinionated decisions:**

- **The hero is a real backtest, not a hero image.** The mini equity curve is a real (cached) result for the default example. Clicking **Run this** doesn't navigate to an empty builder — it opens the builder _with this strategy pre-loaded_ and immediately kicks off the run, so the user's first experience is _watching numbers populate_, not facing fields. This is the single highest-leverage onboarding decision.
- **Trust chips appear before the user has done anything.** "Strike coverage 88% · 60 trade-days · runs in your browser" teaches three of our core literacy concepts (coverage, sample size, client-side/free) _as ambient copy_, not as a lecture.
- **"Bring your own code" is present but visually quiet** on the landing page — it's for a minority, and showing it loud would intimidate the majority. It gets its own first-run treatment (§B-8).
- **Mobile:** the hero CTA card is full-width; the gallery becomes a horizontal snap-scroll carousel of cards; "Build from scratch / BYOC" collapse into a single `[ Start your own ]` that opens a modal bottom-sheet chooser (scrim `#000`/20%).

**Microcopy rule:** the H1 sells the _honesty_ angle, because that's our wedge. Never "the most powerful backtester" — that's AlgoTest's claim and we'd lose. We win on "honest + effortless."

## B-3. Guided first backtest (Stage 1) — the "guided run," not a wizard tour

When the user clicks **Run this** (or picks a gallery card), they land in the builder with the strategy loaded and the run auto-starting. The guidance here is a **single, calm, dismissible "guide rail"** — not coachmark spotlights that dim the whole screen (those test poorly and feel patronizing to the AlgoTest crowd).

### B-3a. The running state (Pyodide cold-start as intentional progress)

The first run has a real cold-start cost (Pyodide + WASM + HF slice). We make the wait _feel intentional and educational_.

```
┌──────────────── Running your first backtest ──────────────────┐
│                                                                │
│   ◐  Warming up the engine in your browser…                   │  ← step 1 (Pyodide load)
│   states animate top→bottom, each ✓ when done                 │
│   ✓  Loaded NIFTY 1-minute data (26-Jun expiry)               │  ← step 2 (HF slice)
│   ◐  Simulating 60 trading days…                              │  ← step 3 (run)
│                                                                │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  68%                                     │
│                                                                │
│   ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄    │
│   💡 While this runs: a "trade" here = one trading day the     │  ← rotating did-you-know,
│      strategy was active. We test on real 1-min candles.      │     teaches vocabulary in dead time
└────────────────────────────────────────────────────────────────┘
```

- Three named phases (engine / data / simulate) so a 4–8s wait reads as _work being done_, not a hang. Use the `Progress` primitive (`bg-accent`).
- **One** rotating "did-you-know" line teaches a single concept per run (trade = day, slippage included, coverage meaning). It's quiet, not a quiz.
- Skeleton placeholders for the results panels sit behind this so the layout doesn't jump (~20–30% perceived-speed win).
- Subsequent runs skip phase 1 (runtime cached) and feel near-instant — reinforcing the "this is fast" impression on the _second_ run, which is when it matters for retention.

### B-3b. The guide rail (first session only)

A slim, dismissible bar docked under the builder header. Three steps, plain language, auto-advances as the user acts. Not a modal, not a spotlight.

```
┌────────────────────────────────────────────────────────────────────────┐
│ 👋 First time?  ①  See your result ──→  ② Change one thing ──→ ③ Read it │
│                    ●━━━━━━━━━━━━━━━━━━━━━━○━━━━━━━━━━━━━━━━━━━━━○          │
│                  done                                            [Skip ✕]│
└────────────────────────────────────────────────────────────────────────┘
```

- Step ① auto-completes when results render. Step ② completes on the first parameter change + re-run. Step ③ completes when they expand any results detail or caveat.
- After step ③ (or on Skip), the rail collapses to a tiny `?` affordance and **never auto-shows again** (tracked in `bt_onboarding`). No nagging.
- Each step, when active, lightly highlights _the one relevant region_ (e.g. step ② softly outlines the leg's strike control) with a 2px `accent` ring — **not** a full-screen dim. This respects the expert who skips instantly.

### B-3c. The "change one thing" moment (the core learning loop)

This is where learning actually happens, so we engineer the smallest possible successful edit. On the loaded example, the strike selector and the SL field each carry a subtle **"try changing me"** affordance during the guide rail (a faint pulse on the control; `prefers-reduced-motion` → static dot). Changing it triggers a **diff-aware re-run** and the results animate from old→new values (`NumberFlow`), with a one-line callout:

```
   Win rate  64% → 58%   ▼   You widened the stop, so fewer days hit target.
```

That single sentence — _connecting an input change to an output change in plain causal language_ — is the most valuable educational artifact in the entire product. It turns a number into understanding. Ship a small library of these "delta explanations" keyed on `(param changed, direction, metric moved)`.

## B-4. Contextual tooltips & the "explain" layer

Every piece of jargon in the builder and results is a **dotted-underline term** that reveals a definition on hover (desktop) / tap (mobile). Three depths of explanation, progressively disclosed.

**Anatomy of a term tooltip:**

```
   Strike: ATM⁺²  ⓘ                       ┌─────────────────────────────────────┐
   ╌╌╌╌                hover/tap  ───────▶ │ ATM +2                              │
                                           │ The strike 2 steps out-of-the-money │  ← L1: one sentence,
                                           │ from the at-the-money strike.       │      plain Hindi-English
                                           │                                     │
                                           │ Spot ~22,000 → this picks 22,100 CE │  ← L2: a concrete worked
                                           │                                     │      example w/ live numbers
                                           │ Learn more about strikes →          │  ← L3: link into glossary
                                           └─────────────────────────────────────┘
```

**Rules (opinionated):**

- **L1 is always ≤ 1 sentence, no jargon-to-define-jargon.** "Out-of-the-money" inside an ATM tooltip is itself a dotted term (nested, but only one level deep on hover; deeper goes to glossary).
- **L2 uses the user's actual current values** where possible ("Spot ~22,000 → 22,100"), computed live. Concrete beats abstract for this audience — this is the single best tooltip upgrade and it's cheap.
- **First-encounter emphasis, then fade.** The _first_ time a given term appears in a session, its `ⓘ` glows once (1 pulse). After the user has opened it once (tracked in `seenTerms`), the underline stays but the glow never repeats. Power users effectively never see the glow.
- **No tooltip on a tooltip while one is open**; mobile uses a bottom-sheet popover (not a hover tip) with the same three tiers and a clear close affordance — hover tooltips are an accessibility/mobile trap.
- **Keyboard + AT:** every term is a `<button>` with `aria-describedby`; the popover is dismissible with Esc and announced. The dotted underline + `ⓘ` is **never** color-only.

**Where tooltips are mandatory (the jargon census):** Underlying, Spot, ATM/ITM/OTM, Strike (and every selection mode: ATM±, %, Premium, Delta, Exact), CE/PE, Buy/Sell, Lots/lot-size, Expiry (weekly/monthly), Entry/Exit time, Days-from-expiry, SL/Target (%/Pts, option vs underlying), Trailing SL, Square-off Partial/Complete, Re-entry modes, Overall MTM SL/Target, Lock & Trail, Slippage, Brokerage/charges, and every results metric (§B-5's glossary list).

## B-5. The glossary — `/backtesting/learn` + the in-app drawer

Two surfaces, one content source (a single MDX/JSON dictionary so tooltips and the glossary never drift).

**B-5a. In-app glossary drawer.** A right-side drawer (desktop) / full bottom-sheet (mobile) opened from a persistent `Aa Glossary` button in the builder/results header, from any tooltip's "Learn more," or via `Cmd/Ctrl+K → "define delta."`

```
┌───────────────────────── Glossary ───────────────────────────┐
│  🔎 Search terms…                                       [✕]   │
│  ┌─ filters ─────────────────────────────────────────────┐   │
│  │ All · Options basics · Strikes · Risk · Results · Data │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  DELTA                                            [Risk·Greeks]│
│  How much an option's price moves for a ₹1 move in the index.  │  ← L1
│  A 0.50-delta option moves ~₹0.50 per ₹1. Sellers often pick   │  ← L2 worked example
│  0.15–0.20 delta strikes (far OTM, lower risk).                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  [tiny inline diagram: delta vs strike curve]          │    │  ← optional micro-visual
│  └──────────────────────────────────────────────────────┘    │
│  Related: Strike by Delta · Theta · IV · OTM                   │  ← cross-links
│  ─────────────────────────────────────────────────────────    │
│  EXPIRY  …                                                     │
└────────────────────────────────────────────────────────────────┘
```

**B-5b. Standalone `/backtesting/learn`** — the same dictionary as an SEO-indexable, shareable page (each term deep-linkable `/backtesting/learn#delta`), grouped by category, with a short "How backtesting works here" preamble and the responsible-use primer. This doubles as a marketing/credibility surface and is reachable from the universe nav.

**Content depth standard for each entry:** L1 (one sentence) → L2 (worked example with India-specific numbers: NIFTY 75 lot, ₹40–60 premium sellers, 0.15 delta) → optional micro-visual → "Related" cross-links → (for results metrics) **a "how to read it / what's a healthy range / how it can mislead" note.** That last note is where responsible-results education lives quietly inside the glossary.

**The starter term set (ship at launch):** ATM, ITM, OTM, Strike, Spot, CE, PE, Premium, Lot/Lot size, Expiry (weekly/monthly), IV, Delta, Theta, Gamma, Vega, Straddle, Strangle, Spread, Iron condor, Stop-loss, Target, Trailing SL, Square-off (Partial/Complete), Re-entry, MTM, Overall SL/Target, Slippage, Brokerage/STT/charges, Equity curve, Drawdown, Max drawdown, Win rate, Profit factor, Expectancy, Sharpe, Return/Max-DD, Sample size, **Coverage**, **Overfitting**, **Out-of-sample**, **Monte-Carlo drawdown**, **Survivorship/look-ahead** (brief, honest).

## B-6. Curated example strategies (the gallery)

These do triple duty: on-ramp, teaching artifacts, and proof the data is real. **Every example must run end-to-end on a real, well-covered expiry the instant it opens — no empty first state, ever** (QuantConnect's cardinal sin, avoided).

**Gallery card anatomy:**

```
┌────────────────────────────────┐
│  9:20 Short Straddle           │  ← name
│  Sell ATM CE + ATM PE, fixed   │  ← one-line "what it does"
│  SL & target, exit 15:15.      │
│  ┌──── mini equity sparkline ─┐ │  ← real cached preview
│  │   ╱╲╱╲╱                     │ │
│  └────────────────────────────┘ │
│  Neutral · Beginner             │  ← outlook tag + difficulty
│  ◍ 88% coverage · 60 days       │  ← honesty chips
│  [ Open & run ]   [ Explain ]   │  ← primary + "what am I looking at"
└────────────────────────────────┘
```

**Opinionated curation (launch set of ~8), grouped by outlook (Sensibull pattern) and difficulty:**

| Strategy                                    | Outlook     | Difficulty   | Teaches                               |
| ------------------------------------------- | ----------- | ------------ | ------------------------------------- |
| 9:20 Short Straddle (SL/target, exit 15:15) | Neutral     | Beginner     | the basic non-directional seller loop |
| ATM CE ORB buy (opening-range breakout)     | Directional | Beginner     | a simple buyer / single-leg           |
| Bull Put Spread                             | Bullish     | Beginner     | defined-risk spread, two legs         |
| Iron Condor                                 | Neutral     | Intermediate | four legs, payoff shape               |
| Expiry-day straddle fade                    | Neutral     | Intermediate | days-from-expiry filter, theta        |
| Delta-15 strangle (by-delta selection)      | Neutral     | Intermediate | strike-by-delta                       |
| Premium ₹50 short strangle                  | Neutral     | Intermediate | strike-by-premium                     |
| Trailing-SL short straddle                  | Neutral     | Advanced     | trailing SL + lock-&-trail            |

**Rules:**

- Each is pinned to a **specific, verified high-coverage expiry+range** so the first run never hits empty/illiquid strikes. The card's coverage chip reflects that pinned range honestly.
- The **`[Explain]`** action opens a short "teardown" of the strategy (the hypothesis, why a trader uses it, what to watch in the results, what would break it) — this is the bridge from "I ran it" to "I understand it." It reuses the glossary content system.
- Examples are **explicitly framed as wiring/learning demos, never as profitable** ("This shows _how_ the engine works, not a recommendation"). This is both honest and legally prudent, and it dodges QuantConnect's "examples aren't profitable, users feel cheated" backlash by setting the expectation up front.
- "Open & run" **forks** the example into the user's working strategy (duplicate-and-tweak — Composer's proven on-ramp), so editing never mutates the canonical example.

## B-7. Responsible-results UI (the trust layer)

This is our wedge and our ethical obligation. The rule: **proportional honesty** — warnings scale with actual fragility. A robust 5-year, 90%-coverage, 400-trade result should feel _confident and clean_; a 20-trade, 55%-coverage, single-expiry result should be _visibly hedged_. We never nag a good result, and we never let a bad one masquerade as good.

### B-7a. The confidence/quality chip row (always above the fold, Tier-1)

Adapt QuantConnect's red/green "interpretive tests" as calm chips at the very top of results. Each is pass/caution/fail with a tooltip explaining the threshold and _why it matters_.

```
┌──────────────────────────────── Results ──────────────────────────────────┐
│  Quality of this test:                                                     │
│  ◉ Coverage 88%   ◉ 412 trade-days   ◉ 2021–2026   ◉ Drawdown controlled   │  ← all green = calm
│  └ green ────────┘ └ green ──────────┘ └ green ────┘ └ green ─────────────┘ │
│                                                                            │
│  ── vs a fragile run: ──                                                   │
│  ⚠ Coverage 54%   ⚠ 23 trade-days   ◉ 1 expiry only   ⚠ Few trades        │  ← caution = amber, never red-scary
└────────────────────────────────────────────────────────────────────────────┘
```

- **Three states, semantic tokens:** pass = `profit`-tinted, caution = `warning` (amber), fail = `loss`-tinted but _muted_, never alarm-red. Tone is "here's the context," not "you failed."
- Tooltips state the **threshold and the reasoning**: "Fewer than ~30 trade-days: results are too few to trust. One lucky week can dominate." Thresholds (opinionated defaults): trades ≥100 green / 30–99 caution / <30 fail; coverage ≥80 green / 60–79 caution / <60 fail; period ≥3y green; max-DD <15% green.

### B-7b. Coverage & nearest-strike honesty (the differentiator none of them ship)

Wherever served data deviated from requested, say so — inline, specific, actionable. This is the **valid-run-but-imperfect-data** state, a first-class citizen.

```
┌─ Data notes for this run ──────────────────────────────────────────┐
│  ⓘ On 14 of 60 days, your requested strike was missing.            │
│     We used the nearest available strike instead.                  │
│     e.g. 22,500 CE → 22,550 CE (closest with data)   [see all 14 ▾]│
│                                                                    │
│  ⓘ 3 days had thin/illiquid quotes — fills here are less reliable. │
│     These are shown faded in the trade blotter.                    │
└────────────────────────────────────────────────────────────────────┘
```

- Affected trades are **faded + flagged** in the blotter (not hidden — hiding them would be dishonest), with the served-vs-requested strike shown.
- A per-run **coverage % is computed and surfaced**, not hand-waved. If coverage is so poor the result is misleading, the empty/degraded state escalates (below).

### B-7c. The empty / degraded states (designed, not accidental)

Using the `EmptyState` primitive's anatomy (icon + specific headline + 1 sentence + single CTA), specialized for our patchy data:

```
   ┌──────────────────────────────────────────────────────┐
   │                      [ ◍ icon ]                        │
   │   We don't have enough data to test this honestly.     │  ← specific, not "No data"
   │                                                        │
   │   NIFTY 22,500 CE for 26-Jun has only 31% coverage —   │  ← the real reason + number
   │   too sparse to trust. The nearest well-covered strike │
   │   is 22,550 CE (88%).                                  │
   │                                                        │
   │        [ Use 22,550 CE instead ]   [ Pick a date ]     │  ← one primary, recoverable action
   └──────────────────────────────────────────────────────┘
```

Three explicitly distinct states (never blurred): **build error** (before run, inline validation), **no/low-coverage** (this — reassuring + actionable + a concrete alternative), and **genuine zero** (the rare "this expiry simply isn't in the dataset"). The no-coverage state is the most-shipped one given our data and gets the most love. Build as `DegradedEmptyState` extending `EmptyState`.

### B-7d. Overfitting & "past performance" — present, proportional, never naggy

The hardest balance. Decision: **one passive, always-present, low-key line** + **active escalation only when the result is statistically fragile** + **an opt-in robustness tool that makes the lesson experiential rather than preachy.**

1. **Passive footer line (always, quiet):** a single muted line under the results, not a banner:

   `Backtests describe the past. Past performance is not indicative of future results. Real fills differ. [How to read results responsibly →]`

   It's `text-muted text-xs`, dismissible-to-collapsed but re-appears per _new_ result (because it's per-result honesty, not one-time consent). Never a modal, never blocks. Build as `ResponsibleFooter`.

2. **Active escalation (only when warranted):** if quality chips show caution/fail (low trades, single expiry, suspiciously high win-rate + tiny sample, or the user has re-run > N times tweaking params), surface a _contextual_ card — and crucially, frame it as **a coaching insight, not a scold**:

```
   ┌─ A note before you trust this ───────────────────────────────┐
   │  This result looks great (78% win rate) — but it's based on   │
   │  just 23 trade-days on a single expiry. With so few trades,   │
   │  one lucky stretch can fake an edge. This is called           │
   │  overfitting. ╌╌╌╌╌╌╌╌╌                                        │  ← term → glossary
   │                                                               │
   │  ▸ Test it on more dates    ▸ Try out-of-sample [what's this?]│
   └───────────────────────────────────────────────────────────────┘
```

3. **The experiential lesson — opt-in Out-of-Sample toggle + Monte-Carlo cone:** rather than _telling_ users about overfitting, let them _feel_ it.
   - A one-click **"Split test (out-of-sample)"** toggle re-runs the strategy on a train range and a held-out test range and shows both equity curves side by side. When they diverge, the user _sees_ overfitting. One short caption: "If the orange (unseen) line is much worse, the strategy may be curve-fit."
   - The **Monte-Carlo drawdown cone** (reuse `src/lib/montecarlo`) reframes a single lucky equity curve as a distribution — "your historical max drawdown was ₹X, but 95% of reshuffles were worse, up to ₹Y." This is the honest-risk headliner and is nearly free given the existing worker.
   - Both are **opt-in, in Tier-2/3** — never forced on the calm first result. The novice meets them when they're ready (or when escalation gently points there).

**Anti-nag guardrails:** the passive line is one muted sentence; the active card appears _only_ on genuinely fragile results and at most once per result; no modal ever blocks viewing results; dismissed coaching cards stay dismissed for that result. We are honest, not preachy.

## B-8. Bring-your-own-code first-run (the technical on-ramp)

BYOC has a separate, gentler onboarding because its failure mode (blank editor + opaque data API) is the harshest.

**The BYOC entry NEVER opens a blank file.** It opens Monaco pre-loaded with a **runnable starter** (e.g. "9:20 short straddle in ~30 lines") that runs on real data on first click — the same anti-blank-canvas law.

```
┌──────────────────────────── Bring your own code ──────────────────────────────┐
│  ┌─ Data ──────────┐ ┌──────────── editor ──────────────────┐ ┌─ Output ─────┐ │
│  │ NIFTY ▾         │ │ # Starter: 9:20 short straddle        │ │ ▶ Run        │ │
│  │  Expiries:      │ │ from tmk import load_index, load_opt… │ │              │ │
│  │   26-Jun ◍91%   │ │ df = load_index("NIFTY","09:20","15:1…│ │ equity ╱╲╱   │ │
│  │   03-Jul ◍88%   │ │ ...                                   │ │              │ │
│  │  Strikes ▾      │ │                                       │ │ Stats…       │ │
│  │  [coverage      │ │  ⓘ Ctrl-click load_opt → docs         │ │              │ │
│  │   heatmap]      │ │                                       │ │ [Plain-Eng   │ │
│  │ [+ insert query]│ │                                       │ │  errors]     │ │
│  └─────────────────┘ └───────────────────────────────────────┘ └──────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Key onboarding/education features (each directly from the BYOC research):

- **In-editor data catalog** (left rail): the 3 indices, their expiries, and a **strike-coverage heatmap** — so users discover what exists _before_ querying. This is our single biggest BYOC differentiator.
- **One-click "insert query"**: clicking NIFTY 22,500 CE 26-Jun injects the exact `load_option(...)` call. Collapses the "what do I even type" wall.
- **Curated Ctrl-click-to-docs** for our ~6 API functions only (`load_index`, `load_option`, `nearest_strike`, etc.) — Monaco + hand-authored stubs, **not** a flaky generic LSP (avoids QuantConnect's half-working-autocomplete distrust).
- **Plain-English error cards** translate Pyodide tracebacks. The flagship is the **no-data card**: _"No data for NIFTY 22,500 CE on 26-Jun — try 22,550 CE (88% coverage)."_ Three distinct states (syntax / runtime / valid-but-no-data) as in §B-7c.
- **Same login rule:** anonymous runs complete; login nudged only at save/share.

## B-9. Trust & credibility cues (cross-cutting)

Threaded throughout, not a section users visit:

- **Coverage/sample chips everywhere** a result or example appears (landing, gallery, results). Honesty as ambient texture.
- **"Runs in your browser · free · no signup"** stated at the on-ramp and on the run state — communicates zero-trust/zero-cost, which _is_ a credibility cue for a privacy-aware audience.
- **Real, named data provenance:** a quiet "Data: 1-minute NSE/BSE OHLC, 2021–2026, via our public dataset" link in the results footer. Auditable provenance > vague "5 years of data."
- **Charges shown, not hidden:** results explicitly include STT/GST/brokerage/slippage (reuse `src/lib/charges`) with a "charges applied" chip — competitors that hide costs inflate returns; showing them is a trust win.
- **No fake urgency, no inflated example returns, no "profitable strategy" language.** Examples are framed as demos. This restraint is itself the credibility signal.
- **Login is a reward, not a gate:** the only place we ask is _after_ a result renders, framed as "Save this run / get notified / share" — never before value is delivered.

## B-10. Mobile-first adaptations (PWA)

- Builder steps and the glossary use **Material modal bottom-sheets** (scrim `#000`/20%, drag handle + tap-out + explicit X, ≤16:9 initial height then internal scroll). Tooltips become tap → bottom-sheet popovers, never hover.
- Results: quality chips wrap to a 2-row scrollable strip; the hero equity+drawdown stay on a shared axis; Tier-2/3 are accordions.
- The guide rail collapses to a single sticky `?` FAB.
- All gesture-dismiss patterns also expose a button (accessibility: sheets are common AT breakers).

## B-11. Motion & state inventory (build reference)

| Moment                      | Treatment                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Results populate after run  | NumberFlow roll-in; charts reveal with decelerate `cubic-bezier(0,0,0.2,1)` ~220ms |
| Leg added in builder        | spring `stiffness:235, damping:10` card entrance                                   |
| Param change → re-run       | old→new value morph + one-line delta explanation                                   |
| Cold-start run              | 3 named phases + progress bar + 1 rotating did-you-know; skeletons behind          |
| Tooltip `ⓘ` first encounter | single pulse, then never again (tracked)                                           |
| Quality chip                | static; color via `profit` / `warning` / `loss` tokens, never flashing             |
| Overfitting coaching card   | gentle fade-in, only on fragile results, dismissible per-result                    |
| `prefers-reduced-motion`    | all pulses → static dots; reveals → instant; honored globally                      |

**Required reusable primitives (Part B):** `<Term>` (dotted-underline tooltip, 3-tier), `<GlossaryDrawer>`, `<QualityChip>` (pass/caution/fail), `<CoverageNote>`, `<DegradedEmptyState>` (extends `EmptyState`), `<RunProgress>` (3-phase), `<GuideRail>`, `<DeltaExplanation>`, `<ExampleCard>`, `<ResponsibleFooter>`. All read from one glossary dictionary so tooltip ↔ glossary ↔ `/backtesting/learn` never drift.

## B-12. Onboarding state model (anonymous-safe)

```ts
localStorage "bt_onboarding" = {
  stage: 0..4,
  hasRun: boolean, hasEdited: boolean, hasBuilt: boolean, openedBYOC: boolean,
  glossaryOpened: boolean,
  seenTerms: string[],          // drives first-encounter ⓘ glow
  dismissedTips: string[],      // guide-rail + coaching cards
  reRunCount: number,           // triggers overfitting escalation
}
```

Cleared storage → friendly re-intro, never a broken/blank state. No login required for any of it. On login, merge into the user profile so onboarding doesn't restart across devices.

## B-13. Definition of done (acceptance criteria for the implementation team)

1. A first-time visitor reaches a **rendered, real result in ≤3 clicks and ≤15s** with no signup.
2. **No entry point ever opens a blank canvas** — builder, gallery, and BYOC all open on a runnable, well-covered strategy.
3. Every jargon term in builder + results has a **3-tier tooltip** sourced from the shared glossary; first-encounter glow fires once.
4. Results always show the **quality-chip row**; coverage and nearest-strike substitutions are stated honestly and the affected trades are flagged, not hidden.
5. The **responsible-use line is always present (quiet)**; overfitting coaching escalates **only** on fragile results, at most once per result, never as a blocking modal.
6. **Out-of-sample split + Monte-Carlo cone** are available as opt-in robustness tools.
7. BYOC ships the **in-editor data catalog + coverage heatmap + one-click insert + plain-English error cards** (including the no-data card).
8. Full keyboard/AT support; `prefers-reduced-motion` honored; mobile uses bottom-sheets, not hover tips.
9. Login is nudged **only** at save/share/notify, after results render.
10. All visuals use existing semantic tokens and primitives (`Card`, `EmptyState`, `StatCard`/`NumberFlow`, `micro-label`, `font-money`); no new ad-hoc colors.

---

## Net thesis

**Extend, don't reinvent.** The universe inherits TradeMarkk's four themes, color-blind P&L, focus rings, and reduced-motion handling **for free** by speaking only in the existing tokens. The three things it adds — the **coverage badge/heatmap honesty primitive**, the **single tabbed strike selector**, and the **persistent live-payoff rail with spring delight** — are where the polish budget goes; everything else is composition of shipped primitives.

And the novice becomes confident not through a tour but through a _tight, instrumented loop_: **see a real result → understand one number via a concrete tooltip → change one thing → watch it change with a plain-English cause → meet honesty cues (coverage, sample size, overfitting) exactly when they become relevant.** We win where the five competitors don't: **the blank canvas is banned, missing data is named and honest, and responsible-results UI is proportional coaching, not legal nagging.** Education lives inside the work, trust is ambient, and login is a reward for value already delivered.

---

## Appendix — files this spec touches (all absolute)

**Edit:**

- `c:\Users\raash\Desktop\trading-journal\src\styles\globals.css` — motion tokens + `--radius-xl` + 3 keyframes (§0.2). No new color tokens.
- `c:\Users\raash\Desktop\trading-journal\src\components\shared\nav-links.tsx` — add `{ href: "/backtesting", label: "Backtesting" }`.

**Create (UI/lib):**

- `c:\Users\raash\Desktop\trading-journal\src\components\ui\slider.tsx`
- `c:\Users\raash\Desktop\trading-journal\src\lib\backtesting\motion.ts`
- `c:\Users\raash\Desktop\trading-journal\src\components\backtesting\{coverage-badge,leg-card,strike-ladder,chart-shell,backtest-stat-tile,verdict-chips,no-data-state,cold-start-progress,command-palette}.tsx`
- `c:\Users\raash\Desktop\trading-journal\src\components\backtesting\{term,glossary-drawer,quality-chip,coverage-note,degraded-empty-state,run-progress,guide-rail,delta-explanation,example-card,responsible-footer}.tsx`

**Reuse as-is:**

- `c:\Users\raash\Desktop\trading-journal\src\components\ui\{button,badge,card,sheet,tabs,switch,dialog,input,skeleton,progress}.tsx`
- `c:\Users\raash\Desktop\trading-journal\src\components\shared\{stat-card,pnl-text,empty-state,nav-links,site-header,error-fallback}.tsx`
- `c:\Users\raash\Desktop\trading-journal\src\components\charts\trend-charts.tsx` (Recharts theming constants)
- `c:\Users\raash\Desktop\trading-journal\src\lib\options\payoff.ts`
- `c:\Users\raash\Desktop\trading-journal\src\lib\montecarlo\` (`simulate.ts` + `montecarlo.worker.ts` → Monte-Carlo drawdown cone)
- `c:\Users\raash\Desktop\trading-journal\src\lib\charges\charges.ts` (charges-applied trust chip)

**Install:** `@radix-ui/react-slider` (the only missing Radix primitive).
