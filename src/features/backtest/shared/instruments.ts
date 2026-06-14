/**
 * The three backtestable index instruments and their immutable market
 * constants — DATA, the single source of truth for lot size, strike step and
 * tick. Imported by the strategy schema (leg → qty scaling), the calendar
 * (per-index expiry rules), and the engine (strike snapping / fills).
 *
 * Lot sizes and strike steps are the live NSE/BSE values for the dataset window:
 *   NIFTY      lot 75  · strike step 50  · spot data 2021-05+
 *   BANKNIFTY  lot 35  · strike step 100 · spot data 2021-05+
 *   SENSEX     lot 20  · strike step 100 · spot data 2022+  (worst option coverage)
 * Option tick size on all three index option chains is ₹0.05.
 */

export type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";

/** Every backtestable index, in display order (NIFTY = the safe default). */
export const INDEX_SYMBOLS: readonly IndexSymbol[] = ["NIFTY", "BANKNIFTY", "SENSEX"] as const;

/** Contracts per lot. `qty = lots × LOT_SIZE[index]`. */
export const LOT_SIZE: Record<IndexSymbol, number> = {
  NIFTY: 75,
  BANKNIFTY: 35,
  SENSEX: 20,
};

/** Valid strike interval (₹) used for ATM rounding + `exact` validation. */
export const STRIKE_STEP: Record<IndexSymbol, number> = {
  NIFTY: 50,
  BANKNIFTY: 100,
  SENSEX: 100,
};

/** Option-chain tick size (₹) — fills snap to this. */
export const OPTION_TICK = 0.05 as const;

export interface IndexMeta {
  symbol: IndexSymbol;
  label: string;
  lotSize: number;
  strikeStep: number;
  /** First IST calendar day the dataset covers (per-index). */
  dataStart: string;
  /** Short coverage caveat surfaced in the builder. */
  note: string;
}

export const INDEX_META: Record<IndexSymbol, IndexMeta> = {
  NIFTY: {
    symbol: "NIFTY",
    label: "NIFTY 50",
    lotSize: 75,
    strikeStep: 50,
    dataStart: "2021-05-01",
    note: "Best option coverage — the safe default.",
  },
  BANKNIFTY: {
    symbol: "BANKNIFTY",
    label: "BANK NIFTY",
    lotSize: 35,
    strikeStep: 100,
    dataStart: "2021-05-01",
    note: "Good index data, sparser strike coverage.",
  },
  SENSEX: {
    symbol: "SENSEX",
    label: "SENSEX",
    lotSize: 20,
    strikeStep: 100,
    dataStart: "2022-01-01",
    note: "Worst option coverage — the honesty layer matters most here.",
  },
};

/** Round a spot price to the nearest valid strike (ties → the higher strike). */
export function nearestStrike(index: IndexSymbol, spot: number): number {
  const step = STRIKE_STEP[index];
  return Math.round(spot / step) * step;
}

/** True if `strike` sits on the index's valid strike grid. */
export function isValidStrike(index: IndexSymbol, strike: number): boolean {
  const step = STRIKE_STEP[index];
  return strike > 0 && Number.isInteger(strike / step);
}

/** Total contracts for a leg: lots × the index lot size. */
export function lotsToQty(index: IndexSymbol, lots: number): number {
  return lots * LOT_SIZE[index];
}
