/**
 * Fill model & slippage (06-engine-semantics §3) — honest, worse-not-clean
 * fills. Slippage is ALWAYS applied against the trader (pessimistic), then
 * snapped to the option tick, and liquidity-scaled (D4): an illiquid strike
 * (coverage < 0.5) or a zero-volume fill bar multiplies slippage by
 * ILLIQUID_SLIP_MULT and flags the trade LOW_LIQUIDITY.
 *
 * The medVol input (per the spec) is plumbed through so BT-08 can pass the real
 * manifest median volume; today the local/fixture sources pass per-day medVol
 * and the engine bumps slippage when it is thin relative to the leg's lot-scaled
 * quantity. Pure & deterministic — no randomness.
 */

import { ILLIQUID_COVERAGE, ILLIQUID_SLIP_MULT, OPTION_TICK, type Direction } from "./types";

export interface SlippageConfig {
  mode: "percent" | "ticks";
  /** percent: e.g. 0.5 (=0.5%); ticks: e.g. 2 (ticks). */
  value: number;
  /** Option tick size (₹); fills snap to this. */
  tickSize: number;
}

/** Round to the nearest tick (deterministic half-up), paise-clean (no FP noise). */
export function snapToTick(price: number, tick: number): number {
  if (tick <= 0) return Math.round(price * 100) / 100;
  // Snap to tick, then round to 2dp so the result is paise-clean (₹0.05 ticks
  // can otherwise leave 100.30000000000001 FP residue).
  return Math.round(Math.round(price / tick) * tick * 100) / 100;
}

/** Context the fill model needs to decide the liquidity bump. */
export interface FillContext {
  /** "buy" side pays up, "sell" side receives less. Derived from leg direction. */
  side: "buy" | "sell";
  /** Served-strike coverage 0..1 (from the strike resolution). */
  coverage: number;
  /** Volume of the FILL bar (0 ⇒ no print this minute). */
  barVolume: number;
}

/** True if this fill should take the illiquid slippage bump (§3.2). */
export function isIlliquidFill(coverage: number, barVolume: number): boolean {
  return coverage < ILLIQUID_COVERAGE || barVolume <= 0;
}

/**
 * Apply adverse slippage to a clean price and snap to tick. A fill can never go
 * ≤ 0; it is floored at one tick.
 */
export function applySlippage(
  cleanPrice: number,
  cfg: SlippageConfig,
  ctx: FillContext
): { fill: number; illiquid: boolean } {
  const tick = cfg.tickSize > 0 ? cfg.tickSize : OPTION_TICK;
  const illiquid = isIlliquidFill(ctx.coverage, ctx.barVolume);
  const mult = illiquid ? ILLIQUID_SLIP_MULT : 1;

  let fill: number;
  if (cfg.mode === "percent") {
    const pct = (cfg.value / 100) * mult;
    fill = ctx.side === "buy" ? cleanPrice * (1 + pct) : cleanPrice * (1 - pct);
  } else {
    const ticks = cfg.value * mult;
    fill = ctx.side === "buy" ? cleanPrice + ticks * tick : cleanPrice - ticks * tick;
  }

  fill = snapToTick(fill, tick);
  if (fill < tick) fill = tick; // never ≤ 0
  return { fill, illiquid };
}

/** Map a leg direction to the buy/sell side of an ENTRY fill. */
export function entrySide(direction: Direction): "buy" | "sell" {
  return direction === "long" ? "buy" : "sell";
}

/** Map a leg direction to the buy/sell side of an EXIT fill (the opposite leg). */
export function exitSide(direction: Direction): "buy" | "sell" {
  return direction === "long" ? "sell" : "buy";
}
