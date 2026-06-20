"""
build_manifest.py — the canonical COVERAGE MANIFEST for the india-index-options
dataset (D9 / ETL prerequisite; backs docs/backtesting/07-data-layer §7).

For every (symbol, expiry, strike, option_type) that has a REAL parquet it
computes, reading ONLY the cheap columns (footer timestamp stats + the
`trading_day` and `volume` columns — never OHLC):

  * present_bars      — total 1m bars present for the contract
  * trading_days      — distinct trading days the contract printed
  * coverage          — present_bars / (trading_days * EXPECTED_BARS_PER_DAY), clamped 0..1
  * med_vol           — median 1m volume (the BT-04 fill-model liquidity input, D4)
  * first_bar/last_bar— ISO timestamps (footer min/max; dtype-agnostic via string compare)
  * gap_days          — trading days in [firstExpiryDay..expiry] that this contract
                        is entirely absent (proxy gap summary; intra-day gaps are a
                        BT-08 runtime concern per §7c)

Absent strikes (only `.empty.json` marker, no parquet) are FOLDED INTO the
manifest as the dataset's missing-strike record — they are NOT uploaded to HF
(the 119k empty markers stay local) but the manifest counts them so the coverage
layer can answer "strike entirely absent".

Outputs:
  * <staging>/manifest.parquet   — FULL per-(sym,expiry,strike,type) table
                                   (ZSTD, sorted; staged/gitignored — may be large)
  * <out-json>                   — COMPACT JSON summary: dataset + per-symbol +
                                   per-(symbol,expiry) rollups (committed if <~2MB;
                                   per-strike detail is NOT inlined to keep it small)

The compact JSON is what the app's coverage layer reads (public/backtest/manifest/).
Per-strike detail lives in manifest.parquet (HF dataset) and is range-read at
runtime by BT-08; the committed JSON gives the engine sane medVol/coverage
DEFAULTS per (symbol, expiry) without any network call.

Usage:
    python scripts/etl/build_manifest.py \
        --archive C:/.../market-data/market_archive_1m \
        --staging C:/.../market-data/_etl_staging \
        --out-json public/backtest/manifest/coverage-summary.json \
        --workers 12

    # quick smoke on one symbol's recent expiries:
    python scripts/etl/build_manifest.py --archive ... --symbols NIFTY \
        --max-expiries 5 --staging /tmp/etl --out-json /tmp/cov.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import pyarrow as pa
import pyarrow.parquet as pq

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
EXPECTED_BARS_PER_DAY = 375  # 09:15–15:30 IST at 1m (docs/07-data-layer §7)
STRIKE_STEP = {"NIFTY": 50, "BANKNIFTY": 100, "SENSEX": 100}

# NSE-NIFTY-25Jul24-21150-CE.parquet -> 21150  OR  NSE-ITC-...-257.5-CE -> 257.5
_FNAME = re.compile(r"-(\d+(?:\.\d+)?)-(CE|PE)\.parquet$")

MANIFEST_SCHEMA_VERSION = 1


def parse_contract(fname: str):
    m = _FNAME.search(fname)
    if not m:
        return None
    s = float(m.group(1))
    s = int(s) if s == int(s) else s
    return s, m.group(2)


def iso_day(ts: str) -> str:
    """First 10 chars of an ISO timestamp = the YYYY-MM-DD day (dtype-agnostic)."""
    return ts[:10] if ts else ts


def _read_contract(path: str):
    """Read the cheap columns for ONE contract; return a per-contract record."""
    pf = pq.ParquetFile(path)
    md = pf.metadata
    present = md.num_rows
    # first/last bar from footer timestamp stats (no data read for the bounds)
    first_bar = last_bar = None
    for rg in range(md.num_row_groups):
        grp = md.row_group(rg)
        for ci in range(grp.num_columns):
            colmd = grp.column(ci)
            if colmd.path_in_schema != "timestamp":
                continue
            st = colmd.statistics
            if st is None or not st.has_min_max:
                continue
            mn, mx = str(st.min), str(st.max)
            first_bar = mn if first_bar is None or mn < first_bar else first_bar
            last_bar = mx if last_bar is None or mx > last_bar else last_bar
    # trading_day + volume for distinct-days + medVol
    tbl = pf.read(columns=["trading_day", "volume"])
    days = tbl.column("trading_day").to_pylist()
    vols = tbl.column("volume").to_pylist()
    distinct_days = sorted({iso_day(str(d)) for d in days if d is not None})
    clean_vols = [float(v) for v in vols if v is not None]
    med_vol = statistics.median(clean_vols) if clean_vols else 0.0
    return {
        "present_bars": int(present),
        "trading_days": len(distinct_days),
        "days_set": distinct_days,
        "med_vol": round(med_vol, 2),
        "first_bar": first_bar,
        "last_bar": last_bar,
    }


def trading_days_between(start: str, end: str):
    """Calendar days [start..end] (a coarse denominator for gap_days; weekend-pruned).
    NOT the holiday-aware calendar — that lives in src/lib/backtest/calendar; the
    manifest only needs a *proxy* gap count, so we exclude Sat/Sun and trust the
    real calendar for runtime correctness."""
    try:
        s = date.fromisoformat(start)
        e = date.fromisoformat(end)
    except (ValueError, TypeError):
        return []
    out = []
    d = s
    while d <= e:
        if d.weekday() < 5:  # Mon..Fri
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def build(archive: str, symbols, max_expiries, workers: int, options_root: str = "options"):
    rows = []  # full per-contract records
    per_symbol = {}
    per_expiry = {}  # (sym, expiry) -> rollup

    for sym in symbols:
        sroot = os.path.join(archive, options_root, sym)
        if not os.path.isdir(sroot):
            continue
        expiries = sorted(os.listdir(sroot))
        if max_expiries:
            # sample: a few earliest + latest so coverage spread is represented
            if len(expiries) > max_expiries:
                half = max_expiries // 2
                expiries = expiries[:half] + expiries[-(max_expiries - half):]
        sym_real = sym_empty = sym_bars = 0
        sym_cov_acc = []  # per-contract coverage for the symbol mean
        # stocks aren't in the index STRIKE_STEP map; 0 = "data-driven / n/a"
        step = STRIKE_STEP.get(sym, 0)

        for exp in expiries:
            ed = os.path.join(sroot, exp)
            try:
                names = os.listdir(ed)
            except NotADirectoryError:
                continue
            real_paths = []
            empty_contracts = []  # (strike, type) of absent strikes
            for f in names:
                if f.endswith(".parquet"):
                    real_paths.append((os.path.join(ed, f), f))
                elif f.endswith(".parquet.empty.json"):
                    # marker is e.g. NSE-NIFTY-27May21-10000-CE.parquet.empty.json
                    c = parse_contract(f[: -len(".empty.json")])
                    if c:
                        empty_contracts.append(c)

            # parallel-read the real contracts for this expiry
            recs = {}
            if real_paths:
                with ThreadPoolExecutor(max_workers=workers) as ex:
                    results = list(ex.map(lambda p: _read_contract(p[0]), real_paths))
                for (path, fname), r in zip(real_paths, results):
                    c = parse_contract(fname)
                    if c:
                        recs[c] = r

            # expiry-level day span (from contracts that printed) for gap proxy
            exp_days = set()
            for r in recs.values():
                exp_days.update(r["days_set"])
            exp_first = min(exp_days) if exp_days else None
            exp_window = trading_days_between(exp_first, exp) if exp_first else []
            exp_window_n = len(exp_window) or 1

            exp_real = exp_empty = exp_bars = 0
            exp_cov_acc = []
            strikes_present = set()
            for (strike, ot), r in recs.items():
                denom = max(r["trading_days"], 1) * EXPECTED_BARS_PER_DAY
                coverage = min(r["present_bars"] / denom, 1.0) if denom else 0.0
                gap_days = max(exp_window_n - r["trading_days"], 0)
                rows.append(
                    {
                        "symbol": sym,
                        "expiry": exp,
                        "strike": strike,
                        "option_type": ot,
                        "present_bars": r["present_bars"],
                        "trading_days": r["trading_days"],
                        "coverage": round(coverage, 4),
                        "med_vol": r["med_vol"],
                        "first_bar": r["first_bar"],
                        "last_bar": r["last_bar"],
                        "gap_days": gap_days,
                        "present": True,
                    }
                )
                strikes_present.add(strike)
                exp_real += 1
                exp_bars += r["present_bars"]
                exp_cov_acc.append(coverage)
                sym_cov_acc.append(coverage)

            for (strike, ot) in empty_contracts:
                rows.append(
                    {
                        "symbol": sym,
                        "expiry": exp,
                        "strike": strike,
                        "option_type": ot,
                        "present_bars": 0,
                        "trading_days": 0,
                        "coverage": 0.0,
                        "med_vol": 0.0,
                        "first_bar": None,
                        "last_bar": None,
                        "gap_days": exp_window_n,
                        "present": False,
                    }
                )
                exp_empty += 1

            sym_real += exp_real
            sym_empty += exp_empty
            sym_bars += exp_bars

            total_contracts = exp_real + exp_empty
            per_expiry[(sym, exp)] = {
                "symbol": sym,
                "expiry": exp,
                "strikeStep": step,
                "tradingDays": sorted(exp_days),
                "expectedBarsPerDay": EXPECTED_BARS_PER_DAY,
                "realContracts": exp_real,
                "emptyContracts": exp_empty,
                "strikesPresent": len(strikes_present),
                "presentBars": exp_bars,
                # contract-presence coverage: real / total markers
                "contractCoverage": round(exp_real / total_contracts, 4) if total_contracts else 0.0,
                # mean per-contract bar coverage of the contracts that DID print
                "meanBarCoverage": round(sum(exp_cov_acc) / len(exp_cov_acc), 4) if exp_cov_acc else 0.0,
                "minStrike": min(strikes_present) if strikes_present else None,
                "maxStrike": max(strikes_present) if strikes_present else None,
            }
            sys.stderr.write(
                f"  {sym}/{exp}: real={exp_real} empty={exp_empty} "
                f"bars={exp_bars} meanCov={per_expiry[(sym,exp)]['meanBarCoverage']}\n"
            )

        total = sym_real + sym_empty
        per_symbol[sym] = {
            "symbol": sym,
            "strikeStep": step,
            "expiries": len({e for (s, e) in per_expiry if s == sym}),
            "realContracts": sym_real,
            "emptyContracts": sym_empty,
            "presentBars": sym_bars,
            "contractCoverage": round(sym_real / total, 4) if total else 0.0,
            "meanBarCoverage": round(sum(sym_cov_acc) / len(sym_cov_acc), 4) if sym_cov_acc else 0.0,
        }

    return rows, per_symbol, per_expiry


def write_full_parquet(rows, staging: str, out_name: str = "manifest.parquet") -> str:
    os.makedirs(staging, exist_ok=True)
    out = os.path.join(staging, out_name)
    frac = any(isinstance(r["strike"], float) for r in rows)
    strike_type = pa.float64() if frac else pa.int32()
    schema = pa.schema(
        [
            ("symbol", pa.string()),
            ("expiry", pa.string()),
            ("strike", strike_type),
            ("option_type", pa.string()),
            ("present_bars", pa.int32()),
            ("trading_days", pa.int32()),
            ("coverage", pa.float32()),
            ("med_vol", pa.float64()),
            ("first_bar", pa.string()),
            ("last_bar", pa.string()),
            ("gap_days", pa.int32()),
            ("present", pa.bool_()),
        ]
    )
    # sort by (symbol, expiry, strike, option_type) — the row-group-pruning order
    rows_sorted = sorted(
        rows, key=lambda r: (r["symbol"], r["expiry"], float(r["strike"]), r["option_type"])
    )
    cols = {name: [r[name] for r in rows_sorted] for name, _ in zip(schema.names, schema.types)}
    tbl = pa.table(cols, schema=schema)
    pq.write_table(
        tbl, out, compression="zstd", use_dictionary=True, write_statistics=True
    )
    return out


def write_compact_json(per_symbol, per_expiry, archive, out_json: str) -> str:
    dataset = {
        "manifestSchemaVersion": MANIFEST_SCHEMA_VERSION,
        "dataset": "thetrademarkk/india-index-options-1m",
        "expectedBarsPerDay": EXPECTED_BARS_PER_DAY,
        "strikeStep": STRIKE_STEP,
        "generatedFrom": os.path.basename(archive.rstrip("/\\")),
        "symbols": per_symbol,
        # per-(symbol,expiry) rollups: NO per-strike detail (keeps the file small;
        # per-strike lives in manifest.parquet read at runtime by BT-08).
        "expiries": [
            {
                "symbol": v["symbol"],
                "expiry": v["expiry"],
                "strikeStep": v["strikeStep"],
                "realContracts": v["realContracts"],
                "emptyContracts": v["emptyContracts"],
                "strikesPresent": v["strikesPresent"],
                "contractCoverage": v["contractCoverage"],
                "meanBarCoverage": v["meanBarCoverage"],
                "tradingDays": len(v["tradingDays"]),
                "minStrike": v["minStrike"],
                "maxStrike": v["maxStrike"],
            }
            for v in per_expiry.values()
        ],
    }
    os.makedirs(os.path.dirname(os.path.abspath(out_json)), exist_ok=True)
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(dataset, fh, separators=(",", ":"))
    return out_json


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build the coverage manifest (read-only over the archive).")
    ap.add_argument("--archive", required=True)
    ap.add_argument("--staging", default=None, help="Dir for the full manifest.parquet (gitignored).")
    ap.add_argument("--out-json", required=True, help="Compact JSON summary path (committed).")
    ap.add_argument("--symbols", nargs="*", default=list(SYMBOLS))
    ap.add_argument("--options-root", default="options",
                    help="Option subtree ('options' index, 'stocks_options' single-stock).")
    ap.add_argument("--manifest-name", default="manifest.parquet",
                    help="Filename for the full manifest parquet under --staging.")
    ap.add_argument("--max-expiries", type=int, default=0, help="Sample N expiries/symbol (0 = all).")
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        print(f"ERROR: archive not found: {args.archive}", file=sys.stderr)
        return 2

    syms = args.symbols
    if args.options_root != "options" and args.symbols == list(SYMBOLS):
        base = os.path.join(args.archive, args.options_root)
        syms = sorted(os.listdir(base)) if os.path.isdir(base) else []

    rows, per_symbol, per_expiry = build(
        args.archive, syms, args.max_expiries, args.workers, args.options_root
    )

    out_json = write_compact_json(per_symbol, per_expiry, args.archive, args.out_json)
    json_bytes = os.path.getsize(out_json)

    parquet_path = None
    if args.staging:
        parquet_path = write_full_parquet(rows, args.staging, args.manifest_name)

    print("\n=== MANIFEST SUMMARY ===")
    for sym, v in per_symbol.items():
        print(
            f"  {sym:10s} expiries={v['expiries']:4d} real={v['realContracts']:6d} "
            f"empty={v['emptyContracts']:6d} contractCov={v['contractCoverage']*100:5.1f}% "
            f"meanBarCov={v['meanBarCoverage']*100:5.1f}% bars={v['presentBars']}"
        )
    print(f"\nfull rows: {len(rows)}")
    if parquet_path:
        print(f"manifest.parquet: {parquet_path} ({os.path.getsize(parquet_path)/1024:.1f} KB)")
    print(f"compact JSON: {out_json} ({json_bytes/1024:.1f} KB)")
    if json_bytes > 2 * 1024 * 1024:
        print("WARNING: compact JSON > 2MB — commit a per-symbol-only summary instead.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
