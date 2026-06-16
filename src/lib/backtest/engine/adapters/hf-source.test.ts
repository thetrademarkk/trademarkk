/**
 * hf-source.ts unit tests — exercise the HF DataSource adapter with a MOCKED
 * QueryFn (no duckdb-wasm, no network, no browser). We assert:
 *   - the IST-string → epoch-ms boundary conversion (the one conversion unique
 *     to HF), against the engine's own minuteOfDayIST / resample IST offset;
 *   - the pure planning helpers (strike band from the strategy, day×expiry spine);
 *   - the prefetch assembles a FixtureDataSource whose 6-fn answers match the
 *     canned rows (index series, chain availability, option series, ATM, coverage);
 *   - the SQL the adapter issues hits the right builders (a fake QueryFn records
 *     every SQL string it is handed) — i.e. all filter/project/range pushdown is
 *     in DuckDB SQL, never JS loops.
 *
 * Run ONLY scoped: `npx vitest run src/lib/backtest`.
 */

import { describe, expect, it } from "vitest";
import {
  createHfDataSource,
  hfSnapshotId,
  istStringToEpochMs,
  loadResolvedLeg,
  planDayExpiries,
  strikeBandPts,
  type HfSourceOptions,
} from "./hf-source";
import type { QueryFn, QueryResult } from "../../data/duck-browser";
import { minuteOfDayIST } from "../engine";
import { makeDefaultStrategy } from "../../../../features/backtest/shared/strategy-def";
import type { StrategyDef } from "../../../../features/backtest/shared/strategy-def";

/* ─────────────────────────── mock query helpers ──────────────────────────── */

/** Wrap canned plain-object rows as an Arrow-like QueryResult. */
function result<Row>(rows: Row[]): QueryResult<Row> {
  return { toArray: () => rows, numRows: rows.length };
}

/**
 * Build a fake QueryFn that routes by SQL content. Records every SQL string it
 * sees so a test can assert pushdown happened in SQL. `index`/`chainCE`/`chainPE`
 * provide the canned rows; anything else returns empty.
 */
function fakeQuery(opts: {
  index: Array<{
    ts: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  chainCE?: Array<Record<string, unknown>>;
  chainPE?: Array<Record<string, unknown>>;
  leg?: Array<Record<string, unknown>>;
}): { run: QueryFn; seen: string[] } {
  const seen: string[] = [];
  const run = (async <Row = Record<string, unknown>>(sql: string): Promise<QueryResult<Row>> => {
    seen.push(sql);
    if (sql.includes("index/")) return result(opts.index) as unknown as QueryResult<Row>;
    if (sql.includes("option_type = 'CE'"))
      return result(opts.chainCE ?? []) as unknown as QueryResult<Row>;
    if (sql.includes("option_type = 'PE'"))
      return result(opts.chainPE ?? []) as unknown as QueryResult<Row>;
    return result(opts.leg ?? []) as unknown as QueryResult<Row>;
  }) as QueryFn;
  return { run, seen };
}

/** A one-day NIFTY strategy (single day window) for a tight, deterministic run. */
function oneDayStrategy(day = "2026-01-16"): StrategyDef {
  const s = makeDefaultStrategy("hf-test", "NIFTY");
  s.market.dateRange = { start: day, end: day };
  return s;
}

/* ───────────────────────────── boundary: time ────────────────────────────── */

describe("istStringToEpochMs", () => {
  it("treats the string as IST (UTC+5:30) and round-trips through minuteOfDayIST", () => {
    // 09:15 IST is minute-of-day 555; 09:20 IST is 560.
    const ts915 = istStringToEpochMs("2026-01-16 09:15:00");
    const ts920 = istStringToEpochMs("2026-01-16T09:20:00");
    expect(minuteOfDayIST(ts915)).toBe(555);
    expect(minuteOfDayIST(ts920)).toBe(560);
    // 09:15 IST == 03:45 UTC.
    expect(ts915).toBe(Date.parse("2026-01-16T03:45:00.000Z"));
    // one minute apart in epoch-ms terms.
    expect(ts920 - ts915).toBe(5 * 60_000);
  });

  it("throws on a malformed timestamp (never silently shifts a bar)", () => {
    expect(() => istStringToEpochMs("2026-01-16 09:20")).toThrow();
    expect(() => istStringToEpochMs("garbage")).toThrow();
  });
});

/* ───────────────────────────── planning helpers ──────────────────────────── */

describe("strikeBandPts", () => {
  it("reserves the fallback window + cushion for a plain ATM strategy", () => {
    const s = oneDayStrategy();
    // ATM_OFFSET steps 0 → (0 + 5 fallback + 3 cushion) * 50 = 400 pts.
    expect(strikeBandPts(s)).toBe(400);
  });

  it("widens the band for a far ATM offset", () => {
    const s = oneDayStrategy();
    s.legs[0]!.strike = { mode: "ATM_OFFSET", steps: 10 };
    // (10 + 5 + 3) * 50 = 900 pts.
    expect(strikeBandPts(s)).toBe(900);
  });

  it("ignores disabled legs when sizing the band", () => {
    const s = oneDayStrategy();
    s.legs.push({
      ...s.legs[0]!,
      id: "hf-test-leg2",
      enabled: false,
      strike: { mode: "ATM_OFFSET", steps: 20 },
    });
    expect(strikeBandPts(s)).toBe(400); // disabled wide leg does not widen the band
  });
});

describe("planDayExpiries", () => {
  it("maps each trading day to a resolved expiry; skips weekends/holidays", () => {
    const s = oneDayStrategy("2026-01-16"); // a Friday trading day
    const plan = planDayExpiries(s);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.day).toBe("2026-01-16");
    expect(plan[0]!.expiry).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("honours daysOfWeek (a Tuesday-only filter drops a Friday)", () => {
    const s = oneDayStrategy("2026-01-16"); // Friday = JS weekday 5
    s.timing.daysOfWeek = [2]; // Tuesday only
    expect(planDayExpiries(s)).toHaveLength(0);
  });
});

describe("hfSnapshotId", () => {
  it("is stable and encodes dataset version + symbol + window", () => {
    const s = oneDayStrategy("2026-01-16");
    expect(hfSnapshotId(s)).toBe("hf:v1:NIFTY:2026-01-16..2026-01-16");
  });
});

/* ───────────────────────── prefetch → FixtureDataSource ───────────────────── */

const DAY = "2026-01-16";

/** A few index bars from 09:15. */
const INDEX_ROWS = [
  {
    ts: `${DAY} 09:15:00`,
    open: 21500,
    high: 21520,
    low: 21490,
    close: 21510,
    volume: 1000,
  },
  {
    ts: `${DAY} 09:16:00`,
    open: 21510,
    high: 21530,
    low: 21505,
    close: 21525,
    volume: 1200,
  },
];

/** A chain row builder (full OHLCV + oi) for the canned chain. */
function chainRow(strike: number, ot: "CE" | "PE", min: string, close: number, vol = 500) {
  return {
    strike,
    option_type: ot,
    ts: `${DAY} ${min}:00`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: vol,
    open_interest: 10000,
  };
}

describe("createHfDataSource (prefetch via mocked QueryFn)", () => {
  async function build(extra?: Partial<HfSourceOptions>) {
    const { run, seen } = fakeQuery({
      index: INDEX_ROWS,
      chainCE: [chainRow(21500, "CE", "09:15", 120), chainRow(21500, "CE", "09:16", 122)],
      chainPE: [chainRow(21500, "PE", "09:15", 110), chainRow(21500, "PE", "09:16", 108)],
    });
    const src = await createHfDataSource(oneDayStrategy(DAY), { query: run, ...extra });
    return { src, seen };
  }

  it("materializes a FixtureDataSource whose index series is epoch-ms ascending", async () => {
    const { src } = await build();
    const idx = src.loadIndex("NIFTY", DAY);
    expect(idx).toHaveLength(2);
    expect(minuteOfDayIST(idx[0]!.ts)).toBe(555);
    expect(idx[0]!.c).toBe(21510);
    expect(idx[1]!.ts).toBeGreaterThan(idx[0]!.ts);
  });

  it("exposes the chain with both sides and full-OHLCV option bars", async () => {
    const { src } = await build();
    const chain = src.optionChainAt("NIFTY", "ignored", DAY);
    const sides = new Set(chain.map((c) => c.optionType));
    expect(sides.has("CE")).toBe(true);
    expect(sides.has("PE")).toBe(true);

    const ce = src.loadOption("NIFTY", "ignored", DAY, 21500, "CE");
    expect(ce).toHaveLength(2);
    // full OHLC preserved (NOT collapsed to close) — high/low differ from close.
    expect(ce[0]!.h).toBe(121);
    expect(ce[0]!.l).toBe(119);
    expect(ce[0]!.c).toBe(120);
    expect(ce[0]!.oi).toBe(10000);
  });

  it("answers ATM from the materialized chain", async () => {
    const { src } = await build();
    const atm = src.atmStrike("NIFTY", "ignored", DAY, 21510);
    expect(atm).toBe(21500);
  });

  it("pushes all filtering into SQL (index slice, CE/PE chain by side + strike band)", async () => {
    const { seen } = await build();
    const idxSql = seen.find((s) => s.includes("index/"));
    expect(idxSql).toContain("WHERE trading_day BETWEEN '2026-01-16' AND '2026-01-16'");
    expect(idxSql).not.toContain("SELECT *");

    const ceSql = seen.find((s) => s.includes("option_type = 'CE'"));
    // band derived = 400 pts around ATM 21500.
    expect(ceSql).toContain("AND strike BETWEEN 21100 AND 21900");
    // The timestamp is rendered to an IST wall-clock string aliased `ts` (the
    // stored TIMESTAMPTZ would otherwise materialize as a Date/epoch); the OHLCV+oi
    // tail and the (strike, side) identity columns are projected verbatim.
    expect(ceSql).toContain("strike, option_type,");
    expect(ceSql).toContain("AS ts, open, high, low, close, volume, open_interest");
  });

  it("respects a bandPts override", async () => {
    const { seen } = await build({ bandPts: 100 });
    const ceSql = seen.find((s) => s.includes("option_type = 'CE'"));
    expect(ceSql).toContain("AND strike BETWEEN 21400 AND 21600");
  });

  it("emits per-day progress", async () => {
    const ticks: Array<[number, number]> = [];
    await build({ onProgress: (done, total) => ticks.push([done, total]) });
    expect(ticks).toEqual([[1, 1]]);
  });

  it("yields an empty chain when the index has no print all day (no decision)", async () => {
    const { run } = fakeQuery({ index: [], chainCE: [], chainPE: [] });
    const src = await createHfDataSource(oneDayStrategy(DAY), { query: run });
    expect(src.loadIndex("NIFTY", DAY)).toHaveLength(0);
    expect(src.optionChainAt("NIFTY", "ignored", DAY)).toHaveLength(0);
  });
});

/* ─────────────────────────── resolved-leg loader ──────────────────────────── */

describe("loadResolvedLeg", () => {
  it("reads a full-OHLCV leg via buildOptionLeg and converts at the boundary", async () => {
    const seen: string[] = [];
    const run = (async <Row = Record<string, unknown>>(sql: string) => {
      seen.push(sql);
      return result([
        {
          ts: `${DAY} 09:15:00`,
          open: 100,
          high: 105,
          low: 98,
          close: 102,
          volume: 50,
          open_interest: 9000,
        },
      ]) as unknown as QueryResult<Row>;
    }) as QueryFn;

    const bars = await loadResolvedLeg("NIFTY", "2026-01-29", DAY, 21500, "CE", run);
    expect(bars).toHaveLength(1);
    expect(bars[0]!.o).toBe(100);
    expect(bars[0]!.h).toBe(105);
    expect(bars[0]!.oi).toBe(9000);
    expect(minuteOfDayIST(bars[0]!.ts)).toBe(555);
    // SQL pushed strike + side + day.
    expect(seen[0]).toContain("AND strike = 21500");
    expect(seen[0]).toContain("AND option_type = 'CE'");
  });
});
