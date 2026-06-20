# ETL cron — daily index+stock option fetch → HF → verify → prune (disk-safe)

Run `orchestrate.py` once per day, AFTER the Indian market closes, in the
disk-conserving **LIVE + PRUNE slice loop** (the default live path). It processes
ONE `(symbol, expiry)` slice end-to-end — fetch → normalize → upload one file →
verify remote rowcount → prune that slice — so local disk never holds more than
~one slice. The prune only deletes a local `(symbol, expiry)` after
`verify_hf_and_prune.py` proves the HF upload's row count matches the local
staging file — so a failed/partial upload can never trigger a delete.

- Market close: 15:30 IST. Schedule for **18:00 IST** (gives EOD candles time to
  settle on Groww). 18:00 IST = 12:30 UTC.
- The Groww access token is valid for the trading day and cached
  (`market-data/_etl_staging/.groww_token.json`); the run mints once if stale.
- Requires `HF_TOKEN` (fine-grained WRITE, scoped to the ONE dataset repo). The
  orchestrator now auto-loads it from `.env.local` (via `--env-file`, default
  `<repo>/.env.local`) if it isn't already a shell/user env var. Without a token
  the run STOPS at the first slice's upload (nothing is deleted).
- Strike band is **±20% on both sides** for BOTH stocks and index (`--strike-pct`,
  default 0.20). Stock universe = UNION of NIFTY-50 + Sensex-30 (53 names; LTIM /
  TATAMOTORS self-skip). Run `--track index` on a separate schedule (or the same
  wrapper) for the index option chains.

## Windows Task Scheduler (this machine)

The worktree is at `C:\Users\raash\Desktop\tm-etl`. Run a small wrapper so the
env (incl. `HF_TOKEN`) is loaded and output is logged.

`HF_TOKEN` is read from `.env.local` automatically, so the wrapper carries no
secret and CAN be committed. Create `scripts\etl\run-cron.cmd`:

```bat
:: scripts\etl\run-cron.cmd  — HF_TOKEN is auto-loaded from .env.local
@echo off
set PYTHONUTF8=1
cd /d C:\Users\raash\Desktop\tm-etl
:: STOCK track (default): union of NIFTY-50 + Sensex-30, ±20% band, disk-safe slice loop
python scripts\etl\orchestrate.py ^
  --archive C:\Users\raash\Desktop\trading-journal\market-data\market_archive_1m ^
  --staging C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging ^
  --track stocks --no-dry-run --prune --workers 6 --min-interval 0.18 ^
  >> C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging\cron.log 2>&1
:: INDEX track: NIFTY/BANKNIFTY/SENSEX option chains, gap-fill ±20%, disk-safe slice loop
python scripts\etl\orchestrate.py ^
  --archive C:\Users\raash\Desktop\trading-journal\market-data\market_archive_1m ^
  --staging C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging ^
  --track index --no-dry-run --prune --workers 6 --min-interval 0.18 ^
  >> C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging\cron.log 2>&1
```

Register it to run daily at 18:00 local (set the machine TZ to IST, or convert):

```powershell
$action  = New-ScheduledTaskAction -Execute "C:\Users\raash\Desktop\tm-etl\scripts\etl\run-cron.cmd"
$trigger = New-ScheduledTaskTrigger -Daily -At 6:00PM
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
            -ExecutionTimeLimit (New-TimeSpan -Hours 10)
Register-ScheduledTask -TaskName "tm-etl-nifty50-options" `
  -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited `
  -Description "Daily NIFTY-50 stock-option 1m fetch -> HF -> verify -> prune"
```

To run it manually once (LIVE) to confirm:

```powershell
Start-ScheduledTask -TaskName "tm-etl-nifty50-options"
Get-Content C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging\cron.log -Tail 40 -Wait
```

To disable / remove:

```powershell
Disable-ScheduledTask -TaskName "tm-etl-nifty50-options"
Unregister-ScheduledTask -TaskName "tm-etl-nifty50-options" -Confirm:$false
```

## Equivalent cron (if run on a Linux/WSL box, IST timezone)

```cron
# 18:00 IST daily — fetch + upload + verify + prune (disk-conserving)
0 18 * * *  cd /path/to/tm-etl && PYTHONUTF8=1 HF_TOKEN=hf_xxx python scripts/etl/orchestrate.py \
  --archive /path/to/market_archive_1m \
  --staging /path/to/tm-etl/market-data/_etl_staging \
  --no-dry-run --prune --prune-staging --workers 6 \
  >> /path/to/tm-etl/market-data/_etl_staging/cron.log 2>&1
```

## Safety notes (the cron CANNOT lose data)

- The PRUNE step is `verify_hf_and_prune.py --delete-confirmed`, which deletes a
  local `(symbol, expiry)` ONLY when the remote HF parquet row count == the local
  staging row count for that expiry. Any mismatch (missing/partial upload) leaves
  the local source intact and the run reports it for re-upload next cycle.
- Every stage is idempotent + resumable, so a missed/failed nightly run simply
  resumes the next night; nothing is double-fetched or double-deleted.
- The first few nights will fetch a LOT (full 2022→now backfill across 48 names);
  it self-paces under Groww's rate cap and resumes across runs. Once caught up,
  each night only fetches the newest expiry's contracts.
