# ETL Orchestrator — NIFTY-50 stock options → HuggingFace, safely

`orchestrate.py` is the autonomous, resumable conductor for the
`thetrademarkk/india-index-options-1m` dataset. Its job: fetch NIFTY-50
**single-stock** option-chain 1-minute data, normalize it, push it to HF, verify
the remote, then DELETE the local source so the disk never fills — and do it on a
nightly cron, **without ever deleting data that isn't proven safe on HF**.

It chains the existing single-purpose ETL scripts as subprocesses, so each stage
keeps its own tested CLI and idempotency; the orchestrator only sequences them
and enforces the safety gates.

## Pipeline (stock track = default)

| # | Stage | Script | What it does |
|---|-------|--------|--------------|
| 1 | spot | `fetch_stocks_spot.py` | Backfill stock SPOT 1m (skipped if present; it's the strike-band anchor + already complete) |
| 2 | gap-detect | `gap_detect_stocks.py` | Synthesize stock strike bands from spot + derive monthly expiries → `gap-plan-stocks.json` |
| 3 | gap-fill | `gap_fill_groww.py` | Fetch ONLY the gaps, **parallel** (`--workers`) with a shared rate cap, into `stocks_options/` |
| 4 | normalize | `resort_normalize.py` | Per-expiry sort/normalize → HF staging tree (`--options-root stocks_options`) |
| 5 | manifest | `build_manifest.py` | Coverage manifest (`manifest-stocks.parquet` + summary JSON) |
| 6 | daily | `build_daily_aggregates.py` | EOD daily rollups (`daily/<SYM>.parquet`) |
| 7 | upload | `upload_hf.py` | Push staging tree to HF (**LIVE only**; self-refuses without `HF_TOKEN` + `--confirm`) |
| 8 | verify+prune | `verify_hf_and_prune.py` | Verify remote row counts, then DELETE local source per verified expiry |

Archive layout (mirrors the index `options/` tree exactly, just a sibling root):
```
<archive>/stocks_spot/<SYM>/<YYYY>/<YYYY-MM>.parquet        # spot (already complete)
<archive>/stocks_options/<SYM>/<EXPIRY>/NSE-<SYM>-<ddMmmyy>-<STRIKE>-<CE|PE>.parquet
<archive>/stocks_options/.../<contract>.parquet.empty.json  # fetched-but-empty marker
<archive>/failures_stocks_options/<SYM>/<EXPIRY>/<contract>.json   # retryable errors
```
Stock strikes can be **fractional** (ITC 257.5, KOTAKBANK 287.5, TRENT 2333.35);
the whole pipeline carries them through (the normalized/manifest/daily `strike`
column is `float64` on the stock track, `int32` on the index track — unchanged).

## Safety guarantees

1. **Dry-run is the default.** With no flag, `orchestrate.py` runs read-only:
   planning stages run, fetch runs with `--dry-run`, and stages 4–8 are *printed*
   but not executed. Nothing is fetched, uploaded, or deleted. You must pass
   `--no-dry-run` to go LIVE.
2. **Prune requires LIVE + an explicit flag.** A LIVE run (`--no-dry-run`)
   fetches + uploads + verifies but deletes NOTHING unless you also pass
   `--prune`.
3. **Prune is gated on verification.** `--prune` reaches stage 8 as
   `verify_hf_and_prune.py --delete-confirmed`, which deletes a local
   `(symbol, expiry)` ONLY when the remote HF parquet row count **equals** the
   local staging row count for that expiry. A failed/partial upload makes verify
   mismatch → that expiry is NOT deleted → reported for re-upload. Prune runs
   per-expiry, so disk frees incrementally and a single bad expiry never blocks
   the good ones.
4. **No token ⇒ no prune.** Upload self-refuses without `HF_TOKEN`; the
   orchestrator then STOPS before verify/prune (returns the upload's code), so a
   delete can never follow an upload that didn't happen.
5. **Idempotent + resumable everywhere.** The written parquet/marker IS the
   checkpoint. Ctrl-C / crash / a missed nightly run all just continue; nothing
   is double-fetched or double-deleted.
6. **Read-only against Groww.** Only `get_access_token`, `get_all_instruments`,
   and `get_historical_candles` are ever called — never an order/position
   endpoint. Secrets are never printed.

## Parallel fetch + rate limiting

`gap_fill_groww.py` now fetches with a `ThreadPoolExecutor` (`--workers`, default
4). The `Throttle` is a **single shared, thread-safe** rate limiter: every worker
reserves the next slot under a lock, so the GLOBAL request rate never exceeds
`1 / --min-interval` req/s no matter how many workers run. At the default
`--min-interval 0.75` that's ~1.3 req/s — comfortably under Groww's ~10 req/s soft
cap — while the workers overlap the network/IO latency. To push throughput, lower
`--min-interval` (e.g. 0.15 ≈ 6–7 req/s) rather than only raising `--workers`.

## Commands

### (a) Dry-run — see the full plan, touch nothing
```bash
PYTHONUTF8=1 python scripts/etl/orchestrate.py \
  --archive C:/Users/raash/Desktop/trading-journal/market-data/market_archive_1m \
  --staging C:/Users/raash/Desktop/tm-etl/market-data/_etl_staging \
  --workers 6
# add --symbols RELIANCE TCS INFY and/or --max-expiries 3 to bound a smoke run
```

### (b) Real run — LIVE fetch + upload (NO delete)
```bash
# needs HF_TOKEN for the upload step (fine-grained WRITE, scoped to the ONE repo)
PYTHONUTF8=1 HF_TOKEN=hf_xxx python scripts/etl/orchestrate.py \
  --archive C:/Users/raash/Desktop/trading-journal/market-data/market_archive_1m \
  --staging C:/Users/raash/Desktop/tm-etl/market-data/_etl_staging \
  --no-dry-run --workers 6
```
This is the right first LIVE invocation: it backfills + uploads but deletes
nothing, so you can inspect HF before enabling prune. The full first backfill
(2022→now, 48 names) is multi-hour and self-resumes across runs.

### (c) Real run + verify + PRUNE (disk-conserving, what the cron uses)
```bash
PYTHONUTF8=1 HF_TOKEN=hf_xxx python scripts/etl/orchestrate.py \
  --archive C:/Users/raash/Desktop/trading-journal/market-data/market_archive_1m \
  --staging C:/Users/raash/Desktop/tm-etl/market-data/_etl_staging \
  --no-dry-run --prune --prune-staging --workers 6
```

### Useful flags
- `--track index` — run the original index option chain instead of stocks.
- `--symbols RELIANCE TCS` — restrict the run.
- `--max-contracts N` — cap fetched contracts this run (smoke / time-box).
- `--max-expiries N` — cap expiries/symbol (smoke).
- `--target-band-pct 0.20` — strike half-band around ATM (default 0.20 stocks).
- `--retry-failures` — re-attempt previously errored contracts.
- `--skip-upload` — fetch + build only, no upload/verify/prune.
- `--no-live-grids` — skip the Groww instruments call; use the fallback step table.

## Running a stage by hand

Every stage is just its own CLI — e.g. to only (re)build the stock manifest:
```bash
python scripts/etl/build_manifest.py --options-root stocks_options \
  --archive .../market_archive_1m --staging .../_etl_staging/hf \
  --out-json .../_etl_staging/coverage-summary-stocks.json \
  --manifest-name manifest-stocks.parquet --workers 8
```

## Cron

See [`etl-cron.md`](./etl-cron.md) for the Windows Task Scheduler registration
(daily 18:00 IST, LIVE + prune) and the Linux/WSL crontab equivalent.

## Notes / assumptions

- **LTIM and TATAMOTORS** have no CASH/FNO listing under those exact underlying
  names in the current Groww master (corporate actions / symbol renames), so they
  are logged and skipped. If their spot is absent from `stocks_spot/`, the stock
  gap-detect skips them too. Re-add once the correct symbols are confirmed.
- **Historical strike grids are synthesized** from stock spot × the data-driven
  per-symbol step (read live from the Groww master, fallback table otherwise) ×
  the target band — the Groww master only lists live/future expiries, so historic
  grids can't be enumerated from the API (same approach the index gap-detect uses).
- **Monthly expiries are derived** (last Tuesday since 2024-04, last Thursday
  before that) and snapped to the real trading days the stock actually printed, so
  holidays and the weekday-rule change self-correct.
- The stock manifest writes `manifest-stocks.parquet` (separate from the index
  `manifest.parquet`) so the two tracks don't overwrite each other in staging.
  Merge/rename before a combined HF upload if you want a single `manifest.parquet`.
