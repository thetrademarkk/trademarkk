# 15 — Data Gap-Fill + ±35% Coverage Expansion + HF Lifecycle

## State of the lane

The fetcher **already exists** in `scripts/etl/`: `gap_detect.py` (read-only planner), `gap_fill_groww.py` (idempotent resumable fetcher), `verify_hf_and_prune.py` (verify-on-HF-then-delete-local), plus the existing `resort_normalize.py → build_manifest.py → build_daily_aggregates.py → upload_hf.py` chain. This lane is mostly a **disciplined run**.

## Auth (settled)

Use the **secret flow**: `GrowwAPI.get_access_token(api_key=GROWW_API_KEY, secret=GROWW_API_SECRET)`. **TOTP returns HTTP 400** in this account (confirmed in `gap_fill_groww.py`). Re-auth at run start and on any token-expiry error. If the secret flow turns out to need daily Cloud-API-Keys approval, chunk the backfill into `<24h` resumable segments with a re-approval checkpoint.

## Honesty framing (set expectations)

The ±10%→±35% band is dominated by **deep-OTM wings that never traded** → they return `.empty.json` markers, **not** tradeable bars. `gap_detect` reports TRUE net-new-real vs net-new-empty **before** any fetch. Empty markers are terminal (never re-probed) and feed the coverage manifest so `resolve-strike`'s fallback ladder stays truthful. "Coverage expansion" is stated as _resolution honesty_, not raw data volume.

## Index-first dependency

`gap_detect` derives the ±35% band from **local index spot per day**. The local index currently ends ~2026-06-03, so expiries after that yield ZERO work. **Extend the local index layer to present-day FIRST** (fetch missing `NSE-<SYM>` CASH 1m days) — option backfill cannot outrun index coverage.

## Rate discipline

Groww historical-candles has no published cap and prior runs hit 451 at 0.75s spacing. Hard-cap **~1 req/s** with jitter, exponential backoff (2/4/8/16s) on "Rate limit breached", ≤4 workers, persist a resume cursor. SENSEX (worst coverage, largest band) is many hours–days; present realistic wall-clock to the owner.

## Idempotency (never re-fetch)

A `(groww_symbol, expiry)` is **DONE** if a non-empty `.parquet` exists; **ABSENT** (skip permanently) if a `.parquet.empty.json` marker exists; **RETRY** only if it appears in `failures/` or is in the target band but on neither list. Build the done+absent key-set from disk before any call. Atomic writes (`.tmp` → `os.replace`); clean stale `.tmp` first.

## HF reads work DIRECTLY from the browser (corrects ETL_RUNBOOK §8)

Live-probed: `…/resolve/main/<parquet>` 302→`cas-bridge.xethub.hf.co` returns **206** for byte-range GETs with CORS reflected and a passing preflight. **No `/api/mkt` proxy is required.** Caveats the data layer handles: signed URL `Expires` (~1h, re-resolve on expiry); resolver limit **3000/300s per IP** (coalesce + throttle + "data busy" state).

## Safe delete-after-push

- DRY-RUN `verify_hf_and_prune.py` first; read the per-expiry OK/BAD table.
- Require a **two-sided** check before any `rmtree`: HF `get_paths_info` existence **AND** duckdb remote-row-count == an **independent count from the ORIGINAL archive footers** (not only the staging twin — a normalize bug must not pass against a corrupted derivative).
- Prune **expiry-by-expiry** (35 GB free is never exhausted). Keep `--prune-staging` **OFF** until the WHOLE dataset is HF-verified, retaining a local fallback. Treat HF as the only backup **only after** full independent verification.

## License

Dataset is **cc-by-nc-4.0**; Groww-sourced. Commercial-use sign-off + attribution + 'no investment advice' disclaimer is an open decision (see openDecisions).
