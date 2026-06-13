import { describe, expect, it } from "vitest";
import type { TradeLike } from "@/lib/stats/stats";
import {
  buildDayInfractions,
  confidenceCalibration,
  disciplineScore,
  disciplineTrend,
  dayPenalty,
  hasPlan,
  planAdherence,
  planAdherenceSummary,
  MISTAKE_TAG_PENALTY,
  RULE_BREAK_PENALTY,
  TILT_TRIGGER_PENALTY,
  type DayInfractions,
  type PlannedTradeLike,
} from "./discipline";

const day = (date: string, over: Partial<DayInfractions> = {}): DayInfractions => ({
  date,
  trades: 0,
  ruleBreaks: 0,
  mistakeTags: 0,
  tiltTriggers: 0,
  netPnl: 0,
  ...over,
});

/* ──────────────────────────────────────────────────────────────────────── */
describe("disciplineScore formula", () => {
  it("a clean day scores exactly 100 regardless of trade count", () => {
    expect(disciplineScore(day("2026-06-01", { trades: 0 }))).toBe(100);
    expect(disciplineScore(day("2026-06-01", { trades: 12 }))).toBe(100);
  });

  it("penalty is the documented weighted sum", () => {
    expect(dayPenalty({ ruleBreaks: 2, mistakeTags: 1, tiltTriggers: 1 })).toBe(
      2 * RULE_BREAK_PENALTY + MISTAKE_TAG_PENALTY + TILT_TRIGGER_PENALTY
    );
  });

  it("normalises by trade count (+2 floor): same infractions hurt a thin day more", () => {
    // 1 rule break (penalty 12).  thin day: 1 trade → 12/(1+2)=4 → 96.
    const thin = disciplineScore(day("d", { trades: 1, ruleBreaks: 1 }));
    // busy day: 10 trades → 12/(10+2)=1 → 99.
    const busy = disciplineScore(day("d", { trades: 10, ruleBreaks: 1 }));
    expect(thin).toBe(96);
    expect(busy).toBe(99);
    expect(thin).toBeLessThan(busy);
  });

  it("a heavily-broken day floors at 0, never negative", () => {
    const carnage = disciplineScore(
      day("d", { trades: 1, ruleBreaks: 10, mistakeTags: 10, tiltTriggers: 10 })
    );
    expect(carnage).toBe(0);
  });

  it("a single mistake tag on a one-trade day costs the floored amount", () => {
    // 8 / (1+2) = 2.67 → 100 - 2.67 = 97.33 → round 97
    expect(disciplineScore(day("d", { trades: 1, mistakeTags: 1 }))).toBe(97);
  });
});

describe("disciplineTrend", () => {
  const mkDays = (scoresPenalty: { rb?: number }[]) =>
    scoresPenalty.map((p, i) =>
      day(`2026-06-${String(i + 1).padStart(2, "0")}`, { trades: 4, ruleBreaks: p.rb ?? 0 })
    );

  it("is empty below no rows and reports null fields", () => {
    const t = disciplineTrend([]);
    expect(t.days).toEqual([]);
    expect(t.current).toBeNull();
    expect(t.direction).toBeNull();
  });

  it("sorts ascending and reports the latest day as current", () => {
    const rows = [
      day("2026-06-03", { trades: 4, ruleBreaks: 2 }), // worst
      day("2026-06-01", { trades: 4 }), // clean 100
      day("2026-06-02", { trades: 4, ruleBreaks: 1 }),
    ];
    const t = disciplineTrend(rows);
    expect(t.days.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(t.days[0]!.score).toBe(100);
    expect(t.current).toBe(t.days[2]!.score);
  });

  it("flags an improving trend when recent days are cleaner", () => {
    // first 4 days dirty (rule breaks), last 4 clean.
    const rows = [
      ...mkDays([{ rb: 3 }, { rb: 3 }, { rb: 3 }, { rb: 3 }]),
      ...mkDays([{}, {}, {}, {}]),
    ];
    // mkDays reuses dates — rebuild with unique dates:
    const dirty = [0, 1, 2, 3].map((i) => day(`2026-06-0${i + 1}`, { trades: 4, ruleBreaks: 3 }));
    const clean = [4, 5, 6, 7].map((i) => day(`2026-06-0${i + 1}`, { trades: 4 }));
    const t = disciplineTrend([...dirty, ...clean]);
    expect(t.direction).toBe("improving");
    expect(t.delta!).toBeGreaterThan(0);
    void rows;
  });

  it("flags a declining trend when recent days are dirtier", () => {
    const clean = [0, 1, 2, 3].map((i) => day(`2026-06-0${i + 1}`, { trades: 4 }));
    const dirty = [4, 5, 6, 7].map((i) => day(`2026-06-0${i + 1}`, { trades: 4, ruleBreaks: 4 }));
    const t = disciplineTrend([...clean, ...dirty]);
    expect(t.direction).toBe("declining");
    expect(t.delta!).toBeLessThan(0);
  });

  it("reads steady when scores barely move", () => {
    const rows = [0, 1, 2, 3, 4, 5].map((i) => day(`2026-06-0${i + 1}`, { trades: 4 }));
    const t = disciplineTrend(rows);
    expect(t.direction).toBe("steady");
  });
});

/* ──────────────────────────────────────────────────────────────────────── */
const plannedTrade = (over: Partial<PlannedTradeLike>): PlannedTradeLike => ({
  id: "t1",
  symbol: "NIFTY",
  direction: "long",
  status: "closed",
  avg_entry: 100,
  avg_exit: 110,
  planned_entry: 100,
  planned_sl: 90,
  planned_target: 120,
  net_pnl: 100,
  opened_at: "2026-06-01T10:00:00.000Z",
  ...over,
});

describe("plan adherence — gating", () => {
  it("hasPlan requires all three planned levels", () => {
    expect(hasPlan(plannedTrade({}))).toBe(true);
    expect(hasPlan(plannedTrade({ planned_target: null }))).toBe(false);
    expect(hasPlan(plannedTrade({ planned_sl: null }))).toBe(false);
    expect(hasPlan(plannedTrade({ planned_entry: null }))).toBe(false);
  });

  it("returns null for trades without a plan", () => {
    expect(planAdherence(plannedTrade({ planned_target: null }))).toBeNull();
  });
});

describe("plan adherence — exit resolution (long)", () => {
  it("classifies a target hit", () => {
    expect(planAdherence(plannedTrade({ avg_exit: 121 }))!.exit).toBe("target");
    expect(planAdherence(plannedTrade({ avg_exit: 120 }))!.exit).toBe("target");
  });
  it("classifies a stop hit", () => {
    expect(planAdherence(plannedTrade({ avg_exit: 90 }))!.exit).toBe("stop");
    expect(planAdherence(plannedTrade({ avg_exit: 85 }))!.exit).toBe("stop");
  });
  it("classifies cutting a winner early (above entry, below target)", () => {
    expect(planAdherence(plannedTrade({ avg_exit: 110 }))!.exit).toBe("cut");
  });
  it("classifies giving back (below entry, above stop)", () => {
    expect(planAdherence(plannedTrade({ avg_exit: 95 }))!.exit).toBe("gaveBack");
  });
  it("leaves exit null while the trade is open", () => {
    expect(planAdherence(plannedTrade({ status: "open", avg_exit: null }))!.exit).toBeNull();
  });
});

describe("plan adherence — exit resolution (short)", () => {
  const short = (over: Partial<PlannedTradeLike>) =>
    plannedTrade({
      direction: "short",
      avg_entry: 100,
      planned_entry: 100,
      planned_sl: 110,
      planned_target: 80,
      ...over,
    });
  it("classifies a short target hit (price fell to/below target)", () => {
    expect(planAdherence(short({ avg_exit: 80 }))!.exit).toBe("target");
    expect(planAdherence(short({ avg_exit: 75 }))!.exit).toBe("target");
  });
  it("classifies a short stop hit (price rose to/above stop)", () => {
    expect(planAdherence(short({ avg_exit: 110 }))!.exit).toBe("stop");
  });
  it("classifies a short cut early (below entry, above target)", () => {
    expect(planAdherence(short({ avg_exit: 90 }))!.exit).toBe("cut");
  });
});

describe("plan adherence — entry slippage sign", () => {
  it("long: paying more than planned is adverse (negative)", () => {
    const r = planAdherence(plannedTrade({ avg_entry: 102, planned_entry: 100 }))!;
    expect(r.entrySlippage).toBe(-2);
    // risk = |100-90| = 10 → -2/10 = -0.2
    expect(r.entrySlippagePctOfRisk).toBeCloseTo(-0.2);
  });
  it("long: filling cheaper than planned is favourable (positive)", () => {
    const r = planAdherence(plannedTrade({ avg_entry: 98, planned_entry: 100 }))!;
    expect(r.entrySlippage).toBe(2);
  });
  it("short: selling higher than planned is favourable (positive)", () => {
    const r = planAdherence(
      plannedTrade({ direction: "short", avg_entry: 102, planned_entry: 100, planned_sl: 110 })
    )!;
    expect(r.entrySlippage).toBe(2);
  });
});

describe("planAdherenceSummary", () => {
  const closedPlanned = (n: number, exitPrice: number) =>
    Array.from({ length: n }, (_, i) =>
      plannedTrade({ id: `t${i}`, avg_exit: exitPrice, status: "closed" })
    );

  it("suppresses below MIN_SAMPLE planned closed trades", () => {
    expect(planAdherenceSummary(closedPlanned(4, 120))).toBeNull();
  });

  it("ignores trades without a plan and open trades", () => {
    const trades = [
      ...closedPlanned(5, 120),
      plannedTrade({ id: "noPlan", planned_target: null, avg_exit: 120 }),
      plannedTrade({ id: "open", status: "open", avg_exit: null }),
    ];
    const s = planAdherenceSummary(trades)!;
    expect(s.count).toBe(5); // only the 5 planned closed
    expect(s.targets).toBe(5);
    expect(s.targetRate).toBe(1);
  });

  it("tallies the exit mix and clean-entry rate", () => {
    const trades = [
      ...closedPlanned(3, 121), // target
      ...closedPlanned(2, 110).map((t, i) => ({ ...t, id: `cut${i}` })), // cut
      plannedTrade({ id: "stop", avg_exit: 88 }), // stop
      plannedTrade({ id: "slip", avg_exit: 121, avg_entry: 103 }), // target but adverse entry
    ];
    const s = planAdherenceSummary(trades)!;
    expect(s.count).toBe(7);
    expect(s.targets).toBe(4);
    expect(s.cutEarly).toBe(2);
    expect(s.stops).toBe(1);
    // 6 of 7 entered at planned price (clean), 1 slipped
    expect(s.cleanEntryRate).toBeCloseTo(6 / 7);
  });
});

/* ──────────────────────────────────────────────────────────────────────── */
let cseq = 0;
const confTrade = (confidence: number, pnl: number): TradeLike => ({
  id: `c${++cseq}`,
  net_pnl: pnl,
  gross_pnl: pnl,
  r_multiple: null,
  opened_at: "2026-06-01T10:00:00.000Z",
  closed_at: "2026-06-01T10:30:00.000Z",
  status: "closed",
  symbol: "NIFTY",
  segment: "OPT",
  direction: "long",
  playbook_id: null,
  confidence,
});

describe("confidence calibration", () => {
  it("has no signal below MIN_SAMPLE in every bin", () => {
    const trades = [confTrade(5, 100), confTrade(5, 100), confTrade(5, -50), confTrade(5, 100)];
    const c = confidenceCalibration(trades);
    expect(c.hasSignal).toBe(false);
    expect(c.scored).toHaveLength(0);
  });

  it("flags overconfidence: high confidence, sub-50% win rate", () => {
    // confidence 5, 5 trades, 2 wins / 3 losses → 40% win
    const trades = [
      confTrade(5, 100),
      confTrade(5, 100),
      confTrade(5, -50),
      confTrade(5, -50),
      confTrade(5, -50),
    ];
    const c = confidenceCalibration(trades);
    expect(c.hasSignal).toBe(true);
    expect(c.overconfident.map((b) => b.confidence)).toEqual([5]);
    expect(c.scored[0]!.flag).toBe("overconfident");
  });

  it("flags underconfidence: low confidence, strong win rate", () => {
    // confidence 1, 5 trades, 4 wins → 80% win
    const trades = [
      confTrade(1, 100),
      confTrade(1, 100),
      confTrade(1, 100),
      confTrade(1, 100),
      confTrade(1, -50),
    ];
    const c = confidenceCalibration(trades);
    expect(c.underconfident.map((b) => b.confidence)).toEqual([1]);
  });

  it("reads calibrated when high confidence wins and low loses", () => {
    const trades = [
      ...Array.from({ length: 5 }, () => confTrade(5, 100)), // 100% win at 5
      ...Array.from({ length: 5 }, (_, i) => confTrade(2, i < 1 ? 100 : -50)), // 20% at 2
    ];
    const c = confidenceCalibration(trades);
    expect(c.overconfident).toHaveLength(0);
    expect(c.underconfident).toHaveLength(0);
    expect(c.scored.every((b) => b.flag === "calibrated")).toBe(true);
  });

  it("keeps thin bins but marks them not-enough", () => {
    const trades = [
      ...Array.from({ length: 5 }, () => confTrade(4, 100)),
      confTrade(2, 100),
      confTrade(2, -50),
    ];
    const c = confidenceCalibration(trades);
    const thin = c.bins.find((b) => b.confidence === 2)!;
    expect(thin.enough).toBe(false);
    expect(thin.flag).toBeNull();
    expect(c.scored).toHaveLength(1);
  });
});

/* ──────────────────────────────────────────────────────────────────────── */
describe("buildDayInfractions", () => {
  const t = (
    over: Partial<{
      id: string;
      status: string;
      opened_at: string;
      closed_at: string | null;
      net_pnl: number;
      mistakeTagCount: number;
    }>
  ) => ({
    id: "t1",
    status: "closed",
    opened_at: "2026-06-01T10:00:00.000Z",
    closed_at: "2026-06-01T10:30:00.000Z",
    net_pnl: 100,
    mistakeTagCount: 0,
    ...over,
  });

  it("aggregates trades, tags, rule breaks and tilt triggers per open-day", () => {
    const rows = buildDayInfractions({
      trades: [
        t({ id: "a", opened_at: "2026-06-01T10:00:00Z", mistakeTagCount: 2 }),
        t({ id: "b", opened_at: "2026-06-01T11:00:00Z", mistakeTagCount: 1 }),
        t({ id: "c", opened_at: "2026-06-02T10:00:00Z" }),
      ],
      ruleBreaksByDay: new Map([["2026-06-01", 3]]),
      tiltTriggersByDay: new Map([["2026-06-01", 1]]),
    });
    const d1 = rows.find((r) => r.date === "2026-06-01")!;
    expect(d1.trades).toBe(2);
    expect(d1.mistakeTags).toBe(3);
    expect(d1.ruleBreaks).toBe(3);
    expect(d1.tiltTriggers).toBe(1);
    const d2 = rows.find((r) => r.date === "2026-06-02")!;
    expect(d2.trades).toBe(1);
    expect(d2.ruleBreaks).toBe(0);
  });

  it("surfaces a rule-break day even with no trades logged", () => {
    const rows = buildDayInfractions({
      trades: [],
      ruleBreaksByDay: new Map([["2026-06-05", 2]]),
      tiltTriggersByDay: new Map(),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-06-05");
    expect(rows[0]!.trades).toBe(0);
    expect(disciplineScore(rows[0]!)).toBe(88); // 24/(0+2)=12 → 88
  });

  it("attributes realised P&L to the close day", () => {
    const rows = buildDayInfractions({
      trades: [
        t({ opened_at: "2026-06-01T15:00:00Z", closed_at: "2026-06-02T09:30:00Z", net_pnl: 500 }),
      ],
      ruleBreaksByDay: new Map(),
      tiltTriggersByDay: new Map(),
    });
    expect(rows.find((r) => r.date === "2026-06-02")!.netPnl).toBe(500);
  });
});
