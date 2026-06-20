"""
gap_fill_groww.py — fill ONLY the gaps in gap-plan.json from the Groww API, in
the EXACT archive layout the existing ETL expects. Idempotent, resumable,
rate-limit aware. It NEVER re-fetches a contract that already has a real parquet,
an .empty.json marker, or (unless --retry-failures) a recorded failure.

Per missing (symbol, expiry, strike, type) it:
  1. builds the deterministic groww_symbol  NSE-<SYM>-<ddMmmyy>-<STRIKE>-<CE|PE>
     (ddMmmyy from the EXPIRY date — matches the archive's filenames),
  2. fetches 1m candles over the contract's lifetime window (expiry's
     tradingDays from the plan: [first..expiry]) via the V2 endpoint
     get_historical_candles(candle_interval=CANDLE_INTERVAL_MIN_1) — proven to
     return option 1m history back to 2022 with no 7-day window cap,
  3. writes the result in the SAME shape the archive already uses:
       * real bars        -> options/<SYM>/<EXPIRY>/NSE-...-<STRIKE>-<CE|PE>.parquet
                             (8 cols, STRING timestamp 'YYYY-MM-DDThh:mm:ss+05:30'
                             so resort_normalize.py normalizes it identically),
       * zero bars        -> ...<contract>.parquet.empty.json  (so we never re-probe),
       * fetch error      -> failures/<SYM>/<EXPIRY>/<contract>.json (retryable),
  4. throttles to --min-interval seconds between calls (default 0.75s ~= the
     original builder; well under Groww's ~10 req/s data limit) with exponential
     backoff + jitter on 429/5xx, and a hard --max-retries per contract.

RESUMABLE: the very act of writing a parquet/empty/failure marker IS the
checkpoint. Re-running re-scans the archive and skips anything already present, so
Ctrl-C / crash / nightly cron all just continue. A small --state json also records
per-contract attempt counts so permanently-failing contracts aren't retried
forever.

SAFETY: READ-ONLY against Groww (only get_access_token + get_historical_candles);
no order/position calls are ever imported or invoked. Credentials come from
.env.local (GROWW_API_KEY + GROWW_API_SECRET; the secret flow is what works —
TOTP returned 400 in probing). Secrets are never printed.

Usage:
    python scripts/etl/gap_fill_groww.py \
        --archive C:/.../market-data/market_archive_1m \
        --plan    C:/.../market-data/_etl_staging/gap-plan.json \
        --symbols NIFTY \
        --min-interval 0.75 \
        --max-contracts 0          # 0 = no cap; set small to smoke-test

    # nightly resumable run (cron): same command; it skips everything already done.
    # to also retry past errors:  --retry-failures
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pyarrow as pa
import pyarrow.parquet as pq

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
CANON_TS_SUFFIX = "+05:30"  # archive convention: naive IST wall-clock + fixed offset
MARKET_OPEN = "09:15:00"
MARKET_CLOSE = "15:30:00"

# Archive parquet schema (matches what resort_normalize.py reads: 8 string/double cols)
ARCHIVE_SCHEMA = pa.schema([
    ("timestamp", pa.string()),
    ("open", pa.float64()), ("high", pa.float64()),
    ("low", pa.float64()), ("close", pa.float64()),
    ("volume", pa.float64()), ("open_interest", pa.float64()),
    ("trading_day", pa.string()),
])

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def load_env(path: str = ".env.local") -> dict[str, str]:
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


def expiry_to_ddmmmyy(expiry: str) -> str:
    """2024-07-25 -> 25Jul24 (the archive/groww filename token)."""
    d = dt.date.fromisoformat(expiry)
    return f"{d.day:02d}{_MONTHS[d.month - 1]}{d.year % 100:02d}"


def strike_token(strike) -> str:
    """Format a strike exactly as Groww's groww_symbol does.

    Index strikes are always integers (24000). Single-stock strikes can be
    fractional (ITC 257.5, KOTAKBANK 287.5, TRENT 2333.35), and Groww renders
    them with their decimals and NO trailing zero (so 345 not 345.0, 257.5 not
    257.50). round() to int when the value is whole; otherwise drop trailing
    zeros from the decimal form.
    """
    f = float(strike)
    if f == int(f):
        return str(int(round(f)))
    s = f"{f:.2f}".rstrip("0").rstrip(".")
    return s


def groww_symbol(sym: str, expiry: str, strike, ot: str) -> str:
    return f"NSE-{sym}-{expiry_to_ddmmmyy(expiry)}-{strike_token(strike)}-{ot}"


def contract_filename(sym: str, expiry: str, strike: int, ot: str) -> str:
    return f"{groww_symbol(sym, expiry, strike, ot)}.parquet"


def parquet_path(archive: str, sym: str, expiry: str, strike: int, ot: str,
                 root: str = "options") -> str:
    return os.path.join(archive, root, sym, expiry,
                        contract_filename(sym, expiry, strike, ot))


def failures_root(archive: str, root: str) -> str:
    """Failures dir, kept separate per data root so stock + index failures don't collide."""
    return "failures" if root == "options" else f"failures_{root}"


def already_done(archive: str, sym: str, expiry: str, strike: int, ot: str,
                 retry_failures: bool, root: str = "options") -> bool:
    """Idempotency guard: real parquet OR empty marker (always skip), failure
    (skip unless --retry-failures)."""
    base = parquet_path(archive, sym, expiry, strike, ot, root)
    if os.path.exists(base):
        return True
    if os.path.exists(base + ".empty.json"):
        return True
    if not retry_failures:
        froot = os.path.join(archive, failures_root(archive, root), sym, expiry)
        fp = os.path.join(froot, groww_symbol(sym, expiry, strike, ot) + ".json")
        if os.path.exists(fp):
            return True
    return False


def _epoch_or_iso_to_archive_ts(val) -> tuple[str, str]:
    """Normalize a Groww candle time field to the archive's string form.

    Groww V2 returns either an ISO 'YYYY-MM-DDThh:mm:ss' (naive IST wall-clock)
    or an epoch-seconds int (IST wall-clock seconds). Return
    ('YYYY-MM-DDThh:mm:ss+05:30', 'YYYY-MM-DD').
    """
    if isinstance(val, (int, float)):
        # epoch seconds expressed as IST wall-clock (probe-confirmed: 1780976700 -> 09:15)
        t = dt.datetime.utcfromtimestamp(int(val))
        iso = t.strftime("%Y-%m-%dT%H:%M:%S")
    else:
        s = str(val)
        iso = s[:19].replace(" ", "T")  # 'YYYY-MM-DD HH:MM:SS' or already 'T'
    return iso + CANON_TS_SUFFIX, iso[:10]


def candles_to_table(candles: list) -> pa.Table:
    """Groww candle rows -> archive-schema table.

    Row shapes seen in probing:
      index:  [iso/epoch, o, h, l, c, vol|None, None]   (7 cols, vol may be null)
      option: [iso/epoch, o, h, l, c, vol, open_interest] (7 cols)
    Some rows are 6-wide (no OI) — handled defensively.
    """
    ts, o, h, l, c, vol, oi, day = [], [], [], [], [], [], [], []
    for row in candles:
        t_iso, t_day = _epoch_or_iso_to_archive_ts(row[0])
        ts.append(t_iso)
        day.append(t_day)
        o.append(_f(row[1])); h.append(_f(row[2])); l.append(_f(row[3])); c.append(_f(row[4]))
        vol.append(_f(row[5]) if len(row) > 5 else 0.0)
        oi.append(_f(row[6]) if len(row) > 6 else 0.0)
    return pa.table({
        "timestamp": pa.array(ts, pa.string()),
        "open": pa.array(o, pa.float64()), "high": pa.array(h, pa.float64()),
        "low": pa.array(l, pa.float64()), "close": pa.array(c, pa.float64()),
        "volume": pa.array(vol, pa.float64()), "open_interest": pa.array(oi, pa.float64()),
        "trading_day": pa.array(day, pa.string()),
    }, schema=ARCHIVE_SCHEMA)


def _f(v):
    if v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def write_real(archive, sym, expiry, strike, ot, table: pa.Table, root: str = "options") -> str:
    out = parquet_path(archive, sym, expiry, strike, ot, root)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp"
    # ZSTD + stats so it matches the archive's other files; tiny per-contract files
    pq.write_table(table, tmp, compression="zstd", write_statistics=True)
    os.replace(tmp, out)  # atomic publish -> resumable (no half-written .parquet)
    return out


def write_empty(archive, sym, expiry, strike, ot, lookback_days: int, root: str = "options") -> str:
    out = parquet_path(archive, sym, expiry, strike, ot, root) + ".empty.json"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    rec = {
        "expiry": expiry,
        "option_lookback_days": lookback_days,
        "reason": "no_candles",
        "symbol": groww_symbol(sym, expiry, strike, ot),
        "underlying": sym,
        "filled_by": "gap_fill_groww.py",
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=2)
    return out


def write_failure(archive, sym, expiry, strike, ot, err: str, root: str = "options") -> str:
    froot = os.path.join(archive, failures_root(archive, root), sym, expiry)
    os.makedirs(froot, exist_ok=True)
    out = os.path.join(froot, groww_symbol(sym, expiry, strike, ot) + ".json")
    rec = {
        "at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "error": err[:400],
        "expiry": expiry,
        "symbol": groww_symbol(sym, expiry, strike, ot),
        "underlying": sym,
        "filled_by": "gap_fill_groww.py",
    }
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=2)
    return out


def clear_failure(archive, sym, expiry, strike, ot, root: str = "options") -> None:
    fp = os.path.join(archive, failures_root(archive, root), sym, expiry,
                      groww_symbol(sym, expiry, strike, ot) + ".json")
    try:
        os.remove(fp)
    except FileNotFoundError:
        pass


class Throttle:
    """SHARED, thread-safe min-interval pacing + backoff.

    With multiple worker threads, every worker calls wait() before each API
    request. A lock serializes the spacing decision so the GLOBAL request rate
    never exceeds ~1/min_interval req/s no matter how many workers are running —
    i.e. the min-interval is a true global rate cap, respected across the pool,
    not a per-thread one. (At --min-interval 0.12 and N workers you'd approach
    Groww's ~10 req/s soft cap; the default 0.75 stays well under it.)
    """

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._next = 0.0  # earliest monotonic time the next call may start
        self._lock = threading.Lock()

    def wait(self):
        with self._lock:
            now = time.monotonic()
            start = max(now, self._next)
            # reserve this slot for the calling thread, then release the lock so
            # other threads queue behind it rather than all sleeping in parallel
            self._next = start + self.min_interval
            delay = start - now
        if delay > 0:
            time.sleep(delay)

    @staticmethod
    def backoff(attempt: int):
        base = min(2 ** attempt, 60)
        time.sleep(base + random.uniform(0, base * 0.25))


def is_transient(err: str) -> bool:
    e = err.lower()
    return any(s in e for s in ("429", "rate", "timeout", "timed out", "502",
                                "503", "504", "temporarily", "connection"))


def _date_windows(start_day: str, end_day: str, max_days: int = 28):
    """Yield (chunk_start, chunk_end) ISO days covering [start_day, end_day] in
    windows of <= max_days. Groww's 1-minute history API rejects any single
    request spanning > 30 days ("Interval 1minute can only be queried for a
    maximum of 30 days"), so every contract whose life exceeds that must be
    fetched in chunks and concatenated. 28 keeps a safety margin."""
    import datetime as _dt

    d0 = _dt.date.fromisoformat(start_day)
    d1 = _dt.date.fromisoformat(end_day)
    if d1 < d0:
        d1 = d0
    cur = d0
    while cur <= d1:
        chunk_end = min(cur + _dt.timedelta(days=max_days - 1), d1)
        yield cur.isoformat(), chunk_end.isoformat()
        cur = chunk_end + _dt.timedelta(days=1)


def fetch_contract(g, sym, expiry, strike, ot, start_day, end_day, thr: Throttle,
                   max_retries: int):
    """Return (candles, error). candles=None on hard error; [] means empty.
    Splits the contract's date range into <=28-day windows (Groww 1m cap is
    30 days/request) and concatenates the bars in chronological order."""
    from growwapi import GrowwAPI  # local import so --help works without creds
    gs = groww_symbol(sym, expiry, strike, ot)
    all_candles: list = []
    for cs, ce in _date_windows(start_day, end_day):
        start = f"{cs} {MARKET_OPEN}"
        end = f"{ce} {MARKET_CLOSE}"
        last_err = ""
        ok = False
        for attempt in range(max_retries + 1):
            thr.wait()
            try:
                r = g.get_historical_candles(
                    exchange="NSE", segment="FNO", groww_symbol=gs,
                    start_time=start, end_time=end,
                    candle_interval=GrowwAPI.CANDLE_INTERVAL_MIN_1,
                )
                candles = r.get("candles") if isinstance(r, dict) else None
                if candles:
                    all_candles.extend(candles)
                ok = True
                break
            except Exception as e:  # noqa: BLE001
                last_err = f"{type(e).__name__}: {e}"
                if is_transient(last_err) and attempt < max_retries:
                    Throttle.backoff(attempt + 1)
                    continue
                return None, last_err  # hard error on a window -> contract fails (retryable)
        if not ok:
            return None, last_err
    return all_candles, ""


def load_state(path: str) -> dict:
    if path and os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(path: str, state: dict) -> None:
    if not path:
        return
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    json.dump(state, open(tmp, "w", encoding="utf-8"))
    os.replace(tmp, path)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Fill archive gaps from Groww (idempotent, resumable).")
    ap.add_argument("--archive", required=True)
    ap.add_argument("--plan", required=True, help="gap-plan.json from gap_detect.py")
    ap.add_argument("--symbols", nargs="*", default=None,
                    help="Restrict to these symbols (default: every symbol present in the plan).")
    ap.add_argument("--env", default=".env.local")
    ap.add_argument("--min-interval", type=float, default=0.75,
                    help="Min seconds between API calls (SHARED across all workers — a global rate cap).")
    ap.add_argument("--workers", type=int, default=4,
                    help="Parallel fetch threads (default 4). The shared min-interval still caps the global req/s.")
    ap.add_argument("--max-retries", type=int, default=4, help="Transient retries per contract.")
    ap.add_argument("--max-contracts", type=int, default=0, help="Cap contracts this run (0 = all).")
    ap.add_argument("--retry-failures", action="store_true", help="Also re-attempt recorded failures.")
    ap.add_argument("--state", default=None, help="Resumable attempt-count state json (optional).")
    ap.add_argument("--giveup-after", type=int, default=3, help="Stop retrying a contract after N hard fails.")
    ap.add_argument("--root-subdir", default="options",
                    help="Archive subtree to write under (default 'options'; 'stocks_options' for stock chains).")
    ap.add_argument("--dry-run", action="store_true", help="Plan only; no API calls, no writes.")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        print(f"ERROR: archive not found: {args.archive}", file=sys.stderr)
        return 2
    plan = json.load(open(args.plan, encoding="utf-8"))
    state = load_state(args.state)

    # Build the flat work list from the plan (missing + optionally retry).
    # Default to EVERY symbol the plan carries (so a stock plan with 48 names isn't
    # silently dropped by an index-only default); --symbols still restricts.
    plan_symbols = list(plan.get("symbols", {}).keys())
    target_symbols = args.symbols if args.symbols else plan_symbols
    work = []  # (sym, expiry, strike, ot, start_day, end_day)
    for sym in target_symbols:
        sblock = plan.get("symbols", {}).get(sym)
        if not sblock:
            continue
        for exp, eb in sblock["expiries"].items():
            life = eb.get("tradingDays") or []
            if not life:
                continue
            start_day, end_day = life[0], life[-1]
            todo = list(eb.get("missingContracts", []))
            if args.retry_failures:
                todo += list(eb.get("retryContracts", []))
            for strike, ot in todo:
                # keep fractional stock strikes (ITC 257.5) intact; index strikes
                # round-trip as ints via strike_token()
                sv = float(strike)
                sv = int(sv) if sv == int(sv) else sv
                work.append((sym, exp, sv, ot, start_day, end_day))

    print(f"plan work list: {len(work)} contracts "
          f"({'+retry' if args.retry_failures else 'missing only'})")

    if args.dry_run:
        # show the first few groww_symbols that WOULD be fetched
        for w in work[:10]:
            print("  WOULD fetch", groww_symbol(w[0], w[1], w[2], w[3]),
                  f"[{w[4]}..{w[5]}] -> {args.root_subdir}/")
        print(f"DRY RUN — {len(work)} contracts, {args.workers} workers, "
              f"min-interval {args.min_interval}s — no API calls, no writes.")
        return 0

    env = load_env(args.env)
    if not env.get("GROWW_TOTP_TOKEN") and not env.get("GROWW_API_KEY"):
        print("ERROR: GROWW_TOTP_TOKEN / GROWW_API_KEY missing in env file.", file=sys.stderr)
        return 3
    # Use the shared cached-token helper: the approval/secret flow is rate-limited
    # to ~one mint then cools down; the TOTP flow mints reliably and tokens are
    # valid for the trading day, so we mint ONCE and reuse the cache across runs.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from groww_auth import get_token
    from growwapi import GrowwAPI
    g = GrowwAPI(get_token(env))
    print("Groww auth OK (cached TOTP token).")

    thr = Throttle(args.min_interval)  # SHARED across all workers (global rate cap)
    root = args.root_subdir
    lookback = plan.get("params", {}).get("lookbackDays", 60)
    workers = max(1, args.workers)
    t0 = time.monotonic()

    # Mutable, lock-guarded run counters + state. The GrowwAPI client is shared:
    # each get_historical_candles is an independent stateless HTTP call, and the
    # SHARED Throttle (not the client) is what serializes the request rate.
    lock = threading.Lock()
    ctr = {"real": 0, "empty": 0, "fail": 0, "skip": 0, "done": 0}
    stop = threading.Event()  # set when --max-contracts reached (resumable: just re-run)

    def process(item) -> None:
        sym, exp, strike, ot, start_day, end_day = item
        if stop.is_set():
            return
        # idempotency re-check at fetch time (archive is the source of truth)
        if already_done(args.archive, sym, exp, strike, ot, args.retry_failures, root):
            with lock:
                ctr["skip"] += 1
            return
        gs = groww_symbol(sym, exp, strike, ot)
        with lock:
            st = state.setdefault(gs, {"hardFails": 0})
            if st.get("hardFails", 0) >= args.giveup_after:
                ctr["skip"] += 1
                return
            # claim a contract slot against the --max-contracts budget BEFORE the
            # API call so the cap is exact under concurrency
            if args.max_contracts and ctr["done"] >= args.max_contracts:
                stop.set()
                return
            ctr["done"] += 1

        candles, err = fetch_contract(g, sym, exp, strike, ot, start_day, end_day,
                                      thr, args.max_retries)

        if candles is None:
            write_failure(args.archive, sym, exp, strike, ot, err, root)
            with lock:
                st["hardFails"] = st.get("hardFails", 0) + 1
                ctr["fail"] += 1
        elif len(candles) == 0:
            write_empty(args.archive, sym, exp, strike, ot, lookback, root)
            clear_failure(args.archive, sym, exp, strike, ot, root)
            with lock:
                ctr["empty"] += 1
        else:
            try:
                tbl = candles_to_table(candles)
                write_real(args.archive, sym, exp, strike, ot, tbl, root)
                clear_failure(args.archive, sym, exp, strike, ot, root)
                with lock:
                    st["hardFails"] = 0
                    ctr["real"] += 1
            except Exception as e:  # noqa: BLE001
                write_failure(args.archive, sym, exp, strike, ot,
                              f"write:{type(e).__name__}:{e}", root)
                with lock:
                    st["hardFails"] = st.get("hardFails", 0) + 1
                    ctr["fail"] += 1

        # periodic checkpoint + progress (guarded; cheap)
        with lock:
            n = ctr["done"]
        if n and n % 200 == 0:
            with lock:
                save_state(args.state, dict(state))
            rate = n / max(time.monotonic() - t0, 1e-6)
            eta_min = max(len(work) - n, 0) / max(rate, 1e-6) / 60
            sys.stderr.write(
                f"  [{n}/{len(work)}] real={ctr['real']} empty={ctr['empty']} "
                f"fail={ctr['fail']} skip={ctr['skip']}  {rate:.2f}/s  ETA~{eta_min:.0f}m "
                f"({workers}w)\n"
            )

    print(f"fetching with {workers} workers, shared min-interval {args.min_interval}s "
          f"-> root '{root}'")
    if workers == 1:
        for item in work:
            if stop.is_set():
                break
            process(item)
    else:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = [ex.submit(process, item) for item in work]
            for fut in as_completed(futures):
                exc = fut.exception()
                if exc is not None:
                    sys.stderr.write(f"  worker error: {type(exc).__name__}: {exc}\n")

    if stop.is_set():
        print(f"reached --max-contracts={args.max_contracts}; stopping (resumable).")

    save_state(args.state, state)
    print("\n=== GAP FILL SUMMARY ===")
    print(f"  fetched   : {ctr['done']}")
    print(f"  real      : {ctr['real']}")
    print(f"  empty     : {ctr['empty']}")
    print(f"  failed    : {ctr['fail']}")
    print(f"  skipped   : {ctr['skip']} (already present / gave up)")
    print(f"  elapsed   : {(time.monotonic()-t0)/60:.1f} min")
    if ctr["fail"]:
        print("  re-run to retry transient failures (idempotent); "
              "add --retry-failures to re-attempt recorded errors.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
