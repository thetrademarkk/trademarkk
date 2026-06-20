:: run-cron.cmd — daily disk-safe ETL: index + stock option chains -> HF -> verify -> prune
:: HF_TOKEN is auto-loaded from .env.local by orchestrate.py (--env-file), so this
:: wrapper carries NO secret and is safe to commit. Registered in Windows Task
:: Scheduler to run daily after IST market close (18:00 IST). See etl-cron.md.
@echo off
set PYTHONUTF8=1
cd /d C:\Users\raash\Desktop\tm-etl

echo [run-cron] %DATE% %TIME% START stock track >> C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging\cron.log
:: STOCK track (default): union of NIFTY-50 + Sensex-30 (53 names), +/-20%% band, disk-safe slice loop
python scripts\etl\orchestrate.py ^
  --archive C:\Users\raash\Desktop\trading-journal\market-data\market_archive_1m ^
  --staging C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging ^
  --track stocks --no-dry-run --prune --workers 6 --min-interval 0.18 ^
  >> C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging\cron.log 2>&1

echo [run-cron] %DATE% %TIME% START index track >> C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging\cron.log
:: INDEX track: NIFTY/BANKNIFTY/SENSEX option chains, gap-fill +/-20%%, disk-safe slice loop
python scripts\etl\orchestrate.py ^
  --archive C:\Users\raash\Desktop\trading-journal\market-data\market_archive_1m ^
  --staging C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging ^
  --track index --no-dry-run --prune --workers 6 --min-interval 0.18 ^
  >> C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging\cron.log 2>&1

echo [run-cron] %DATE% %TIME% DONE >> C:\Users\raash\Desktop\tm-etl\market-data\_etl_staging\cron.log
