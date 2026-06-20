"""Generate src/lib/instruments/lot-sizes.generated.ts from the authoritative
Groww instrument master (lot_table.json).

ADDITIVE by design: symbols already hand-curated in lot-sizes.ts are SKIPPED, so
the curated/reconciled values keep precedence (the reference's BY_SYMBOL map is
first-match-wins and the curated arrays come first). This file only fills the
long tail — the ~200 NSE/BSE single-stock F&O underlyings and the MCX commodity
mini/micro variants that the hand list never covered.

Run after build_lot_table.py.  Regenerate any time lot sizes are revised.
"""

from __future__ import annotations

import datetime
import json
import os
import re

# Real exchange tickers only: start with a letter, then letters/digits/&/-; drop
# Groww's test/dummy scrip (…NSETEST, …BSETEST, DUMMY…).
_TICKER = re.compile(r"^[A-Z][A-Z0-9&-]*$")
_JUNK = re.compile(r"TEST|DUMMY|DEMO")


def real_symbol(s: str) -> bool:
    return bool(_TICKER.match(s)) and not _JUNK.search(s)

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.normpath(os.path.join(_HERE, "..", ".."))
_STAGE = os.path.join(_REPO, "market-data", "_etl_staging")
_OUT = os.path.join(_REPO, "src", "lib", "instruments", "lot-sizes.generated.ts")

# Symbols already hand-curated in lot-sizes.ts — skip them so curated values win.
CURATED = {
    # indices
    "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50",
    "SENSEX", "BANKEX", "SENSEX50",
    # stocks
    "RELIANCE", "HDFCBANK", "ICICIBANK", "SBIN", "INFY", "TCS", "ITC",
    "AXISBANK", "KOTAKBANK", "TATAMOTORS", "TATASTEEL", "WIPRO", "HINDUNILVR",
    "BHARTIARTL", "LT", "MARUTI", "BAJFINANCE", "HCLTECH", "SUNPHARMA", "ADANIENT",
    # commodities
    "GOLD", "GOLDM", "GOLDGUINEA", "GOLDPETAL", "SILVER", "SILVERM", "SILVERMIC",
    "CRUDEOIL", "CRUDEOILM", "NATURALGAS", "NATURALGASMINI", "COPPER", "ZINC",
    "ALUMINIUM", "LEAD", "NICKEL", "COTTON", "MENTHAOIL",
    # currencies
    "USDINR", "EURINR", "GBPINR", "JPYINR",
}


def tick(e: dict) -> str:
    t = e.get("tickSize")
    return f" tickSize: {t:g}," if isinstance(t, (int, float)) and t > 0 else ""


def fmt(entry: dict, segment: str, asof: str) -> str:
    return (
        f'  {{ symbol: "{entry["symbol"]}", segment: "{segment}", '
        f'exchange: "{entry["exchange"]}", lotSize: {entry["lotSize"]},'
        f"{tick(entry)} asOf: GENERATED_AS_OF }},"
    )


def main() -> int:
    with open(os.path.join(_STAGE, "lot_table.json"), encoding="utf-8") as fh:
        table = json.load(fh)
    asof = datetime.date.today().isoformat()

    stocks, seen_s = [], set()
    for e in sorted(table["stocks"], key=lambda x: x["symbol"]):
        s = e["symbol"]
        if s in CURATED or s in seen_s or not real_symbol(s):
            continue
        seen_s.add(s)
        stocks.append(fmt(e, "OPT", asof))

    comms, seen_c = [], set()
    for e in sorted(table["commodities"], key=lambda x: x["symbol"]):
        s = e["symbol"]
        if s in CURATED or s in seen_c or e["exchange"] != "MCX" or not real_symbol(s):
            continue
        seen_c.add(s)
        comms.append(fmt(e, "COMM", asof))

    body = "\n".join(
        [
            "/**",
            " * AUTO-GENERATED — do not edit by hand.",
            " *",
            " * Source: Groww instrument master (get_all_instruments), the authoritative",
            " * live lot/tick reference for NSE+BSE single-stock F&O and MCX commodities.",
            " * Regenerate with: python scripts/etl/dump_lot_sizes.py &&",
            " *   python scripts/etl/build_lot_table.py && python scripts/etl/gen_lot_table_ts.py",
            " *",
            " * ADDITIVE: symbols already curated in lot-sizes.ts are intentionally omitted,",
            " * so those reconciled values keep precedence (BY_SYMBOL is first-match-wins).",
            f" * Generated {asof} — {len(stocks)} stocks + {len(comms)} commodities.",
            " */",
            'import type { LotSizeEntry } from "./lot-sizes";',
            "",
            f'const GENERATED_AS_OF = "{asof}";',
            "",
            "/** Long-tail NSE/BSE stock-F&O + MCX commodity lots from the Groww master. */",
            "export const GENERATED_LOTS: LotSizeEntry[] = [",
            "  // ── NSE/BSE single-stock F&O ──",
            *stocks,
            "  // ── MCX commodities (incl. mini/micro variants) ──",
            *comms,
            "];",
            "",
        ]
    )
    with open(_OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    print(f"wrote {_OUT}: {len(stocks)} stocks + {len(comms)} commodities")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
