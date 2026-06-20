"""
verify_hf_and_prune.py — VERIFY each re-sorted expiry/index file is live on HF
with the EXPECTED row count, then (only when --delete-confirmed) DELETE the
matching local source files to reclaim disk. Built for the ~35 GB-free box: it
verifies-then-prunes one (symbol, expiry) at a time so disk frees as it goes,
and it NEVER deletes anything it hasn't proven is safely on HF.

Two-sided verification per HF file <repo>/options/<SYM>/<EXPIRY>.parquet:
  A. EXISTENCE + remote size via HfApi.get_paths_info() (one cheap metadata call,
     the HF-recommended path — no download).
  B. ROW COUNT via DuckDB over the file. Remote row count is read from the parquet
     FOOTER only (httpfs range-reads the footer, not the data) using
     'SELECT count(*) FROM read_parquet(hf://datasets/<repo>/...)'. That remote
     count must EQUAL the row count of the local re-sorted staging file
     (<staging-hf>/options/<SYM>/<EXPIRY>.parquet), which itself is the sum of the
     archive's per-strike rows. Equality is the green light.

What gets DELETED (only after both checks pass for that expiry):
  * the archive's per-strike source dir  options/<SYM>/<EXPIRY>/   (the 4 GB win),
  * its empty markers + failures for that expiry,
  * optionally the staging re-sorted file too (--prune-staging), since HF now holds it.
The local INDEX month-parquets are pruned per symbol only after index/<SYM>.parquet
verifies on HF.

REFUSES to delete unless ALL of:
  * --delete-confirmed is passed,
  * the HF file exists AND its remote row count == the local staging row count,
  * (safety) the staging re-sorted file exists for that expiry (proof it was the
    thing uploaded).

Dry-run (default) prints a per-expiry verdict table and the bytes that WOULD be
reclaimed — run it first, always.

Remote reads need NO token (the dataset is public+ungated). A token is only needed
if the repo is private; pass --token-env HF_TOKEN then.

Usage:
    # 1) DRY verify everything (no deletes):
    python scripts/etl/verify_hf_and_prune.py \
        --repo thetrademarkk/india-index-options-1m \
        --archive C:/.../market-data/market_archive_1m \
        --staging-hf C:/.../market-data/_etl_staging/hf \
        --symbols NIFTY BANKNIFTY SENSEX

    # 2) verify + DELETE local sources as each expiry is confirmed:
    python scripts/etl/verify_hf_and_prune.py --repo ... --archive ... \
        --staging-hf ... --delete-confirmed --prune-staging
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys

import duckdb
import pyarrow.parquet as pq


SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")


def dir_bytes(path: str) -> int:
    total = 0
    for dp, _dn, fns in os.walk(path):
        for f in fns:
            try:
                total += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return total


def local_rowcount(path: str) -> int | None:
    """Row count from the local parquet FOOTER (no data read)."""
    try:
        return pq.ParquetFile(path).metadata.num_rows
    except Exception:
        return None


def hf_paths_info(api, repo: str, rel_path: str):
    """Return (exists, size_bytes) via HfApi.get_paths_info (cheap metadata)."""
    try:
        infos = api.get_paths_info(repo_id=repo, repo_type="dataset", paths=[rel_path])
        for it in infos:
            # RepoFile has .path and .size
            if getattr(it, "path", None) == rel_path:
                return True, int(getattr(it, "size", 0) or 0)
        return False, 0
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"    get_paths_info err for {rel_path}: {repr(e)[:160]}\n")
        return False, 0


def hf_rowcount(con, repo: str, rel_path: str, token: str | None) -> int | None:
    """Remote row count via DuckDB httpfs reading ONLY the parquet footer.

    Public dataset -> hf:// needs no secret. The COUNT(*) over read_parquet is
    answered from row-group metadata, so this range-reads kilobytes, not the file.
    """
    uri = f"hf://datasets/{repo}/{rel_path}"
    try:
        if token:
            con.execute(
                "CREATE OR REPLACE SECRET hf_tok (TYPE huggingface, TOKEN ?);", [token]
            )
        row = con.execute(f"SELECT count(*) FROM read_parquet('{uri}')").fetchone()
        return int(row[0]) if row else None
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"    duckdb count err for {rel_path}: {repr(e)[:200]}\n")
        return None


def verify_one(api, con, repo, rel_path, local_staging_path, token):
    """Return dict verdict for a single HF file vs its local staging twin."""
    exists, remote_size = hf_paths_info(api, repo, rel_path)
    local_rows = local_rowcount(local_staging_path) if local_staging_path else None
    remote_rows = hf_rowcount(con, repo, rel_path, token) if exists else None
    ok = bool(
        exists
        and local_rows is not None
        and remote_rows is not None
        and local_rows == remote_rows
    )
    return {
        "rel": rel_path,
        "exists": exists,
        "remoteSize": remote_size,
        "localRows": local_rows,
        "remoteRows": remote_rows,
        "ok": ok,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Verify HF upload then prune local (safe).")
    ap.add_argument("--repo", required=True)
    ap.add_argument("--archive", required=True, help="The 4GB source archive to prune.")
    ap.add_argument("--staging-hf", required=True, help="The re-sorted HF-layout tree (the row-count source of truth).")
    ap.add_argument("--symbols", nargs="*", default=list(SYMBOLS))
    ap.add_argument("--options-root", default="options",
                    help="Option subtree to verify+prune ('options' index, 'stocks_options' single-stock).")
    ap.add_argument("--delete-confirmed", action="store_true", help="Actually delete local sources that pass verification.")
    ap.add_argument("--prune-staging", action="store_true", help="Also delete the staging re-sorted file once verified.")
    ap.add_argument("--prune-index", action="store_true", help="Also verify+prune the per-symbol index layer.")
    ap.add_argument("--token-env", default=None, help="Env var holding an HF token (only for PRIVATE repos).")
    ap.add_argument("--max-expiries", type=int, default=0, help="Limit per symbol (0 = all).")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.archive):
        print(f"ERROR: archive not found: {args.archive}", file=sys.stderr)
        return 2
    if not os.path.isdir(args.staging_hf):
        print(f"ERROR: staging-hf not found: {args.staging_hf}", file=sys.stderr)
        return 2

    token = os.environ.get(args.token_env) if args.token_env else None
    from huggingface_hub import HfApi
    api = HfApi(token=token)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs;")

    print(f"repo: datasets/{args.repo}   delete={'YES' if args.delete_confirmed else 'no (dry-run)'}")
    reclaim_total = 0
    n_ok = n_bad = n_deleted = 0

    oroot = args.options_root
    # failures live under failures/ for the index root, failures_<root>/ otherwise
    froot_name = "failures" if oroot == "options" else f"failures_{oroot}"

    for sym in args.symbols:
        sroot = os.path.join(args.archive, oroot, sym)
        if not os.path.isdir(sroot):
            continue
        expiries = sorted(e for e in os.listdir(sroot) if os.path.isdir(os.path.join(sroot, e)))
        if args.max_expiries and len(expiries) > args.max_expiries:
            expiries = expiries[: args.max_expiries]
        print(f"\n[{sym}] {len(expiries)} expiries ({oroot})")

        for exp in expiries:
            rel = f"{oroot}/{sym}/{exp}.parquet"
            staging_file = os.path.join(args.staging_hf, oroot, sym, f"{exp}.parquet")
            if not os.path.exists(staging_file):
                print(f"  {exp}: SKIP (no staging file — not re-sorted/uploaded yet)")
                continue
            v = verify_one(api, con, args.repo, rel, staging_file, token)
            src_dir = os.path.join(sroot, exp)
            src_bytes = dir_bytes(src_dir)
            tag = "OK " if v["ok"] else "BAD"
            print(f"  {exp}: {tag} exists={v['exists']} "
                  f"rows local={v['localRows']} remote={v['remoteRows']} "
                  f"src={src_bytes/1024/1024:.1f}MB")
            if v["ok"]:
                n_ok += 1
                reclaim_total += src_bytes
                if args.delete_confirmed:
                    shutil.rmtree(src_dir, ignore_errors=True)
                    # prune this expiry's failures too (HF now authoritative)
                    fdir = os.path.join(args.archive, froot_name, sym, exp)
                    shutil.rmtree(fdir, ignore_errors=True)
                    if args.prune_staging:
                        try:
                            os.remove(staging_file)
                        except OSError:
                            pass
                    n_deleted += 1
            else:
                n_bad += 1

        # index layer (per symbol) — verify index/<SYM>.parquet then prune months
        if args.prune_index:
            rel = f"index/{sym}.parquet"
            staging_file = os.path.join(args.staging_hf, "index", f"{sym}.parquet")
            if os.path.exists(staging_file):
                v = verify_one(api, con, args.repo, rel, staging_file, token)
                idx_dir = os.path.join(args.archive, "index", sym)
                idx_bytes = dir_bytes(idx_dir)
                tag = "OK " if v["ok"] else "BAD"
                print(f"  index/{sym}: {tag} rows local={v['localRows']} "
                      f"remote={v['remoteRows']} src={idx_bytes/1024/1024:.1f}MB")
                if v["ok"]:
                    reclaim_total += idx_bytes
                    if args.delete_confirmed:
                        shutil.rmtree(idx_dir, ignore_errors=True)
                        if args.prune_staging:
                            try:
                                os.remove(staging_file)
                            except OSError:
                                pass

    print("\n=== VERIFY/PRUNE SUMMARY ===")
    print(f"  verified OK : {n_ok}")
    print(f"  verify FAIL : {n_bad}")
    print(f"  deleted     : {n_deleted} expiry dirs")
    print(f"  reclaimable : {reclaim_total/1024/1024/1024:.2f} GB"
          + ("" if args.delete_confirmed else "  (DRY RUN — nothing deleted)"))
    if n_bad:
        print("  WARNING: some files failed verification — re-upload those before pruning.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
