import { describe, expect, it } from "vitest";
import {
  burstTiltInsight,
  computeTiltInsights,
  EARLY_TRADES,
  fadeTiltInsight,
  formatGap,
  median,
  paceTiltInsight,
  sizingTiltInsight,
  type TiltTradeLike,
} from "./tilt";

let seq = 0;

/**
 * Fixture builder. Timestamps are built from LOCAL date parts so day
 * bucketing is timezone-independent (tests pass in IST and UTC CI alike).
 */
function mk(opts: {
  pnl: number;
  opened?: Date;
  closed?: Date;
  qty?: number;
  entry?: number;
  status?: "open" | "closed";
}): TiltTradeLike {
  const opened = opts.opened ?? new Date(2026, 5, 9, 10, 15); // Tue 9 Jun 2026, 10:15
  const closed = opts.closed ?? new Date(opened.getTime() + 30 * 60 * 1000);
  return {
    id: `t${++seq}`,
    net_pnl: opts.pnl,
    gross_pnl: opts.pnl,
    r_multiple: null,
    opened_at: opened.toISOString(),
    closed_at: opts.status === "open" ? null : closed.toISOString(),
    status: opts.status ?? "closed",
    symbol: "NIFTY",
    segment: "OPT",
    direction: "long",
    playbook_id: null,
    qty: opts.qty ?? 50,
    avg_entry: opts.entry ?? 100,
  };
}

/** Local Date at day-of-June-2026 / hour / minute. */
const at = (day: number, hour: number, min = 0) => new Date(2026, 5, day, hour, min);

/** A small losing trade, then a follow-up of `qty` opened 5 minutes after its close. */
function lossThenSized(day: number, qty: number): TiltTradeLike[] {
  return [
    mk({ pnl: -100, qty: 50, opened: at(day, 10, 0), closed: at(day, 10, 10) }),
    mk({ pnl: -50, qty, opened: at(day, 10, 15), closed: at(day, 10, 30) }),
  ];
}

/** One calm baseline winner late in the day (never within 15min of a loss close). */
const baselineWin = (day: number) =>
  mk({ pnl: 100, qty: 50, opened: at(day, 13, 0), closed: at(day, 13, 30) });

describe("helpers", () => {
  it("median handles empty, odd and even inputs", () => {
    expect(median([])).toBe(0);
    expect(median([3])).toBe(3);
    expect(median([1, 3])).toBe(2);
    expect(median([5, 1, 3])).toBe(3);
  });

  it("formatGap switches from minutes to hours at 90 min", () => {
    expect(formatGap(4 * 60000)).toBe("4 min");
    expect(formatGap(89 * 60000)).toBe("89 min");
    expect(formatGap(90 * 60000)).toBe("1.5 hr");
    expect(formatGap(150 * 60000)).toBe("2.5 hr");
  });
});

describe("sizing tilt (revenge sizing)", () => {
  it("suppresses below 5 post-loss trades", () => {
    const trades = [
      ...[1, 2, 3, 4].flatMap((d) => lossThenSized(d, 200)),
      ...[8, 9, 10, 11, 12].map(baselineWin),
    ];
    expect(sizingTiltInsight(trades)).toBeNull();
  });

  it("flags oversized post-loss positions vs the user's own median", () => {
    const trades = [
      ...[1, 2, 3, 4, 5].flatMap((d) => lossThenSized(d, 200)), // 20,000 vs 5,000 notional
      ...[8, 9, 10, 11, 12, 13].map(baselineWin),
    ];
    const insight = sizingTiltInsight(trades)!;
    expect(insight).not.toBeNull();
    expect(insight.severity).toBe("negative");
    expect(insight.sentence).toContain("4.0× your usual size");
    expect(insight.figures[0]?.label).toContain("5 trades");
    expect(insight.figures[2]?.amount).toBe(-250); // 5 × -50 right after losses
  });

  it("gives the all-clear when post-loss size stays at baseline", () => {
    const trades = [
      ...[1, 2, 3, 4, 5].flatMap((d) => lossThenSized(d, 50)),
      ...[8, 9, 10, 11, 12, 13].map(baselineWin),
    ];
    const insight = sizingTiltInsight(trades)!;
    expect(insight.severity).toBe("positive");
    expect(insight.sentence).toContain("No revenge sizing");
  });
});

describe("pace tilt (rushed re-entries)", () => {
  /** A losing trade then a re-entry `gapMin` minutes after its close. */
  const lossGap = (day: number, gapMin: number) => [
    mk({ pnl: -100, opened: at(day, 10, 0), closed: at(day, 10, 10) }),
    mk({ pnl: 100, opened: at(day, 10, 10 + gapMin), closed: at(day, 11, 30) }),
  ];
  /** A winning trade then a re-entry `gapMin` minutes after its close. */
  const winGap = (day: number, gapMin: number) => [
    mk({ pnl: 100, opened: at(day, 10, 0), closed: at(day, 10, 10) }),
    mk({ pnl: 100, opened: at(day, 10, 10 + gapMin), closed: at(day, 11, 30) }),
  ];

  it("suppresses below 5 gaps on either side", () => {
    const trades = [
      ...[1, 2, 3, 4].flatMap((d) => lossGap(d, 4)),
      ...[8, 9, 10, 11, 12].flatMap((d) => winGap(d, 40)),
    ];
    expect(paceTiltInsight(trades)).toBeNull();
  });

  it("never pairs trades across days", () => {
    // Loss closes at 15:20; the "next" trade opens the following morning.
    const trades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((d) => [
      mk({ pnl: -100, opened: at(d, 15, 0), closed: at(d, 15, 20) }),
      mk({ pnl: 100, opened: at(d + 1, 9, 20), closed: at(d + 1, 9, 40) }),
    ]);
    expect(paceTiltInsight(trades)).toBeNull();
  });

  it("flags re-entries that come twice as fast after losses", () => {
    const trades = [
      ...[1, 2, 3, 4, 5].flatMap((d) => lossGap(d, 4)),
      ...[8, 9, 10, 11, 12].flatMap((d) => winGap(d, 40)),
    ];
    const insight = paceTiltInsight(trades)!;
    expect(insight.severity).toBe("negative");
    expect(insight.sentence).toContain("back in within 4 min");
    expect(insight.sentence).toContain("you wait 40 min");
    expect(insight.figures[0]?.text).toBe("4 min");
    expect(insight.figures[1]?.text).toBe("40 min");
  });

  it("gives the all-clear when pauses are similar either way", () => {
    const trades = [
      ...[1, 2, 3, 4, 5].flatMap((d) => lossGap(d, 30)),
      ...[8, 9, 10, 11, 12].flatMap((d) => winGap(d, 40)),
    ];
    const insight = paceTiltInsight(trades)!;
    expect(insight.severity).toBe("positive");
    expect(insight.sentence).toContain("No rushed re-entries");
  });
});

describe("fade tilt (late-session edge)", () => {
  /** Three morning winners, then one late trade with the given P&L. */
  const fadeDay = (day: number, latePnl: number) => [
    mk({ pnl: 100, opened: at(day, 9, 20) }),
    mk({ pnl: 100, opened: at(day, 10, 0) }),
    mk({ pnl: 100, opened: at(day, 10, 40) }),
    mk({ pnl: latePnl, opened: at(day, 13, 0) }),
  ];

  it("suppresses without 5 late trades", () => {
    const trades = [1, 2, 3, 4].flatMap((d) => fadeDay(d, -100));
    expect(fadeTiltInsight(trades)).toBeNull();
  });

  it("ignores date-only imports (no real entry times)", () => {
    const trades = [1, 2, 3, 4, 5].flatMap((d) =>
      [0, 1, 2, 3].map(() => mk({ pnl: 100, opened: new Date(2026, 5, d, 0, 0, 0) }))
    );
    expect(fadeTiltInsight(trades)).toBeNull();
  });

  it("flags a win-rate collapse after the first trades of the day", () => {
    const trades = [1, 2, 3, 4, 5].flatMap((d) => fadeDay(d, -100));
    const insight = fadeTiltInsight(trades)!;
    expect(insight.severity).toBe("negative");
    expect(insight.sentence).toContain(`first ${EARLY_TRADES} trades of a day win 100%`);
    expect(insight.sentence).toContain("just 0%");
    expect(insight.figures[0]?.amount).toBe(1500); // 15 early winners
    expect(insight.figures[1]?.amount).toBe(-500); // 5 late losers
  });

  it("gives the all-clear when late trades keep winning", () => {
    const trades = [1, 2, 3, 4, 5].flatMap((d) => fadeDay(d, 100));
    const insight = fadeTiltInsight(trades)!;
    expect(insight.severity).toBe("positive");
    expect(insight.sentence).toContain("No late-day fade");
  });
});

describe("burst tilt (overtrading vs own baseline)", () => {
  const normalDay = (day: number) => [
    mk({ pnl: 100, opened: at(day, 10, 0) }),
    mk({ pnl: 50, opened: at(day, 11, 0) }),
  ];
  const burstDay = (day: number, pnl: number) =>
    Array.from({ length: 8 }, (_, i) => mk({ pnl, opened: at(day, 9, 20 + 10 * i) }));

  it("suppresses below 5 active days", () => {
    const trades = [...[1, 2, 3].flatMap(normalDay), ...burstDay(4, -100)];
    expect(burstTiltInsight(trades)).toBeNull();
  });

  it("stays silent when no day clears 2× the median (and median+3)", () => {
    // Median 2/day → threshold 5; a 4-trade day is busy, not a burst.
    const four = (day: number) =>
      Array.from({ length: 4 }, (_, i) => mk({ pnl: -100, opened: at(day, 10, 15 * i) }));
    const trades = [...[1, 2, 3, 4, 5, 6].flatMap(normalDay), ...four(7)];
    expect(burstTiltInsight(trades)).toBeNull();
  });

  it("flags a losing burst day against the user's own baseline", () => {
    const trades = [...[1, 2, 3, 4, 5, 6].flatMap(normalDay), ...burstDay(7, -100)];
    const insight = burstTiltInsight(trades)!;
    expect(insight.severity).toBe("negative");
    expect(insight.sentence).toBe(
      "1 day ran hot — 5+ trades against your usual 2 a day — and the extra trades didn't pay."
    );
    expect(insight.figures[0]?.label).toContain("8 trades");
    expect(insight.figures[0]?.amount).toBe(-800);
    expect(insight.figures[1]?.amount).toBe(-100); // avg per burst trade
    expect(insight.figures[2]?.amount).toBe(75); // avg per normal trade
  });

  it("gives the all-clear when busy days out-earn normal days per trade", () => {
    const trades = [...[1, 2, 3, 4, 5, 6].flatMap(normalDay), ...burstDay(7, 200)];
    const insight = burstTiltInsight(trades)!;
    expect(insight.severity).toBe("positive");
    expect(insight.sentence).toContain("held up");
  });
});

describe("computeTiltInsights orchestration", () => {
  it("returns nothing for an empty or all-open journal", () => {
    expect(computeTiltInsights([])).toEqual([]);
    expect(computeTiltInsights([mk({ pnl: 0, status: "open" })])).toEqual([]);
  });

  it("trips all four detectors on a full tilt-spiral fixture", () => {
    const trades: TiltTradeLike[] = [];
    // Six normal days: win 9:20–9:35, win 10:15–10:30, loss 11:10–11:25 (40min pauses).
    for (const d of [1, 2, 3, 4, 5, 6]) {
      trades.push(
        mk({ pnl: 100, opened: at(d, 9, 20), closed: at(d, 9, 35) }),
        mk({ pnl: 100, opened: at(d, 10, 15), closed: at(d, 10, 30) }),
        mk({ pnl: -100, opened: at(d, 11, 10), closed: at(d, 11, 25) })
      );
    }
    // One burst day: a small loss, then 7 oversized losses re-entered 4min apart.
    trades.push(mk({ pnl: -100, qty: 50, opened: at(8, 9, 20), closed: at(8, 9, 30) }));
    for (let i = 0; i < 7; i++) {
      trades.push(
        mk({
          pnl: -400,
          qty: 200,
          opened: at(8, 9, 34 + i * 14),
          closed: at(8, 9, 44 + i * 14),
        })
      );
    }
    const ids = computeTiltInsights(trades).map((i) => i.id);
    expect(ids).toEqual(["tilt-sizing", "tilt-pace", "tilt-fade", "tilt-burst"]);
    for (const insight of computeTiltInsights(trades)) {
      expect(insight.severity).toBe("negative");
    }
  });

  it("stays calm on a disciplined journal (no negative findings)", () => {
    const trades: TiltTradeLike[] = [];
    // Ten steady days: mixed results, fixed size, unhurried 40min re-entries.
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      trades.push(
        mk({ pnl: 100, opened: at(d, 9, 20), closed: at(d, 9, 35) }),
        mk({ pnl: -80, opened: at(d, 10, 15), closed: at(d, 10, 30) }),
        mk({ pnl: 120, opened: at(d, 11, 10), closed: at(d, 11, 25) })
      );
    }
    const tilt = computeTiltInsights(trades);
    expect(tilt.length).toBeGreaterThan(0); // enough data for a read…
    expect(tilt.every((i) => i.severity === "positive")).toBe(true); // …and it's clean
  });
});
