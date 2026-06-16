/**
 * Cache KEY + MANIFEST/LRU logic — the pure, unit-testable heart of the browser
 * slice cache (07-data-layer.md §6). NOTHING here touches OPFS, IndexedDB, or the
 * network: it builds the cache keys, maintains the manifest index, and decides
 * which slices to evict to stay under the 250 MB budget. The storage backends
 * (opfs.ts / idb.ts) and the cache facade (store.ts) consume this module so the
 * eviction policy can be tested with a fake store and a plain in-memory manifest.
 *
 * Layout this module describes (the physical file paths live in opfs.ts):
 *   /tmk-bt-cache/
 *     manifest.json                       index of cached slices + bytes + LRU ts
 *     cov/NIFTY/2026-01-29.arrow          coverage report (tiny, PINNED)
 *     opt/NIFTY/2026-01-29/21500-CE/1m.arrow
 *     idx/NIFTY/2026-01-01_2026-03-31/1m.arrow
 *
 * Hard rules from §6, enforced here:
 *   - Keys are logical `(kind, symbol, expiry|index, strike/side|range, interval,
 *     DATASET_VERSION)` tuples — NEVER raw byte ranges (those are duckdb-wasm's
 *     internal concern).
 *   - DATASET_VERSION is part of EVERY key, so bumping it in urls.ts silently
 *     invalidates every stale slice (a backfill that rewrites a parquet file).
 *   - Coverage reports are PINNED: never evicted (tiny + re-read constantly).
 *   - LRU by last-access; before each write, evict the oldest UNPINNED slices
 *     until `total + incoming <= 250 MB`.
 */

import { DATASET_VERSION } from "../urls";
import type { Interval, OptionType, Sym } from "../schema";

/* ──────────────────────────────── budget ─────────────────────────────────── */

/** Total OPFS backtest cache cap — the hard 250 MB ceiling (§6). */
export const TOTAL_BUDGET_BYTES = 250 * 1024 * 1024;

/**
 * Per-resolved-slice cap (§6). A single slice larger than this is rejected by the
 * cache (the caller streams it straight through instead) — should never happen
 * for a resolved single-strike series.
 */
export const MAX_SLICE_BYTES = 8 * 1024 * 1024;

/* ─────────────────────────────── key kinds ───────────────────────────────── */

/**
 * The three cacheable slice kinds (§6 layout). `cov` (coverage report) is pinned;
 * `opt` (a resolved option leg series) and `idx` (an index slice) are LRU-evicted.
 */
export type SliceKind = "cov" | "opt" | "idx";

/** Discriminated descriptor of a logical cache entry — the input to `cacheKey`. */
export type SliceSpec =
  | { kind: "cov"; sym: Sym; expiry: string }
  | {
      kind: "opt";
      sym: Sym;
      expiry: string;
      strike: number;
      optionType: OptionType;
      interval: Interval;
    }
  | { kind: "idx"; sym: Sym; from: string; to: string; interval: Interval };

/* ───────────────────────────── key building ──────────────────────────────── */

/**
 * Build the stable, filesystem-safe key for a slice spec. The key DOUBLES as the
 * OPFS path (slashes are real directories) and as the IndexedDB primary key
 * (slashes are just part of the string). DATASET_VERSION is prefixed so a dataset
 * rewrite invalidates everything at once.
 *
 * Examples:
 *   v1/cov/NIFTY/2026-01-29.arrow
 *   v1/opt/NIFTY/2026-01-29/21500-CE/1m.arrow
 *   v1/idx/NIFTY/2026-01-01_2026-03-31/1m.arrow
 */
export function cacheKey(spec: SliceSpec, version: number = DATASET_VERSION): string {
  const v = `v${version}`;
  switch (spec.kind) {
    case "cov":
      return `${v}/cov/${spec.sym}/${spec.expiry}.arrow`;
    case "opt":
      return `${v}/opt/${spec.sym}/${spec.expiry}/${spec.strike}-${spec.optionType}/${spec.interval}.arrow`;
    case "idx":
      return `${v}/idx/${spec.sym}/${spec.from}_${spec.to}/${spec.interval}.arrow`;
  }
}

/** Coverage reports are pinned (never evicted) — derived from the key prefix. */
export function isPinnedKey(key: string): boolean {
  // `v<N>/cov/...` — the kind segment is index 1.
  return key.split("/")[1] === "cov";
}

/**
 * Is this key from a DIFFERENT dataset version than the current one? Used to sweep
 * stale slices left by an older DATASET_VERSION on first load (§6 invalidation).
 */
export function isStaleVersionKey(key: string, current: number = DATASET_VERSION): boolean {
  const seg = key.split("/")[0]; // "v<N>"
  if (seg === undefined || seg[0] !== "v") return true; // unrecognised → treat as stale
  const n = Number(seg.slice(1));
  return !Number.isInteger(n) || n !== current;
}

/* ──────────────────────────────── manifest ───────────────────────────────── */

/** One manifest row: the slice's byte size and its last-access epoch-ms (LRU). */
export interface ManifestEntry {
  /** Byte length of the stored Arrow blob. */
  bytes: number;
  /** Epoch-ms of the last read OR write — the LRU recency key. */
  lastAccess: number;
  /** Pinned entries (coverage reports) are never evicted. */
  pinned: boolean;
}

/** The on-disk `manifest.json` shape: keyed index of every cached slice. */
export interface Manifest {
  /** Bumped if the manifest format ever changes. */
  version: number;
  /** key → entry. */
  entries: Record<string, ManifestEntry>;
}

/** Current manifest format version. */
export const MANIFEST_VERSION = 1;

/** A fresh, empty manifest. */
export function emptyManifest(): Manifest {
  return { version: MANIFEST_VERSION, entries: {} };
}

/** Sum of every entry's bytes — the live cache size. */
export function totalBytes(manifest: Manifest): number {
  let sum = 0;
  for (const key in manifest.entries) {
    sum += manifest.entries[key]!.bytes;
  }
  return sum;
}

/**
 * Decide which UNPINNED keys to evict, oldest-access first, so that after
 * deleting them `totalBytes + incoming <= TOTAL_BUDGET_BYTES`. Pure: returns the
 * keys to delete (ascending recency) WITHOUT mutating the manifest. The caller
 * deletes those blobs from storage and removes them from the manifest.
 *
 * Pinned slices (coverage) are excluded from the candidate set — they hold their
 * space. If even evicting every unpinned slice cannot make room (the incoming
 * slice plus pinned bytes exceed the budget), every unpinned key is returned;
 * the caller then refuses the write (graceful no-cache for that slice).
 *
 * `incoming` is the byte size of the slice about to be written (0 when simply
 * trimming an over-budget cache, e.g. after a DATASET_VERSION bump).
 */
export function planEviction(
  manifest: Manifest,
  incoming: number,
  budget: number = TOTAL_BUDGET_BYTES
): string[] {
  const current = totalBytes(manifest);
  if (current + incoming <= budget) return [];

  // Unpinned candidates, oldest lastAccess first; ties broken by key for
  // determinism (so tests + behaviour are stable).
  const candidates = Object.keys(manifest.entries)
    .filter((k) => !manifest.entries[k]!.pinned)
    .sort((a, b) => {
      const ea = manifest.entries[a]!;
      const eb = manifest.entries[b]!;
      if (ea.lastAccess !== eb.lastAccess) return ea.lastAccess - eb.lastAccess;
      return a < b ? -1 : a > b ? 1 : 0;
    });

  const toEvict: string[] = [];
  let freed = 0;
  for (const key of candidates) {
    if (current - freed + incoming <= budget) break;
    toEvict.push(key);
    freed += manifest.entries[key]!.bytes;
  }
  return toEvict;
}

/**
 * Will a slice of `incoming` bytes fit AFTER the planned eviction? False means the
 * cache cannot hold it even with every unpinned slice gone (pinned + incoming >
 * budget) — the caller must skip caching and stream through (§6 graceful degrade).
 */
export function fitsAfterEviction(
  manifest: Manifest,
  incoming: number,
  budget: number = TOTAL_BUDGET_BYTES
): boolean {
  if (incoming > budget) return false;
  const plan = planEviction(manifest, incoming, budget);
  const evictedBytes = plan.reduce((s, k) => s + (manifest.entries[k]?.bytes ?? 0), 0);
  return totalBytes(manifest) - evictedBytes + incoming <= budget;
}

/**
 * Return a NEW manifest with `keys` removed (the post-eviction state). Pure — the
 * caller persists it after the blobs are actually deleted from storage.
 */
export function withoutKeys(manifest: Manifest, keys: readonly string[]): Manifest {
  if (keys.length === 0) return manifest;
  const drop = new Set(keys);
  const entries: Record<string, ManifestEntry> = {};
  for (const k in manifest.entries) {
    if (!drop.has(k)) entries[k] = manifest.entries[k]!;
  }
  return { version: manifest.version, entries };
}

/**
 * Return a NEW manifest with `key` inserted/updated (write or access touch). Pure.
 */
export function withEntry(manifest: Manifest, key: string, entry: ManifestEntry): Manifest {
  return {
    version: manifest.version,
    entries: { ...manifest.entries, [key]: entry },
  };
}

/**
 * All keys whose DATASET_VERSION differs from `current` — the set to sweep on
 * boot to free space left by a previous dataset version (§6 invalidation).
 */
export function staleVersionKeys(manifest: Manifest, current: number = DATASET_VERSION): string[] {
  return Object.keys(manifest.entries).filter((k) => isStaleVersionKey(k, current));
}
