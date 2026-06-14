/**
 * RunResult — the self-contained, zod-validated snapshot of ONE backtest run.
 * Everything the results screen needs is captured here so a saved/shared run
 * renders identically forever, independent of the engine version that produced
 * it. The COVERAGE-HONESTY layer is a first-class top-level block — never an
 * afterthought — because honest-about-missing-data is the product's moat.
 *
 * Determinism contract (06-engine-semantics.md §12): the same StrategyDef + the
 * same `dataSnapshotId` + the same `engineVersion` must produce a byte-identical
 * RunResult. Both stamps ride on every run so a result is always reproducible
 * and never silently re-derived.
 *
 * Money is in rupees. Timestamps are epoch-ms (IST minute boundaries). Returns
 * are fractions unless a field name says Pct.
 */

import { z } from "zod";
import { strategyDefSchema } from "./strategy-def";

export const RUN_RESULT_VERSION = 1 as const;

/**
 * Hard upper bounds on the variable-length parts of a RunResult. These are a
 * security cap, not a product limit: a saved run is stored verbatim, so an
 * unbounded array/string is a storage-exhaustion vector. The per-day arrays
 * (equityCurve / tradeReturns / blotter) are capped at MAX_RUN_DAYS — generous
 * for the dataset's 5+ years of trading days (~250/yr) yet finite. monthly
 * returns span at most MAX_RUN_MONTHS, chips/legs/flags are tiny by design.
 */
export const MAX_RUN_DAYS = 1500;
export const MAX_RUN_MONTHS = 240;
export const MAX_QUALITY_CHIPS = 16;
export const MAX_RUN_LEGS = 8;

/** Per-leg, per-cycle strike resolution honesty primitive (requested → served). */
export const strikeResolutionSchema = z.object({
  requested: z.number(),
  served: z.number(),
  /** 0..1 fraction of the session minutes with a real print at the served strike. */
  coverage: z.number().min(0).max(1),
  confidence: z.enum(["high", "medium", "low"]),
  /** How many strike steps we moved from the ideal to find liquidity. */
  fallbackSteps: z.number().int().min(0),
});
export type StrikeResolution = z.infer<typeof strikeResolutionSchema>;

/** The honesty layer — aggregates surfaced as coverage chips on every result. */
export const coverageReportSchema = z.object({
  /** Mean served-strike coverage across all traded legs, 0..1. */
  overall: z.number().min(0).max(1),
  /** Per-leg mean coverage, keyed by leg id. */
  byLeg: z.record(z.string(), z.number().min(0).max(1)),
  /** Days where a leg fell back to a nearer strike (served != requested). */
  substitutions: z.number().int().min(0),
  /** Days flagged low-liquidity (coverage < threshold or zero-volume fills). */
  illiquidDays: z.number().int().min(0),
  /** Days skipped entirely (a required leg had no data → MISSING_LEG). */
  excludedDays: z.number().int().min(0),
  /** Fraction of expected minute-bars that were actually present, 0..1. */
  filledBarFraction: z.number().min(0).max(1),
});
export type CoverageReport = z.infer<typeof coverageReportSchema>;

/**
 * The 6 headline stats, in lead order (R24): Net P&L → Win% → MaxDD →
 * Expectancy → Profit Factor → Sharpe. All derived; tap-to-derive breakdowns
 * are computed on the results screen, not stored here.
 */
export const headlineStatsSchema = z.object({
  netPnl: z.number(),
  winRate: z.number().min(0).max(1),
  maxDrawdown: z.number(), // negative rupees (peak-to-trough)
  expectancy: z.number(), // avg ₹ per trade
  profitFactor: z.number().min(0), // gross profit / gross loss; Infinity → capped large
  sharpe: z.number(),
});
export type HeadlineStats = z.infer<typeof headlineStatsSchema>;

/** A coverage/quality chip shown above the verdict (quiet-by-default, loud-on-problem). */
export const qualityChipSchema = z.object({
  kind: z.enum(["coverage", "liquidity", "substitution", "sample", "slippage", "excluded"]),
  level: z.enum(["good", "warning", "bad"]),
  label: z.string().max(120),
});
export type QualityChip = z.infer<typeof qualityChipSchema>;

export const equityPointSchema = z.object({ ts: z.number().int(), equity: z.number() });
export type EquityPoint = z.infer<typeof equityPointSchema>;

export const monthlyReturnSchema = z.object({
  /** "YYYY-MM". */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  pnl: z.number(),
});
export type MonthlyReturn = z.infer<typeof monthlyReturnSchema>;

/** One booked leg within a trade (day cycle). */
export const bookedLegSchema = z.object({
  legId: z.string(),
  optionType: z.enum(["CE", "PE"]),
  side: z.enum(["buy", "sell"]),
  qty: z.number().int(),
  resolution: strikeResolutionSchema,
  entryPrice: z.number(),
  exitPrice: z.number(),
  gross: z.number(),
  charges: z.number(),
  net: z.number(),
  reentries: z.number().int().min(0),
});
export type BookedLeg = z.infer<typeof bookedLegSchema>;

/** One trade = one trading-day cycle (the AlgoTest convention). */
export const blotterRowSchema = z.object({
  day: z
    .string()
    .max(40)
    .regex(/^\d{4}-\d{2}-\d{2}$/),
  entryTs: z.number().int(),
  exitTs: z.number().int(),
  legs: z.array(bookedLegSchema).max(MAX_RUN_LEGS),
  gross: z.number(),
  charges: z.number(),
  net: z.number(),
  /** True if any leg was substituted to a nearer strike this day. */
  substituted: z.boolean(),
  flags: z.array(z.enum(["COVERAGE", "LOW_LIQUIDITY", "MISSING_LEG"])),
});
export type BlotterRow = z.infer<typeof blotterRowSchema>;

/** Aggregate per-leg realised performance across the run. */
export const perLegStatSchema = z.object({
  legId: z.string(),
  optionType: z.enum(["CE", "PE"]),
  side: z.enum(["buy", "sell"]),
  net: z.number(),
  trades: z.number().int().min(0),
  meanCoverage: z.number().min(0).max(1),
});
export type PerLegStat = z.infer<typeof perLegStatSchema>;

export const tradeReturnSchema = z.object({
  day: z.string().max(40),
  net: z.number(),
});
export type TradeReturn = z.infer<typeof tradeReturnSchema>;

/** The complete, self-contained run snapshot. */
export const runResultSchema = z.object({
  resultVersion: z.literal(RUN_RESULT_VERSION),
  runId: z.string().min(1),
  /** The exact strategy that produced this run (round-trips the input schema). */
  config: strategyDefSchema,
  /** Engine + data provenance — load-bearing for determinism + trust. */
  engineVersion: z.string().min(1),
  dataSnapshotId: z.string().min(1),
  ranAt: z.number().int(),
  coverage: coverageReportSchema,
  stats: headlineStatsSchema,
  qualityChips: z.array(qualityChipSchema).max(MAX_QUALITY_CHIPS),
  equityCurve: z.array(equityPointSchema).max(MAX_RUN_DAYS),
  monthlyReturns: z.array(monthlyReturnSchema).max(MAX_RUN_MONTHS),
  tradeReturns: z.array(tradeReturnSchema).max(MAX_RUN_DAYS),
  blotter: z.array(blotterRowSchema).max(MAX_RUN_DAYS),
  perLeg: z.array(perLegStatSchema).max(MAX_RUN_LEGS),
  /** Aggregated correctness/honesty flags surfaced on the verdict. */
  flags: z.array(z.enum(["COVERAGE", "LOW_LIQUIDITY", "MISSING_LEG"])),
});
export type RunResult = z.infer<typeof runResultSchema>;

export function parseRunResult(input: unknown): RunResult {
  return runResultSchema.parse(input);
}

export function safeParseRunResult(input: unknown) {
  return runResultSchema.safeParse(input);
}

/**
 * Derive the quality chips from a coverage report — the single place the
 * quiet-by-default / loud-on-problem coverage UX is computed. Thresholds match
 * the plan: >=70% coverage = good, 40–69% = warning, <40% = bad.
 */
export function deriveQualityChips(cov: CoverageReport, sampleTrades: number): QualityChip[] {
  const chips: QualityChip[] = [];
  const pct = Math.round(cov.overall * 100);
  const covLevel = cov.overall >= 0.7 ? "good" : cov.overall >= 0.4 ? "warning" : "bad";
  chips.push({ kind: "coverage", level: covLevel, label: `${pct}% data coverage` });
  if (cov.substitutions > 0) {
    chips.push({
      kind: "substitution",
      level: "warning",
      label: `${cov.substitutions} day${cov.substitutions === 1 ? "" : "s"} used a nearer strike`,
    });
  }
  if (cov.illiquidDays > 0) {
    chips.push({
      kind: "liquidity",
      level: "warning",
      label: `${cov.illiquidDays} low-liquidity day${cov.illiquidDays === 1 ? "" : "s"}`,
    });
  }
  if (cov.excludedDays > 0) {
    chips.push({
      kind: "excluded",
      level: "bad",
      label: `${cov.excludedDays} day${cov.excludedDays === 1 ? "" : "s"} skipped (no data)`,
    });
  }
  if (sampleTrades < 30) {
    chips.push({
      kind: "sample",
      level: sampleTrades < 10 ? "bad" : "warning",
      label: `Small sample (${sampleTrades} trade${sampleTrades === 1 ? "" : "s"})`,
    });
  }
  return chips;
}
