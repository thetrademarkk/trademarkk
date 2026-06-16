/**
 * BYOC (bring-your-own-code) types. A user writes a PLAIN JavaScript `strategy`
 * function that runs in a QuickJS-WASM sandbox (no host access — verified: fetch /
 * window / process are all undefined inside the VM) against a candle series, and
 * returns a list of trades we score. JS-only, free (no server), and SAFE — the
 * sandbox cannot touch the network, DOM, or filesystem.
 *
 * The contract the user codes against:
 *
 *   function strategy(bars, ta) {
 *     // bars: ReadonlyArray<{ t, o, h, l, c, v }>  (chosen interval, IST)
 *     // ta:   indicator helpers (sma, ema, rsi, atr, highest, lowest, crossover…)
 *     // return an array of trades, each: { entryIndex, exitIndex, side }
 *     return [{ entryIndex: 10, exitIndex: 25, side: "long" }];
 *   }
 *
 * P&L per trade is the close-to-close move from entryIndex→exitIndex, signed by
 * `side`. This is a SPOT-series backtest (the index/stock underlying); options-leg
 * BYOC is a later layer over the same sandbox.
 */

/** One OHLCV candle handed to user code (IST wall-clock string `t`). */
export interface ByocBar {
  /** "YYYY-MM-DD HH:MM:SS" IST. */
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Long/short direction of a user trade. */
export type ByocSide = "long" | "short";

/** A trade returned by user code — entry/exit are indices into `bars`. */
export interface ByocTrade {
  entryIndex: number;
  exitIndex: number;
  side: ByocSide;
}

/** A scored trade (BYOC metrics add the realized return). */
export interface ByocScoredTrade extends ByocTrade {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  /** Fractional close-to-close return, signed by side (0.012 = +1.2%). */
  ret: number;
}

/** Headline metrics for a BYOC run (spot series, % returns). */
export interface ByocStats {
  trades: number;
  wins: number;
  winRate: number;
  /** Compounded total return over the sequence of trades (0.25 = +25%). */
  totalReturn: number;
  avgReturn: number;
  bestReturn: number;
  worstReturn: number;
  /** Max peak-to-trough drawdown of the compounded equity curve (≥ 0). */
  maxDrawdown: number;
  /** Cumulative equity multiplier after each trade (starts at 1). */
  equity: number[];
  expectancy: number;
}

/** The outcome of a sandboxed run — a typed success or an honest error. */
export type ByocResult =
  | { ok: true; scored: ByocScoredTrade[]; stats: ByocStats; elapsedMs: number; logs: string[] }
  | { ok: false; error: string; phase: "compile" | "run" | "timeout" | "shape"; logs: string[] };

/** Options for a sandbox run. */
export interface ByocRunOptions {
  /** Hard wall-clock budget; the VM is interrupted past it. Default 4000ms. */
  timeoutMs?: number;
  /** VM heap cap in bytes. Default 64 MB. */
  memoryBytes?: number;
}
