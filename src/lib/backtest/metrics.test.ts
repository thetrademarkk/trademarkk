/**
 * metrics.ts unit tests — every ratio checked against a HAND-COMPUTED series so
 * the formulas (and their annualization) are pinned, not just "self-consistent".
 */

import { describe, expect, it } from "vitest";
import {
  computeMetrics,
  downsideDeviation,
  maxDrawdownWithDuration,
  mean,
  stddev,
  TRADING_DAYS_PER_YEAR,
  type DailyReturn,
} from "./metrics";

const d = (day: string, net: number, extra: Partial<DailyReturn> = {}): DailyReturn => ({
  day,
  net,
  ...extra,
});

describe("metrics — primitives", () => {
  it("mean and sample stddev match hand computation", () => {
    const xs = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(xs)).toBe(5);
    // sample variance (n-1): Σ(x-5)^2 = 9+1+1+1+0+0+4+16 = 32; /7 = 4.571...; √ ≈ 2.138
    expect(stddev(xs)).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });

  it("downside deviation uses only negative deviations from 0", () => {
    const xs = [10, -10, 20, -20];
    // negatives: -10, -20 → squares 100,400 = 500; /(4-1) = 166.67; √ ≈ 12.910
    expect(downsideDeviation(xs, 0)).toBeCloseTo(Math.sqrt(500 / 3), 10);
  });

  it("stddev of <2 points is 0", () => {
    expect(stddev([5])).toBe(0);
    expect(stddev([])).toBe(0);
  });
});

describe("metrics — max drawdown + duration", () => {
  it("computes peak-to-trough drawdown and its duration in days", () => {
    // equity: +100, +50(=150 peak), -80(=70), -20(=50 trough), +120(=170 recover)
    const daily = [d("d1", 100), d("d2", 50), d("d3", -80), d("d4", -20), d("d5", 120)];
    const { maxDrawdown, durationDays } = maxDrawdownWithDuration(daily);
    // peak 150 at idx1 → trough 50 at idx3 → dd = 50-150 = -100.
    expect(maxDrawdown).toBe(-100);
    // peak idx1 → recovery first ≥150 at idx4 → duration = 4-1 = 3 days.
    expect(durationDays).toBe(3);
  });

  it("no drawdown when equity only rises", () => {
    const { maxDrawdown, durationDays } = maxDrawdownWithDuration([d("a", 10), d("b", 20)]);
    expect(maxDrawdown).toBe(0);
    expect(durationDays).toBe(0);
  });
});

describe("metrics — ratios", () => {
  it("Sharpe = mean/σ × √252; Sortino, Calmar, MAR hand-checked", () => {
    const nets = [100, -50, 100, -50, 100]; // mean 40
    const daily = nets.map((n, i) => d(`d${i}`, n));
    const m = computeMetrics(daily);
    const mu = 40;
    const sd = stddev(nets);
    const dd = downsideDeviation(nets, 0);
    expect(m.meanDailyReturn).toBe(40);
    expect(m.totalNet).toBe(200);
    expect(m.sharpe).toBeCloseTo((mu / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR), 3);
    expect(m.sortino).toBeCloseTo((mu / dd) * Math.sqrt(TRADING_DAYS_PER_YEAR), 3);
    // equity path: 100,50,150,100,200 → peak 150 then 100 → dd = -50.
    expect(m.maxDrawdown).toBe(-50);
    const annRet = mu * TRADING_DAYS_PER_YEAR;
    expect(m.calmar).toBeCloseTo(annRet / 50, 3);
    expect(m.mar).toBeCloseTo(200 / 50, 3);
  });

  it("zero-variance series → finite zero ratios (never NaN/Infinity)", () => {
    const daily = [d("a", 10), d("b", 10), d("c", 10)];
    const m = computeMetrics(daily);
    expect(m.sharpe).toBe(0); // σ = 0
    expect(m.sortino).toBe(0); // no downside
    expect(m.calmar).toBe(0); // no drawdown
    expect(m.mar).toBe(0);
    expect(Number.isFinite(m.profitFactor)).toBe(true);
  });

  it("win rate, profit factor, expectancy match the series", () => {
    const daily = [d("a", 30), d("b", -10), d("c", 20), d("d", -40)];
    const m = computeMetrics(daily);
    expect(m.winRate).toBe(0.5); // 2 of 4 days positive
    expect(m.profitFactor).toBeCloseTo(50 / 50, 6); // wins 50, losses 50
    expect(m.expectancy).toBe(0); // (30-10+20-40)/4 = 0
  });

  it("profit factor caps large (not Infinity) when there are no losing days", () => {
    const m = computeMetrics([d("a", 10), d("b", 20)]);
    expect(m.profitFactor).toBe(9999);
  });

  it("exposure = in-position minutes / available minutes", () => {
    const daily = [d("a", 0, { inPositionMinutes: 180 }), d("b", 0, { inPositionMinutes: 180 })];
    const m = computeMetrics(daily, 360);
    expect(m.exposure).toBe(0.5); // 360 / 720
  });

  it("turnover sums per-day notional", () => {
    const daily = [d("a", 0, { turnover: 100000 }), d("b", 0, { turnover: 50000 })];
    expect(computeMetrics(daily).turnover).toBe(150000);
  });

  it("empty series → all-zero metrics", () => {
    const m = computeMetrics([]);
    expect(m.totalNet).toBe(0);
    expect(m.sharpe).toBe(0);
    expect(m.maxDrawdown).toBe(0);
    expect(m.winRate).toBe(0);
  });
});
