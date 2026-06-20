"""
orchestrate.py — the autonomous, SAFE, resumable ETL loop for the
india-index-options-1m HuggingFace dataset, focused on the NIFTY-50 SINGLE-STOCK
option-chain track (the index track is selectable via --track index).

It chains the existing single-purpose ETL scripts as subprocesses, in order, so
each stage keeps its own battle-tested CLI/idempotency and this file is only the
conductor:

  STOCK track (default):
    1. fetch_stocks_spot.py      — backfill stock SPOT 1m (SKIPPED if already present;
                                    the spot is the strike-band anchor + already complete)
    2. gap_detect_stocks.py      — synthesize stock strike bands from spot + monthly
                                    expiries -> gap-plan-stocks.json
    3. gap_fill_groww.py         — fetch ONLY the gaps, PARALLEL (--workers), shared
                                    rate-limiter, into stocks_options/ (idempotent)
    4. resort_normalize.py       — per-expiry normalize/sort -> HF staging tree
    5. build_manifest.py         — coverage manifest (stocks)
    6. build_daily_aggregates.py — EOD daily rollups (stocks)
    7. upload_hf.py              — push staging tree to HF        (LIVE only; gated)
    8. verify_hf_and_prune.py    — verify remote row-counts, then PRUNE local source
                                    (PRUNE only when verify passes AND --prune given)

SAFETY MODEL (enforced here, on top of each script's own guards):
  * --dry-run is the DEFAULT and ON unless you pass --no-dry-run. In dry-run NOTHING
    destructive or live runs: planning stages run read-only, fetch runs with --dry-run,
    upload runs with --dry-run, verify runs WITHOUT --delete-confirmed.
  * A LIVE run (--no-dry-run) fetches + uploads, and verifies — but it still does NOT
    delete anything unless you ALSO pass --prune.
  * --prune ONLY reaches verify_hf_and_prune.py with --delete-confirmed. That script
    refuses to delete any expiry whose remote HF row-count != local staging row-count,
    so a failed/partial upload can never trigger a delete. Prune is the LAST stage and
    runs per-expiry, freeing disk as each (symbol, expiry) is proven safe on HF.
  * Upload needs HF_TOKEN in env + upload_hf's own --confirm; without a token the live
    upload self-refuses (no delete can follow because verify would then fail).

IDEMPOTENT + RESUMABLE: every stage is. Re-running skips contracts/files already done;
a crash/cron just continues. The fetch checkpoint IS the written parquet/marker.

Usage:
    # DRY RUN (default) — prints the full plan, touches nothing destructive/live:
    python scripts/etl/orchestrate.py \
        --archive C:/.../market-data/market_archive_1m \
        --staging C:/.../market-data/_etl_staging \
        --workers 6

    # LIVE backfill+upload, NO prune (human-triggered; long):
    python scripts/etl/orchestrate.py --archive ... --staging ... \
        --no-dry-run --workers 6

    # LIVE backfill+upload+VERIFY+PRUNE (the disk-conserving cron mode):
    HF_TOKEN=hf_xxx python scripts/etl/orchestrate.py --archive ... --staging ... \
        --no-dry-run --prune --workers 6

    # restrict to a few symbols:
    ... --symbols RELIANCE TCS INFY
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
PY = sys.executable

# default HF dataset repo (public + ungated)
DEFAULT_REPO = "thetrademarkk/india-index-options-1m"
INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]


def log(msg: str) -> None:
    ts = dt.datetime.now().strftime("%H:%M:%S")
    print(f"[orchestrate {ts}] {msg}", flush=True)


def run(stage: str, cmd: list[str], *, env: dict | None = None, check: bool = True) -> int:
    """Run one pipeline stage as a subprocess; stream its output; return its code."""
    log(f"--- STAGE {stage} ---")
    log("  $ " + " ".join(_q(c) for c in cmd))
    t0 = time.monotonic()
    proc = subprocess.run(cmd, env=env or os.environ.copy())
    dur = time.monotonic() - t0
    code = proc.returncode
    log(f"  -> {stage} exit={code} ({dur:.1f}s)")
    if check and code != 0:
        raise SystemExit(f"STAGE {stage} FAILED (exit {code}); aborting (resumable — re-run to continue).")
    return code


def _q(s: str) -> str:
    return f'"{s}"' if (" " in s) else s


def script(name: str) -> str:
    return os.path.join(HERE, name)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Autonomous, safe, resumable ETL orchestrator.")
    ap.add_argument("--archive", required=True, help="Shared 1m archive root (the source of truth).")
    ap.add_argument("--staging", required=True, help="Gitignored staging root (gap plans, HF tree, state).")
    ap.add_argument("--repo", default=DEFAULT_REPO, help="HF dataset repo id.")
    ap.add_argument("--track", choices=["stocks", "index"], default="stocks",
                    help="Which option chain to process (default: stocks = NIFTY-50 single-stock).")
    ap.add_argument("--symbols", nargs="*", default=None,
                    help="Restrict to these symbols (default: all for the track).")
    ap.add_argument("--workers", type=int, default=4, help="Parallel fetch workers (shared rate cap holds).")
    ap.add_argument("--min-interval", type=float, default=0.75,
                    help="Shared min seconds between Groww calls (global rate cap).")
    ap.add_argument("--target-band-pct", type=float, default=None,
                    help="Strike half-band around ATM (default: 0.20 stocks / 0.35 index).")
    ap.add_argument("--max-contracts", type=int, default=0, help="Cap fetched contracts this run (0 = all).")
    ap.add_argument("--max-expiries", type=int, default=0, help="Cap expiries/symbol (0 = all; for smoke runs).")
    ap.add_argument("--retry-failures", action="store_true", help="Re-attempt recorded fetch failures.")
    # SAFETY: dry-run is the DEFAULT. Pass --no-dry-run to actually fetch/upload.
    ap.add_argument("--no-dry-run", dest="dry_run", action="store_false",
                    help="Actually run the LIVE fetch + upload (still no delete unless --prune).")
    ap.set_defaults(dry_run=True)
    ap.add_argument("--prune", action="store_true",
                    help="After a verified upload, DELETE local source (verify_hf_and_prune --delete-confirmed). "
                         "Requires --no-dry-run; refuses to delete anything not proven on HF.")
    ap.add_argument("--prune-staging", action="store_true", help="Also delete the staging re-sorted file once verified.")
    ap.add_argument("--skip-spot", action="store_true", help="Skip the stock-spot fetch stage entirely.")
    ap.add_argument("--skip-upload", action="store_true", help="Skip upload + verify/prune (fetch + build only).")
    ap.add_argument("--no-live-grids", action="store_true",
                    help="(stocks) Don't call Groww for live strike grids; use fallback step table.")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        log(f"ERROR archive not found: {args.archive}")
        return 2
    if args.prune and args.dry_run:
        log("NOTE --prune is ignored in dry-run (the default). Pass --no-dry-run to enable pruning.")

    track = args.track
    band = args.target_band_pct if args.target_band_pct is not None else (0.20 if track == "stocks" else 0.35)
    options_root = "stocks_options" if track == "stocks" else "options"
    staging = args.staging
    hf_tree = os.path.join(staging, "hf")
    daily_dir = os.path.join(hf_tree, "daily")
    plan_path = os.path.join(staging, f"gap-plan-{track}.json")
    state_path = os.path.join(staging, f"gap-state-{track}.json")
    manifest_json = os.path.join(staging, f"coverage-summary-{track}.json")

    os.makedirs(staging, exist_ok=True)

    log(f"track={track}  root={options_root}  band=+/-{band*100:.0f}%  "
        f"workers={args.workers}  mode={'DRY-RUN' if args.dry_run else 'LIVE'}"
        f"{'  PRUNE' if (args.prune and not args.dry_run) else ''}")
    log(f"archive={args.archive}")
    log(f"staging={staging}  hf-tree={hf_tree}")
    log(f"plan={plan_path}")

    sym_args = (["--symbols", *args.symbols] if args.symbols else [])

    # ---- 1. STOCK SPOT (skip if present; it's the strike-band anchor) ----------
    if track == "stocks" and not args.skip_spot:
        # the spot fetcher is idempotent (skips existing month files); in dry-run it
        # just lists what it WOULD fetch. Spot is already complete, so this is a
        # cheap no-op confirmation in practice.
        cmd = [PY, script("fetch_stocks_spot.py"), "--archive", args.archive]
        if args.symbols:
            cmd += ["--symbols", *args.symbols]
        if args.dry_run:
            cmd += ["--dry-run"]
        run("1/8 stock-spot", cmd)
    else:
        log("--- STAGE 1/8 stock-spot: SKIPPED ---")

    # ---- 2. GAP DETECT (read-only; synthesizes the strike band + expiries) ------
    if track == "stocks":
        cmd = [PY, script("gap_detect_stocks.py"),
               "--archive", args.archive, "--out", plan_path,
               "--target-band-pct", str(band)]
        if args.symbols:
            cmd += ["--symbols", *args.symbols]
        if args.max_expiries:
            cmd += ["--max-expiries", str(args.max_expiries)]
        if args.no_live_grids:
            cmd += ["--no-live"]
        run("2/8 gap-detect", cmd)
    else:
        cmd = [PY, script("gap_detect.py"),
               "--archive", args.archive, "--out", plan_path,
               "--target-band-pct", str(band)]
        if args.symbols:
            cmd += ["--symbols", *args.symbols]
        if args.max_expiries:
            cmd += ["--max-expiries", str(args.max_expiries)]
        run("2/8 gap-detect", cmd)

    # ---- 3. GAP FILL (PARALLEL; idempotent; --dry-run prints the work list) -----
    cmd = [PY, script("gap_fill_groww.py"),
           "--archive", args.archive, "--plan", plan_path,
           "--root-subdir", options_root,
           "--workers", str(args.workers),
           "--min-interval", str(args.min_interval),
           "--state", state_path]
    # gap_fill defaults to every symbol in the plan; only restrict if the user asked.
    if args.symbols:
        cmd += sym_args
    if args.max_contracts:
        cmd += ["--max-contracts", str(args.max_contracts)]
    if args.retry_failures:
        cmd += ["--retry-failures"]
    if args.dry_run:
        cmd += ["--dry-run"]
    run("3/8 gap-fill", cmd)

    if args.dry_run:
        # In dry-run we stop before the build/upload stages: there is no freshly
        # fetched data to normalize, and we must touch nothing live/destructive.
        # We still PRINT what the remaining stages WOULD do, for a coherent plan.
        log("--- DRY-RUN: build/upload/verify stages described below (NOT executed) ---")
        log(f"  4/8 resort_normalize.py --full --options-root {options_root} "
            f"--archive {args.archive} --out {hf_tree} --workers {args.workers}")
        log(f"  5/8 build_manifest.py --options-root {options_root} --archive {args.archive} "
            f"--staging {hf_tree} --out-json {manifest_json} "
            f"--manifest-name manifest-{track}.parquet")
        log(f"  6/8 build_daily_aggregates.py --options-root {options_root} "
            f"--archive {args.archive} --out {daily_dir}")
        log(f"  7/8 upload_hf.py --repo {args.repo} --folder {hf_tree} --dry-run")
        log(f"  8/8 verify_hf_and_prune.py --repo {args.repo} --archive {args.archive} "
            f"--staging-hf {hf_tree} --options-root {options_root}"
            f"{'  [+--delete-confirmed if --prune]' if args.prune else ''}  (DRY: no delete)")
        log("DRY-RUN complete — plan is coherent; nothing fetched, uploaded, or deleted.")
        return 0

    # =========================== LIVE PATH ======================================
    # ---- 4. RESORT / NORMALIZE -> HF staging tree -------------------------------
    cmd = [PY, script("resort_normalize.py"), "--full",
           "--options-root", options_root,
           "--archive", args.archive, "--out", hf_tree,
           "--workers", str(args.workers)]
    if track == "index":
        cmd += ["--with-index"]
    if args.symbols:
        cmd += ["--symbols", *args.symbols]
    run("4/8 resort-normalize", cmd)

    # ---- 5. MANIFEST ------------------------------------------------------------
    cmd = [PY, script("build_manifest.py"),
           "--options-root", options_root,
           "--archive", args.archive,
           "--staging", hf_tree,
           "--out-json", manifest_json,
           "--manifest-name", f"manifest-{track}.parquet",
           "--workers", str(args.workers)]
    if args.symbols:
        cmd += ["--symbols", *args.symbols]
    run("5/8 build-manifest", cmd)

    # ---- 6. DAILY AGGREGATES ----------------------------------------------------
    cmd = [PY, script("build_daily_aggregates.py"),
           "--options-root", options_root,
           "--archive", args.archive,
           "--out", daily_dir,
           "--workers", str(args.workers)]
    if args.symbols:
        cmd += ["--symbols", *args.symbols]
    run("6/8 daily-aggregates", cmd)

    if args.skip_upload:
        log("--skip-upload: stopping after build (no upload, no verify/prune).")
        return 0

    # ---- 7. UPLOAD (self-refuses without HF_TOKEN + --confirm) -------------------
    cmd = [PY, script("upload_hf.py"),
           "--repo", args.repo, "--folder", hf_tree,
           "--workers", str(max(args.workers, 8)), "--confirm"]
    # upload_hf returns 3 (refuse) if no token; treat that as a soft stop, not crash,
    # so verify/prune never runs against an unverified remote.
    code = run("7/8 upload-hf", cmd, check=False)
    if code != 0:
        log("upload did NOT complete (likely no HF_TOKEN). STOPPING before verify/prune — "
            "nothing will be deleted.")
        return code

    # ---- 8. VERIFY + (optional) PRUNE ------------------------------------------
    cmd = [PY, script("verify_hf_and_prune.py"),
           "--repo", args.repo, "--archive", args.archive,
           "--staging-hf", hf_tree,
           "--options-root", options_root]
    if args.symbols:
        cmd += ["--symbols", *args.symbols]
    # Public dataset: remote read needs no token. If the repo is private, surface
    # HF_TOKEN so the duckdb count can read it.
    if os.environ.get("HF_TOKEN"):
        cmd += ["--token-env", "HF_TOKEN"]
    if args.prune:
        cmd += ["--delete-confirmed"]
        if args.prune_staging:
            cmd += ["--prune-staging"]
    # verify returns 1 if ANY expiry failed verification; with --prune that means
    # those expiries were NOT deleted (per-expiry gate). Don't crash the whole run.
    code = run("8/8 verify-prune", cmd, check=False)
    if code != 0:
        log("verify reported some expiries NOT verified on HF; those were NOT pruned. "
            "Re-run the pipeline to re-upload + re-verify them (idempotent).")

    log("=== ORCHESTRATION COMPLETE ===")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
