# ETL Runbook — building & publishing the HF dataset

How to turn the local 1-minute market archive into the public Hugging Face
dataset `thetrademarkk/india-index-options-1m` that the backtesting platform's
data layer (BT-08) reads. Everything up to the upload is runnable today with no
secrets; the **upload alone** is owner-gated on a Hugging Face write token.

All scripts are in `scripts/etl/` and are **read-only** over the archive — they
never modify, move, or delete the originals (the archive is the user's data).

## 0. What the owner must provide (the only blocker)

To publish the dataset the owner must hand over three things:

1. **HF account / org name** — e.g. `thetrademarkk`. The dataset id is
   `<account>/india-index-options-1m`. (The platform code and this card already
   assume `thetrademarkk`; if it differs, update `DATASET_VERSION`/URLs in the
   BT-08 data layer.)
2. **A fine-grained WRITE token, scoped to ONLY this one dataset repo.** Create
   at https://huggingface.co/settings/tokens → _Fine-grained_ → grant
   _Write_ to the single dataset repo. Do **not** use an account-wide token. The
   token is consumed only by `upload_hf.py`, read from the shell env (`HF_TOKEN`),
   and is **never** committed, hardcoded, or shipped in client JS.
3. **A confirmation that the dataset will be PUBLIC + UNGATED.** Public + ungated
   means the browser's `duckdb-wasm` range-reads need **no token at all** — which
   is what makes the zero-infra anonymous backtest path work. (If it must be
   gated, BT-08 needs a server-side `hf://` proxy with the token in
   `src/server/env.ts` — more infra; avoid unless required.)

Nothing else is needed. The data is ~3.65 GB and fits the HF free tier.

## 1. Prerequisites

- Python 3.11+, `pyarrow`, `huggingface_hub` (all already present on the build box).
- The archive at `market-data/market_archive_1m/` (gitignored; lives in the main
  checkout). Pass its **absolute** path as `--archive` when running from a worktree.
- A scratch staging dir on a disk with ~8 GB free (the re-sorted tree + manifest
  - daily aggregates). Keep it OUT of git (use `market-data/_etl_staging/`, which
    is under the gitignored `market-data/`).

```sh
ARCHIVE="C:/Users/<you>/Desktop/trading-journal/market-data/market_archive_1m"
STAGE="C:/Users/<you>/Desktop/trading-journal/market-data/_etl_staging"
HF="$STAGE/hf"        # the tree we upload
```

## 2. Characterize the archive (optional sanity check)

```sh
python scripts/etl/inspect_archive.py --archive "$ARCHIVE" --json "$STAGE/inspect.json"
```

Confirms file counts, per-symbol spans, the **timestamp-dtype mismatch** (three
physical dtypes — `string`, `timestamp[ns,tz=Asia/Kolkata]`,
`timestamp[ns,tz=+05:30]` — that step 4 normalizes), and a progress-based
coverage proxy. Read-only; writes nothing to the archive.

## 3. Build the coverage manifest

```sh
python scripts/etl/build_manifest.py \
  --archive "$ARCHIVE" \
  --staging "$HF" \
  --out-json public/backtest/manifest/coverage-summary.json \
  --workers 14
```

Produces:

- `"$HF"/manifest.parquet` — full per-`(symbol,expiry,strike,option_type)` table
  (uploaded to HF; read at runtime by BT-08). ~1 MB.
- `public/backtest/manifest/coverage-summary.json` — the COMPACT per-symbol +
  per-expiry rollup committed to the repo (~110 KB) that the engine reads for
  default medVol / coverage without any network call. Verify it is **< 2 MB**
  before committing (the script warns if not).

Runtime ~3–6 min over the whole archive (warm cache) with 14 workers. Reads only
the `trading_day` + `volume` columns plus footers — never OHLC.

## 4. Re-sort + normalize into the HF layout

> First prove the win on a sample, then run the full tree.

```sh
# 4a. sample (a few high- + low-coverage expiries per symbol) — fast, measures the win
python scripts/etl/resort_normalize.py --archive "$ARCHIVE" --out "$STAGE/sample-hf" --sample

# 4b. FULL HF tree (large — the owner step) + the normalized index layer
python scripts/etl/resort_normalize.py --archive "$ARCHIVE" --out "$HF" --full --workers 8
```

Each expiry's hundreds of tiny per-strike files collapse into **one**
`options/<SYM>/<EXPIRY>.parquet`, normalized to canonical
`timestamp[ns, tz=+05:30]`, sorted by `(trading_day, strike, option_type,
timestamp)`, written with ~1-trading-day row groups, ZSTD, stats ON. Measured on
the sample: **~206x fewer files**, output ≈ **40%** of the input bytes, and a
single `(trading_day, strike)` read prunes to ~1 row group (≈ 12% of the file).

Expected full output: ~522 option files + 3 index files, on the order of ~1.5 GB
(ZSTD-compressed; well under the 3.65 GB raw). Disk: needs the staging space in
§1. Runtime tens of minutes.

## 5. Daily aggregates

```sh
python scripts/etl/build_daily_aggregates.py --archive "$ARCHIVE" --out "$HF/daily" --workers 12
```

Writes `daily/<SYM>.parquet` (EOD per-`(strike,type,day)` OHLC + volume + OI +
coverage_day). Small; helps BT-10 presets and the coverage UI avoid 1m scans.

## 6. Drop in the dataset card

```sh
cp docs/backtesting/DATASET_CARD.md "$HF/README.md"
```

`README.md` at the dataset root is the HF dataset card (the YAML front-matter
declares the `index` / `options` / `daily` / `manifest` configs).

The tree to upload now looks like:

```
$HF/
  README.md
  manifest.parquet
  index/<SYM>.parquet
  options/<SYM>/<EXPIRY>.parquet
  daily/<SYM>.parquet
```

## 7. Upload (OWNER — needs the token from §0)

```sh
# preview first (no token needed):
python scripts/etl/upload_hf.py --repo thetrademarkk/india-index-options-1m --folder "$HF" --dry-run

# then the real upload:
export HF_TOKEN=hf_xxxxxxxx            # the fine-grained WRITE token from §0
python scripts/etl/upload_hf.py \
  --repo thetrademarkk/india-index-options-1m \
  --folder "$HF" \
  --workers 12 \
  --confirm
```

`upload_hf.py` **refuses** to upload unless a token is in the env AND `--confirm`
is passed AND the tree looks complete. It creates the repo (`exist_ok`), public +
ungated by default, and uses `upload_large_folder` (resumable, multi-worker). On
a flaky connection just re-run — it resumes.

Verify at `https://huggingface.co/datasets/thetrademarkk/india-index-options-1m`.

## 8. How BT-08 consumes the result

Once the dataset is live and public:

- The browser `duckdb-wasm` data layer range-reads
  `…/resolve/main/options/<SYM>/<EXPIRY>.parquet` **through the same-origin
  `/api/mkt/[...path]` Vercel range-proxy** (HF's Xet/CAS bridge blocks direct
  browser range-reads via CORS — see plan D1). The proxy forwards the `Range`
  header, streams the 206, and adds `Access-Control-Allow-Origin` +
  `Accept-Ranges` + a long CDN `s-maxage`.
- The 6-function `DataSource` (`loadIndex` / `loadOption` / `resolveStrike` /
  `atmStrike` / `optionChainAt` / `coverageFor`) is implemented over DuckDB SQL
  with predicate + projection pushdown — the row-group sort from §4 is what keeps
  a cold backtest under the < 2 MB / < 4 s mobile budget.
- `coverageFor` and the BT-04 fill-model's `medVol` read `manifest.parquet`
  (full) at runtime; the committed `public/backtest/manifest/coverage-summary.json`
  gives the engine sane per-`(symbol,expiry)` defaults offline.

No CSP change is needed (`connect-src self https: wss:` already allows it) and no
COEP (the path is single-threaded). The dataset being ungated is what keeps the
anonymous browser path token-free.
