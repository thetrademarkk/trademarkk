"""
inspect_archive.py — characterize the local market-data archive (D9 / ETL).

Reads the collection-process metadata the archive already carries
(`manifest_latest.json`, `manifest_runs.jsonl`, `progress_latest.json`,
`failures/`) and scans parquet *footers* (cheap — no row data is read unless
asked) to produce a fast, honest picture of:

  * per-symbol expiry / file counts (real parquet vs `.empty.json` markers),
  * index spans (first / last trading day per symbol),
  * the timestamp DTYPE per layer (the known STRING vs TIMESTAMP[ns,tz]
    normalization problem — see resort_normalize.py),
  * empty vs real markers, `.tmp` write-crash leftovers,
  * a coverage proxy from `progress_latest.json` (option_done / option_expected).

It writes NOTHING to the archive (the archive is the USER's data — READ ONLY).
By default it prints a human summary; `--json <path>` also dumps a machine
summary the manifest/docs steps can reuse.

Usage (from repo root, PowerShell or bash):
    python scripts/etl/inspect_archive.py
    python scripts/etl/inspect_archive.py --archive market-data/market_archive_1m
    python scripts/etl/inspect_archive.py --json /tmp/archive-inspect.json --sample 400

NOTE: the archive lives in the MAIN checkout (gitignored); pass --archive with
an absolute path when running from a worktree.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import Counter, defaultdict

import pyarrow.parquet as pq

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
# 09:15–15:30 inclusive at 1m = 376 stamps; the spec's coverage denominator is
# 375 (09:15–15:29 step boundaries). We carry 375 to match docs/07-data-layer §7.
EXPECTED_BARS_PER_DAY = 375


def default_archive() -> str:
    """Best-effort default: the main-checkout archive path."""
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(os.path.dirname(here))
    cand = os.path.join(repo, "market-data", "market_archive_1m")
    return cand


def count_dir(root: str, suffix: str) -> int:
    n = 0
    for _dp, _dn, fns in os.walk(root):
        for f in fns:
            if f.endswith(suffix):
                n += 1
    return n


def footer_signature(path: str):
    """Return (schema-tuple, num_rows, num_row_groups) reading ONLY the footer."""
    try:
        pf = pq.ParquetFile(path)
        sch = pf.schema_arrow
        sig = tuple((fld.name, str(fld.type)) for fld in sch)
        return sig, pf.metadata.num_rows, pf.metadata.num_row_groups
    except Exception as exc:  # corrupt / partial file
        return (("__ERROR__", str(exc)),), -1, -1


def list_real_parquet(d: str):
    try:
        return [os.path.join(d, f) for f in os.listdir(d) if f.endswith(".parquet")]
    except FileNotFoundError:
        return []


def inspect(archive: str, sample: int, seed: int = 1337) -> dict:
    rng = random.Random(seed)
    summary: dict = {"archive": archive, "expectedBarsPerDay": EXPECTED_BARS_PER_DAY}

    # ---- existing collection metadata --------------------------------------
    meta = {}
    for name in ("manifest_latest.json", "progress_latest.json"):
        p = os.path.join(archive, name)
        if os.path.exists(p):
            with open(p, "r", encoding="utf-8") as fh:
                meta[name] = json.load(fh)
    runs_p = os.path.join(archive, "manifest_runs.jsonl")
    runs = 0
    if os.path.exists(runs_p):
        with open(runs_p, "r", encoding="utf-8") as fh:
            runs = sum(1 for line in fh if line.strip())
    summary["collectionMeta"] = {
        "hasManifestLatest": "manifest_latest.json" in meta,
        "hasProgressLatest": "progress_latest.json" in meta,
        "manifestRunsCount": runs,
    }

    # progress-derived coverage proxy (cheap, no parquet read)
    prog = meta.get("progress_latest.json", {})
    prog_cov = {}
    for u in prog.get("underlyings", []):
        prog_cov[u["underlying"]] = {
            "indexDone": u.get("index_done"),
            "indexExpected": u.get("index_expected"),
            "optionDone": u.get("option_done"),
            "optionExpected": u.get("option_expected"),
            "percent": round(u.get("percent", 0.0), 2),
        }
    summary["progressCoverageProxy"] = prog_cov

    # ---- failures -----------------------------------------------------------
    fail_root = os.path.join(archive, "failures")
    summary["failures"] = {
        "totalFiles": count_dir(fail_root, ".json") if os.path.isdir(fail_root) else 0
    }

    # ---- index layer --------------------------------------------------------
    idx_root = os.path.join(archive, "index")
    index = {}
    idx_ts_dtypes: Counter = Counter()
    for sym in SYMBOLS:
        sroot = os.path.join(idx_root, sym)
        if not os.path.isdir(sroot):
            continue
        files = []
        for dp, _dn, fns in os.walk(sroot):
            for f in fns:
                if f.endswith(".parquet"):
                    files.append(os.path.join(dp, f))
        files.sort()
        first_day = last_day = None
        total_rows = 0
        for fp in files:
            sig, nrows, _ng = footer_signature(fp)
            total_rows += max(nrows, 0)
            for nm, ty in sig:
                if nm == "timestamp":
                    idx_ts_dtypes[ty] += 1
        # span: cheapest is reading the trading_day column min/max from the
        # first + last month file footer stats.
        if files:
            first_day = _col_minmax(files[0], "trading_day")[0]
            last_day = _col_minmax(files[-1], "trading_day")[1]
        index[sym] = {
            "files": len(files),
            "rows": total_rows,
            "firstDay": first_day,
            "lastDay": last_day,
        }
    summary["index"] = index
    summary["indexTimestampDtypes"] = dict(idx_ts_dtypes)

    # ---- options layer ------------------------------------------------------
    opt_root = os.path.join(archive, "options")
    options = {}
    opt_ts_dtypes: Counter = Counter()
    oi_dtypes: Counter = Counter()
    tmp_total = 0
    sampled_paths = []
    for sym in SYMBOLS:
        sroot = os.path.join(opt_root, sym)
        if not os.path.isdir(sroot):
            continue
        expiries = sorted(os.listdir(sroot))
        real = empty = tmp = 0
        for exp in expiries:
            ed = os.path.join(sroot, exp)
            try:
                names = os.listdir(ed)
            except NotADirectoryError:
                continue
            for f in names:
                if f.endswith(".parquet"):
                    real += 1
                    sampled_paths.append(os.path.join(ed, f))
                elif f.endswith(".empty.json"):
                    empty += 1
                elif f.endswith(".tmp"):
                    tmp += 1
        tmp_total += tmp
        options[sym] = {
            "expiries": len(expiries),
            "firstExpiry": expiries[0] if expiries else None,
            "lastExpiry": expiries[-1] if expiries else None,
            "realParquet": real,
            "emptyMarkers": empty,
            "tmpLeftover": tmp,
            "coveragePct": round(real / (real + empty) * 100, 2) if (real + empty) else 0.0,
        }
    summary["options"] = options

    # sample option footers for dtype variety (cheap; footer only)
    if sampled_paths:
        pick = rng.sample(sampled_paths, min(sample, len(sampled_paths)))
        for fp in pick:
            sig, _nr, _ng = footer_signature(fp)
            for nm, ty in sig:
                if nm == "timestamp":
                    opt_ts_dtypes[ty] += 1
                elif nm == "open_interest":
                    oi_dtypes[ty] += 1
    summary["optionTimestampDtypes"] = dict(opt_ts_dtypes)
    summary["optionOpenInterestDtypes"] = dict(oi_dtypes)
    summary["optionFooterSampleSize"] = len(sampled_paths) and min(sample, len(sampled_paths))
    summary["tmpLeftoverTotal"] = tmp_total

    # ---- totals -------------------------------------------------------------
    summary["totals"] = {
        "indexParquet": sum(v["files"] for v in index.values()),
        "optionRealParquet": sum(v["realParquet"] for v in options.values()),
        "optionEmptyMarkers": sum(v["emptyMarkers"] for v in options.values()),
        "optionExpiries": sum(v["expiries"] for v in options.values()),
    }

    # timestamp-dtype-mismatch verdict
    all_ts = set(idx_ts_dtypes) | set(opt_ts_dtypes)
    summary["timestampDtypeMismatch"] = {
        "distinctDtypes": sorted(all_ts),
        "mismatchConfirmed": len(all_ts) > 1,
    }
    return summary


def _col_minmax(path: str, col: str):
    """Min/max of a column across all row groups via footer stats (no data read)."""
    try:
        md = pq.ParquetFile(path).metadata
        lo = hi = None
        for rg in range(md.num_row_groups):
            grp = md.row_group(rg)
            for ci in range(grp.num_columns):
                colmd = grp.column(ci)
                if colmd.path_in_schema != col:
                    continue
                st = colmd.statistics
                if st is None or not st.has_min_max:
                    continue
                mn, mx = str(st.min), str(st.max)
                lo = mn if lo is None or mn < lo else lo
                hi = mx if hi is None or mx > hi else hi
        return (lo, hi)
    except Exception:
        return (None, None)


def print_summary(s: dict) -> None:
    print("=" * 64)
    print("ARCHIVE:", s["archive"])
    print("=" * 64)
    t = s["totals"]
    print(
        f"TOTALS  index_parquet={t['indexParquet']}  "
        f"option_real={t['optionRealParquet']}  "
        f"option_empty={t['optionEmptyMarkers']}  "
        f"expiries={t['optionExpiries']}  tmp_leftover={s['tmpLeftoverTotal']}"
    )
    print("\nINDEX spans:")
    for sym, v in s["index"].items():
        print(
            f"  {sym:10s} files={v['files']:4d} rows={v['rows']:>9d} "
            f"span={v['firstDay']} .. {v['lastDay']}"
        )
    print("\nOPTIONS coverage:")
    for sym, v in s["options"].items():
        print(
            f"  {sym:10s} expiries={v['expiries']:4d} real={v['realParquet']:6d} "
            f"empty={v['emptyMarkers']:6d}  coverage={v['coveragePct']:5.1f}%  "
            f"({v['firstExpiry']} .. {v['lastExpiry']})"
        )
    print("\nTIMESTAMP dtypes (index):", s["indexTimestampDtypes"])
    print("TIMESTAMP dtypes (options sample):", s["optionTimestampDtypes"])
    print("open_interest dtypes (options sample):", s["optionOpenInterestDtypes"])
    mm = s["timestampDtypeMismatch"]
    print(
        f"\nTIMESTAMP DTYPE MISMATCH confirmed={mm['mismatchConfirmed']} "
        f"distinct={mm['distinctDtypes']}"
    )
    print("\nprogress_latest coverage proxy:")
    for sym, v in s.get("progressCoverageProxy", {}).items():
        print(
            f"  {sym:10s} option {v['optionDone']}/{v['optionExpected']} "
            f"= {v['percent']}%"
        )


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Characterize the local market archive (read-only).")
    ap.add_argument("--archive", default=default_archive(), help="Path to market_archive_1m.")
    ap.add_argument("--sample", type=int, default=600, help="Option footers to sample for dtype variety.")
    ap.add_argument("--json", dest="json_out", default=None, help="Also write machine summary here.")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        print(f"ERROR: archive not found: {args.archive}", file=sys.stderr)
        return 2

    s = inspect(args.archive, args.sample)
    print_summary(s)
    if args.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(args.json_out)), exist_ok=True)
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(s, fh, indent=2)
        print("\nwrote", args.json_out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
