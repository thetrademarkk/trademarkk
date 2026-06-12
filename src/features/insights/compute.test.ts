import { describe, expect, it } from "vitest";
import type { TradeLike } from "@/lib/stats/stats";
import {
  computeInsights,
  dayOfWeekInsight,
  feeDragInsight,
  hasEntryTime,
  hourOfDayInsight,
  instrumentsInsight,
  longShortInsight,
  MIN_SAMPLE,
  payoffInsight,
  revengeInsight,
  ruleBreakInsight,
  splitRevenge,
  streaksInsight,
} from "./compute";

type FixtureTrade = TradeLike & { charges: number };

let seq = 0;

/**
 * Fixture builder. Timestamps are built from LOCAL date parts so weekday/hour
 * bucketing is timezone-independent (tests pass in IST and UTC CI alike).
 */
function mk(opts: {
  pnl: number;
  opened?: Date;
  closed?: Date;
  symbol?: string;
  direction?: "long" | "short";
  charges?: number;
  gross?: number;
  status?: "open" | "closed";
}): FixtureTrade {
  const opened = opts.opened ?? new Date(2026, 5, 9, 10, 15); // Tue 9 Jun 2026, 10:15
  const closed = opts.closed ?? new Date(opened.getTime() + 30 * 60 * 1000);
  return {
    id: `t${++seq}`,
    net_pnl: opts.pnl,
    gross_pnl: opts.gross ?? opts.pnl,
    r_multiple: null,
    opened_at: opened.toISOString(),
    closed_at: opts.status === "open" ? null : closed.toISOString(),
    status: opts.status ?? "closed",
    symbol: opts.symbol ?? "NIFTY",
    segment: "OPT",
    direction: opts.direction ?? "long",
    playbook_id: null,
    charges: opts.charges ?? 0,
  };
}

/** n trades on a given local weekday/hour. June 2026: 1st = Monday. */
function onDay(weekday: number, hour: number, pnls: number[]): FixtureTrade[] {
  // day-of-month for the first occurrence of `weekday` in June 2026 (Mon=1).
  const dom = weekday === 0 ? 7 : weekday;
  return pnls.map((pnl, i) =>
    mk({ pnl, opened: new Date(2026, 5, dom + 7 * (i % 4), hour, 15 + i) })
  );
}

describe("n<5 suppression", () => {
  it("suppresses every insight for an empty journal", () => {
    expect(computeInsights([])).toEqual([]);
  });

  it("suppresses day-of-week with only 4 trades per bucket", () => {
    const trades = [...onDay(2, 10, [100, 200, -50, 300]), ...onDay(5, 10, [-100, -200, 50, -300])];
    expect(dayOfWeekInsight(trades)).toBeNull();
  });

  it("emits day-of-week once both buckets reach MIN_SAMPLE", () => {
    const trades = [
      ...onDay(2, 10, [100, 200, -50, 300, 150]),
      ...onDay(5, 10, [-100, -200, 50, -300, -80]),
    ];
    expect(trades.filter((t) => new Date(t.opened_at).getDay() === 2)).toHaveLength(MIN_SAMPLE);
    const insight = dayOfWeekInsight(trades);
    expect(insight).not.toBeNull();
    expect(insight!.sentence).toContain("Tuesdays are your most profitable day");
    expect(insight!.sentence).toContain("Fridays are your weakest");
    expect(insight!.severity).toBe("negative"); // Fridays lost money
    expect(insight!.figures[0]?.amount).toBe(700);
    expect(insight!.figures[1]?.amount).toBe(-630);
  });

  it("ignores buckets under MIN_SAMPLE even when others qualify", () => {
    const trades = [
      ...onDay(2, 10, [100, 200, -50, 300, 150]), // 5 Tuesday trades
      ...onDay(1, 10, [50, 60, 70, -20, 10]), // 5 Monday trades
      ...onDay(5, 10, [-9999]), // 1 catastrophic Friday — too small to count
    ];
    const insight = dayOfWeekInsight(trades)!;
    expect(insight.sentence).not.toContain("Friday");
  });

  it("suppresses payoff without 5 wins AND 5 losses", () => {
    const trades = [
      ...[100, 120, 90, 80, 110].map((pnl) => mk({ pnl })),
      ...[-50, -60].map((pnl) => mk({ pnl })),
    ];
    expect(payoffInsight(trades)).toBeNull();
  });

  it("suppresses long-short when one side is thin", () => {
    const trades = [
      ...[100, -50, 80, 90, -20].map((pnl) => mk({ pnl, direction: "long" })),
      ...[40, -10].map((pnl) => mk({ pnl, direction: "short" })),
    ];
    expect(longShortInsight(trades)).toBeNull();
  });

  it("suppresses streaks and fee drag under 5 closed trades", () => {
    const trades = [mk({ pnl: 100 }), mk({ pnl: -50 }), mk({ pnl: 60 }), mk({ pnl: 70 })];
    expect(streaksInsight(trades)).toBeNull();
    expect(feeDragInsight(trades)).toBeNull();
  });
});

describe("payoff & expectancy math", () => {
  it("computes avg winner, avg loser, ratio and expectancy", () => {
    const wins = [200, 300, 100, 250, 150].map((pnl) => mk({ pnl })); // avg 200
    const losses = [-100, -50, -150, -120, -80].map((pnl) => mk({ pnl })); // avg -100
    const insight = payoffInsight([...wins, ...losses])!;
    expect(insight.sentence).toContain("2.0× the size of your average loser");
    expect(insight.sentence).toContain("win 50%");
    expect(insight.figures[0]?.amount).toBe(200);
    expect(insight.figures[1]?.amount).toBe(-100);
    expect(insight.figures[2]?.amount).toBe(50); // (1000 - 500) / 10
    expect(insight.severity).toBe("positive");
  });

  it("flips the sentence and severity when losers dominate", () => {
    const wins = [50, 60, 40, 55, 45].map((pnl) => mk({ pnl })); // avg 50
    const losses = [-100, -110, -90, -105, -95].map((pnl) => mk({ pnl })); // avg -100
    const insight = payoffInsight([...wins, ...losses])!;
    expect(insight.sentence).toContain("losers are outweighing winners");
    expect(insight.severity).toBe("negative");
  });
});

describe("streaks", () => {
  it("reports longest win/loss runs in close order", () => {
    const pnls = [100, 100, 100, -50, -50, 100];
    const base = new Date(2026, 5, 9, 10, 0).getTime();
    const trades = pnls.map((pnl, i) =>
      mk({ pnl, opened: new Date(base + i * 3.6e6), closed: new Date(base + i * 3.6e6 + 60000) })
    );
    const insight = streaksInsight(trades)!;
    expect(insight.sentence).toContain("winning streak is 3 trades");
    expect(insight.sentence).toContain("losing streak is 2");
    expect(insight.figures[0]?.text).toBe("1 win");
  });
});

describe("revenge trading", () => {
  /** A losing trade, then a follow-up opened `gapMin` minutes after its close. */
  function lossThenTrade(dayHour: Date, gapMin: number, followPnl: number): FixtureTrade[] {
    const lossClose = new Date(dayHour.getTime() + 10 * 60000);
    const loss = mk({ pnl: -100, opened: dayHour, closed: lossClose });
    const follow = mk({
      pnl: followPnl,
      opened: new Date(lossClose.getTime() + gapMin * 60000),
      closed: new Date(lossClose.getTime() + (gapMin + 10) * 60000),
    });
    return [loss, follow];
  }

  it("classifies <15min follow-ups as revenge, not later ones", () => {
    const day = (i: number) => new Date(2026, 5, 1 + i, 10, 0);
    const trades = [
      ...lossThenTrade(day(0), 5, -200),
      ...lossThenTrade(day(1), 14, -150),
      ...lossThenTrade(day(2), 60, 300), // outside the window → rest
    ];
    const { revenge, rest } = splitRevenge(trades);
    expect(revenge.map((t) => t.net_pnl)).toEqual([-200, -150]);
    expect(rest).toHaveLength(4);
  });

  it("does not classify a trade as revenge of itself", () => {
    const open = new Date(2026, 5, 9, 10, 0);
    const instantLoss = mk({ pnl: -100, opened: open, closed: open });
    expect(splitRevenge([instantLoss]).revenge).toHaveLength(0);
  });

  it("suppresses below 5 revenge trades", () => {
    const day = (i: number) => new Date(2026, 5, 1 + i, 10, 0);
    const trades = [
      ...lossThenTrade(day(0), 5, -200),
      ...lossThenTrade(day(1), 5, -150),
      ...lossThenTrade(day(2), 5, -100),
      ...lossThenTrade(day(3), 5, -120), // only 4 revenge trades
    ];
    expect(revengeInsight(trades)).toBeNull();
  });

  it("flags the pattern when revenge trades win less often", () => {
    const day = (i: number) => new Date(2026, 5, 1 + i, 10, 0);
    const trades = [
      ...lossThenTrade(day(0), 5, -200),
      ...lossThenTrade(day(1), 5, -150),
      ...lossThenTrade(day(2), 5, -100),
      ...lossThenTrade(day(3), 5, -120),
      ...lossThenTrade(day(4), 5, 50),
      mk({ pnl: 500, opened: day(10) }),
      mk({ pnl: 400, opened: day(11) }),
    ];
    const insight = revengeInsight(trades)!;
    expect(insight.severity).toBe("negative");
    expect(insight.sentence).toContain("within 15 minutes of a loss win just 20%");
  });
});

describe("hour-of-day", () => {
  it("only counts trades that carry a real entry time", () => {
    expect(hasEntryTime(new Date(2026, 5, 9, 0, 0, 0).toISOString())).toBe(false);
    expect(hasEntryTime(new Date(2026, 5, 9, 9, 21).toISOString())).toBe(true);
    // date-only imports (local midnight) must not produce an hour insight
    const midnight = (pnl: number, day: number) =>
      mk({ pnl, opened: new Date(2026, 5, day, 0, 0, 0) });
    const trades = [
      ...[1, 2, 3, 4, 5].map((d) => midnight(100, d)),
      ...[8, 9, 10, 11, 12].map((d) => midnight(-100, d)),
    ];
    expect(hourOfDayInsight(trades)).toBeNull();
  });

  it("names the best and worst entry hours", () => {
    const trades = [
      ...onDay(2, 9, [200, 300, 100, 250, -50]),
      ...onDay(2, 14, [-100, -200, -50, 60, -150]),
    ];
    const insight = hourOfDayInsight(trades)!;
    expect(insight.sentence).toContain("9am–10am");
    expect(insight.sentence).toContain("2pm–3pm");
    expect(insight.figures[0]?.amount).toBe(800);
  });
});

describe("instruments & direction", () => {
  it("ranks the top symbols and names best/worst", () => {
    const sym = (s: string, pnls: number[]) => pnls.map((pnl) => mk({ pnl, symbol: s }));
    const trades = [
      ...sym("BANKNIFTY", [500, 300, -100, 400, 200, 100]),
      ...sym("NIFTY", [-200, -300, 100, -150, -250]),
      ...sym("RELIANCE", [50, 60]), // under MIN_SAMPLE → excluded
    ];
    const insight = instrumentsInsight(trades)!;
    expect(insight.sentence).toBe("BANKNIFTY makes you the most; NIFTY costs you the most.");
    expect(insight.figures).toHaveLength(2);
    expect(insight.figures[0]?.label).toContain("BANKNIFTY · 6 trades");
    expect(insight.figures.some((f) => f.label.includes("RELIANCE"))).toBe(false);
  });

  it("compares long vs short win rates", () => {
    const trades = [
      ...[100, 200, -50, 150, 120].map((pnl) => mk({ pnl, direction: "long" })),
      ...[-100, -80, 60, -120, -40].map((pnl) => mk({ pnl, direction: "short" })),
    ];
    const insight = longShortInsight(trades)!;
    expect(insight.sentence).toBe("You win 80% of your longs and 20% of your shorts.");
    expect(insight.severity).toBe("negative");
  });
});

describe("fee drag & rule breaks", () => {
  it("reports charges as a share of gross profits", () => {
    const trades = [100, 200, 300, -100, 150].map((pnl) =>
      mk({ pnl, gross: pnl + 25, charges: 25 })
    );
    const insight = feeDragInsight(trades)!;
    expect(insight.sentence).toContain("16% of your gross profits"); // 125 / 775
    expect(insight.figures[1]?.amount).toBe(-125);
    expect(insight.severity).toBe("neutral");
  });

  it("turns negative when fees eat ≥25% of gross", () => {
    const trades = [100, 100, 100, 100, 100].map((pnl) =>
      mk({ pnl, gross: pnl + 50, charges: 50 })
    );
    expect(feeDragInsight(trades)!.severity).toBe("negative");
  });

  it("stays silent when gross is negative (no honest percentage exists)", () => {
    const trades = [-100, -200, -300, -100, -150].map((pnl) =>
      mk({ pnl, gross: pnl + 20, charges: 20 })
    );
    expect(feeDragInsight(trades)).toBeNull();
  });

  it("surfaces the costliest broken rule above the break threshold", () => {
    const insight = ruleBreakInsight([
      { text: "No trades after 2:30pm", broken: 4, brokenDayCost: -1200.5 },
      { text: "Respect the stop loss", broken: 2, brokenDayCost: -9000 }, // too few breaks
      { text: "Max 3 trades a day", broken: 6, brokenDayCost: 0 }, // cost-free
    ]);
    expect(insight).not.toBeNull();
    expect(insight!.sentence).toContain("No trades after 2:30pm");
    expect(insight!.sentence).toContain("4 times");
    expect(insight!.figures[0]?.amount).toBe(-1200.5);
    expect(ruleBreakInsight([])).toBeNull();
  });
});

describe("computeInsights orchestration", () => {
  it("ignores open trades and assembles only qualifying sections", () => {
    const trades = [
      ...onDay(2, 10, [100, 200, -50, 300, 150]),
      ...onDay(5, 13, [-100, -200, 50, -300, -80]),
      mk({ pnl: 0, status: "open" }),
    ];
    const insights = computeInsights(trades);
    const ids = insights.map((i) => i.id);
    expect(ids).toContain("day-of-week");
    expect(ids).toContain("payoff");
    expect(ids).toContain("streaks");
    expect(ids).not.toContain("long-short"); // all longs — no short bucket
    expect(ids).not.toContain("revenge"); // gaps are days, not minutes
    // a single open trade contributes nothing
    expect(computeInsights([mk({ pnl: 0, status: "open" })])).toEqual([]);
  });
});
