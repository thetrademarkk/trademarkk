/**
 * The 10 HARD-INVARIANT edge tests for the bar-replay engine
 * (06-engine-semantics §12.2 + the BT-04 brief) + charges cent-for-cent. Each
 * invariant has its own enumerated `it`. Synthetic, fully-controlled fixtures
 * (test-helpers) make every expected number exact.
 */

import { describe, expect, it } from "vitest";
import { computeCharges } from "../../charges/charges";
import { getChargeProfile } from "../../../config/brokers";
import { FixtureDataSource } from "./adapters/fixture-source";
import type { DataSource } from "./data-source";
import { runBacktest } from "./engine";
import {
  bar,
  baseMs,
  flatContract,
  flatIndex,
  leg,
  makeDay,
  pathContract,
  snapshot,
  strategyFor,
  tsAt,
} from "./test-helpers";
import type { Bar } from "./types";

const DAY = "2024-07-25"; // NIFTY Thursday weekly expiry
const EXP = "2024-07-25";
const ZER = getChargeProfile("zerodha");

function srcOf(idx: Bar[], contracts: ReturnType<typeof flatContract>[]) {
  return new FixtureDataSource(snapshot([makeDay(DAY, EXP, idx, contracts)]));
}

describe("BT-04 engine — hard invariants", () => {
  // ── 1. Next-bar / entry-open fills ────────────────────────────────────────
  it("1) time entry fills at the entry-minute bar's OPEN, not its close", () => {
    // CE open at 09:20 (minute 5) = 120, close = 130. Entry must fill at 120.
    const idx = flatIndex(DAY, 24250);
    const closes = Array.from({ length: 376 }, (_, i) => (i === 5 ? 130 : 120));
    // open of minute 5 = close of minute 4 = 120.
    const ce = pathContract(DAY, 24250, "CE", closes);
    const pe = flatContract(DAY, 24250, "PE", 100);
    const src = srcOf(idx, [ce, pe]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(res.blotter[0]!.legs[0]!.entryPrice).toBe(120);
  });

  // ── 2. Point-in-time / no look-ahead ──────────────────────────────────────
  it("2) a future-bar spike does NOT change the entry fill (no look-ahead)", () => {
    // Entry at minute 5 open=100. A spike to 999 at minute 200 must not leak
    // into the entry price (which only sees the entry bar's left edge).
    const idx = flatIndex(DAY, 24250);
    const closes = Array.from({ length: 376 }, (_, i) => (i === 200 ? 999 : 100));
    const ce = pathContract(DAY, 24250, "CE", closes);
    const src = srcOf(idx, [ce, flatContract(DAY, 24250, "PE", 100)]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(res.blotter[0]!.legs[0]!.entryPrice).toBe(100);
  });

  // ── 3. MTM from the option's OWN OHLC (never BS-implied from spot) ─────────
  it("3) MTM/exit uses the option's own close, independent of spot", () => {
    // Spot constant 24250; CE drifts 100 → 80 by EOD. A short CE profits on the
    // option price drop regardless of (flat) spot.
    const idx = flatIndex(DAY, 24250);
    const closes = Array.from({ length: 376 }, (_, i) => (i < 5 ? 100 : 80));
    const ce = pathContract(DAY, 24250, "CE", closes);
    const src = srcOf(idx, [ce, flatContract(DAY, 24250, "PE", 100)]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const l = res.blotter[0]!.legs[0]!;
    expect(l.entryPrice).toBe(100); // open of minute 5 = close of minute 4 = 100
    expect(l.exitPrice).toBe(80); // EOD square-off at last close
    // short: gross = (entry - exit) * qty = (100-80)*75 = 1500
    expect(l.gross).toBe(1500);
  });

  // ── 4. Expiry settles at the LAST TRADED price, not intrinsic ─────────────
  it("4) on expiry day a held short CE settles at the last close, not intrinsic", () => {
    // ATM 24250 CE; spot ends at 24400 → intrinsic 150. But the option's last
    // close is 5, and the engine must settle at 5 (LTP), not 150.
    const idxBars: Bar[] = Array.from({ length: 376 }, (_, i) =>
      bar(DAY, i, { o: 24250, h: 24450, l: 24250, c: i < 300 ? 24250 : 24400, v: 0 })
    );
    const closes = Array.from({ length: 376 }, (_, i) => (i < 5 ? 60 : 5));
    const ce = pathContract(DAY, 24250, "CE", closes);
    const src = srcOf(idxBars, [ce, flatContract(DAY, 24250, "PE", 60)]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(res.blotter[0]!.legs[0]!.exitPrice).toBe(5); // LTP, not 150 intrinsic
  });

  // ── 5. SL-first tie-break when both inside one bar ─────────────────────────
  it("5) when SL and target both fall inside one bar, the SL fills FIRST", () => {
    // Short CE entry 100, SL +30% → 130, target -50% → 50. One bar spans
    // [49, 131] → both inside; SL must win.
    const idx = flatIndex(DAY, 24250);
    const closes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    for (let i = 0; i < 376; i++) {
      if (i === 6) {
        closes.push(90);
        highs.push(131);
        lows.push(49);
      } else {
        closes.push(100);
        highs.push(100);
        lows.push(100);
      }
    }
    const ce = pathContract(DAY, 24250, "CE", closes, { highs, lows });
    const src = srcOf(idx, [ce, flatContract(DAY, 24250, "PE", 100)]);
    const strat = strategyFor(DAY, [
      leg("ce", "CE", "sell", {
        stopLoss: { unit: "pct", basis: "premium", value: 30, refPrice: "traded" },
        target: { unit: "pct", basis: "premium", value: 50, refPrice: "traded" },
      }),
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const l = res.blotter[0]!.legs[0]!;
    expect(l.exitPrice).toBe(130); // SL level, not the 50 target
  });

  // ── 6. Fixed within-bar order: per-leg SL → overall MTM (complete) ─────────
  it("6) overall MTM SL squares the whole strategy at the breaching bar", () => {
    // Two short legs entry 100 each (qty 75). CE jumps to 200 at minute 6 → leg
    // MTM = (100-200)*75 = -7500 < overall MTM SL of ₹5000 → exit all.
    const idx = flatIndex(DAY, 24250);
    const ceCloses = Array.from({ length: 376 }, (_, i) => (i >= 6 ? 200 : 100));
    const ce = pathContract(DAY, 24250, "CE", ceCloses, {
      highs: ceCloses,
      lows: ceCloses,
    });
    const pe = flatContract(DAY, 24250, "PE", 100);
    const src = srcOf(idx, [ce, pe]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell"), leg("pe", "PE", "sell")], {
      risk: { reEntryOnOverall: false, stopLoss: { unit: "rupees", value: 5000 } },
    });
    const res = runBacktest(strat, src, { ranAt: 0 });
    // Both legs exit at minute 6 (the breach bar): CE at 200, PE at 100 (last mark).
    const ceLeg = res.blotter[0]!.legs.find((l) => l.optionType === "CE")!;
    const peLeg = res.blotter[0]!.legs.find((l) => l.optionType === "PE")!;
    expect(ceLeg.exitPrice).toBe(200);
    expect(peLeg.exitPrice).toBe(100);
    expect(res.blotter[0]!.exitTs).toBe(tsAt(DAY, 6));
  });

  // ── 7. Risk checks at native 1-min regardless of interval ─────────────────
  it("7) a within-bar SL breach is honoured even on a 5-min interval strategy", () => {
    const idx = flatIndex(DAY, 24250);
    // SL breach at minute 2 (inside the first 5-min bucket).
    const closes = Array.from({ length: 376 }, (_, i) => (i === 7 ? 140 : 100));
    const highs = closes.map((c) => Math.max(c, 100));
    const ce = pathContract(DAY, 24250, "CE", closes, { highs });
    const src = srcOf(idx, [ce, flatContract(DAY, 24250, "PE", 100)]);
    const strat = strategyFor(
      DAY,
      [
        leg("ce", "CE", "sell", {
          stopLoss: { unit: "pct", basis: "premium", value: 30, refPrice: "traded" },
        }),
      ],
      { market: { symbol: "NIFTY", interval: "5m", dateRange: { start: DAY, end: DAY } } }
    );
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(res.blotter[0]!.legs[0]!.exitPrice).toBe(130); // SL hit intrabar
  });

  // ── 8. Square-off at exit time / 15:29 ────────────────────────────────────
  it("8) the position is squared off and nothing is carried overnight", () => {
    const idx = flatIndex(DAY, 24250);
    const ce = flatContract(DAY, 24250, "CE", 100);
    const src = srcOf(idx, [ce, flatContract(DAY, 24250, "PE", 100)]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(res.blotter[0]!.legs.length).toBe(1);
    // exit at 15:15 = minute 360 (entry 09:20 = 5, exit 15:15).
    const exitMin = (res.blotter[0]!.exitTs - baseMs(DAY)) / 60_000;
    expect(exitMin).toBe(360);
  });

  // ── 9. Gap-up past a short SL fills at the OPEN, not the SL level ──────────
  it("9) a gap-up bar that opens past the short SL fills at the OPEN (gap-adjusted)", () => {
    const idx = flatIndex(DAY, 24250);
    // Short CE entry 100, SL +30% → 130. Bar 6 GAPS open to 150 (already past 130).
    const closes: number[] = [];
    for (let i = 0; i < 376; i++) closes.push(i >= 6 ? 160 : 100);
    const bars: Bar[] = closes.map((c, i) => {
      const o = i === 6 ? 150 : i === 0 ? c : closes[i - 1]!;
      return { ts: tsAt(DAY, i), o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 };
    });
    const ce = { strike: 24250, optionType: "CE" as const, bars };
    const src = srcOf(idx, [ce, flatContract(DAY, 24250, "PE", 100)]);
    const strat = strategyFor(DAY, [
      leg("ce", "CE", "sell", {
        stopLoss: { unit: "pct", basis: "premium", value: 30, refPrice: "traded" },
      }),
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(res.blotter[0]!.legs[0]!.exitPrice).toBe(150); // open, not 130
  });

  // ── 10a. Missing-bar / illiquid → MISSING_LEG when a leg has no prints ─────
  it("10a) a required leg with zero prints all day → day excluded (MISSING_LEG)", () => {
    const idx = flatIndex(DAY, 24250);
    // Only PE exists; CE has no contract at all.
    const pe = flatContract(DAY, 24250, "PE", 100);
    const src = srcOf(idx, [pe]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(res.blotter.length).toBe(0); // no booked day
    expect(res.coverage.excludedDays).toBe(1);
    expect(res.flags).toContain("MISSING_LEG");
  });

  // ── 10b. Illiquid (low-coverage) strike → LOW_LIQUIDITY + slippage bump ────
  it("10b) a low-coverage strike flags LOW_LIQUIDITY and bumps slippage", () => {
    const idx = flatIndex(DAY, 24250);
    // CE present only ~40% of the session (coverage < 0.5) → illiquid.
    const ceBars: Bar[] = [];
    for (let i = 0; i < 150; i++) ceBars.push(bar(DAY, i, { c: 100, v: 0 }));
    const ce = { strike: 24250, optionType: "CE" as const, bars: ceBars };
    const pe = flatContract(DAY, 24250, "PE", 100);
    const src = srcOf(idx, [ce, pe]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell")], {
      execution: {
        broker: "zerodha",
        product: "MIS",
        slippage: { unit: "pct", value: 1 },
        fillModel: "candle_open",
        applyChargesIntraday: false,
        seed: 0xc0ffee,
      },
    });
    const res = runBacktest(strat, src, { ranAt: 0 });
    expect(res.flags).toContain("LOW_LIQUIDITY");
    // illiquid bump ×3 on a sell: entry = 100 × (1 - 0.03) = 97.
    expect(res.blotter[0]!.legs[0]!.entryPrice).toBe(97);
  });

  // ── 11. Multi-leg straddle books each leg's charges separately ────────────
  it("11) multi-leg short straddle books one computeCharges round-trip per leg", () => {
    const idx = flatIndex(DAY, 24250);
    const ce = flatContract(DAY, 24250, "CE", 100);
    const pe = flatContract(DAY, 24250, "PE", 120);
    const src = srcOf(idx, [ce, pe]);
    const strat = strategyFor(DAY, [leg("ce", "CE", "sell"), leg("pe", "PE", "sell")]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const legs = res.blotter[0]!.legs;
    expect(legs.length).toBe(2);
    const ceCharge = computeCharges(ZER, {
      segment: "OPT",
      product: "MIS",
      orders: 2,
      direction: "short",
      entryPrice: 100,
      exitPrice: 100,
      qty: 75,
    }).total;
    const peCharge = computeCharges(ZER, {
      segment: "OPT",
      product: "MIS",
      orders: 2,
      direction: "short",
      entryPrice: 120,
      exitPrice: 120,
      qty: 75,
    }).total;
    // cent-for-cent equality with computeCharges
    expect(legs.find((l) => l.optionType === "CE")!.charges).toBe(ceCharge);
    expect(legs.find((l) => l.optionType === "PE")!.charges).toBe(peCharge);
  });

  // ── Re-entry: RE_ASAP re-enters a fresh round-trip after a leg SL ─────────
  it("re-entry: RE_ASAP books a SECOND round-trip after a leg SL", () => {
    const idx = flatIndex(DAY, 24250);
    // entry 100; SL +30%→130 hit at minute 6 (close back to 100 after); RE_ASAP
    // re-enters at minute 6 open. End-of-day square-off books both round-trips.
    const closes: number[] = [];
    const highs: number[] = [];
    for (let i = 0; i < 376; i++) {
      closes.push(i === 6 ? 135 : 100);
      highs.push(i === 6 ? 135 : 100);
    }
    const ce = pathContract(DAY, 24250, "CE", closes, { highs });
    const src = srcOf(idx, [ce, flatContract(DAY, 24250, "PE", 100)]);
    const strat = strategyFor(DAY, [
      leg("ce", "CE", "sell", {
        stopLoss: { unit: "pct", basis: "premium", value: 30, refPrice: "traded" },
        reEntry: { mode: "RE_ASAP", maxCount: 2 },
      }),
    ]);
    const res = runBacktest(strat, src, { ranAt: 0 });
    const ceLegs = res.blotter[0]!.legs.filter((l) => l.optionType === "CE");
    expect(ceLegs.length).toBe(2); // original + 1 re-entry
  });

  // ── Finding 43: a single, consistent expiry source (first ENABLED leg) drives
  //    BOTH the data fetch AND the daysFromExpiry gate; a DISABLED legs[0] must
  //    NOT pick the contract chain or the expiry-distance the strategy trades on.
  it("43) disabled legs[0] does not drive expiry — data fetch + daysFromExpiry use the first ENABLED leg", () => {
    // DAY 2024-07-25 is the NIFTY weekly expiry: WEEKLY → expiry 2024-07-25
    // (daysToExpiry 0); NEXT_WEEKLY → expiry 2024-08-01 (daysToExpiry 5).
    const idx = flatIndex(DAY, 24250);
    const ce = flatContract(DAY, 24250, "CE", 100);
    const pe = flatContract(DAY, 24250, "PE", 100);

    // Record every expiry the engine actually fetches data for.
    const fetchedExpiries: string[] = [];
    const inner = srcOf(idx, [ce, pe]);
    const spy: DataSource = {
      snapshotId: inner.snapshotId,
      loadIndex: (i, d) => inner.loadIndex(i, d),
      loadOption: (i, e, d, s, t) => inner.loadOption(i, e, d, s, t),
      resolveStrike: (i, e, d, t, intent, spot) => inner.resolveStrike(i, e, d, t, intent, spot),
      atmStrike: (i, e, d, spot) => inner.atmStrike(i, e, d, spot),
      optionChainAt: (i, e, d) => inner.optionChainAt(i, e, d),
      coverageFor: (i, e, d, s, t) => inner.coverageFor(i, e, d, s, t),
      dayData: (i, e, d) => {
        fetchedExpiries.push(e);
        return inner.dayData(i, e, d);
      },
    };

    // legs[0] is DISABLED with a DIFFERENT expiry rule (NEXT_WEEKLY → 2024-08-01,
    // daysToExpiry 5). The first ENABLED leg is WEEKLY (→ 2024-07-25, dte 0).
    // daysFromExpiry:[0] passes ONLY against WEEKLY; if the disabled leg drove the
    // gate (dte 5) the day would be filtered out and no row would book.
    const strat = strategyFor(
      DAY,
      [
        leg("ce", "CE", "sell", { enabled: false, expiry: "NEXT_WEEKLY" }),
        leg("pe", "PE", "sell", { enabled: true, expiry: "WEEKLY" }),
      ],
      {
        timing: {
          mode: "fixed_time",
          entryTime: "09:20",
          exitTime: "15:15",
          daysFromExpiry: [0],
        },
      }
    );
    const res = runBacktest(strat, spy, { ranAt: 0 });

    // Filter resolved against the first ENABLED leg (WEEKLY, dte 0 ∈ [0]) → traded.
    expect(res.blotter.length).toBe(1);
    expect(res.blotter[0]!.legs.map((l) => l.optionType)).toEqual(["PE"]);
    // Data was fetched for the first ENABLED leg's expiry (WEEKLY → 2024-07-25),
    // NOT the disabled legs[0]'s NEXT_WEEKLY (2024-08-01).
    expect(fetchedExpiries).toContain(EXP);
    expect(fetchedExpiries).not.toContain("2024-08-01");
  });

  // ── Finding 42: filledBarFraction must describe only the TRADED sample —
  //    non-traded (filtered / excluded) spine days must NOT inflate the numerator
  //    or denominator.
  it("42) filledBarFraction counts only days that book a row (filtered days excluded)", () => {
    // Two-day spine: 2024-07-24 (daysToExpiry 1, FILTERED by daysFromExpiry:[0])
    // and 2024-07-25 (daysToExpiry 0, TRADED). The traded day carries only 200 of
    // 375 index bars (partial coverage); the filtered day carries a FULL 376-bar
    // index. If the filtered day were counted, the fraction would be pulled up.
    const D0 = "2024-07-24"; // filtered out
    const D1 = "2024-07-25"; // traded
    const EXP1 = "2024-07-25";

    const tradedIdx = flatIndex(D1, 24250, 200); // 200 bars, entry minute 5 present
    const tradedCe = flatContract(D1, 24250, "CE", 100, 200);
    const tradedPe = flatContract(D1, 24250, "PE", 100, 200);

    const filteredIdx = flatIndex(D0, 24250, 376); // FULL session — would inflate
    const filteredCe = flatContract(D0, 24250, "CE", 100, 376);
    const filteredPe = flatContract(D0, 24250, "PE", 100, 376);

    const src = new FixtureDataSource(
      snapshot([
        makeDay(D0, EXP, filteredIdx, [filteredCe, filteredPe]),
        makeDay(D1, EXP1, tradedIdx, [tradedCe, tradedPe]),
      ])
    );

    const strat = strategyFor(D1, [leg("ce", "CE", "sell", { enabled: true })], {
      market: { symbol: "NIFTY", interval: "1m", dateRange: { start: D0, end: D1 } },
      timing: {
        mode: "fixed_time",
        entryTime: "09:20",
        exitTime: "15:15",
        daysFromExpiry: [0],
      },
    });
    const res = runBacktest(strat, src, { ranAt: 0 });

    // Only the traded day books a row.
    expect(res.blotter.length).toBe(1);
    expect(res.blotter[0]!.day).toBe(D1);
    // filledBarFraction = traded barsPresent / barsExpected = 200 / 375 ≈ 0.5333.
    // (If the FILTERED day were counted it would be (200+376)/(375+375) ≈ 0.7680.)
    expect(res.coverage.filledBarFraction).toBeCloseTo(200 / 375, 4);
  });
});
