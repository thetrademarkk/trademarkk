"""Reduce the raw Groww instrument master (instruments_raw.parquet) to a clean,
de-duplicated lot-size table: one row per underlying × exchange, using the
FRONT-MONTH (nearest live expiry) contract's lot/tick — that's the lot currently
in force. Splits indices from single stocks, and commodities by exchange.

Run after dump_lot_sizes.py.  Writes market-data/_etl_staging/lot_table.json.
"""

from __future__ import annotations

import datetime
import json
import os

import pandas as pd

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.normpath(os.path.join(_HERE, "..", ".."))
_STAGE = os.path.join(_REPO, "market-data", "_etl_staging")

# Index underlyings (everything else in FNO is a single stock).
INDICES = {
    "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
    "SENSEX", "BANKEX", "SENSEX50", "BSXINDEX",
}


def front_month(group: pd.DataFrame) -> pd.Series:
    today = pd.Timestamp(datetime.date.today())
    live = group[group["expiry_date"] >= today]
    g = (live if len(live) else group).sort_values("expiry_date")
    return g.iloc[0]


def main() -> int:
    df = pd.read_parquet(os.path.join(_STAGE, "instruments_raw.parquet"))
    df["lot_size"] = pd.to_numeric(df["lot_size"], errors="coerce")
    df["tick_size"] = pd.to_numeric(df["tick_size"], errors="coerce")
    df["expiry_date"] = pd.to_datetime(df["expiry_date"], errors="coerce")

    out: dict[str, list] = {"indices": [], "stocks": [], "commodities": []}

    fno = df[(df["segment"] == "FNO") & df["lot_size"].notna() & df["underlying_symbol"].notna()]
    for (sym, exch), grp in fno.groupby(["underlying_symbol", "exchange"]):
        row = front_month(grp)
        entry = {
            "symbol": str(sym),
            "exchange": str(exch),
            "lotSize": int(row["lot_size"]),
            "tickSize": float(row["tick_size"]) if pd.notna(row["tick_size"]) else None,
        }
        (out["indices"] if str(sym) in INDICES else out["stocks"]).append(entry)

    comm = df[(df["segment"] == "COMMODITY") & df["lot_size"].notna() & df["underlying_symbol"].notna()]
    for (sym, exch), grp in comm.groupby(["underlying_symbol", "exchange"]):
        row = front_month(grp)
        out["commodities"].append({
            "symbol": str(sym),
            "exchange": str(exch),
            "lotSize": int(row["lot_size"]),
            "tickSize": float(row["tick_size"]) if pd.notna(row["tick_size"]) else None,
        })

    for k in out:
        out[k].sort(key=lambda e: e["symbol"])

    path = os.path.join(_STAGE, "lot_table.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)

    print(f"indices={len(out['indices'])} stocks={len(out['stocks'])} commodities={len(out['commodities'])}")
    print("\nINDICES:", ", ".join(f"{e['symbol']}={e['lotSize']}" for e in out["indices"]))
    print("\nCOMMODITIES (MCX):")
    for e in out["commodities"]:
        print(f"  {e['symbol']:<16} lot={e['lotSize']:<8} tick={e['tickSize']}")
    print(f"\nwrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
