/**
 * Estimate chain — the pure, client-side preview chain that powers BOTH the
 * interactive strike ladder AND the live payoff rail in the no-code builder.
 *
 * The builder runs anonymous-first with NO network and NO duckdb-wasm (that is
 * the BT-08 data layer). So before a run we cannot know real per-day option
 * prices. To make the ladder tactile and the payoff diagram meaningful we build
 * a CLOSED-FORM estimate chain from a representative spot:
 *
 *   - strikes are the real index grid (STRIKE_STEP) around ATM, ±range rungs;
 *   - each rung carries an ESTIMATE of the entry premium (a smooth, monotone
 *     intrinsic+time-value proxy — clearly an estimate, never presented as a
 *     real fill) and a coverage pip in [0,1];
 *   - rungs with coverage below a floor are flagged so the UI can dim them.
 *
 * Honesty: premiums and coverage here are ESTIMATES for selection only. The real
 * engine resolves strikes + prices against actual data at run time and records
 * what it served (the RunResult coverage layer). This module is deliberately
 * deterministic so the ladder and the rail never flicker.
 *
 * Delta selection is DEFERRED (D7 — the dataset has no IV/Greeks), so no rung
 * carries a delta and there is no delta mode anywhere.
 */

import { OPTION_TICK, STRIKE_STEP, nearestStrike, type IndexSymbol } from "../shared/instruments";
import type { LegDef, OptionTypeT, StrikeSelector } from "./types";

/** Coverage at or below which a rung is treated as too thin to trade. */
export const COVERAGE_FLOOR = 0.4;

/** One rung of the strike ladder for one option side. */
export interface LadderRung {
  /** Absolute strike on the index grid. */
  strike: number;
  /** Signed ATM offset in strike steps: 0 = ATM, +n OTM, -n ITM. */
  offset: number;
  /** Estimated entry premium (₹/unit), tick-snapped. Money — keep 2dp. */
  premium: number;
  /** Estimated data coverage 0..1 for this strike over the range. */
  coverage: number;
  /** True when coverage ≤ COVERAGE_FLOOR — the UI dims/disables the rung. */
  thin: boolean;
  /** True when this rung is exactly the ATM strike. */
  isAtm: boolean;
}

/** A representative chain used purely for the live preview + ladder. */
export interface EstimateChain {
  index: IndexSymbol;
  /** Representative spot the rungs are centred on. */
  spot: number;
  /** The ATM strike (nearest grid strike to spot). */
  atm: number;
}

/** Default rungs each side of ATM shown in the ladder. */
export const LADDER_RANGE = 5;

/**
 * Build a representative estimate chain for an index. `spot` defaults to a
 * sensible recent level per index so the very first build is never empty; the
 * caller may pass a known spot (e.g. from a template).
 */
export function makeEstimateChain(index: IndexSymbol, spot?: number): EstimateChain {
  const s = spot ?? DEFAULT_SPOT[index];
  return { index, spot: s, atm: nearestStrike(index, s) };
}

/** Reasonable spot levels (dataset-era) so the preview is plausible per index. */
const DEFAULT_SPOT: Record<IndexSymbol, number> = {
  NIFTY: 24500,
  BANKNIFTY: 52000,
  SENSEX: 80000,
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const snapTick = (n: number) => round2(Math.round(n / OPTION_TICK) * OPTION_TICK);

/**
 * Estimate an option premium at a strike for the preview. Closed-form proxy:
 *   premium = intrinsic + timeValue, where timeValue decays smoothly with
 *   |strike − spot| (a bell around ATM). Floored at one tick. This is a
 *   SELECTION ESTIMATE only — never a real fill.
 */
export function estimatePremium(
  index: IndexSymbol,
  type: OptionTypeT,
  strike: number,
  spot: number
): number {
  const step = STRIKE_STEP[index];
  const intrinsic = type === "CE" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  // Time value ~ a fraction of spot, decaying with moneyness distance in steps.
  const distSteps = Math.abs(strike - spot) / step;
  const atmTimeValue = spot * 0.006; // ~0.6% of spot at ATM (plausible weekly)
  const timeValue = atmTimeValue * Math.exp(-(distSteps * distSteps) / 18);
  return Math.max(OPTION_TICK, snapTick(intrinsic + timeValue));
}

/**
 * Estimate coverage 0..1 for a strike. Deterministic, monotone-ish: highest at
 * ATM, decaying outward, with the index's overall data quality folded in
 * (SENSEX worst). Far OTM/ITM rungs fall below COVERAGE_FLOOR so the ladder can
 * honestly dim them. Pure function of (index, offset).
 */
export function estimateCoverage(index: IndexSymbol, offset: number): number {
  const base = INDEX_COVERAGE_BASE[index];
  const dist = Math.abs(offset);
  // Smooth decay; subtract a small deterministic per-offset wobble so the
  // ladder shows a realistic patchy edge rather than a clean curve.
  const decay = base - dist * 0.06 - (dist >= 4 ? 0.12 : 0);
  const wobble = ((offset * 7) % 5) / 100; // deterministic ±, no RNG
  return clamp01(round2(decay - Math.abs(wobble)));
}

/** Per-index coverage ceiling at ATM (the honesty layer's starting point). */
const INDEX_COVERAGE_BASE: Record<IndexSymbol, number> = {
  NIFTY: 0.98,
  BANKNIFTY: 0.92,
  SENSEX: 0.74,
};

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Build the ladder rungs for one option side around ATM. `range` rungs each
 * side. Pure — drives the keyboard-navigable listbox ladder.
 */
export function buildLadder(
  chain: EstimateChain,
  type: OptionTypeT,
  range: number = LADDER_RANGE
): LadderRung[] {
  const step = STRIKE_STEP[chain.index];
  const rungs: LadderRung[] = [];
  for (let offset = -range; offset <= range; offset++) {
    const strike = chain.atm + offset * step;
    if (strike <= 0) continue;
    const premium = estimatePremium(chain.index, type, strike, chain.spot);
    const coverage = estimateCoverage(chain.index, offset);
    rungs.push({
      strike,
      offset,
      premium,
      coverage,
      thin: coverage <= COVERAGE_FLOOR,
      isAtm: offset === 0,
    });
  }
  return rungs;
}

/**
 * Resolve a leg's strike INTENT to an absolute strike on the estimate chain,
 * for the live preview only. Mirrors the engine's ideal-strike logic (atm/pct/
 * exact) but does NOT walk the fallback ladder (the engine owns that at run
 * time). Premium intent picks the rung whose estimated premium is closest.
 */
export function resolveIntentStrike(
  index: IndexSymbol,
  type: OptionTypeT,
  selector: StrikeSelector,
  chain: EstimateChain
): number | null {
  const step = STRIKE_STEP[index];
  switch (selector.mode) {
    case "ATM_OFFSET":
      return chain.atm + selector.steps * step;
    case "PERCENT": {
      const raw = chain.spot * (1 + selector.pct / 100);
      return Math.round(raw / step) * step;
    }
    case "EXACT":
      return selector.strike;
    case "PREMIUM": {
      // Pick the strike on a wide ladder whose estimated premium is closest.
      const rungs = buildLadder(chain, type, 12);
      let best: LadderRung | null = null;
      let bestDiff = Infinity;
      for (const r of rungs) {
        const diff = Math.abs(r.premium - selector.target);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = r;
        }
      }
      return best ? best.strike : null;
    }
  }
}

/**
 * Resolve a leg to {strike, premium} for the payoff preview. Returns null when
 * the strike can't be resolved (e.g. premium target with an empty chain).
 */
export function estimateLegStrikeAndPremium(
  index: IndexSymbol,
  leg: LegDef,
  chain: EstimateChain
): { strike: number; premium: number } | null {
  const strike = resolveIntentStrike(index, leg.optionType, leg.strike, chain);
  if (strike === null || !Number.isFinite(strike) || strike <= 0) return null;
  const premium = estimatePremium(index, leg.optionType, strike, chain.spot);
  return { strike, premium };
}
