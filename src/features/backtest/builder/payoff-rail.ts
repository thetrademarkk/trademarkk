/**
 * Pure derivation for the ALWAYS-MOUNTED live payoff rail (BT-06).
 *
 * Bridges the wizard's StrategyDef legs to the existing closed-form payoff math
 * in src/lib/options/payoff.ts (buildPayoffCurve / classifyStrategy). The wizard
 * never holds resolved strikes — a leg stores INTENT (ATM±n, %, premium, exact).
 * For the live expiry diagram we need a representative absolute strike + an
 * estimated entry premium per leg; both come from the same synthetic chain the
 * strike ladder shows (estimate-chain.ts), so the rail and the ladder agree.
 *
 * This is a PREVIEW. The authoritative net P&L comes from the engine run; the
 * rail shows the at-expiry intrinsic-value payoff of the entered legs so the
 * trader sees the structure (max P/L, breakevens, strategy name) update live.
 *
 * Money in rupees; everything here is pure and unit-tested against hand math.
 */

import {
  buildPayoffCurve,
  classifyStrategy,
  type LegShape,
  type PayoffCurve,
  type PayoffLeg,
} from "@/lib/options/payoff";
import { LOT_SIZE, type IndexSymbol } from "../shared/instruments";
import type { LegDef, StrategyDef } from "../shared/strategy-def";
import { estimateLegStrikeAndPremium, type EstimateChain } from "./estimate-chain";

/** One leg, fully resolved for the preview: absolute strike + estimated premium. */
export interface PreviewLeg {
  legId: string;
  strike: number;
  premium: number;
  payoff: PayoffLeg;
}

/** The complete live-rail summary the UI renders. */
export interface PayoffSummary {
  /** Strategy auto-label from the leg shape ("Short Straddle", "Iron Condor"…). */
  label: ReturnType<typeof classifyStrategy>;
  /** The sampled payoff-at-expiry curve (empty when no usable legs). */
  curve: PayoffCurve;
  /** Per-leg resolved preview rows (strike + estimated premium). */
  legs: PreviewLeg[];
  /** Net premium across all legs: >0 = net credit collected, <0 = net debit paid. */
  netCredit: number;
  /** Whether the book has any usable (resolvable, enabled, qty>0) legs. */
  hasLegs: boolean;
}

/** Map a wizard leg side to the payoff library's long/short convention. */
function directionOf(leg: LegDef): PayoffLeg["direction"] {
  return leg.side === "buy" ? "long" : "short";
}

/**
 * Resolve one wizard leg into a preview leg against the estimate chain. Returns
 * null when the leg is disabled or no strike/premium can be estimated.
 */
export function resolvePreviewLeg(
  index: IndexSymbol,
  leg: LegDef,
  chain: EstimateChain
): PreviewLeg | null {
  if (!leg.enabled) return null;
  const est = estimateLegStrikeAndPremium(index, leg, chain);
  if (est === null) return null;
  const qty = leg.lots * LOT_SIZE[index];
  if (qty <= 0) return null;
  return {
    legId: leg.id,
    strike: est.strike,
    premium: est.premium,
    payoff: {
      strike: est.strike,
      optionType: leg.optionType,
      direction: directionOf(leg),
      qty,
      premium: est.premium,
    },
  };
}

/**
 * Build the full live-rail summary for a strategy draft against the estimate
 * chain. Pure: same inputs → same summary. Used by the rail UI (via useMemo) and
 * unit-tested for a known straddle/spread vs hand-computed max P/L + breakevens.
 */
export function buildPayoffSummary(
  strategy: Pick<StrategyDef, "legs"> & { market: { symbol: IndexSymbol } },
  chain: EstimateChain
): PayoffSummary {
  const index = strategy.market.symbol;
  const legs: PreviewLeg[] = [];
  for (const leg of strategy.legs) {
    const pv = resolvePreviewLeg(index, leg, chain);
    if (pv) legs.push(pv);
  }

  const payoffLegs = legs.map((l) => l.payoff);
  const curve = buildPayoffCurve(payoffLegs);
  const label = classifyStrategy(
    payoffLegs.map(
      (l): LegShape => ({
        strike: l.strike,
        optionType: l.optionType,
        direction: l.direction,
        qty: l.qty,
      })
    )
  );

  // Net credit = sum over legs of (short collects + / long pays −) premium × qty.
  let netCredit = 0;
  for (const l of legs) {
    const sign = l.payoff.direction === "short" ? 1 : -1;
    netCredit += sign * l.premium * l.payoff.qty;
  }

  return {
    label,
    curve,
    legs,
    netCredit: Math.round(netCredit * 100) / 100,
    hasLegs: legs.length > 0,
  };
}
