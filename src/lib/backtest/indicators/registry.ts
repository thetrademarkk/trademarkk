/**
 * Indicator registry — the single typed catalogue of indicators.
 *
 * Category files (./trend, ./momentum, ./volatility, ./volume, ./directional,
 * ./statistical) each export an array of `IndicatorDef`. `index.ts` aggregates
 * those arrays and calls `registerAll`. Category agents ONLY add/extend their
 * own file and append to the registry via that array — they never edit the
 * registry or index plumbing.
 *
 * Pure & dependency-free: the params schema is described declaratively (no zod
 * here, to keep this library dependency-free per the design doc). The registry
 * stores the description so the builder UI and the engine read ONE source of
 * truth for available indicators and their parameters.
 */

import type { IndicatorResult, OHLCV } from "./types";

/** Broad grouping used by the builder UI and docs. */
export type IndicatorCategory =
  | "trend"
  | "momentum"
  | "volatility"
  | "volume"
  | "directional"
  | "statistical";

/** What series an indicator consumes. "close" is the default scalar input. */
export type IndicatorInput = "close" | "open" | "high" | "low" | "volume" | "ohlcv";

/** A single declarative parameter (kept primitive — no external schema dep). */
export interface ParamSpec {
  /** Param key, e.g. "period". */
  key: string;
  /** Human label for the UI. */
  label: string;
  type: "int" | "float";
  /** Default value. */
  default: number;
  min?: number;
  max?: number;
}

/**
 * One indicator definition. `compute` is the pure batch form over an OHLCV
 * array (so multi-input indicators work uniformly); single-output indicators
 * return a flat array, multi-output return a record of named series. The
 * params object is validated by the caller against `params` before calling.
 */
export interface IndicatorDef {
  /** Stable unique id, e.g. "sma", "rsi", "macd". */
  id: string;
  /** Display label, e.g. "Simple Moving Average". */
  label: string;
  category: IndicatorCategory;
  /** Primary input series the indicator reads. */
  inputs: IndicatorInput[];
  /** Declarative parameter schema. */
  params: ParamSpec[];
  /** Reference the golden vector is asserted against (for docs/provenance). */
  reference: string;
  /**
   * Pure batch compute. Receives the full OHLCV series and the resolved params;
   * returns one aligned series, or a record of aligned series for multi-output
   * indicators (MACD, Bollinger, etc.). NaN during warmup; never looks ahead.
   */
  compute: (
    bars: readonly OHLCV[],
    params: Record<string, number>
  ) => IndicatorResult | Record<string, IndicatorResult>;
}

const REGISTRY = new Map<string, IndicatorDef>();

/** Register one indicator. Throws on duplicate id (catches copy-paste bugs). */
export function register(def: IndicatorDef): void {
  if (REGISTRY.has(def.id)) {
    throw new Error(`Indicator id "${def.id}" is already registered`);
  }
  REGISTRY.set(def.id, def);
}

/** Register a batch of indicators (what category files pass up through index.ts). */
export function registerAll(defs: readonly IndicatorDef[]): void {
  for (const def of defs) register(def);
}

/** Look up one indicator by id. */
export function getIndicator(id: string): IndicatorDef | undefined {
  return REGISTRY.get(id);
}

/** All registered indicators (insertion order). */
export function listIndicators(): IndicatorDef[] {
  return [...REGISTRY.values()];
}

/** Indicators in one category. */
export function listByCategory(category: IndicatorCategory): IndicatorDef[] {
  return listIndicators().filter((d) => d.category === category);
}

/** Reset the registry — test-only helper to keep suites isolated. */
export function __resetRegistry(): void {
  REGISTRY.clear();
}
