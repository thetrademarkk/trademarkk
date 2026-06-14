import { describe, expect, it } from "vitest";
import {
  MIN_SENTIMENT_SAMPLE,
  computeSentimentGauge,
  isSentiment,
  normalizeSentiment,
  parseSentimentWindow,
  sentimentWindowHours,
  type SentimentEvent,
} from "./sentiment";

const ev = (sentiment: "bull" | "bear"): SentimentEvent => ({ sentiment });

describe("normalizeSentiment / isSentiment", () => {
  it("keeps the two known leans", () => {
    expect(normalizeSentiment("bull")).toBe("bull");
    expect(normalizeSentiment("bear")).toBe("bear");
    expect(isSentiment("bull")).toBe(true);
    expect(isSentiment("bear")).toBe(true);
  });

  it("treats NULL / empty / unknown / non-string as no sentiment", () => {
    expect(normalizeSentiment(null)).toBeNull();
    expect(normalizeSentiment(undefined)).toBeNull();
    expect(normalizeSentiment("")).toBeNull();
    expect(normalizeSentiment("neutral")).toBeNull();
    expect(normalizeSentiment("BULL")).toBeNull(); // case-sensitive on purpose
    expect(normalizeSentiment(1)).toBeNull();
    expect(isSentiment("neutral")).toBe(false);
    expect(isSentiment(null)).toBe(false);
  });
});

describe("computeSentimentGauge — percentages", () => {
  it("computes bull/bear percentages that always sum to 100", () => {
    // 2 bull, 1 bear → 67% bullish, 33% bearish (rounded, sum is exactly 100).
    const g = computeSentimentGauge([ev("bull"), ev("bull"), ev("bear")]);
    expect(g.bull).toBe(2);
    expect(g.bear).toBe(1);
    expect(g.total).toBe(3);
    expect(g.bullPct).toBe(67);
    expect(g.bearPct).toBe(33);
    expect(g.bullPct + g.bearPct).toBe(100);
  });

  it("rounds without a gap (e.g. 1 of 3 → 33/67, not 33/33)", () => {
    const g = computeSentimentGauge([ev("bull"), ev("bear"), ev("bear")]);
    expect(g.bullPct).toBe(33);
    expect(g.bearPct).toBe(67);
    expect(g.bullPct + g.bearPct).toBe(100);
  });

  it("is 100/0 for all-bull and 0/100 for all-bear", () => {
    const allBull = computeSentimentGauge([ev("bull"), ev("bull"), ev("bull")]);
    expect(allBull.bullPct).toBe(100);
    expect(allBull.bearPct).toBe(0);
    const allBear = computeSentimentGauge([ev("bear"), ev("bear"), ev("bear")]);
    expect(allBear.bullPct).toBe(0);
    expect(allBear.bearPct).toBe(100);
  });

  it("reads 0/0 for an empty sample (no NaN, no division by zero)", () => {
    const g = computeSentimentGauge([]);
    expect(g.bull).toBe(0);
    expect(g.bear).toBe(0);
    expect(g.total).toBe(0);
    expect(g.bullPct).toBe(0);
    expect(g.bearPct).toBe(0);
    expect(Number.isNaN(g.bullPct)).toBe(false);
  });
});

describe("computeSentimentGauge — min-sample gate", () => {
  it("default gate is MIN_SENTIMENT_SAMPLE (3)", () => {
    expect(MIN_SENTIMENT_SAMPLE).toBe(3);
  });

  it("withholds the signal below the minimum sample", () => {
    expect(computeSentimentGauge([ev("bull")]).hasSignal).toBe(false);
    expect(computeSentimentGauge([ev("bull"), ev("bear")]).hasSignal).toBe(false);
  });

  it("shows the signal once the sample reaches the minimum", () => {
    expect(computeSentimentGauge([ev("bull"), ev("bull"), ev("bear")]).hasSignal).toBe(true);
    expect(computeSentimentGauge([ev("bull"), ev("bull"), ev("bear"), ev("bear")]).hasSignal).toBe(
      true
    );
  });

  it("respects an overridden minSample", () => {
    expect(computeSentimentGauge([ev("bull")], 1).hasSignal).toBe(true);
    expect(computeSentimentGauge([ev("bull"), ev("bull")], 5).hasSignal).toBe(false);
  });
});

describe("window helpers", () => {
  it("maps windows to hours", () => {
    expect(sentimentWindowHours("24h")).toBe(24);
    expect(sentimentWindowHours("7d")).toBe(168);
  });

  it("parses query values, defaulting to 24h", () => {
    expect(parseSentimentWindow("7d")).toBe("7d");
    expect(parseSentimentWindow("24h")).toBe("24h");
    expect(parseSentimentWindow(null)).toBe("24h");
    expect(parseSentimentWindow("garbage")).toBe("24h");
    expect(parseSentimentWindow(undefined)).toBe("24h");
  });
});
