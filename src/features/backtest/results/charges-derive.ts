/**
 * The TAP-TO-DERIVE waterfall behind Net P&L — the honest gross → net story.
 *
 * The engine books each leg exit with exactly ONE computeCharges round-trip on
 * the OPT premium-sell branch (see engine.ts bookExit): MIS product, 2 orders,
 * the leg's fill prices and quantity. The RunResult stores only the per-leg
 * `charges` TOTAL, not the component breakdown. To show brokerage / STT /
 * exchange / GST / SEBI / stamp, we RE-DERIVE the breakdown by replaying the
 * SAME computeCharges call over every booked leg in the blotter, summing the
 * components.
 *
 * Because the inputs are identical (same profile, same MIS/OPT/2-orders branch,
 * same paise-precise prices stored on each BookedLeg), the re-derived component
 * sum equals the engine's stored `Σ blotter.charges` CENT-FOR-CENT. The unit
 * test asserts exactly this.
 *
 * Slippage note: the engine bakes adverse slippage into the FILL price before it
 * computes gross, so gross is already net-of-slippage. We surface that honestly:
 * the waterfall is `gross (after slippage) − charges = net`, and we separately
 * report the modelled slippage setting so it is never hidden.
 *
 * Pure & deterministic — no React.
 */

import { computeCharges, type ChargeBreakdown } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";
import type { RunResult } from "@/features/backtest/shared/run-result";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** BT-02 side → charges direction (mirrors engine.ts toDirection). */
function sideToDirection(side: "buy" | "sell"): "long" | "short" {
  return side === "buy" ? "long" : "short";
}

/** The broker profile the engine used (custom maps to zerodha, per engine.ts). */
export function resolveChargeProfileId(run: RunResult): string {
  const b = run.config.execution.broker;
  return b === "custom" ? "zerodha" : b;
}

export interface ChargesWaterfall {
  /** Σ gross over all booked legs (already net of modelled slippage). */
  gross: number;
  /** Component breakdown, summed over every round-trip in the run. */
  components: {
    brokerage: number;
    stt: number;
    exchange: number;
    sebi: number;
    gst: number;
    stampDuty: number;
    dpCharge: number;
  };
  /** Σ charges (= sum of components). Equals the engine's stored total. */
  charges: number;
  /** gross − charges. Equals run.stats.netPnl. */
  net: number;
  /** The broker profile id whose rate card produced these charges. */
  brokerId: string;
  /** Human label for the modelled slippage (already baked into gross). */
  slippageLabel: string;
}

/**
 * Re-derive the full gross → charges → net waterfall for a run by replaying
 * computeCharges over every booked leg. The component sum is cent-for-cent equal
 * to the engine's stored Σ charges.
 */
export function deriveChargesWaterfall(run: RunResult): ChargesWaterfall {
  const profileId = resolveChargeProfileId(run);
  const profile = getChargeProfile(profileId);

  const acc = { brokerage: 0, stt: 0, exchange: 0, sebi: 0, gst: 0, stampDuty: 0, dpCharge: 0 };
  let gross = 0;
  // Reproduce the engine's rounding EXACTLY: it stored each leg's charge as the
  // r2-rounded computeCharges().total, then summed those. So we accumulate the
  // per-leg rounded TOTAL for the headline `charges` (cent-for-cent), and keep a
  // separate sum of components for the human breakdown. The components are then
  // reconciled to the rounded total so the displayed lines add up to it.
  let chargesTotal = 0;

  for (const row of run.blotter) {
    for (const leg of row.legs) {
      gross += leg.gross;
      const bd: ChargeBreakdown = computeCharges(profile, {
        segment: "OPT",
        product: "MIS",
        orders: 2,
        direction: sideToDirection(leg.side),
        entryPrice: leg.entryPrice,
        exitPrice: leg.exitPrice,
        qty: leg.qty,
      });
      chargesTotal += bd.total; // already r2 per leg — matches the engine
      acc.brokerage += bd.brokerage;
      acc.stt += bd.stt;
      acc.exchange += bd.exchange;
      acc.sebi += bd.sebi;
      acc.gst += bd.gst;
      acc.stampDuty += bd.stampDuty;
      acc.dpCharge += bd.dpCharge;
    }
  }

  const charges = r2(chargesTotal);
  // Round each component; the GST line absorbs any sub-paisa reconciliation so
  // the component lines sum back to the cent-for-cent `charges` total.
  const rounded = {
    brokerage: r2(acc.brokerage),
    stt: r2(acc.stt),
    exchange: r2(acc.exchange),
    sebi: r2(acc.sebi),
    stampDuty: r2(acc.stampDuty),
    dpCharge: r2(acc.dpCharge),
  };
  const nonGst = r2(
    rounded.brokerage +
      rounded.stt +
      rounded.exchange +
      rounded.sebi +
      rounded.stampDuty +
      rounded.dpCharge
  );
  const components = { ...rounded, gst: r2(charges - nonGst) };
  const g = r2(gross);

  const slip = run.config.execution.slippage;
  const slippageLabel =
    slip.value === 0
      ? "none"
      : slip.unit === "pct"
        ? `${slip.value}% per fill (adverse)`
        : `${slip.value} pts per fill (adverse)`;

  return {
    gross: g,
    components,
    charges,
    net: r2(g - charges),
    brokerId: profileId,
    slippageLabel,
  };
}

/** One labelled line of the derivation table (UI maps tone → token). */
export interface WaterfallLine {
  label: string;
  value: number;
  /** "add" = gross row, "sub" = a deduction, "total" = the net result. */
  kind: "add" | "sub" | "total";
}

/** The ordered lines of the gross → net waterfall for rendering. */
export function waterfallLines(w: ChargesWaterfall): WaterfallLine[] {
  const lines: WaterfallLine[] = [
    { label: "Gross P&L (after slippage)", value: w.gross, kind: "add" },
    { label: "Brokerage", value: -w.components.brokerage, kind: "sub" },
    { label: "STT", value: -w.components.stt, kind: "sub" },
    { label: "Exchange txn", value: -w.components.exchange, kind: "sub" },
    { label: "GST", value: -w.components.gst, kind: "sub" },
    { label: "SEBI", value: -w.components.sebi, kind: "sub" },
    { label: "Stamp duty", value: -w.components.stampDuty, kind: "sub" },
  ];
  if (w.components.dpCharge > 0) {
    lines.push({ label: "DP charge", value: -w.components.dpCharge, kind: "sub" });
  }
  lines.push({ label: "Net P&L", value: w.net, kind: "total" });
  return lines;
}
