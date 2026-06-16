/**
 * client.ts unit tests — exercise the OptionsDataClient with an INJECTED fake
 * QueryFn returning canned Arrow-like rows ({ toArray, numRows }). NO duckdb-wasm,
 * NO browser, NO network — these run in node/vitest. We assert:
 *   - loadIndex / loadOption row-shape + IST-string ts boundary conversion
 *   - loadIndex / loadOption interval routing (raw 1m vs SQL resample builder)
 *   - atmStrike exact-minute hit AND the as-of fallback when the minute is missing
 *   - coverageFor → §2 CoverageReport assembly (per-strike CE/PE, overallCoverage)
 *   - resolveStrike "exact" (high → wire "exact") and the missing-strike
 *     MISSING_LEG path (engine null → wire reason "none", served null)
 *
 * Live duckdb-wasm + HF range reads are covered by the playwright lane.
 */

import { describe, expect, it } from "vitest";
import type { QueryFn, QueryResult } from "./duck-browser";
import { OptionsDataClient, buildCoverageReport, chainFromCoverage, toTsString } from "./client";
import type { CoverageReport } from "./schema";

/* ─────────────────────────────── fake query ──────────────────────────────── */

/** Wrap canned rows in the minimal Arrow-table shape the client consumes. */
function result<Row>(rows: Row[]): QueryResult<Row> {
  return { toArray: () => rows, numRows: rows.length };
}

/**
 * Build a fake QueryFn that records every SQL it was asked to run and returns
 * canned rows. `responder` maps the SQL string to the rows for that call so a
 * single client method that fires multiple queries (atm exact → as-of) can be
 * driven deterministically.
 */
function fakeQuery(responder: (sql: string) => unknown[]): {
  fn: QueryFn;
  calls: string[];
} {
  const calls: string[] = [];
  const fn: QueryFn = async <Row = Record<string, unknown>>(sql: string) => {
    calls.push(sql);
    return result(responder(sql) as Row[]);
  };
  return { fn, calls };
}

/* ─────────────────────────────── loadIndex ───────────────────────────────── */

describe("OptionsDataClient.loadIndex", () => {
  it("maps raw rows to IndexBar with an IST-string ts and numeric OHLCV", async () => {
    const { fn, calls } = fakeQuery(() => [
      { timestamp: "2026-01-15T09:15:00", open: 100, high: 101, low: 99, close: 100.5, volume: 0 },
      { timestamp: "2026-01-15 09:16:00", open: 100.5, high: 102, low: 100, close: 101, volume: 5 },
    ]);
    const client = new OptionsDataClient({ query: fn });
    const bars = await client.loadIndex("NIFTY", "2026-01-15", "2026-01-15");

    expect(bars).toEqual([
      { ts: "2026-01-15 09:15:00", open: 100, high: 101, low: 99, close: 100.5, volume: 0 },
      { ts: "2026-01-15 09:16:00", open: 100.5, high: 102, low: 100, close: 101, volume: 5 },
    ]);
    // 1m default → the raw slice builder (no time_bucket).
    expect(calls[0]).toContain("FROM read_parquet(");
    expect(calls[0]).not.toContain("time_bucket");
  });

  it("routes a coarser interval to the SQL resample builder (time_bucket)", async () => {
    const { fn, calls } = fakeQuery(() => [
      { ts: "2026-01-15 09:15:00", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    ]);
    const client = new OptionsDataClient({ query: fn });
    await client.loadIndex("NIFTY", "2026-01-15", "2026-01-15", "5m");
    expect(calls[0]).toContain("time_bucket(INTERVAL '5 minutes'");
  });

  it("treats '1m' as the raw identity (no resample)", async () => {
    const { fn, calls } = fakeQuery(() => []);
    const client = new OptionsDataClient({ query: fn });
    await client.loadIndex("NIFTY", "2026-01-15", "2026-01-15", "1m");
    expect(calls[0]).not.toContain("time_bucket");
  });

  it("returns a typed empty array when nothing matches (never undefined)", async () => {
    const { fn } = fakeQuery(() => []);
    const client = new OptionsDataClient({ query: fn });
    expect(await client.loadIndex("NIFTY", "2026-01-15", "2026-01-15")).toEqual([]);
  });
});

/* ─────────────────────────────── loadOption ──────────────────────────────── */

describe("OptionsDataClient.loadOption", () => {
  it("maps raw option rows to OptionBar (strike/side/oi attached) and coerces bigint", async () => {
    const { fn, calls } = fakeQuery(() => [
      {
        timestamp: "2026-01-15 09:20:00",
        open: 50,
        high: 55,
        low: 48,
        close: 52,
        volume: 1200n,
        open_interest: 90000n,
      },
    ]);
    const client = new OptionsDataClient({ query: fn });
    const bars = await client.loadOption(
      "NIFTY",
      "2026-01-29",
      21500,
      "CE",
      "2026-01-15",
      "2026-01-29"
    );

    expect(bars).toEqual([
      {
        ts: "2026-01-15 09:20:00",
        open: 50,
        high: 55,
        low: 48,
        close: 52,
        volume: 1200,
        strike: 21500,
        optionType: "CE",
        oi: 90000,
      },
    ]);
    // Predicate pushdown present in the emitted SQL.
    expect(calls[0]).toContain("AND strike = 21500");
    expect(calls[0]).toContain("AND option_type = 'CE'");
  });

  it("routes a coarser option interval to the resample builder", async () => {
    const { fn, calls } = fakeQuery(() => []);
    const client = new OptionsDataClient({ query: fn });
    await client.loadOption("NIFTY", "2026-01-29", 21500, "PE", "2026-01-15", "2026-01-29", "15m");
    expect(calls[0]).toContain("time_bucket(INTERVAL '15 minutes'");
    expect(calls[0]).toContain("last(open_interest ORDER BY timestamp)");
  });
});

/* ─────────────────────────────── atmStrike ───────────────────────────────── */

describe("OptionsDataClient.atmStrike", () => {
  it("returns the exact-minute ATM when the spot bar is present (one query)", async () => {
    const { fn, calls } = fakeQuery((sql) =>
      sql.includes("ORDER BY timestamp DESC") ? [] : [{ atm_strike: 21500 }]
    );
    const client = new OptionsDataClient({ query: fn });
    const atm = await client.atmStrike("NIFTY", "2026-01-29", "2026-01-15 09:20:00");
    expect(atm).toBe(21500);
    expect(calls).toHaveLength(1); // no as-of fallback needed
  });

  it("falls back to the as-of bar when the exact minute is missing", async () => {
    const { fn, calls } = fakeQuery((sql) =>
      sql.includes("ORDER BY timestamp DESC") ? [{ atm_strike: 21450 }] : []
    );
    const client = new OptionsDataClient({ query: fn });
    const atm = await client.atmStrike("NIFTY", "2026-01-29", "2026-01-15 09:20:00");
    expect(atm).toBe(21450);
    expect(calls).toHaveLength(2); // exact (empty) → as-of fallback
  });

  it("throws when no spot bar exists at or before the timestamp", async () => {
    const { fn } = fakeQuery(() => []);
    const client = new OptionsDataClient({ query: fn });
    await expect(client.atmStrike("NIFTY", "2026-01-29", "2026-01-15 09:20:00")).rejects.toThrow(
      /no spot bar/
    );
  });

  it("coerces a bigint ATM cell to a number", async () => {
    const { fn } = fakeQuery(() => [{ atm_strike: 50000n }]);
    const client = new OptionsDataClient({ query: fn });
    expect(await client.atmStrike("BANKNIFTY", "2026-01-29", "2026-01-15 09:20:00")).toBe(50000);
  });
});

/* ────────────────────────────── coverageFor ──────────────────────────────── */

describe("OptionsDataClient.coverageFor", () => {
  it("assembles a §2 CoverageReport with per-strike CE/PE and overallCoverage", async () => {
    const { fn } = fakeQuery(() => [
      {
        strike: 21450,
        option_type: "CE",
        present_bars: 2000,
        days: 9,
        coverage: 0.61,
        med_vol: 120,
      },
      {
        strike: 21500,
        option_type: "CE",
        present_bars: 4000,
        days: 11,
        coverage: 0.98,
        med_vol: 4200,
      },
      {
        strike: 21500,
        option_type: "PE",
        present_bars: 3900,
        days: 11,
        coverage: 0.95,
        med_vol: 3900,
      },
    ]);
    const client = new OptionsDataClient({ query: fn });
    const report = await client.coverageFor("NIFTY", "2026-01-29", "2026-01-15", "2026-01-29");

    expect(report.symbol).toBe("NIFTY");
    expect(report.expiry).toBe("2026-01-29");
    expect(report.strikeStep).toBe(50);
    expect(report.expectedBarsPerDay).toBe(375);
    expect(report.strikes["21450"]).toEqual({
      CE: { coverage: 0.61, medVol: 120, days: 9 },
      PE: null,
    });
    expect(report.strikes["21500"]).toEqual({
      CE: { coverage: 0.98, medVol: 4200, days: 11 },
      PE: { coverage: 0.95, medVol: 3900, days: 11 },
    });
    // mean of 0.61, 0.98, 0.95.
    expect(report.overallCoverage).toBeCloseTo((0.61 + 0.98 + 0.95) / 3, 10);
  });

  it("returns overallCoverage 0 and empty strikes for an empty window", async () => {
    const { fn } = fakeQuery(() => []);
    const client = new OptionsDataClient({ query: fn });
    const report = await client.coverageFor("SENSEX", "2026-01-29", "2026-01-15", "2026-01-29");
    expect(report.overallCoverage).toBe(0);
    expect(report.strikes).toEqual({});
    expect(report.strikeStep).toBe(100);
  });
});

/* ───────────────────────────── resolveStrike ─────────────────────────────── */

/** A coverage report fixture with well-covered ATM strikes and a sparse far one. */
const COVERAGE_FIXTURE: RawCoverage[] = [
  { strike: 21400, option_type: "CE", present_bars: 0, days: 0, coverage: 0.0, med_vol: 0 },
  { strike: 21450, option_type: "CE", present_bars: 2000, days: 9, coverage: 0.61, med_vol: 120 },
  { strike: 21500, option_type: "CE", present_bars: 4000, days: 11, coverage: 0.98, med_vol: 4200 },
  { strike: 21550, option_type: "CE", present_bars: 4000, days: 11, coverage: 0.97, med_vol: 4000 },
];
interface RawCoverage {
  strike: number;
  option_type: string;
  present_bars: number;
  days: number;
  coverage: number;
  med_vol: number;
}

describe("OptionsDataClient.resolveStrike", () => {
  it("resolves an EXACT, well-covered strike to reason 'exact' (served === requested)", async () => {
    const { fn } = fakeQuery(() => COVERAGE_FIXTURE);
    const client = new OptionsDataClient({ query: fn });
    const res = await client.resolveStrike(
      "NIFTY",
      "2026-01-29",
      21500,
      "CE",
      "2026-01-15",
      "2026-01-29"
    );

    expect(res.served).toBe(21500);
    expect(res.requested).toBe(21500);
    expect(res.reason).toBe("exact");
    expect(res.distancePts).toBe(0);
    expect(res.coveragePct).toBeCloseTo(0.98, 10);
    expect(res.illiquid).toBe(false);
  });

  it("walks to a nearest well-covered substitute (reason 'nearest')", async () => {
    // Request 21400 (its own coverage is 0, below the 0.6 floor) → the resolver
    // walks outward by strike step to the nearest strike clearing ≥0.6: 21450
    // (+1 step, coverage 0.61).
    const { fn } = fakeQuery(() => COVERAGE_FIXTURE);
    const client = new OptionsDataClient({ query: fn });
    const res = await client.resolveStrike(
      "NIFTY",
      "2026-01-29",
      21400,
      "CE",
      "2026-01-15",
      "2026-01-29"
    );

    expect(res.reason).toBe("nearest");
    expect(res.served).toBe(21450); // +50 pts (nearest ≥0.6 coverage)
    expect(res.requested).toBe(21400);
    expect(res.distancePts).toBe(50);
  });

  it("returns the MISSING_LEG path (reason 'none', served null) when no strike clears", async () => {
    // Only a single, far, EMPTY-coverage strike exists → the engine resolver's D2
    // hard-fail ceiling rejects it → null → wire reason 'none'.
    const { fn } = fakeQuery(() => [
      { strike: 30000, option_type: "CE", present_bars: 10, days: 1, coverage: 0.02, med_vol: 1 },
    ]);
    const client = new OptionsDataClient({ query: fn });
    const res = await client.resolveStrike(
      "NIFTY",
      "2026-01-29",
      21500,
      "CE",
      "2026-01-15",
      "2026-01-29"
    );

    expect(res.reason).toBe("none");
    expect(res.served).toBeNull();
    expect(res.distancePts).toBe(Infinity);
    expect(res.coveragePct).toBe(0);
    expect(res.illiquid).toBe(true);
  });

  it("returns reason 'none' when the chain is entirely empty (no contracts)", async () => {
    const { fn } = fakeQuery(() => []);
    const client = new OptionsDataClient({ query: fn });
    const res = await client.resolveStrike(
      "NIFTY",
      "2026-01-29",
      21500,
      "CE",
      "2026-01-15",
      "2026-01-29"
    );
    expect(res.reason).toBe("none");
    expect(res.served).toBeNull();
  });
});

/* ───────────────────────────── optionChainAt ─────────────────────────────── */

describe("OptionsDataClient.optionChainAt", () => {
  it("returns one OptionBar per (strike, side) snapshot with o/h/l/c = the close", async () => {
    const { fn, calls } = fakeQuery(() => [
      { strike: 21500, option_type: "CE", close: 52, volume: 1200, open_interest: 90000 },
      { strike: 21500, option_type: "PE", close: 48, volume: 1100, open_interest: 88000 },
    ]);
    const client = new OptionsDataClient({ query: fn });
    const chain = await client.optionChainAt("NIFTY", "2026-01-29", "2026-01-15 09:20:00");

    expect(chain).toHaveLength(2);
    expect(chain[0]).toEqual({
      ts: "2026-01-15 09:20:00",
      open: 52,
      high: 52,
      low: 52,
      close: 52,
      volume: 1200,
      strike: 21500,
      optionType: "CE",
      oi: 90000,
    });
    expect(calls[0]).toContain("WHERE timestamp = TIMESTAMPTZ '2026-01-15 09:20:00+05:30'");
  });
});

/* ──────────────────────────── pure helper tests ──────────────────────────── */

describe("boundary helpers", () => {
  it("toTsString trims ISO 'T' / sub-second / Z to 'YYYY-MM-DD HH:MM:SS'", () => {
    expect(toTsString("2026-01-15T09:15:00.000Z")).toBe("2026-01-15 09:15:00");
    expect(toTsString("2026-01-15 09:15:00")).toBe("2026-01-15 09:15:00");
  });

  it("toTsString renders an epoch-ms number as a wall-clock string", () => {
    const ms = Date.parse("2026-01-15T09:15:00.000Z");
    expect(toTsString(ms)).toBe("2026-01-15 09:15:00");
  });

  it("chainFromCoverage drops null sides and keeps present CE/PE", () => {
    const report: CoverageReport = {
      symbol: "NIFTY",
      expiry: "2026-01-29",
      datasetVersion: 1,
      tradingDays: [],
      expectedBarsPerDay: 375,
      strikeStep: 50,
      overallCoverage: 0.8,
      strikes: {
        "21500": { CE: { coverage: 0.98, medVol: 4200, days: 11 }, PE: null },
        "21550": { CE: null, PE: { coverage: 0.9, medVol: 3000, days: 11 } },
      },
    };
    const chain = chainFromCoverage(report);
    expect(chain).toEqual([
      { strike: 21500, optionType: "CE", coverage: 0.98, medVol: 4200 },
      { strike: 21550, optionType: "PE", coverage: 0.9, medVol: 3000 },
    ]);
  });

  it("buildCoverageReport clamps over-counted coverage to 1", () => {
    const report = buildCoverageReport("NIFTY", "2026-01-29", [
      {
        strike: 21500,
        option_type: "CE",
        present_bars: 9999,
        days: 11,
        coverage: 1.4,
        med_vol: 4200,
      },
    ]);
    expect(report.strikes["21500"]?.CE?.coverage).toBe(1);
    expect(report.overallCoverage).toBe(1);
  });
});
