# 12 — Indicator Library (golden-tested, pure-TS, streaming)

## Goal & honest scope

A pure-TypeScript, deterministic, **streaming** indicator library under `src/lib/backtest/indicators/`, where **each indicator is bit-verified against ONE declared reference within a stated epsilon**. We do **not** claim "hundreds of perfect" indicators — "perfect" is undefined across references (TA-Lib, Pine, MetaTrader disagree on seeding/stddev/NaN-prefix). We claim: a **curated, growing, correctly-referenced** library. **Launch ~40** fully golden-tested; grow to 100+ behind the same harness.

## Reference policy (the load-bearing decision)

Declare ONE reference **per indicator**, written in `docs/INDICATORS.md` and each file header:

- **TradingView Pine `ta.*`** for the ~14 chart-facing indicators users compare against on their own charts: RSI, SMA, EMA, WMA, MACD, Bollinger, VWAP, Supertrend, ADX, Stochastic, ATR, CCI, OBV, PSAR.
- **TA-Lib** (offline pandas oracle) for the rest.
- In-UI disclaimer near indicator selection: _"Indicators are computed independently and may differ slightly from your charting tool on recursive indicators (RSI/ATR/ADX/Supertrend/PSAR) due to seeding conventions."_

## Architecture

```
src/lib/backtest/indicators/
  smoothing.ts   // sma, ema, wma, wilder/rma — shared primitives ALL others compose from
  ma.ts          // SMA EMA WMA DEMA TEMA HMA KAMA VWMA TRIMA ZLEMA
  oscillators.ts // RSI Stoch StochRSI CCI WilliamsR MFI ROC Momentum TSI Ultimate
  trend.ts       // MACD ADX DI+ DI- Aroon PSAR Supertrend Vortex TRIX
  volatility.ts  // ATR NATR Bollinger Keltner Donchian StdDev
  volume.ts      // OBV VWAP AD ADOSC CMF PVT EMV ForceIndex
  price.ts       // typical/weighted/median price, HeikinAshi, pivots
  registry.ts    // INDICATOR_REGISTRY: id -> { params zod, inputs, output arity, statefulFactory }
  index.ts
  __vectors__/*.json
  *.vectors.test.ts
```

Each indicator exposes BOTH:

- a pure full-series fn `compute(series): (number|null)[]` (aligned to input length, `null` during warmup — never 0), and
- an incremental **stateful factory** `createEMA(period) -> { push(x): number|null }` so the engine folds them **point-in-time, bar-by-bar** with no look-ahead.

## Pinned conventions (per file header + per golden row)

- **EMA seed**: SMA-of-first-n (TA-Lib parity) unless the reference is Pine (`sma_seed`). State which per indicator.
- **Wilder smoothing** (RSI/ATR/ADX/SMMA): α = 1/n (NOT EMA's 2/(n+1)).
- **StdDev** (Bollinger): population (ddof=0) to match TA-Lib.
- **Warmup / NaN-prefix length**: pinned per indicator as an explicit test.
- **Div-by-zero**: RSI avgLoss=0→100; MFI negMF=0→100; Stoch/Williams/StochRSI HH==LL→0; ADL/EMV H==L→0; CCI meanDev=0→0. Encoded as flat-range golden rows.
- **VWAP/EMV** reset per IST session (09:15–15:30 spine).

## Golden harness

- `scripts/gen-indicator-vectors.py` (offline, dev-only, deps gitignored): generates `__vectors__/*.json` from **TA-Lib + an independent second impl** (tulipy or MIT `ixjb94/indicators`) over **200+ bar** fixtures. The ~14 Pine values are captured manually for chart-facing indicators. **Never** run TA-Lib/Pine in the app.
- `*.vectors.test.ts`: assert within epsilon (1e-8 float; exact `toBe` for OBV/integer-domain). For recursive indicators (PSAR/Supertrend/ADX/KAMA) assert the **converged tail**. Plus a determinism test (same input ⇒ byte-identical output) mirroring `engine/determinism.test.ts`.
- Three witnesses = own code + TA-Lib JSON + ixjb94. Agreement = "correct against the declared reference."

## Licensing

Own implementation, MIT-clean. **Never** vendor `@debut/indicators` (GPL-3.0) or native `tulind` (LGPL C, won't run in-browser). `ixjb94` (MIT) only as a dev-time cross-check.

## Integration (Phase 4)

The `INDICATOR_REGISTRY` is the single source of truth read by both the builder's indicator-rule dropdown and the engine's signal evaluator. The same library is reused as BYOC `ctx.ema/sma/rsi/vwap/atr/crossover` so no-code and BYOC are byte-identical.
