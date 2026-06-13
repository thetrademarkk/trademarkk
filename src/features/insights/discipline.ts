/**
 * Psychology / discipline scoring v2 — three deterministic, client-side reads
 * on the trader's own behaviour. No AI, no market data: the same pure functions
 * run in hosted, BYOD and local modes.
 *
 *   1. Per-day discipline score (0–100) — a transparent, documented penalty
 *      model over rule breaks, tilt triggers and emotion/mistake tags,
 *      normalised by the day's trade count, plus a 7-day trend direction.
 *   2. Plan adherence — for trades with planned entry/SL/target: entry slippage
 *      and how each exit resolved (target hit / cut early / stopped out).
 *   3. Confidence calibration — win% and expectancy binned by the 1–5 rating,
 *      flagging over- and under-confidence.
 *
 * Honesty gate: every bin/comparison stays silent until it has at least
 * MIN_SAMPLE observations behind it — we never dress noise up as signal.
 */
import { expectancyByConfidence, type ConfidenceBin, type TradeLike } from "@/lib/stats/stats";
import { MIN_SAMPLE } from "./compute";

/* ──────────────────────────────────────────────────────────────────────────
 * 1. Per-day discipline score
 *
 * FORMULA (documented & unit-tested)
 * ----------------------------------
 * A day with no infractions scores 100. Each infraction adds penalty points,
 * weighted by how serious it is:
 *
 *   • broken rule check    → RULE_BREAK_PENALTY   (12) each
 *   • emotion/mistake tag  → MISTAKE_TAG_PENALTY  (8)  each
 *   • tilt trigger flagged → TILT_TRIGGER_PENALTY (15) each
 *
 * Raw penalty is the weighted sum of the day's infractions. To stay fair to
 * busy days (10 trades naturally carry more tags than 2), the penalty is
 * NORMALISED per trade: we divide by the day's trade count, but cushion small
 * days with a +NORMALISER_FLOOR (2) in the denominator so a single slip on a
 * one-trade day doesn't crater the score. The normalised penalty is then
 * subtracted from 100 and clamped to [0, 100]:
 *
 *   penalty       = 12·rb + 8·mt + 15·tt
 *   normalised    = penalty / (trades + 2)
 *   score         = clamp(100 − normalised, 0, 100)
 *
 * Consequences (asserted in tests):
 *   • A clean day (0 infractions) always scores exactly 100.
 *   • A heavily-broken day floors at 0, never negative.
 *   • The same infractions hurt a low-volume day more than a high-volume day.
 * ──────────────────────────────────────────────────────────────────────── */

export const RULE_BREAK_PENALTY = 12;
export const MISTAKE_TAG_PENALTY = 8;
export const TILT_TRIGGER_PENALTY = 15;
/** Denominator cushion so a single slip on a thin day isn't catastrophic. */
export const NORMALISER_FLOOR = 2;
/** Days with at least this many scored days form a trend worth charting. */
export const MIN_TREND_DAYS = 5;
/** Direction is measured over this rolling window. */
export const TREND_WINDOW_DAYS = 7;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface DayInfractions {
  /** Calendar day key, YYYY-MM-DD (local). */
  date: string;
  /** Trades opened that day (any status). */
  trades: number;
  /** Broken rule checks recorded for that day. */
  ruleBreaks: number;
  /** Emotion + mistake tags on that day's trades. */
  mistakeTags: number;
  /** Tilt triggers detected for that day (e.g. revenge-sized re-entry). */
  tiltTriggers: number;
  /** Net realised P&L of trades closed that day — context, not scored. */
  netPnl: number;
}

/** Raw weighted penalty for a day, before normalisation. */
export function dayPenalty(
  d: Pick<DayInfractions, "ruleBreaks" | "mistakeTags" | "tiltTriggers">
): number {
  return (
    RULE_BREAK_PENALTY * d.ruleBreaks +
    MISTAKE_TAG_PENALTY * d.mistakeTags +
    TILT_TRIGGER_PENALTY * d.tiltTriggers
  );
}

/** The 0–100 discipline score for a single day. Clean day ⇒ 100. */
export function disciplineScore(d: DayInfractions): number {
  const penalty = dayPenalty(d);
  if (penalty === 0) return 100;
  const normalised = penalty / (Math.max(0, d.trades) + NORMALISER_FLOOR);
  return Math.round(clamp(100 - normalised, 0, 100));
}

export interface ScoredDay extends DayInfractions {
  score: number;
}

export type TrendDirection = "improving" | "declining" | "steady";

export interface DisciplineTrend {
  /** Scored days, oldest → newest. Empty when below MIN_TREND_DAYS. */
  days: ScoredDay[];
  /** Most recent day's score, or null when there are no scored days. */
  current: number | null;
  /** Mean score across all scored days. */
  average: number | null;
  /** Rolling-window direction; null until two windows exist. */
  direction: TrendDirection | null;
  /** Recent-window mean minus prior-window mean (score points). */
  delta: number | null;
}

/** A point's score change deemed material; smaller swings read as "steady". */
export const TREND_STEADY_BAND = 2;

/**
 * Builds the daily discipline trend from per-day infraction rows. Rows are
 * sorted by date ascending; the direction compares the most recent
 * TREND_WINDOW_DAYS scores against the window before them.
 */
export function disciplineTrend(rows: DayInfractions[]): DisciplineTrend {
  const days: ScoredDay[] = [...rows]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((d) => ({ ...d, score: disciplineScore(d) }));

  if (days.length === 0) {
    return { days: [], current: null, average: null, direction: null, delta: null };
  }
  const scores = days.map((d) => d.score);
  const average = Math.round(scores.reduce((s, x) => s + x, 0) / scores.length);
  const current = days[days.length - 1]!.score;

  let direction: TrendDirection | null = null;
  let delta: number | null = null;
  if (days.length >= 2) {
    const w = Math.min(TREND_WINDOW_DAYS, Math.floor(days.length / 2));
    const recent = scores.slice(-w);
    const prior = scores.slice(-2 * w, -w);
    if (prior.length > 0) {
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      delta = Math.round(mean(recent) - mean(prior));
      direction =
        delta > TREND_STEADY_BAND
          ? "improving"
          : delta < -TREND_STEADY_BAND
            ? "declining"
            : "steady";
    }
  }
  return { days, current, average, direction, delta };
}

/* ──────────────────────────────────────────────────────────────────────────
 * 2. Plan adherence (entry / exit quality)
 *
 * Only trades that carry planned_entry, planned_sl AND planned_target are
 * scored — a plan you can grade against. Everything is direction-aware:
 *   • Entry slippage: how far avg_entry is from planned_entry, signed so that
 *     a worse-than-planned fill (paying up on a long, selling lower on a short)
 *     is NEGATIVE. Expressed in both price points and as a % of the planned
 *     risk (|planned_entry − planned_sl|) so it's comparable across symbols.
 *   • Exit resolution: where avg_exit landed relative to the plan —
 *       target  → reached the planned target (or better)
 *       stop    → exited at/through the planned stop
 *       cut     → closed for a gain short of target ("cut early")
 *       gaveBack→ closed for a loss but better than the stop ("loosened stop")
 * ──────────────────────────────────────────────────────────────────────── */

export interface PlannedTradeLike {
  id: string;
  symbol: string;
  direction: "long" | "short" | string;
  status: string;
  avg_entry: number;
  avg_exit: number | null;
  planned_entry: number | null;
  planned_sl: number | null;
  planned_target: number | null;
  net_pnl: number;
  opened_at: string;
}

export type ExitResolution = "target" | "stop" | "cut" | "gaveBack";

export interface PlanAdherence {
  id: string;
  symbol: string;
  direction: "long" | "short";
  /** avg_entry − planned_entry, signed so adverse slippage is negative. */
  entrySlippage: number;
  /** Slippage as a fraction of planned risk; null when risk is undefined. */
  entrySlippagePctOfRisk: number | null;
  /** How the exit resolved vs the plan (null while the trade is open). */
  exit: ExitResolution | null;
  netPnl: number;
}

const isLong = (d: string) => d !== "short";

/** True only when all three planned levels are present and finite. */
export function hasPlan(t: PlannedTradeLike): boolean {
  return (
    t.planned_entry != null &&
    t.planned_sl != null &&
    t.planned_target != null &&
    Number.isFinite(t.planned_entry) &&
    Number.isFinite(t.planned_sl) &&
    Number.isFinite(t.planned_target)
  );
}

/** Per-trade entry/exit quality for one planned trade. Null without a plan. */
export function planAdherence(t: PlannedTradeLike): PlanAdherence | null {
  if (!hasPlan(t)) return null;
  const long = isLong(t.direction);
  const pEntry = t.planned_entry!;
  const pSl = t.planned_sl!;
  const pTarget = t.planned_target!;

  // Adverse entry = worse price than planned. Long: paying more is bad (−);
  // short: selling lower is bad (−).
  const rawEntry = t.avg_entry - pEntry;
  const entrySlippage = long ? -rawEntry : rawEntry;
  const risk = Math.abs(pEntry - pSl);
  const entrySlippagePctOfRisk = risk > 0 ? entrySlippage / risk : null;

  let exit: ExitResolution | null = null;
  if (t.status === "closed" && t.avg_exit != null && Number.isFinite(t.avg_exit)) {
    const x = t.avg_exit;
    if (long) {
      if (x >= pTarget) exit = "target";
      else if (x <= pSl) exit = "stop";
      else if (x >= pEntry) exit = "cut";
      else exit = "gaveBack";
    } else {
      if (x <= pTarget) exit = "target";
      else if (x >= pSl) exit = "stop";
      else if (x <= pEntry) exit = "cut";
      else exit = "gaveBack";
    }
  }

  return {
    id: t.id,
    symbol: t.symbol,
    direction: long ? "long" : "short",
    entrySlippage,
    entrySlippagePctOfRisk,
    exit,
    netPnl: t.net_pnl,
  };
}

export interface PlanAdherenceSummary {
  /** Planned trades scored (closed, with all three levels). */
  count: number;
  /** Mean entry slippage as a % of planned risk, over trades where risk>0. */
  avgEntrySlippagePctOfRisk: number | null;
  /** Share of trades that entered at or better than the planned price. */
  cleanEntryRate: number;
  /** Exit-resolution tallies. */
  targets: number;
  stops: number;
  cutEarly: number;
  gaveBack: number;
  /** Share of decided exits that reached target. */
  targetRate: number;
  /** Per-trade rows, newest first. */
  trades: PlanAdherence[];
}

/**
 * Period summary across all planned, CLOSED trades. Returns null until at
 * least MIN_SAMPLE planned trades exist — an honesty gate, same as the rest.
 */
export function planAdherenceSummary(trades: PlannedTradeLike[]): PlanAdherenceSummary | null {
  const rows = trades
    .filter((t) => t.status === "closed")
    .map(planAdherence)
    .filter((r): r is PlanAdherence => r !== null && r.exit !== null);
  if (rows.length < MIN_SAMPLE) return null;

  const withRisk = rows.filter((r) => r.entrySlippagePctOfRisk != null);
  const avgEntrySlippagePctOfRisk =
    withRisk.length > 0
      ? withRisk.reduce((s, r) => s + (r.entrySlippagePctOfRisk ?? 0), 0) / withRisk.length
      : null;
  const cleanEntryRate = rows.filter((r) => r.entrySlippage >= 0).length / rows.length;

  const targets = rows.filter((r) => r.exit === "target").length;
  const stops = rows.filter((r) => r.exit === "stop").length;
  const cutEarly = rows.filter((r) => r.exit === "cut").length;
  const gaveBack = rows.filter((r) => r.exit === "gaveBack").length;

  return {
    count: rows.length,
    avgEntrySlippagePctOfRisk,
    cleanEntryRate,
    targets,
    stops,
    cutEarly,
    gaveBack,
    targetRate: targets / rows.length,
    trades: [...rows].sort((a, b) => (a.id < b.id ? 1 : -1)),
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * 3. Confidence calibration
 *
 * Wraps expectancyByConfidence (the same binning the stats pack uses) and
 * derives calibration flags. Each bin needs MIN_SAMPLE trades to be judged.
 *   • overconfident: confidence ≥ HIGH_CONF but win rate < 50%
 *   • underconfident: confidence ≤ LOW_CONF but win rate ≥ STRONG_WIN
 * ──────────────────────────────────────────────────────────────────────── */

export const HIGH_CONF = 4;
export const LOW_CONF = 2;
export const STRONG_WIN = 0.6;

export type CalibrationFlag = "overconfident" | "underconfident" | "calibrated";

export interface CalibrationBin extends ConfidenceBin {
  flag: CalibrationFlag | null;
}

export interface ConfidenceCalibration {
  /** Every bin (sorted 1→5); thin bins keep enough:false. */
  bins: CalibrationBin[];
  /** Bins that cleared MIN_SAMPLE. */
  scored: CalibrationBin[];
  overconfident: CalibrationBin[];
  underconfident: CalibrationBin[];
  /** True once any bin has enough data to judge. */
  hasSignal: boolean;
}

function calibrationFlag(b: ConfidenceBin): CalibrationFlag | null {
  if (!b.enough) return null;
  if (b.confidence >= HIGH_CONF && b.winRate < 0.5) return "overconfident";
  if (b.confidence <= LOW_CONF && b.winRate >= STRONG_WIN) return "underconfident";
  return "calibrated";
}

export function confidenceCalibration(trades: TradeLike[]): ConfidenceCalibration {
  const bins: CalibrationBin[] = expectancyByConfidence(trades).map((b) => ({
    ...b,
    flag: calibrationFlag(b),
  }));
  const scored = bins.filter((b) => b.enough);
  return {
    bins,
    scored,
    overconfident: scored.filter((b) => b.flag === "overconfident"),
    underconfident: scored.filter((b) => b.flag === "underconfident"),
    hasSignal: scored.length > 0,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Assembly helpers — turn the app's raw rows into per-day infraction inputs.
 * ──────────────────────────────────────────────────────────────────────── */

/** Minimal trade shape the day-builder needs. */
export interface DisciplineTradeLike {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  net_pnl: number;
  /** Count of emotion + mistake tags on this trade. */
  mistakeTagCount: number;
}

export interface DisciplineInputs {
  trades: DisciplineTradeLike[];
  /** Day key → number of broken rule checks that day. */
  ruleBreaksByDay: Map<string, number>;
  /** Day key → number of tilt triggers that day. */
  tiltTriggersByDay: Map<string, number>;
}

const dayKey = (iso: string) => iso.slice(0, 10);

/**
 * Folds trades + rule-break counts + tilt-trigger counts into one
 * DayInfractions row per calendar day a trade was opened. Days are keyed by
 * the local opened_at date (matching how rule_checks store their dates).
 */
export function buildDayInfractions({
  trades,
  ruleBreaksByDay,
  tiltTriggersByDay,
}: DisciplineInputs): DayInfractions[] {
  const byDay = new Map<string, DayInfractions>();
  const ensure = (date: string): DayInfractions => {
    let row = byDay.get(date);
    if (!row) {
      row = {
        date,
        trades: 0,
        ruleBreaks: ruleBreaksByDay.get(date) ?? 0,
        mistakeTags: 0,
        tiltTriggers: tiltTriggersByDay.get(date) ?? 0,
        netPnl: 0,
      };
      byDay.set(date, row);
    }
    return row;
  };

  for (const t of trades) {
    const row = ensure(dayKey(t.opened_at));
    row.trades += 1;
    row.mistakeTags += t.mistakeTagCount;
    if (t.status === "closed" && t.closed_at) {
      // Realised P&L is attributed to the close day for context.
      const closeRow = ensure(dayKey(t.closed_at));
      closeRow.netPnl += t.net_pnl;
    }
  }

  // Rule-break / tilt days with no trade still matter (you broke a rule with no
  // logged trade) — surface them too.
  for (const [date, n] of ruleBreaksByDay) if (n > 0) ensure(date);
  for (const [date, n] of tiltTriggersByDay) if (n > 0) ensure(date);

  return [...byDay.values()];
}
