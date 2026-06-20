"""
gap_detect_stocks.py — the STOCK-OPTION sibling of gap_detect.py. It computes
EXACTLY which NIFTY-50 single-stock option contracts are missing from the local
archive and the target strike band, producing a gap-plan JSON in the IDENTICAL
shape gap_fill_groww.py consumes (so the same fetcher fills it).

KEY DIFFERENCE vs the index gap_detect:
  * the index plan synthesizes strike bands from the INDEX spot; here we synthesize
    them from the STOCK SPOT already in the archive (stocks_spot/<SYM>/<YYYY>/...),
  * single-stock options are MONTHLY (last Tuesday of the month since 2024; last
    Thursday before that — NSE moved the equity F&O expiry to the last Tuesday in
    2024). The historical expiry calendar is DERIVED and then snapped to the real
    spot trading days the stock actually printed (so we never target a holiday),
  * the strike STEP and the canonical underlying symbol are DATA-DRIVEN from the
    live Groww instruments master where reachable (steps differ wildly per name —
    ITC 0.5, KOTAKBANK 2.5, TRENT 6.65, MARUTI 100 — and some strikes are
    fractional, e.g. ITC 257.5); a small fallback step table covers names whose
    live listing can't be read.

It is STRICTLY READ-ONLY over the archive and makes ONE cheap read-only Groww call
(get_all_instruments) to learn the live strike grids — never an order/position
call. With --no-live it skips that call and uses the fallback step table only.

Output layout convention: the plan writes under the "stocks_options" root (a
sibling of the index "options" root), so gap_fill_groww.py --root-subdir
stocks_options fills:
    <archive>/stocks_options/<SYM>/<EXPIRY>/NSE-<SYM>-<ddMmmyy>-<STRIKE>-<CE|PE>.parquet
mirroring the index option layout exactly (same per-contract parquet files, same
.empty.json / failures markers — just a different top-level dir).

Plan shape (same keys gap_fill reads): symbols.<SYM>.expiries.<EXPIRY> with
tradingDays, atmByDay, missingContracts [[strike, "CE"], ...], retryContracts,
counts. strikes may be fractional floats here (gap_fill's strike_token formats
them to match Groww).

Usage:
    python scripts/etl/gap_detect_stocks.py \
        --archive C:/.../market-data/market_archive_1m \
        --out     C:/.../market-data/_etl_staging/gap-plan-stocks.json \
        --target-band-pct 0.20 \
        --symbols RELIANCE TCS INFY      # default = all resolvable NIFTY-50

    # offline (no Groww call; fallback step table only):
    python scripts/etl/gap_detect_stocks.py --archive ... --out ... --no-live
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import os
import re
import sys

import pyarrow.parquet as pq

# Current NIFTY-50 membership — same list the spot fetcher used.
NIFTY50 = [
    "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT", "AXISBANK", "BAJAJ-AUTO",
    "BAJFINANCE", "BAJAJFINSV", "BEL", "BPCL", "BHARTIARTL", "BRITANNIA", "CIPLA",
    "COALINDIA", "DRREDDY", "EICHERMOT", "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE",
    "HEROMOTOCO", "HINDALCO", "HINDUNILVR", "ICICIBANK", "INDUSINDBK", "INFY", "ITC",
    "JSWSTEEL", "KOTAKBANK", "LT", "LTIM", "M&M", "MARUTI", "NESTLEIND", "NTPC",
    "ONGC", "POWERGRID", "RELIANCE", "SBILIFE", "SBIN", "SHRIRAMFIN", "SUNPHARMA",
    "TATACONSUM", "TATAMOTORS", "TATASTEEL", "TCS", "TECHM", "TITAN", "TRENT",
    "ULTRACEMCO", "WIPRO",
]

# Fallback per-symbol strike STEP (used only when the live master can't be read or
# lacks a name). These mirror the live grid observed 2026-06; data-driven live
# resolution (the default) overrides them. Conservative — band synthesis snaps to
# whichever step is in effect.
FALLBACK_STEP = {
    "ADANIENT": 20.0, "ADANIPORTS": 20.0, "APOLLOHOSP": 50.0, "ASIANPAINT": 20.0,
    "AXISBANK": 10.0, "BAJAJ-AUTO": 100.0, "BAJFINANCE": 10.0, "BAJAJFINSV": 20.0,
    "BEL": 5.0, "BPCL": 5.0, "BHARTIARTL": 20.0, "BRITANNIA": 50.0, "CIPLA": 10.0,
    "COALINDIA": 5.0, "DRREDDY": 10.0, "EICHERMOT": 50.0, "GRASIM": 20.0,
    "HCLTECH": 10.0, "HDFCBANK": 5.0, "HDFCLIFE": 5.0, "HEROMOTOCO": 50.0,
    "HINDALCO": 10.0, "HINDUNILVR": 20.0, "ICICIBANK": 10.0, "INDUSINDBK": 10.0,
    "INFY": 5.0, "ITC": 5.0, "JSWSTEEL": 10.0, "KOTAKBANK": 2.5, "LT": 20.0,
    "M&M": 20.0, "MARUTI": 100.0, "NESTLEIND": 10.0, "NTPC": 2.5, "ONGC": 2.5,
    "POWERGRID": 2.5, "RELIANCE": 10.0, "SBILIFE": 20.0, "SBIN": 10.0,
    "SHRIRAMFIN": 10.0, "SUNPHARMA": 20.0, "TATACONSUM": 10.0, "TATAMOTORS": 10.0,
    "TATASTEEL": 2.5, "TCS": 20.0, "TECHM": 20.0, "TITAN": 50.0, "TRENT": 20.0,
    "ULTRACEMCO": 100.0, "WIPRO": 2.5,
}

# Date NSE moved the equity F&O monthly expiry from last THURSDAY to last TUESDAY.
# (Both rules are snapped to the real spot trading days, so an off-by-a-day rule
# self-corrects to the nearest day the stock actually printed.)
TUESDAY_RULE_FROM = dt.date(2024, 4, 1)
DEFAULT_LOOKBACK_DAYS = 45  # a stock monthly option's typical active life
DATA_START_DEFAULT = "2022-01-01"  # stock-option 1m history is reliable from ~2022

# NSE-RELIANCE-30Jun26-1500-CE  or fractional NSE-ITC-28Jul26-257.5-CE
_FNAME = re.compile(r"-(\d+(?:\.\d+)?)-(CE|PE)(?:\.parquet)?(?:\.empty\.json)?$")
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def parse_contract(name: str):
    m = _FNAME.search(name)
    if not m:
        return None
    s = float(m.group(1))
    s = int(s) if s == int(s) else s
    return (s, m.group(2))


def expiry_to_ddmmmyy(expiry: str) -> str:
    d = dt.date.fromisoformat(expiry)
    return f"{d.day:02d}{_MONTHS[d.month - 1]}{d.year % 100:02d}"


def snap(step: float, spot: float) -> float:
    """Nearest strike on the step grid. Keeps fractional steps exact."""
    n = round(spot / step)
    v = n * step
    return round(v, 2)


def _last_weekday_of_month(year: int, month: int, weekday: int) -> dt.date:
    """Last <weekday> (Mon=0..Sun=6) in a calendar month."""
    last_day = calendar.monthrange(year, month)[1]
    d = dt.date(year, month, last_day)
    while d.weekday() != weekday:
        d -= dt.timedelta(days=1)
    return d


def _read_stock_spot_by_day(archive: str, sym: str) -> dict[str, float]:
    """Map trading_day -> representative stock spot (close near 15:20, else last bar).

    Reads only timestamp+close+trading_day from stocks_spot/<SYM>/<YYYY>/*.parquet.
    Mirrors gap_detect._read_index_spot_by_day so the band synthesis is identical."""
    sroot = os.path.join(archive, "stocks_spot", sym)
    spot: dict[str, float] = {}
    last_ts: dict[str, str] = {}
    if not os.path.isdir(sroot):
        return spot
    files = []
    for dp, _dn, fns in os.walk(sroot):
        for f in fns:
            if f.endswith(".parquet"):
                files.append(os.path.join(dp, f))
    for fp in sorted(files):
        try:
            t = pq.read_table(fp, columns=["timestamp", "close", "trading_day"]).to_pydict()
        except Exception:
            continue
        ts_col, close_col, day_col = t["timestamp"], t["close"], t["trading_day"]
        for i in range(len(day_col)):
            day = str(day_col[i])[:10]
            ts = str(ts_col[i])
            c = close_col[i]
            if c is None:
                continue
            hhmm = ts[11:16] if len(ts) >= 16 else ""
            prev = last_ts.get(day)
            take = False
            if "15:20" <= hhmm <= "15:30":
                if prev is None or not ("15:20" <= prev <= "15:30") or ts > prev:
                    take = True
            elif prev is None or (not ("15:20" <= prev <= "15:30") and ts > prev):
                take = True
            if take:
                spot[day] = float(c)
                last_ts[day] = hhmm or ts
    return spot


def monthly_expiries(trading_days: list[str]) -> list[str]:
    """Derive the set of monthly equity-option expiry dates, snapped to the real
    trading days the stock printed.

    For each (year, month) present in the trading-day span we compute the rule
    expiry (last Tuesday from 2024-04, else last Thursday), then snap it to the
    nearest trading day on/just-before it (handles holidays + the rule changeover).
    """
    if not trading_days:
        return []
    days = sorted(trading_days)
    day_set = set(days)
    first = dt.date.fromisoformat(days[0])
    last = dt.date.fromisoformat(days[-1])
    out: list[str] = []
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        wd = 1 if dt.date(y, m, 1) >= TUESDAY_RULE_FROM else 3  # Tue=1, Thu=3
        rule = _last_weekday_of_month(y, m, wd)
        # snap to the nearest actual trading day on/before the rule date (up to 6 back)
        snapped = None
        for back in range(0, 7):
            cand = (rule - dt.timedelta(days=back)).isoformat()
            if cand in day_set:
                snapped = cand
                break
        if snapped is None:
            # holiday week with the rule-day after the last data day; try forward
            for fwd in range(1, 5):
                cand = (rule + dt.timedelta(days=fwd)).isoformat()
                if cand in day_set:
                    snapped = cand
                    break
        if snapped and snapped not in out:
            out.append(snapped)
        # advance month
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return sorted(out)


def _scan_expiry_dir(ed: str):
    have: set = set()
    empty: set = set()
    try:
        names = os.listdir(ed)
    except (FileNotFoundError, NotADirectoryError):
        return have, empty
    for f in names:
        if f.endswith(".parquet"):
            c = parse_contract(f)
            if c:
                have.add(c)
        elif f.endswith(".parquet.empty.json"):
            c = parse_contract(f)
            if c:
                empty.add(c)
    return have, empty


def _scan_failures(archive: str, sym: str, expiry: str):
    """Retryable failure tuples under failures_stocks_options/<SYM>/<EXPIRY>/*.json."""
    out: set = set()
    froot = os.path.join(archive, "failures_stocks_options", sym, expiry)
    if not os.path.isdir(froot):
        return out
    for f in os.listdir(froot):
        if not f.endswith(".json"):
            continue
        c = parse_contract(f)
        if c:
            out.add(c)
    return out


def _expiry_lifetime(trading_days: list[str], expiry: str, lookback_days: int) -> list[str]:
    try:
        exp_d = dt.date.fromisoformat(expiry)
    except ValueError:
        return []
    start_d = exp_d - dt.timedelta(days=lookback_days)
    return [d for d in trading_days if start_d.isoformat() <= d <= expiry]


def resolve_live_grids(symbols, no_live: bool):
    """Map sym -> {"step": float, "strikes": sorted floats} from the live master.

    Returns ({sym: grid}, {requested_sym: canonical_underlying}). On --no-live or
    any error, returns empty dicts (the caller falls back to FALLBACK_STEP)."""
    if no_live:
        return {}, {}
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from groww_auth import get_client
        import pandas as pd
        g = get_client()
        df = pd.DataFrame(g.get_all_instruments())
        fno = df[(df["segment"] == "FNO") & (df["instrument_type"].isin(["CE", "PE"]))].copy()
        fno["strike_price"] = pd.to_numeric(fno["strike_price"], errors="coerce")
        grids: dict[str, dict] = {}
        canon: dict[str, str] = {}
        for sym in symbols:
            rows = fno[fno["underlying_symbol"] == sym]
            if not len(rows):
                continue
            canon[sym] = sym
            strikes = sorted({float(s) for s in rows["strike_price"].dropna().tolist()})
            if len(strikes) < 2:
                continue
            diffs = sorted({round(b - a, 2) for a, b in zip(strikes, strikes[1:]) if b > a})
            step = diffs[0] if diffs else FALLBACK_STEP.get(sym, 10.0)
            grids[sym] = {"step": float(step), "strikes": strikes}
        return grids, canon
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"WARN live-grid resolve failed ({type(e).__name__}: {str(e)[:120]}); "
                         "using FALLBACK_STEP.\n")
        return {}, {}


def build_plan(archive, symbols, target_band_pct, lookback_days, data_start,
               max_expiries, no_live) -> dict:
    grids, canon = resolve_live_grids(symbols, no_live)
    plan = {
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "params": {
            "kind": "stocks_options",
            "targetBandPct": target_band_pct,
            "lookbackDays": lookback_days,
            "dataStart": data_start,
            "tuesdayRuleFrom": TUESDAY_RULE_FROM.isoformat(),
            "liveGrids": (not no_live),
        },
        "symbols": {},
    }
    tot_missing = tot_retry = tot_expiries = 0
    unresolved = []

    for sym in symbols:
        spot_by_day = _read_stock_spot_by_day(archive, sym)
        # only keep trading days from data_start onward (stock-option history floor)
        spot_by_day = {d: v for d, v in spot_by_day.items() if d >= data_start}
        if not spot_by_day:
            unresolved.append(sym)
            continue
        trading_days = sorted(spot_by_day.keys())
        grid = grids.get(sym)
        step = grid["step"] if grid else FALLBACK_STEP.get(sym)
        if step is None:
            unresolved.append(sym)
            continue
        live_strikes = set(grid["strikes"]) if grid else set()

        expiries = monthly_expiries(trading_days)
        if max_expiries and len(expiries) > max_expiries:
            half = max_expiries // 2
            expiries = expiries[:half] + expiries[-(max_expiries - half):]

        sym_block = {"strikeStep": step, "targetBandPct": target_band_pct, "expiries": {}}
        sroot = os.path.join(archive, "stocks_options", sym)

        for exp in expiries:
            ed = os.path.join(sroot, exp)
            have, empty = _scan_expiry_dir(ed)
            failures = _scan_failures(archive, sym, exp)
            life = _expiry_lifetime(trading_days, exp, lookback_days)
            if not life:
                continue

            atm_by_day = {}
            have_min = min((s for s, _ in have), default=None)
            have_max = max((s for s, _ in have), default=None)
            tgt_min = tgt_max = None
            missing_set: set = set()
            retry_set: set = set()

            for day in life:
                spot = spot_by_day.get(day)
                if spot is None:
                    continue
                atm = snap(step, spot)
                atm_by_day[day] = atm
                band = target_band_pct * spot
                lo = snap(step, spot - band)
                hi = snap(step, spot + band)
                tgt_min = lo if tgt_min is None else min(tgt_min, lo)
                tgt_max = hi if tgt_max is None else max(tgt_max, hi)
                # iterate the step grid across the band
                k = lo
                # guard against pathological steps
                if step <= 0:
                    break
                steps = int(round((hi - lo) / step)) + 1
                for j in range(max(steps, 0)):
                    strike = round(lo + j * step, 2)
                    strike = int(strike) if strike == int(strike) else strike
                    # if we have a live grid, only target strikes that exist on it
                    # (avoids fetching off-grid strikes that never listed); for
                    # historical names not on the live grid we trust the step grid.
                    if live_strikes and float(strike) not in live_strikes:
                        continue
                    for ot in ("CE", "PE"):
                        key = (strike, ot)
                        if key in have or key in empty:
                            continue
                        if key in failures:
                            retry_set.add(key)
                        else:
                            missing_set.add(key)

            missing_contracts = sorted(missing_set, key=lambda x: (float(x[0]), x[1]))
            retry_contracts = sorted(retry_set, key=lambda x: (float(x[0]), x[1]))

            sym_block["expiries"][exp] = {
                "tradingDays": life,
                "atmByDay": atm_by_day,
                "haveStrikeMin": have_min,
                "haveStrikeMax": have_max,
                "targetStrikeMin": tgt_min,
                "targetStrikeMax": tgt_max,
                "missingContracts": [[s, ot] for s, ot in missing_contracts],
                "retryContracts": [[s, ot] for s, ot in retry_contracts],
                "counts": {
                    "have": len(have),
                    "empty": len(empty),
                    "failures": len(failures),
                    "missingContracts": len(missing_contracts),
                    "retryContracts": len(retry_contracts),
                },
            }
            tot_missing += len(missing_contracts)
            tot_retry += len(retry_contracts)
            tot_expiries += 1
            sys.stderr.write(
                f"  {sym}/{exp}: step={step} have={len(have)} empty={len(empty)} "
                f"-> miss={len(missing_contracts)} retry={len(retry_contracts)} "
                f"band[{tgt_min}..{tgt_max}]\n"
            )

        plan["symbols"][sym] = sym_block

    plan["totals"] = {
        "missingContracts": tot_missing,
        "retryContracts": tot_retry,
        "expiriesTouched": tot_expiries,
        "unresolvedSymbols": unresolved,
    }
    if unresolved:
        sys.stderr.write(f"WARN unresolved (no spot data or no step): {unresolved}\n")
    return plan


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Detect NIFTY-50 STOCK-option archive gaps + target band (read-only archive).")
    ap.add_argument("--archive", required=True)
    ap.add_argument("--out", required=True, help="Stock gap-plan JSON path (gitignored staging).")
    ap.add_argument("--symbols", nargs="*", default=list(NIFTY50))
    ap.add_argument("--target-band-pct", type=float, default=0.20,
                    help="Target half-width around ATM (0.20 = +/-20%; stocks move less than indices).")
    ap.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS)
    ap.add_argument("--data-start", default=DATA_START_DEFAULT,
                    help="Floor trading day for stock-option history.")
    ap.add_argument("--max-expiries", type=int, default=0, help="Sample N/symbol (0 = all).")
    ap.add_argument("--no-live", action="store_true",
                    help="Skip the Groww instruments call; use the fallback step table only.")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        print(f"ERROR: archive not found: {args.archive}", file=sys.stderr)
        return 2
    if not (0.0 < args.target_band_pct <= 1.0):
        print("ERROR: --target-band-pct must be in (0,1].", file=sys.stderr)
        return 2

    plan = build_plan(args.archive, args.symbols, args.target_band_pct,
                      args.lookback_days, args.data_start, args.max_expiries, args.no_live)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, separators=(",", ":"))

    print("\n=== STOCK GAP PLAN ===")
    for sym, b in plan["symbols"].items():
        miss = sum(e["counts"]["missingContracts"] for e in b["expiries"].values())
        rtry = sum(e["counts"]["retryContracts"] for e in b["expiries"].values())
        if miss or rtry:
            print(f"  {sym:12s} expiries={len(b['expiries']):3d} "
                  f"missing={miss:6d} retry={rtry:5d} step={b['strikeStep']}")
    t = plan["totals"]
    print(f"\nTOTAL stock fetch units: missing={t['missingContracts']} retry={t['retryContracts']} "
          f"over {t['expiriesTouched']} expiries")
    if t.get("unresolvedSymbols"):
        print(f"unresolved (skipped): {t['unresolvedSymbols']}")
    print(f"wrote {args.out} ({os.path.getsize(args.out)/1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
