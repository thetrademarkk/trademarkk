import { describe, expect, it } from "vitest";
import {
  bucketForCoverage,
  COVERAGE_HIGH_MIN,
  COVERAGE_MEDIUM_MIN,
  coverageTooltip,
} from "./coverage-buckets";

describe("bucketForCoverage — thresholds", () => {
  it("buckets >=70% as high (profit tone)", () => {
    const info = bucketForCoverage(0.7);
    expect(info.bucket).toBe("high");
    expect(info.tone).toBe("profit");
    expect(info.percent).toBe(70);
    expect(info.label).toBe("High");
  });

  it("buckets 40-69% as medium (warning tone)", () => {
    expect(bucketForCoverage(0.4).bucket).toBe("medium");
    expect(bucketForCoverage(0.55).bucket).toBe("medium");
    expect(bucketForCoverage(0.699).bucket).toBe("medium");
    expect(bucketForCoverage(0.55).tone).toBe("warning");
  });

  it("buckets <40% as low (loss tone)", () => {
    expect(bucketForCoverage(0.39).bucket).toBe("low");
    expect(bucketForCoverage(0.32).bucket).toBe("low");
    expect(bucketForCoverage(0).bucket).toBe("low");
    expect(bucketForCoverage(0.32).tone).toBe("loss");
  });

  it("uses exact threshold constants at the boundaries", () => {
    expect(bucketForCoverage(COVERAGE_HIGH_MIN).bucket).toBe("high");
    expect(bucketForCoverage(COVERAGE_HIGH_MIN - 0.0001).bucket).toBe("medium");
    expect(bucketForCoverage(COVERAGE_MEDIUM_MIN).bucket).toBe("medium");
    expect(bucketForCoverage(COVERAGE_MEDIUM_MIN - 0.0001).bucket).toBe("low");
  });

  it("clamps out-of-range fractions for display", () => {
    expect(bucketForCoverage(1.5).percent).toBe(100);
    expect(bucketForCoverage(1.5).bucket).toBe("high");
    expect(bucketForCoverage(-0.2).percent).toBe(0);
    expect(bucketForCoverage(-0.2).bucket).toBe("low");
  });

  it("rounds the percent to a whole number", () => {
    expect(bucketForCoverage(0.3243).percent).toBe(32);
    expect(bucketForCoverage(0.5815).percent).toBe(58);
  });
});

describe("bucketForCoverage — absent => honest unknown", () => {
  it("null/undefined => unknown bucket with null fraction/percent", () => {
    for (const v of [null, undefined]) {
      const info = bucketForCoverage(v);
      expect(info.bucket).toBe("unknown");
      expect(info.fraction).toBeNull();
      expect(info.percent).toBeNull();
      expect(info.tone).toBe("muted");
      expect(info.label).toBe("Unknown");
    }
  });

  it("non-finite => unknown (never NaN%)", () => {
    expect(bucketForCoverage(NaN).bucket).toBe("unknown");
    expect(bucketForCoverage(Infinity).bucket).toBe("unknown");
  });
});

describe("coverageTooltip — honest, never profitability", () => {
  it("surfaces a low SENSEX number plainly as partial", () => {
    const tip = coverageTooltip("SENSEX", "in this period", bucketForCoverage(0.32));
    expect(tip).toContain("SENSEX ~32% covered in this period");
    expect(tip.toLowerCase()).toContain("partial");
    expect(tip.toLowerCase()).not.toContain("profit");
  });

  it("is transparent about an unknown number", () => {
    const tip = coverageTooltip("NIFTY", "in this period", bucketForCoverage(null));
    expect(tip.toLowerCase()).toContain("not in the committed manifest");
    expect(tip).not.toContain("%");
  });

  it("for high coverage explicitly states coverage is not a profitability signal", () => {
    const tip = coverageTooltip("NIFTY", "in this period", bucketForCoverage(0.85));
    expect(tip.toLowerCase()).toContain("never a profitability signal");
  });
});
