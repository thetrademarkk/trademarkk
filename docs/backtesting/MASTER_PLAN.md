# Backtesting Overhaul — MASTER PLAN

> Index + sequencing for taking the standalone `/backtesting` universe fully **LIVE** (no "coming soon" anywhere), on the existing free / zero-infra / browser-first stack.

## North Star (unchanged)

FREE · IN-BROWSER · HONEST about data · NO LOGIN until the moment of value. Three instruments: NIFTY (lot 75), BANKNIFTY (35), SENSEX (20).

## Live-verified facts that shape this plan (read before disputing)

1. **Browser reads HF DIRECTLY — no proxy.** Probed live (2026-06-16) from `Origin: https://thetrademarkk.com`: `…/resolve/main/<parquet>` 302-redirects to `cas-bridge.xethub.hf.co`, which returns **206 Partial Content** for byte-range GETs (incl. footer-tail), with `access-control-allow-origin` reflected and a passing `OPTIONS` preflight (`access-control-allow-headers: range`). The `ETL_RUNBOOK §8` "proxy mandatory" claim is **stale** and is corrected by this plan. Caveats handled in the data layer: signed CDN URL carries `Expires` (~1h) → never cache the redirect target past expiry; resolver rate-limit is **3000 req / 300s per IP** → coalesce + throttle + graceful "data busy".
2. **Groww auth = secret flow.** `GrowwAPI.get_access_token(api_key, secret)` works; **TOTP returns HTTP 400** in this account (confirmed in `scripts/etl/gap_fill_groww.py`). Re-auth at run start and on token-expiry.
3. **Groww fetcher already exists** (`gap_detect.py`, `gap_fill_groww.py`, `verify_hf_and_prune.py`). The data lane is mostly a **run**, not a build.
4. **CSP is intentionally wide-open** (`connect-src 'self' https: wss:`, `worker-src 'self' blob:`) so BYOD journals can talk to arbitrary user DBs. It **cannot** be tightened per-page → the BYOC network boundary is QuickJS having zero host bindings + `worker.terminate()`, **not** a `connect-src` allowlist.
5. **Schema versions are `z.literal(1)`** (`STRATEGY_SCHEMA_VERSION`, `RUN_RESULT_VERSION`). Any schema change ships **with** a version bump + back-compat read path or it bricks saved strategies and `/backtesting/r/[shareId]` permalinks.
6. **`resolve-strike.ts` step 4** silently serves the nearest strike at ANY coverage (`confidence:'low'`). The **D2 premium-relative hard-fail** must land before any live number ships.
7. **Engine never reads `interval`** today. Arbitrary timeframes are a silent lie until the **1m→Nm resampler** ships — gate the UI behind it.
8. **License = `cc-by-nc-4.0`** → commercial-use sign-off is an open decision.

## De-scoped honestly

"Hundreds of PERFECT indicators" → **a curated, growing library where each indicator is bit-verified against ONE declared reference within a stated epsilon.** TradingView Pine for the ~14 chart-facing indicators users compare against; TA-Lib for the rest. Launch ~40; grow to 100+ behind the same golden harness. In-UI note: "computed independently; recursive indicators may differ slightly from your charting tool."

## Phases & sequencing

| Phase                       | Goal                                                      | Depends on               | Doc                               |
| --------------------------- | --------------------------------------------------------- | ------------------------ | --------------------------------- |
| **0 — DATA** (PARALLEL)     | Gap-fill + ±35% strike expansion → HF → safe local prune  | —                        | `15-data-gapfill-and-coverage.md` |
| **1 — Data layer**          | duckdb-wasm DIRECT HF reads (zero proxy) + resampler + D2 | 0 (cut over when filled) | `07-data-layer.md` (amended)      |
| **2 — Indicators**          | Golden-tested pure-TS lib (~40 launch)                    | — (greenfield)           | `12-indicator-library.md`         |
| **3 — Builder UX**          | 4-mode strike + arbitrary timeframe (gated)               | 1                        | `13-strike-and-timeframe-ux.md`   |
| **4 — Run LIVE**            | Real market + indicator signals; drop golden clamp        | 1,2,3                    | `16-run-strategy-and-metrics.md`  |
| **5 — BYOC**                | QuickJS-in-Worker, JS-only, safe, free                    | 1,2                      | `14-byoc-safe-sandbox.md`         |
| **6 — Results/UX + deploy** | Real data through built results pipeline; ship            | 1–5                      | this index                        |

The **DATA lane (0) runs in parallel** with the code lanes; the code lanes build against the existing golden fixture and **cut over** to real HF data once Phase 0 fills it. Every advertised surface flips `locked → run` via the existing `run-decision.ts` seam the moment real `(symbol,day)` availability is supplied — no per-feature big-bang.

## Hard correctness gates (block live numbers)

- [ ] D2 substitution hard-fail (`MISSING_LEG`, not silent fill).
- [ ] 1m→Nm resampler shipped **before** any non-1m interval is selectable.
- [ ] Index bar threaded into `computeRiskLevel` **before** relaxing the underlying-basis refinement.
- [ ] Schema version bump + migration **in the same PR** as any schema change.
- [ ] Commercial-use / attribution / no-advice disclaimer decided + surfaced.
