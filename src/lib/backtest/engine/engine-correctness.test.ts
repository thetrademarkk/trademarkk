/**
 * ENGINE CORRECTNESS scenario tests — one focused suite per money-critical fix
 * landed in feat/backtest-engine-correctness. Synthetic, fully-controlled
 * fixtures (test-helpers) so every expected number is hand-verifiable:
 *
 *  #1 STT-on-exercise ("the STT trap"): a long ITM-at-expiry leg settles at
 *     INTRINSIC and carries the 0.125% exercise STT + an EXERCISED marker; an OTM
 *     long stays on the LTP path with no exercise STT; a short stays LTP.
 *  #2 Per-leg squareOff (partial vs complete): the HITTING leg's own setting
 *     decides — complete kills survivors, partial spares them.
 *  #3 Per-leg entryOffsetMin / exitOffsetMin: legs open / square at their own
 *     staggered minutes (distinct entry fills, early per-leg exit).
 *  #4 Half-day / early-close: the position squares at (earlyClose − 1) and no
 *     bar past the early close is processed.
 *  #5 Validation guard: a single-stock symbol is rejected with a stable message.
 */

import { afterEach, describe, expect, it } from "vitest";
import { FixtureDataSource } from "./adapters/fixture-source";
import { runBacktest } from "./engine";
import {
  bar,
  flatContract,
  flatIndex,
  leg,
  makeDay,
  pathContract,
  snapshot,
  strategyFor,
} from "./test-helpers";
import { computeCharges } from "../../charges/charges";
import { getChargeProfile } from "../../../config/brokers";
import { EARLY_CLOSE } from "../calendar/calendar.data";
import {
  parseStrategyDef,
  safeParseStrategyDef,
  SINGLE_STOCK_UNSUPPORTED_MSG,
} from "../../../features/backtest/shared/strategy-def";
import type { Bar } from "./types";

const EXPIRY_DAY = "2024-07-25"; // NIFTY Thursday weekly expiry → day === expiry
const NON_EXPIRY_DAY = "2024-07-24"; // Wednesday → WEEKLY expiry is 2024-07-25
const EXP = "2024-07-25";
const ZER = getChargeProfile("zerodha");

/** A fixture source for a single day with an explicit expiry. */
function srcFor(
  day: string,
  expiry: string,
  idx: Bar[],
  contracts: ReturnType<typeof flatContract>[]
) {
  return new FixtureDataSource(snapshot([makeDay(day, expiry, idx, contracts)]));
}

// ════════════════════════════════════════════════════════════════════════════
// #1 — STT-on-exercise (the "STT trap")
// ════════════════════════════════════════════════════════════════════════════
describe("BT fix #1 — exercise STT + intrinsic settlement of a long ITM at expiry", () => {
  it("a long CE ITM at expiry-day EOD settles at INTRINSIC, carries exercise STT + EXERCISED flag", () => {
    // Spot entry 24300 → ATM CE = 24300. Index drifts up so the LAST close is
    // 24400 → intrinsic 100. The CE option's own LTP is a low 2 at close, but the
    // long ITM leg must settle at intrinsic 100 (exercise), NOT the stale LTP 2.
    const idxBars: Bar[] = Array.from({ length: 376 }, (_, i) =>
      bar(EXPIRY_DAY, i, { o: 24300, h: 24400, l: 24300, c: i < 300 ? 24300 : 24400, v: 0 })
    );
    // CE entry open at minute 5 = 50; collapses to 2 by close (deep theta).
    const ceCloses = Array.from({ length: 376 }, (_, i) => (i < 5 ? 50 : 2));
    const ce = pathContract(EXPIRY_DAY, 24300, "CE", ceCloses);
    const src = srcFor(EXPIRY_DAY, EXP, idxBars, [ce, flatContract(EXPIRY_DAY, 24300, "PE", 50)]);
    const strat = strategyFor(EXPIRY_DAY, [leg("ce", "CE", "buy")]);
    const res = runBacktest(strat, src, { ranAt: 0 });

    const l = res.blotter[0]!.legs[0]!;
    expect(l.settlement).toBe("exercise");
    expect(l.entryPrice).toBe(50);
    expect(l.exitPrice).toBe(100); // INTRINSIC (24400 − 24300), NOT the LTP 2
    expect(l.gross).toBe(3750); // (100 − 50) × 75
    // Exercise STT 0.125% of intrinsic notional 100×75 = 9.375 → 9.38; total 61.42.
    const expCharges = computeCharges(ZER, {
      segment: "OPT",
      product: "MIS",
      orders: 2,
      direction: "long",
      entryPrice: 50,
      exitPrice: 100,
      qty: 75,
      exercise: { intrinsicNotional: 100 * 75 },
    }).total;
    expect(expCharges).toBe(61.42);
    expect(l.charges).toBe(61.42);
    expect(l.net).toBe(3688.58); // 3750 − 61.42
    // Blotter row surfaces the EXERCISED marker.
    expect(res.blotter[0]!.flags).toContain("EXERCISED");
    // EXERCISED is a per-day marker, NOT a run-level honesty flag.
    expect(res.flags).not.toContain("EXERCISED");
  });

  it("a long CE OTM at expiry stays on the LTP path — NO exercise STT, NO EXERCISED flag", () => {
    // Spot ends at 24200 < strike 24300 → intrinsic 0 → not exercised. The leg
    // settles at its last option LTP (2) via the ordinary premium round-trip.
    const idxBars: Bar[] = Array.from({ length: 376 }, (_, i) =>
      bar(EXPIRY_DAY, i, { o: 24300, h: 24300, l: 24200, c: i < 300 ? 24300 : 24200, v: 0 })
    );
    const ceCloses = Array.from({ length: 376 }, (_, i) => (i < 5 ? 50 : 2));
    const ce = pathContract(EXPIRY_DAY, 24300, "CE", ceCloses);
    const src = srcFor(EXPIRY_DAY, EXP, idxBars, [ce, flatContract(EXPIRY_DAY, 24300, "PE", 50)]);
    const strat = strategyFor(EXPIRY_DAY, [leg("ce", "CE", "buy")]);
    const res = runBacktest(strat, src, { ranAt: 0 });

    const l = res.blotter[0]!.legs[0]!;
    expect(l.settlement).toBe("ltp");
    expect(l.exitPrice).toBe(2); // last LTP, not intrinsic
    expect(res.blotter[0]!.flags).not.toContain("EXERCISED");
    // No exercise STT — the leg booked the ordinary premium round-trip charges.
    const ltpCharges = computeCharges(ZER, {
      segment: "OPT",
      product: "MIS",
      orders: 2,
      direction: "long",
      entryPrice: 50,
      exitPrice: 2,
      qty: 75,
    }).total;
    expect(l.charges).toBe(ltpCharges);
  });

  it("a SHORT ITM leg at expiry stays on the LTP path (no buyer-side exercise STT)", () => {
    // Short CE, strike 24300, spot ends 24400 (ITM for the option) but the SELLER
    // is assigned — the buyer pays exercise STT, not the seller — so our model
    // keeps the short on LTP (its premium-sell STT already applied). Settles at
    // the option's last LTP, exactly as invariant 4.
    const idxBars: Bar[] = Array.from({ length: 376 }, (_, i) =>
      bar(EXPIRY_DAY, i, { o: 24300, h: 24400, l: 24300, c: i < 300 ? 24300 : 24400, v: 0 })
    );
    const ceCloses = Array.from({ length: 376 }, (_, i) => (i < 5 ? 60 : 5));
    const ce = pathContract(EXPIRY_DAY, 24300, "CE", ceCloses);
    const src = srcFor(EXPIRY_DAY, EXP, idxBars, [ce, flatContract(EXPIRY_DAY, 24300, "PE", 60)]);
    const strat = strategyFor(EXPIRY_DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const l = res.blotter[0]!.legs[0]!;
    expect(l.settlement).toBe("ltp");
    expect(l.exitPrice).toBe(5); // LTP, not the 100 intrinsic
    expect(res.blotter[0]!.flags).not.toContain("EXERCISED");
  });

  it("a long ITM leg exited EARLY (exitOffsetMin) on expiry day settles at LTP, not exercise", () => {
    // Even on the expiry day, a leg squared early by its own exitOffsetMin is a
    // MARKET exit, not a hold-to-expiry — it must settle at LTP, never exercise.
    const idxBars: Bar[] = Array.from({ length: 376 }, (_, i) =>
      bar(EXPIRY_DAY, i, { o: 24300, h: 24400, l: 24300, c: i < 300 ? 24300 : 24400, v: 0 })
    );
    // CE LTP is 30 up to minute 10, then 2 (so an early exit at minute 10 books 30).
    const ceCloses = Array.from({ length: 376 }, (_, i) => (i < 5 ? 50 : i <= 10 ? 30 : 2));
    const ce = pathContract(EXPIRY_DAY, 24300, "CE", ceCloses);
    const src = srcFor(EXPIRY_DAY, EXP, idxBars, [ce, flatContract(EXPIRY_DAY, 24300, "PE", 50)]);
    // Exit 15:15 = minute 360; exitOffsetMin 350 → legExitMin = 10 → early exit.
    const strat = strategyFor(EXPIRY_DAY, [leg("ce", "CE", "buy", { exitOffsetMin: 350 })]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const l = res.blotter[0]!.legs[0]!;
    expect(l.settlement).toBe("ltp"); // market exit, NOT exercise
    expect(l.exitPrice).toBe(30); // LTP at the early per-leg exit minute (10)
    expect(res.blotter[0]!.flags).not.toContain("EXERCISED");
  });

  it("a long ITM leg on a NON-expiry day is NOT exercised (still LTP)", () => {
    // Same long-ITM shape but the trade day is NOT the contract's expiry day, so
    // the intraday square-off settles at LTP — exercise only fires at expiry EOD.
    const idxBars: Bar[] = Array.from({ length: 376 }, (_, i) =>
      bar(NON_EXPIRY_DAY, i, { o: 24300, h: 24400, l: 24300, c: i < 300 ? 24300 : 24400, v: 0 })
    );
    const ceCloses = Array.from({ length: 376 }, (_, i) => (i < 5 ? 50 : 2));
    const ce = pathContract(NON_EXPIRY_DAY, 24300, "CE", ceCloses);
    const src = srcFor(NON_EXPIRY_DAY, EXP, idxBars, [
      ce,
      flatContract(NON_EXPIRY_DAY, 24300, "PE", 50),
    ]);
    const strat = strategyFor(NON_EXPIRY_DAY, [leg("ce", "CE", "buy")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const l = res.blotter[0]!.legs[0]!;
    expect(l.settlement).toBe("ltp");
    expect(l.exitPrice).toBe(2); // LTP, intraday square-off — no exercise
  });
});

// ════════════════════════════════════════════════════════════════════════════
// #2 — Per-leg squareOff (partial vs complete) keyed off the HITTING leg
// ════════════════════════════════════════════════════════════════════════════
describe("BT fix #2 — per-leg squareOff is decided by the leg that actually hit", () => {
  /** Build a 2-leg day: CE spikes to trigger ITS SL at minute 6; PE stays flat. */
  function twoLegDay() {
    const idx = flatIndex(NON_EXPIRY_DAY, 24250);
    const ceCloses = Array.from({ length: 376 }, (_, i) => (i >= 6 ? 200 : 100));
    const ce = pathContract(NON_EXPIRY_DAY, 24250, "CE", ceCloses, {
      highs: ceCloses,
      lows: ceCloses,
    });
    const pe = flatContract(NON_EXPIRY_DAY, 24250, "PE", 100);
    return srcFor(NON_EXPIRY_DAY, EXP, idx, [ce, pe]);
  }

  it("the HITTING leg is `complete` → it squares the surviving leg too (same bar)", () => {
    const src = twoLegDay();
    // CE (the leg that hits its SL) is `complete`; PE is `partial`. CE's SL hit
    // must square PE as well.
    const strat = strategyFor(NON_EXPIRY_DAY, [
      leg("ce", "CE", "sell", {
        squareOff: "complete",
        stopLoss: { unit: "pct", basis: "premium", value: 50, refPrice: "traded" }, // 100→150
      }),
      leg("pe", "PE", "sell", { squareOff: "partial" }),
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const ceLeg = res.blotter[0]!.legs.find((l) => l.optionType === "CE")!;
    const peLeg = res.blotter[0]!.legs.find((l) => l.optionType === "PE")!;
    // Both squared at minute 6 (the CE SL bar). PE squared at its last mark (100).
    expect(ceLeg.exitPrice).toBe(150); // CE SL level
    expect(peLeg.exitPrice).toBe(100); // PE force-squared by CE's complete trigger
    expect(res.blotter[0]!.exitTs).toBe(src.dayData("NIFTY", EXP, NON_EXPIRY_DAY).index[6]!.ts);
  });

  it("the HITTING leg is `partial` → the surviving leg stays open to EOD", () => {
    const src = twoLegDay();
    // CE (hits its SL) is `partial`; PE survives and rides to the 15:15 exit.
    const strat = strategyFor(NON_EXPIRY_DAY, [
      leg("ce", "CE", "sell", {
        squareOff: "partial",
        stopLoss: { unit: "pct", basis: "premium", value: 50, refPrice: "traded" },
      }),
      leg("pe", "PE", "sell", { squareOff: "partial" }),
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const ceLeg = res.blotter[0]!.legs.find((l) => l.optionType === "CE")!;
    const peLeg = res.blotter[0]!.legs.find((l) => l.optionType === "PE")!;
    expect(ceLeg.exitPrice).toBe(150); // CE SL at minute 6
    expect(peLeg.exitPrice).toBe(100); // PE flat — squared only at EOD time exit
    // PE survived past minute 6: the day's exit is the 15:15 cap, not minute 6.
    const idx = src.dayData("NIFTY", EXP, NON_EXPIRY_DAY).index;
    expect(res.blotter[0]!.exitTs).toBe(idx[360]!.ts); // 09:20 entry + exit 15:15 = minute 360
  });

  it("ignores legs[0]'s mode: a `complete` leg[1] still squares everything when IT hits", () => {
    // Reverse the order so the COMPLETE leg is NOT legs[0]. Old code read
    // enabledLegs[0].squareOff (partial) and would have spared the survivor; the
    // fix keys off the hitting leg (CE, complete) so the survivor is squared.
    const src = twoLegDay();
    const strat = strategyFor(NON_EXPIRY_DAY, [
      leg("pe", "PE", "sell", { squareOff: "partial" }), // legs[0] = partial
      leg("ce", "CE", "sell", {
        squareOff: "complete", // the hitting leg is complete
        stopLoss: { unit: "pct", basis: "premium", value: 50, refPrice: "traded" },
      }),
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const idx = src.dayData("NIFTY", EXP, NON_EXPIRY_DAY).index;
    // Survivor squared at minute 6, NOT at EOD → the hitting-leg mode won.
    expect(res.blotter[0]!.exitTs).toBe(idx[6]!.ts);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// #3 — Per-leg entryOffsetMin / exitOffsetMin
// ════════════════════════════════════════════════════════════════════════════
describe("BT fix #3 — staggered per-leg entry/exit offsets", () => {
  it("entryOffsetMin opens each leg at its OWN minute → distinct entry fills", () => {
    // Entry 09:20 = minute 5. CE has offset 0 (opens at minute 5), PE has offset 5
    // (opens at minute 10). The two contracts have DIFFERENT opens at those
    // minutes, so a simultaneous-entry engine would misprice — staggered entry
    // gives each its own fill.
    const idx = flatIndex(NON_EXPIRY_DAY, 24250);
    // CE open at minute 5 = close of minute 4. Build a rising CE so min5≠min10.
    const ceCloses = Array.from({ length: 376 }, (_, i) => 100 + i); // min4 close=104 → min5 open 104
    const peCloses = Array.from({ length: 376 }, (_, i) => 200 + i); // min9 close=209 → min10 open 209
    const ce = pathContract(NON_EXPIRY_DAY, 24250, "CE", ceCloses);
    const pe = pathContract(NON_EXPIRY_DAY, 24250, "PE", peCloses);
    const src = srcFor(NON_EXPIRY_DAY, EXP, idx, [ce, pe]);
    const strat = strategyFor(NON_EXPIRY_DAY, [
      leg("ce", "CE", "sell", { entryOffsetMin: 0 }),
      leg("pe", "PE", "sell", { entryOffsetMin: 5 }),
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const ceLeg = res.blotter[0]!.legs.find((l) => l.optionType === "CE")!;
    const peLeg = res.blotter[0]!.legs.find((l) => l.optionType === "PE")!;
    // CE opens at minute 5: open = close of minute 4 = 104.
    expect(ceLeg.entryPrice).toBe(104);
    // PE opens at minute 10 (5 + offset 5): open = close of minute 9 = 209.
    expect(peLeg.entryPrice).toBe(209);
  });

  it("a deferred leg resolves against its OWN entry-bar spot (legged entry)", () => {
    // Spot is 24250 at the entry minute but 24350 by the PE's later entry minute,
    // so the PE's ATM resolves to 24350, not 24250 — proving the deferred leg uses
    // its own bar's spot.
    const idxBars: Bar[] = Array.from({ length: 376 }, (_, i) =>
      bar(NON_EXPIRY_DAY, i, { o: i >= 10 ? 24350 : 24250, c: i >= 10 ? 24350 : 24250, v: 0 })
    );
    const ce = flatContract(NON_EXPIRY_DAY, 24250, "CE", 100);
    const pe24250 = flatContract(NON_EXPIRY_DAY, 24250, "PE", 100);
    const pe24350 = flatContract(NON_EXPIRY_DAY, 24350, "PE", 120);
    const src = srcFor(NON_EXPIRY_DAY, EXP, idxBars, [ce, pe24250, pe24350]);
    const strat = strategyFor(NON_EXPIRY_DAY, [
      leg("ce", "CE", "sell", { entryOffsetMin: 0 }),
      leg("pe", "PE", "sell", { entryOffsetMin: 5 }), // opens at minute 10, spot 24350
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const peLeg = res.blotter[0]!.legs.find((l) => l.optionType === "PE")!;
    expect(peLeg.resolution.served).toBe(24350); // resolved at the LATER bar's spot
  });

  it("exitOffsetMin squares a leg BEFORE the strategy exit", () => {
    // Exit 15:15 = minute 360. PE has exitOffsetMin 350 → legExitMin = 360 − 350 =
    // 10, so the PE squares at minute 10 while the CE rides to 15:15. The PE's
    // price at minute 10 differs from EOD, proving the early per-leg exit.
    const idx = flatIndex(NON_EXPIRY_DAY, 24250);
    const ce = flatContract(NON_EXPIRY_DAY, 24250, "CE", 100);
    // PE close = 80 up to minute 10, then 50 afterwards.
    const peCloses = Array.from({ length: 376 }, (_, i) => (i <= 10 ? 80 : 50));
    const pe = pathContract(NON_EXPIRY_DAY, 24250, "PE", peCloses);
    const src = srcFor(NON_EXPIRY_DAY, EXP, idx, [ce, pe]);
    const strat = strategyFor(NON_EXPIRY_DAY, [
      leg("ce", "CE", "sell"),
      leg("pe", "PE", "sell", { exitOffsetMin: 350 }),
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const peLeg = res.blotter[0]!.legs.find((l) => l.optionType === "PE")!;
    // PE squared at minute 10 (close 80), NOT at the EOD price (50).
    expect(peLeg.exitPrice).toBe(80);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// #4 — Half-day / early-close session cap
// ════════════════════════════════════════════════════════════════════════════
describe("BT fix #4 — early-close (half-day) caps the exit at (close − 1)", () => {
  afterEach(() => {
    delete EARLY_CLOSE[NON_EXPIRY_DAY]; // never leak the injected early close
  });

  it("squares the position at (earlyClose − 1) and ignores bars past the close", () => {
    // Inject an early close at minute 600+? No — earlyClose is a minute-of-day.
    // 09:15 open = minute 555. Set the early close to 09:35 = minute 575 → the
    // engine must force-square at minute 574 (close − 1), well before the 15:15
    // strategy exit. We label the fixture bars from 09:15; the engine reads IST
    // minute-of-day, so an early close at 575 caps at session-minute (575−555)=20.
    EARLY_CLOSE[NON_EXPIRY_DAY] = 575; // 09:35 IST

    const idx = flatIndex(NON_EXPIRY_DAY, 24250);
    // CE close 100 until session-minute 19, then 999 from minute 20 onward — if a
    // post-close bar were processed the mark would jump; the cap must stop at
    // session-minute (574 − 555) = 19, settling at 100, never seeing 999.
    const ceCloses = Array.from({ length: 376 }, (_, i) => (i >= 20 ? 999 : 100));
    const ce = pathContract(NON_EXPIRY_DAY, 24250, "CE", ceCloses, {
      highs: ceCloses,
      lows: ceCloses,
    });
    const src = srcFor(NON_EXPIRY_DAY, EXP, idx, [
      ce,
      flatContract(NON_EXPIRY_DAY, 24250, "PE", 100),
    ]);
    const strat = strategyFor(NON_EXPIRY_DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });

    const l = res.blotter[0]!.legs[0]!;
    // Force-squared at session-minute 19 (574 IST) at close 100 — the 999 spike at
    // and after minute 20 (the early close) is never processed.
    expect(l.exitPrice).toBe(100);
    const idxBars = src.dayData("NIFTY", EXP, NON_EXPIRY_DAY).index;
    expect(res.blotter[0]!.exitTs).toBe(idxBars[19]!.ts); // session-minute 19 = IST 574
  });

  it("no early-close entry → the usual 15:15 exit is unaffected (regression)", () => {
    const idx = flatIndex(NON_EXPIRY_DAY, 24250);
    const ce = flatContract(NON_EXPIRY_DAY, 24250, "CE", 100);
    const src = srcFor(NON_EXPIRY_DAY, EXP, idx, [
      ce,
      flatContract(NON_EXPIRY_DAY, 24250, "PE", 100),
    ]);
    const strat = strategyFor(NON_EXPIRY_DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const idxBars = src.dayData("NIFTY", EXP, NON_EXPIRY_DAY).index;
    expect(res.blotter[0]!.exitTs).toBe(idxBars[360]!.ts); // unchanged 15:15
  });
});

// ════════════════════════════════════════════════════════════════════════════
// #5 — Validation guard: single-stock symbols are rejected
// ════════════════════════════════════════════════════════════════════════════
describe("BT fix #5 — guard rails reject not-yet-supported scenarios", () => {
  function stockDraft(symbol: string) {
    return {
      schemaVersion: 1,
      id: "s",
      name: "stock",
      market: { symbol, interval: "1m", dateRange: { start: "2024-07-24", end: "2024-07-25" } },
      legs: [
        {
          id: "l1",
          enabled: true,
          optionType: "CE",
          side: "sell",
          lots: 1,
          strike: { mode: "ATM_OFFSET", steps: 0 },
          expiry: "WEEKLY",
          squareOff: "partial",
        },
      ],
      timing: { mode: "fixed_time", entryTime: "09:20", exitTime: "15:15" },
      execution: { broker: "zerodha", product: "MIS", slippage: { unit: "pct", value: 0 } },
    };
  }

  it("rejects a single-stock symbol with the stable 'not yet supported' message", () => {
    const r = safeParseStrategyDef(stockDraft("RELIANCE"));
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs).toContain(SINGLE_STOCK_UNSUPPORTED_MSG);
    }
    expect(() => parseStrategyDef(stockDraft("TATAMOTORS"))).toThrow();
  });

  it("accepts every supported index symbol", () => {
    for (const sym of ["NIFTY", "BANKNIFTY", "SENSEX"]) {
      expect(safeParseStrategyDef(stockDraft(sym)).success).toBe(true);
    }
  });

  it("still rejects an underlying-basis stop (the existing guard holds)", () => {
    const draft = stockDraft("NIFTY") as Record<string, unknown>;
    (draft.legs as Record<string, unknown>[])[0]!.stopLoss = {
      unit: "pct",
      basis: "underlying",
      value: 30,
    };
    const r = safeParseStrategyDef(draft);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => /Underlying-basis/i.test(i.message))).toBe(true);
    }
  });
});
