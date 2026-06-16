"""
fetch_stocks_spot.py — backfill NIFTY-50 single-stock SPOT 1-minute candles from
Groww into the local archive, resumably. Mirrors the index-spot layout so
resort_normalize can later consolidate + push to HF.

Groww feasibility (verified): single-stock 1m spot goes back to ~2021, segment
CASH, groww_symbol "NSE-<SYM>". Same get_historical_candles V2 API + the 30-day
1m window cap as the index/options fetch, so we chunk into <=28-day windows.

  PYTHONUTF8=1 python scripts/etl/fetch_stocks_spot.py \
      --archive C:/Users/raash/Desktop/trading-journal/market-data/market_archive_1m \
      --start 2021-01-01 --min-interval 0.75

Idempotent + resumable: one parquet per (symbol, month) at
  <archive>/stocks_spot/<SYM>/<YYYY>/<YYYY-MM>.parquet
Existing month files are skipped, so Ctrl-C / crash / cron just continue. SAFE:
READ-ONLY against Groww (only get_access_token + get_all_instruments +
get_historical_candles), never places orders. No secrets are logged.
"""

import argparse
import datetime as dt
import os
import sys
import time

# Current NIFTY-50 membership (NSE). Resolved against the Groww instruments master
# at runtime; any symbol without a CASH listing is logged + skipped.
NIFTY50 = [
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK", "BAJAJ-AUTO",
    "BAJFINANCE", "BAJAJFINSV", "BEL", "BPCL", "BHARTIARTL", "BRITANNIA", "CIPLA",
    "COALINDIA", "DRREDDY", "EICHERMOT", "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE",
    "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY", "ITC",
    "JSWSTEEL", "KOTAKBANK", "LT", "LTIM", "M&M", "MARUTI", "NESTLEIND", "NTPC",
    "ONGC", "POWERGRID", "RELIANCE", "SBILIFE", "SBIN", "SHRIRAMFIN", "SUNPHARMA",
    "TATACONSUM", "TATAMOTORS", "TATASTEEL", "TCS", "TECHM", "TITAN", "TRENT",
    "ULTRACEMCO", "WIPRO",
]

MARKET_OPEN = "09:15:00"
MARKET_CLOSE = "15:30:00"


def load_env(path: str = ".env.local") -> dict:
    env = {}
    if not os.path.exists(path):
        return env
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("'").strip('"')
    return env


def month_windows(start_day: str, end_day: str):
    """Yield (year, month, first_day, last_day) calendar-month spans in range."""
    s = dt.date.fromisoformat(start_day)
    e = dt.date.fromisoformat(end_day)
    y, m = s.year, s.month
    while (y, m) <= (e.year, e.month):
        first = dt.date(y, m, 1)
        nxt = dt.date(y + (m // 12), (m % 12) + 1, 1)
        last = nxt - dt.timedelta(days=1)
        lo = max(first, s)
        hi = min(last, e)
        yield y, m, lo.isoformat(), hi.isoformat()
        y, m = nxt.year, nxt.month


def day_windows(lo: str, hi: str, max_days: int = 28):
    """Split [lo, hi] into <=max_days windows (Groww 1m caps at 30 days/request)."""
    s = dt.date.fromisoformat(lo)
    e = dt.date.fromisoformat(hi)
    cur = s
    while cur <= e:
        win_end = min(cur + dt.timedelta(days=max_days - 1), e)
        yield cur.isoformat(), win_end.isoformat()
        cur = win_end + dt.timedelta(days=1)


def resolve_spot_symbols(g):
    """Map each NIFTY-50 name → its Groww CASH groww_symbol (EQ series)."""
    import pandas as pd

    inst = g.get_all_instruments()
    df = inst if isinstance(inst, pd.DataFrame) else pd.DataFrame(inst)
    cash = df[(df["segment"] == "CASH")]
    out = {}
    missing = []
    for sym in NIFTY50:
        rows = cash[(cash["trading_symbol"] == sym) | (cash["underlying_symbol"] == sym)]
        eq = rows[rows.get("series", "EQ") == "EQ"] if "series" in rows else rows
        pick = eq if len(eq) else rows
        if len(pick):
            gs = str(pick.iloc[0]["groww_symbol"])
            out[sym] = gs
        else:
            missing.append(sym)
    if missing:
        print(f"[fetch-stocks] no CASH listing for: {missing} (skipped)")
    return out


def fetch_month(g, gs, lo, hi, sym, min_interval, max_retries=4):
    """Fetch one month's 1m spot candles (chunked), return list-of-rows or None."""
    from growwapi import GrowwAPI

    rows = []
    for cs, ce in day_windows(lo, hi):
        start = f"{cs} {MARKET_OPEN}"
        end = f"{ce} {MARKET_CLOSE}"
        for attempt in range(max_retries + 1):
            time.sleep(min_interval)
            try:
                r = g.get_historical_candles(
                    exchange="NSE", segment="CASH", groww_symbol=gs,
                    start_time=start, end_time=end,
                    candle_interval=GrowwAPI.CANDLE_INTERVAL_MIN_1,
                )
                candles = r.get("candles") if isinstance(r, dict) else None
                if candles:
                    rows.extend(candles)
                break
            except Exception as e:  # noqa: BLE001
                if attempt >= max_retries:
                    print(f"[fetch-stocks] {sym} {cs}..{ce} failed: {str(e)[:100]}")
                else:
                    time.sleep(min(2 ** attempt, 8))
    return rows


def write_month(path, rows, sym):
    import pyarrow as pa
    import pyarrow.parquet as pq

    if not rows:
        return 0
    ts, o, h, l, c, v, oi, td = [], [], [], [], [], [], [], []
    for r in rows:
        ts.append(str(r[0]))
        o.append(float(r[1])); h.append(float(r[2])); l.append(float(r[3])); c.append(float(r[4]))
        v.append(int(r[5]) if r[5] is not None else 0)
        oi.append(int(r[6]) if len(r) > 6 and r[6] is not None else None)
        td.append(str(r[0])[:10])
    tbl = pa.table({
        "timestamp": pa.array(ts, type=pa.string()),
        "open": o, "high": h, "low": l, "close": c,
        "volume": pa.array(v, type=pa.int64()),
        "open_interest": pa.array(oi, type=pa.int64()),
        "trading_day": pa.array(td, type=pa.string()),
        "symbol": pa.array([sym] * len(ts), type=pa.string()),
    })
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    pq.write_table(tbl, tmp, compression="zstd")
    os.replace(tmp, path)
    return len(ts)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Backfill NIFTY-50 stock SPOT 1m from Groww (resumable).")
    ap.add_argument("--archive", required=True)
    ap.add_argument("--start", default="2021-01-01")
    ap.add_argument("--end", default=dt.date.today().isoformat())
    ap.add_argument("--min-interval", type=float, default=0.75)
    ap.add_argument("--symbols", nargs="*", default=None, help="Subset of NIFTY-50 (default all).")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    env = load_env()
    from growwapi import GrowwAPI

    g = GrowwAPI(GrowwAPI.get_access_token(api_key=env["GROWW_API_KEY"], secret=env["GROWW_API_SECRET"]))
    spot = resolve_spot_symbols(g)
    syms = args.symbols or NIFTY50
    out_root = os.path.join(args.archive, "stocks_spot")
    print(f"[fetch-stocks] {len(spot)} resolved; fetching {args.start}..{args.end} -> {out_root}")

    total_rows = 0
    for sym in syms:
        gs = spot.get(sym)
        if not gs:
            continue
        for y, m, lo, hi in month_windows(args.start, args.end):
            path = os.path.join(out_root, sym, str(y), f"{y}-{m:02d}.parquet")
            if os.path.exists(path):
                continue
            if args.dry_run:
                print(f"  WOULD fetch {sym} {y}-{m:02d} ({lo}..{hi})")
                continue
            rows = fetch_month(g, gs, lo, hi, sym, args.min_interval)
            n = write_month(path, rows, sym)
            total_rows += n
            if n:
                print(f"  {sym} {y}-{m:02d}: {n} bars")
    print(f"[fetch-stocks] done; {total_rows} new bars.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
