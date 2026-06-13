import { describe, expect, it } from "vitest";
import { formatINR } from "@/lib/utils";
import { buildTradeShareCard, type ShareableTrade } from "./share-card";

function mk(over: Partial<ShareableTrade> = {}): ShareableTrade {
  return {
    symbol: "BANKNIFTY",
    segment: "OPT",
    strike: 52000,
    option_type: "CE",
    expiry: "2026-06-11",
    direction: "long",
    status: "closed",
    qty: 30,
    avg_entry: 412.5,
    avg_exit: 460.25,
    opened_at: "2026-06-09T04:05:00.000Z",
    closed_at: "2026-06-09T05:35:00.000Z",
    gross_pnl: 1432.5,
    charges: 197.94,
    net_pnl: 1234.56,
    r_multiple: 1.5,
    playbook_name: "Opening Range Breakout",
    ...over,
  };
}

describe("buildTradeShareCard — privacy contract", () => {
  it("leaks NO rupee amount anywhere when P&L is not opted in", () => {
    const card = buildTradeShareCard(mk(), { includePnl: false });
    expect(JSON.stringify(card)).not.toContain("₹");
    expect(JSON.stringify(card)).not.toContain("1,234");
  });

  it("falls back to the R multiple hero when P&L is hidden", () => {
    const card = buildTradeShareCard(mk(), { includePnl: false });
    expect(card.hero).toBe("+1.5R");
    expect(card.heroKind).toBe("r");
    expect(card.heroTone).toBe("profit");
    expect(card.subline).toBeNull();
  });

  it("falls back to WIN/LOSS when there is no R either", () => {
    const win = buildTradeShareCard(mk({ r_multiple: null }), { includePnl: false });
    expect(win.hero).toBe("WIN");
    expect(win.heroKind).toBe("result");
    const loss = buildTradeShareCard(mk({ r_multiple: null, net_pnl: -10 }), {
      includePnl: false,
    });
    expect(loss.hero).toBe("LOSS");
    expect(loss.heroTone).toBe("loss");
  });
});

describe("buildTradeShareCard — opted-in ₹ P&L", () => {
  it("shows net P&L to the paisa as the hero", () => {
    const card = buildTradeShareCard(mk(), { includePnl: true });
    expect(card.hero).toBe(formatINR(1234.56, { decimals: true, signed: true }));
    expect(card.hero).toMatch(/1,234\.56/);
    expect(card.heroKind).toBe("pnl");
    expect(card.heroTone).toBe("profit");
  });

  it("breaks down gross, charges and R in the subline (paise kept)", () => {
    const card = buildTradeShareCard(mk(), { includePnl: true });
    expect(card.subline).toContain(formatINR(1432.5, { decimals: true, signed: true }));
    expect(card.subline).toContain(formatINR(197.94, { decimals: true }));
    expect(card.subline).toContain("+1.5R");
  });

  it("uses loss tone for negative net P&L", () => {
    const card = buildTradeShareCard(mk({ net_pnl: -0.05, gross_pnl: 100, charges: 100.05 }), {
      includePnl: true,
    });
    expect(card.heroTone).toBe("loss");
    expect(card.hero).toMatch(/0\.05/);
  });
});

describe("buildTradeShareCard — open trades", () => {
  it("shows OPEN and never a ₹ amount, even when opted in", () => {
    const card = buildTradeShareCard(
      mk({ status: "open", avg_exit: null, closed_at: null, net_pnl: 0, gross_pnl: 0 }),
      { includePnl: true }
    );
    expect(card.hero).toBe("OPEN");
    expect(card.heroKind).toBe("open");
    expect(card.heroTone).toBe("warning");
    expect(JSON.stringify(card)).not.toContain("₹");
    expect(card.badges.map((b) => b.label)).toContain("OPEN");
  });
});

describe("buildTradeShareCard — composition", () => {
  it("describes the instrument and direction", () => {
    const card = buildTradeShareCard(mk(), { includePnl: false });
    expect(card.title).toContain("BANKNIFTY 52000 CE");
    expect(card.badges[0]).toEqual({ label: "LONG", tone: "profit" });
  });

  it("marks shorts with the loss tone", () => {
    const card = buildTradeShareCard(mk({ direction: "short" }), { includePnl: false });
    expect(card.badges[0]).toEqual({ label: "SHORT", tone: "loss" });
  });

  it("adds a legs badge only for multi-leg trades", () => {
    const single = buildTradeShareCard(mk({ legCount: 1 }), { includePnl: false });
    expect(single.badges.map((b) => b.label)).not.toContain("1 LEGS");
    const multi = buildTradeShareCard(mk({ legCount: 2 }), { includePnl: false });
    expect(multi.badges).toContainEqual({ label: "2 LEGS", tone: "accent" });
  });

  it("fills the stats strip with entry/exit/qty/hold", () => {
    const card = buildTradeShareCard(mk(), { includePnl: false });
    expect(card.stats).toEqual([
      { label: "Entry", value: "412.50" },
      { label: "Exit", value: "460.25" },
      { label: "Qty", value: "30" },
      { label: "Hold", value: "1h 30m" },
    ]);
  });

  it("shows the setup footnote when a playbook is linked", () => {
    expect(buildTradeShareCard(mk(), { includePnl: false }).footnote).toBe(
      "Setup · Opening Range Breakout"
    );
    expect(
      buildTradeShareCard(mk({ playbook_name: null }), { includePnl: false }).footnote
    ).toBeNull();
  });

  it("builds an OS-safe file name from the contract", () => {
    const card = buildTradeShareCard(mk({ symbol: "M&M", strike: 1450 }), { includePnl: false });
    expect(card.fileName).toBe("trademarkk-M-M-1450-CE-2026-06-09.png");
  });
});
