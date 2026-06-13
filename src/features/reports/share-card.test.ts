import { describe, expect, it } from "vitest";
import { formatINR } from "@/lib/utils";
import type { TradeLike } from "@/lib/stats/stats";
import { buildReportShareCard, type ReportShareInput } from "./share-card";

let seq = 0;
function mk(over: Partial<TradeLike> = {}): TradeLike {
  seq++;
  return {
    id: `t${seq}`,
    net_pnl: 100,
    gross_pnl: 120,
    r_multiple: 1,
    opened_at: "2026-06-09T04:05:00.000Z",
    closed_at: "2026-06-09T05:35:00.000Z",
    status: "closed",
    symbol: "NIFTY",
    segment: "OPT",
    direction: "long",
    playbook_id: null,
    ...over,
  };
}

function input(trades: TradeLike[], over: Partial<ReportShareInput> = {}): ReportShareInput {
  return {
    kind: "week",
    label: "Week of 8 Jun",
    from: "2026-06-08",
    to: "2026-06-14",
    trades,
    ...over,
  };
}

// +1000.25 and +0.85 wins, −500.10 loss → net +501.00, 67% wins, PF 2.00.
const sample = () => [
  mk({
    net_pnl: 1000.25,
    gross_pnl: 1100.25,
    r_multiple: 2,
    closed_at: "2026-06-08T05:00:00.000Z",
  }),
  mk({ net_pnl: -500.1, gross_pnl: -450.1, r_multiple: -1, closed_at: "2026-06-09T05:00:00.000Z" }),
  mk({ net_pnl: 0.85, gross_pnl: 20.85, r_multiple: 0.5, closed_at: "2026-06-09T07:00:00.000Z" }),
];

describe("buildReportShareCard — privacy contract", () => {
  it("leaks NO rupee amount anywhere when P&L is not opted in", () => {
    const card = buildReportShareCard(input(sample()), { includePnl: false });
    expect(JSON.stringify(card)).not.toContain("₹");
  });

  it("uses the win rate as the hero when P&L is hidden", () => {
    const card = buildReportShareCard(input(sample()), { includePnl: false });
    expect(card.hero).toBe("67% WIN RATE");
    expect(card.heroKind).toBe("winrate");
    expect(card.heroTone).toBe("profit");
    expect(card.subline).toBe("3 trades · PF 2.00 · +0.5R avg");
  });

  it("colours sub-50% weeks with the loss tone", () => {
    const trades = [mk({ net_pnl: -100 }), mk({ net_pnl: -50 }), mk({ net_pnl: 75 })];
    const card = buildReportShareCard(input(trades), { includePnl: false });
    expect(card.heroTone).toBe("loss");
  });
});

describe("buildReportShareCard — opted-in ₹ P&L", () => {
  it("shows net P&L to the paisa as the hero", () => {
    const card = buildReportShareCard(input(sample()), { includePnl: true });
    expect(card.hero).toBe(formatINR(501.0000000000001, { decimals: true, signed: true }));
    expect(card.hero).toMatch(/501\.00/);
    expect(card.heroKind).toBe("pnl");
  });

  it("recomposes charges as gross − net in the subline (paise kept)", () => {
    // charges = (1100.25−1000.25) + (−450.10−−500.10) + (20.85−0.85) = 170.00
    const card = buildReportShareCard(input(sample()), { includePnl: true });
    expect(card.subline).toContain("3 trades · 67% wins · PF 2.00");
    expect(card.subline).toContain(`Charges ${formatINR(170, { decimals: true })}`);
  });
});

describe("buildReportShareCard — composition", () => {
  it("keeps the stats strip ₹-free in both modes", () => {
    for (const includePnl of [false, true]) {
      const card = buildReportShareCard(input(sample()), { includePnl });
      expect(card.stats).toEqual([
        { label: "Trades", value: "3" },
        { label: "Win rate", value: "67%" },
        { label: "Profit factor", value: "2.00" },
        { label: "Avg R", value: "+0.5R" },
      ]);
    }
  });

  it("renders ∞ when there are no losing trades", () => {
    const card = buildReportShareCard(input([mk({ net_pnl: 10 })]), { includePnl: false });
    expect(card.subline).toContain("PF ∞");
    expect(card.stats[2]).toEqual({ label: "Profit factor", value: "∞" });
    expect(card.subline).toContain("1 trade ·");
  });

  it("counts green/red days by daily net sign", () => {
    // Day 1: +1000.25 → green; day 2: −500.10 + 0.85 → red.
    const card = buildReportShareCard(input(sample()), { includePnl: false });
    expect(card.footnote).toBe("1 green day · 1 red day");
  });

  it("badges the period kind", () => {
    expect(buildReportShareCard(input(sample()), { includePnl: false }).badges).toEqual([
      { label: "WEEKLY REVIEW", tone: "accent" },
    ]);
    expect(
      buildReportShareCard(input(sample(), { kind: "month", label: "June 2026" }), {
        includePnl: false,
      }).badges
    ).toEqual([{ label: "MONTHLY REVIEW", tone: "accent" }]);
  });

  it("labels the date range and file name from the period bounds", () => {
    const card = buildReportShareCard(input(sample()), { includePnl: false });
    expect(card.dateLabel).toBe("8 Jun – 14 Jun 2026");
    expect(card.fileName).toBe("trademarkk-week-review-2026-06-08.png");
  });

  it("stays honest (no NaN, no ₹) on an empty period", () => {
    const card = buildReportShareCard(input([]), { includePnl: true });
    expect(card.hero).toBe("NO TRADES");
    expect(card.heroKind).toBe("quiet");
    expect(card.subline).toBeNull();
    expect(card.footnote).toBeNull();
    expect(JSON.stringify(card)).not.toContain("NaN");
    expect(JSON.stringify(card)).not.toContain("₹");
    expect(card.stats).toEqual([
      { label: "Trades", value: "0" },
      { label: "Win rate", value: "—" },
      { label: "Profit factor", value: "—" },
      { label: "Avg R", value: "—" },
    ]);
  });
});
