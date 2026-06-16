/**
 * SliceCache — the layer-2 resolved-slice cache FACADE (07-data-layer.md §6). It
 * owns the manifest/LRU/budget POLICY (keys.ts) over an injectable BlobStore
 * backend (OPFS preferred, IndexedDB fallback), enforcing:
 *
 *   - the 250 MB total budget with LRU-by-last-access eviction before each write;
 *   - the 8 MB per-slice cap (oversize slices are refused → caller streams through);
 *   - PINNED coverage reports (never evicted);
 *   - DATASET_VERSION-keyed invalidation (a version bump sweeps stale slices);
 *   - GRACEFUL no-cache degrade on a QuotaError (private mode / disk full) — the
 *     cache disables itself for the session and every read becomes a miss, never
 *     a crash.
 *
 * The backend + clock are injected so the whole policy is unit-tested against an
 * in-memory fake store with no real OPFS/IndexedDB. The default factory picks the
 * real backend lazily in the browser.
 */

import {
  type Manifest,
  type ManifestEntry,
  type SliceSpec,
  MAX_SLICE_BYTES,
  TOTAL_BUDGET_BYTES,
  cacheKey,
  emptyManifest,
  fitsAfterEviction,
  isPinnedKey,
  planEviction,
  staleVersionKeys,
  totalBytes,
  withEntry,
  withoutKeys,
} from "./keys";
import { type BlobStore, QuotaError, asQuotaError } from "./blob-store";
import { DATASET_VERSION } from "../urls";

/** Where the manifest blob lives inside the store (a reserved, never-evicted key). */
export const MANIFEST_KEY = "manifest.json";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Options for constructing a SliceCache (all injectable for tests). */
export interface SliceCacheOptions {
  /** Total byte budget. Defaults to the §6 250 MB cap. */
  budget?: number;
  /** Per-slice byte cap. Defaults to the §6 8 MB cap. */
  maxSlice?: number;
  /** Clock seam for LRU timestamps. Defaults to Date.now. */
  now?: () => number;
  /** Dataset version for keying + stale-sweep. Defaults to urls.DATASET_VERSION. */
  version?: number;
}

export class SliceCache {
  private readonly budget: number;
  private readonly maxSlice: number;
  private readonly now: () => number;
  private readonly version: number;

  /** In-memory manifest mirror; persisted to the backend after each mutation. */
  private manifest: Manifest = emptyManifest();
  private loaded = false;
  /** Set once a QuotaError is seen — the cache stays disabled for the session. */
  private disabled = false;
  /** Coalesces the manifest load so concurrent first-callers share one read. */
  private loadPromise: Promise<void> | null = null;

  constructor(
    private readonly store: BlobStore,
    opts: SliceCacheOptions = {}
  ) {
    this.budget = opts.budget ?? TOTAL_BUDGET_BYTES;
    this.maxSlice = opts.maxSlice ?? MAX_SLICE_BYTES;
    this.now = opts.now ?? Date.now;
    this.version = opts.version ?? DATASET_VERSION;
  }

  /** Has the cache degraded to no-cache for this session? */
  get isDisabled(): boolean {
    return this.disabled;
  }

  /** Backend id for diagnostics. */
  get backend(): string {
    return this.store.backend;
  }

  /** Current cached bytes (after any load). */
  get sizeBytes(): number {
    return totalBytes(this.manifest);
  }

  /**
   * Lazily load the manifest from the backend, reconcile it against the actual
   * keys present, and sweep any slices from a previous DATASET_VERSION. Idempotent
   * + coalesced. A failure here disables the cache rather than throwing.
   */
  async init(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doInit().finally(() => {
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private async doInit(): Promise<void> {
    try {
      const raw = await this.store.read(MANIFEST_KEY);
      this.manifest = raw ? this.parseManifest(raw) : emptyManifest();
      await this.sweepStaleVersions();
      this.loaded = true;
    } catch (err) {
      this.degrade(err);
    }
  }

  private parseManifest(bytes: Uint8Array): Manifest {
    try {
      const obj = JSON.parse(textDecoder.decode(bytes)) as Manifest;
      if (!obj || typeof obj !== "object" || typeof obj.entries !== "object") {
        return emptyManifest();
      }
      return obj;
    } catch {
      return emptyManifest(); // corrupt manifest → start clean
    }
  }

  /** Delete every slice from an older DATASET_VERSION + drop it from the manifest. */
  private async sweepStaleVersions(): Promise<void> {
    const stale = staleVersionKeys(this.manifest, this.version);
    if (stale.length === 0) return;
    for (const key of stale) {
      await this.store.delete(key).catch(() => {});
    }
    this.manifest = withoutKeys(this.manifest, stale);
    await this.persistManifest();
  }

  /** Read a cached slice by spec, or null on a miss / disabled cache. */
  async get(spec: SliceSpec): Promise<Uint8Array | null> {
    if (this.disabled) return null;
    await this.init();
    if (this.disabled) return null;
    const key = cacheKey(spec, this.version);
    const entry = this.manifest.entries[key];
    if (!entry) return null;
    try {
      const bytes = await this.store.read(key);
      if (!bytes) {
        // Manifest/backend drift — drop the phantom entry.
        this.manifest = withoutKeys(this.manifest, [key]);
        await this.persistManifest().catch(() => {});
        return null;
      }
      // LRU touch: bump last-access and persist (cheap, single manifest write).
      this.manifest = withEntry(this.manifest, key, {
        ...entry,
        lastAccess: this.now(),
      });
      await this.persistManifest().catch(() => {});
      return bytes;
    } catch (err) {
      this.degrade(err);
      return null;
    }
  }

  /**
   * Write a slice for `spec`. Enforces the per-slice cap, evicts LRU unpinned
   * slices to fit the budget, and pins coverage reports. Returns true when the
   * slice was cached, false when it was refused (oversize / cannot fit / disabled)
   * — the caller still has the bytes and simply streams through.
   */
  async put(spec: SliceSpec, bytes: Uint8Array): Promise<boolean> {
    if (this.disabled) return false;
    await this.init();
    if (this.disabled) return false;

    const incoming = bytes.byteLength;
    // A single slice over the per-slice cap is never cached (§6).
    if (incoming > this.maxSlice) return false;
    // Cannot fit even after evicting every unpinned slice (pinned + incoming >
    // budget) → skip caching, stream through.
    if (!fitsAfterEviction(this.manifest, incoming, this.budget)) return false;

    const key = cacheKey(spec, this.version);
    try {
      // Evict oldest unpinned slices to make room BEFORE writing.
      const evict = planEviction(this.manifest, incoming, this.budget);
      for (const k of evict) {
        await this.store.delete(k);
      }
      if (evict.length > 0) this.manifest = withoutKeys(this.manifest, evict);

      await this.store.write(key, bytes);

      const entry: ManifestEntry = {
        bytes: incoming,
        lastAccess: this.now(),
        pinned: isPinnedKey(key),
      };
      this.manifest = withEntry(this.manifest, key, entry);
      await this.persistManifest();
      return true;
    } catch (err) {
      this.degrade(err);
      return false;
    }
  }

  /** Persist the in-memory manifest to the backend (best-effort). */
  private async persistManifest(): Promise<void> {
    if (this.disabled) return;
    const bytes = textEncoder.encode(JSON.stringify(this.manifest));
    try {
      await this.store.write(MANIFEST_KEY, bytes);
    } catch (err) {
      this.degrade(err);
    }
  }

  /**
   * Disable the cache for the session on a quota/storage fault (§6 graceful
   * degrade). Idempotent; the in-memory manifest is dropped so subsequent gets
   * are clean misses.
   */
  private degrade(err: unknown): void {
    if (this.disabled) return;
    this.disabled = true;
    this.manifest = emptyManifest();
    const quota = asQuotaError(err) ?? (err instanceof QuotaError ? err : null);
    if (typeof console !== "undefined") {
      console.warn(
        "[bt-cache] disabling slice cache for this session (degraded to no-cache)",
        quota?.message ?? err
      );
    }
  }

  /** Clear ALL cached slices + the manifest (e.g. a manual reset). */
  async clear(): Promise<void> {
    if (this.disabled) return;
    await this.init();
    try {
      for (const key of Object.keys(this.manifest.entries)) {
        await this.store.delete(key).catch(() => {});
      }
      this.manifest = emptyManifest();
      await this.persistManifest();
    } catch (err) {
      this.degrade(err);
    }
  }
}
