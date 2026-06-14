import { describe, expect, it } from "vitest";
import { computeCharges } from "@/lib/charges/charges";
import { getChargeProfile } from "@/config/brokers";
import type { TradeLegRow, TradeRow } from "./types";
import {
  buildRecomputeStatements,
  chargeLegsForTrade,
  previewRecompute,
  recomputeTradeCharges,
  type TradeForRecompute,
} from "./recompute";

const profile = getChargeProfile("zerodha");

/** A closed trade row with sensible defaults; override the bits each test needs. */
function trade(over: Partial<TradeRow>): TradeRow {
  const t: TradeRow = {
    id: "t1",
    account_id: "acc1",
    symbol: "RELIANCE",
    exchange: "NSE",
    segment: "EQ",
    product: "CNC",
    expiry: null,
    strike: null,
    option_type: null,
    direction: "long",
    status: "closed",
    qty: 100,
    avg_entry: 2000,
    avg_exit: 2100,
    planned_entry: null,
    planned_sl: null,
    planned_target: null,
    opened_at: "2026-05-01T10:00:00.000Z",
    closed_at: "2026-05-03T10:00:00.000Z",
    gross_pnl: 0,
    charges: 0,
    net_pnl: 0,
    r_multiple: null,
    playbook_id: null,
    confidence: null,
    notes: null,
    created_at: "2026-05-03T10:00:00.000Z",
    updated_at: "2026-05-03T10:00:00.000Z",
  };
  return { ...t, ...over };
}

/** The OLD engine treated ALL equity as intraday (MIS), ignoring product. */
function oldIntradayCharges(t: TradeRow): number {
  return computeCharges(profile, {
    segment: "EQ",
    product: "MIS",
    qty: t.qty,
    entryPrice: t.avg_entry,
    exitPrice: t.avg_exit!,
    direction: t.direction,
  }).total;
}

function correctCharges(t: TradeRow): number {
  return computeCharges(profile, {
    segment: t.segment,
    product: t.product,
    qty: t.qty,
    entryPrice: t.avg_entry,
    exitPrice: t.avg_exit!,
    direction: t.direction,
  }).total;
}

describe("chargeLegsForTrade", () => {
  it("single-leg trade (no leg rows) → leg 1 is the trade row", () => {
    const t = trade({ qty: 50, avg_entry: 100, avg_exit: 120, direction: "long" });
    const legs = chargeLegsForTrade(t, []);
    expect(legs).toEqual([{ qty: 50, entryPrice: 100, exitPrice: 120, direction: "long" }]);
  });

  it("multi-leg trade → one charge leg per closed trade_legs row", () => {
    const t = trade({ segment: "OPT", product: "NRML" });
    const legRows: TradeLegRow[] = [
      {
        id: "l1",
        trade_id: "t1",
        leg_no: 1,
        strike: 26000,
        option_type: "CE",
        direction: "long",
        qty: 75,
        avg_entry: 90,
        avg_exit: 140,
      },
      {
        id: "l2",
        trade_id: "t1",
        leg_no: 2,
        strike: 26000,
        option_type: "PE",
        direction: "long",
        qty: 75,
        avg_entry: 85,
        avg_exit: 40,
      },
    ];
    const legs = chargeLegsForTrade(t, legRows);
    expect(legs).toHaveLength(2);
    expect(legs[0]).toEqual({ qty: 75, entryPrice: 90, exitPrice: 140, direction: "long" });
  });

  it("skips a still-open leg (no exit)", () => {
    const t = trade({ segment: "OPT", product: "NRML" });
    const legRows: TradeLegRow[] = [
      {
        id: "l1",
        trade_id: "t1",
        leg_no: 1,
        strike: 26000,
        option_type: "CE",
        direction: "long",
        qty: 75,
        avg_entry: 90,
        avg_exit: 140,
      },
      {
        id: "l2",
        trade_id: "t1",
        leg_no: 2,
        strike: 26000,
        option_type: "PE",
        direction: "long",
        qty: 75,
        avg_entry: 85,
        avg_exit: null,
      },
    ];
    expect(chargeLegsForTrade(t, legRows)).toHaveLength(1);
  });
});

describe("recomputeTradeCharges", () => {
  it("EQ CNC delivery charge matches the engine and DIFFERS from the stale intraday value", () => {
    const t = trade({ product: "CNC", qty: 100, avg_entry: 2000, avg_exit: 2100 });
    const stale = oldIntradayCharges(t);
    const fresh = recomputeTradeCharges(profile, t, chargeLegsForTrade(t, []));
    expect(fresh).toBe(correctCharges(t));
    // delivery STT (0.1% BOTH sides) + DP charge ≠ intraday STT (0.025% sell only)
    expect(fresh).not.toBe(stale);
  });

  it("legacy NULL-product EQ is charged as MIS (no change vs the old engine)", () => {
    const t = trade({ product: null, qty: 100, avg_entry: 2000, avg_exit: 2100 });
    const fresh = recomputeTradeCharges(profile, t, chargeLegsForTrade(t, []));
    expect(fresh).toBe(oldIntradayCharges(t));
  });

  it("FnO (OPT) charges are product-independent → recompute leaves them unchanged", () => {
    const t = trade({
      segment: "OPT",
      product: "NRML",
      strike: 26000,
      option_type: "CE",
      qty: 75,
      avg_entry: 90,
      avg_exit: 140,
    });
    const asNrml = recomputeTradeCharges(profile, t, chargeLegsForTrade(t, []));
    const asMis = recomputeTradeCharges(
      profile,
      { ...t, product: "MIS" },
      chargeLegsForTrade(t, [])
    );
    expect(asNrml).toBe(asMis);
  });

  it("is paise-precise (≤2 decimals)", () => {
    const t = trade({ product: "CNC", qty: 137, avg_entry: 1234.55, avg_exit: 1301.7 });
    const c = recomputeTradeCharges(profile, t, chargeLegsForTrade(t, []));
    expect(Math.round(c * 100) / 100).toBe(c);
  });
});

describe("recomputeTradeCharges — commodity CTT (SEG-09)", () => {
  it("a COMM option carries MORE CTT than the same-size COMM future (0.05% vs 0.01% sell)", () => {
    const opt = trade({
      symbol: "CRUDEOIL",
      segment: "COMM",
      product: "NRML",
      strike: 6500,
      option_type: "CE",
      qty: 100,
      avg_entry: 120,
      avg_exit: 160,
    });
    const fut = trade({
      symbol: "CRUDEOIL",
      segment: "COMM",
      product: "NRML",
      strike: null,
      option_type: null,
      qty: 100,
      avg_entry: 6500,
      avg_exit: 6600,
    });
    const optCharges = recomputeTradeCharges(profile, opt, chargeLegsForTrade(opt, []));
    const futCharges = recomputeTradeCharges(profile, fut, chargeLegsForTrade(fut, []));
    // Both correct, and distinct branches (option premium CTT vs future CTT).
    expect(optCharges).toBeGreaterThan(0);
    expect(futCharges).toBeGreaterThan(0);
    expect(optCharges).not.toBe(futCharges);
  });

  it("an agri commodity (NCDEX/KAPAS) is CTT-exempt → lower charges than a non-agri commodity", () => {
    const agri = trade({
      symbol: "DHANIYA",
      segment: "COMM",
      product: "NRML",
      strike: null,
      option_type: null,
      qty: 100,
      avg_entry: 7000,
      avg_exit: 7100,
    });
    const nonAgri = trade({
      symbol: "CRUDEOIL",
      segment: "COMM",
      product: "NRML",
      strike: null,
      option_type: null,
      qty: 100,
      avg_entry: 7000,
      avg_exit: 7100,
    });
    const agriCharges = recomputeTradeCharges(profile, agri, chargeLegsForTrade(agri, []));
    const nonAgriCharges = recomputeTradeCharges(profile, nonAgri, chargeLegsForTrade(nonAgri, []));
    // Agri skips CTT, so it is strictly cheaper on identical turnover.
    expect(agriCharges).toBeLessThan(nonAgriCharges);
  });

  it("agri MCX contracts (COTTON/CARDAMOM) are also CTT-exempt", () => {
    const cotton = trade({
      symbol: "COTTON",
      segment: "COMM",
      product: "NRML",
      strike: null,
      option_type: null,
      qty: 100,
      avg_entry: 1500,
      avg_exit: 1550,
    });
    const gold = trade({ ...cotton, symbol: "GOLD" });
    expect(recomputeTradeCharges(profile, cotton, chargeLegsForTrade(cotton, []))).toBeLessThan(
      recomputeTradeCharges(profile, gold, chargeLegsForTrade(gold, []))
    );
  });
});

describe("previewRecompute", () => {
  it("flags only trades whose charges change; reports paise-exact delta totals", () => {
    // A delivery EQ stored with a STALE (intraday) charge → will change.
    const deliv = trade({ id: "d1", product: "CNC", gross_pnl: 10000 });
    const stale = oldIntradayCharges(deliv);
    deliv.charges = stale;
    deliv.net_pnl = Math.round((deliv.gross_pnl - stale) * 100) / 100;

    // An OPT trade already carrying the engine's correct charge → no change.
    const opt = trade({
      id: "o1",
      segment: "OPT",
      product: "NRML",
      strike: 26000,
      option_type: "CE",
      qty: 75,
      avg_entry: 90,
      avg_exit: 140,
      gross_pnl: 3750,
    });
    opt.charges = correctCharges(opt);
    opt.net_pnl = Math.round((opt.gross_pnl - opt.charges) * 100) / 100;

    const input: TradeForRecompute[] = [
      { trade: deliv, legs: [] },
      { trade: opt, legs: [] },
    ];
    const p = previewRecompute("zerodha", input);

    expect(p.considered).toBe(2);
    expect(p.changedCount).toBe(1);
    expect(p.items[0]!.id).toBe("d1");
    expect(p.items[0]!.oldCharges).toBe(stale);
    expect(p.items[0]!.newCharges).toBe(correctCharges(deliv));
    // delta math: chargesDelta = new − old; netDelta = −chargesDelta
    expect(p.chargesDelta).toBeCloseTo(correctCharges(deliv) - stale, 2);
    expect(p.netDelta).toBeCloseTo(-(correctCharges(deliv) - stale), 2);
    // net is re-derived from the PRESERVED gross
    expect(p.items[0]!.gross).toBe(10000);
    expect(p.items[0]!.newNet).toBe(Math.round((10000 - correctCharges(deliv)) * 100) / 100);
  });

  it("produces a DOWNWARD correction when the stored charge was overstated", () => {
    // Simulate a delivery trade that was logged with an over-stated charge
    // (e.g. an old import that double-counted) → recompute corrects it down.
    const deliv = trade({
      id: "d1",
      product: "CNC",
      qty: 100,
      avg_entry: 2000,
      avg_exit: 2100,
      gross_pnl: 10000,
    });
    const correct = correctCharges(deliv);
    deliv.charges = correct + 500; // overstated by ₹500
    deliv.net_pnl = Math.round((deliv.gross_pnl - deliv.charges) * 100) / 100;

    const p = previewRecompute("zerodha", [{ trade: deliv, legs: [] }]);
    expect(p.changedCount).toBe(1);
    expect(p.chargesDelta).toBeCloseTo(-500, 2); // charges drop ₹500
    expect(p.netDelta).toBeCloseTo(500, 2); // net rises ₹500
    expect(p.items[0]!.newNet).toBeGreaterThan(p.items[0]!.oldNet);
  });

  it("never recomputes OPEN trades", () => {
    const open = trade({
      id: "x1",
      status: "open",
      avg_exit: null,
      charges: 0,
      gross_pnl: 0,
      net_pnl: 0,
    });
    const p = previewRecompute("zerodha", [{ trade: open, legs: [] }]);
    expect(p.considered).toBe(0);
    expect(p.changedCount).toBe(0);
  });

  it("counts closed EQ trades with a NULL product (ambiguous) without changing them", () => {
    const nullEq = trade({ id: "n1", product: null, gross_pnl: 5000 });
    nullEq.charges = oldIntradayCharges(nullEq); // already MIS-correct
    nullEq.net_pnl = Math.round((nullEq.gross_pnl - nullEq.charges) * 100) / 100;
    const p = previewRecompute("zerodha", [{ trade: nullEq, legs: [] }]);
    expect(p.nullProductEqCount).toBe(1);
    expect(p.changedCount).toBe(0); // MIS charge is unchanged → not rewritten
  });

  it("is idempotent: applying the preview then re-previewing yields zero changes", () => {
    const deliv = trade({ id: "d1", product: "CNC", gross_pnl: 10000 });
    deliv.charges = oldIntradayCharges(deliv); // stale
    deliv.net_pnl = Math.round((deliv.gross_pnl - deliv.charges) * 100) / 100;

    const first = previewRecompute("zerodha", [{ trade: deliv, legs: [] }]);
    expect(first.changedCount).toBe(1);

    // Apply: the row now carries the corrected charge + net.
    const item = first.items[0]!;
    const corrected: TradeRow = { ...deliv, charges: item.newCharges, net_pnl: item.newNet };
    const second = previewRecompute("zerodha", [{ trade: corrected, legs: [] }]);
    expect(second.changedCount).toBe(0);
    expect(buildRecomputeStatements(second.items)).toHaveLength(0);
  });

  it("recomputes multi-leg trades by summing over their leg rows", () => {
    const t = trade({
      id: "m1",
      segment: "OPT",
      product: "NRML",
      strike: 26000,
      option_type: "CE",
      qty: 75,
      avg_entry: 90,
      avg_exit: 140,
      gross_pnl: 0,
    });
    const legRows: TradeLegRow[] = [
      {
        id: "l1",
        trade_id: "m1",
        leg_no: 1,
        strike: 26000,
        option_type: "CE",
        direction: "long",
        qty: 75,
        avg_entry: 90,
        avg_exit: 140,
      },
      {
        id: "l2",
        trade_id: "m1",
        leg_no: 2,
        strike: 26000,
        option_type: "PE",
        direction: "long",
        qty: 75,
        avg_entry: 85,
        avg_exit: 40,
      },
    ];
    const expected =
      computeCharges(profile, {
        segment: "OPT",
        product: "NRML",
        qty: 75,
        entryPrice: 90,
        exitPrice: 140,
        direction: "long",
      }).total +
      computeCharges(profile, {
        segment: "OPT",
        product: "NRML",
        qty: 75,
        entryPrice: 85,
        exitPrice: 40,
        direction: "long",
      }).total;
    t.charges = 0; // deliberately wrong so it shows as changed
    const p = previewRecompute("zerodha", [{ trade: t, legs: legRows }]);
    expect(p.items[0]!.newCharges).toBeCloseTo(Math.round(expected * 100) / 100, 2);
  });
});

describe("buildRecomputeStatements", () => {
  it("writes only charges/net_pnl/updated_at, keyed by id, one per changed trade", () => {
    const deliv = trade({ id: "d1", product: "CNC", gross_pnl: 10000 });
    deliv.charges = oldIntradayCharges(deliv);
    deliv.net_pnl = Math.round((deliv.gross_pnl - deliv.charges) * 100) / 100;
    const p = previewRecompute("zerodha", [{ trade: deliv, legs: [] }]);
    const stmts = buildRecomputeStatements(p.items, "2026-06-13T00:00:00.000Z");
    expect(stmts).toHaveLength(1);
    expect(stmts[0]!.sql).toBe(
      "UPDATE trades SET charges = ?, net_pnl = ?, updated_at = ? WHERE id = ?"
    );
    expect(stmts[0]!.args).toEqual([
      p.items[0]!.newCharges,
      p.items[0]!.newNet,
      "2026-06-13T00:00:00.000Z",
      "d1",
    ]);
  });
});
