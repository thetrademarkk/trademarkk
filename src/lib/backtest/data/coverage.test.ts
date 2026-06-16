/**
 * coverage.ts unit tests — the confidence formula is checked against a
 * HAND-WORKED example derived term-by-term from the §7d formula (not a value
 * read back from the implementation), and the gap classification thresholds are
 * pinned to the §7c "≤3 LOCF / >3 snap / whole-day excluded" rule.
 */

import { describe, expect, it } from "vitest";
import {
  classifyGap,
  computeConfidence,
  confidenceBand,
  confidenceScore,
  CONFIDENCE_WEIGHTS,
  EXPECTED_BARS_PER_DAY,
  isLocfGap,
  isWholeDayGap,
  MAX_LOCF_GAP_MIN,
} from "./coverage";

describe("confidence — §7d formula, hand-worked", () => {
  it("weights are the verbatim 0.45 / 0.25 / 0.20 / 0.10 from §7d", () => {
    expect(CONFIDENCE_WEIGHTS.avgServedLegCoverage).toBe(0.45);
    expect(CONFIDENCE_WEIGHTS.filledBarComplement).toBe(0.25);
    expect(CONFIDENCE_WEIGHTS.excludedDayComplement).toBe(0.2);
    expect(CONFIDENCE_WEIGHTS.exactStrike).toBe(0.1);
    // The four weights must sum to 1 so a perfect run scores exactly 100.
    expect(
      CONFIDENCE_WEIGHTS.avgServedLegCoverage +
        CONFIDENCE_WEIGHTS.filledBarComplement +
        CONFIDENCE_WEIGHTS.excludedDayComplement +
        CONFIDENCE_WEIGHTS.exactStrike
    ).toBeCloseTo(1, 10);
  });

  it("hand-worked example scores 87 (High)", () => {
    // avgServedLegCoverage=0.90, filledBarFraction=0.10,
    // excludedDayFraction=0.05, exactStrikeFraction=0.50
    //   0.45*0.90              = 0.405
    //   0.25*(1-0.10)=0.25*0.90= 0.225
    //   0.20*(1-0.05)=0.20*0.95= 0.190
    //   0.10*0.50              = 0.050
    //   sum                    = 0.870  → round(100*0.870) = 87
    const inp = {
      avgServedLegCoverage: 0.9,
      filledBarFraction: 0.1,
      excludedDayFraction: 0.05,
      exactStrikeFraction: 0.5,
    };
    expect(confidenceScore(inp)).toBe(87);
    expect(computeConfidence(inp)).toEqual({ score: 87, band: "High" });
  });

  it("a perfect run scores exactly 100", () => {
    expect(
      confidenceScore({
        avgServedLegCoverage: 1,
        filledBarFraction: 0,
        excludedDayFraction: 0,
        exactStrikeFraction: 1,
      })
    ).toBe(100);
  });

  it("the worst possible run scores 0", () => {
    expect(
      confidenceScore({
        avgServedLegCoverage: 0,
        filledBarFraction: 1,
        excludedDayFraction: 1,
        exactStrikeFraction: 0,
      })
    ).toBe(0);
  });

  it("clamps out-of-range inputs into [0,1] (stays finite 0–100)", () => {
    // Junk inputs are clamped: cov 2→1, filled -1→0, excluded 5→1, exact NaN→0.
    //   0.45*1 + 0.25*(1-0) + 0.20*(1-1) + 0.10*0 = 0.45 + 0.25 = 0.70 → 70
    expect(
      confidenceScore({
        avgServedLegCoverage: 2,
        filledBarFraction: -1,
        excludedDayFraction: 5,
        exactStrikeFraction: Number.NaN,
      })
    ).toBe(70);
  });
});

describe("confidence — band thresholds (§7d: ≥80 High, ≥55 Medium, else Low)", () => {
  it("80 is High, 79 is Medium", () => {
    expect(confidenceBand(80)).toBe("High");
    expect(confidenceBand(79)).toBe("Medium");
  });

  it("55 is Medium, 54 is Low", () => {
    expect(confidenceBand(55)).toBe("Medium");
    expect(confidenceBand(54)).toBe("Low");
  });

  it("100 is High and 0 is Low", () => {
    expect(confidenceBand(100)).toBe("High");
    expect(confidenceBand(0)).toBe("Low");
  });
});

describe("gap classification — §7c thresholds", () => {
  it("LOCF threshold N is 3 minutes", () => {
    expect(MAX_LOCF_GAP_MIN).toBe(3);
  });

  it("gaps ≤ 3 min are LOCF-filled", () => {
    expect(classifyGap(1)).toBe("locf");
    expect(classifyGap(3)).toBe("locf");
    // Non-positive "gaps" have nothing to fill → treated as locf.
    expect(classifyGap(0)).toBe("locf");
  });

  it("gaps > 3 min snap to last real bar (no fabrication)", () => {
    expect(classifyGap(4)).toBe("snap");
    expect(classifyGap(30)).toBe("snap");
  });

  it("a whole-day-missing leg is excluded regardless of raw length", () => {
    expect(classifyGap(2, true)).toBe("excluded");
    expect(classifyGap(400, true)).toBe("excluded");
  });

  it("isLocfGap is true only for 1..3 minute gaps", () => {
    expect(isLocfGap(0)).toBe(false);
    expect(isLocfGap(1)).toBe(true);
    expect(isLocfGap(3)).toBe(true);
    expect(isLocfGap(4)).toBe(false);
  });

  it("isWholeDayGap triggers at the full 375-bar session", () => {
    expect(EXPECTED_BARS_PER_DAY).toBe(375);
    expect(isWholeDayGap(374)).toBe(false);
    expect(isWholeDayGap(375)).toBe(true);
    expect(isWholeDayGap(500)).toBe(true);
  });
});
