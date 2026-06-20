"""Generate src/features/calendar/expiry-calendar.generated.ts from the Groww
instrument master's real listed-contract expiry dates (expiry_calendar.json).

A committed snapshot of the next ~6 months of NSE/BSE/MCX expiries — authoritative
because it uses actual listed contracts (already holiday- and rule-adjusted). The
view filters out past dates at render time; regenerate periodically (the ETL cron)
to extend the horizon. NCDEX expiries are added in the lib (Groww has no NCDEX).
"""

from __future__ import annotations

import json
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.normpath(os.path.join(_HERE, "..", ".."))
_STAGE = os.path.join(_REPO, "market-data", "_etl_staging")
_OUT = os.path.join(_REPO, "src", "features", "calendar", "expiry-calendar.generated.ts")


def main() -> int:
    with open(os.path.join(_STAGE, "expiry_calendar.json"), encoding="utf-8") as fh:
        data = json.load(fh)
    rows = []
    for key, rec in sorted(data["byUnderlying"].items()):
        dates = ", ".join(f'"{d}"' for d in rec["expiries"])
        rows.append(
            f'  {{ underlying: "{rec["underlying"]}", exchange: "{rec["exchange"]}", '
            f'kind: "{rec["kind"]}", expiries: [{dates}] }},'
        )

    body = "\n".join(
        [
            "/**",
            " * AUTO-GENERATED — do not edit by hand.",
            " *",
            " * Real upcoming expiry dates from the Groww instrument master (actual listed",
            " * contracts → already holiday- and expiry-rule-adjusted). Covers NSE/BSE/MCX;",
            " * NCDEX is added separately in upcoming-expiries.ts. A snapshot — the view drops",
            " * past dates at render time; regenerate with:",
            " *   python scripts/etl/dump_lot_sizes.py &&",
            " *   python scripts/etl/build_expiry_calendar.py &&",
            " *   python scripts/etl/gen_expiry_calendar_ts.py",
            f' * Generated {data["asOf"]} — {len(rows)} underlyings, months {data["months"][0]}…{data["months"][-1]}.',
            " */",
            'import type { ExpirySeries } from "./upcoming-expiries";',
            "",
            f'export const EXPIRY_CALENDAR_AS_OF = "{data["asOf"]}";',
            "",
            "export const GENERATED_EXPIRY_SERIES: readonly ExpirySeries[] = [",
            *rows,
            "];",
            "",
        ]
    )
    os.makedirs(os.path.dirname(_OUT), exist_ok=True)
    with open(_OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(body)
    print(f"wrote {_OUT}: {len(rows)} underlyings")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
