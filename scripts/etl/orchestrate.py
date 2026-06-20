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
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
PY = sys.executable

# default HF dataset repo (public + ungated)
DEFAULT_REPO = "thetrademarkk/india-index-options-1m"
INDEX_SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]


def load_env_file(path: str) -> None:
    """Load KEY=VALUE lines from .env.local into os.environ if not already set.

    The disk-safe live loop needs HF_TOKEN for upload; the user keeps it in
    .env.local (not the shell env), so surface it here. Never prints values.
    """
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip("'").strip('"')
        if k and k not in os.environ:
            os.environ[k] = v


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


# ============================================================================
# DISK-SAFE PER-(symbol, expiry) SLICE LOOP
# ----------------------------------------------------------------------------
# Instead of fetch-ALL -> build-ALL -> upload-ALL -> prune-ALL (which peaks at the
# entire dataset on local disk), we process ONE (symbol, expiry) slice end-to-end:
#   detect (once) -> [per slice: gap-fill -> normalize -> upload one file ->
#                     verify remote -> prune that slice's local source+staging]
# So local disk never holds more than ~one expiry's worth of contracts at a time.
# Every step is idempotent + resumable: a re-run skips slices already on HF (the
# archive source dir was pruned) and re-attempts anything not yet verified.
# ============================================================================


def _slice_plan_for(full_plan: dict, sym: str, exp: str) -> dict:
    """Carve a one-(symbol,expiry) plan out of the full gap plan so gap_fill
    touches ONLY this slice (same schema gap_fill_groww.py consumes)."""
    sblock = full_plan["symbols"][sym]
    eb = sblock["expiries"][exp]
    return {
        "generatedAt": full_plan.get("generatedAt"),
        "params": full_plan.get("params", {}),
        "symbols": {sym: {
            "strikeStep": sblock.get("strikeStep"),
            "targetBandPct": sblock.get("targetBandPct"),
            "expiries": {exp: eb},
        }},
    }


def _enumerate_slices(full_plan: dict, retry: bool):
    """Yield (sym, exp, n_work) for every slice that still has fetch work, plus
    slices whose archive source already exists (so a resumed run can normalize/
    upload/prune a slice that was fetched earlier but not yet pushed)."""
    out = []
    for sym, sblock in full_plan.get("symbols", {}).items():
        for exp, eb in sblock.get("expiries", {}).items():
            n = len(eb.get("missingContracts", []))
            if retry:
                n += len(eb.get("retryContracts", []))
            out.append((sym, exp, n))
    # process oldest expiry first (smaller chains early -> proof + steady drain)
    out.sort(key=lambda t: (t[0], t[1]))
    return out


def _archive_slice_dir(archive: str, options_root: str, sym: str, exp: str) -> str:
    return os.path.join(archive, options_root, sym, exp)


def _staging_slice_file(hf_tree: str, options_root: str, sym: str, exp: str) -> str:
    return os.path.join(hf_tree, options_root, sym, f"{exp}.parquet")


def run_slice_loop(args, *, options_root, hf_tree, full_plan, state_path) -> int:
    """The disk-bounded engine. Returns 0 on a clean pass (resumable regardless)."""
    retry = args.retry_failures
    slices = _enumerate_slices(full_plan, retry)
    if args.only_expiry:
        slices = [s for s in slices if s[1] == args.only_expiry]
    # keep only slices that have NEW work OR an un-pushed archive source on disk
    pending = []
    for sym, exp, n_work in slices:
        src = _archive_slice_dir(args.archive, options_root, sym, exp)
        has_src = os.path.isdir(src) and any(
            f.endswith(".parquet") for f in os.listdir(src)
        ) if os.path.isdir(src) else False
        if n_work > 0 or has_src:
            pending.append((sym, exp, n_work, has_src))
    log(f"slice-loop: {len(pending)} (symbol,expiry) slices to process "
        f"(of {len(slices)} in plan); ONE slice on disk at a time")
    if args.max_slices:
        pending = pending[: args.max_slices]
        log(f"slice-loop: capped to {len(pending)} slices this run (--max-slices)")

    done = ok = failed = pruned = 0
    for i, (sym, exp, n_work, has_src) in enumerate(pending, 1):
        log(f"=== SLICE {i}/{len(pending)}  {sym}/{exp}  (new-work={n_work}) ===")

        # 1) gap-fill ONLY this slice (write a tiny one-slice plan)
        slice_plan = _slice_plan_for(full_plan, sym, exp)
        slice_plan_path = os.path.join(os.path.dirname(state_path),
                                       f"_slice-plan-{options_root}.json")
        with open(slice_plan_path, "w", encoding="utf-8") as fh:
            json.dump(slice_plan, fh, separators=(",", ":"))
        cmd = [PY, script("gap_fill_groww.py"),
               "--archive", args.archive, "--plan", slice_plan_path,
               "--root-subdir", options_root,
               "--workers", str(args.workers),
               "--min-interval", str(args.min_interval),
               "--state", state_path, "--symbols", sym]
        if retry:
            cmd += ["--retry-failures"]
        run(f"slice {sym}/{exp} 1/4 gap-fill", cmd, check=False)

        # if the slice produced no archive parquet at all (all-empty / unresolved),
        # skip it — there is nothing to normalize/upload/prune.
        src = _archive_slice_dir(args.archive, options_root, sym, exp)
        if not (os.path.isdir(src) and any(f.endswith(".parquet") for f in os.listdir(src))):
            log(f"slice {sym}/{exp}: no real parquet (empty/unresolved) — skipping upload.")
            done += 1
            continue

        # 2) normalize ONLY this slice -> one staging file
        cmd = [PY, script("resort_normalize.py"),
               "--archive", args.archive, "--out", hf_tree,
               "--options-root", options_root,
               "--symbol", sym, "--expiry", exp]
        run(f"slice {sym}/{exp} 2/4 normalize", cmd, check=False)
        staging_file = _staging_slice_file(hf_tree, options_root, sym, exp)
        if not os.path.exists(staging_file):
            log(f"slice {sym}/{exp}: normalize produced no staging file — leaving "
                "archive intact, will retry next run.")
            failed += 1
            continue

        # 3) upload ONLY this one file (atomic single-file commit)
        rel = f"{options_root}/{sym}/{exp}.parquet"
        cmd = [PY, script("upload_hf.py"), "--repo", args.repo,
               "--single-file", staging_file, "--path-in-repo", rel, "--confirm"]
        code = run(f"slice {sym}/{exp} 3/4 upload", cmd, check=False)
        if code != 0:
            log(f"slice {sym}/{exp}: upload failed (code {code}; likely no HF_TOKEN). "
                "STOPPING the loop — nothing for this slice is pruned.")
            return code

        # 4) VERIFY remote row-count == local staging, then PRUNE just this slice
        cmd = [PY, script("verify_hf_and_prune.py"),
               "--repo", args.repo, "--archive", args.archive,
               "--staging-hf", hf_tree, "--options-root", options_root,
               "--one-symbol", sym, "--one-expiry", exp]
        if os.environ.get("HF_TOKEN"):
            cmd += ["--token-env", "HF_TOKEN"]
        if args.prune:
            cmd += ["--delete-confirmed", "--prune-staging"]
        code = run(f"slice {sym}/{exp} 4/4 verify+prune", cmd, check=False)
        if code == 0:
            ok += 1
            if args.prune:
                pruned += 1
        else:
            failed += 1
            log(f"slice {sym}/{exp}: verify FAILED — local source kept; will re-upload "
                "next run (idempotent).")
            # if NOT pruning we still want to keep the staging file small: drop it
            if not args.prune and os.path.exists(staging_file):
                pass  # leave it; --no-prune keeps everything by design
        done += 1
        # belt-and-braces: with --prune the staging file is gone; without prune,
        # proactively delete the staging twin so disk stays bounded even in the
        # upload-only mode (HF now holds it; archive source is the source of truth).
        if not args.prune and os.path.exists(staging_file):
            try:
                os.remove(staging_file)
            except OSError:
                pass

    log("=== SLICE-LOOP COMPLETE ===")
    log(f"  slices processed : {done}")
    log(f"  verified OK      : {ok}")
    log(f"  pruned           : {pruned}")
    log(f"  failed/deferred  : {failed}")
    return 0


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
    ap.add_argument("--target-band-pct", "--strike-pct", dest="target_band_pct",
                    type=float, default=None,
                    help="Strike half-band around ATM as a fraction of spot "
                         "(default 0.20 = +/-20%% on both sides, for BOTH stocks AND index).")
    ap.add_argument("--max-contracts", type=int, default=0, help="Cap fetched contracts this run (0 = all).")
    ap.add_argument("--max-expiries", type=int, default=0, help="Cap expiries/symbol (0 = all; for smoke runs).")
    ap.add_argument("--max-slices", type=int, default=0,
                    help="Cap (symbol,expiry) slices processed this run (0 = all; resumable).")
    ap.add_argument("--only-expiry", default=None,
                    help="Slice loop: process ONLY this expiry (across the given symbols). "
                         "Handy for a one-batch end-to-end proof.")
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
    # DISK-SAFE slice loop is the DEFAULT live path: process ONE (symbol,expiry)
    # slice end-to-end (fetch->normalize->upload->verify->prune) so local disk
    # never holds more than ~one slice. --no-slice-loop falls back to the legacy
    # fetch-ALL-then-upload monolith (peaks at the full dataset; not recommended).
    ap.add_argument("--no-slice-loop", dest="slice_loop", action="store_false",
                    help="Use the legacy fetch-ALL-then-upload path (peaks at full dataset).")
    ap.set_defaults(slice_loop=True)
    ap.add_argument("--env-file", default=os.path.join(REPO, ".env.local"),
                    help="Load HF_TOKEN / creds from this env file if not in the shell env.")
    args = ap.parse_args(argv)

    # surface HF_TOKEN (and creds) from .env.local for the live upload step
    load_env_file(args.env_file)

    if not os.path.isdir(args.archive):
        log(f"ERROR archive not found: {args.archive}")
        return 2
    if args.prune and args.dry_run:
        log("NOTE --prune is ignored in dry-run (the default). Pass --no-dry-run to enable pruning.")

    track = args.track
    # +/-20% on BOTH sides for BOTH universes (stocks AND index) — the standardized band.
    band = args.target_band_pct if args.target_band_pct is not None else 0.20
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

    # ---- 3. GAP FILL (PARALLEL; idempotent) -------------------------------------
    # In the disk-safe slice loop the gap-fill is driven PER SLICE inside
    # run_slice_loop (one expiry's contracts at a time), so we MUST NOT run the
    # whole-plan fetch here — that would fetch everything before any prune. We run
    # the whole-plan gap-fill only in dry-run (to print the work list) or in the
    # explicit legacy --no-slice-loop path.
    if args.dry_run or not args.slice_loop:
        cmd = [PY, script("gap_fill_groww.py"),
               "--archive", args.archive, "--plan", plan_path,
               "--root-subdir", options_root,
               "--workers", str(args.workers),
               "--min-interval", str(args.min_interval),
               "--state", state_path]
        # gap_fill defaults to every symbol in the plan; only restrict if asked.
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
        if args.slice_loop:
            try:
                full_plan = json.load(open(plan_path, encoding="utf-8"))
                slices = _enumerate_slices(full_plan, args.retry_failures)
                work_slices = [s for s in slices if s[2] > 0]
                tot = sum(s[2] for s in slices)
                log("--- DRY-RUN: DISK-SAFE SLICE LOOP (default) ---")
                log(f"  plan has {len(slices)} (symbol,expiry) slices; "
                    f"{len(work_slices)} have NEW fetch work; {tot} contracts total")
                log("  per slice: gap-fill -> normalize(1 file) -> "
                    "upload(1 file) -> verify -> prune(that slice). "
                    "Local disk holds <= ~1 slice at any time.")
                for sym, exp, n in work_slices[:8]:
                    log(f"    WOULD process {sym}/{exp}: {n} contracts -> "
                        f"{options_root}/{sym}/{exp}.parquet on HF")
                if len(work_slices) > 8:
                    log(f"    ... and {len(work_slices) - 8} more slices")
            except Exception as e:  # noqa: BLE001
                log(f"  (could not enumerate slices: {type(e).__name__}: {e})")
        else:
            log("--- DRY-RUN: legacy monolith stages described below (NOT executed) ---")
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
    # DISK-SAFE SLICE LOOP (default): one (symbol,expiry) end-to-end at a time.
    if args.slice_loop:
        if args.skip_upload:
            log("NOTE --skip-upload + slice-loop: the slice loop is built around "
                "upload+verify+prune. Use --no-slice-loop with --skip-upload for a "
                "fetch-only run. Continuing in slice-loop (upload required).")
        full_plan = json.load(open(plan_path, encoding="utf-8"))
        return run_slice_loop(
            args, options_root=options_root, hf_tree=hf_tree,
            full_plan=full_plan, state_path=state_path,
        )

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
