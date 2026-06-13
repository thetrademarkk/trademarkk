/**
 * Test-only builders for synthetic fixture days — hand-crafted so each of the 10
 * hard invariants can be pinned with a tiny, fully-controlled data slice. Not
 * shipped to clients (only imported by *.test.ts).
 *
 * Bars are minute-aligned from 09:15 IST. A "day" is a real trading day
 * (2024-07-25, a NIFTY Thursday weekly expiry that the calendar resolves) so the
 * day spine includes it without special-casing.
 */

import type { FixtureContract, FixtureDay, FixtureSnapshot } from "./adapters/fixture-source";
import type { Bar, OptionType } from "./types";
import {
  makeDefaultStrategy,
  type LegDef,
  type StrategyDef,
} from "../../../features/backtest/shared/strategy-def";

/** 09:15 IST epoch-ms for a day key. */
export function baseMs(day: string): number {
  return Date.parse(`${day}T03:45:00.000Z`);
}

/** Epoch-ms for minute-of-day-from-open `min` (0 = 09:15). */
export function tsAt(day: string, minFromOpen: number): number {
  return baseMs(day) + minFromOpen * 60_000;
}

/** A flat OHLC bar at minute `min` from open (default volume 1000). */
export function bar(day: string, min: number, ohlc: Partial<Bar> & { c: number }): Bar {
  const c = ohlc.c;
  return {
    ts: tsAt(day, min),
    o: ohlc.o ?? c,
    h: ohlc.h ?? Math.max(ohlc.o ?? c, c),
    l: ohlc.l ?? Math.min(ohlc.o ?? c, c),
    c,
    v: ohlc.v ?? 1000,
    oi: ohlc.oi,
  };
}

/** A constant-price index series across the session (376 bars from 09:15). */
export function flatIndex(day: string, price: number, bars = 376): Bar[] {
  return Array.from({ length: bars }, (_, i) =>
    bar(day, i, { o: price, h: price, l: price, c: price, v: 0 })
  );
}

/** A constant-price option contract series. */
export function flatContract(
  day: string,
  strike: number,
  ot: OptionType,
  price: number,
  bars = 376,
  vol = 1000
): FixtureContract {
  return {
    strike,
    optionType: ot,
    bars: Array.from({ length: bars }, (_, i) =>
      bar(day, i, { o: price, h: price, l: price, c: price, v: vol })
    ),
  };
}

/** A contract whose price follows a per-minute close array (o=prevClose). */
export function pathContract(
  day: string,
  strike: number,
  ot: OptionType,
  closes: number[],
  opts: { highs?: number[]; lows?: number[]; vols?: number[] } = {}
): FixtureContract {
  return {
    strike,
    optionType: ot,
    bars: closes.map((c, i) => {
      const o = i === 0 ? c : closes[i - 1]!;
      return {
        ts: tsAt(day, i),
        o,
        h: opts.highs?.[i] ?? Math.max(o, c),
        l: opts.lows?.[i] ?? Math.min(o, c),
        c,
        v: opts.vols?.[i] ?? 1000,
      };
    }),
  };
}

/** Bundle a single fixture day. */
export function makeDay(
  day: string,
  expiry: string,
  index: Bar[],
  contracts: FixtureContract[]
): FixtureDay {
  return { day, expiry, index, contracts };
}

/** A fixture snapshot from days. */
export function snapshot(days: FixtureDay[], id = "test-snap"): FixtureSnapshot {
  return { snapshotId: id, symbol: "NIFTY", days };
}

/** A minimal strategy on NIFTY for `day` (entry 09:20, exit 15:15, no slippage). */
export function strategyFor(
  day: string,
  legs: LegDef[],
  overrides: Partial<StrategyDef> = {}
): StrategyDef {
  const base = makeDefaultStrategy("test", "NIFTY");
  return {
    ...base,
    ...overrides,
    legs,
    market: overrides.market ?? {
      symbol: "NIFTY",
      interval: "1m",
      dateRange: { start: day, end: day },
    },
    timing: overrides.timing ?? { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
    execution: {
      ...base.execution,
      broker: "zerodha",
      slippage: { unit: "pct", value: 0 }, // tests opt into slippage explicitly
      ...(overrides.execution ?? {}),
    },
    risk: overrides.risk ?? { reEntryOnOverall: false },
  };
}

/** A single leg (parameterizable). */
export function leg(
  id: string,
  ot: OptionType,
  side: "buy" | "sell",
  extra: Partial<LegDef> = {}
): LegDef {
  return {
    id,
    enabled: true,
    optionType: ot,
    side,
    lots: 1,
    strike: { mode: "ATM_OFFSET", steps: 0 },
    expiry: "WEEKLY",
    squareOff: "partial",
    ...extra,
  };
}
