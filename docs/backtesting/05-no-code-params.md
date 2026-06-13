# No-Code Strategy Parameter Model

> **Scope.** This is the canonical data model for the TradeMarkk no-code options backtester. It defines every leg-level and strategy-level parameter, a versioned JSON schema with TypeScript types, validation rules, defaults, engine-behavior mapping, MVP-vs-Advanced tiering, and 5 worked example strategies. Benchmark = AlgoTest's depth; the win = progressive disclosure + honest missing-strike handling. Instruments: **NIFTY, BANKNIFTY, SENSEX only.**

This spec reuses existing primitives:

- `src/lib/options/payoff.ts` — `PayoffLeg = { strike, optionType, direction, qty, premium }`, `legPayoffAt`, `strategyPayoffAt`, `buildPayoffCurve`
- `src/lib/charges/charges.ts` — `computeCharges`, `Segment = "OPT"`, per-broker `ChargeProfile`
- `src/lib/montecarlo` — drawdown cone (already runs in a Web Worker)

The schema is the **input contract**; these libs are the **output / engine** contracts.

---

## 0. Design principles (opinionated, load-bearing)

1. **The JSON is the source of truth.** The wizard UI, the engine, save/share, and the (future) BYOC "show me the code" export all read/write this one object. Never let the UI hold state the JSON can't represent.
2. **Strike intent ≠ resolved strike.** A leg stores the _intent_ (`ATM+2`, `premium ≈ ₹40`, `delta ≈ 0.20`). The engine resolves it per-entry against real data and records what it _served_. Intent is portable across dates; resolved strikes are not. This is the foundation of honest missing-strike handling.
3. **Lots, not contracts.** Users think in lots. The schema stores `lots`; the engine multiplies by the per-symbol lot size (`NIFTY=75, BANKNIFTY=35, SENSEX=20`) to produce the `qty` that `PayoffLeg` expects. Never make users type 75.
4. **Two reference axes everywhere for risk** — _unit_ (`%` | `pts`) × _basis_ (option premium | underlying). This is AlgoTest's edge; collapse it into one tabbed control, not four raw fields.
5. **Re-entry = plain-language presets**, never raw `RE ASAP ↩`. The JSON stores a normalized `mode` enum; the UI labels it humanely.
6. **Everything has a sensible default** so an empty leg is already runnable. Defaults seed from the competitive "in the wild" numbers (SL 35–50%, target 70–80%).
7. **Forward-compatible**: `schemaVersion`, all-optional advanced blocks, unknown-key tolerance on read (warn, don't crash).

---

## 1. Top-level schema

```ts
// src/lib/backtest/schema.ts  (proposed)

export const STRATEGY_SCHEMA_VERSION = 1 as const;

export type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
export const LOT_SIZE: Record<IndexSymbol, number> = {
  NIFTY: 75,
  BANKNIFTY: 35,
  SENSEX: 20,
};

// Valid strike step per symbol — used by `atm`/`exact` resolution + validation.
export const STRIKE_STEP: Record<IndexSymbol, number> = {
  NIFTY: 50,
  BANKNIFTY: 100,
  SENSEX: 100,
};

export type CandleInterval = "1m" | "3m" | "5m" | "15m" | "60m" | "1d";

export interface Strategy {
  schemaVersion: 1;
  id: string; // uuid; client-generated, stable across edits
  name: string;
  notes?: string;
  tags?: string[];

  market: MarketConfig; // index, interval, date range  (Step 1)
  legs: Leg[]; // 1..8 legs                      (Step 2)
  timing: TimingConfig; // entry/exit schedule            (Step 3)
  risk: OverallRisk; // strategy-level MTM risk        (Step 4)
  execution: ExecutionConfig; // costs, slippage, fill model    (Step 4 / defaults)

  // Provenance / UX (not engine inputs)
  meta?: {
    createdAt: string; // ISO
    updatedAt: string;
    templateId?: string; // if forked from a template
    builderMode: "wizard" | "advanced";
  };
}
```

`MarketConfig`:

```ts
export interface MarketConfig {
  symbol: IndexSymbol;
  interval: CandleInterval; // default "1m" for intraday, "1d" for positional
  dateRange: { start: string; end: string }; // ISO "YYYY-MM-DD", IST trading days
  // Underlying the option strikes are priced against. Always index spot for v1.
  underlying: "INDEX_SPOT"; // reserved enum; FUT later
}
```

---

## 2. Leg parameter model (the heart)

A leg = one option contract intent + its own risk envelope. Order of fields below is the order they appear in the leg card UI.

```ts
export interface Leg {
  id: string; // stable; used for re-entry bookkeeping
  enabled: boolean; // default true; lets users mute a leg without deleting

  // --- Identity ---
  optionType: "CE" | "PE";
  side: "buy" | "sell"; // maps to PayoffLeg.direction long|short
  lots: number; // >=1 integer; engine qty = lots * LOT_SIZE[symbol]

  // --- Strike selection (one tabbed control, AlgoTest breadth) ---
  strike: StrikeSelector;

  // --- Expiry selection ---
  expiry: ExpirySelector;

  // --- Per-leg risk (Advanced; all optional) ---
  stopLoss?: RiskTrigger; // exit THIS leg (or whole strategy, see squareOff)
  target?: RiskTrigger;
  trailingStop?: TrailingStop; // Trail X / Trail Y
  squareOff?: "partial" | "complete"; // default "partial"
  reEntry?: ReEntry;

  // --- Per-leg entry/exit overrides (Advanced) ---
  // If omitted, the leg uses strategy timing. Lets one leg enter late, etc.
  entryOffsetMin?: number; // minutes after strategy entry (>=0)
  exitOffsetMin?: number; // minutes before strategy exit (>=0)
}
```

### 2.1 Strike selector (the richest control)

One discriminated union; the UI is a tab strip `[ ATM± | % | Premium | Delta | Exact ]`.

```ts
export type StrikeSelector =
  | { mode: "atm"; offset: number } // offset in STRIKES. 0=ATM, +n=OTM, -n=ITM
  | { mode: "percent"; offsetPct: number } // % from spot, signed (+OTM / -ITM)
  | {
      mode: "premium";
      target: number; // ₹ premium to match
      band?: { min: number; max: number };
    } // optional acceptable range
  | {
      mode: "delta";
      target: number; // 0..1 (abs delta), e.g. 0.20
      tolerance?: number;
    } // ± match window, default 0.05
  | { mode: "exact"; strike: number }; // absolute strike price
```

**Engine mapping (resolution algorithm, per entry):**

| mode      | resolution                                                                                        | missing-strike fallback                                                                          |
| --------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `atm`     | round spot to nearest valid strike step (NIFTY/BANKNIFTY=50, SENSEX=100), then ± `offset × step`. | step outward to nearest **available & liquid** strike; record `served ≠ requested`, `coverage%`. |
| `percent` | `spot × (1 + offsetPct/100)`, round to nearest valid strike.                                      | same.                                                                                            |
| `premium` | among strikes of this `optionType` with data at entry candle, pick min `                          | close − target                                                                                   | `; if `band`, restrict to band first. | if none in band → relax to nearest premium; if none at all → leg flagged `no-data` for that cycle (skip that day, not the whole run). |
| `delta`   | compute Black-76/BS delta from candle IV (or interpolate from chain); pick min `                  | abs(delta) − target                                                                              | `within`tolerance`.                   | widen tolerance, then fall back to `premium`-equivalent; flag if still none.                                                          |
| `exact`   | direct lookup.                                                                                    | nearest available strike + loud coverage chip; this mode is the _least_ portable, warn user.     |

> **Resolution output** (engine-internal, surfaced in results, not part of input schema):
> `{ requested, served, coverage, premiumAtEntry, deltaAtEntry, liquidityFlag }`.

**Defaults:** new leg → `{ mode: "atm", offset: 0 }`.

**Validation:** `atm.offset` integer in `[-20, 20]`; `percent.offsetPct` in `[-15, 15]`; `premium.target > 0`; `delta.target` in `(0, 1)`; `delta.tolerance` in `(0, 0.5]`; `exact.strike` must be a multiple of the symbol strike step.

### 2.2 Expiry selector

```ts
export type ExpirySelector =
  | { mode: "weekly"; which: number } // 0 = nearest weekly, 1 = next, ...
  | { mode: "monthly"; which: number } // 0 = current month, 1 = next, ...
  | { mode: "specific"; date: string }; // ISO; for fixed-date single backtests
```

**Default:** `{ mode: "weekly", which: 0 }` (NIFTY/BANKNIFTY/SENSEX all have weeklies in-dataset; SENSEX from 2022).

**Validation:** `which` in `[0, 6]`. On resolution, if the requested weekly/monthly expiry parquet is absent (patchy coverage), fall back to nearest available expiry and flag.

### 2.3 Risk trigger (SL / Target) — the two-axis control

```ts
export interface RiskTrigger {
  unit: "pct" | "pts"; // percentage vs absolute points
  basis: "premium" | "underlying"; // SL on option price vs SL on the index (AlgoTest "SL UL")
  value: number; // >0
  refPrice?: "traded" | "trigger"; // Tgt/SL ref: entry fill vs trigger price; default "traded"
}
```

**Mapping:**

- `basis:"premium", unit:"pct", value:40` on a **sell** leg → exit when option price rises to `entryPremium × 1.40`.
- `basis:"premium", unit:"pct", value:50` on a **buy** leg → exit when option price falls to `entryPremium × 0.50`.
- `basis:"underlying"` → trigger compares the **index spot** move vs entry spot (AlgoTest's "SL UL %/Pts"). Direction inferred from leg side + option type.
- `target` is the mirror.

**Defaults (when user enables, smart-seeded):** SL `{unit:"pct", basis:"premium", value:40}`, Target `{unit:"pct", basis:"premium", value:70}`.

### 2.4 Trailing stop (Trail X / Trail Y)

```ts
export interface TrailingStop {
  unit: "pct" | "pts";
  trailEvery: number; // X: favorable move that triggers a trail step
  trailBy: number; // Y: amount to tighten SL by, each step
  toBreakeven?: boolean; // "Trail SL to breakeven" once in profit; default false
}
```

**Mapping:** every time price moves `trailEvery` in favor (cumulative), move SL by `trailBy` in the favorable direction. Operates on the same `basis` as the leg's `stopLoss` (must have a `stopLoss` defined; validation error otherwise).

### 2.5 Square-off interaction

- `squareOff: "partial"` (default) — this leg's SL/target closes **only this leg**; siblings continue.
- `squareOff: "complete"` — this leg hitting SL/target closes the **entire strategy** that cycle (AlgoTest's Partial vs Complete). Engine-level rule: _any leg complete → flatten all_.

### 2.6 Re-entry (plain-language presets)

```ts
export interface ReEntry {
  mode: "new_atm" | "new_atm_reverse" | "at_cost" | "on_momentum";
  maxCount: number; // 1..5
  stopAfter?: string; // "HH:mm" IST; no re-entry after this time
  momentum?: { unit: "pct" | "pts"; value: number }; // required iff mode involves momentum
}
```

| `mode`            | UI label                     | behavior                                                        | AlgoTest equiv |
| ----------------- | ---------------------------- | --------------------------------------------------------------- | -------------- |
| `new_atm`         | "Re-enter at new ATM"        | after SL/target, re-select fresh ATM strike, re-enter at market | RE ASAP        |
| `new_atm_reverse` | "Re-enter, reverse side"     | re-enter new ATM with opposite side                             | RE ASAP ↩      |
| `at_cost`         | "Re-enter at original price" | wait for option to return to prior entry price                  | RE COST        |
| `on_momentum`     | "Re-enter on momentum"       | re-enter only after `momentum` move confirmed                   | RE MOMENTUM    |

**Defaults:** `maxCount: 1`.

**Validation:** `on_momentum` requires `momentum`; `maxCount` in `[1,5]`; `stopAfter` ≤ strategy exit time.

---

## 3. Timing config

```ts
export interface TimingConfig {
  mode: "fixed_time" | "indicator"; // MVP ships fixed_time; indicator = Advanced/later
  entryTime: string; // "HH:mm" IST, e.g. "09:20"
  exitTime: string; // "HH:mm" IST, e.g. "15:15" (hard square-off)
  daysOfWeek?: ("MON" | "TUE" | "WED" | "THU" | "FRI")[]; // default all 5
  daysFromExpiry?: number[]; // e.g. [0,1] = only expiry & T-1; empty = every day

  // Advanced (mode === "indicator")
  entryConditions?: IndicatorRule[]; // ALL must be true (AND)
  exitConditions?: IndicatorRule[];
}

export interface IndicatorRule {
  indicator: "EMA" | "SMA" | "RSI" | "VWAP" | "SUPERTREND" | "PRICE";
  params: Record<string, number>; // e.g. { length: 20 }
  comparator: "gt" | "lt" | "cross_above" | "cross_below" | "gte" | "lte";
  rhs:
    | { type: "value"; value: number }
    | { type: "indicator"; indicator: IndicatorRule["indicator"]; params: Record<string, number> };
  on: "underlying" | "leg_premium"; // what series the rule reads
}
```

**Defaults:** `{ mode:"fixed_time", entryTime:"09:20", exitTime:"15:15", daysOfWeek: all 5 }`.

**Validation:** `entryTime < exitTime`; both within `09:15`–`15:30` IST; `daysFromExpiry` entries `0..7`; indicator block ignored unless `mode==="indicator"`. Entry always re-validated against actual candle availability.

**Engine mapping:** fixed-time is the simplest path — at `entryTime` on each qualifying trading day, resolve all leg strikes, take fills; at any leg SL/target (respecting square-off), or at `exitTime`, close. A "trade" in results = one trading **day/cycle** (AlgoTest convention).

---

## 4. Overall (strategy MTM) risk

```ts
export interface OverallRisk {
  stopLoss?: { unit: "pct" | "rupees"; value: number }; // MTM SL (e.g. -5000 ₹)
  target?: { unit: "pct" | "rupees"; value: number };
  trailing?: {
    unit: "pct" | "rupees";
    trailEvery: number;
    trailBy: number;
  };
  lockAndTrail?: {
    // AlgoTest "Lock & Trail"
    lockMinProfitAt: number; // ₹ MTM at which to lock
    trailMinProfitBy: number; // ₹ to ratchet the lock by, per step
  };
  maxLossRupees?: number; // hard absolute floor; redundant-safe with stopLoss
  reEntryOnOverall?: boolean; // re-arm legs after an overall SL hit (default false)
}
```

**Mapping:** evaluated on the **net MTM across all live legs each candle**, _after_ `computeCharges` if `execution.applyChargesIntraday` is set (default: charges applied at close only, for speed). On breach → flatten all legs that cycle. `lockAndTrail` ratchets a floor upward as profit grows.

**Defaults:** all empty (no overall risk) — but the wizard's "Risk" step **pre-suggests** `stopLoss {unit:"rupees", value: -1.5 × estimated premium collected}` for net-credit strategies, with a one-tap accept.

---

## 5. Execution / cost model

Binds directly to `computeCharges` (`Segment="OPT"`).

```ts
export interface ExecutionConfig {
  broker: "zerodha" | "upstox" | "groww" | "angelone" | "custom";
  product: "MIS" | "NRML"; // intraday vs carryforward; default MIS
  slippage: { unit: "pct" | "pts"; value: number }; // applied adverse on every fill
  fillModel: "candle_close" | "candle_open" | "next_candle_open"; // default candle_close
  applyChargesIntraday?: boolean; // default false (apply at exit only)
  marginModel?: "span_exposure" | "premium_only"; // for capital/ROI calc; default span_exposure
}
```

**Defaults:** `{ broker:"zerodha", product:"MIS", slippage:{unit:"pts", value:1}, fillModel:"candle_close" }`.

**Mapping:** each simulated fill → adverse slippage applied → leg booked → on close, `computeCharges(profile, {segment:"OPT", ...})` produces STT/GST/stamp/brokerage netted into P&L. Slippage default of 1 pt is honest for index options; surface it in results so users see it's modeled.

---

## 6. Validation rules (summary table)

| Field                       | Rule                                                        | On violation                       |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| `legs.length`               | 1–8                                                         | block Next; "Add at least one leg" |
| `lots`                      | integer ≥ 1, ≤ 100                                          | inline error                       |
| `strike.*`                  | per-mode ranges (§2.1)                                      | inline error                       |
| `exact.strike`              | multiple of strike step                                     | snap + warn                        |
| `dateRange`                 | start ≤ end; within dataset (NIFTY/BN ≥2021, SENSEX ≥2022)  | clamp + coverage chip              |
| `entryTime < exitTime`      | required                                                    | inline error                       |
| `trailingStop` present      | requires `stopLoss` present                                 | inline error                       |
| `reEntry.on_momentum`       | requires `momentum`                                         | inline error                       |
| `overallRisk.stopLoss` sign | rupees SL negative or pct positive (normalize)              | auto-normalize                     |
| net structure               | warn if undefined-risk naked short with no SL (educational) | non-blocking warning chip          |

**Validation timing:** validate **on "Next"** per wizard step (block advance, descriptive inline errors); Back never clears valid data; autosave whole `Strategy` to `localStorage` per field change and rehydrate.

---

## 7. MVP vs Advanced tiering

**MVP (ship first — covers ~90% of retail strategies):**

- Market: symbol, interval (1m/5m/1d), date range, coverage chip.
- Legs: `optionType`, `side`, `lots`, strike modes `atm` + `percent` + `exact`, expiry `weekly`/`monthly`.
- Per-leg `stopLoss` + `target` (premium basis, %/pts only). `squareOff` partial/complete.
- Timing: `fixed_time` only — entry/exit, days of week, days-from-expiry.
- Overall risk: `stopLoss`, `target` (rupees + pct), `maxLossRupees`.
- Execution: broker, product, slippage, candle_close fill. Charges via `computeCharges`.

**Advanced (progressive disclosure, behind "Advanced" toggles):**

- Strike `premium` + `delta` modes (need IV/chain pricing).
- `basis:"underlying"` SL/target ("SL UL").
- `trailingStop` (Trail X/Y, to-breakeven), `reEntry` (all 4 modes).
- Per-leg `entryOffsetMin`/`exitOffsetMin`.
- Overall `trailing`, `lockAndTrail`, `reEntryOnOverall`.
- Timing `indicator` mode (`IndicatorRule`).
- Execution `fillModel` alternatives, `applyChargesIntraday`, `marginModel`.

**Disclosure defaults:** strike opens on `ATM`; risk opens on simple overall MTM; everything above is one click away.

---

## 8. UI wireframes (ASCII)

**Wizard shell — persistent stepper + live preview right rail:**

```
┌──────────────────────────────────────────────────────────────────────┐
│  ●━━━━━●━━━━━○━━━━━○      New Backtest                    [⌘K] [Save] │
│  1 Market 2 Legs 3 Timing 4 Risk · Review                              │
├───────────────────────────────────────┬──────────────────────────────┤
│  STEP 2 · LEGS                         │  LIVE PREVIEW                 │
│                                        │  ┌────────────────────────┐   │
│  ┌── Leg 1 ───────────────────────┐    │  │   payoff diagram       │   │
│  │ [PE]  ( Buy ● Sell )   Lots [1]│    │  │    ╱‾‾‾‾‾╲             │   │
│  │ Strike:[ ATM± │ % │ Prem │ Δ │…]│   │  │ ──╱───────╲──── spot   │   │
│  │   ATM offset: [ −1  0 ●+1 +2 ] │    │  └────────────────────────┘   │
│  │ Expiry: ( Weekly ▾ ) nearest   │    │  Max P  +₹4,200               │
│  │ ▸ Advanced (SL/Tgt/Trail/Re)   │    │  Max L  −₹8,800               │
│  └────────────────────────────────┘    │  Breakeven 24,180 / 24,820    │
│                                        │  PoP 61%   Margin ₹1.2L       │
│  ┌── Leg 2 ──────────────────  [×]┐    │  ─────────────────────────    │
│  │ [CE]  ( Buy ● Sell )   Lots [1]│    │  Coverage  ███████░░ 82%      │
│  │ … (same controls)              │    │  served 24800 (req 24800 ✓)   │
│  └────────────────────────────────┘    │                              │
│  [ + Add leg ]   [ ⌥ Build from template ]                            │
├───────────────────────────────────────┴──────────────────────────────┤
│                                          [ ← Back ]      [ Next → ]    │
└──────────────────────────────────────────────────────────────────────┘
```

**Strike selector (tabbed, single control replacing AlgoTest's 5 fields):**

```
Strike  ┌─[ATM±]─┬─[ %  ]─┬─[Prem]─┬─[ Δ  ]─┬─[Exact]─┐
        │ offset in strikes:  [−2][−1][ 0●][+1][+2]   │
        │ resolves to ≈ 24800 CE  ·  step 50          │
        └──────────────────────────────────────────────┘
   (Prem tab) target ₹[ 40 ]  band ₹[30]–₹[55]  → nearest: 24850 (₹42)
   (Δ tab)    delta  [0.20]   ± [0.05]            → nearest: 24900 (Δ0.18)
```

**Per-leg risk (Advanced, one card, two-axis control):**

```
▾ Advanced — Leg 1 risk
  Stop loss   value[ 40 ]  unit( % ● pts )  on( premium ● underlying )
  Target      value[ 70 ]  unit( % ● pts )  on( premium ● underlying )
  Trailing    every[ 25 ] move-SL-by[ 10 ]  ( % ● pts )  □ to breakeven
  Square off  ( Only this leg ●  | Whole strategy )
  Re-entry    [ Re-enter at new ATM ▾ ]  max[ 2 ]  stop after[ 15:00 ]
```

**Mobile leg editor = modal bottom sheet** (scrim #000/20%, ≤16:9 initial, drag handle + X), one leg per sheet, snap to full height with internal scroll.

---

## 9. Example strategies (5 concrete JSON objects)

### 9.1 Short Straddle (intraday, NIFTY) — MVP

```json
{
  "schemaVersion": 1,
  "id": "str-001",
  "name": "9:20 Short Straddle — NIFTY weekly",
  "tags": ["neutral", "theta", "intraday"],
  "market": {
    "symbol": "NIFTY",
    "interval": "1m",
    "dateRange": { "start": "2024-01-01", "end": "2025-12-31" },
    "underlying": "INDEX_SPOT"
  },
  "legs": [
    {
      "id": "l1",
      "enabled": true,
      "optionType": "CE",
      "side": "sell",
      "lots": 1,
      "strike": { "mode": "atm", "offset": 0 },
      "expiry": { "mode": "weekly", "which": 0 },
      "stopLoss": { "unit": "pct", "basis": "premium", "value": 30 },
      "squareOff": "partial"
    },
    {
      "id": "l2",
      "enabled": true,
      "optionType": "PE",
      "side": "sell",
      "lots": 1,
      "strike": { "mode": "atm", "offset": 0 },
      "expiry": { "mode": "weekly", "which": 0 },
      "stopLoss": { "unit": "pct", "basis": "premium", "value": 30 },
      "squareOff": "partial"
    }
  ],
  "timing": {
    "mode": "fixed_time",
    "entryTime": "09:20",
    "exitTime": "15:15",
    "daysOfWeek": ["MON", "TUE", "WED", "THU", "FRI"]
  },
  "risk": { "stopLoss": { "unit": "rupees", "value": -6000 }, "maxLossRupees": -8000 },
  "execution": {
    "broker": "zerodha",
    "product": "MIS",
    "slippage": { "unit": "pts", "value": 1 },
    "fillModel": "candle_close"
  }
}
```

### 9.2 Short Strangle (premium-based strikes, BANKNIFTY) — Advanced

```json
{
  "schemaVersion": 1,
  "id": "stg-001",
  "name": "₹60 Strangle — BANKNIFTY, trail + reentry",
  "tags": ["neutral", "premium-selection"],
  "market": {
    "symbol": "BANKNIFTY",
    "interval": "1m",
    "dateRange": { "start": "2024-06-01", "end": "2026-06-01" },
    "underlying": "INDEX_SPOT"
  },
  "legs": [
    {
      "id": "l1",
      "enabled": true,
      "optionType": "CE",
      "side": "sell",
      "lots": 2,
      "strike": { "mode": "premium", "target": 60, "band": { "min": 45, "max": 80 } },
      "expiry": { "mode": "weekly", "which": 0 },
      "stopLoss": { "unit": "pct", "basis": "premium", "value": 50 },
      "trailingStop": { "unit": "pct", "trailEvery": 20, "trailBy": 10, "toBreakeven": true },
      "reEntry": { "mode": "new_atm", "maxCount": 2, "stopAfter": "14:30" },
      "squareOff": "partial"
    },
    {
      "id": "l2",
      "enabled": true,
      "optionType": "PE",
      "side": "sell",
      "lots": 2,
      "strike": { "mode": "premium", "target": 60, "band": { "min": 45, "max": 80 } },
      "expiry": { "mode": "weekly", "which": 0 },
      "stopLoss": { "unit": "pct", "basis": "premium", "value": 50 },
      "trailingStop": { "unit": "pct", "trailEvery": 20, "trailBy": 10, "toBreakeven": true },
      "reEntry": { "mode": "new_atm", "maxCount": 2, "stopAfter": "14:30" },
      "squareOff": "partial"
    }
  ],
  "timing": {
    "mode": "fixed_time",
    "entryTime": "09:30",
    "exitTime": "15:10",
    "daysOfWeek": ["MON", "TUE", "WED", "THU", "FRI"],
    "daysFromExpiry": [0, 1]
  },
  "risk": {
    "trailing": { "unit": "rupees", "trailEvery": 3000, "trailBy": 1500 },
    "lockAndTrail": { "lockMinProfitAt": 4000, "trailMinProfitBy": 1000 },
    "stopLoss": { "unit": "rupees", "value": -10000 }
  },
  "execution": {
    "broker": "zerodha",
    "product": "MIS",
    "slippage": { "unit": "pct", "value": 0.5 },
    "fillModel": "next_candle_open"
  }
}
```

### 9.3 Iron Condor (4 legs, NIFTY) — MVP+

```json
{
  "schemaVersion": 1,
  "id": "ic-001",
  "name": "Iron Condor — NIFTY weekly, defined risk",
  "tags": ["neutral", "defined-risk"],
  "market": {
    "symbol": "NIFTY",
    "interval": "5m",
    "dateRange": { "start": "2024-01-01", "end": "2025-12-31" },
    "underlying": "INDEX_SPOT"
  },
  "legs": [
    {
      "id": "sc",
      "enabled": true,
      "optionType": "CE",
      "side": "sell",
      "lots": 1,
      "strike": { "mode": "atm", "offset": 2 },
      "expiry": { "mode": "weekly", "which": 0 },
      "squareOff": "complete"
    },
    {
      "id": "bc",
      "enabled": true,
      "optionType": "CE",
      "side": "buy",
      "lots": 1,
      "strike": { "mode": "atm", "offset": 5 },
      "expiry": { "mode": "weekly", "which": 0 },
      "squareOff": "complete"
    },
    {
      "id": "sp",
      "enabled": true,
      "optionType": "PE",
      "side": "sell",
      "lots": 1,
      "strike": { "mode": "atm", "offset": -2 },
      "expiry": { "mode": "weekly", "which": 0 },
      "squareOff": "complete"
    },
    {
      "id": "bp",
      "enabled": true,
      "optionType": "PE",
      "side": "buy",
      "lots": 1,
      "strike": { "mode": "atm", "offset": -5 },
      "expiry": { "mode": "weekly", "which": 0 },
      "squareOff": "complete"
    }
  ],
  "timing": {
    "mode": "fixed_time",
    "entryTime": "09:25",
    "exitTime": "15:15",
    "daysOfWeek": ["MON", "TUE", "WED", "THU", "FRI"]
  },
  "risk": { "stopLoss": { "unit": "pct", "value": 60 }, "target": { "unit": "pct", "value": 50 } },
  "execution": {
    "broker": "upstox",
    "product": "MIS",
    "slippage": { "unit": "pts", "value": 1 },
    "fillModel": "candle_close"
  }
}
```

> **Note:** `risk.stopLoss.unit:"pct"` here = % of max-loss / premium collected; the engine resolves pct-of-credit for net-credit structures.

### 9.4 Directional Bull Call Spread (delta-selected, SENSEX) — Advanced

```json
{
  "schemaVersion": 1,
  "id": "dir-001",
  "name": "Bull Call Spread — SENSEX, delta strikes",
  "tags": ["bullish", "delta-selection", "defined-risk"],
  "market": {
    "symbol": "SENSEX",
    "interval": "5m",
    "dateRange": { "start": "2023-01-01", "end": "2025-12-31" },
    "underlying": "INDEX_SPOT"
  },
  "legs": [
    {
      "id": "long",
      "enabled": true,
      "optionType": "CE",
      "side": "buy",
      "lots": 1,
      "strike": { "mode": "delta", "target": 0.55, "tolerance": 0.05 },
      "expiry": { "mode": "weekly", "which": 0 },
      "target": { "unit": "pct", "basis": "premium", "value": 80 },
      "stopLoss": { "unit": "pct", "basis": "premium", "value": 40 },
      "squareOff": "complete"
    },
    {
      "id": "short",
      "enabled": true,
      "optionType": "CE",
      "side": "sell",
      "lots": 1,
      "strike": { "mode": "delta", "target": 0.25, "tolerance": 0.05 },
      "expiry": { "mode": "weekly", "which": 0 },
      "squareOff": "complete"
    }
  ],
  "timing": {
    "mode": "fixed_time",
    "entryTime": "09:30",
    "exitTime": "15:05",
    "daysOfWeek": ["MON", "TUE", "WED", "THU", "FRI"]
  },
  "risk": {
    "target": { "unit": "rupees", "value": 3000 },
    "stopLoss": { "unit": "rupees", "value": -1500 }
  },
  "execution": {
    "broker": "angelone",
    "product": "MIS",
    "slippage": { "unit": "pct", "value": 0.5 },
    "fillModel": "candle_close",
    "marginModel": "premium_only"
  }
}
```

### 9.5 Indicator-based ATM Buy (NIFTY, RSI + VWAP) — Advanced/later

```json
{
  "schemaVersion": 1,
  "id": "ind-001",
  "name": "ORB momentum — NIFTY ATM CE on RSI>60 above VWAP",
  "tags": ["directional", "indicator"],
  "market": {
    "symbol": "NIFTY",
    "interval": "5m",
    "dateRange": { "start": "2024-01-01", "end": "2025-12-31" },
    "underlying": "INDEX_SPOT"
  },
  "legs": [
    {
      "id": "l1",
      "enabled": true,
      "optionType": "CE",
      "side": "buy",
      "lots": 1,
      "strike": { "mode": "atm", "offset": 0 },
      "expiry": { "mode": "weekly", "which": 0 },
      "stopLoss": { "unit": "pct", "basis": "premium", "value": 35 },
      "target": { "unit": "pct", "basis": "premium", "value": 75 },
      "trailingStop": { "unit": "pct", "trailEvery": 25, "trailBy": 12 },
      "squareOff": "complete"
    }
  ],
  "timing": {
    "mode": "indicator",
    "entryTime": "09:30",
    "exitTime": "15:00",
    "daysOfWeek": ["MON", "TUE", "WED", "THU", "FRI"],
    "entryConditions": [
      {
        "indicator": "RSI",
        "params": { "length": 14 },
        "comparator": "gt",
        "rhs": { "type": "value", "value": 60 },
        "on": "underlying"
      },
      {
        "indicator": "PRICE",
        "params": {},
        "comparator": "cross_above",
        "rhs": { "type": "indicator", "indicator": "VWAP", "params": {} },
        "on": "underlying"
      }
    ],
    "exitConditions": [
      {
        "indicator": "RSI",
        "params": { "length": 14 },
        "comparator": "lt",
        "rhs": { "type": "value", "value": 45 },
        "on": "underlying"
      }
    ]
  },
  "risk": { "maxLossRupees": -4000 },
  "execution": {
    "broker": "groww",
    "product": "MIS",
    "slippage": { "unit": "pts", "value": 1 },
    "fillModel": "next_candle_open"
  }
}
```

---

## 10. Engine contract (how the schema flows through)

```
Strategy JSON
   │  validate (§6) → reject/normalize
   ▼
For each trading day in dateRange ∩ daysOfWeek ∩ daysFromExpiry:
   1. At entry trigger (fixed_time entryTime  OR  entryConditions all true):
        for each enabled leg →
          resolve StrikeSelector + ExpirySelector against duckdb-wasm HF slice
          → { served, requested, coverage, premiumAtEntry, deltaAtEntry }
          if no-data → skip leg this cycle, flag coverage gap (NOT a crash)
          apply slippage, book fill  → produce PayoffLeg{strike,optionType,direction,qty,premium}
   2. Per candle until exitTime:
        evaluate per-leg SL/target/trailing (respect squareOff partial|complete)
        evaluate OverallRisk on net MTM (payoff.ts strategyPayoffAt for unrealized)
        handle reEntry up to maxCount
   3. At exit (trigger or hard exitTime): flatten all live legs
   4. computeCharges(brokerProfile, OPT fills) → net day P&L  → append to trade-day series
   ▼
Aggregate → equity curve, drawdown, win%, expectancy, Return/MaxDD
   → src/lib/montecarlo: resample trade-day sequence → 95th-pct drawdown cone
   ▼
Results (verdict → evidence → drill-down), coverage chips honest throughout
```

**Key files referenced (absolute paths):**

- Schema / types to create: `c:\Users\raash\Desktop\trading-journal\src\lib\backtest\schema.ts`
- Payoff primitives (reuse): `c:\Users\raash\Desktop\trading-journal\src\lib\options\payoff.ts` — `PayoffLeg`, `legPayoffAt`, `strategyPayoffAt`, `buildPayoffCurve`
- Charges (reuse): `c:\Users\raash\Desktop\trading-journal\src\lib\charges\charges.ts` — `computeCharges(profile, {segment:"OPT", ...})`, `Segment`, `Product`
- Monte-Carlo drawdown (reuse): `c:\Users\raash\Desktop\trading-journal\src\lib\montecarlo\simulate.ts` + `montecarlo.worker.ts`

**Net design thesis:** one versioned `Strategy` object expresses _intent_ (portable strike/expiry selectors, two-axis risk, plain-language re-entry); the engine resolves intent against patchy HF data and records served-vs-requested coverage on every fill; the wizard exposes only `atm` / simple-MTM / fixed-time by default and discloses AlgoTest's full depth behind one click — matching AlgoTest's parameter breadth while beating all five competitors on honest missing-strike handling.
