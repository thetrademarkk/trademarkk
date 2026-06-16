/**
 * keys.ts unit tests — the PURE cache-key + manifest/LRU/budget logic
 * (07-data-layer.md §6). No OPFS, no network: every assertion is over strings and
 * plain manifest objects. Covers key building, DATASET_VERSION keying + stale
 * detection, pinning, total-bytes, the LRU eviction PLAN, and the over-budget
 * (cannot-fit) edge.
 */

import { describe, expect, it } from "vitest";
import { DATASET_VERSION } from "../urls";
import {
  type Manifest,
  type ManifestEntry,
  MAX_SLICE_BYTES,
  TOTAL_BUDGET_BYTES,
  cacheKey,
  emptyManifest,
  fitsAfterEviction,
  isPinnedKey,
  isStaleVersionKey,
  planEviction,
  staleVersionKeys,
  totalBytes,
  withEntry,
  withoutKeys,
} from "./keys";

const entry = (bytes: number, lastAccess: number, pinned = false): ManifestEntry => ({
  bytes,
  lastAccess,
  pinned,
});

function manifestOf(rows: Record<string, ManifestEntry>): Manifest {
  return { version: 1, entries: rows };
}

describe("cacheKey", () => {
  it("builds the cov/opt/idx layout keys with the version prefix", () => {
    expect(cacheKey({ kind: "cov", sym: "NIFTY", expiry: "2026-01-29" }, 1)).toBe(
      "v1/cov/NIFTY/2026-01-29.arrow"
    );
    expect(
      cacheKey(
        {
          kind: "opt",
          sym: "NIFTY",
          expiry: "2026-01-29",
          strike: 21500,
          optionType: "CE",
          interval: "1m",
        },
        1
      )
    ).toBe("v1/opt/NIFTY/2026-01-29/21500-CE/1m.arrow");
    expect(
      cacheKey(
        { kind: "idx", sym: "NIFTY", from: "2026-01-01", to: "2026-03-31", interval: "1m" },
        1
      )
    ).toBe("v1/idx/NIFTY/2026-01-01_2026-03-31/1m.arrow");
  });

  it("defaults to the live DATASET_VERSION", () => {
    expect(cacheKey({ kind: "cov", sym: "SENSEX", expiry: "2026-02-26" })).toBe(
      `v${DATASET_VERSION}/cov/SENSEX/2026-02-26.arrow`
    );
  });

  it("a version bump produces a DIFFERENT key (silent invalidation)", () => {
    const a = cacheKey({ kind: "cov", sym: "NIFTY", expiry: "2026-01-29" }, 1);
    const b = cacheKey({ kind: "cov", sym: "NIFTY", expiry: "2026-01-29" }, 2);
    expect(a).not.toBe(b);
  });
});

describe("pinning + stale-version detection", () => {
  it("only cov keys are pinned", () => {
    expect(isPinnedKey("v1/cov/NIFTY/2026-01-29.arrow")).toBe(true);
    expect(isPinnedKey("v1/opt/NIFTY/2026-01-29/21500-CE/1m.arrow")).toBe(false);
    expect(isPinnedKey("v1/idx/NIFTY/a_b/1m.arrow")).toBe(false);
  });

  it("flags keys from another dataset version as stale", () => {
    expect(isStaleVersionKey("v1/opt/NIFTY/x/y/1m.arrow", 1)).toBe(false);
    expect(isStaleVersionKey("v1/opt/NIFTY/x/y/1m.arrow", 2)).toBe(true);
    expect(isStaleVersionKey("garbage/key", 1)).toBe(true);
  });

  it("staleVersionKeys returns only the wrong-version keys", () => {
    const m = manifestOf({
      "v1/opt/a": entry(10, 1),
      "v2/opt/b": entry(10, 2),
      "v1/cov/c": entry(5, 3, true),
    });
    expect(staleVersionKeys(m, 1).sort()).toEqual(["v2/opt/b"]);
  });
});

describe("totalBytes + manifest helpers", () => {
  it("sums entry bytes", () => {
    const m = manifestOf({ a: entry(100, 1), b: entry(250, 2) });
    expect(totalBytes(m)).toBe(350);
    expect(totalBytes(emptyManifest())).toBe(0);
  });

  it("withEntry / withoutKeys are pure (no mutation)", () => {
    const m = manifestOf({ a: entry(100, 1) });
    const m2 = withEntry(m, "b", entry(50, 2));
    expect(Object.keys(m.entries)).toEqual(["a"]);
    expect(Object.keys(m2.entries).sort()).toEqual(["a", "b"]);
    const m3 = withoutKeys(m2, ["a"]);
    expect(Object.keys(m3.entries)).toEqual(["b"]);
    expect(Object.keys(m2.entries).sort()).toEqual(["a", "b"]); // unchanged
  });
});

describe("planEviction — LRU + budget", () => {
  it("evicts nothing when there is room", () => {
    const m = manifestOf({ a: entry(10, 1), b: entry(10, 2) });
    expect(planEviction(m, 5, 100)).toEqual([]);
  });

  it("evicts oldest-access first until the incoming slice fits", () => {
    // budget 100; current 90 (a=30@t1, b=30@t3, c=30@t2); incoming 30.
    const m = manifestOf({
      a: entry(30, 1),
      b: entry(30, 3),
      c: entry(30, 2),
    });
    // Need to free 90+30-100 = 20 → evict the single oldest (a@t1, 30 bytes).
    expect(planEviction(m, 30, 100)).toEqual(["a"]);
  });

  it("evicts multiple oldest slices when one is not enough", () => {
    const m = manifestOf({
      a: entry(30, 1),
      b: entry(30, 2),
      c: entry(30, 3),
    });
    // current 90, budget 100, incoming 60 → free ≥50 → evict a(30)+b(30).
    expect(planEviction(m, 60, 100)).toEqual(["a", "b"]);
  });

  it("never evicts pinned (coverage) slices", () => {
    const m = manifestOf({
      pinned: entry(80, 1, true),
      opt: entry(15, 2),
    });
    // current 95, budget 100, incoming 20 → must free ≥15 → only the unpinned opt.
    expect(planEviction(m, 20, 100)).toEqual(["opt"]);
  });

  it("breaks lastAccess ties by key for determinism", () => {
    const m = manifestOf({
      z: entry(30, 5),
      a: entry(30, 5),
      keep: entry(30, 9),
    });
    // current 90, budget 100, incoming 30 → free ≥20 → oldest tie: a before z.
    expect(planEviction(m, 30, 100)).toEqual(["a"]);
  });
});

describe("fitsAfterEviction — cannot-fit edge", () => {
  it("true when eviction can make room", () => {
    const m = manifestOf({ a: entry(200, 1) });
    expect(fitsAfterEviction(m, 100, 250)).toBe(true);
  });

  it("false when pinned bytes + incoming exceed the budget", () => {
    const m = manifestOf({ pin: entry(200, 1, true) });
    // pinned 200 can't be evicted; incoming 100 → 300 > 250 budget.
    expect(fitsAfterEviction(m, 100, 250)).toBe(false);
  });

  it("false when a single slice exceeds the whole budget", () => {
    expect(fitsAfterEviction(emptyManifest(), 300, 250)).toBe(false);
  });
});

describe("budget constants match the §6 spec", () => {
  it("250 MB total, 8 MB per slice", () => {
    expect(TOTAL_BUDGET_BYTES).toBe(250 * 1024 * 1024);
    expect(MAX_SLICE_BYTES).toBe(8 * 1024 * 1024);
  });
});
