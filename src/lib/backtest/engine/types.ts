/**
 * Engine-internal types — the pure, source-agnostic vocabulary the bar-replay
 * engine speaks. These are DISTINCT from the BT-02 shared models
 * (StrategyDef / RunResult): the engine CONSUMES a StrategyDef and PRODUCES a
 * RunResult, but internally it iterates `Bar`s in integer epoch-ms and books
 * trades through `computeCharges` (never re-implemented).
 *
 * Spec: docs/backtesting/06-engine-semantics.md §1–§12. engineVersion 1.0.0.
 *
 * Time base: IST (Asia/Kolkata, UTC+5:30, no DST). All timestamps are integer
 * epoch-ms at IST minute boundaries (left-labelled bars). Money is in rupees;
 * round ONLY at booking (the same r2 discipline charges.ts uses).
 */

/** engineVersion anchor — stamped on every RunResult for reproducibility. */
export const ENGINE_VERSION = "1.0.0" as const;

/** Default determinism seed (matches StrategyDef.execution.seed default). */
export const DEFAULT_SEED = 0xc0ffee;

/** Session minute-of-day reference points (06-engine-semantics §1.1). */
export const SESSION_OPEN_MIN = 555; // 09:15
export const EOD_SQUAREOFF_MIN = 929; // 15:29 — hard cap, leaves 1 min of liquidity
export const SESSION_CLOSE_MIN = 930; // 15:30 — engine never trades this bar
export const SESSION_MINUTES = 375; // 09:15..15:30

/** Hard caps so a runaway config can never lock a worker (§10.4). */
export const MAX_TRADING_DAYS = 1500;
export const MAX_LEGS = 8;
export const MAX_REENTRIES = 5;
export const MAX_BARS_PER_DAY = 375;

/** Strike-resolution thresholds (§8). */
export const MIN_COVERAGE = 0.6;
export const MAX_FALLBACK_STEPS = 5;
/**
 * D2 hard-fail CEILING (07-data-layer §7b critique). A nearest-available
 * substitute whose coverage is BELOW this floor is rejected outright
 * (resolveStrike returns null → MISSING_LEG), never a silent confidence:"low"
 * fill. It sits intentionally BELOW ILLIQUID_COVERAGE (0.5): the band
 * [0.2, 0.5) is still a fillable-but-flagged "illiquid" substitute (§3.2 keeps
 * the LOW_LIQUIDITY slippage bump for it); only a near-empty strike (< 0.2,
 * i.e. <20% of the session printed) is treated as un-fillable and hard-failed.
 * Pre-D2 even a coverage-0.1 strike filled silently at confidence "low".
 */
export const MIN_FALLBACK_COVERAGE = 0.2;
/**
 * D2 premium-deviation CEILING (07-data-layer §7b). For premium selection, the
 * chosen strike's entry price must be within this fractional deviation of the
 * target premium (|price − target| / target ≤ this). A "closest" strike that is
 * still wildly off the target (no real strike near the requested premium) is a
 * MISSING_LEG, not a silent fill at an unrelated premium. 0.5 = ±50%.
 */
export const MAX_PREMIUM_DEVIATION = 0.5;
/** Carry-forward cap before a held leg is force-marked stale on square-off (§2). */
export const MAX_STALE_MINUTES = 15;
/** Liquidity-scaled slippage bump for illiquid strikes / zero-volume bars (§3.2, D4). */
export const ILLIQUID_SLIP_MULT = 3;
/** Coverage below which a fill is treated as illiquid (slip bump + LOW_LIQUIDITY). */
export const ILLIQUID_COVERAGE = 0.5;
/** Default median per-minute volume used to scale slippage when the manifest
 *  has no medVol for a strike (BT-08 will inject the real value). */
export const DEFAULT_MED_VOL = 2000;

/** Option tick (₹). Fills snap to this; a fill can never go <= 0. */
export const OPTION_TICK = 0.05;

/** Floating comparison epsilon for strike/price equality (§12.1). */
export const EPS = 1e-6;

export type OptionType = "CE" | "PE";
/** Internal direction (charges/payoff convention). `long` = buy first. */
export type Direction = "long" | "short";

/**
 * A canonical 1-minute OHLCV bar. Left-labelled: a bar at 09:15 covers
 * [09:15:00, 09:16:00) and its close is the price as of 09:16:00.
 */
export interface Bar {
  /** epoch-ms, IST minute boundary (left edge). */
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** contracts traded this minute; 0 ⇒ illiquid this minute. */
  v: number;
  /** open interest (options only). */
  oi?: number;
}

export type Series = Bar[]; // ASCENDING by ts; holes are real (not assumed away)

/** One available option contract for an (index, expiry): identity + coverage. */
export interface ContractMeta {
  strike: number;
  optionType: OptionType;
  /** 0..1 fraction of the session minutes with a real print on the trade day. */
  coverage: number;
  /** Median per-minute volume on the trade day (for liquidity-scaled slippage). */
  medVol: number;
}

/** Strike resolution honesty primitive (mirrors RunResult.strikeResolution). */
export interface StrikeResolution {
  requested: number;
  served: number;
  coverage: number; // 0..1
  confidence: "high" | "medium" | "low";
  fallbackSteps: number;
}

/** Strike-selector intent, in the engine's normalized vocabulary. */
export type StrikeIntent =
  | { kind: "atm"; offset: number }
  | { kind: "pct"; pct: number }
  | { kind: "premium"; target: number; band?: { min: number; max: number } }
  | { kind: "exact"; strike: number };
