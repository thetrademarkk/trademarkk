import { describe, it, expect } from "vitest";
import {
  sanitizePlan,
  sanitizePlans,
  planToFormDefaults,
  planRiskReward,
  MAX_PLANS,
  type TradePlan,
} from "./pre-trade-plan";

const plan = (over: Partial<TradePlan> = {}): TradePlan => ({
  id: "1",
  symbol: "BANKNIFTY",
  segment: "OPT",
  product: "NRML",
  direction: "long",
  plannedEntry: 120,
  plannedSl: 100,
  plannedTarget: 180,
  rationale: "Breakout retest.",
  createdAt: "2026-06-13T00:00:00.000Z",
  ...over,
});

describe("sanitizePlan", () => {
  it("uppercases + trims the symbol", () => {
    expect(sanitizePlan({ ...plan(), symbol: "  reliance " })?.symbol).toBe("RELIANCE");
  });
  it("rejects a missing symbol", () => {
    expect(sanitizePlan({ ...plan(), symbol: "" })).toBeNull();
  });
  it("falls back to EQ for an unknown segment", () => {
    expect(sanitizePlan({ ...plan(), segment: "XYZ" })?.segment).toBe("EQ");
  });
  it("forces product valid for the segment (EQ+NRML → first EQ product)", () => {
    const p = sanitizePlan({ ...plan(), segment: "EQ", product: "NRML" });
    expect(p?.product).toBe("MIS"); // first product for EQ
  });
  it("keeps a legal derivative product", () => {
    expect(sanitizePlan({ ...plan(), segment: "FUT", product: "NRML" })?.product).toBe("NRML");
  });
  it("drops non-positive planned levels", () => {
    const p = sanitizePlan({ ...plan(), plannedEntry: -5, plannedSl: 0 });
    expect(p?.plannedEntry).toBeUndefined();
    expect(p?.plannedSl).toBeUndefined();
  });
  it("defaults direction to long for junk", () => {
    expect(sanitizePlan({ ...plan(), direction: "sideways" })?.direction).toBe("long");
  });
});

describe("sanitizePlans", () => {
  it("drops junk", () => {
    expect(sanitizePlans([plan(), null, { symbol: "" }, 7])).toHaveLength(1);
  });
  it("caps at MAX_PLANS", () => {
    const many = Array.from({ length: MAX_PLANS + 5 }, (_, i) => plan({ symbol: `S${i}` }));
    expect(sanitizePlans(many)).toHaveLength(MAX_PLANS);
  });
});

describe("planToFormDefaults", () => {
  it("maps planned_* fields verbatim and seeds avgEntry from planned entry", () => {
    const d = planToFormDefaults(plan());
    expect(d.plannedEntry).toBe(120);
    expect(d.plannedSl).toBe(100);
    expect(d.plannedTarget).toBe(180);
    expect(d.avgEntry).toBe(120); // entry seeded for confirmation on fill
    expect(d.symbol).toBe("BANKNIFTY");
    expect(d.segment).toBe("OPT");
    expect(d.product).toBe("NRML");
    expect(d.direction).toBe("long");
    expect(d.notes).toBe("Breakout retest.");
  });
  it("omits planned fields that are absent", () => {
    const d = planToFormDefaults(plan({ plannedTarget: undefined, plannedSl: undefined }));
    expect("plannedTarget" in d).toBe(false);
    expect("plannedSl" in d).toBe(false);
    expect(d.plannedEntry).toBe(120);
  });
  it("does not set avgEntry when there is no planned entry", () => {
    const d = planToFormDefaults(plan({ plannedEntry: undefined }));
    expect("avgEntry" in d).toBe(false);
  });
});

describe("planRiskReward", () => {
  it("computes R:R from absolute distances (long)", () => {
    expect(planRiskReward(plan())).toBe(3); // (180-120)/(120-100)
  });
  it("computes R:R for a short the same way", () => {
    const rr = planRiskReward(
      plan({ direction: "short", plannedEntry: 100, plannedSl: 110, plannedTarget: 70 })
    );
    expect(rr).toBe(3); // |70-100| / |100-110|
  });
  it("is null when a leg is missing", () => {
    expect(planRiskReward(plan({ plannedTarget: undefined }))).toBeNull();
  });
  it("is null when stop equals entry (zero risk)", () => {
    expect(planRiskReward(plan({ plannedSl: 120 }))).toBeNull();
  });
});
