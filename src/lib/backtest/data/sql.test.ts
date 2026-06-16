/**
 * sql.ts unit tests — assert the GENERATED SQL string for representative inputs
 * (07-data-layer.md §4 / §5 / §7) and the strict literal quoters. These are pure
 * string assertions: no DuckDB, no network, runnable in node/vitest. The
 * resample SQL is checked to mirror resample.ts semantics (session-aligned
 * time_bucket, first/max/min/last/sum, per-day grouping).
 */

import { describe, expect, it } from "vitest";
import { SESSION_MINUTES } from "./interval";
import {
  SESSION_ORIGIN,
  buildAtmAsOf,
  buildAtmFromSpot,
  buildChainSlice,
  buildChainSnapshot,
  buildCoverageAgg,
  buildGapGrid,
  buildIndexResample,
  buildIndexSlice,
  buildOptionLeg,
  buildOptionLegResample,
  buildStrikeRange,
  sqlDate,
  sqlInt,
  sqlOptionType,
  sqlSource,
  sqlStr,
  sqlTimestamp,
} from "./sql";

const IDX_URL =
  "https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/index/NIFTY.parquet";
const OPT_URL =
  "https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/options/NIFTY/2026-01-29.parquet";

describe("literal quoters", () => {
  it("sqlStr doubles single quotes", () => {
    expect(sqlStr("a'b")).toBe("'a''b'");
    expect(sqlStr("plain")).toBe("'plain'");
  });

  it("sqlDate accepts YYYY-MM-DD and rejects junk", () => {
    expect(sqlDate("2026-01-15")).toBe("DATE '2026-01-15'");
    expect(() => sqlDate("2026/01/15")).toThrow();
    expect(() => sqlDate("15-01-2026")).toThrow();
    expect(() => sqlDate("2026-1-5")).toThrow();
    expect(() => sqlDate("'; DROP TABLE x; --")).toThrow();
  });

  it("sqlTimestamp accepts space or T and normalizes to a space", () => {
    expect(sqlTimestamp("2026-01-15 09:20:00")).toBe("TIMESTAMP '2026-01-15 09:20:00'");
    expect(sqlTimestamp("2026-01-15T09:20:00")).toBe("TIMESTAMP '2026-01-15 09:20:00'");
    expect(() => sqlTimestamp("2026-01-15 09:20")).toThrow();
    expect(() => sqlTimestamp("not-a-ts")).toThrow();
  });

  it("sqlInt rejects non-integers", () => {
    expect(sqlInt(21500)).toBe("21500");
    expect(sqlInt(-50)).toBe("-50");
    expect(() => sqlInt(21500.5)).toThrow();
    expect(() => sqlInt(NaN)).toThrow();
  });

  it("sqlOptionType only allows CE/PE", () => {
    expect(sqlOptionType("CE")).toBe("'CE'");
    expect(sqlOptionType("PE")).toBe("'PE'");
    // @ts-expect-error — invalid side rejected at runtime too
    expect(() => sqlOptionType("XX")).toThrow();
  });

  it("sqlSource refuses URLs with quotes or whitespace", () => {
    expect(sqlSource(IDX_URL)).toBe(`'${IDX_URL}'`);
    expect(() => sqlSource("https://x/'evil'.parquet")).toThrow();
    expect(() => sqlSource("https://x/ a.parquet")).toThrow();
  });
});

describe("buildIndexSlice (§4a raw)", () => {
  it("projects OHLCV only, pushes trading_day, orders by timestamp", () => {
    const sql = buildIndexSlice({ url: IDX_URL, from: "2026-01-01", to: "2026-03-31" });
    expect(sql).toBe(
      [
        "SELECT timestamp, open, high, low, close, volume",
        `FROM read_parquet('${IDX_URL}')`,
        "WHERE trading_day BETWEEN DATE '2026-01-01' AND DATE '2026-03-31'",
        "ORDER BY timestamp",
      ].join("\n")
    );
  });

  it("never emits SELECT *", () => {
    const sql = buildIndexSlice({ url: IDX_URL, from: "2026-01-01", to: "2026-01-02" });
    expect(sql).not.toContain("SELECT *");
  });
});

describe("buildIndexResample (§4a resampled, mirrors resample.ts)", () => {
  it("uses session-aligned time_bucket with the 09:15 origin + per-day grouping", () => {
    const sql = buildIndexResample({
      url: IDX_URL,
      from: "2026-01-01",
      to: "2026-03-31",
      intervalMinutes: 5,
    });
    expect(sql).toContain(
      `time_bucket(INTERVAL '5 minutes', timestamp, TIMESTAMP '${SESSION_ORIGIN}') AS ts`
    );
    // resample.ts aggregation contract, verbatim
    expect(sql).toContain("first(open ORDER BY timestamp) AS open");
    expect(sql).toContain("max(high) AS high");
    expect(sql).toContain("min(low) AS low");
    expect(sql).toContain("last(close ORDER BY timestamp) AS close");
    expect(sql).toContain("sum(volume) AS volume");
    // buckets never cross a trading day → group on trading_day AND the bucket
    expect(sql).toContain("GROUP BY trading_day, ts");
    expect(sql).toContain("ORDER BY ts");
  });

  it("the SESSION_ORIGIN is 09:15 (matches resample SESSION_OPEN_MIN 555)", () => {
    expect(SESSION_ORIGIN).toBe("1970-01-01 09:15:00");
  });
});

describe("buildOptionLeg (§4b predicate pushdown)", () => {
  it("pushes trading_day + strike + option_type, projects OHLCV+oi", () => {
    const sql = buildOptionLeg({
      url: OPT_URL,
      strike: 21500,
      optionType: "CE",
      from: "2026-01-15",
      to: "2026-01-29",
    });
    expect(sql).toBe(
      [
        "SELECT timestamp, open, high, low, close, volume, open_interest",
        `FROM read_parquet('${OPT_URL}')`,
        "WHERE trading_day BETWEEN DATE '2026-01-15' AND DATE '2026-01-29'",
        "  AND strike = 21500",
        "  AND option_type = 'CE'",
        "ORDER BY timestamp",
      ].join("\n")
    );
  });
});

describe("buildOptionLegResample", () => {
  it("carries open_interest as last() in the bucket", () => {
    const sql = buildOptionLegResample({
      url: OPT_URL,
      strike: 21500,
      optionType: "PE",
      from: "2026-01-15",
      to: "2026-01-29",
      intervalMinutes: 15,
    });
    expect(sql).toContain("last(open_interest ORDER BY timestamp) AS open_interest");
    expect(sql).toContain("INTERVAL '15 minutes'");
    expect(sql).toContain("AND option_type = 'PE'");
    expect(sql).toContain("GROUP BY trading_day, ts");
  });
});

describe("buildStrikeRange (§4c)", () => {
  it("range-pushes strike around atm ± band", () => {
    const sql = buildStrikeRange({
      url: OPT_URL,
      optionType: "CE",
      atm: 21500,
      bandPts: 300,
      from: "2026-01-15",
      to: "2026-01-29",
    });
    expect(sql).toContain("AND strike BETWEEN 21200 AND 21800");
    expect(sql).toContain("AND option_type = 'CE'");
    expect(sql).toContain("SELECT strike, option_type, timestamp, close, volume, open_interest");
    expect(sql).toContain("ORDER BY strike, timestamp");
  });

  it("rejects a negative band", () => {
    expect(() =>
      buildStrikeRange({
        url: OPT_URL,
        optionType: "CE",
        atm: 21500,
        bandPts: -10,
        from: "2026-01-15",
        to: "2026-01-29",
      })
    ).toThrow();
  });
});

describe("buildChainSlice (§4c full-OHLCV chain)", () => {
  it("projects full OHLCV+oi for every strike in the band, range-pushed", () => {
    const sql = buildChainSlice({
      url: OPT_URL,
      optionType: "PE",
      atm: 21500,
      bandPts: 400,
      from: "2026-01-15",
      to: "2026-01-15",
    });
    expect(sql).toContain(
      "SELECT strike, option_type, timestamp, open, high, low, close, volume, open_interest"
    );
    expect(sql).toContain("AND option_type = 'PE'");
    expect(sql).toContain("AND strike BETWEEN 21100 AND 21900");
    expect(sql).toContain("WHERE trading_day BETWEEN DATE '2026-01-15' AND DATE '2026-01-15'");
    expect(sql).toContain("ORDER BY strike, timestamp");
    expect(sql).not.toContain("SELECT *");
  });

  it("rejects a negative band", () => {
    expect(() =>
      buildChainSlice({
        url: OPT_URL,
        optionType: "CE",
        atm: 21500,
        bandPts: -1,
        from: "2026-01-15",
        to: "2026-01-15",
      })
    ).toThrow();
  });
});

describe("buildChainSnapshot (§2 optionChainAt)", () => {
  it("one row per (strike, side) at an exact timestamp", () => {
    const sql = buildChainSnapshot({ url: OPT_URL, at: "2026-01-15 09:20:00" });
    expect(sql).toContain("SELECT strike, option_type, close, volume, open_interest");
    expect(sql).toContain("WHERE timestamp = TIMESTAMP '2026-01-15 09:20:00'");
    expect(sql).toContain("ORDER BY strike, option_type");
  });
});

describe("buildAtmFromSpot / buildAtmAsOf (§5)", () => {
  it("snaps spot close to the step at an exact minute", () => {
    const sql = buildAtmFromSpot({ url: IDX_URL, at: "2026-01-15 09:20:00", step: 50 });
    expect(sql).toBe(
      [
        "SELECT CAST(round(close / 50) * 50 AS INTEGER) AS atm_strike",
        `FROM read_parquet('${IDX_URL}')`,
        "WHERE timestamp = TIMESTAMP '2026-01-15 09:20:00'",
      ].join("\n")
    );
  });

  it("as-of variant takes the last bar at or before the time", () => {
    const sql = buildAtmAsOf({ url: IDX_URL, at: "2026-01-15 09:20:00", step: 100 });
    expect(sql).toContain("WHERE timestamp <= TIMESTAMP '2026-01-15 09:20:00'");
    expect(sql).toContain("ORDER BY timestamp DESC");
    expect(sql).toContain("LIMIT 1");
    expect(sql).toContain("round(close / 100) * 100");
  });
});

describe("buildCoverageAgg (§7a)", () => {
  it("aggregates coverage = present/(days*expected), median volume, distinct days", () => {
    const sql = buildCoverageAgg({ url: OPT_URL, from: "2026-01-15", to: "2026-01-29" });
    expect(sql).toContain("count(*) AS present_bars");
    expect(sql).toContain("count(DISTINCT trading_day) AS days");
    expect(sql).toContain(`count(*) * 1.0 / (count(DISTINCT trading_day) * ${SESSION_MINUTES})`);
    expect(sql).toContain("median(volume) AS med_vol");
    expect(sql).toContain("GROUP BY strike, option_type");
  });

  it("honors a custom expectedBarsPerDay", () => {
    const sql = buildCoverageAgg({
      url: OPT_URL,
      from: "2026-01-15",
      to: "2026-01-29",
      expectedBarsPerDay: 100,
    });
    expect(sql).toContain("count(DISTINCT trading_day) * 100)");
  });
});

describe("buildGapGrid (§7c)", () => {
  it("builds a 09:15→15:30 minute grid LEFT JOINed to the leg, flags is_gap", () => {
    const sql = buildGapGrid({
      url: OPT_URL,
      day: "2026-01-15",
      strike: 21500,
      optionType: "CE",
    });
    expect(sql).toContain(
      "range(TIMESTAMP '2026-01-15 09:15:00', TIMESTAMP '2026-01-15 15:30:00', INTERVAL '1 minute')"
    );
    expect(sql).toContain("LEFT JOIN bars b ON g.ts = b.timestamp");
    expect(sql).toContain("(b.close IS NULL) AS is_gap");
    expect(sql).toContain("WHERE trading_day = DATE '2026-01-15'");
    expect(sql).toContain("AND strike = 21500");
    expect(sql).toContain("AND option_type = 'CE'");
  });
});
