/**
 * In-memory FIXTURE data source — the deterministic implementation used by unit
 * tests AND by golden-strategy runs against committed real-archive slices. It
 * also IS the shape the LocalArchiveDataSource materializes (the python gen
 * script writes exactly this JSON), so the local adapter is a thin loader over
 * the same structure and the HF adapter (BT-08) is a drop-in for the same 6-fn
 * DataSource interface.
 *
 * Pure: holds a plain snapshot object, answers synchronously. No external deps.
 */

import type { IndexSymbol } from "../../../../features/backtest/shared/instruments";
import type { DataSource, DayData } from "../data-source";
import { resolvePremiumStrike, resolveStrike, atmStrike as atmOf } from "../resolve-strike";
import {
  SESSION_MINUTES,
  type Bar,
  type ContractMeta,
  type OptionType,
  type Series,
  type StrikeIntent,
  type StrikeResolution,
} from "../types";

/** A single option contract's day slice. */
export interface FixtureContract {
  strike: number;
  optionType: OptionType;
  bars: Bar[];
}

/** One trading day, fully materialized (the gen-script output unit). */
export interface FixtureDay {
  day: string; // "YYYY-MM-DD"
  expiry: string; // resolved expiry the contracts belong to
  index: Bar[];
  contracts: FixtureContract[];
}

/** The committed fixture/slice snapshot. */
export interface FixtureSnapshot {
  snapshotId: string;
  symbol: IndexSymbol;
  days: FixtureDay[];
}

/** Build a contract-meta (coverage + medVol) from a contract's day bars. */
function metaOf(c: FixtureContract): ContractMeta {
  const present = c.bars.filter((b) => b.v >= 0).length;
  const coverage = Math.min(1, present / SESSION_MINUTES);
  const vols = c.bars
    .map((b) => b.v)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const medVol = vols.length ? vols[Math.floor((vols.length - 1) / 2)]! : 0;
  return { strike: c.strike, optionType: c.optionType, coverage, medVol };
}

export class FixtureDataSource implements DataSource {
  readonly snapshotId: string;
  private readonly symbol: IndexSymbol;
  private readonly byDay = new Map<string, FixtureDay>();

  constructor(snapshot: FixtureSnapshot) {
    this.snapshotId = snapshot.snapshotId;
    this.symbol = snapshot.symbol;
    for (const d of snapshot.days) this.byDay.set(d.day, d);
  }

  private dayOf(day: string): FixtureDay | undefined {
    return this.byDay.get(day);
  }

  private contractOf(day: string, strike: number, type: OptionType): FixtureContract | undefined {
    const d = this.dayOf(day);
    return d?.contracts.find((c) => c.strike === strike && c.optionType === type);
  }

  loadIndex(_index: IndexSymbol, day: string): Series {
    return this.dayOf(day)?.index ?? [];
  }

  loadOption(
    _index: IndexSymbol,
    _expiry: string,
    day: string,
    strike: number,
    type: OptionType
  ): Series {
    return this.contractOf(day, strike, type)?.bars ?? [];
  }

  optionChainAt(_index: IndexSymbol, _expiry: string, day: string): ContractMeta[] {
    const d = this.dayOf(day);
    if (!d) return [];
    return d.contracts.map(metaOf);
  }

  coverageFor(
    _index: IndexSymbol,
    _expiry: string,
    day: string,
    strike: number,
    type: OptionType
  ): number {
    const c = this.contractOf(day, strike, type);
    return c ? metaOf(c).coverage : 0;
  }

  atmStrike(index: IndexSymbol, expiry: string, day: string, spot: number): number | null {
    return atmOf(this.optionChainAt(index, expiry, day), spot);
  }

  resolveStrike(
    index: IndexSymbol,
    expiry: string,
    day: string,
    type: OptionType,
    intent: StrikeIntent,
    spot: number
  ): StrikeResolution | null {
    const chain = this.optionChainAt(index, expiry, day);
    if (intent.kind === "premium") {
      const prices = new Map<number, number>();
      for (const c of chain) {
        if (c.optionType !== type) continue;
        const s = this.loadOption(index, expiry, day, c.strike, type);
        if (s[0]) prices.set(c.strike, s[0].o);
      }
      return resolvePremiumStrike(index, chain, type, intent.target, intent.band, prices, spot);
    }
    return resolveStrike(index, chain, type, intent, spot);
  }

  dayData(index: IndexSymbol, expiry: string, day: string): DayData {
    const d = this.dayOf(day);
    const chain = this.optionChainAt(index, expiry, day);
    return {
      day,
      expiry,
      index: d?.index ?? [],
      chain,
      option: (strike: number, type: OptionType) =>
        this.loadOption(index, expiry, day, strike, type),
    };
  }
}

/** Convenience: a snapshot from a list of fixture days. */
export function makeFixtureSource(
  snapshotId: string,
  symbol: IndexSymbol,
  days: FixtureDay[]
): FixtureDataSource {
  return new FixtureDataSource({ snapshotId, symbol, days });
}
