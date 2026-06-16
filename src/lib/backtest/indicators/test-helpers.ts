/**
 * Shared test helpers for the indicator golden suite.
 *
 * Golden-vector convention (every indicator MUST follow this):
 *  - Declare the reference source in a comment (e.g. "TA-Lib 0.6.8",
 *    "Wilder 1978 worked example", "TradingView Pine ta.* doc").
 *  - Assert the computed series equals the reference within a STATED epsilon
 *    using `assertCloseArray` (NaN-aware: NaN must align with NaN).
 *  - Assert the NaN warmup-prefix length explicitly with `nanPrefixLength`.
 *  - Assert determinism (same input -> identical output) with `expectDeterministic`.
 *  - Cover one known div-by-zero / flat-range gotcha per indicator.
 */

import { expect } from "vitest";

/**
 * Assert two numeric series are equal within `eps`, treating NaN as a value
 * that must align (NaN in actual <=> NaN in expected at the same index).
 * `expected` may use `null` as a readable alias for "NaN here" in vectors.
 */
export function assertCloseArray(
  actual: readonly number[],
  expected: readonly (number | null)[],
  eps = 1e-8,
  label = "series"
): void {
  expect(actual.length, `${label}: length`).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const a = actual[i]!;
    if (e === null || e === undefined || Number.isNaN(e)) {
      expect(Number.isNaN(a), `${label}[${i}] expected NaN, got ${a}`).toBe(true);
    } else {
      expect(Number.isNaN(a), `${label}[${i}] expected ${e}, got NaN`).toBe(false);
      expect(Math.abs(a - e), `${label}[${i}] |${a} - ${e}| > ${eps}`).toBeLessThanOrEqual(eps);
    }
  }
}

/** Count the leading NaN values (the warmup prefix length). */
export function nanPrefixLength(xs: readonly number[]): number {
  let n = 0;
  while (n < xs.length && Number.isNaN(xs[n]!)) n++;
  return n;
}

/**
 * Assert a pure batch fn is deterministic: calling it twice on the same input
 * yields a byte-identical series (NaN-aware equality).
 */
export function expectDeterministic(fn: () => number[]): void {
  const a = fn();
  const b = fn();
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(a[i]!)) expect(Number.isNaN(b[i]!)).toBe(true);
    else expect(b[i]).toBe(a[i]);
  }
}

/**
 * Drive a streaming indicator over a series and collect its outputs — used to
 * assert the incremental form reproduces the batch form exactly.
 */
export function runStream(stream: { push(x: number): number }, xs: readonly number[]): number[] {
  return xs.map((x) => stream.push(x));
}
