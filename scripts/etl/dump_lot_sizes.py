"""Dump the Groww instrument master → authoritative lot sizes for the journal's
instrument reference table.

READ-ONLY: mints a daily access token via the TOTP flow and calls
get_all_instruments() once. Writes the raw master + a compact, de-duplicated
lot-size table (one row per underlying × exchange × segment) under the gitignored
market-data/ staging dir. The TS reference table (src/lib/instruments/lot-sizes.ts)
is then regenerated from this dump so the numbers are real, not hand-typed.

Run:  python scripts/etl/dump_lot_sizes.py
"""

from __future__ import annotations

import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.normpath(os.path.join(_HERE, "..", ".."))
_ENV = os.path.join(_REPO, ".env.local")
_OUT_DIR = os.path.join(_REPO, "market-data", "_etl_staging")


def load_env(path: str = _ENV) -> dict[str, str]:
    env: dict[str, str] = {}
    if not os.path.exists(path):
        return env
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("'").strip('"')
    return env


def mint(env: dict[str, str]) -> str:
    import pyotp
    from growwapi import GrowwAPI

    seed = env["GROWW_TOTP_SECRET"]
    key = env.get("GROWW_TOTP_TOKEN") or env["GROWW_API_KEY"]
    code = pyotp.TOTP(seed).now()
    tok = GrowwAPI.get_access_token(api_key=key, totp=code)
    return tok.get("token") if isinstance(tok, dict) else tok


def main() -> int:
    import pandas as pd
    from growwapi import GrowwAPI

    env = load_env()
    g = GrowwAPI(mint(env))
    instr = g.get_all_instruments()
    df = instr if isinstance(instr, pd.DataFrame) else pd.DataFrame(instr)

    os.makedirs(_OUT_DIR, exist_ok=True)
    print("COLUMNS:", list(df.columns))
    print("ROWS:", len(df))
    # Show a few rows from each segment so we can read the schema.
    for col in ("segment", "instrument_type", "exchange"):
        if col in df.columns:
            print(f"{col} values:", sorted(map(str, df[col].dropna().unique()))[:40])
    sample = df.head(3).to_dict("records")
    print("SAMPLE:", json.dumps(sample, default=str, indent=2)[:1500])

    raw = os.path.join(_OUT_DIR, "instruments_raw.parquet")
    df.to_parquet(raw)
    print("wrote", raw)
    return 0


if __name__ == "__main__":
    sys.exit(main())
