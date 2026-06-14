"""
validate_manifest.py — schema + invariant check for the coverage manifest
outputs (the compact JSON and, if present, the full parquet). Run after
build_manifest.py to fail fast on a malformed manifest before it ships.

Mirrors the zod schema in src/lib/backtest/manifest/coverage-loader.ts so the
browser loader and this validator agree on the contract.

Usage:
    python scripts/etl/validate_manifest.py \
        --json public/backtest/manifest/coverage-summary.json \
        --parquet market-data/_etl_staging/manifest.parquet
"""

from __future__ import annotations

import argparse
import json
import sys

EXPECTED_JSON_KEYS = {
    "manifestSchemaVersion", "dataset", "expectedBarsPerDay",
    "strikeStep", "symbols", "expiries",
}
SYMBOL_KEYS = {
    "symbol", "strikeStep", "expiries", "realContracts", "emptyContracts",
    "presentBars", "contractCoverage", "meanBarCoverage",
}
EXPIRY_KEYS = {
    "symbol", "expiry", "strikeStep", "realContracts", "emptyContracts",
    "strikesPresent", "contractCoverage", "meanBarCoverage", "tradingDays",
    "minStrike", "maxStrike",
}
PARQUET_COLS = [
    "symbol", "expiry", "strike", "option_type", "present_bars", "trading_days",
    "coverage", "med_vol", "first_bar", "last_bar", "gap_days", "present",
]


def fail(errs, msg):
    errs.append(msg)


def validate_json(path: str) -> list[str]:
    errs: list[str] = []
    with open(path, "r", encoding="utf-8") as fh:
        d = json.load(fh)
    missing = EXPECTED_JSON_KEYS - set(d.keys())
    if missing:
        fail(errs, f"top-level missing keys: {sorted(missing)}")
    if d.get("manifestSchemaVersion") != 1:
        fail(errs, f"manifestSchemaVersion != 1 (got {d.get('manifestSchemaVersion')})")
    for sym, v in d.get("symbols", {}).items():
        if set(v.keys()) != SYMBOL_KEYS:
            fail(errs, f"symbol {sym} keys {set(v.keys()) ^ SYMBOL_KEYS} differ")
        for f in ("contractCoverage", "meanBarCoverage"):
            if not (0.0 <= v.get(f, -1) <= 1.0):
                fail(errs, f"symbol {sym}.{f} out of 0..1: {v.get(f)}")
    for i, e in enumerate(d.get("expiries", [])):
        if not EXPIRY_KEYS.issubset(set(e.keys())):
            fail(errs, f"expiry[{i}] missing {EXPIRY_KEYS - set(e.keys())}")
        if not (0.0 <= e.get("contractCoverage", -1) <= 1.0):
            fail(errs, f"expiry[{i}] contractCoverage out of 0..1: {e.get('contractCoverage')}")
    if not errs:
        print(f"JSON OK: {len(d['symbols'])} symbols, {len(d['expiries'])} expiry rollups, "
              f"v{d['manifestSchemaVersion']}")
    return errs


def validate_parquet(path: str) -> list[str]:
    errs: list[str] = []
    import pyarrow.parquet as pq
    import pyarrow.compute as pc
    t = pq.read_table(path)
    cols = t.schema.names
    if cols != PARQUET_COLS:
        fail(errs, f"parquet columns differ: got {cols}")
        return errs
    # coverage in 0..1
    cov = t.column("coverage")
    if pc.max(cov).as_py() > 1.0 + 1e-6 or pc.min(cov).as_py() < -1e-6:
        fail(errs, "coverage column out of 0..1")
    # present=false rows must have 0 bars
    false_rows = t.filter(pc.equal(t.column("present"), False))
    if false_rows.num_rows and pc.max(false_rows.column("present_bars")).as_py() != 0:
        fail(errs, "present=false rows have non-zero present_bars")
    present = pc.sum(pc.cast(t.column("present"), "int64")).as_py()
    if not errs:
        print(f"PARQUET OK: {t.num_rows} rows ({present} present, {t.num_rows - present} absent)")
    return errs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Validate the coverage manifest schema + invariants.")
    ap.add_argument("--json", required=True)
    ap.add_argument("--parquet", default=None)
    args = ap.parse_args(argv)

    errs = validate_json(args.json)
    if args.parquet:
        errs += validate_parquet(args.parquet)

    if errs:
        print("\nVALIDATION FAILED:", file=sys.stderr)
        for e in errs:
            print("  -", e, file=sys.stderr)
        return 1
    print("\nALL VALIDATIONS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
