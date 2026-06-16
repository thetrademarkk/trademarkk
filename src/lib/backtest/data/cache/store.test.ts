/**
 * SliceCache unit tests — the cache FACADE policy (07-data-layer.md §6) exercised
 * against an in-memory FAKE BlobStore (NO real OPFS/IndexedDB). Covers round-trip
 * get/put, the per-slice cap, LRU eviction under budget, coverage pinning,
 * DATASET_VERSION stale-sweep on init, manifest persistence, and the graceful
 * no-cache degrade on a QuotaError.
 */

import { describe, expect, it } from "vitest";
import { type BlobStore, QuotaError } from "./blob-store";
import { type SliceSpec } from "./keys";
import { MANIFEST_KEY, SliceCache } from "./store";

/** A controllable in-memory BlobStore for the cache policy tests. */
class FakeStore implements BlobStore {
  readonly backend = "fake";
  readonly map = new Map<string, Uint8Array>();
  /** When set, the NEXT write of a non-manifest key throws this. */
  throwOnNextWrite: Error | null = null;
  /** When true, every slice write throws a QuotaError. */
  failAllWrites = false;
  writes = 0;

  async read(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }
  async write(key: string, bytes: Uint8Array): Promise<void> {
    this.writes++;
    if (key !== MANIFEST_KEY) {
      if (this.failAllWrites) throw new QuotaError("full");
      if (this.throwOnNextWrite) {
        const e = this.throwOnNextWrite;
        this.throwOnNextWrite = null;
        throw e;
      }
    }
    this.map.set(key, bytes);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}

const bytes = (n: number, fill = 1): Uint8Array => new Uint8Array(n).fill(fill);

const covSpec = (expiry: string): SliceSpec => ({ kind: "cov", sym: "NIFTY", expiry });
const optSpec = (strike: number): SliceSpec => ({
  kind: "opt",
  sym: "NIFTY",
  expiry: "2026-01-29",
  strike,
  optionType: "CE",
  interval: "1m",
});

/** A monotonic fake clock so LRU recency is deterministic. */
function clock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    tick: (by = 1) => {
      t += by;
      return t;
    },
  };
}

describe("SliceCache — round trip", () => {
  it("stores and reads back a slice", async () => {
    const store = new FakeStore();
    const cache = new SliceCache(store, { version: 1 });
    const ok = await cache.put(optSpec(21500), bytes(100));
    expect(ok).toBe(true);
    const got = await cache.get(optSpec(21500));
    expect(got).not.toBeNull();
    expect(got!.byteLength).toBe(100);
  });

  it("returns null on a miss", async () => {
    const cache = new SliceCache(new FakeStore(), { version: 1 });
    expect(await cache.get(optSpec(99999))).toBeNull();
  });

  it("persists the manifest to the backend", async () => {
    const store = new FakeStore();
    const cache = new SliceCache(store, { version: 1 });
    await cache.put(optSpec(21500), bytes(100));
    expect(store.map.has(MANIFEST_KEY)).toBe(true);
  });
});

describe("SliceCache — per-slice cap", () => {
  it("refuses a slice over the per-slice cap (caller streams through)", async () => {
    const store = new FakeStore();
    const cache = new SliceCache(store, { version: 1, maxSlice: 50 });
    const ok = await cache.put(optSpec(21500), bytes(100));
    expect(ok).toBe(false);
    expect(await cache.get(optSpec(21500))).toBeNull();
  });
});

describe("SliceCache — LRU eviction under budget", () => {
  it("evicts the least-recently-accessed slice to make room", async () => {
    const c = clock();
    const store = new FakeStore();
    // budget 250; three 100-byte slices won't fit (300 > 250).
    const cache = new SliceCache(store, { version: 1, budget: 250, now: c.now });

    await cache.put(optSpec(1), bytes(100));
    c.tick();
    await cache.put(optSpec(2), bytes(100));
    c.tick();
    // Touch slice 1 so slice 2 becomes the oldest.
    await cache.get(optSpec(1));
    c.tick();
    // Writing slice 3 must evict the LRU = slice 2.
    await cache.put(optSpec(3), bytes(100));

    expect(await cache.get(optSpec(2))).toBeNull(); // evicted
    expect(await cache.get(optSpec(1))).not.toBeNull();
    expect(await cache.get(optSpec(3))).not.toBeNull();
  });

  it("never evicts pinned coverage reports", async () => {
    const c = clock();
    const store = new FakeStore();
    const cache = new SliceCache(store, { version: 1, budget: 250, now: c.now });

    await cache.put(covSpec("2026-01-29"), bytes(100)); // pinned
    c.tick();
    await cache.put(optSpec(1), bytes(100));
    c.tick();
    // Adding a third 100B slice (300>250) must evict the unpinned opt, not the cov.
    await cache.put(optSpec(2), bytes(100));

    expect(await cache.get(covSpec("2026-01-29"))).not.toBeNull(); // pinned survives
    expect(await cache.get(optSpec(1))).toBeNull(); // evicted
    expect(await cache.get(optSpec(2))).not.toBeNull();
  });

  it("refuses a write that cannot fit even after evicting everything unpinned", async () => {
    const store = new FakeStore();
    const cache = new SliceCache(store, { version: 1, budget: 250 });
    await cache.put(covSpec("2026-01-29"), bytes(200)); // pinned, 200B
    // A 100B opt can't fit (pinned 200 + 100 > 250) → refused, cov untouched.
    const ok = await cache.put(optSpec(1), bytes(100));
    expect(ok).toBe(false);
    expect(await cache.get(covSpec("2026-01-29"))).not.toBeNull();
  });
});

describe("SliceCache — DATASET_VERSION invalidation", () => {
  it("sweeps slices from a previous version on init", async () => {
    const store = new FakeStore();
    // Seed the backend as if a v1 cache had been written, plus a v1 manifest.
    const oldKey = "v1/opt/NIFTY/2026-01-29/21500-CE/1m.arrow";
    store.map.set(oldKey, bytes(100));
    store.map.set(
      MANIFEST_KEY,
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          entries: { [oldKey]: { bytes: 100, lastAccess: 1, pinned: false } },
        })
      )
    );

    // Open the cache as v2 — the v1 slice is stale and must be swept.
    const cache = new SliceCache(store, { version: 2 });
    await cache.init();
    expect(store.map.has(oldKey)).toBe(false);
    expect(cache.sizeBytes).toBe(0);
  });
});

describe("SliceCache — graceful degrade on quota", () => {
  it("disables the cache and returns false when a slice write hits quota", async () => {
    const store = new FakeStore();
    store.failAllWrites = true;
    const cache = new SliceCache(store, { version: 1 });
    const ok = await cache.put(optSpec(1), bytes(100));
    expect(ok).toBe(false);
    expect(cache.isDisabled).toBe(true);
    // Once disabled, every read is a clean miss (no crash).
    expect(await cache.get(optSpec(1))).toBeNull();
  });

  it("stays disabled for the rest of the session after one quota error", async () => {
    const store = new FakeStore();
    const cache = new SliceCache(store, { version: 1 });
    store.throwOnNextWrite = new QuotaError("full");
    await cache.put(optSpec(1), bytes(100));
    expect(cache.isDisabled).toBe(true);
    // Even though writes would now succeed, the cache remains disabled.
    store.failAllWrites = false;
    const ok = await cache.put(optSpec(2), bytes(100));
    expect(ok).toBe(false);
  });

  it("recovers from a corrupt manifest by starting clean", async () => {
    const store = new FakeStore();
    store.map.set(MANIFEST_KEY, new TextEncoder().encode("{not json"));
    const cache = new SliceCache(store, { version: 1 });
    await cache.init();
    expect(cache.isDisabled).toBe(false);
    expect(cache.sizeBytes).toBe(0);
    expect(await cache.put(optSpec(1), bytes(100))).toBe(true);
  });
});

describe("SliceCache — manifest/backend drift", () => {
  it("drops a phantom manifest entry whose blob is missing", async () => {
    const store = new FakeStore();
    const cache = new SliceCache(store, { version: 1 });
    await cache.put(optSpec(1), bytes(100));
    // Simulate the blob vanishing out from under the manifest.
    store.map.delete("v1/opt/NIFTY/2026-01-29/1-CE/1m.arrow");
    expect(await cache.get(optSpec(1))).toBeNull();
  });
});
