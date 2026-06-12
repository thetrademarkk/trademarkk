import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  decodeFiltersFromSearch,
  encodeFiltersToSearch,
  filterTrades,
  hasActiveFilters,
  matchesTrade,
  sanitizeFilters,
  type AdvancedTradeFilters,
  type RuleDayContext,
} from "./filter-predicate";
import type { TradeWithMeta } from "./types";

/** Local-time ISO instant so weekday/date assertions are TZ-independent. */
const at = (y: number, m: number, d: number, hh = 10, mm = 0) =>
  new Date(y, m - 1, d, hh, mm).toISOString();

const key = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

let seq = 0;
function mk(over: Partial<TradeWithMeta> = {}): TradeWithMeta {
  seq++;
  return {
    id: `t${seq}`,
    account_id: "acc1",
    symbol: "NIFTY",
    exchange: "NSE",
    segment: "OPT",
    expiry: null,
    strike: 24500,
    option_type: "CE",
    direction: "long",
    status: "closed",
    qty: 75,
    avg_entry: 100,
    avg_exit: 110,
    planned_entry: null,
    planned_sl: null,
    planned_target: null,
    opened_at: at(2026, 6, 8), // Monday
    closed_at: at(2026, 6, 8, 11),
    gross_pnl: 750,
    charges: 50,
    net_pnl: 700,
    r_multiple: 1.5,
    playbook_id: null,
    confidence: null,
    notes: null,
    created_at: at(2026, 6, 8),
    updated_at: at(2026, 6, 8),
    tags: [],
    playbook_name: null,
    ...over,
  };
}

describe("matchesTrade — single criteria", () => {
  it("symbol: case-insensitive substring", () => {
    const t = mk({ symbol: "BANKNIFTY" });
    expect(matchesTrade(t, { symbol: "nifty" })).toBe(true);
    expect(matchesTrade(t, { symbol: "BANK" })).toBe(true);
    expect(matchesTrade(t, { symbol: "RELIANCE" })).toBe(false);
  });

  it("symbol: whitespace-only filter is ignored", () => {
    expect(matchesTrade(mk(), { symbol: "   " })).toBe(true);
  });

  it("segments: any-of multi-select", () => {
    expect(matchesTrade(mk({ segment: "FUT" }), { segments: ["OPT", "FUT"] })).toBe(true);
    expect(matchesTrade(mk({ segment: "EQ" }), { segments: ["OPT", "FUT"] })).toBe(false);
  });

  it("direction", () => {
    expect(matchesTrade(mk({ direction: "short" }), { direction: "short" })).toBe(true);
    expect(matchesTrade(mk({ direction: "long" }), { direction: "short" })).toBe(false);
  });

  it("result: win/loss on closed trades; breakeven matches neither", () => {
    expect(matchesTrade(mk({ net_pnl: 700 }), { result: "win" })).toBe(true);
    expect(matchesTrade(mk({ net_pnl: -300 }), { result: "loss" })).toBe(true);
    expect(matchesTrade(mk({ net_pnl: 0 }), { result: "win" })).toBe(false);
    expect(matchesTrade(mk({ net_pnl: 0 }), { result: "loss" })).toBe(false);
  });

  it("result: open trades never match", () => {
    const open = mk({ status: "open", avg_exit: null, net_pnl: 0 });
    expect(matchesTrade(open, { result: "win" })).toBe(false);
    expect(matchesTrade(open, { result: "loss" })).toBe(false);
  });

  it("playbookIds: matches selected; null playbook never matches", () => {
    expect(matchesTrade(mk({ playbook_id: "pb1" }), { playbookIds: ["pb1", "pb2"] })).toBe(true);
    expect(matchesTrade(mk({ playbook_id: "pb3" }), { playbookIds: ["pb1"] })).toBe(false);
    expect(matchesTrade(mk({ playbook_id: null }), { playbookIds: ["pb1"] })).toBe(false);
  });

  it("tagIds: at least one selected tag on the trade", () => {
    const tag = { id: "g1", name: "FOMO", kind: "emotion" as const, color: "#f00" };
    expect(matchesTrade(mk({ tags: [tag] }), { tagIds: ["g1", "g9"] })).toBe(true);
    expect(matchesTrade(mk({ tags: [tag] }), { tagIds: ["g2"] })).toBe(false);
    expect(matchesTrade(mk({ tags: [] }), { tagIds: ["g1"] })).toBe(false);
  });

  it("weekday: local day of the entry time", () => {
    const monday = mk({ opened_at: at(2026, 6, 8) });
    const friday = mk({ opened_at: at(2026, 6, 12) });
    expect(matchesTrade(monday, { weekdays: [1] })).toBe(true);
    expect(matchesTrade(friday, { weekdays: [1, 2] })).toBe(false);
    expect(matchesTrade(friday, { weekdays: [5] })).toBe(true);
  });
});

describe("matchesTrade — edge ranges", () => {
  it("R band is inclusive at both bounds", () => {
    const t = mk({ r_multiple: 1.5 });
    expect(matchesTrade(t, { rMin: 1.5 })).toBe(true);
    expect(matchesTrade(t, { rMax: 1.5 })).toBe(true);
    expect(matchesTrade(t, { rMin: 1.5, rMax: 1.5 })).toBe(true);
    expect(matchesTrade(t, { rMin: 1.51 })).toBe(false);
    expect(matchesTrade(t, { rMax: 1.49 })).toBe(false);
  });

  it("R: trades without an R never match an R bound", () => {
    const t = mk({ r_multiple: null });
    expect(matchesTrade(t, { rMin: -10 })).toBe(false);
    expect(matchesTrade(t, { rMax: 10 })).toBe(false);
    expect(matchesTrade(t, {})).toBe(true);
  });

  it("R: negative-only band (losers worse than -1R)", () => {
    expect(matchesTrade(mk({ r_multiple: -2 }), { rMax: -1 })).toBe(true);
    expect(matchesTrade(mk({ r_multiple: -0.5 }), { rMax: -1 })).toBe(false);
  });

  it("inverted band (min > max) matches nothing", () => {
    expect(matchesTrade(mk({ r_multiple: 1.5 }), { rMin: 2, rMax: 1 })).toBe(false);
    expect(matchesTrade(mk({ net_pnl: 500 }), { pnlMin: 1000, pnlMax: 0 })).toBe(false);
  });

  it("P&L band is inclusive; open trades never match", () => {
    const t = mk({ net_pnl: 700 });
    expect(matchesTrade(t, { pnlMin: 700 })).toBe(true);
    expect(matchesTrade(t, { pnlMax: 700 })).toBe(true);
    expect(matchesTrade(t, { pnlMin: 700.01 })).toBe(false);
    const open = mk({ status: "open", avg_exit: null, net_pnl: 0 });
    expect(matchesTrade(open, { pnlMin: -100000 })).toBe(false);
  });

  it("P&L: zero bounds keep sign semantics (min 0 includes breakeven)", () => {
    expect(matchesTrade(mk({ net_pnl: 0 }), { pnlMin: 0 })).toBe(true);
    expect(matchesTrade(mk({ net_pnl: -0.01 }), { pnlMin: 0 })).toBe(false);
  });

  it("date band is inclusive on local entry dates", () => {
    const t = mk({ opened_at: at(2026, 6, 8, 9, 30) });
    expect(matchesTrade(t, { dateFrom: key(2026, 6, 8) })).toBe(true);
    expect(matchesTrade(t, { dateTo: key(2026, 6, 8) })).toBe(true);
    expect(matchesTrade(t, { dateFrom: key(2026, 6, 9) })).toBe(false);
    expect(matchesTrade(t, { dateTo: key(2026, 6, 7) })).toBe(false);
    expect(matchesTrade(t, { dateFrom: key(2026, 6, 1), dateTo: key(2026, 6, 30) })).toBe(true);
  });
});

describe("matchesTrade — rule-adherence day filter", () => {
  const ctx: RuleDayContext = {
    brokenDates: new Set([key(2026, 6, 8)]),
    checkedDates: new Set([key(2026, 6, 8), key(2026, 6, 9)]),
  };
  const onBrokenDay = mk({ opened_at: at(2026, 6, 8) });
  const onCleanDay = mk({ opened_at: at(2026, 6, 9) });
  const onUncheckedDay = mk({ opened_at: at(2026, 6, 10) });

  it("broken: only trades on days with a broken rule", () => {
    expect(matchesTrade(onBrokenDay, { ruleCheck: "broken" }, ctx)).toBe(true);
    expect(matchesTrade(onCleanDay, { ruleCheck: "broken" }, ctx)).toBe(false);
    expect(matchesTrade(onUncheckedDay, { ruleCheck: "broken" }, ctx)).toBe(false);
  });

  it("clean: checked days with zero broken rules; unchecked days match neither", () => {
    expect(matchesTrade(onCleanDay, { ruleCheck: "clean" }, ctx)).toBe(true);
    expect(matchesTrade(onBrokenDay, { ruleCheck: "clean" }, ctx)).toBe(false);
    expect(matchesTrade(onUncheckedDay, { ruleCheck: "clean" }, ctx)).toBe(false);
  });

  it("without day context the criterion is ignored (page gates rendering)", () => {
    expect(matchesTrade(onUncheckedDay, { ruleCheck: "broken" })).toBe(true);
  });
});

describe("matchesTrade — combined criteria AND together", () => {
  const f: AdvancedTradeFilters = {
    symbol: "NIFTY",
    segments: ["OPT"],
    direction: "short",
    result: "win",
    pnlMin: 100,
    weekdays: [1, 2, 3, 4, 5],
  };
  const match = mk({ symbol: "BANKNIFTY", direction: "short", net_pnl: 700 });

  it("passes when every criterion passes", () => {
    expect(matchesTrade(match, f)).toBe(true);
  });

  it.each([
    ["symbol", { symbol: "RELIANCE" }],
    ["segment", { segment: "FUT" as const }],
    ["direction", { direction: "long" as const }],
    ["result", { net_pnl: -50 }],
    ["pnl band", { net_pnl: 99 }],
    ["weekday", { opened_at: at(2026, 6, 7) }], // Sunday
  ])("fails when %s fails", (_name, over) => {
    expect(matchesTrade(mk({ ...match, ...over, id: "x" }), f)).toBe(false);
  });

  it("filterTrades returns only matching trades (and all trades on empty filters)", () => {
    const trades = [
      mk({ symbol: "NIFTY", net_pnl: 500 }),
      mk({ symbol: "NIFTY", net_pnl: -500 }),
      mk({ symbol: "RELIANCE", segment: "EQ", net_pnl: 200 }),
    ];
    expect(filterTrades(trades, {})).toHaveLength(3);
    expect(filterTrades(trades, { symbol: "NIFTY", result: "win" })).toHaveLength(1);
    expect(filterTrades(trades, { segments: ["EQ"] })).toHaveLength(1);
  });
});

describe("countActiveFilters / hasActiveFilters", () => {
  it("counts criterion groups, not individual fields", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(hasActiveFilters({})).toBe(false);
    expect(countActiveFilters({ rMin: 1, rMax: 2 })).toBe(1);
    expect(countActiveFilters({ dateFrom: "2026-06-01", dateTo: "2026-06-30" })).toBe(1);
    expect(
      countActiveFilters({ symbol: "N", segments: ["OPT"], direction: "long", ruleCheck: "clean" })
    ).toBe(4);
    expect(countActiveFilters({ symbol: "  " })).toBe(0);
  });
});

describe("sanitizeFilters", () => {
  it("returns empty filters for non-objects", () => {
    expect(sanitizeFilters(null)).toEqual({});
    expect(sanitizeFilters("seg=OPT")).toEqual({});
    expect(sanitizeFilters(42)).toEqual({});
  });

  it("drops invalid enum values and keeps valid ones", () => {
    const f = sanitizeFilters({
      segments: ["OPT", "BAD", 7],
      direction: "sideways",
      result: "win",
      ruleCheck: "nope",
    });
    expect(f).toEqual({ segments: ["OPT"], result: "win" });
  });

  it("drops non-finite numbers and blank strings", () => {
    expect(sanitizeFilters({ rMin: "abc", rMax: Infinity, pnlMin: " ", pnlMax: "-500" })).toEqual({
      pnlMax: -500,
    });
  });

  it("validates dates as YYYY-MM-DD", () => {
    expect(sanitizeFilters({ dateFrom: "12/06/2026", dateTo: "2026-06-12" })).toEqual({
      dateTo: "2026-06-12",
    });
  });

  it("dedupes, clamps and sorts weekdays to 0–6", () => {
    expect(sanitizeFilters({ weekdays: [5, 1, 1, 9, -1, "3"] })).toEqual({ weekdays: [1, 3, 5] });
  });

  it("dedupes id lists and caps their size", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id${i}`);
    const f = sanitizeFilters({ tagIds: [...ids, "id0", ""], playbookIds: "not-an-array" });
    expect(f.tagIds).toHaveLength(50);
    expect(f.playbookIds).toBeUndefined();
  });

  it("clamps overlong symbol text", () => {
    expect(sanitizeFilters({ symbol: "X".repeat(200) }).symbol).toHaveLength(64);
  });
});

describe("URL codec", () => {
  it("segments normalize to canonical EQ/FUT/OPT order", () => {
    expect(sanitizeFilters({ segments: ["OPT", "EQ"] })).toEqual({ segments: ["EQ", "OPT"] });
  });

  it("roundtrips a full filter set", () => {
    const f: AdvancedTradeFilters = {
      symbol: "NIFTY",
      segments: ["FUT", "OPT"], // canonical order — sanitize normalizes to it
      direction: "short",
      result: "win",
      playbookIds: ["pb1", "pb2"],
      tagIds: ["g1"],
      rMin: -1,
      rMax: 2.5,
      pnlMin: 0,
      pnlMax: 5000,
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      weekdays: [1, 5],
      ruleCheck: "broken",
    };
    expect(decodeFiltersFromSearch(encodeFiltersToSearch(f))).toEqual(f);
  });

  it("empty filters encode to an empty string", () => {
    expect(encodeFiltersToSearch({})).toBe("");
    expect(decodeFiltersFromSearch("")).toEqual({});
  });

  it("decodes with or without a leading question mark", () => {
    expect(decodeFiltersFromSearch("?dir=short&res=win")).toEqual({
      direction: "short",
      result: "win",
    });
    expect(decodeFiltersFromSearch("dir=short")).toEqual({ direction: "short" });
  });

  it("ignores unknown keys and garbage values", () => {
    const f = decodeFiltersFromSearch("?utm_source=x&seg=OPT,NOPE&wd=9,2&rmin=abc&rule=broken");
    expect(f).toEqual({ segments: ["OPT"], weekdays: [2], ruleCheck: "broken" });
  });

  it("negative and decimal range bounds survive the roundtrip", () => {
    const f: AdvancedTradeFilters = { rMin: -2.5, pnlMax: -0.01 };
    expect(decodeFiltersFromSearch(encodeFiltersToSearch(f))).toEqual(f);
  });
});
