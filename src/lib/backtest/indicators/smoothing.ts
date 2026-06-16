/**
 * Shared smoothing primitives — the building blocks every other indicator
 * composes from. Pure, deterministic, dependency-free.
 *
 * Conventions (pinned, see types.ts):
 *  - Output aligned to input length; NaN during warmup; no look-ahead.
 *  - EMA seed = SMA of the first `period` values (TA-Lib parity). The first
 *    non-NaN value is at index period-1.
 *  - Wilder (RMA / SMMA) smoothing uses α = 1/period and the same SMA seed.
 *
 * References:
 *  - SMA/EMA: TA-Lib documented output (offline pandas oracle, TA-Lib 0.6.8).
 *  - Wilder smoothing: Welles Wilder, "New Concepts in Technical Trading
 *    Systems" (1978) — the α = 1/n recursive average used by RSI/ATR/ADX.
 */

import { assertPeriod, type IndicatorStream } from "./types";

/**
 * Simple Moving Average. out[i] = mean(x[i-period+1 .. i]); NaN for i<period-1.
 * Reference: TA-Lib SMA.
 */
export function sma(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const out = new Array<number>(x.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i]!;
    if (i >= period) sum -= x[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Streaming SMA — rolling window sum. Reproduces sma() exactly. */
export function createSMA(period: number): IndicatorStream {
  assertPeriod(period);
  const buf: number[] = [];
  let sum = 0;
  return {
    push(v: number): number {
      buf.push(v);
      sum += v;
      if (buf.length > period) sum -= buf.shift()!;
      return buf.length >= period ? sum / period : NaN;
    },
  };
}

/**
 * Exponential Moving Average with the standard 2/(period+1) multiplier and an
 * SMA seed over the first `period` values. First non-NaN at index period-1.
 *   k = 2/(period+1);  ema[i] = (x[i] - ema[i-1]) * k + ema[i-1]
 * Reference: TA-Lib EMA.
 */
export function ema(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const out = new Array<number>(x.length).fill(NaN);
  if (x.length < period) return out;
  const k = 2 / (period + 1);
  // Seed: SMA of the first `period` values.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += x[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < x.length; i++) {
    prev = (x[i]! - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/** Streaming EMA — SMA-seeded, matches ema() exactly. */
export function createEMA(period: number): IndicatorStream {
  assertPeriod(period);
  const k = 2 / (period + 1);
  let count = 0;
  let seedSum = 0;
  let prev = NaN;
  return {
    push(v: number): number {
      count++;
      if (count < period) {
        seedSum += v;
        return NaN;
      }
      if (count === period) {
        seedSum += v;
        prev = seedSum / period;
        return prev;
      }
      prev = (v - prev) * k + prev;
      return prev;
    },
  };
}

/**
 * Wilder smoothing (a.k.a. RMA / SMMA) with α = 1/period and an SMA seed over
 * the first `period` values. This is the recursive average RSI/ATR/ADX use.
 *   w[i] = (x[i] - w[i-1]) / period + w[i-1]
 * Reference: Wilder 1978.
 */
export function wilderSmooth(x: readonly number[], period: number): number[] {
  assertPeriod(period);
  const out = new Array<number>(x.length).fill(NaN);
  if (x.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += x[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < x.length; i++) {
    prev = prev + (x[i]! - prev) / period;
    out[i] = prev;
  }
  return out;
}

/** Streaming Wilder/RMA smoothing. Matches wilderSmooth() exactly. */
export function createWilder(period: number): IndicatorStream {
  assertPeriod(period);
  let count = 0;
  let seedSum = 0;
  let prev = NaN;
  return {
    push(v: number): number {
      count++;
      if (count < period) {
        seedSum += v;
        return NaN;
      }
      if (count === period) {
        seedSum += v;
        prev = seedSum / period;
        return prev;
      }
      prev = prev + (v - prev) / period;
      return prev;
    },
  };
}
