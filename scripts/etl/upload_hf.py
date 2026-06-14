"""
upload_hf.py — push the HF-ready dataset tree to the Hugging Face Hub.

OWNER-GATED. This script is shipped READY but is NEVER run in the deploy-
conserving lane (no token here). It REFUSES to do anything unless ALL of:
  * a token is present in the environment (HF_TOKEN or HUGGINGFACE_HUB_TOKEN),
  * --confirm is passed explicitly,
  * the staging folder exists and looks like the dataset tree.

A token is NEVER hardcoded, NEVER committed, and NEVER shipped in client JS — the
dataset is public + ungated, so the browser needs no token; the token is only for
this one-time WRITE upload and is read from the owner's shell env.

Layout expected under --folder (produced by resort_normalize.py --full +
build_daily_aggregates.py + build_manifest.py):
    index/<SYM>.parquet
    options/<SYM>/<EXPIRY>.parquet
    daily/<SYM>.parquet
    manifest.parquet
    README.md            (the dataset card — copy docs/backtesting/DATASET_CARD.md)

Upload uses huggingface_hub HfApi().upload_large_folder (resumable, multi-worker,
dedupes via the Xet/LFS backend) which is the recommended path for a multi-GB
many-file dataset.

Usage (OWNER, once a token is provided):
    export HF_TOKEN=hf_xxx                         # fine-grained WRITE, ONE repo
    python scripts/etl/upload_hf.py \
        --repo thetrademarkk/india-index-options-1m \
        --folder C:/.../_etl_staging/hf \
        --workers 12 \
        --confirm

    # dry preview (no token needed): lists what WOULD upload
    python scripts/etl/upload_hf.py --repo ... --folder ... --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys


def env_token() -> str | None:
    for k in ("HF_TOKEN", "HUGGINGFACE_HUB_TOKEN", "HUGGING_FACE_HUB_TOKEN"):
        v = os.environ.get(k)
        if v and v.strip():
            return v.strip()
    return None


def looks_like_dataset(folder: str) -> tuple[bool, list[str]]:
    issues = []
    if not os.path.isdir(os.path.join(folder, "options")):
        issues.append("missing options/ tree")
    if not os.path.isdir(os.path.join(folder, "index")):
        issues.append("missing index/ tree")
    if not os.path.exists(os.path.join(folder, "manifest.parquet")):
        issues.append("missing manifest.parquet")
    if not os.path.exists(os.path.join(folder, "README.md")):
        issues.append("missing README.md (the dataset card)")
    return (len(issues) == 0, issues)


def summarize_folder(folder: str) -> dict:
    n_files = 0
    n_bytes = 0
    for dp, _dn, fns in os.walk(folder):
        for f in fns:
            n_files += 1
            try:
                n_bytes += os.path.getsize(os.path.join(dp, f))
            except OSError:
                pass
    return {"files": n_files, "bytes": n_bytes}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Upload the HF-ready dataset (OWNER-gated).")
    ap.add_argument("--repo", required=True, help="e.g. thetrademarkk/india-index-options-1m")
    ap.add_argument("--folder", required=True, help="The HF-ready staging tree.")
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--private", action="store_true", help="Create the repo private (default: public+ungated).")
    ap.add_argument("--dry-run", action="store_true", help="Preview only; never needs a token.")
    ap.add_argument("--confirm", action="store_true", help="REQUIRED to actually upload.")
    args = ap.parse_args(argv)

    if not os.path.isdir(args.folder):
        print(f"ERROR: folder not found: {args.folder}", file=sys.stderr)
        return 2

    ok, issues = looks_like_dataset(args.folder)
    summary = summarize_folder(args.folder)
    print(f"folder: {args.folder}")
    print(f"  files={summary['files']}  size={summary['bytes']/1024/1024:.1f} MB")
    if issues:
        print("  WARN incomplete tree:", "; ".join(issues))

    if args.dry_run:
        print("\nDRY RUN -- would upload the above tree to "
              f"datasets/{args.repo} (repo_type=dataset). No token used.")
        return 0

    token = env_token()
    if not token:
        print(
            "\nREFUSING TO UPLOAD: no token in env. Set HF_TOKEN (fine-grained WRITE,\n"
            "scoped to ONLY the target dataset repo) and re-run with --confirm.",
            file=sys.stderr,
        )
        return 3
    if not args.confirm:
        print(
            "\nREFUSING TO UPLOAD: pass --confirm to proceed (token is present).",
            file=sys.stderr,
        )
        return 3
    if not ok:
        print(
            "\nREFUSING TO UPLOAD: staging tree incomplete (see WARN above). "
            "Run the full ETL first (see docs/backtesting/ETL_RUNBOOK.md).",
            file=sys.stderr,
        )
        return 3

    # Imported lazily so --dry-run works without the dep installed.
    from huggingface_hub import HfApi

    api = HfApi(token=token)
    print(f"\ncreating dataset repo datasets/{args.repo} (exist_ok) ...")
    api.create_repo(
        repo_id=args.repo, repo_type="dataset",
        private=bool(args.private), exist_ok=True,
    )
    print(f"uploading {summary['files']} files with {args.workers} workers "
          "(resumable upload_large_folder) ...")
    api.upload_large_folder(
        repo_id=args.repo,
        repo_type="dataset",
        folder_path=args.folder,
        num_workers=args.workers,
    )
    print("DONE. Verify at: https://huggingface.co/datasets/" + args.repo)
    if not args.private:
        print("Repo is PUBLIC + UNGATED — the browser duckdb-wasm path needs NO token.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
