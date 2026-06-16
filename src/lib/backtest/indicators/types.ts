/**
 * Indicator library — shared types & conventions.
 *
 * This is a STANDALONE, pure-TS, dependency-free indicator library for the
 * backtest engine. It is NOT yet coupled to the engine signal model; that is a
 * later phase (see docs/backtesting/12-indicator-library.md §"Integration").
 *
 * NaN / warmup contract (read this before adding any indicator):
 *  - Every batch indicator returns an array ALIGNED to the input length.
 *  - During the warmup prefix the output is `NaN` (NOT 0, NOT null) so callers
 *    can `Number.isNaN(x)` test uniformly and so arithmetic never silently
 *    treats an un-warmed value as a real number.
 *  - Indicators NEVER look ahead: output[i] depends only on input[0..i].
 *  - The warmup-prefix length is pinned per indicator with an explicit test.
 *
 * Why NaN (not the doc's `null`): NaN keeps the array a homogeneous
 * `number[]`, is the value TA-Lib / numpy emit, and survives JSON round-trips
 * via the test harness as the sentinel the golden vectors record. The registry
 * layer can map NaN -> null for UI consumption later if desired.
 */

/** A single OHLCV bar. Timestamps are epoch ms (UTC); session logic is the
 *  caller's concern — indicators here are pure over the numeric series. */
export interface OHLCV {
  /** Epoch milliseconds (UTC) of the bar open. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume; 0 when unknown. Volume indicators must tolerate 0. */
  volume: number;
}

/** Result of a batch indicator: same length as input, NaN during warmup. */
export type IndicatorResult = number[];

/**
 * Incremental (streaming) indicator state. The engine folds bars one at a time,
 * point-in-time, with no look-ahead. `push` returns the indicator value for the
 * bar just pushed (NaN during warmup). Pushing the same sequence of values into
 * a fresh stream MUST reproduce the batch output exactly (this is tested).
 */
export interface IndicatorStream<TInput = number> {
  /** Feed the next input; returns the indicator value at this step (NaN in warmup). */
  push(x: TInput): number;
}

/** Multi-output streaming state (e.g. MACD line/signal/hist, Bollinger bands). */
export interface MultiIndicatorStream<TInput = number, TOutput = Record<string, number>> {
  push(x: TInput): TOutput;
}

/** Guard: throws on a non-positive integer period. Shared by all indicators. */
export function assertPeriod(period: number, name = "period"): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`${name} must be a positive integer, got ${period}`);
  }
}

/** Extract the close series from an OHLCV array (the most common adapter). */
export function closes(bars: readonly OHLCV[]): number[] {
  return bars.map((b) => b.close);
}
