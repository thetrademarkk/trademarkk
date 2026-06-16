/**
 * BlobStore — the storage SEAM the slice cache (store.ts) writes through
 * (07-data-layer.md §6). Two concrete backends implement it: OPFS (preferred,
 * opfs.ts) and IndexedDB (fallback, idb.ts). store.ts owns the manifest/LRU
 * policy (keys.ts) and treats a BlobStore as a dumb key → bytes map that may
 * throw `QuotaError` when storage is full.
 *
 * Keeping this interface tiny + storage-agnostic is what lets the cache logic be
 * unit-tested against an in-memory fake with no real OPFS/IndexedDB present.
 */

/** A keyed binary blob store. Keys are the slash-delimited cache keys (keys.ts). */
export interface BlobStore {
  /** Stable id for diagnostics ("opfs" | "idb" | a test fake). */
  readonly backend: string;
  /** Read a blob, or null when absent. */
  read(key: string): Promise<Uint8Array | null>;
  /**
   * Write a blob. MUST throw `QuotaError` (below) when storage is full so the
   * cache can degrade to no-cache rather than crash.
   */
  write(key: string, bytes: Uint8Array): Promise<void>;
  /** Delete a blob; a missing key is a no-op (idempotent eviction). */
  delete(key: string): Promise<void>;
  /** List every key currently held — used to reconcile a lost/corrupt manifest. */
  keys(): Promise<string[]>;
}

/**
 * Raised by a BlobStore write when the quota is exhausted (OPFS full, IndexedDB
 * blocked in private mode, etc.). The cache catches it, disables itself for the
 * session, and streams the slice straight through (§6 graceful degrade).
 */
export class QuotaError extends Error {
  constructor(
    message = "Storage quota exceeded",
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "QuotaError";
  }
}

/** Normalise any storage error into a QuotaError when it smells like a quota hit. */
export function asQuotaError(err: unknown): QuotaError | null {
  if (err instanceof QuotaError) return err;
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  if (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    /quota|storage full|disk/i.test(msg)
  ) {
    return new QuotaError(msg || "Storage quota exceeded", err);
  }
  return null;
}
