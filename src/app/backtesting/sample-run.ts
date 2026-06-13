/**
 * PRE-BAKED static sample backtest result for the landing "Run this" on-ramp.
 *
 * This is a hand-authored, illustrative RunResult — NOT a live computation. It
 * lets a first-time visitor see a beautiful, honest result instantly, with zero
 * WASM boot and $0 cost (UX Priority 1: the landing never triggers the engine).
 * It is clearly labelled a sample in the UI. The shape is the real RunResult
 * schema so the same result card can render both this and live runs.
 *
 * Strategy: a NIFTY 09:20 short ATM straddle, weekly expiry, 3-month window —
 * the canonical hot path. Numbers are plausible illustrative figures, marked
 * "Sample" so they are never mistaken for a guaranteed edge.
 */

import type { RunResult } from "@/features/backtest/shared";

export const SAMPLE_RUN: RunResult = {
  resultVersion: 1,
  runId: "sample-nifty-straddle",
  engineVersion: "1.0.0",
  dataSnapshotId: "sample",
  ranAt: 0,
  config: {
    schemaVersion: 1,
    id: "sample-nifty-straddle",
    name: "NIFTY 9:20 short straddle",
    market: {
      symbol: "NIFTY",
      interval: "1m",
      dateRange: { start: "2024-01-01", end: "2024-03-28" },
    },
    legs: [
      {
        id: "ce",
        enabled: true,
        optionType: "CE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
        stopLoss: { unit: "pct", basis: "premium", value: 40, refPrice: "traded" },
      },
      {
        id: "pe",
        enabled: true,
        optionType: "PE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
        stopLoss: { unit: "pct", basis: "premium", value: 40, refPrice: "traded" },
      },
    ],
    timing: { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
    risk: { reEntryOnOverall: false },
    execution: {
      broker: "zerodha",
      product: "MIS",
      slippage: { unit: "pct", value: 0.5 },
      fillModel: "candle_close",
      applyChargesIntraday: false,
      seed: 0xc0ffee,
    },
  },
  coverage: {
    overall: 0.86,
    byLeg: { ce: 0.88, pe: 0.84 },
    substitutions: 3,
    illiquidDays: 1,
    excludedDays: 0,
    filledBarFraction: 0.93,
  },
  stats: {
    netPnl: 41250,
    winRate: 0.63,
    maxDrawdown: -18400,
    expectancy: 695,
    profitFactor: 1.74,
    sharpe: 1.28,
  },
  qualityChips: [
    { kind: "coverage", level: "good", label: "86% data coverage" },
    { kind: "substitution", level: "warning", label: "3 days used a nearer strike" },
    { kind: "liquidity", level: "warning", label: "1 low-liquidity day" },
  ],
  // 13 weekly points — a gently rising sample equity curve.
  equityCurve: [
    { ts: 1704067200000, equity: 0 },
    { ts: 1704672000000, equity: 4200 },
    { ts: 1705276800000, equity: 3100 },
    { ts: 1705881600000, equity: 8900 },
    { ts: 1706486400000, equity: 12400 },
    { ts: 1707091200000, equity: 9800 },
    { ts: 1707696000000, equity: 16100 },
    { ts: 1708300800000, equity: 21300 },
    { ts: 1708905600000, equity: 19000 },
    { ts: 1709510400000, equity: 27600 },
    { ts: 1710115200000, equity: 33200 },
    { ts: 1710720000000, equity: 36800 },
    { ts: 1711324800000, equity: 41250 },
  ],
  monthlyReturns: [
    { month: "2024-01", pnl: 12400 },
    { month: "2024-02", pnl: 13900 },
    { month: "2024-03", pnl: 14950 },
  ],
  tradeReturns: [
    { day: "2024-01-04", net: 2100 },
    { day: "2024-01-11", net: -1500 },
    { day: "2024-01-18", net: 3300 },
    { day: "2024-02-01", net: 1800 },
    { day: "2024-02-15", net: -2200 },
    { day: "2024-03-07", net: 4100 },
  ],
  blotter: [
    {
      day: "2024-01-04",
      entryTs: 1704335400000,
      exitTs: 1704356100000,
      legs: [
        {
          legId: "ce",
          optionType: "CE",
          side: "sell",
          qty: 75,
          resolution: {
            requested: 21700,
            served: 21700,
            coverage: 0.9,
            confidence: "high",
            fallbackSteps: 0,
          },
          entryPrice: 95,
          exitPrice: 62,
          gross: 2475,
          charges: 70,
          net: 2405,
          reentries: 0,
        },
        {
          legId: "pe",
          optionType: "PE",
          side: "sell",
          qty: 75,
          resolution: {
            requested: 21700,
            served: 21650,
            coverage: 0.55,
            confidence: "medium",
            fallbackSteps: 1,
          },
          entryPrice: 88,
          exitPrice: 92,
          gross: -300,
          charges: 65,
          net: -365,
          reentries: 0,
        },
      ],
      gross: 2175,
      charges: 135,
      net: 2040,
      substituted: true,
      flags: ["COVERAGE"],
    },
  ],
  perLeg: [
    { legId: "ce", optionType: "CE", side: "sell", net: 23800, trades: 13, meanCoverage: 0.88 },
    { legId: "pe", optionType: "PE", side: "sell", net: 17450, trades: 13, meanCoverage: 0.84 },
  ],
  flags: ["COVERAGE", "LOW_LIQUIDITY"],
};
