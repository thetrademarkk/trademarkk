---
license: cc-by-nc-4.0
language:
  - en
pretty_name: India Index Options 1-Minute (NIFTY / BANKNIFTY / SENSEX)
tags:
  - finance
  - options
  - india
  - nifty
  - banknifty
  - sensex
  - intraday
  - ohlcv
  - backtesting
size_categories:
  - 1M<n<10M
configs:
  - config_name: index
    data_files:
      - split: train
        path: index/*.parquet
  - config_name: options
    data_files:
      - split: train
        path: options/*/*.parquet
  - config_name: daily
    data_files:
      - split: train
        path: daily/*.parquet
  - config_name: manifest
    data_files:
      - split: train
        path: manifest.parquet
---

# India Index Options — 1-Minute OHLCV (NIFTY · BANKNIFTY · SENSEX)

> **Research / education only. Not investment advice.** This dataset is a
> coverage-honest archive of 1-minute candles for Indian index options and their
> underlying spot indices, assembled for the open-source **TradeMarkk** options
> backtesting platform. Coverage is **partial and uneven** (see below) and is
> surfaced as a first-class value — never hidden. There is **no implied
> volatility and no Greeks** here. Do not trade on it.

This card is the **frozen contract** the TradeMarkk backtest engine, no-code
builder, and BYO-code editor build against. The ETL that produces it lives in
`scripts/etl/` of the TradeMarkk repo; the exact owner upload steps are in
`docs/backtesting/ETL_RUNBOOK.md`.

## What's in it

Two source tables plus two precomputed helper tables, partitioned by file path:

```
india-index-options-1m/
├── index/
│   ├── NIFTY.parquet         # spot 1m OHLCV
│   ├── BANKNIFTY.parquet
│   └── SENSEX.parquet
├── options/
│   ├── NIFTY/<EXPIRY>.parquet      # one file per expiry, whole chain
│   ├── BANKNIFTY/<EXPIRY>.parquet
│   └── SENSEX/<EXPIRY>.parquet
├── daily/
│   ├── NIFTY.parquet         # EOD per-(strike,type,day) aggregates
│   ├── BANKNIFTY.parquet
│   └── SENSEX.parquet
└── manifest.parquet          # per-(symbol,expiry,strike,type) coverage manifest
```

Partitioning is **by expiry, not by trading day**, because an intraday
options strategy over a date range touches all trading days of _one_ expiry —
exactly one file (see `docs/backtesting/07-data-layer.md §1`).

## Frozen schema

**`index/<SYMBOL>.parquet`** — spot 1-minute bars
| column | type | note |
| ------------- | ----------------------------- | --------------------------------- |
| `timestamp` | `timestamp[ns, tz=+05:30]` | IST, 1-minute, normalized (below) |
| `open` | `double` | |
| `high` | `double` | |
| `low` | `double` | |
| `close` | `double` | |
| `volume` | `int64` | usually 0 for spot indices |
| `trading_day` | `string` (`YYYY-MM-DD`) | explicit, for cheap pushdown |
| `symbol` | `string` | `NIFTY` \| `BANKNIFTY` \| `SENSEX`|

**`options/<SYMBOL>/<EXPIRY>.parquet`** — option 1-minute bars
| column | type | note |
| --------------- | -------------------------- | ----------------------------- |
| `timestamp` | `timestamp[ns, tz=+05:30]` | IST, 1-minute, normalized |
| `open` | `double` | |
| `high` | `double` | |
| `low` | `double` | |
| `close` | `double` | |
| `volume` | `int64` | |
| `open_interest` | `int64` | `0` where absent |
| `trading_day` | `string` (`YYYY-MM-DD`) | |
| `symbol` | `string` | |
| `strike` | `int32` | e.g. `24800` |
| `option_type` | `string` | `CE` \| `PE` |
| `expiry` | `string` (`YYYY-MM-DD`) | == file's expiry |

Files are written **sorted by `(trading_day, strike, option_type, timestamp)`**
with **~1-trading-day row groups**, ZSTD compression, and column statistics ON,
so a `(trading_day, strike)` predicate prunes to one or two row groups (a few
hundred KB read out of a multi-MB file).

**`manifest.parquet`** — coverage manifest (the differentiator)
| column | type | note |
| -------------- | --------- | ---------------------------------------------------------- |
| `symbol` | `string` | |
| `expiry` | `string` | |
| `strike` | `int32` | |
| `option_type` | `string` | |
| `present_bars` | `int32` | total 1m bars present for the contract |
| `trading_days` | `int32` | distinct days the contract printed |
| `coverage` | `float` | `present_bars / (trading_days * 375)`, clamped 0..1 |
| `med_vol` | `double` | median 1m volume (fill-model liquidity input) |
| `first_bar` | `string` | first observed bar timestamp |
| `last_bar` | `string` | last observed bar timestamp |
| `gap_days` | `int32` | proxy count of trading days the contract was absent |
| `present` | `bool` | `false` = strike entirely absent (folded-in missing marker)|

**`daily/<SYMBOL>.parquet`** — EOD aggregates: per
`(strike, option_type, trading_day)` the day's `open/high/low/close`, summed
`volume`, last `open_interest`, `bars` present, and `coverage_day`.

## Timestamp normalization (important)

The raw collection stored timestamps in **three** different physical dtypes
across files — `string` (`"…T09:15:00+05:30"`), `timestamp[ns, tz=Asia/Kolkata]`,
and `timestamp[ns, tz=+05:30]`. The ETL normalizes **all** of them to a single
canonical **`timestamp[ns, tz=+05:30]`** (fixed IST offset — India has had no DST
since 1945, so a fixed offset is exact and needs no IANA tz database). The
underlying instant is preserved bit-for-bit; only the physical encoding is
unified. Query it as IST.

## Per-symbol spans & coverage

| Symbol    | Spot index from | Options to | Expiries | Real contracts | Contract coverage | Note                |
| --------- | --------------- | ---------- | -------- | -------------- | ----------------- | ------------------- |
| NIFTY     | 2021-05         | 2026-06    | 265      | 47,636         | ~51%              | best covered        |
| BANKNIFTY | 2021-05         | 2026-05    | 61       | 13,783         | ~59%              | weekly discontinued |
| SENSEX    | 2022-09         | 2026-05    | 196      | 30,354         | **~32%**          | **worst covered**   |

"Contract coverage" = real parquet contracts / (real + known-absent strikes).
**SENSEX is the worst-covered symbol** — a large share of strikes for many
expiries were never captured. The `present=false` rows in `manifest.parquet`
record exactly which strikes are absent so the platform can say so honestly
rather than silently returning empty. ~119k absent-strike markers are folded
into the manifest and **not** uploaded as files.

Instrument constants (frozen): lot size NIFTY 75 / BANKNIFTY 35 / SENSEX 20;
strike step NIFTY 50 / BANKNIFTY 100 / SENSEX 100. Expected bars/day = **375**
(09:15–15:30 IST at 1-minute).

## What this dataset is NOT

- **No implied volatility, no Greeks.** Delta/gamma/theta/vega are absent.
  Strategies that need delta-based strike selection must approximate it from the
  price curve and label it as approximate (a deliberate honesty call).
- **Not gap-free.** Even "covered" strikes have intraday holes (halts, illiquid
  minutes). Backtesters must apply an explicit gap policy — never fabricate a
  price.
- **Not survivorship- or split-adjusted beyond what the source provided.**
- **Not a live feed.** It is a point-in-time historical archive.

## License & disclaimer

Released for **research and education only** under **CC-BY-NC-4.0**. No warranty
of accuracy or completeness. Nothing here is investment advice. Past behaviour in
this data does not predict future results. Use at your own risk.
