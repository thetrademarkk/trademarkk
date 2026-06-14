/**
 * Unit tests for the BT-12 journal-compare PURE layer:
 *   - the trade-shape adapter across ALL segments (EQ / OPT / FUT / COMM / CDS)
 *     including multi-leg qty summation and the index resolver;
 *   - the comparison metrics vs HAND-COMPUTED values (win-rate delta, P&L gap,
 *     avg-hold delta), paise-correct;
 *   - divergence detection (discretionary days + skipped signals);
 *   - partial-date-overlap handling (out-of-range trades, scoped window);
 *   - the honest unavailable states (no-journal-trades, no-comparable-instrument,
 *     no-backtest, no-date-overlap) and the low-sample note;
 *   - determinism (identical inputs → byte-identical output).
 *
 * A REAL golden NIFTY run is used end-to-end so the engine side is honest; the
 * journal side uses controlled synthetic trades so the deltas are hand-checkable.
 */

import { describe, expect, it } from "vitest";
import { runBacktest } from "@/lib/backtest/engine/engine";
import { FixtureDataSource } from "@/lib/backtest/engine/adapters/fixture-source";
import { loadGoldenSnapshot } from "@/lib/backtest/__fixtures__/golden-loader";
import { makeDefaultStrategy, type StrategyDef } from "@/features/backtest/shared/strategy-def";
import { parseRunResult, type RunResult } from "@/features/backtest/shared/run-result";
import {
  normalizeJournalTrade,
  normalizeJournalTrades,
  realizedTrades,
  resolveCompareIndex,
  type JournalLegInput,
  type JournalTradeInput,
} from "./adapter";
import { compareJournalToBacktest, MIN_SAMPLE_TRADES } from "./compare";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function mkTrade(p: Partial<JournalTradeInput> = {}): JournalTradeInput {
  return {
    id: p.id ?? "t1",
    symbol: p.symbol ?? "NIFTY 24500 CE",
    segment: p.segment ?? "OPT",
    product: p.product ?? "MIS",
    direction: p.direction ?? "long",
    status: p.status ?? "closed",
    qty: p.qty ?? 75,
    avg_entry: p.avg_entry ?? 100,
    avg_exit: p.avg_exit ?? 120,
    opened_at: p.opened_at ?? "2024-07-24T04:00:00.000Z", // 09:30 IST
    closed_at: p.closed_at === undefined ? "2024-07-24T09:30:00.000Z" : p.closed_at, // 15:00 IST
    gross_pnl: p.gross_pnl ?? 1500,
    charges: p.charges ?? 100,
    net_pnl: p.net_pnl ?? 1400,
  };
}

/** A synthetic, schema-valid RunResult whose blotter has exactly these day nets. */
function mkRun(
  dayNets: Array<{ day: string; net: number; entryTs?: number; exitTs?: number }>,
  symbol: "NIFTY" | "BANKNIFTY" | "SENSEX" = "NIFTY"
): RunResult {
  const total = Math.round(dayNets.reduce((s, d) => s + d.net, 0) * 100) / 100;
  const wins = dayNets.filter((d) => d.net > 0).length;
  const base = makeDefaultStrategy("syn", symbol);
  return parseRunResult({
    resultVersion: 1,
    runId: "syn-run",
    config: {
      ...base,
      market: {
        symbol,
        interval: "1m",
        dateRange: { start: dayNets[0]!.day, end: dayNets[dayNets.length - 1]!.day },
      },
    },
    engineVersion: "1.0.0",
    dataSnapshotId: "syn",
    ranAt: 0,
    coverage: {
      overall: 1,
      byLeg: {},
      substitutions: 0,
      illiquidDays: 0,
      excludedDays: 0,
      filledBarFraction: 1,
    },
    stats: {
      netPnl: total,
      winRate: dayNets.length ? wins / dayNets.length : 0,
      maxDrawdown: 0,
      expectancy: dayNets.length ? total / dayNets.length : 0,
      profitFactor: 1,
      sharpe: 0,
    },
    qualityChips: [],
    equityCurve: dayNets.map((d, i) => ({
      ts: Date.parse(d.day + "T03:45:00.000Z"), // ~09:15 IST
      equity: Math.round(dayNets.slice(0, i + 1).reduce((s, x) => s + x.net, 0) * 100) / 100,
    })),
    monthlyReturns: [],
    tradeReturns: dayNets.map((d) => ({ day: d.day, net: d.net })),
    blotter: dayNets.map((d) => ({
      day: d.day,
      entryTs: d.entryTs ?? Date.parse(d.day + "T03:50:00.000Z"), // 09:20 IST
      exitTs: d.exitTs ?? Date.parse(d.day + "T09:45:00.000Z"), // 15:15 IST
      legs: [
        {
          legId: "l1",
          optionType: "CE",
          side: "sell",
          qty: 75,
          resolution: {
            requested: 24500,
            served: 24500,
            coverage: 1,
            confidence: "high",
            fallbackSteps: 0,
          },
          entryPrice: 100,
          exitPrice: 90,
          gross: d.net,
          charges: 0,
          net: d.net,
          reentries: 0,
        },
      ],
      gross: d.net,
      charges: 0,
      net: d.net,
      substituted: false,
      flags: [],
    })),
    perLeg: [],
    flags: [],
  });
}

/** A NIFTY journal trade closing on a given IST date with a given net. */
function niftyOn(day: string, net: number, id: string): JournalTradeInput {
  return mkTrade({
    id,
    symbol: "NIFTY",
    segment: "FUT",
    opened_at: `${day}T04:00:00.000Z`,
    closed_at: `${day}T09:30:00.000Z`,
    net_pnl: net,
    gross_pnl: net + 100,
    charges: 100,
  });
}

/* ── adapter: index resolver ─────────────────────────────────────────────── */

describe("resolveCompareIndex — robust symbol matching across segments", () => {
  it("maps NIFTY variants", () => {
    expect(resolveCompareIndex("NIFTY")).toBe("NIFTY");
    expect(resolveCompareIndex("NIFTY 24500 CE")).toBe("NIFTY");
    expect(resolveCompareIndex("NSE:NIFTY24JUN24500CE")).toBe("NIFTY");
    expect(resolveCompareIndex("nifty50")).toBe("NIFTY");
  });
  it("maps BANKNIFTY before NIFTY (substring guard)", () => {
    expect(resolveCompareIndex("BANKNIFTY")).toBe("BANKNIFTY");
    expect(resolveCompareIndex("BANKNIFTY 52000 PE")).toBe("BANKNIFTY");
    expect(resolveCompareIndex("NIFTYBANK")).toBe("BANKNIFTY");
  });
  it("maps SENSEX / BANKEX (BSE family)", () => {
    expect(resolveCompareIndex("SENSEX")).toBe("SENSEX");
    expect(resolveCompareIndex("BSE:SENSEX 80000 CE")).toBe("SENSEX");
    expect(resolveCompareIndex("BANKEX")).toBe("SENSEX");
  });
  it("returns null for non-backtestable instruments (stocks, FINNIFTY, COMM, CDS)", () => {
    expect(resolveCompareIndex("RELIANCE")).toBeNull();
    expect(resolveCompareIndex("FINNIFTY 23000 CE")).toBeNull();
    expect(resolveCompareIndex("MIDCPNIFTY")).toBeNull();
    expect(resolveCompareIndex("CRUDEOIL")).toBeNull();
    expect(resolveCompareIndex("USDINR")).toBeNull();
  });
});

/* ── adapter: all segments + multi-leg ───────────────────────────────────── */

describe("normalizeJournalTrade — all segments & multi-leg", () => {
  it("EQ intraday (same IST day) → intraday horizon, hold minutes", () => {
    const n = normalizeJournalTrade(
      mkTrade({
        segment: "EQ",
        symbol: "RELIANCE",
        opened_at: "2024-07-24T04:00:00.000Z",
        closed_at: "2024-07-24T05:30:00.000Z", // +90 min
      })
    );
    expect(n.segment).toBe("EQ");
    expect(n.horizon).toBe("intraday");
    expect(n.holdMinutes).toBe(90);
    expect(n.index).toBeNull(); // a stock is not a backtestable index
  });
  it("EQ delivery overnight → swing horizon", () => {
    const n = normalizeJournalTrade(
      mkTrade({
        segment: "EQ",
        product: "CNC",
        opened_at: "2024-07-24T04:00:00.000Z",
        closed_at: "2024-07-26T05:30:00.000Z",
      })
    );
    expect(n.horizon).toBe("swing");
  });
  it("OPT single-leg keeps trade-row qty", () => {
    const n = normalizeJournalTrade(mkTrade({ segment: "OPT", qty: 150 }));
    expect(n.qty).toBe(150);
    expect(n.index).toBe("NIFTY");
  });
  it("OPT multi-leg straddle sums leg qty", () => {
    const legs: JournalLegInput[] = [
      { trade_id: "t1", qty: 75 },
      { trade_id: "t1", qty: 75 },
    ];
    const n = normalizeJournalTrade(mkTrade({ segment: "OPT", qty: 75 }), legs);
    expect(n.qty).toBe(150); // summed across both legs, not the row's 75
  });
  it("FUT carries through", () => {
    const n = normalizeJournalTrade(mkTrade({ segment: "FUT", symbol: "BANKNIFTY" }));
    expect(n.segment).toBe("FUT");
    expect(n.index).toBe("BANKNIFTY");
  });
  it("COMM commodity → null index, still normalized", () => {
    const n = normalizeJournalTrade(mkTrade({ segment: "COMM", symbol: "CRUDEOIL" }));
    expect(n.segment).toBe("COMM");
    expect(n.index).toBeNull();
    expect(n.netPnl).toBe(1400);
  });
  it("CDS currency → null index", () => {
    const n = normalizeJournalTrade(mkTrade({ segment: "CDS", symbol: "USDINR" }));
    expect(n.index).toBeNull();
  });
  it("legacy null product → MIS", () => {
    const n = normalizeJournalTrade(mkTrade({ product: null }));
    expect(n.product).toBe("MIS");
  });
  it("open trade (no close) → null exit / hold / horizon", () => {
    const n = normalizeJournalTrade(mkTrade({ status: "open", closed_at: null, avg_exit: null }));
    expect(n.exitTs).toBeNull();
    expect(n.holdMinutes).toBeNull();
    expect(n.horizon).toBeNull();
  });
  it("realized P&L is taken verbatim from the journal (never recomputed)", () => {
    const n = normalizeJournalTrade(mkTrade({ gross_pnl: 1234.56, charges: 34.56, net_pnl: 1200 }));
    expect(n.grossPnl).toBe(1234.56);
    expect(n.charges).toBe(34.56);
    expect(n.netPnl).toBe(1200);
  });
});

describe("realizedTrades — closed only, exit-sorted", () => {
  it("drops open trades and sorts by exit instant", () => {
    const trades = normalizeJournalTrades([
      mkTrade({ id: "a", closed_at: "2024-07-25T09:30:00.000Z" }),
      mkTrade({ id: "open", status: "open", closed_at: null, avg_exit: null }),
      mkTrade({ id: "b", closed_at: "2024-07-24T09:30:00.000Z" }),
    ]);
    const r = realizedTrades(trades);
    expect(r.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

/* ── honest unavailable states ───────────────────────────────────────────── */

describe("compareJournalToBacktest — honest unavailable states", () => {
  it("no realized journal trades → no-journal-trades", () => {
    const res = compareJournalToBacktest([], mkRun([{ day: "2024-07-24", net: 100 }]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-journal-trades");
  });
  it("no baseline run → no-backtest (still reports comparable count)", () => {
    const trades = normalizeJournalTrades([niftyOn("2024-07-24", 100, "a")]);
    const res = compareJournalToBacktest(trades, null);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("no-backtest");
      expect(res.index).toBe("NIFTY");
      expect(res.comparableTrades).toBe(1);
    }
  });
  it("instrument not in archive → no-comparable-instrument", () => {
    // Trader only does RELIANCE/CRUDE; baseline is NIFTY → nothing comparable.
    const trades = normalizeJournalTrades([
      mkTrade({
        id: "r",
        symbol: "RELIANCE",
        segment: "EQ",
        closed_at: "2024-07-24T09:30:00.000Z",
      }),
      mkTrade({
        id: "c",
        symbol: "CRUDEOIL",
        segment: "COMM",
        closed_at: "2024-07-24T09:30:00.000Z",
      }),
    ]);
    const res = compareJournalToBacktest(trades, mkRun([{ day: "2024-07-24", net: 100 }]));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("no-comparable-instrument");
      expect(res.index).toBe("NIFTY");
    }
  });
  it("no date overlap → no-date-overlap", () => {
    const trades = normalizeJournalTrades([niftyOn("2023-01-10", 500, "old")]);
    const res = compareJournalToBacktest(trades, mkRun([{ day: "2024-07-24", net: 100 }]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-date-overlap");
  });
});

/* ── metrics: hand-computed, paise-correct ───────────────────────────────── */

describe("compareJournalToBacktest — hand-computed metrics & low sample", () => {
  it("computes total P&L gap, win-rate delta, trade-day delta paise-correct", () => {
    // Journal: 3 NIFTY days: +100, -50, +200 → total +250, 2/3 win days.
    const trades = normalizeJournalTrades([
      niftyOn("2024-07-24", 100, "a"),
      niftyOn("2024-07-25", -50, "b"),
      niftyOn("2024-07-26", 200, "c"),
    ]);
    // Baseline: 2 days: +80, +40 → total +120, 2/2 win days.
    const run = mkRun([
      { day: "2024-07-24", net: 80 },
      { day: "2024-07-25", net: 40 },
    ]);
    const res = compareJournalToBacktest(trades, run);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = res.compare;

    // 2024-07-26 is outside the baseline window [24..25] → out of range.
    expect(c.outOfRangeTrades).toBe(1);
    expect(c.sampleTrades).toBe(2); // 24 & 25 only

    const total = c.metrics.find((m) => m.key === "totalPnl")!;
    // In-range journal total = 100 + (−50) = 50; baseline = 120; gap = −70.
    expect(total.real).toBe(50);
    expect(total.baseline).toBe(120);
    expect(total.delta).toBe(-70);

    const win = c.metrics.find((m) => m.key === "winRate")!;
    // Journal in-range win days: 1/2 = 0.5; baseline 2/2 = 1.0; delta = −0.5.
    expect(win.real).toBeCloseTo(0.5, 6);
    expect(win.baseline).toBeCloseTo(1.0, 6);
    expect(win.delta).toBeCloseTo(-0.5, 6);

    const freq = c.metrics.find((m) => m.key === "tradeFrequency")!;
    expect(freq.real).toBe(2);
    expect(freq.baseline).toBe(2);
    expect(freq.delta).toBe(0);
  });

  it("avg-hold delta is hand-computable (journal 330m vs baseline 355m)", () => {
    // Journal trade: 09:30 IST → 15:00 IST = 330 minutes.
    const t = mkTrade({
      id: "h",
      symbol: "NIFTY",
      segment: "FUT",
      opened_at: "2024-07-24T04:00:00.000Z", // 09:30 IST
      closed_at: "2024-07-24T09:30:00.000Z", // 15:00 IST
      net_pnl: 100,
    });
    const trades = normalizeJournalTrades([t]);
    // Baseline blotter: 09:20 → 15:15 IST = 355 minutes.
    const run = mkRun([
      {
        day: "2024-07-24",
        net: 80,
        entryTs: Date.parse("2024-07-24T03:50:00.000Z"),
        exitTs: Date.parse("2024-07-24T09:45:00.000Z"),
      },
    ]);
    const res = compareJournalToBacktest(trades, run);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const hold = res.compare.metrics.find((m) => m.key === "avgHold")!;
    expect(hold.real).toBe(330);
    expect(hold.baseline).toBe(355);
    expect(hold.delta).toBe(-25);
  });

  it("flags low sample below MIN_SAMPLE_TRADES, clears it at/above", () => {
    const fewDays = Array.from({ length: MIN_SAMPLE_TRADES - 1 }, (_, i) => {
      const day = `2024-07-${String(10 + i).padStart(2, "0")}`;
      return niftyOn(day, 10, `t${i}`);
    });
    const baseDays = fewDays.map((t) => ({ day: t.closed_at!.slice(0, 10), net: 5 }));
    const low = compareJournalToBacktest(normalizeJournalTrades(fewDays), mkRun(baseDays));
    expect(low.ok && low.compare.lowSample).toBe(true);

    const manyDays = Array.from({ length: MIN_SAMPLE_TRADES }, (_, i) => {
      const day = `2024-07-${String(10 + i).padStart(2, "0")}`;
      return niftyOn(day, 10, `t${i}`);
    });
    const baseDays2 = manyDays.map((t) => ({ day: t.closed_at!.slice(0, 10), net: 5 }));
    const ok = compareJournalToBacktest(normalizeJournalTrades(manyDays), mkRun(baseDays2));
    expect(ok.ok && ok.compare.lowSample).toBe(false);
  });
});

/* ── divergences ─────────────────────────────────────────────────────────── */

describe("compareJournalToBacktest — divergence detection", () => {
  it("classifies discretionary days, skipped signals & overlap", () => {
    // Journal NIFTY days: 24 (+100), 26 (+30)  [25 untraded by you]
    const trades = normalizeJournalTrades([
      niftyOn("2024-07-24", 100, "a"),
      niftyOn("2024-07-26", 30, "b"),
    ]);
    // Baseline days: 24 (+80), 25 (+40)  [26 outside baseline window]
    const run = mkRun([
      { day: "2024-07-24", net: 80 },
      { day: "2024-07-25", net: 40 },
    ]);
    const res = compareJournalToBacktest(trades, run);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.compare.divergences;

    // 24: both traded → overlap. 25: baseline only → skipped signal. 26 is out of
    // the baseline range, so the comparison scopes it out → no divergence row.
    expect(d.overlapDays).toBe(1);
    expect(d.skippedSignalDays).toBe(1);
    expect(d.skippedSignalNet).toBe(40);
    expect(d.discretionaryDays).toBe(0);

    const skipped = d.rows.find((r) => r.kind === "skipped-signal")!;
    expect(skipped.day).toBe("2024-07-25");
    expect(skipped.baselineNet).toBe(40);
  });

  it("counts a discretionary day (you traded, baseline silent) inside range", () => {
    // Baseline spans 24..26 but only signals on 24 & 26; you also traded 25.
    const trades = normalizeJournalTrades([
      niftyOn("2024-07-24", 50, "a"),
      niftyOn("2024-07-25", -20, "disc"),
      niftyOn("2024-07-26", 70, "c"),
    ]);
    const run = mkRun([
      { day: "2024-07-24", net: 60 },
      { day: "2024-07-26", net: 90 },
    ]);
    const res = compareJournalToBacktest(trades, run);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const d = res.compare.divergences;
    expect(d.discretionaryDays).toBe(1);
    expect(d.discretionaryNet).toBe(-20);
    const disc = d.rows.find((r) => r.kind === "discretionary")!;
    expect(disc.day).toBe("2024-07-25");
    expect(disc.realTradeCount).toBe(1);
  });
});

/* ── overlay ─────────────────────────────────────────────────────────────── */

describe("compareJournalToBacktest — equity overlay", () => {
  it("builds a union-of-days cumulative overlay with leading nulls", () => {
    // Journal trades only on 25 & 26; baseline on 24 & 25.
    const trades = normalizeJournalTrades([
      niftyOn("2024-07-25", 100, "a"),
      niftyOn("2024-07-26", 50, "b"),
    ]);
    const run = mkRun([
      { day: "2024-07-24", net: 80 },
      { day: "2024-07-25", net: 40 },
      { day: "2024-07-26", net: 20 },
    ]);
    const res = compareJournalToBacktest(trades, run);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const o = res.compare.overlay;
    expect(o.map((p) => p.day)).toEqual(["2024-07-24", "2024-07-25", "2024-07-26"]);
    // Real line has no value on 24 (you hadn't traded yet).
    expect(o[0]!.real).toBeNull();
    expect(o[0]!.baseline).toBe(80);
    expect(o[1]!.real).toBe(100);
    expect(o[1]!.baseline).toBe(120);
    expect(o[2]!.real).toBe(150);
    expect(o[2]!.baseline).toBe(140);
  });
});

/* ── end-to-end with the REAL golden engine run ──────────────────────────── */

describe("compareJournalToBacktest — real golden run, end-to-end", () => {
  function goldenRun(): RunResult {
    const base = makeDefaultStrategy("g", "NIFTY");
    const strat: StrategyDef = {
      ...base,
      name: "Short Straddle",
      market: {
        symbol: "NIFTY",
        interval: "1m",
        dateRange: { start: "2024-07-24", end: "2024-07-25" },
      },
      timing: { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
      legs: [
        {
          id: "ce",
          enabled: true,
          optionType: "CE",
          side: "sell",
          lots: 1,
          strike: { mode: "ATM_OFFSET", steps: 0 },
          expiry: "WEEKLY",
          squareOff: "partial",
        },
        {
          id: "pe",
          enabled: true,
          optionType: "PE",
          side: "sell",
          lots: 1,
          strike: { mode: "ATM_OFFSET", steps: 0 },
          expiry: "WEEKLY",
          squareOff: "partial",
        },
      ],
    };
    return runBacktest(strat, new FixtureDataSource(loadGoldenSnapshot()), { ranAt: 0 });
  }

  it("compares real NIFTY journal trades against the golden baseline", () => {
    const run = goldenRun();
    // The user logged a NIFTY trade on each golden day.
    const trades = normalizeJournalTrades([
      niftyOn("2024-07-24", 500, "j1"),
      niftyOn("2024-07-25", -300, "j2"),
    ]);
    const res = compareJournalToBacktest(trades, run);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.compare.index).toBe("NIFTY");
    expect(res.compare.sampleTrades).toBe(2);
    expect(res.compare.lowSample).toBe(true); // 2 < 10
    const total = res.compare.metrics.find((m) => m.key === "totalPnl")!;
    expect(total.real).toBe(200); // 500 − 300
    expect(total.delta).toBe(Math.round((200 - total.baseline) * 100) / 100);
  });

  it("is deterministic — identical inputs yield byte-identical output", () => {
    const run = goldenRun();
    const trades = normalizeJournalTrades([
      niftyOn("2024-07-24", 500, "j1"),
      niftyOn("2024-07-25", -300, "j2"),
    ]);
    const a = compareJournalToBacktest(trades, run);
    const b = compareJournalToBacktest(trades, run);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
