# ETL cron — daily NIFTY-50 stock-option fetch → HF → verify → prune

Run `orchestrate.py` once per day, AFTER the Indian market closes, in the
disk-conserving **LIVE + PRUNE** mode. The prune only deletes a local
`(symbol, expiry)` after `verify_hf_and_prune.py` proves the HF upload's row
count matches the local staging file — so a failed/partial upload can never
trigger a delete.

- Market close: 15:30 IST. Schedule for **18:00 IST** (gives EOD candles time to
  settle on Groww). 18:00 IST = 12:30 UTC.
- The Groww access token is valid for the trading day and cached
  (`market-data/_etl_staging/.groww_token.json`); the run mints once if stale.
- Requires `HF_TOKEN` (fine-grained WRITE, scoped to the ONE dataset repo) in the
  environment for the upload step. Without it the run STOPS before verify/prune
  (nothing is deleted).

## Windows Task Scheduler (this machine)

The worktree is at `C:\Users\raash\Desktop\tm-etl`. Run a small wrapper so the
env (incl. `HF_TOKEN`) is loaded and output is logged.

Create `scripts\etl\run-cron.cmd` (NOT committed — it carries the token) or set
`HF_TOKEN` as a machine/user env var, then register the task:

```bat
:: scripts\etl\run-cron.cmd  — set HF_TOKEN here OR rely on a user env var
@echo off
set PYTHONUTF8=1
:: set HF_TOKEN=hf_xxxxxxxx   (omit if HF_TOKEN is already a user env var)
cd /d C:\Users\raash\Desktop\tm-etl
python scripts\etl\orchestrate.py ^
  --archive C:\Users\raash\Desktop\trading-journal\market-data\market_archive_1m ^
  --staging C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging ^
  --no-dry-run --prune --prune-staging --workers 6 ^
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
