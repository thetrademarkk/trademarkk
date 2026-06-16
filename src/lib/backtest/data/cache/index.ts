/**
 * Cache public surface + default browser backend selection (07-data-layer.md §6).
 * The pure policy (keys.ts), the coalescer/limiter (coalesce.ts), and the
 * BlobStore seam (blob-store.ts) are node/vitest-safe and re-exported here. The
 * `createBrowserSliceCache()` factory is the ONLY browser-only entry: it picks
 * OPFS when available, falls back to IndexedDB, and disables the cache entirely
 * when neither exists (graceful no-cache). It must not be called from node/server.
 */

export * from "./keys";
export * from "./coalesce";
export { type BlobStore, QuotaError, asQuotaError } from "./blob-store";
export { SliceCache, type SliceCacheOptions, MANIFEST_KEY } from "./store";

import { type BlobStore } from "./blob-store";
import { SliceCache, type SliceCacheOptions } from "./store";
import { IdbBlobStore, isIdbAvailable } from "./idb";
import { OpfsBlobStore, isOpfsAvailable } from "./opfs";

/**
 * A BlobStore that silently swallows everything — the no-storage backend used
 * when neither OPFS nor IndexedDB exists. The SliceCache over it behaves as a
 * permanent miss (every read null, every write refused) without special-casing.
 */
class NullBlobStore implements BlobStore {
  readonly backend = "none";
  async read(): Promise<Uint8Array | null> {
    return null;
  }
  async write(): Promise<void> {
    // No storage — caller streams through.
  }
  async delete(): Promise<void> {}
  async keys(): Promise<string[]> {
    return [];
  }
}

/** Pick the best available browser blob backend (OPFS → IndexedDB → none). */
export function pickBrowserBlobStore(): BlobStore {
  if (isOpfsAvailable()) return new OpfsBlobStore();
  if (isIdbAvailable()) return new IdbBlobStore();
  return new NullBlobStore();
}

let _cache: SliceCache | null = null;

/**
 * Get the process-wide browser slice cache singleton, instantiated lazily on the
 * first call. BROWSER-ONLY. Pass options only in tests (which should construct a
 * SliceCache over a fake store directly instead).
 */
export function getSliceCache(opts?: SliceCacheOptions): SliceCache {
  if (!_cache) _cache = new SliceCache(pickBrowserBlobStore(), opts);
  return _cache;
}

/** TEST/HMR hook: drop the singleton so a later getSliceCache() rebuilds it. */
export function __resetSliceCacheForTest(): void {
  _cache = null;
}
