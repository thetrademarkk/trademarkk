import { describe, expect, it } from "vitest";
import { allTags, EMPTY_FILTER, filterPresets, isEmptyFilter, matchesFilter } from "./filter";
import { PRESETS } from "./catalogue";
import type { PresetMeta } from "./types";

const metas = PRESETS.map((p) => p.meta);

describe("matchesFilter", () => {
  it("empty filter passes every preset", () => {
    for (const m of metas) expect(matchesFilter(m, EMPTY_FILTER)).toBe(true);
  });

  it("filters by index", () => {
    const nifty = filterPresets(metas, { index: "NIFTY" });
    expect(nifty.length).toBeGreaterThan(0);
    expect(nifty.every((m) => m.index === "NIFTY")).toBe(true);
    expect(nifty.some((m) => m.index === "SENSEX")).toBe(false);
  });

  it("filters by category", () => {
    const sellers = filterPresets(metas, { category: "premium-selling" });
    expect(sellers.length).toBeGreaterThan(0);
    expect(sellers.every((m) => m.category === "premium-selling")).toBe(true);
  });

  it("filters by tag (case-insensitive, exact tag match)", () => {
    const hedged = filterPresets(metas, { tag: "Defined-Risk" });
    expect(hedged.length).toBeGreaterThan(0);
    expect(hedged.every((m) => m.tags.map((t) => t.toLowerCase()).includes("defined-risk"))).toBe(
      true
    );
  });

  it("combines facets (AND semantics)", () => {
    const combined = filterPresets(metas, { index: "NIFTY", category: "hedged" });
    expect(combined.every((m) => m.index === "NIFTY" && m.category === "hedged")).toBe(true);
    // narrower than each single facet
    const byIndex = filterPresets(metas, { index: "NIFTY" });
    expect(combined.length).toBeLessThanOrEqual(byIndex.length);
  });

  it("a non-matching combination yields empty", () => {
    // SENSEX has no premium-selling preset in the catalogue
    const none = filterPresets(metas, { index: "SENSEX", category: "premium-selling" });
    expect(none).toEqual([]);
  });

  it("preserves input order", () => {
    const out = filterPresets(metas, { index: "NIFTY" });
    const order = out.map((m) => m.id);
    const expected = metas.filter((m) => m.index === "NIFTY").map((m) => m.id);
    expect(order).toEqual(expected);
  });
});

describe("allTags", () => {
  it("returns a sorted, de-duplicated tag set", () => {
    const tags = allTags(metas);
    expect(tags.length).toBeGreaterThan(0);
    expect([...tags]).toEqual([...tags].sort());
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain("premium-selling");
  });

  it("handles an empty list", () => {
    expect(allTags([] as PresetMeta[])).toEqual([]);
  });
});

describe("isEmptyFilter", () => {
  it("true only when no facet is set", () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
    expect(isEmptyFilter({ index: "NIFTY" })).toBe(false);
    expect(isEmptyFilter({ tag: "theta" })).toBe(false);
  });
});
