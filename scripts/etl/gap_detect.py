"""
gap_detect.py — compute EXACTLY what is missing from the local 1m archive, and
the option-chain strike band we HAVE vs the TARGET (+/-30..40% around ATM), per
index. This is the planning input for gap_fill_groww.py.

It is STRICTLY READ-ONLY over the archive (the archive is the user's data). It
reads only the cheap signals:
  * index/<SYM>/<YYYY>/<YYYY-MM>.parquet   -> per-day ATM spot (from the index
        close at/near 15:20 IST, falling back to last bar of the day),
  * options/<SYM>/<EXPIRY>/NSE-...-CE|PE.parquet  -> which (strike,type) printed,
  * options/<SYM>/<EXPIRY>/*.parquet.empty.json   -> fetched-but-empty markers
        (a strike we ALREADY know returns no candles -> do NOT re-fetch),
  * failures/<SYM>/<EXPIRY>/*.json                 -> fetch ERRORS (retryable),
  * a holiday-aware-ish trading-day list derived from the index parquet itself
        (the days the index actually printed = the real NSE trading days).

WHAT "missing" means, precisely. For every (symbol, expiry) we know the expiry's
lifetime = [first trading day the index printed on/after a lookback window ..
expiry]. For each trading day in that lifetime we derive ATM = nearestStrike(spot)
and a TARGET strike band [ATM - band*spot .. ATM + band*spot] snapped to the
strike grid. The CURRENT band is whatever strikes already have a real parquet OR
an empty marker (i.e. we already probed them). A (strike,type) tuple is MISSING
iff it is inside the TARGET band but has neither a real parquet NOR an empty
marker NOR is recorded as a permanent-empty failure. Those are the ONLY tuples
the fetcher will touch (idempotent: existing + known-empty are never re-fetched).

Because Groww's instruments master lists only LIVE/future expiries, historical
strike grids cannot be enumerated from the API — they are SYNTHESIZED here from
the index spot per day x strike step x target band, exactly as the original
builder did (it used strike_buffer_pct 0.12..0.18; we widen to 0.30..0.40).

Output: a single gap-plan JSON (default --out market-data/_etl_staging/gap-plan.json)
shaped as:
  {
    "generatedAt": iso,
    "params": {...},
    "symbols": {
      "NIFTY": {
        "strikeStep": 50,
        "targetBandPct": 0.35,
        "expiries": {
          "2024-07-25": {
            "tradingDays": ["2024-07-22", ...],
            "atmByDay": {"2024-07-22": 24000, ...},
            "haveStrikeMin": 21150, "haveStrikeMax": 26350,
            "targetStrikeMin": 15600, "targetStrikeMax": 32400,
            "missingTuples": [[day, strike, "CE"], ...],   # what to fetch
            "retryFailures": [[day, strike, "PE"], ...],   # errored before
            "counts": {"have": N, "empty": N, "missing": N, "retry": N}
          }, ...
        }
      }, ...
    },
    "totals": {"missing": N, "retry": N, "expiriesTouched": N}
  }

The plan is consumed by gap_fill_groww.py --plan <path>. It is also a great
human artifact: it tells you exactly how much the +/-30..40% expansion will cost
in fetch units before you spend a single API call.

Usage:
    python scripts/etl/gap_detect.py \
        --archive C:/.../market-data/market_archive_1m \
        --out     C:/.../market-data/_etl_staging/gap-plan.json \
        --target-band-pct 0.35 \
        --symbols NIFTY BANKNIFTY SENSEX

    # smoke on a few recent NIFTY expiries:
    python scripts/etl/gap_detect.py --archive ... --symbols NIFTY \
        --max-expiries 4 --out /tmp/gap.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys

import pyarrow.parquet as pq

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
STRIKE_STEP = {"NIFTY": 50, "BANKNIFTY": 100, "SENSEX": 100}
# index data floors (per src/features/backtest/shared/instruments.ts)
DATA_START = {"NIFTY": "2021-05-01", "BANKNIFTY": "2021-05-01", "SENSEX": "2022-01-01"}

# NSE-NIFTY-27May21-12800-CE(.parquet|.parquet.empty.json)
_FNAME = re.compile(r"-(\d+)-(CE|PE)(?:\.parquet)?(?:\.empty\.json)?$")
# how many calendar days before expiry an option typically starts trading; the
# original builder used option_lookback_days 10/45. We use a generous default so
# we don't miss the contract's early life; the index trading-day list prunes it
# to REAL trading days anyway.
DEFAULT_LOOKBACK_DAYS = 60


def parse_contract(name: str):
    m = _FNAME.search(name)
    return (int(m.group(1)), m.group(2)) if m else None


def nearest_strike(step: int, spot: float) -> int:
    return int(round(spot / step) * step)


def _read_index_spot_by_day(archive: str, sym: str) -> dict[str, float]:
    """Map trading_day -> a representative spot (close near 15:20, else last bar).

    Reads only timestamp+close+trading_day. The index files are per-month; we read
    every month once. ATM is derived from THIS so the synthesized strike band is
    anchored to the real index path — no API call needed.
    """
    sroot = os.path.join(archive, "index", sym)
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
            # prefer a bar at/after 15:20 (settlement-ish); else keep the latest seen
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


def _trading_days_for_index(spot_by_day: dict[str, float]) -> list[str]:
    """The real NSE trading days = the days the index actually printed."""
    return sorted(spot_by_day.keys())


def _scan_expiry_dir(ed: str):
    """Return (have:set[(strike,type)], empty:set[(strike,type)]) for one expiry."""
    have: set[tuple[int, str]] = set()
    empty: set[tuple[int, str]] = set()
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
    """Failures recorded under failures/<SYM>/<EXPIRY>/*.json -> retryable tuples.

    Failure files key by the contract groww_symbol (e.g. NSE-NIFTY-27May21-12800-CE);
    we parse (strike,type) from that. These were ERRORS (not empty), so they are
    worth one more attempt during gap fill.
    """
    out: set[tuple[int, str]] = set()
    froot = os.path.join(archive, "failures", sym, expiry)
    if not os.path.isdir(froot):
        # some archives put failures flat per symbol with the expiry in the json
        froot2 = os.path.join(archive, "failures", sym)
        if os.path.isdir(froot2):
            for f in os.listdir(froot2):
                if f.endswith(".json"):
                    try:
                        rec = json.load(open(os.path.join(froot2, f), encoding="utf-8"))
                    except Exception:
                        continue
                    if rec.get("expiry") == expiry:
                        c = parse_contract(str(rec.get("symbol", "")))
                        if c:
                            out.add(c)
        return out
    for f in os.listdir(froot):
        if not f.endswith(".json"):
            continue
        c = parse_contract(f)
        if c:
            out.add(c)
            continue
        try:
            rec = json.load(open(os.path.join(froot, f), encoding="utf-8"))
            c = parse_contract(str(rec.get("symbol", "")))
            if c:
                out.add(c)
        except Exception:
            pass
    return out


def _expiry_lifetime(trading_days: list[str], expiry: str, lookback_days: int) -> list[str]:
    """Trading days in [(expiry - lookback) .. expiry] inclusive."""
    try:
        exp_d = dt.date.fromisoformat(expiry)
    except ValueError:
        return []
    start_d = exp_d - dt.timedelta(days=lookback_days)
    return [d for d in trading_days if start_d.isoformat() <= d <= expiry]


def build_plan(archive: str, symbols, target_band_pct: float, lookback_days: int,
               max_expiries: int) -> dict:
    plan = {
        "generatedAt": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "params": {
            "targetBandPct": target_band_pct,
            "lookbackDays": lookback_days,
            "strikeStep": STRIKE_STEP,
            "dataStart": DATA_START,
        },
        "symbols": {},
    }
    tot_missing = tot_retry = tot_expiries = 0

    for sym in symbols:
        sroot = os.path.join(archive, "options", sym)
        if not os.path.isdir(sroot):
            continue
        step = STRIKE_STEP[sym]
        spot_by_day = _read_index_spot_by_day(archive, sym)
        trading_days = _trading_days_for_index(spot_by_day)
        if not trading_days:
            sys.stderr.write(f"WARN {sym}: no index spot found; cannot derive ATM\n")
        sym_block = {"strikeStep": step, "targetBandPct": target_band_pct, "expiries": {}}

        expiries = sorted(
            e for e in os.listdir(sroot) if os.path.isdir(os.path.join(sroot, e))
        )
        if max_expiries and len(expiries) > max_expiries:
            half = max_expiries // 2
            expiries = expiries[:half] + expiries[-(max_expiries - half):]

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
            missing: list[list] = []
            retry: list[list] = []

            for day in life:
                spot = spot_by_day.get(day)
                if spot is None:
                    continue
                atm = nearest_strike(step, spot)
                atm_by_day[day] = atm
                band = target_band_pct * spot
                lo = nearest_strike(step, spot - band)
                hi = nearest_strike(step, spot + band)
                tgt_min = lo if tgt_min is None else min(tgt_min, lo)
                tgt_max = hi if tgt_max is None else max(tgt_max, hi)
                for strike in range(lo, hi + step, step):
                    for ot in ("CE", "PE"):
                        key = (strike, ot)
                        if key in have or key in empty:
                            continue  # idempotent: already fetched (data or empty)
                        if key in failures:
                            retry.append([day, strike, ot])
                        else:
                            missing.append([day, strike, ot])

            # De-dupe per (strike,type): the SAME contract is fetched once for its
            # whole lifetime, not once per day. The fetcher fetches a contract's
            # full window in one call, so collapse the day dimension here.
            missing_contracts = sorted({(s, ot) for _d, s, ot in missing})
            retry_contracts = sorted({(s, ot) for _d, s, ot in retry})

            sym_block["expiries"][exp] = {
                "tradingDays": life,
                "atmByDay": atm_by_day,
                "haveStrikeMin": have_min,
                "haveStrikeMax": have_max,
                "targetStrikeMin": tgt_min,
                "targetStrikeMax": tgt_max,
                # contract-level work lists (strike,type) — the unit the fetcher uses
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
                f"  {sym}/{exp}: have={len(have)} empty={len(empty)} "
                f"fail={len(failures)} -> miss={len(missing_contracts)} "
                f"retry={len(retry_contracts)}  band[{tgt_min}..{tgt_max}] "
                f"(had[{have_min}..{have_max}])\n"
            )

        plan["symbols"][sym] = sym_block

    plan["totals"] = {
        "missingContracts": tot_missing,
        "retryContracts": tot_retry,
        "expiriesTouched": tot_expiries,
    }
    return plan


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Detect archive gaps + target strike band (read-only).")
    ap.add_argument("--archive", required=True)
    ap.add_argument("--out", required=True, help="Gap-plan JSON path (gitignored staging).")
    ap.add_argument("--symbols", nargs="*", default=list(SYMBOLS))
    ap.add_argument("--target-band-pct", type=float, default=0.35,
                    help="Target half-width around ATM (0.35 = +/-35%).")
    ap.add_argument("--lookback-days", type=int, default=DEFAULT_LOOKBACK_DAYS,
                    help="Calendar days before expiry the contract may have traded.")
    ap.add_argument("--max-expiries", type=int, default=0, help="Sample N/symbol (0 = all).")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        print(f"ERROR: archive not found: {args.archive}", file=sys.stderr)
        return 2
    if not (0.0 < args.target_band_pct <= 1.0):
        print("ERROR: --target-band-pct must be in (0,1].", file=sys.stderr)
        return 2

    plan = build_plan(
        args.archive, args.symbols, args.target_band_pct, args.lookback_days, args.max_expiries
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(plan, fh, separators=(",", ":"))

    print("\n=== GAP PLAN ===")
    for sym, b in plan["symbols"].items():
        miss = sum(e["counts"]["missingContracts"] for e in b["expiries"].values())
        rtry = sum(e["counts"]["retryContracts"] for e in b["expiries"].values())
        print(f"  {sym:10s} expiries={len(b['expiries']):4d} "
              f"missingContracts={miss:7d} retryContracts={rtry:6d} "
              f"(band +/-{b['targetBandPct']*100:.0f}%)")
    t = plan["totals"]
    print(f"\nTOTAL fetch units: missing={t['missingContracts']} retry={t['retryContracts']} "
          f"over {t['expiriesTouched']} expiries")
    print(f"wrote {args.out} ({os.path.getsize(args.out)/1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
