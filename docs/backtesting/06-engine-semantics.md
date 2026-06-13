# Backtest Engine Semantics

> **Status:** implementation-ready · **Engine version anchor:** `engineVersion = "1.0.0"` · **Module root:** `src/lib/backtest/`
>
> **One-line thesis:** a pure, deterministic, single-threaded-per-run bar-replay engine that iterates 1-minute bars in IST, marks legs from option OHLC (never spot-implied), books realized P&L through the _existing_ `computeCharges`, and treats missing/illiquid strikes as a first-class, surfaced state — running entirely in a Web Worker over duckdb-wasm slices so anonymous runs cost **$0**.

This document specifies the **deterministic option-strategy backtest core** that the no-code builder (and later the bring-your-own-code harness) feeds. It is the contract an implementation workflow builds from **verbatim**. Where this spec references existing modules (`computeCharges`, `legPayoffAt`, `runSimulation`, …), those are **imported, not modified**.

---

## Table of contents

1. [Module map](#0-module-map)
2. [Core data model & bar iteration](#1-core-data-model--bar-iteration)
3. [Option mark-to-market](#2-option-mark-to-market)
4. [Fill model & slippage](#3-fill-model--slippage)
5. [Entry / exit conditions](#4-entry--exit-conditions)
6. [Risk: per-leg, overall MTM, square-off interaction](#5-risk-per-leg-overall-mtm-square-off-interaction)
7. [Re-entry / re-execute](#6-re-entry--re-execute)
8. [Square-off, expiry, trading-day boundary](#7-square-off-expiry-trading-day-boundary)
9. [Strike resolution against AVAILABLE strikes](#8-strike-resolution-against-available-strikes)
10. [Market-calendar module](#9-market-calendar-module)
11. [Client-side performance strategy](#10-client-side-performance-strategy)
12. [Outputs](#11-outputs)
13. [Determinism, edge cases, honesty contract](#12-determinism-edge-cases-honesty-contract)
14. [Build order](#13-build-order)
15. [Integration facts (verified against the codebase)](#14-integration-facts)

---

## 0. Module map

Where each piece lives. All new code is greenfield under `src/lib/backtest/`; the four reused modules are imported.

```
src/lib/backtest/
  types.ts             # StrategyConfig, Leg, RiskConfig, BacktestResult, Trade, Fill … (pure types)
  calendar.ts          # market-calendar: holidays, sessions, isTradingDay, expiries   ← NEW, §9
  calendar.data.ts     # NSE/BSE holiday tables 2021–2027 (DATA, like brokers.ts)      ← NEW
  data-access.ts       # DuckDB-wasm query layer: loadIndexBars / loadOptionBars / strikeCoverage
  resolve-strike.ts    # offset / premium / delta → an AVAILABLE strike (graceful fallback) §8
  fill-model.ts        # bar → fill price + slippage §3
  engine.ts            # runBacktest(config, dataProvider): the bar-replay state machine §1–7
  engine.worker.ts     # Web Worker wrapper (mirrors montecarlo.worker.ts) §10
  metrics.ts           # equity curve, drawdown, win%, expectancy, Return/MaxDD … §11
  engine.test.ts  resolve-strike.test.ts  calendar.test.ts  fill-model.test.ts
```

**Reuse, do not reinvent:**

| Need                             | Reuse                                                          | Location                                  |
| -------------------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| Realized round-trip charges      | `computeCharges(profile, t)`                                   | `src/lib/charges/charges.ts`              |
| Gross P&L                        | `computeGrossPnl(t)`                                           | `src/lib/charges/charges.ts`              |
| Active broker profile            | `getChargeProfile(id)` (default → Zerodha)                     | `src/config/brokers.ts`                   |
| Per-leg payoff / preview         | `legPayoffAt`, `buildPayoffCurve`, `classifyStrategy`          | `src/lib/options/payoff.ts`               |
| Monte-Carlo drawdown cone        | `runSimulation`, `extractRSamples`, `mulberry32`, `percentile` | `src/lib/montecarlo/simulate.ts`          |
| Worker request/response contract | message pattern to copy                                        | `src/lib/montecarlo/montecarlo.worker.ts` |

---

## 1. Core data model & bar iteration

### 1.1 Time base and the canonical bar

All time is **IST (Asia/Kolkata, UTC+5:30), no DST**. Internally the engine works in **integer epoch-ms**, but every boundary decision (session open/close, entry/exit time, EOD square-off) is made against an **IST minute-of-day** integer `0…1439` to avoid timezone drift.

Bars are **left-labelled**: a bar timestamped `09:15` covers the interval `[09:15:00, 09:16:00)` and its `close` is the price _at the end_ of that minute (i.e. as of `09:16:00`). This is the NSE/BSE 1-min convention and it dictates the fill model (§3).

```ts
interface Bar {
  ts: number; // epoch-ms, IST minute boundary (left edge)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // volume (contracts); 0 ⇒ illiquid this minute
  oi?: number; // open interest (options only)
}
type Series = Bar[]; // ASCENDING by ts; gaps are real (§7.4), not assumed away
```

The **regular session** is `09:15–15:30` IST for index/options on both NSE and BSE. There is **no pre-open and no post-close** in the dataset; the engine ignores anything outside `[09:15, 15:30)`. MCX/CDS are out of scope — only NIFTY/BANKNIFTY/SENSEX index + options.

**Minute-of-day reference points** (memorize these — they recur throughout):

```
09:15  →  555   (session open, first tradeable bar)
15:29  →  929   (hard EOD square-off cap; leaves 1 min of liquidity)
15:30  →  930   (session close; engine never trades this bar)
minuteOfDay(ts) = ISTHours(ts) * 60 + ISTMinutes(ts)
```

### 1.2 StrategyConfig (the no-code builder's output)

```ts
type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
const LOT_SIZE: Record<IndexSymbol, number> = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 };

interface StrategyConfig {
  schemaVersion: 1; // bump on breaking change; persisted with saved strategies
  index: IndexSymbol;
  interval: 1 | 3 | 5 | 15; // minutes; data is 1-min, ≥3 is resampled (§1.4)
  dateRange: { from: string; to: string }; // YYYY-MM-DD inclusive, IST trading days
  legs: Leg[]; // 1..8
  entry: EntryRule; // §4
  exit: ExitRule; // §4
  perLegRisk: boolean; // toggle: per-leg risk active
  overall: OverallRisk; // §5 (MTM SL/target/trail/lock/maxloss)
  reentry: ReentryConfig; // §6
  squareOff: "partial" | "complete"; // §5.3
  expiryRule: ExpiryRule; // §7 weekly/monthly selection
  chargeProfileId: string; // → getChargeProfile
  slippage: SlippageConfig; // §3.2
  seed: number; // determinism anchor (§12); default 0xC0FFEE
}

interface Leg {
  id: string; // stable within a config (used in trade attribution)
  optionType: "CE" | "PE";
  direction: "long" | "short"; // Buy / Sell
  lots: number; // multiplied by LOT_SIZE[index] → qty
  strikeSel: StrikeSelector; // §8
  legRisk?: LegRisk; // §5 (only when perLegRisk)
}
```

**Qty convention matches the codebase:** `qty = lots × LOT_SIZE[index]` and is stored **already lot-scaled** (exactly how `payoff.ts` and `charges.ts` expect — see `PayoffLeg.qty` comment: "qty already includes the lot size").

### 1.3 The iteration loop (one trading day at a time)

The engine is a **day-segmented bar replay**. Index options are intraday-or-expiry instruments here, and the dataset is partitioned per-`trading_day`, so we replay **one trading day fully, square off, then advance** — never carrying an open intraday position across the EOD boundary. v1 is **intraday-only**: square off every leg at `exit.time` or `15:29`, whichever is first.

```
for each tradingDay D in calendar(dateRange, index):       # §9, skips weekends + holidays
    legBars   = { leg → optionSeries(resolvedStrike, expiry, D) }   # §8 resolves strikes once per day at/just-before entry
    indexBars = indexSeries(D)
    align all series onto the master 1-min grid of D         # §1.4, §7.4 gap policy
    state = freshDayState()
    for each minute bar b in D (ascending):
        if b.minuteOfDay  < entryMinute:         continue          # waiting room
        if not state.open and entryCondTrue(b):  OPEN  (§4 entry)  # resolve + fill all legs
        if state.open:
            markToMarket(b)                                        # §2 from option close
            applyPerLegRisk(b)         # §5.1 — may square some/all legs
            applyOverallMtmRisk(b)     # §5.2 — may square the whole strategy
            maybeReenter(b)            # §6 — after a leg/strategy SL/target
        if b.minuteOfDay >= exitMinute or b.minuteOfDay >= 929:    # 15:29
            FORCE SQUARE-OFF
    bookDay(state)                                                 # realize → charges → trade-day record
```

**Why day-segmented:**

1. Matches the HF parquet partitioning (`trading_day`), so each day is one bounded DuckDB slice.
2. Gives a clean "trade = trading-day cycle" unit — exactly how AlgoTest and Indian options traders count trades.
3. Bounds worker memory to one day of bars at a time (§10).

### 1.4 Interval resampling (≥3-min)

Data is native 1-min. For `interval ∈ {3,5,15}` the engine **resamples on the fly**: group consecutive 1-min bars into `interval`-aligned buckets anchored to `09:15` (`09:15–09:17` = first 3-min bar, etc.). Bucket OHLC:

```
o = first.o      h = max(h_i)      l = min(l_i)      c = last.c      v = Σ v_i
```

**Risk checks always run at native 1-min resolution regardless of `interval`.** `interval` governs only _entry/exit-condition evaluation_ (indicator/time bars), never the intrabar SL/target scan. This is a deliberate, opinionated split: a 5-min strategy must still honour a stop that is breached at minute 2 of the bar. Resampling is deterministic and pure.

```
interval = 5, anchor 09:15

native 1m:  |915|916|917|918|919| |920|921|922|923|924| ...
                  └──────┬──────┘   └──────┬──────┘
resampled 5m:        [915–919]          [920–924]      ← entry/exit conditions evaluate here
risk scan:   ↑ every native 1m bar still scanned for SL/target ↑
```

---

## 2. Option mark-to-market

Marking is **always from the option's own OHLC**, never Black-Scholes-implied from spot. We have real traded option prices (patchy but real); synthesizing prices would invent liquidity that did not exist.

- **Running MTM (unrealized, for risk checks):** mark each open leg at the **current bar's `close`** of its option series.
  - Long leg unrealized = `qty × (markClose − entryFill)`
  - Short leg unrealized = `qty × (entryFill − markClose)`

  Sign convention is identical to `payoff.ts::legPayoffAt` (long = `intrinsic − premium`, short = `premium − intrinsic`), but using the _current option price_ in place of intrinsic value — because we mark to **live premium**, not to expiry intrinsic.

- **SL/target trigger scan (intrabar):** uses the bar's **high/low**, not close — see §5.1.

- **Realized P&L on exit:** booked at the exit fill price (§3) through `computeGrossPnl` then net of `computeCharges`.

- **Expiry-day settlement:** if a leg is still open at expiry square-off, it is **closed at the last traded option price of the day** (the `15:29`/`exit.time` bar close), _not_ at intrinsic value — the strategy is intraday and squares off before settlement. Intrinsic-at-expiry via `payoff.ts` is used **only** for the builder's payoff _preview_, never for realized backtest P&L. **This distinction is load-bearing — keep the two code paths separate.**

**Missing mark (no bar this minute):** carry-forward the last known option close (`fixnan`-style, Pine convention) and **flag the leg's `staleMarks++`**. A configurable cap `MAX_STALE_MINUTES = 15`: if a leg has no real print for **>15 consecutive minutes** while we need to act on it (square-off), we square off at the last known price and raise a `LOW_LIQUIDITY` confidence flag on the trade (§8.4). This is **surfaced, never silent**.

```
option series with a hole:

minute:   930  931  932  933  934  935  936
close:    12.4  ·    ·    ·   11.8  ·    11.2
mark:     12.4 12.4 12.4 12.4 11.8 11.8 11.2     ← carry-forward, staleMarks += per held minute
                └─ staleMarks 1,2,3 ─┘
```

---

## 3. Fill model & slippage

### 3.1 When and at what price a fill happens

Decisions are made on bar `b`, but **the fill is on the _next_ bar's open** for condition-triggered entries/exits, because bar `b`'s close is only known at its right edge and acting on it within the same bar is **look-ahead**. Concretely:

| Event                                                  | Decision bar         | Fill price (before slippage)                                                                       |
| ------------------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------------------- |
| Time-based entry (entry minute reached)                | the entry-minute bar | **that bar's `open`** (price at the entry minute's left edge — legitimately tradeable)             |
| Condition-based entry (indicator true on close of `b`) | `b`                  | **next bar's `open`**                                                                              |
| Time-based exit / EOD square-off                       | the exit-minute bar  | **that bar's `open`** (or `15:29` close if exit ≥ 15:29)                                           |
| Per-leg SL/target hit intrabar                         | `b`                  | **the trigger price** (§5.1), worst-cased                                                          |
| Overall MTM SL/target hit                              | `b`                  | next-bar `open` for clean exits; trigger price if the threshold is crossed intrabar (conservative) |
| Re-entry                                               | per §6               | next-bar `open` (RE ASAP) or the configured cost (RE COST)                                         |

**No same-bar entry-and-exit on a _condition_** (prevents a 0-bar round-trip from a single noisy bar). **Time-entry + time-exit on the same minute is also disallowed** — `exitMinute > entryMinute` is enforced at validation.

### 3.2 Slippage (always against the trader — pessimistic)

```ts
interface SlippageConfig {
  mode: "percent" | "ticks";
  value: number; // e.g. 0.5 (%) or 2 (ticks)
  tickSize: number; // index options: ₹0.05
}
```

Applied to **every fill** (entry and exit), always **adverse**:

| Side      | `percent`           | `ticks`                    |
| --------- | ------------------- | -------------------------- |
| Buy fill  | `price × (1 + pct)` | `price + ticks × tickSize` |
| Sell fill | `price × (1 − pct)` | `price − ticks × tickSize` |

**Default = `percent`, 0.5%** — an honest, slightly conservative seed for liquid index options (the brief and AlgoTest both bake slippage in). Slippage is **rounded to the nearest tick after application**. A fill can **never go ≤ 0**; floor at `tickSize`.

**Liquidity-aware slippage bump (our differentiator):** if the leg's resolved strike has `coverage < 0.5` **or** `bar.v === 0` at the fill bar, multiply slippage by `ILLIQUID_SLIP_MULT = 3` **and** flag the trade `LOW_LIQUIDITY`. This makes patchy-strike results honestly _worse_ rather than fictitiously clean.

```
buy @ 100.00, percent 0.5%, tick 0.05
  base:        100.00 × 1.005 = 100.50
  illiquid×3:  100.00 × 1.015 = 101.50   (coverage < 0.5 or v == 0 → flag LOW_LIQUIDITY)
  snap to tick: nearest 0.05
```

### 3.3 Charges

Each leg's **round trip** (entry + exit) is **one** `computeCharges` call with:

```ts
computeCharges(profile, {
  segment: "OPT",
  product: "MIS", // intraday
  orders: 2, // entry + exit
  direction: leg.direction, // "long" | "short"
  entryPrice, // post-slippage entry fill
  exitPrice, // post-slippage exit fill
  qty, // lot-scaled: lots × LOT_SIZE[index]
});
```

A leg re-entered **N** times books **N round trips** (each its own `computeCharges`, `orders: 2`). Net leg P&L = `computeGrossPnl(...) − charges.total`. Day P&L = Σ legs.

> **Never approximate charges.** The existing `charges.golden.test.ts` is the source of truth and the engine must reproduce it **cent-for-cent**.

---

## 4. Entry / exit conditions

v1 ships **fixed-time first** (the brief's explicit priority). The rule types are unioned so indicator rules slot in later **without a schema break**.

```ts
type EntryRule =
  | {
      kind: "time";
      time: string /* "HH:MM" IST */;
      daysOfWeek?: (0 | 1 | 2 | 3 | 4)[]; // Mon..Fri; default = all weekdays
      daysFromExpiry?: number[];
    } // e.g. [0,1] = only expiry day & day-before
  | { kind: "indicator"; expr: IndicatorExpr }; // v2 — typed but unimplemented

type ExitRule =
  | { kind: "time"; time: string } // hard intraday square-off time
  | { kind: "indicator"; expr: IndicatorExpr }; // v2
```

**Evaluation rules:**

- For `kind: "time"`, entry fires on the **first bar whose `minuteOfDay ≥ entryMinute`** _and_ the day passes the `daysOfWeek` / `daysFromExpiry` filters.
- `daysFromExpiry` is computed via `calendar.tradingDaysToExpiry(index, D, expiryRule)` (§9) — it counts **trading days** to the relevant expiry, **not** calendar days. (Do **not** reuse the calendar-day helper in `payoff.ts`; that one is calendar days.)
- **Exactly one entry per day** in v1 (re-entries are a separate mechanism, §6).
- **Hard exit is non-negotiable:** even if `exit.kind` is indicator-based, a `15:29` force-square-off always wins.

---

## 5. Risk: per-leg, overall MTM, square-off interaction

### 5.1 Per-leg SL / target / trailing (the AlgoTest two-axis model)

```ts
interface LegRisk {
  sl?: { unit: "pct" | "pts"; ref: "premium" | "underlying"; value: number };
  target?: { unit: "pct" | "pts"; ref: "premium" | "underlying"; value: number };
  trail?: { x: number; y: number; unit: "pct" | "pts" }; // move SL by Y once price moves X in favour
  refPrice: "traded" | "trigger"; // SL/TGT reference: actual traded entry vs trigger price
}
```

- **Reference (`ref`)** seeds the SL/target levels: `ref:"premium"` measures against the leg's option price; `ref:"underlying"` against the index spot move since entry (AlgoTest's "SL UL"). For a **short** leg, SL is a price _rise_ and target is a price _fall_ (and vice-versa for long) — **the sign is derived from `direction`, never entered by the user.**
- **Intrabar trigger (deterministic, pessimistic):** scan at native 1-min. A leg's SL is "hit" if the bar's adverse extreme crosses the level:
  - long leg → `bar.l ≤ slLevel`
  - short leg → `bar.h ≥ slLevel`
  - target uses the favourable extreme.
- **Both-in-bar tie-break:** if SL and target levels **both** fall inside the same bar's `[l, h]` range, **the SL is assumed to fill first** (worst-case ordering — never assume the good fill).
- **Fill price** = the level itself (we treat SL/TGT as resting stop/limit orders), then slippage applied adversely.
- **Trailing (Trail X / Trail Y):** maintained per leg at 1-min resolution. Each time the favourable move since the _last trail anchor_ ≥ `X`, ratchet the SL by `Y` in the favourable direction and reset the anchor. **SL only ever moves toward profit, never back.** Computed on the bar's _favourable_ extreme so the trail is responsive, but the SL fill still uses the adverse-extreme test above.

```
short leg, entry premium 100, SL +30% (→ 130), Target −50% (→ 50)

bar:    h=132  l=128   →  SL hit (h ≥ 130). fill @ 130 (+ adverse slip).
bar:    h=120  l=48    →  BOTH inside [48,120]? target 50 ≥ 48 ✓, SL 130 ∉ → only target.
bar:    h=131  l=49    →  SL 130 ≤ 131 ✓ AND target 50 ≥ 49 ✓  →  SL FILLS FIRST.
```

### 5.2 Overall MTM risk (strategy-level)

```ts
interface OverallRisk {
  mtmSl?: number; // ₹ absolute loss floor, e.g. 5000 → exit whole strategy at −₹5000
  mtmTarget?: number; // ₹ absolute profit
  mtmTrail?: { x: number; y: number }; // trail strategy MTM
  lockAndTrail?: { lockMinProfit: number; trailBy: number }; // AlgoTest Lock & Trail
  maxLoss?: number; // hard absolute floor (redundant safety; min(mtmSl, maxLoss) wins)
}
```

Overall MTM at any bar =

```
overallMtm(b) =   Σ unrealized(open legs @ b.close)         // §2
                + Σ realized P&L (legs squared earlier today)
                − Σ accrued charges (of those realized legs)
```

Evaluated **every 1-min bar**. On breach → square off **all open legs** at next-bar open (or trigger price if crossed intrabar).

`lockAndTrail`: once MTM ≥ `lockMinProfit`, set a floor at `lockMinProfit` and raise it by `trailBy` for each further `trailBy` of MTM gain (the standard ratchet).

### 5.3 Square-off interaction (Partial vs Complete)

This is the single most important inter-leg semantic and must be **explicit**:

- **`squareOff: "partial"`** — a per-leg SL/target squares off **only that leg**; the others keep running. Re-entry (§6) applies to the squared leg only.
- **`squareOff: "complete"`** — **any** per-leg SL/target (or the overall MTM breach) squares off the **entire strategy** for the day. No re-entry after a complete square-off unless `reentry` is configured at strategy level.

**Order of evaluation within a bar is FIXED for determinism:**

```
(1) per-leg SL/target   →   (2) overall MTM   →   (3) trailing updates   →   (4) re-entry
```

Document this order in code; **tests pin it.**

---

## 6. Re-entry / re-execute

Plain-language presets over AlgoTest jargon.

```ts
interface ReentryConfig {
  mode: "none" | "re-asap" | "re-cost" | "re-momentum";
  maxReentries: number; // 0..5 per leg per day
  stopReentryTime?: string; // "HH:MM" — no new re-entry after this
  momentumPts?: number; // re-momentum: re-enter only after price moves this many pts
}
```

Maps to the builder's plain-language presets ("Re-enter at new ATM" / "Re-enter at cost" / "Re-enter on momentum"):

- **re-asap** — immediately after a leg's SL/target, re-select the strike **freshly at the current bar** (re-resolve ATM±offset against the _current_ spot, §8) and re-enter at next-bar open. New contract, fresh fills, fresh `computeCharges` round trip.
- **re-cost** — wait until the option price returns to the **original entry price** (the previous fill), then re-enter the _same_ strike at that price. If it never returns before `stopReentryTime`/EOD, no re-entry.
- **re-momentum** — re-enter only after the underlying moves `momentumPts` in the leg's favour from the SL point.

`maxReentries` caps re-entries **per leg per day**; `stopReentryTime` hard-stops new entries. Each re-entry is a **distinct booked round-trip** in the trade log.

> The reversal variants (AlgoTest's "RE ASAP ↩") are **deliberately excluded from v1** — they double the state space for marginal value; defer.

---

## 7. Square-off, expiry, trading-day boundary

### 7.1 Intraday square-off (always)

Every open leg is force-squared at `min(exitMinute, 929 /*15:29*/)`. v1 holds **nothing overnight**. The `15:29` cap (not `15:30`) leaves one minute of liquidity and avoids the closing-auction bar.

### 7.2 Expiry selection

```ts
type ExpiryRule =
  | { kind: "weekly" } // nearest weekly expiry ≥ trade day
  | { kind: "monthly" } // monthly (last weekly of the month)
  | { kind: "next-weekly" } // the weekly after the nearest
  | { kind: "fixed"; expiry: string }; // a specific YYYY-MM-DD
```

For each trading day `D`, `calendar.expiryFor(index, D, expiryRule)` returns the contract expiry to trade.

**Expiry weekday by index (and its history) lives in the calendar module** because it has changed over the dataset window and is exchange-specific:

- NIFTY weekly = Thursday (Tuesday in some 2025 windows)
- BANKNIFTY weekly historically Wednesday / Thursday / now monthly-only
- SENSEX weekly = Friday / Tuesday depending on period

**Do NOT hard-code a single weekday** — drive it from a dated rule table (§9) and **prefer the expiry that actually has a parquet file**, falling back with a `COVERAGE` flag if the canonical expiry is missing from the dataset.

### 7.3 Expiry-day handling

On the contract's own expiry day, the option series exists and is marked normally; the leg is squared at `exit.time`/`15:29` like any other day. Intrinsic settlement is **not** used (see §2).

### 7.4 Gaps & alignment

Real 1-min series have holes (no print that minute), and legs can have _different_ hole patterns. The engine builds a **master minute grid** for the day from the index series (the most complete) and **left-joins** each leg series onto it:

```
master grid (from index):  915 916 917 918 919 920 ...
index:                       ✓   ✓   ✓   ✓   ✗   ✓
leg CE @ 22500:              ✓   ✗   ✗   ✓   ✓   ✓
leg PE @ 22500:              ✓   ✓   ✗   ✗   ✗   ✓

rule per minute:
  index ✗  → SKIP the minute entirely (no decision made)
  leg ✗    → carry-forward last option close (MTM), staleMarks++
  leg ✗ all day → that leg does not trade; day flagged, see below
```

- **Index missing a minute** → skip that minute entirely (no decision made).
- **A leg missing a minute** → carry-forward last option close for MTM (§2), increment `staleMarks`.
- **A leg with zero real prints all day** at the resolved strike → that leg does not trade that day; the whole strategy day is flagged `COVERAGE`. If `squareOff:"complete"` semantics make the structure meaningless without that leg, the day is **skipped with reason `MISSING_LEG`** rather than producing a misleading single-leg result.

---

## 8. Strike resolution against AVAILABLE strikes

**The differentiator.** Resolve against strikes that actually exist in the dataset, with graceful fallback and honest confidence flags.

```ts
type StrikeSelector =
  | { kind: "atm"; offset: number } // ATM±offset in strike steps (+OTM / −ITM)
  | { kind: "pct"; pct: number } // % offset from spot
  | { kind: "premium"; target: number } // strike whose premium ≈ target ₹
  | { kind: "delta"; target: number; tol?: number } // strike whose |delta| ≈ target
  | { kind: "exact"; strike: number };
```

### 8.1 The available-strike universe

Before resolving, the engine fetches the **set of strikes that actually exist in the dataset** for `(index, expiry)` via `data-access.strikeUniverse(index, expiry)` (a cheap DuckDB `SELECT DISTINCT strike` over the partition) plus a per-strike **coverage ratio** for the trade day:

```
coverage = barsPresent / sessionMinutes        // 0..1, sessionMinutes = 375
```

Strike step is index-specific (`NIFTY 50, BANKNIFTY 100, SENSEX 100`) but **derived from the universe**, not assumed (the universe is ground truth).

### 8.2 ATM resolution from spot

```
spotAtEntry = index series `close` of the bar immediately before the entry fill
              (or the entry bar's `open` for time entries)
ATM         = nearest available strike to spotAtEntry   (ties → round to the HIGHER strike, deterministic)
target      = ATM + offset × step, then SNAPPED to the nearest existing strike
```

### 8.3 Resolution + graceful fallback (the whole game)

```
1. Compute the IDEAL strike per the selector.
2. exists AND coverage ≥ MIN_COVERAGE (0.6)            → use it.  confidence "high"
3. else search outward by strike step for the nearest
   available strike with coverage ≥ 0.6, within
   ±MAX_FALLBACK_STEPS (5) steps                        → use it.  confidence "medium"
                                                            record {requested, served, coverage}
4. else take the nearest existing strike at ANY coverage → use it.  confidence "low" + flag LOW_LIQUIDITY
5. else (no strikes at all near target)                 → leg cannot resolve
                                                            → §7.4 MISSING_LEG, day skipped, surfaced honestly
```

```ts
interface StrikeResolution {
  requested: number;
  served: number;
  coverage: number; // 0..1
  confidence: "high" | "medium" | "low";
  fallbackSteps: number; // how far we moved
}
```

This `{requested → served, coverage%}` object is exactly the **honest-missing-data primitive** the brief demands (Pine's `na`/`fixnan` modelled as _data_, not silence). It rides on **every** trade and aggregates into the results "coverage chip."

```
fallback ladder (atm offset 0, ideal 22500, step 50, MAX_FALLBACK_STEPS 5):

22500 (cov 0.20)  ✗ <0.6   →  22550 (0.71) ✓  served, confidence "medium", fallbackSteps 1
                              22450 (0.65) ✓  (22550 chosen: nearest; tie → higher)
```

### 8.4 Premium & delta selection

- **Premium:** at the entry bar, scan available strikes' **entry-bar option price** (`open`) and pick the one closest to `target`. Tie → lower-risk side (closer to ATM).
- **Delta:** the dataset has **no IV/delta column**, so we **estimate delta locally** at entry using a Black-76-style approximation with a realized-vol proxy from the trailing index bars (documented, deterministic). Because this is an estimate, delta-selected legs **always carry `confidence ≤ "medium"`** and a "delta is estimated" tooltip. This is honest and matches our patchy-data ethos; **do not present estimated delta as exact.**

---

## 9. Market-calendar module

A standalone, data-driven module modelled on `brokers.ts` (rates-as-data). **No external API at runtime** — the holiday tables ship in the bundle.

```ts
// calendar.data.ts — DATA. NSE+BSE trading holidays 2021–2027 (full-day closes),
// plus dated expiry-weekday rules per index (they changed over time).
export const HOLIDAYS: Record<number /*year*/, string[] /*YYYY-MM-DD*/> = {
  2021: [
    /* … cite NSE circular */
  ],
  // …
  2027: [
    /* … */
  ],
};

interface ExpiryRuleEntry {
  index: IndexSymbol;
  from: string;
  to: string;
  weekday: number;
}
export const EXPIRY_RULES: ExpiryRuleEntry[] = [
  { index: "NIFTY", from: "2021-01-01", to: "2025-08-31", weekday: 4 /*Thu*/ },
  { index: "NIFTY", from: "2025-09-01", to: "9999-12-31", weekday: 2 /*Tue*/ }, // example dated shift
  { index: "BANKNIFTY", from: "2021-01-01", to: "…", weekday: 3 /*Wed*/ },
  { index: "SENSEX", from: "2022-01-01", to: "9999-12-31", weekday: 5 /*Fri*/ },
];
```

```ts
// calendar.ts — pure functions:
isTradingDay(d: string, index: IndexSymbol): boolean        // weekday && not HOLIDAYS && ≥ data-start for index
tradingDays(from: string, to: string, index): string[]      // the iteration spine
sessionMinutes(): { open: 555 /*09:15*/; close: 930 /*15:30*/ }
expiryFor(index, d, rule: ExpiryRule): string                // weekly/monthly/next, honouring dated weekday rules + holiday roll-back
tradingDaysToExpiry(index, d, rule): number                  // for the daysFromExpiry filter
```

**Holiday-roll rule:** if a computed expiry weekday is a holiday, the expiry **rolls back to the previous trading day** (NSE/BSE convention).

**Per-index data start:** SENSEX data starts **2022**, NIFTY/BANKNIFTY **2021**. `isTradingDay` returns `false` before the per-index data start so the engine **never queries empty partitions**.

The holiday table must be **verifiable and dated** (cite NSE circulars in comments, like `brokers.ts` cites Zerodha). Keep it **overridable** so a missing future holiday can be patched without an engine change.

---

## 10. Client-side performance strategy

### 10.1 Worker architecture (mirror the Monte-Carlo pattern)

`engine.worker.ts` wraps the pure `runBacktest` exactly like `montecarlo.worker.ts` wraps `runSimulation`: a `{ id, input }` request → `{ id, ok, result|error }` response. The UI instantiates it with:

```ts
new Worker(new URL("./engine.worker.ts", import.meta.url));
```

so Next/Turbopack fingerprints it as its own chunk. **duckdb-wasm runs _inside the worker_** (off the main thread); the main thread only sends `StrategyConfig` and renders progress + results.

### 10.2 Progress streaming

The worker posts **incremental progress** (not just a final result) so the UI shows the brief's "intentional progress" loader:

```ts
type Progress = {
  id: number;
  kind: "progress";
  phase: "runtime" | "fetch" | "replay";
  dayIndex: number;
  totalDays: number;
  partialEquity?: number;
};
```

Phases: `runtime` (duckdb-wasm cold start) → `fetch` (per-day slice pull from HF) → `replay`. Emitting partial equity lets the equity curve draw **progressively** (Composer-style live feedback).

### 10.3 Data fetching & chunking

- **Pull the narrowest slice possible.** Per trading day, per resolved strike: a `WHERE trading_day = D AND strike = S` range read over the parquet via `duckdb-wasm`'s HTTP range support — **never download whole files.**
- **Resolve strikes day-by-day** so we only fetch strikes we will actually trade.
- **Push aggregation into DuckDB SQL**, not pandas/JS (the brief's PyArrow-absent constraint): coverage ratios, distinct-strike universe, resampling to ≥3-min — all done in SQL; JS only receives the minute rows it iterates.
- **LRU-cache fetched day-slices** in the worker (`Map`, capped ~200 days) keyed by `(index, strike, expiry, day)` so re-runs and parameter tweaks of overlapping ranges are instant.
- **Chunk the day loop to yield:** process N days, `await Promise.resolve()` (or post a progress tick) so the worker can service a `cancel` message. Support a `cancel` request that aborts cleanly.

### 10.4 Hard caps (prevent runaway)

```
MAX_TRADING_DAYS  = 1500   (~6y)
MAX_LEGS          = 8
MAX_REENTRIES     = 5
MAX_BARS_PER_DAY  = 375     (session length)
```

Exceeding any returns a **typed validation error _before_ fetching.**

---

## 11. Outputs

What the engine returns; feeds the results screen.

```ts
interface BacktestResult {
  meta: {
    config: StrategyConfig;
    engineVersion: string;
    ranAt: number;
    coverage: {
      overall: number;
      byLeg: Record<string, number>;
      daysSkipped: number;
      lowLiquidityDays: number;
    };
  };
  dayTrades: DayTrade[]; // one per traded trading-day (the "trade" unit)
  equityCurve: { ts: number; equity: number }[]; // cumulative net P&L, day granularity
  intradayMtm?: { ts: number; mtm: number }[]; // minute-wise MTM (CSV export), opt-in (heavy)
  metrics: Metrics; // §11.2
  flags: ResultFlag[]; // COVERAGE / LOW_LIQUIDITY / MISSING_LEG aggregates
}

interface DayTrade {
  day: string;
  entryTs: number;
  exitTs: number;
  legs: BookedLeg[]; // each: strike, resolution, fills, gross, charges, net, reentries
  grossPnl: number;
  charges: number;
  netPnl: number;
  exitReason: "time" | "leg-sl" | "leg-target" | "mtm-sl" | "mtm-target" | "eod" | "missing-leg";
  mae: number; // max adverse excursion
  mfe: number; // max favourable excursion
  rMultiple: number | null; // net / risk(initial overall SL or Σ leg SL) — feeds Monte-Carlo
}

interface BookedLeg {
  legId: string;
  optionType: "CE" | "PE";
  direction: "long" | "short";
  resolution: StrikeResolution; // §8.3 — requested→served, coverage, confidence
  qty: number;
  entryFill: number;
  exitFill: number;
  gross: number;
  charges: number;
  net: number;
  reentries: number;
  staleMarks: number;
}

type ResultFlag = "COVERAGE" | "LOW_LIQUIDITY" | "MISSING_LEG";
```

### 11.2 Metrics

Compute in `metrics.ts`; **lead with what Indian options traders rank on:**

```
Net P&L (₹ & %)        Return/MaxDD         Expectancy          Win %
Max Drawdown (+ dur)   Sharpe               Profit factor       Avg win / avg loss
Max win/loss streak    Day-of-week split    Expiry vs non-expiry split
```

**Monte-Carlo drawdown cone:** map each `DayTrade.rMultiple` into `extractRSamples`-shaped input and call the _existing_ `runSimulation` (reuse, don't rebuild) → **95th-pct drawdown as the honesty headliner.** Determinism: pass `config.seed` straight through to `mulberry32`.

```ts
interface Metrics {
  netPnl: number;
  netPnlPct: number;
  returnOverMaxDd: number;
  expectancy: number;
  winRate: number;
  maxDrawdown: number;
  maxDrawdownDurationDays: number;
  sharpe: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxWinStreak: number;
  maxLossStreak: number;
  byDayOfWeek: Record<number, { trades: number; netPnl: number }>;
  expiryVsNonExpiry: {
    expiry: { trades: number; netPnl: number };
    nonExpiry: { trades: number; netPnl: number };
  };
  monteCarlo: { p95Drawdown: number /* cone series from runSimulation */ };
}
```

---

## 12. Determinism, edge cases, honesty contract

### 12.1 Determinism (a hard requirement — pin with golden tests)

- Identical `StrategyConfig` + identical dataset snapshot ⇒ **byte-identical `BacktestResult`** (modulo `meta.ranAt`). **No `Date.now()` / `Math.random()` in the engine**; all randomness flows through `config.seed → mulberry32`.
- Floating-point: keep money in rupees as JS numbers but **round only at booking** via the same `r2` discipline `charges.ts` uses; **never round mid-accumulation.**
- Strike/price comparisons use an epsilon (`1e-6`).
- Fixed within-bar evaluation order (§5.3) and fixed worst-case tie-breaks (SL-before-target §5.1; both-cross → adverse fill) make results reproducible **and** conservative.

### 12.2 Edge cases (each must have a test)

| #   | Scenario                                                                             | Required behavior                                                                                 |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 1   | Entry minute has no index bar                                                        | wait for the next available minute; if none before exit, **no trade** that day (not an error)     |
| 2   | Resolved strike has zero prints all day                                              | `MISSING_LEG`, day skipped, counted in `daysSkipped`                                              |
| 3   | SL and target both inside one bar                                                    | **SL fills first**                                                                                |
| 4   | Gap-up past a short leg's SL at the open                                             | fill at the **open** (gap-adjusted), not the SL level — can't fill better than the market printed |
| 5   | Expiry weekday is a holiday                                                          | roll expiry **back** one trading day                                                              |
| 6   | `daysFromExpiry` filter excludes every day in range                                  | empty result + clear "no qualifying days" empty state                                             |
| 7   | `from > to`, `from` before data start, `to` in the future                            | clamp to `[dataStart, lastTradingDay]`, surface a notice                                          |
| 8   | Re-entry would fire at/after `stopReentryTime`                                       | suppressed                                                                                        |
| 9   | Overall MTM SL and a per-leg SL trigger on the same bar under `squareOff:"complete"` | overall wins (squares everything anyway); `exitReason = "mtm-sl"`                                 |
| 10  | One noisy bar spans both leg SL and leg target while `squareOff:"partial"`           | that leg books an SL; others continue                                                             |

### 12.3 Honesty contract (non-negotiable — the thing none of the five competitors do)

Every result carries:

- **coverage %** (overall + per-leg),
- **served-vs-requested strikes**,
- **skipped-day count**,
- **low-liquidity day count**.

The results UI **must** show these as chips and **must** render an honest empty/degraded state rather than a clean-looking but fictitious curve. Disclaimers ("past performance", "overfitting") are **mandatory** on the results view. The engine's job is to make the data's patchiness **legible**, not to paper over it.

```
RESULTS HEADER (wireframe)

┌──────────────────────────────────────────────────────────────────┐
│  Net P&L  +₹1,24,350      Return/MaxDD  3.2×      Win %  58%        │
│  ───────────────────────────────────────────────────────────────  │
│  [ coverage 81% ]  [ 12 days skipped ]  [ 7 low-liquidity days ]    │  ← honesty chips
│  ⚠ Past performance is not indicative of future results.           │
│     Patchy strike coverage may overstate fills. Beware overfitting.│
└──────────────────────────────────────────────────────────────────┘
```

---

## 13. Build order

Recommended implementation sequence (dependencies first):

1. `calendar.ts` + `calendar.data.ts` + tests — everything depends on the day spine.
2. `types.ts`, then `data-access.ts` against a small fixture parquet (the fixture **must** include the missing-strike case).
3. `resolve-strike.ts` + tests — the differentiator; test fallback ladders thoroughly.
4. `fill-model.ts` + tests.
5. `engine.ts` **time-entry/time-exit path only, no risk** → golden test vs a hand-computed 2-leg short straddle day.
6. Layer **per-leg risk → overall MTM → re-entry**, each behind tests pinning the §5.3 order.
7. `metrics.ts` reusing `runSimulation`.
8. `engine.worker.ts` + progress/cancel + duckdb-wasm in-worker + LRU cache.

---

## 14. Integration facts

Verified against the codebase.

- **`computeCharges(profile, t)`** — `t.segment` must be `"OPT"`, `t.product` `"MIS"`, `t.qty` lot-scaled, `t.orders` `2` per round trip; returns `ChargeBreakdown.total`.
  Source: `src/lib/charges/charges.ts`.
- **`getChargeProfile(id)`** and the `ChargeProfile` shape — default falls back to **Zerodha**.
  Source: `src/config/brokers.ts`.
- **Leg sign convention to mirror** — `legPayoffAt`: long = `intrinsic − premium`, short = `premium − intrinsic`; for MTM swap `intrinsic → current option price`.
  Source: `src/lib/options/payoff.ts`.
- **Monte-Carlo reuse** — `runSimulation`, `extractRSamples`, `mulberry32`, `percentile`; worker contract to copy = `montecarlo.worker.ts`.
  Source: `src/lib/montecarlo/simulate.ts`, `src/lib/montecarlo/montecarlo.worker.ts`.
- **Lot sizes** (from brief, encode as `LOT_SIZE`): NIFTY 75, BANKNIFTY 35, SENSEX 20.
- **Parquet schema** for `data-access.ts`:
  - `options/{SYMBOL}/{EXPIRY}.parquet` columns: `timestamp, open, high, low, close, volume, open_interest, trading_day, symbol, strike, option_type, expiry`.
  - `index/{SYMBOL}.parquet` for spot.

All new code lives under `src/lib/backtest/`; the four reused modules above are **imported, not modified.**
