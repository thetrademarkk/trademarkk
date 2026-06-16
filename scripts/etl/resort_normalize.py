"""
resort_normalize.py — the D9 RE-SORT + NORMALIZE pipeline (docs/07-data-layer §1).

Transforms the archive's per-strike option files (one tiny 1-row-group parquet
per contract, with THREE different timestamp dtypes — string,
timestamp[ns,tz=Asia/Kolkata], timestamp[ns,tz=+05:30] — and a mixed
open_interest type) into the HF dataset's canonical, query-fast layout:

  options/<SYM>/<EXPIRY>.parquet   — ONE file per expiry holding the whole chain,
    * normalized timestamp -> timestamp[ns, tz=+05:30]  (canonical IST, FIXED
      offset so NO IANA tz database is required — Windows-safe; the instant is
      preserved exactly for all three source dtypes),
    * open_interest -> int64 (null -> 0),
    * volume -> int64, OHLC -> double,
    * added columns strike (int32), option_type (CE|PE), expiry (string),
      symbol (string),
    * SORTED BY (trading_day, strike, option_type, timestamp),
    * ROW GROUPS = ~1 trading day each (so a (trading_day, strike) predicate
      prunes to one or two row groups),
    * column statistics ON, ZSTD compression, dictionary encoding for the
      low-cardinality string columns.

  index/<SYM>.parquet              — ONE file per symbol, all months concatenated,
    same timestamp normalization, sorted by timestamp, daily row groups.

WHY canonical = FIXED offset (+05:30), not Asia/Kolkata: India has had no DST
since 1945, so the offset is constant; a fixed-offset timestamp needs no tz
database (pyarrow's assume_timezone/Asia-Kolkata path fails on machines without
a built IANA db, e.g. this Windows box) yet round-trips through DuckDB/Arrow
identically and displays as IST everywhere.

This writes to a GITIGNORED staging dir; it NEVER touches the originals. Run on a
representative SAMPLE to prove correctness + measure the win (default), or with
--full to produce the entire HF-ready tree (owner step — large; see ETL_RUNBOOK).

Usage:
    # sample (default): a few high- + low-coverage expiries per symbol
    python scripts/etl/resort_normalize.py \
        --archive C:/.../market_archive_1m \
        --out      C:/.../_etl_staging/hf \
        --sample

    # one explicit expiry:
    python scripts/etl/resort_normalize.py --archive ... --out ... \
        --symbol NIFTY --expiry 2024-07-25

    # FULL HF tree (owner; large):
    python scripts/etl/resort_normalize.py --archive ... --out ... --full --workers 8
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
CANON_TZ = "+05:30"  # fixed IST offset (no IANA db needed)
IST_OFFSET_NS = (5 * 3600 + 30 * 60) * 1_000_000_000
_FNAME = re.compile(r"-(\d+)-(CE|PE)\.parquet$")

# canonical column order for option rows
OPT_COLS = [
    "timestamp", "open", "high", "low", "close", "volume",
    "open_interest", "trading_day", "symbol", "strike", "option_type", "expiry",
]
IDX_COLS = ["timestamp", "open", "high", "low", "close", "volume", "trading_day", "symbol"]


def parse_contract(fname: str):
    m = _FNAME.search(fname)
    return (int(m.group(1)), m.group(2)) if m else None


def normalize_ts(col: pa.ChunkedArray) -> pa.Array:
    """Normalize any of the three timestamp dtypes to timestamp[ns, tz=+05:30].

    The instant is preserved exactly:
      * string  "YYYY-MM-DDThh:mm:ss+05:30" -> parse naive wall-clock -> it IS the
        IST wall-clock, so the UTC instant is (wall - 05:30); tag +05:30.
      * timestamp[ns, tz=*] -> a plain cast re-tags the display zone, instant kept.
    """
    if pa.types.is_string(col.type) or pa.types.is_large_string(col.type):
        naive_str = pc.utf8_slice_codeunits(col, 0, 19)  # drop the +05:30 suffix
        naive = pc.strptime(naive_str, format="%Y-%m-%dT%H:%M:%S", unit="ns")
        utc_int = pc.subtract(naive.cast(pa.int64()), IST_OFFSET_NS)
        return utc_int.cast(pa.timestamp("ns", tz=CANON_TZ))
    if pa.types.is_timestamp(col.type):
        return col.cast(pa.timestamp("ns", tz=CANON_TZ))
    raise TypeError(f"unexpected timestamp dtype: {col.type}")


def normalize_int(col, fill=0):
    """double/null/int -> int64 with nulls filled."""
    if pa.types.is_null(col.type):
        return pa.array([fill] * len(col), type=pa.int64())
    filled = pc.fill_null(col, fill)
    return pc.round(filled).cast(pa.int64())


def read_contract_table(path: str, sym: str, expiry: str, strike: int, ot: str) -> pa.Table:
    t = pq.read_table(path)
    n = t.num_rows
    ts = normalize_ts(t.column("timestamp"))
    out = {
        "timestamp": ts,
        "open": t.column("open").cast(pa.float64()),
        "high": t.column("high").cast(pa.float64()),
        "low": t.column("low").cast(pa.float64()),
        "close": t.column("close").cast(pa.float64()),
        "volume": normalize_int(t.column("volume")),
        "open_interest": normalize_int(t.column("open_interest")),
        "trading_day": t.column("trading_day").cast(pa.string()),
        "symbol": pa.array([sym] * n, type=pa.string()),
        "strike": pa.array([strike] * n, type=pa.int32()),
        "option_type": pa.array([ot] * n, type=pa.string()),
        "expiry": pa.array([expiry] * n, type=pa.string()),
    }
    return pa.table(out)


def opt_schema() -> pa.Schema:
    return pa.schema([
        ("timestamp", pa.timestamp("ns", tz=CANON_TZ)),
        ("open", pa.float64()), ("high", pa.float64()),
        ("low", pa.float64()), ("close", pa.float64()),
        ("volume", pa.int64()), ("open_interest", pa.int64()),
        ("trading_day", pa.string()), ("symbol", pa.string()),
        ("strike", pa.int32()), ("option_type", pa.string()), ("expiry", pa.string()),
    ])


def write_daily_rowgroups(tbl: pa.Table, out_path: str, group_keys=None) -> None:
    """Write row groups along contiguous runs of `group_keys`, ZSTD, stats on, so a
    (trading_day, strike) predicate prunes to a couple of groups.

    `group_keys` is a per-row list whose contiguous runs define the row-group
    boundaries (the table must already be sorted so equal keys are contiguous).
    Defaults to one row group per `trading_day` — correct for an OPTION file (a
    handful of days). The INDEX file spans ~1200 trading days, so one-per-day makes
    ~1200 tiny row groups and a windowed read must touch hundreds of them (≈20s);
    pass MONTH keys there instead (~60 groups, each still trading_day-sorted so
    min/max stats prune a date window cleanly)."""
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    keys = group_keys if group_keys is not None else tbl.column("trading_day").to_pylist()
    # contiguous run-length of each key (tbl is already sorted so runs are contiguous)
    boundaries = []
    start = 0
    for i in range(1, len(keys) + 1):
        if i == len(keys) or keys[i] != keys[start]:
            boundaries.append(i - start)
            start = i
    # Only dictionary-encode columns that exist (the index file has no option_type).
    dict_cols = [c for c in ("symbol", "option_type", "trading_day") if c in tbl.schema.names]
    writer = pq.ParquetWriter(
        out_path, tbl.schema, compression="zstd",
        use_dictionary=dict_cols,
        write_statistics=True,
    )
    off = 0
    for rg_len in boundaries:
        writer.write_table(tbl.slice(off, rg_len))
        off += rg_len
    writer.close()


def resort_expiry(archive: str, sym: str, expiry: str, out_root: str) -> dict:
    """Re-sort one expiry's whole chain into one normalized file. Returns metrics."""
    ed = os.path.join(archive, "options", sym, expiry)
    paths = []
    for f in os.listdir(ed):
        if f.endswith(".parquet"):
            c = parse_contract(f)
            if c:
                paths.append((os.path.join(ed, f), c[0], c[1]))
    in_files = len(paths)
    in_bytes = sum(os.path.getsize(p) for p, _, _ in paths)
    if not paths:
        return {"symbol": sym, "expiry": expiry, "in_files": 0, "skipped": True}

    tables = [read_contract_table(p, sym, expiry, s, o) for p, s, o in paths]
    combined = pa.concat_tables(tables).cast(opt_schema())
    # SORT (trading_day, strike, option_type, timestamp)
    idx = pc.sort_indices(
        combined,
        sort_keys=[("trading_day", "ascending"), ("strike", "ascending"),
                   ("option_type", "ascending"), ("timestamp", "ascending")],
    )
    sorted_tbl = combined.take(idx)
    out_path = os.path.join(out_root, "options", sym, f"{expiry}.parquet")
    write_daily_rowgroups(sorted_tbl, out_path)
    out_bytes = os.path.getsize(out_path)
    md = pq.ParquetFile(out_path).metadata
    return {
        "symbol": sym, "expiry": expiry, "skipped": False,
        "in_files": in_files, "in_bytes": in_bytes,
        "out_file": out_path, "out_bytes": out_bytes, "out_rows": md.num_rows,
        "out_row_groups": md.num_row_groups,
    }


def resort_index(archive: str, sym: str, out_root: str) -> dict:
    sroot = os.path.join(archive, "index", sym)
    files = sorted(glob.glob(os.path.join(sroot, "*", "*.parquet")))
    if not files:
        return {"symbol": sym, "skipped": True}
    in_bytes = sum(os.path.getsize(f) for f in files)
    tables = []
    for f in files:
        t = pq.read_table(f)
        n = t.num_rows
        tables.append(pa.table({
            "timestamp": normalize_ts(t.column("timestamp")),
            "open": t.column("open").cast(pa.float64()),
            "high": t.column("high").cast(pa.float64()),
            "low": t.column("low").cast(pa.float64()),
            "close": t.column("close").cast(pa.float64()),
            "volume": normalize_int(t.column("volume")),
            "trading_day": t.column("trading_day").cast(pa.string()),
            "symbol": pa.array([sym] * n, type=pa.string()),
        }))
    schema = pa.schema([
        ("timestamp", pa.timestamp("ns", tz=CANON_TZ)),
        ("open", pa.float64()), ("high", pa.float64()),
        ("low", pa.float64()), ("close", pa.float64()),
        ("volume", pa.int64()), ("trading_day", pa.string()), ("symbol", pa.string()),
    ])
    combined = pa.concat_tables(tables).cast(schema)
    idx = pc.sort_indices(combined, sort_keys=[("timestamp", "ascending")])
    sorted_tbl = combined.take(idx)
    out_path = os.path.join(out_root, "index", f"{sym}.parquet")
    # MONTH-sized row groups (not per-day): the index spans ~1200 days, so per-day
    # groups (~1200) make a windowed read crawl. Month keys give ~60 groups, each
    # trading_day-sorted so a `trading_day BETWEEN` window still prunes cleanly.
    month_keys = [d[:7] for d in sorted_tbl.column("trading_day").to_pylist()]
    write_daily_rowgroups(sorted_tbl, out_path, group_keys=month_keys)
    return {
        "symbol": sym, "skipped": False, "in_files": len(files), "in_bytes": in_bytes,
        "out_file": out_path, "out_bytes": os.path.getsize(out_path),
        "out_rows": sorted_tbl.num_rows,
    }


def pick_sample(archive: str):
    """A few HIGH- + LOW-coverage expiries across all three symbols.
    Heuristic: per symbol pick 2 dense recent + 1 sparse early expiry."""
    sample = []
    for sym in SYMBOLS:
        sroot = os.path.join(archive, "options", sym)
        if not os.path.isdir(sroot):
            continue
        exps = sorted(
            e for e in os.listdir(sroot)
            if glob.glob(os.path.join(sroot, e, "*.parquet"))  # has real data
        )
        if not exps:
            continue
        chosen = []
        chosen.append(exps[-1])                # latest (recent, usually dense)
        if len(exps) > 2:
            chosen.append(exps[len(exps) // 2])  # middle
        chosen.append(exps[0])                 # earliest (often sparse)
        for e in dict.fromkeys(chosen):
            sample.append((sym, e))
    return sample


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Re-sort + normalize the archive into the HF layout (staging).")
    ap.add_argument("--archive", required=True)
    ap.add_argument("--out", required=True, help="GITIGNORED staging output root.")
    ap.add_argument("--sample", action="store_true", help="Run on the representative sample (default if no target).")
    ap.add_argument("--full", action="store_true", help="Full HF tree (owner step; large).")
    ap.add_argument("--symbol", default=None)
    ap.add_argument("--expiry", default=None)
    ap.add_argument("--with-index", action="store_true", help="Also re-sort the index layer.")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        print(f"ERROR: archive not found: {args.archive}", file=sys.stderr)
        return 2

    targets = []
    if args.symbol and args.expiry:
        targets = [(args.symbol, args.expiry)]
    elif args.full:
        for sym in SYMBOLS:
            sroot = os.path.join(args.archive, "options", sym)
            if os.path.isdir(sroot):
                for e in sorted(os.listdir(sroot)):
                    if glob.glob(os.path.join(sroot, e, "*.parquet")):
                        targets.append((sym, e))
    else:
        targets = pick_sample(args.archive)  # default = sample

    print(f"re-sorting {len(targets)} expiries -> {args.out}")
    tot_in_files = tot_in = tot_out = tot_rows = 0
    results = []

    def work(t):
        return resort_expiry(args.archive, t[0], t[1], args.out)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for r in ex.map(work, targets):
            results.append(r)
            if r.get("skipped"):
                continue
            tot_in_files += r["in_files"]
            tot_in += r["in_bytes"]
            tot_out += r["out_bytes"]
            tot_rows += r["out_rows"]
            print(
                f"  {r['symbol']}/{r['expiry']}: {r['in_files']} files "
                f"({r['in_bytes']/1024:.0f}KB) -> 1 file ({r['out_bytes']/1024:.0f}KB, "
                f"{r['out_row_groups']} row-groups, {r['out_rows']} rows)"
            )

    if args.with_index or args.full:
        for sym in SYMBOLS:
            r = resort_index(args.archive, sym, args.out)
            if not r.get("skipped"):
                print(f"  index/{sym}: {r['in_files']} files ({r['in_bytes']/1024:.0f}KB) "
                      f"-> 1 file ({r['out_bytes']/1024:.0f}KB, {r['out_rows']} rows)")

    print("\n=== RE-SORT SUMMARY ===")
    print(f"  expiries processed : {sum(1 for r in results if not r.get('skipped'))}")
    print(f"  input  : {tot_in_files} files, {tot_in/1024/1024:.2f} MB")
    print(f"  output : {len([r for r in results if not r.get('skipped')])} files, {tot_out/1024/1024:.2f} MB, {tot_rows} rows")
    if tot_in:
        print(f"  file-count reduction : {tot_in_files} -> {len([r for r in results if not r.get('skipped')])} "
              f"({tot_in_files / max(len([r for r in results if not r.get('skipped')]),1):.0f}x fewer)")
        print(f"  size ratio (out/in)  : {tot_out/tot_in*100:.1f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
