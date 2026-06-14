/**
 * Loader for the COMPACT real-archive golden fixture
 * (golden-nifty-2024-07.json, produced by scripts/gen-backtest-golden.py from
 * the local market_archive_1m parquet). Expands the compact flat-array bar
 * encoding back into the canonical FixtureSnapshot the engine consumes.
 *
 * Compact bar = [tsDeltaMin, o, h, l, c, v] where tsDeltaMin is minutes since the
 * day's 09:15 IST `base` epoch-ms. This keeps a real two-day NIFTY straddle slice
 * to ~140 KB on disk while preserving every real minute bar and price (2dp).
 */

import type { FixtureSnapshot, FixtureContract } from "../engine/adapters/fixture-source";
import type { Bar, OptionType } from "../engine/types";
import goldenCompact from "./golden-nifty-2024-07.json";

type CompactBar = [number, number, number, number, number, number];
interface CompactContract {
  strike: number;
  ot: OptionType;
  bars: CompactBar[];
}
interface CompactDay {
  day: string;
  expiry: string;
  base: number;
  index: CompactBar[];
  contracts: CompactContract[];
}
interface CompactSnapshot {
  snapshotId: string;
  symbol: string;
  format: string;
  days: CompactDay[];
}

function expandBars(base: number, rows: CompactBar[]): Bar[] {
  return rows.map(([dmin, o, h, l, c, v]) => ({
    ts: base + dmin * 60_000,
    o,
    h,
    l,
    c,
    v,
  }));
}

/** Expand the compact golden into a FixtureSnapshot. */
export function loadGoldenSnapshot(): FixtureSnapshot {
  const snap = goldenCompact as unknown as CompactSnapshot;
  return {
    snapshotId: snap.snapshotId,
    symbol: snap.symbol as FixtureSnapshot["symbol"],
    days: snap.days.map((d) => ({
      day: d.day,
      expiry: d.expiry,
      index: expandBars(d.base, d.index),
      contracts: d.contracts.map(
        (c): FixtureContract => ({
          strike: c.strike,
          optionType: c.ot,
          bars: expandBars(d.base, c.bars),
        })
      ),
    })),
  };
}
