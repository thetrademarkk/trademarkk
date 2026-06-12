/**
 * Insights engine v1 — deterministic, rule-based findings computed client-side
 * from the user's own trades. No AI, no server: the same pure functions run in
 * hosted, BYOD and local modes. Every finding is suppressed until it has at
 * least MIN_SAMPLE trades behind it, so we never dress noise up as signal.
 */
import {
  avgWinLoss,
  closedOnly,
  expectancy,
  groupBy,
  netPnl,
  streaks,
  winRate,
  type GroupStat,
  type TradeLike,
} from "@/lib/stats/stats";

/** Minimum trades per bucket before a pattern is worth showing. */
export const MIN_SAMPLE = 5;
/** Minimum broken checks before a rule-break habit is called out. */
export const MIN_RULE_BREAKS = 3;
/** A trade opened within this window after a losing close counts as "after a loss". */
export const REVENGE_WINDOW_MS = 15 * 60 * 1000;

export type InsightSeverity = "positive" | "negative" | "neutral";

export type InsightId =
  | "rule-break"
  | "payoff"
  | "day-of-week"
  | "hour-of-day"
  | "revenge"
  | "long-short"
  | "instruments"
  | "streaks"
  | "fee-drag";

export interface InsightFigure {
  label: string;
  /** ₹ amount — rendered with PnlText (paise precision, profit/loss colour). */
  amount?: number;
  /** Pre-formatted non-currency value (counts, ratios, streak lengths). */
  text?: string;
}

export interface Insight {
  id: InsightId;
  severity: InsightSeverity;
  title: string;
  /** One plain-English sentence — the finding itself. */
  sentence: string;
  /** Supporting numbers shown under the sentence. */
  figures: InsightFigure[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const hourLabel = (h: number) => {
  const f = (x: number) => `${x % 12 === 0 ? 12 : x % 12}${x >= 12 ? "pm" : "am"}`;
  return `${f(h)}–${f((h + 1) % 24)}`;
};

const bucketLabel = (name: string, g: GroupStat) =>
  `${name} · ${g.trades} trades · ${pct(g.winRate)} win`;

/** True when the entry timestamp carries a real time (not a date-only midnight). */
export function hasEntryTime(openedAt: string): boolean {
  const d = new Date(openedAt);
  return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
}

/** Buckets with enough trades to mean something. */
const qualified = (stats: GroupStat[]) => stats.filter((g) => g.trades >= MIN_SAMPLE);

/** Best/worst bucket pair by net P&L — null unless two qualifying buckets exist. */
function bestWorst(stats: GroupStat[]): { best: GroupStat; worst: GroupStat } | null {
  const q = qualified(stats);
  if (q.length < 2) return null;
  const sorted = [...q].sort((a, b) => b.netPnl - a.netPnl);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (!best || !worst) return null;
  return { best, worst };
}

export function payoffInsight(closed: TradeLike[]): Insight | null {
  const wins = closed.filter((t) => t.net_pnl > 0);
  const losses = closed.filter((t) => t.net_pnl < 0);
  if (wins.length < MIN_SAMPLE || losses.length < MIN_SAMPLE) return null;
  const { avgWin, avgLoss } = avgWinLoss(closed);
  const ratio = Math.abs(avgLoss) > 0 ? avgWin / Math.abs(avgLoss) : 0;
  const exp = expectancy(closed);
  const sentence =
    ratio >= 1
      ? `Your average winner is ${ratio.toFixed(1)}× the size of your average loser, and you win ${pct(winRate(closed))} of the time.`
      : `Your average loser is ${(1 / ratio).toFixed(1)}× the size of your average winner — losers are outweighing winners.`;
  return {
    id: "payoff",
    severity: exp > 0 ? "positive" : "negative",
    title: "Winners vs losers",
    sentence,
    figures: [
      { label: `Avg winner · ${wins.length} trades`, amount: avgWin },
      { label: `Avg loser · ${losses.length} trades`, amount: avgLoss },
      { label: "Expectancy per trade", amount: exp },
    ],
  };
}

export function dayOfWeekInsight(closed: TradeLike[]): Insight | null {
  const stats = groupBy(closed, (t) => WEEKDAYS[new Date(t.opened_at).getDay()] ?? "?");
  const pair = bestWorst(stats);
  if (!pair) return null;
  const { best, worst } = pair;
  return {
    id: "day-of-week",
    severity: worst.netPnl < 0 ? "negative" : "positive",
    title: "Day of the week",
    sentence: `${best.key}s are your most profitable day (${pct(best.winRate)} win rate); ${worst.key}s are your weakest (${pct(worst.winRate)}).`,
    figures: [
      { label: bucketLabel(`${best.key}s`, best), amount: best.netPnl },
      { label: bucketLabel(`${worst.key}s`, worst), amount: worst.netPnl },
    ],
  };
}

export function hourOfDayInsight(closed: TradeLike[]): Insight | null {
  const timed = closed.filter((t) => hasEntryTime(t.opened_at));
  const stats = groupBy(timed, (t) => String(new Date(t.opened_at).getHours()));
  const pair = bestWorst(stats);
  if (!pair) return null;
  const { best, worst } = pair;
  const bestL = hourLabel(Number(best.key));
  const worstL = hourLabel(Number(worst.key));
  return {
    id: "hour-of-day",
    severity: worst.netPnl < 0 ? "negative" : "positive",
    title: "Entry hour",
    sentence: `Entries between ${bestL} are your most profitable; entries between ${worstL} are your weakest.`,
    figures: [
      { label: bucketLabel(bestL, best), amount: best.netPnl },
      { label: bucketLabel(worstL, worst), amount: worst.netPnl },
    ],
  };
}

export function longShortInsight(closed: TradeLike[]): Insight | null {
  const stats = groupBy(closed, (t) => t.direction);
  const longs = stats.find((g) => g.key === "long");
  const shorts = stats.find((g) => g.key === "short");
  if (!longs || !shorts || longs.trades < MIN_SAMPLE || shorts.trades < MIN_SAMPLE) return null;
  return {
    id: "long-short",
    severity: Math.min(longs.netPnl, shorts.netPnl) < 0 ? "negative" : "positive",
    title: "Long vs short",
    sentence: `You win ${pct(longs.winRate)} of your longs and ${pct(shorts.winRate)} of your shorts.`,
    figures: [
      { label: bucketLabel("Longs", longs), amount: longs.netPnl },
      { label: bucketLabel("Shorts", shorts), amount: shorts.netPnl },
    ],
  };
}

export function instrumentsInsight(closed: TradeLike[]): Insight | null {
  const q = qualified(groupBy(closed, (t) => t.symbol));
  if (q.length === 0) return null;
  // Top 5 by trade count, displayed best → worst by net P&L.
  const top = [...q].sort((a, b) => b.trades - a.trades).slice(0, 5);
  top.sort((a, b) => b.netPnl - a.netPnl);
  const best = top[0];
  const worst = top[top.length - 1];
  if (!best || !worst) return null;
  const sentence =
    top.length === 1
      ? `${best.key} is your bread-and-butter instrument — ${best.trades} trades at a ${pct(best.winRate)} win rate.`
      : worst.netPnl < 0
        ? `${best.key} makes you the most; ${worst.key} costs you the most.`
        : `${best.key} is your strongest instrument; ${worst.key} is your weakest of the regulars.`;
  return {
    id: "instruments",
    severity: "neutral",
    title: "Your instruments",
    sentence,
    figures: top.map((g) => ({ label: bucketLabel(g.key, g), amount: g.netPnl })),
  };
}

export function streaksInsight(closed: TradeLike[]): Insight | null {
  if (closed.length < MIN_SAMPLE) return null;
  const s = streaks(closed);
  if (s.longestWin === 0 && s.longestLoss === 0) return null;
  const current =
    s.current === 0
      ? "flat"
      : `${Math.abs(s.current)} ${s.current > 0 ? "win" : "loss"}${Math.abs(s.current) > 1 ? "s" : ""}`;
  return {
    id: "streaks",
    severity: "neutral",
    title: "Streaks",
    sentence: `Your longest winning streak is ${s.longestWin} trades; your longest losing streak is ${s.longestLoss}.`,
    figures: [{ label: "Current streak", text: current }],
  };
}

/** Splits closed trades into "opened <15min after a losing close" vs the rest. */
export function splitRevenge(closed: TradeLike[]): { revenge: TradeLike[]; rest: TradeLike[] } {
  const lossCloses = closed
    .filter((t) => t.net_pnl < 0 && t.closed_at)
    .map((t) => ({ id: t.id, ts: new Date(t.closed_at!).getTime() }))
    .sort((a, b) => a.ts - b.ts);
  const revenge: TradeLike[] = [];
  const rest: TradeLike[] = [];
  for (const t of closed) {
    const open = new Date(t.opened_at).getTime();
    // Binary search: first loss close >= open − window.
    let lo = 0;
    let hi = lossCloses.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lossCloses[mid]!.ts < open - REVENGE_WINDOW_MS) lo = mid + 1;
      else hi = mid;
    }
    let isRevenge = false;
    for (let i = lo; i < lossCloses.length && lossCloses[i]!.ts <= open; i++) {
      if (lossCloses[i]!.id !== t.id) {
        isRevenge = true;
        break;
      }
    }
    (isRevenge ? revenge : rest).push(t);
  }
  return { revenge, rest };
}

export function revengeInsight(closed: TradeLike[]): Insight | null {
  const { revenge, rest } = splitRevenge(closed);
  if (revenge.length < MIN_SAMPLE || rest.length < MIN_SAMPLE) return null;
  const revWin = winRate(revenge);
  const restWin = winRate(rest);
  const worse = revWin < restWin;
  const sentence = worse
    ? `Trades opened within 15 minutes of a loss win just ${pct(revWin)} of the time, vs ${pct(restWin)} for the rest of your trades.`
    : `No revenge-trading pattern: trades opened within 15 minutes of a loss win ${pct(revWin)}, in line with the rest (${pct(restWin)}).`;
  return {
    id: "revenge",
    severity: worse ? "negative" : "positive",
    title: "After a loss",
    sentence,
    figures: [
      { label: `Within 15min of a loss · ${revenge.length} trades`, amount: expectancy(revenge) },
      { label: `All other trades · ${rest.length} trades`, amount: expectancy(rest) },
    ],
  };
}

export function feeDragInsight(closed: (TradeLike & { charges: number })[]): Insight | null {
  if (closed.length < MIN_SAMPLE) return null;
  const gross = closed.reduce((s, t) => s + t.gross_pnl, 0);
  const charges = closed.reduce((s, t) => s + t.charges, 0);
  if (gross <= 0 || charges <= 0) return null;
  const ratio = charges / gross;
  return {
    id: "fee-drag",
    severity: ratio >= 0.25 ? "negative" : "neutral",
    title: "Fee drag",
    sentence: `Brokerage and charges ate ${pct(ratio)} of your gross profits.`,
    figures: [
      { label: "Gross P&L", amount: gross },
      { label: "Charges", amount: -charges },
      { label: "Net P&L", amount: netPnl(closed) },
    ],
  };
}

export interface RuleBreakStat {
  text: string;
  broken: number;
  /** Sum of negative day P&L on days this rule was broken (≤ 0). */
  brokenDayCost: number;
}

/** The costliest broken rule — reuses the adherence data the rules feature already computes. */
export function ruleBreakInsight(rules: RuleBreakStat[]): Insight | null {
  const worst = [...rules]
    .filter((r) => r.broken >= MIN_RULE_BREAKS && r.brokenDayCost < 0)
    .sort((a, b) => a.brokenDayCost - b.brokenDayCost)[0];
  if (!worst) return null;
  return {
    id: "rule-break",
    severity: "negative",
    title: "Costliest rule break",
    sentence: `You broke “${worst.text}” ${worst.broken} times — the days you broke it ended in the red.`,
    figures: [{ label: "Loss on broken-rule days", amount: worst.brokenDayCost }],
  };
}

/**
 * All trade-derived insights, in display order. Closed trades only; each
 * section independently suppresses itself below MIN_SAMPLE.
 */
export function computeInsights(trades: (TradeLike & { charges: number })[]): Insight[] {
  const closed = closedOnly(trades);
  return [
    payoffInsight(closed),
    dayOfWeekInsight(closed),
    hourOfDayInsight(closed),
    revengeInsight(closed),
    longShortInsight(closed),
    instrumentsInsight(closed),
    streaksInsight(closed),
    feeDragInsight(closed),
  ].filter((i): i is Insight => i !== null);
}
