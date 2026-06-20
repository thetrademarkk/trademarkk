"""
build_daily_aggregates.py — EOD daily aggregates for the HF dataset (the `daily/`
tree the data card references; cheap precomputed rollups the coverage layer and
the BT-10 presets can read without scanning 1m bars).

Per (symbol, expiry, strike, option_type, trading_day) it emits one row:
  open, high, low, close (the day's OHLC from the 1m bars),
  volume (sum), open_interest (last), bars (count present),
  coverage_day (bars / EXPECTED_BARS_PER_DAY clamped).

Reads ONLY the columns it needs from the per-strike files (no full materialize).
Writes ONE parquet per symbol: daily/<SYM>.parquet (ZSTD, sorted by
(trading_day, strike, option_type)), gitignored staging.

Usage:
    python scripts/etl/build_daily_aggregates.py \
        --archive C:/.../market_archive_1m \
        --out      C:/.../_etl_staging/daily \
        --symbols NIFTY --max-expiries 4 --workers 12
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import pyarrow as pa
import pyarrow.parquet as pq

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
EXPECTED_BARS_PER_DAY = 375
# integer (index) OR fractional (single-stock: ITC 257.5) strikes
_FNAME = re.compile(r"-(\d+(?:\.\d+)?)-(CE|PE)\.parquet$")


def parse_contract(fname: str):
    m = _FNAME.search(fname)
    if not m:
        return None
    s = float(m.group(1))
    s = int(s) if s == int(s) else s
    return (s, m.group(2))


def iso_day(ts) -> str:
    return str(ts)[:10]


def aggregate_contract(path: str, sym: str, expiry: str, strike: int, ot: str):
    """Return per-day rows for one contract."""
    t = pq.read_table(
        path, columns=["timestamp", "open", "high", "low", "close", "volume", "open_interest", "trading_day"]
    ).to_pydict()
    n = len(t["trading_day"])
    by_day = {}
    for i in range(n):
        d = iso_day(t["trading_day"][i])
        rec = by_day.get(d)
        o, h, l, c = t["open"][i], t["high"][i], t["low"][i], t["close"][i]
        v = float(t["volume"][i] or 0)
        oi = t["open_interest"][i]
        ts = str(t["timestamp"][i])
        if rec is None:
            by_day[d] = {
                "first_ts": ts, "last_ts": ts,
                "open": o, "high": h, "low": l, "close": c,
                "volume": v, "oi": oi if oi is not None else 0, "bars": 1,
            }
        else:
            if ts < rec["first_ts"]:
                rec["first_ts"], rec["open"] = ts, o
            if ts > rec["last_ts"]:
                rec["last_ts"], rec["close"], rec["oi"] = ts, c, (oi if oi is not None else rec["oi"])
            if h is not None and (rec["high"] is None or h > rec["high"]):
                rec["high"] = h
            if l is not None and (rec["low"] is None or l < rec["low"]):
                rec["low"] = l
            rec["volume"] += v
            rec["bars"] += 1
    rows = []
    for d, r in by_day.items():
        rows.append({
            "symbol": sym, "expiry": expiry, "strike": strike, "option_type": ot,
            "trading_day": d,
            "open": float(r["open"]) if r["open"] is not None else None,
            "high": float(r["high"]) if r["high"] is not None else None,
            "low": float(r["low"]) if r["low"] is not None else None,
            "close": float(r["close"]) if r["close"] is not None else None,
            "volume": int(round(r["volume"])),
            "open_interest": int(round(float(r["oi"]))),
            "bars": r["bars"],
            "coverage_day": round(min(r["bars"] / EXPECTED_BARS_PER_DAY, 1.0), 4),
        })
    return rows


def daily_schema(strike_type=pa.int32()) -> pa.Schema:
    return pa.schema([
        ("symbol", pa.string()), ("expiry", pa.string()),
        ("strike", strike_type), ("option_type", pa.string()),
        ("trading_day", pa.string()),
        ("open", pa.float64()), ("high", pa.float64()),
        ("low", pa.float64()), ("close", pa.float64()),
        ("volume", pa.int64()), ("open_interest", pa.int64()),
        ("bars", pa.int32()), ("coverage_day", pa.float32()),
    ])


def build_symbol(archive: str, sym: str, max_expiries: int, workers: int,
                 options_root: str = "options"):
    sroot = os.path.join(archive, options_root, sym)
    if not os.path.isdir(sroot):
        return []
    expiries = sorted(os.listdir(sroot))
    if max_expiries and len(expiries) > max_expiries:
        half = max_expiries // 2
        expiries = expiries[:half] + expiries[-(max_expiries - half):]
    all_rows = []
    for exp in expiries:
        ed = os.path.join(sroot, exp)
        try:
            names = os.listdir(ed)
        except NotADirectoryError:
            continue
        jobs = []
        for f in names:
            if f.endswith(".parquet"):
                c = parse_contract(f)
                if c:
                    jobs.append((os.path.join(ed, f), c[0], c[1]))
        if not jobs:
            continue
        with ThreadPoolExecutor(max_workers=workers) as ex:
            for rows in ex.map(lambda j: aggregate_contract(j[0], sym, exp, j[1], j[2]), jobs):
                all_rows.extend(rows)
        sys.stderr.write(f"  {sym}/{exp}: {len(jobs)} contracts -> {len(all_rows)} cum daily rows\n")
    return all_rows


def write_daily(rows, out_dir: str, sym: str) -> str:
    os.makedirs(out_dir, exist_ok=True)
    rows.sort(key=lambda r: (r["trading_day"], float(r["strike"]), r["option_type"]))
    # fractional stock strikes -> float64 schema; index -> int32 (unchanged)
    frac = any(isinstance(r["strike"], float) for r in rows)
    schema = daily_schema(pa.float64() if frac else pa.int32())
    cols = {name: [r[name] for r in rows] for name in schema.names}
    tbl = pa.table(cols, schema=schema)
    out = os.path.join(out_dir, f"{sym}.parquet")
    pq.write_table(tbl, out, compression="zstd", use_dictionary=["symbol", "option_type"], write_statistics=True)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build EOD daily aggregates (read-only over the archive).")
    ap.add_argument("--archive", required=True)
    ap.add_argument("--out", required=True, help="GITIGNORED daily/ output dir.")
    ap.add_argument("--symbols", nargs="*", default=list(SYMBOLS))
    ap.add_argument("--options-root", default="options",
                    help="Option subtree ('options' index, 'stocks_options' single-stock).")
    ap.add_argument("--max-expiries", type=int, default=0)
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        print(f"ERROR: archive not found: {args.archive}", file=sys.stderr)
        return 2

    print(f"=== DAILY AGGREGATES ({args.options_root}) ===")
    syms = args.symbols
    if args.options_root != "options" and args.symbols == list(SYMBOLS):
        base = os.path.join(args.archive, args.options_root)
        syms = sorted(os.listdir(base)) if os.path.isdir(base) else []
    for sym in syms:
        rows = build_symbol(args.archive, sym, args.max_expiries, args.workers, args.options_root)
        if not rows:
            print(f"  {sym}: no data")
            continue
        out = write_daily(rows, args.out, sym)
        print(f"  {sym}: {len(rows)} daily rows -> {out} ({os.path.getsize(out)/1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
