/**
 * Strike resolution against the AVAILABLE chain — the coverage-honesty
 * differentiator (06-engine-semantics §8). Resolves a StrikeIntent to a strike
 * that actually exists in the dataset, walking outward to find liquidity and
 * recording {requested → served, coverage, confidence, fallbackSteps} so the
 * patchiness is legible, never silent.
 *
 * Pure: takes a chain (strikes + coverage) and the intent; returns a
 * StrikeResolution or null (no usable strike near the target → MISSING_LEG).
 */

import { STRIKE_STEP, type IndexSymbol } from "../../../features/backtest/shared/instruments";
import {
  EPS,
  MAX_FALLBACK_STEPS,
  MAX_PREMIUM_DEVIATION,
  MIN_COVERAGE,
  MIN_FALLBACK_COVERAGE,
  type ContractMeta,
  type OptionType,
  type StrikeIntent,
  type StrikeResolution,
} from "./types";

/** Distinct ascending strikes available for `type` in the chain. */
function strikesFor(chain: ContractMeta[], type: OptionType): ContractMeta[] {
  return chain.filter((c) => c.optionType === type).sort((a, b) => a.strike - b.strike);
}

function coverageOf(contracts: ContractMeta[], strike: number): number {
  const c = contracts.find((x) => Math.abs(x.strike - strike) < EPS);
  return c ? c.coverage : 0;
}

/**
 * Nearest available strike to `spot` among `contracts` (ties → the HIGHER
 * strike, deterministic). Returns null if there are no contracts.
 */
export function nearestAvailableStrike(contracts: ContractMeta[], spot: number): number | null {
  if (contracts.length === 0) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of contracts) {
    const d = Math.abs(c.strike - spot);
    // Strictly closer wins; on a tie prefer the HIGHER strike.
    if (d < bestDist - EPS || (Math.abs(d - bestDist) < EPS && best !== null && c.strike > best)) {
      best = c.strike;
      bestDist = d;
    }
  }
  return best;
}

/** The ATM strike (nearest available, ties → higher) for either side's chain. */
export function atmStrike(chain: ContractMeta[], spot: number): number | null {
  // Use the union of CE+PE strikes (they share the grid); prefer whatever exists.
  const all = [...new Set(chain.map((c) => c.strike))].sort((a, b) => a - b);
  const synthetic: ContractMeta[] = all.map((strike) => ({
    strike,
    optionType: "CE",
    coverage: 1,
    medVol: 0,
  }));
  return nearestAvailableStrike(synthetic, spot);
}

/** Confidence band from how far we fell back and the served coverage. */
function confidenceFor(fallbackSteps: number, coverage: number): StrikeResolution["confidence"] {
  if (fallbackSteps === 0 && coverage >= MIN_COVERAGE) return "high";
  if (coverage >= MIN_COVERAGE) return "medium";
  return "low";
}

/**
 * Resolve a strike intent against the AVAILABLE chain. Implements the §8.3
 * fallback ladder:
 *   1. compute IDEAL strike per the selector,
 *   2. if it exists & coverage ≥ 0.6 → high,
 *   3. else search outward ±step (nearest, ties→higher) within ±5 steps for
 *      coverage ≥ 0.6 → medium,
 *   4. else nearest existing strike — but only if it clears the D2 hard-fail
 *      CEILING (≤ MAX_FALLBACK_STEPS away AND coverage ≥ MIN_FALLBACK_COVERAGE):
 *      → low + LOW_LIQUIDITY. A substitute that is too far OR below the
 *      coverage floor is REJECTED (returns null), never a silent low fill.
 *   5. else → null (MISSING_LEG).
 */
export function resolveStrike(
  index: IndexSymbol,
  chain: ContractMeta[],
  type: OptionType,
  intent: StrikeIntent,
  spot: number
): StrikeResolution | null {
  const step = STRIKE_STEP[index];
  const side = strikesFor(chain, type);
  if (side.length === 0) return null;

  const ideal = idealStrike(index, side, intent, spot);
  if (ideal === null) return null;

  // 2. Ideal exists with good coverage?
  const idealCov = coverageOf(side, ideal);
  const idealExists = side.some((c) => Math.abs(c.strike - ideal) < EPS);
  if (idealExists && idealCov >= MIN_COVERAGE) {
    return {
      requested: ideal,
      served: ideal,
      coverage: idealCov,
      confidence: "high",
      fallbackSteps: 0,
    };
  }

  // 3. Search outward by strike step for the nearest available strike with
  //    coverage ≥ 0.6, within ±MAX_FALLBACK_STEPS. On a tie (k up vs k down),
  //    prefer the HIGHER strike (deterministic).
  for (let k = 1; k <= MAX_FALLBACK_STEPS; k++) {
    const up = ideal + k * step;
    const down = ideal - k * step;
    const upCov = coverageOf(side, up);
    const downCov = coverageOf(side, down);
    const upOk = side.some((c) => Math.abs(c.strike - up) < EPS) && upCov >= MIN_COVERAGE;
    const downOk = side.some((c) => Math.abs(c.strike - down) < EPS) && downCov >= MIN_COVERAGE;
    if (upOk) {
      return {
        requested: ideal,
        served: up,
        coverage: upCov,
        confidence: "medium",
        fallbackSteps: k,
      };
    }
    if (downOk) {
      return {
        requested: ideal,
        served: down,
        coverage: downCov,
        confidence: "medium",
        fallbackSteps: k,
      };
    }
  }

  // 4. Nearest existing strike — but enforce the D2 hard-fail CEILING. A
  //    too-far OR too-illiquid substitute is a MISSING_LEG, NOT a silent
  //    confidence:"low" fill (07-data-layer §7b critique).
  const nearest = nearestAvailableStrike(side, ideal);
  if (nearest !== null) {
    const cov = coverageOf(side, nearest);
    const steps = Math.round(Math.abs(nearest - ideal) / step);
    // CEILING: reject if the only substitute is beyond the fallback window or
    // below the coverage floor — either way it cannot be filled credibly.
    if (steps > MAX_FALLBACK_STEPS || cov < MIN_FALLBACK_COVERAGE) {
      return null;
    }
    return {
      requested: ideal,
      served: nearest,
      coverage: cov,
      confidence: confidenceFor(steps, cov),
      fallbackSteps: steps,
    };
  }

  // 5. No strikes at all near the target → leg cannot resolve.
  return null;
}

/** Compute the IDEAL strike per the selector (pre-fallback), snapped to grid. */
function idealStrike(
  index: IndexSymbol,
  side: ContractMeta[],
  intent: StrikeIntent,
  spot: number
): number | null {
  const step = STRIKE_STEP[index];
  switch (intent.kind) {
    case "exact":
      return intent.strike;
    case "atm": {
      const atm = atmStrike(side, spot);
      if (atm === null) return null;
      return atm + intent.offset * step;
    }
    case "pct": {
      const raw = spot * (1 + intent.pct / 100);
      return Math.round(raw / step) * step;
    }
    case "premium": {
      // Premium selection happens at the entry bar against real option opens;
      // resolveStrike (chain-only) can't see prices, so this branch is handled
      // by resolvePremiumStrike (below) which the engine calls with prices.
      // Fall back to ATM here so a premium intent still resolves to a sane
      // strike when called without prices (defensive).
      const atm = atmStrike(side, spot);
      return atm;
    }
  }
}

/**
 * Premium-based selection (§8.4): given each available strike's entry-bar option
 * price, pick the strike whose price is closest to `target` (tie → lower-risk
 * side, i.e. closer to ATM). Returns a StrikeResolution or null.
 */
export function resolvePremiumStrike(
  index: IndexSymbol,
  chain: ContractMeta[],
  type: OptionType,
  target: number,
  band: { min: number; max: number } | undefined,
  prices: Map<number, number>, // strike → entry-bar option price (open)
  spot: number
): StrikeResolution | null {
  const side = strikesFor(chain, type);
  if (side.length === 0) return null;
  const atm = atmStrike(side, spot) ?? spot;

  let best: { strike: number; coverage: number; diff: number } | null = null;
  let bestScore = Infinity;
  for (const c of side) {
    const px = prices.get(c.strike);
    if (px === undefined) continue;
    if (band && (px < band.min - EPS || px > band.max + EPS)) continue;
    const diff = Math.abs(px - target);
    const tieBreak = Math.abs(c.strike - atm); // closer to ATM = lower risk
    const score = diff * 1e6 + tieBreak; // diff dominates; ATM-distance breaks ties
    if (score < bestScore - EPS) {
      bestScore = score;
      best = { strike: c.strike, coverage: c.coverage, diff };
    }
  }
  if (best === null) return null;
  // D2 premium-deviation CEILING: the closest strike must still be CLOSE to the
  // target premium. If the best match is more than MAX_PREMIUM_DEVIATION off the
  // target (no real strike near the requested premium), it is a MISSING_LEG, not
  // a silent fill at an unrelated premium (07-data-layer §7b). With no usable
  // band/target (target ≤ 0) skip the relative check (defensive).
  if (target > EPS && best.diff / target > MAX_PREMIUM_DEVIATION + EPS) {
    return null;
  }
  const cov = best.coverage;
  // Premium selection always carries confidence ≤ medium (no exact "requested"
  // strike — the requested is the target premium, served is the chosen strike).
  return {
    requested: best.strike,
    served: best.strike,
    coverage: cov,
    confidence: cov >= MIN_COVERAGE ? "medium" : "low",
    fallbackSteps: 0,
  };
}
