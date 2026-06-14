/**
 * PRE-BAKED static sample backtest result for the landing "Run this" on-ramp.
 *
 * This is a hand-authored, illustrative RunResult — NOT a live computation. It
 * lets a first-time visitor see a beautiful, honest result instantly, with zero
 * WASM boot and $0 cost (UX Priority 1: the landing never triggers the engine).
 * It is clearly labelled a sample in the UI. The shape is the real RunResult
 * schema so the same result card AND the full RunResultReport (incl. the BT-11
 * robustness/walk-forward tab) can render both this and live runs.
 *
 * Strategy: a NIFTY 09:20 short ATM straddle, weekly expiry, ~3-month window —
 * the canonical hot path. The blotter is a DETERMINISTIC ~60 trade-day series
 * (generated below from a fixed seed) so the robustness layer is meaningful: the
 * walk-forward split has enough folds and the Monte-Carlo resampling clears its
 * MIN_TRADES gate — letting the sample showcase the honesty rigor layer without
 * an engine boot. Numbers are plausible illustrative figures, marked "Sample" so
 * they are never mistaken for a guaranteed edge.
 */

import type {
  BlotterRow,
  EquityPoint,
  MonthlyReturn,
  RunResult,
  TradeReturn,
} from "@/features/backtest/shared";
import { mulberry32 } from "@/lib/montecarlo/simulate";

/** A NIFTY trading-day spine across Jan–Mar 2024 (skips weekends; ~60 days). */
function tradingDaySpine(): string[] {
  const days: string[] = [];
  const start = new Date(Date.UTC(2024, 0, 1));
  const end = new Date(Date.UTC(2024, 2, 28));
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // weekends
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Build the deterministic sample blotter. A short straddle wins most days
 * (premium decay) with occasional sharp losses; we deliberately make the LATER
 * (out-of-sample) stretch a touch weaker so the walk-forward tab honestly reads
 * "softened out-of-sample" — an illustrative, descriptive outcome.
 */
function buildSample(): {
  blotter: BlotterRow[];
  tradeReturns: TradeReturn[];
  equityCurve: EquityPoint[];
  monthlyReturns: MonthlyReturn[];
  netPnl: number;
  wins: number;
} {
  const days = tradingDaySpine();
  const rand = mulberry32(0xc0ffee);
  const blotter: BlotterRow[] = [];
  const tradeReturns: TradeReturn[] = [];
  const equityCurve: EquityPoint[] = [{ ts: Date.parse(days[0]! + "T03:45:00Z"), equity: 0 }];
  const monthly = new Map<string, number>();
  let equity = 0;
  let wins = 0;

  days.forEach((day, i) => {
    // Later third drifts weaker (mild OOS degradation) for an honest illustration.
    const lateFactor = i > days.length * 0.66 ? 0.55 : 1;
    const r = rand();
    // ~70% small wins, ~30% losses (some sharp) — scaled to plausible ₹ for 1 lot.
    let net: number;
    if (r < 0.7) net = Math.round((600 + rand() * 1400) * lateFactor);
    else net = -Math.round((900 + rand() * 3200) * lateFactor);
    if (net > 0) wins++;

    const ts = Date.parse(day + "T03:50:00Z");
    const exitTs = Date.parse(day + "T09:45:00Z");
    const entryPrice = 90 + Math.round(rand() * 20);
    const exitPrice = Math.max(0.05, Math.round((entryPrice - net / 75) * 100) / 100);
    blotter.push({
      day,
      entryTs: ts,
      exitTs,
      legs: [
        {
          legId: "ce",
          optionType: "CE",
          side: "sell",
          qty: 75,
          resolution: {
            requested: 21700,
            served: 21700,
            coverage: 0.86 + rand() * 0.12,
            confidence: "high",
            fallbackSteps: 0,
          },
          entryPrice,
          exitPrice,
          gross: Math.round(net / 2 + 35),
          charges: 35,
          net: Math.round(net / 2),
          reentries: 0,
        },
        {
          legId: "pe",
          optionType: "PE",
          side: "sell",
          qty: 75,
          resolution: {
            requested: 21700,
            served: 21700,
            coverage: 0.82 + rand() * 0.12,
            confidence: "high",
            fallbackSteps: 0,
          },
          entryPrice,
          exitPrice,
          gross: net - Math.round(net / 2) + 35,
          charges: 35,
          net: net - Math.round(net / 2),
          reentries: 0,
        },
      ],
      gross: net + 70,
      charges: 70,
      net,
      substituted: false,
      flags: [],
    });

    equity = Math.round((equity + net) * 100) / 100;
    equityCurve.push({ ts: exitTs, equity });
    tradeReturns.push({ day, net });
    const ym = day.slice(0, 7);
    monthly.set(ym, (monthly.get(ym) ?? 0) + net);
  });

  const netPnl = equity;
  const monthlyReturns: MonthlyReturn[] = [...monthly.entries()]
    .map(([month, pnl]) => ({ month, pnl }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  return { blotter, tradeReturns, equityCurve, monthlyReturns, netPnl, wins };
}

const sample = buildSample();
const tradeCount = sample.blotter.length;

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
    netPnl: sample.netPnl,
    winRate: Math.round((sample.wins / tradeCount) * 100) / 100,
    maxDrawdown: -18400,
    expectancy: Math.round(sample.netPnl / tradeCount),
    profitFactor: 1.74,
    sharpe: 1.28,
  },
  qualityChips: [
    { kind: "coverage", level: "good", label: "86% data coverage" },
    { kind: "substitution", level: "warning", label: "3 days used a nearer strike" },
    { kind: "liquidity", level: "warning", label: "1 low-liquidity day" },
  ],
  equityCurve: sample.equityCurve,
  monthlyReturns: sample.monthlyReturns,
  tradeReturns: sample.tradeReturns,
  blotter: sample.blotter,
  perLeg: [
    {
      legId: "ce",
      optionType: "CE",
      side: "sell",
      net: Math.round(sample.netPnl * 0.55),
      trades: tradeCount,
      meanCoverage: 0.88,
    },
    {
      legId: "pe",
      optionType: "PE",
      side: "sell",
      net: Math.round(sample.netPnl * 0.45),
      trades: tradeCount,
      meanCoverage: 0.84,
    },
  ],
  flags: ["COVERAGE", "LOW_LIQUIDITY"],
};
