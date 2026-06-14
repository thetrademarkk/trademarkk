/**
 * Determinism contract (06-engine-semantics §12.1): identical (config, source) ⇒
 * byte-identical RunResult (modulo meta.ranAt). Pinned by hashing the result of
 * 100 repeated runs and asserting a single distinct hash. Also exercises the
 * Monte-Carlo cone over the engine's own output (R-based AND raw-rupee D3 paths).
 */

import { describe, expect, it } from "vitest";
import { tradingDays } from "../calendar/market-calendar";
import { FixtureDataSource, type FixtureDay } from "./adapters/fixture-source";
import { runBacktest } from "./engine";
import { hasHardStop, monteCarloFromRun } from "../mc-cone";
import { flatIndex, leg, makeDay, pathContract, snapshot, strategyFor } from "./test-helpers";
import type { RunResult } from "../../../features/backtest/shared/run-result";

/** A 40-trading-day NIFTY snapshot with a deterministic per-day price path. */
function build40DaySnapshot(): { src: FixtureDataSource; days: string[] } {
  const days = tradingDays("2024-05-02", "2024-07-25", "NIFTY").slice(0, 40);
  const fdays: FixtureDay[] = days.map((day, di) => {
    // Spot anchored at 24250 (ATM 24250). CE & PE each drift deterministically
    // so some days win and some lose for a short straddle.
    const idx = flatIndex(day, 24250);
    // close path: a small per-day sinusoidal-ish swing seeded by day index.
    const ceCloses = Array.from({ length: 376 }, (_, i) => {
      const drift = ((di * 7 + i) % 41) - 20; // -20..+20
      return Math.max(5, 120 + drift * 0.5);
    });
    const peCloses = Array.from({ length: 376 }, (_, i) => {
      const drift = ((di * 5 + i) % 37) - 18;
      return Math.max(5, 110 - drift * 0.5);
    });
    const ce = pathContract(day, 24250, "CE", ceCloses);
    const pe = pathContract(day, 24250, "PE", peCloses);
    return makeDay(day, day, idx, [ce, pe]);
  });
  return { src: new FixtureDataSource(snapshot(fdays, "det-40d")), days };
}

/** Stable hash of a RunResult, ignoring the run timestamp. */
function hashResult(r: RunResult): string {
  const stable = { ...r, ranAt: 0 };
  const json = JSON.stringify(stable);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

describe("determinism", () => {
  it("100 repeated runs produce an IDENTICAL result hash", () => {
    const { src, days } = build40DaySnapshot();
    const strat = strategyFor(days[0]!, [leg("ce", "CE", "sell"), leg("pe", "PE", "sell")], {
      market: {
        symbol: "NIFTY",
        interval: "1m",
        dateRange: { start: days[0]!, end: days[days.length - 1]! },
      },
    });
    const hashes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      hashes.add(hashResult(runBacktest(strat, src, { ranAt: 0 })));
    }
    expect(hashes.size).toBe(1);
  });

  it("the deterministic runId is stable across runs", () => {
    const { src, days } = build40DaySnapshot();
    const strat = strategyFor(days[0]!, [leg("pe", "PE", "sell")], {
      market: {
        symbol: "NIFTY",
        interval: "1m",
        dateRange: { start: days[0]!, end: days[days.length - 1]! },
      },
    });
    const a = runBacktest(strat, src, { ranAt: 0 }).runId;
    const b = runBacktest(strat, src, { ranAt: 999 }).runId;
    expect(a).toBe(b); // runId is independent of ranAt
  });
});

describe("Monte-Carlo cone over the engine output (D3)", () => {
  it("no-stop straddle → RAW-RUPEE cone, gated at MIN_TRADES=30", () => {
    const { src, days } = build40DaySnapshot();
    const strat = strategyFor(days[0]!, [leg("ce", "CE", "sell"), leg("pe", "PE", "sell")], {
      market: {
        symbol: "NIFTY",
        interval: "1m",
        dateRange: { start: days[0]!, end: days[days.length - 1]! },
      },
    });
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(hasHardStop(res.config)).toBe(false);
    const cone = monteCarloFromRun(res, { paths: 2000 })!;
    expect(cone).not.toBeNull();
    expect(cone.basis).toBe("rupees"); // D3: raw-rupee for no-stop straddles
    expect(cone.sampleSize).toBeGreaterThanOrEqual(30);
    expect(cone.sim.cone.length).toBe(cone.sampleSize + 1);
  });

  it("hard-SL strategy → R-based cone", () => {
    const { src, days } = build40DaySnapshot();
    const strat = strategyFor(
      days[0]!,
      [
        leg("ce", "CE", "sell", {
          stopLoss: { unit: "pct", basis: "premium", value: 40, refPrice: "traded" },
        }),
        leg("pe", "PE", "sell", {
          stopLoss: { unit: "pct", basis: "premium", value: 40, refPrice: "traded" },
        }),
      ],
      {
        market: {
          symbol: "NIFTY",
          interval: "1m",
          dateRange: { start: days[0]!, end: days[days.length - 1]! },
        },
      }
    );
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(hasHardStop(res.config)).toBe(true);
    const cone = monteCarloFromRun(res, { paths: 2000 });
    if (cone) expect(cone.basis).toBe("R");
  });

  it("a tiny run (<30 trade days) returns null (honest 'not enough data')", () => {
    const day = "2024-07-25";
    const idx = flatIndex(day, 24250);
    const ce = pathContract(
      day,
      24250,
      "CE",
      Array.from({ length: 376 }, () => 100)
    );
    const pe = pathContract(
      day,
      24250,
      "PE",
      Array.from({ length: 376 }, () => 100)
    );
    const src = new FixtureDataSource(snapshot([makeDay(day, day, idx, [ce, pe])]));
    const strat = strategyFor(day, [leg("ce", "CE", "sell"), leg("pe", "PE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(monteCarloFromRun(res)).toBeNull();
  });
});
