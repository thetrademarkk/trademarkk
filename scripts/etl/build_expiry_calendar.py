"""Extract an authoritative UPCOMING-EXPIRIES calendar from the Groww instrument
master (instruments_raw.parquet). Real listed-contract expiry dates already bake
in holidays + every expiry-day rule change, so this is more reliable than
re-deriving expiry rules.

Emits market-data/_etl_staging/expiry_calendar.json:
  { asOf, byUnderlying: { "<EXCH>:<UNDERLYING>": {kind, exchange, expiries:[...]} },
    months: ["YYYY-MM", ...] }
covering the next ~6 months. Groww carries NSE/BSE/MCX only (no NCDEX).

Run after dump_lot_sizes.py.
"""

from __future__ import annotations

import datetime
import json
import os

import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.normpath(os.path.join(_HERE, "..", ".."))
_STAGE = os.path.join(_REPO, "market-data", "_etl_staging")

INDICES = {
    "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
    "SENSEX", "BANKEX", "SENSEX50",
}
HORIZON_DAYS = 190  # ~6 months of upcoming expiries


def kind_of(sym: str, segment: str) -> str:
    if segment == "COMMODITY":
        return "commodity"
    return "index" if sym in INDICES else "stock"


def main() -> int:
    df = pd.read_parquet(os.path.join(_STAGE, "instruments_raw.parquet"))
    df = df[df["segment"].isin(["FNO", "COMMODITY"])].copy()
    df["expiry_date"] = pd.to_datetime(df["expiry_date"], errors="coerce")
    df = df[df["expiry_date"].notna() & df["underlying_symbol"].notna()]
    # Normalise so whitespace/case variants of the same underlying merge into one
    # series (Groww occasionally lists e.g. "COPPER" and "COPPER ").
    df["underlying_symbol"] = df["underlying_symbol"].astype(str).str.strip().str.upper()

    today = pd.Timestamp(datetime.date.today())
    horizon = today + pd.Timedelta(days=HORIZON_DAYS)
    df = df[(df["expiry_date"] >= today) & (df["expiry_date"] <= horizon)]
    # Drop Groww test scrip.
    df = df[~df["underlying_symbol"].astype(str).str.contains("TEST|DUMMY", na=False)]

    by_underlying: dict[str, dict] = {}
    for (sym, exch, seg), grp in df.groupby(["underlying_symbol", "exchange", "segment"]):
        key = f"{exch}:{sym}"
        rec = by_underlying.setdefault(
            key, {"underlying": str(sym), "exchange": str(exch), "kind": kind_of(str(sym), str(seg)), "expiries": set()}
        )
        for d in grp["expiry_date"].dt.date.unique():
            rec["expiries"].add(d.isoformat())

    for rec in by_underlying.values():
        rec["expiries"] = sorted(rec["expiries"])

    months = sorted({e[:7] for rec in by_underlying.values() for e in rec["expiries"]})
    out = {
        "asOf": today.date().isoformat(),
        "horizonDays": HORIZON_DAYS,
        "months": months,
        "byUnderlying": dict(sorted(by_underlying.items())),
    }
    path = os.path.join(_STAGE, "expiry_calendar.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)

    kinds = {}
    for rec in by_underlying.values():
        kinds[rec["kind"]] = kinds.get(rec["kind"], 0) + 1
    print(f"underlyings={len(by_underlying)} kinds={kinds} months={months}")
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
