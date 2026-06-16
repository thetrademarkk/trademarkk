/**
 * HuggingFace dataset URL builders (07-data-layer.md §1).
 *
 * Two resolved forms, BOTH must work and BOTH are emitted from the same path
 * builders so they can never drift:
 *
 *   - Browser DIRECT (HTTPS `resolve/main`): `duckdb-wasm`'s httpfs honors HTTP
 *     range reads against it and it sits behind HF's CDN.
 *       https://huggingface.co/datasets/<repo>/resolve/main/<path>
 *   - Server NATIVE (`hf://`): cleaner, supports an auth header if the dataset
 *     ever gates.
 *       hf://datasets/<repo>/<path>
 *
 * Pure string builders only — no network, no DuckDB, no deps.
 */

import type { Sym } from "./schema";

/**
 * Dataset cache-version. Bump when ANY parquet file is rewritten (e.g. a
 * backfill of missing strikes). It is part of every browser cache key so a
 * rewrite silently invalidates stale slices (07-data-layer §6). It is NOT part
 * of the URL itself — `resolve/main` always points at the latest commit.
 */
export const DATASET_VERSION = 1 as const;

/** The HuggingFace dataset repository id (public). */
export const DATASET_REPO = "thetrademarkk/india-index-options-1m" as const;

/** Base for the browser DIRECT (HTTPS, CDN-cacheable, range-readable) form. */
export const HTTPS_BASE = `https://huggingface.co/datasets/${DATASET_REPO}/resolve/main` as const;

/** Base for the server NATIVE (`hf://`) form. */
export const HF_BASE = `hf://datasets/${DATASET_REPO}` as const;

/** Which resolved form to emit. */
export type UrlForm = "https" | "hf";

/** Prefix the right base onto a repo-relative path (no leading slash). */
function withBase(form: UrlForm, relPath: string): string {
  return `${form === "hf" ? HF_BASE : HTTPS_BASE}/${relPath}`;
}

/**
 * Repo-relative path to a spot index file: `index/{SYMBOL}.parquet`. Exposed so
 * cache keys can use the path without baking in a base.
 */
export function indexPath(sym: Sym): string {
  return `index/${sym}.parquet`;
}

/**
 * Repo-relative path to one expiry's option chain:
 * `options/{SYMBOL}/{EXPIRY}.parquet`. `expiry` is the file's partition key in
 * "YYYY-MM-DD" form (07-data-layer §1 — one file per EXPIRY date).
 */
export function optionPath(sym: Sym, expiry: string): string {
  return `options/${sym}/${expiry}.parquet`;
}

/** Fully-resolved URL for a spot index file, in the requested form. */
export function indexUrl(sym: Sym, form: UrlForm = "https"): string {
  return withBase(form, indexPath(sym));
}

/** Fully-resolved URL for one expiry's option chain, in the requested form. */
export function optionUrl(sym: Sym, expiry: string, form: UrlForm = "https"): string {
  return withBase(form, optionPath(sym, expiry));
}
