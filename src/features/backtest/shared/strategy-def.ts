/**
 * StrategyDef — the versioned, zod-validated data model for a no-code options
 * backtest. THE source of truth: the wizard UI, the engine, save/share and the
 * (future) BYOC "show me the code" export all read/write this one object.
 *
 * Design rules (from 05-no-code-params.md):
 *  - Strike INTENT, not resolved strike — the engine resolves per-entry against
 *    real data and records what it served (the honesty primitive lives in
 *    RunResult, not here).
 *  - Lots, never contracts — qty = lots × LOT_SIZE[index] (instruments.ts).
 *  - Two-axis risk everywhere: unit (% | pts) × basis (premium | underlying).
 *  - Re-entry as plain-language enum presets, never raw AlgoTest jargon.
 *  - Delta strike selection is DEFERRED (D7) — the dataset has no IV/Greeks, so
 *    the discriminated union ships ATM-offset | percent | premium | exact only.
 *  - Execution binds OPT → computeCharges (segment "OPT").
 *
 * Money in rupees (numbers). Times are IST "HH:mm". Dates "YYYY-MM-DD". The
 * schema is forward-compatible: schemaVersion gates migrations, advanced blocks
 * are optional, and parse uses zod defaults so an empty leg is already runnable.
 */

import { z } from "zod";
import { INDEX_SYMBOLS, STRIKE_STEP, type IndexSymbol } from "./instruments";

export const STRATEGY_SCHEMA_VERSION = 1 as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm 24h
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD

export const indexSymbolSchema = z.enum(
  INDEX_SYMBOLS as unknown as [IndexSymbol, ...IndexSymbol[]]
);
export const intervalSchema = z.enum(["1m", "3m", "5m", "15m"]);
export const optionTypeSchema = z.enum(["CE", "PE"]);
export const sideSchema = z.enum(["buy", "sell"]);

const timeStr = z.string().regex(TIME_RE, "Expected HH:mm (IST)");
const dateStr = z.string().regex(DATE_RE, "Expected YYYY-MM-DD");

/**
 * Strike selector — one tabbed UI control → a discriminated union. DELTA is
 * deliberately ABSENT (D7): no IV in the dataset, so a delta selector cannot be
 * honest. Premium is the headline alternative.
 *   ATM_OFFSET steps: 0 = ATM, +n = n strikes OTM, -n = n ITM.
 *   PERCENT pct: signed % from spot (+OTM / -ITM).
 *   PREMIUM target: ₹ premium to match; optional band restricts the search.
 *   EXACT strike: an absolute strike on the index grid.
 */
export const strikeSelectorSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ATM_OFFSET"),
    steps: z.number().int().min(-20).max(20),
  }),
  z.object({
    mode: z.literal("PERCENT"),
    pct: z.number().min(-15).max(15),
  }),
  z.object({
    mode: z.literal("PREMIUM"),
    target: z.number().positive(),
    band: z
      .object({ min: z.number().positive(), max: z.number().positive() })
      .refine((b) => b.min <= b.max, { message: "band.min must be <= band.max" })
      .optional(),
  }),
  z.object({
    mode: z.literal("EXACT"),
    strike: z.number().positive(),
  }),
]);
export type StrikeSelector = z.infer<typeof strikeSelectorSchema>;

/** Two-axis SL/Target trigger: unit (% | pts) × basis (premium | underlying). */
export const riskTriggerSchema = z.object({
  unit: z.enum(["pct", "pts"]),
  basis: z.enum(["premium", "underlying"]),
  value: z.number().positive(),
  /** SL/Tgt reference: actual traded entry fill vs the trigger price. */
  refPrice: z.enum(["traded", "trigger"]).default("traded"),
});
export type RiskTrigger = z.infer<typeof riskTriggerSchema>;

/** Trail X / Trail Y — ratchet the SL by `trailBy` each `trailEvery` favourable move. */
export const trailingStopSchema = z.object({
  unit: z.enum(["pct", "pts"]),
  trailEvery: z.number().positive(),
  trailBy: z.number().positive(),
  toBreakeven: z.boolean().default(false),
});
export type TrailingStop = z.infer<typeof trailingStopSchema>;

/** Re-entry plain-language presets (reversal variants deferred from v1). */
export const reEntryModeSchema = z.enum(["NONE", "RE_ASAP", "RE_COST", "RE_MOMENTUM"]);
export type ReEntryMode = z.infer<typeof reEntryModeSchema>;

export const reEntrySchema = z.object({
  mode: reEntryModeSchema,
  maxCount: z.number().int().min(0).max(5),
  /** "HH:mm" IST — no new re-entry after this time. */
  stopAfter: timeStr.optional(),
  /** Required iff mode === RE_MOMENTUM. */
  momentum: z.object({ unit: z.enum(["pct", "pts"]), value: z.number().positive() }).optional(),
});
export type ReEntry = z.infer<typeof reEntrySchema>;

export const expiryRuleSchema = z.enum(["WEEKLY", "NEXT_WEEKLY", "MONTHLY"]);
export type ExpiryRuleKind = z.infer<typeof expiryRuleSchema>;

/** One option leg: contract intent + its own risk envelope. */
export const legSchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    optionType: optionTypeSchema,
    side: sideSchema,
    lots: z.number().int().min(1).max(100),
    strike: strikeSelectorSchema,
    expiry: expiryRuleSchema.default("WEEKLY"),
    // Per-leg risk (all optional; progressive disclosure).
    stopLoss: riskTriggerSchema.optional(),
    target: riskTriggerSchema.optional(),
    trailingStop: trailingStopSchema.optional(),
    squareOff: z.enum(["partial", "complete"]).default("partial"),
    reEntry: reEntrySchema.optional(),
    entryOffsetMin: z.number().int().min(0).max(360).optional(),
    exitOffsetMin: z.number().int().min(0).max(360).optional(),
  })
  .refine((l) => !(l.trailingStop && !l.stopLoss), {
    message: "trailingStop requires a stopLoss",
    path: ["trailingStop"],
  })
  .refine((l) => !(l.reEntry?.mode === "RE_MOMENTUM" && !l.reEntry.momentum), {
    message: "RE_MOMENTUM requires a momentum threshold",
    path: ["reEntry", "momentum"],
  })
  // The engine (computeRiskLevel) only marks SL/Target off the OPTION PREMIUM —
  // it has no per-bar spot reference, so a basis:"underlying" trigger would be
  // silently computed in premium space (materially wrong). Reject it until
  // spot-referenced stops are implemented. The enum value stays for forward-compat.
  .refine((l) => l.stopLoss?.basis !== "underlying", {
    message: "Underlying-basis stops/targets aren't supported yet — use premium basis.",
    path: ["stopLoss", "basis"],
  })
  .refine((l) => l.target?.basis !== "underlying", {
    message: "Underlying-basis stops/targets aren't supported yet — use premium basis.",
    path: ["target", "basis"],
  });
export type LegDef = z.infer<typeof legSchema>;

/** Strategy-level MTM (overall) risk — evaluated on net MTM each bar. */
export const overallRiskSchema = z.object({
  stopLoss: z.object({ unit: z.enum(["pct", "rupees"]), value: z.number() }).optional(),
  target: z.object({ unit: z.enum(["pct", "rupees"]), value: z.number() }).optional(),
  trailing: z
    .object({
      unit: z.enum(["pct", "rupees"]),
      trailEvery: z.number().positive(),
      trailBy: z.number().positive(),
    })
    .optional(),
  lockAndTrail: z
    .object({ lockMinProfitAt: z.number(), trailMinProfitBy: z.number().positive() })
    .optional(),
  maxLossRupees: z.number().positive().optional(),
  reEntryOnOverall: z.boolean().default(false),
});
export type OverallRisk = z.infer<typeof overallRiskSchema>;

/** Execution / cost model — binds the round-trip to computeCharges (OPT). */
export const executionSchema = z.object({
  broker: z.enum(["zerodha", "upstox", "groww", "angelone", "custom"]).default("zerodha"),
  /** Index options are F&O — MIS intraday vs NRML carry; the engine is intraday v1. */
  product: z.enum(["MIS", "NRML"]).default("MIS"),
  slippage: z.object({ unit: z.enum(["pct", "pts"]), value: z.number().min(0) }),
  fillModel: z.enum(["candle_close", "candle_open", "next_candle_open"]).default("candle_close"),
  applyChargesIntraday: z.boolean().default(false),
  seed: z.number().int().default(0xc0ffee),
});
export type ExecutionConfig = z.infer<typeof executionSchema>;

export const marketConfigSchema = z.object({
  symbol: indexSymbolSchema,
  interval: intervalSchema.default("1m"),
  dateRange: z
    .object({ start: dateStr, end: dateStr })
    .refine((r) => r.start <= r.end, { message: "start must be <= end", path: ["end"] }),
});
export type MarketConfig = z.infer<typeof marketConfigSchema>;

export const timingConfigSchema = z
  .object({
    mode: z.literal("fixed_time").default("fixed_time"),
    entryTime: timeStr.default("09:20"),
    exitTime: timeStr.default("15:15"),
    /** 1..5 = Mon..Fri (omit = all weekdays). */
    daysOfWeek: z.array(z.number().int().min(1).max(5)).optional(),
    /** e.g. [0,1] = expiry day + day-before only. */
    daysFromExpiry: z.array(z.number().int().min(0).max(7)).optional(),
  })
  .refine((t) => t.entryTime < t.exitTime, {
    message: "entryTime must be before exitTime",
    path: ["exitTime"],
  });
export type TimingConfig = z.infer<typeof timingConfigSchema>;

/** The complete no-code strategy. legs[1..8]; everything else has a default. */
export const strategyDefSchema = z.object({
  schemaVersion: z.literal(STRATEGY_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(12).optional(),
  market: marketConfigSchema,
  legs: z.array(legSchema).min(1, "Add at least one leg").max(8, "At most 8 legs"),
  timing: timingConfigSchema,
  risk: overallRiskSchema.default({ reEntryOnOverall: false }),
  execution: executionSchema,
  meta: z
    .object({
      createdAt: z.string(),
      updatedAt: z.string(),
      templateId: z.string().optional(),
      builderMode: z.enum(["wizard", "advanced"]).default("wizard"),
    })
    .optional(),
});
export type StrategyDef = z.infer<typeof strategyDefSchema>;

/** Parse + fully validate an unknown value into a StrategyDef (throws on error). */
export function parseStrategyDef(input: unknown): StrategyDef {
  return strategyDefSchema.parse(input);
}

/** Safe parse — returns the zod result without throwing. */
export function safeParseStrategyDef(input: unknown) {
  return strategyDefSchema.safeParse(input);
}

/** Validate the EXACT-strike grid constraint (cannot live inside the union refine
 * because it needs the index). Returns an error message or null. */
export function validateExactStrike(index: IndexSymbol, leg: LegDef): string | null {
  if (leg.strike.mode !== "EXACT") return null;
  const step = STRIKE_STEP[index];
  if (!Number.isInteger(leg.strike.strike / step)) {
    return `Strike must be a multiple of ${step} for ${index}`;
  }
  return null;
}

/** A minimal runnable strategy used as the builder's blank slate / test factory. */
export function makeDefaultStrategy(id: string, index: IndexSymbol = "NIFTY"): StrategyDef {
  const now = new Date().toISOString().slice(0, 10);
  return {
    schemaVersion: STRATEGY_SCHEMA_VERSION,
    id,
    name: "Untitled strategy",
    market: { symbol: index, interval: "1m", dateRange: { start: now, end: now } },
    legs: [
      {
        id: `${id}-leg1`,
        enabled: true,
        optionType: "PE",
        side: "sell",
        lots: 1,
        strike: { mode: "ATM_OFFSET", steps: 0 },
        expiry: "WEEKLY",
        squareOff: "partial",
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
  };
}
