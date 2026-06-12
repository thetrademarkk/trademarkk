/**
 * Tilt analytics — detectors for emotional-spiral patterns in the user's own
 * trades: revenge sizing after losses, rushed re-entries, a fading edge late
 * in the session, and overtrading bursts vs the user's own baseline. Pure
 * client-side functions (hosted, BYOD and local modes alike), and every
 * detector stays silent until both sides of its comparison have at least
 * MIN_SAMPLE trades — an accusation needs evidence.
 */
import { closedOnly, expectancy, netPnl, winRate, type TradeLike } from "@/lib/stats/stats";
import { formatINR, toDateKey } from "@/lib/utils";
import { hasEntryTime, MIN_SAMPLE, splitRevenge, type Insight } from "./compute";

/** Post-loss position ≥ this multiple of the usual size = revenge sizing. */
export const SIZE_SPIKE_RATIO = 1.5;
/** Post-loss re-entry pause ≤ this fraction of the post-win pause = rushing. */
export const PACE_SPIKE_RATIO = 0.5;
/** Late-day win rate this many points below the early win rate = fade. */
export const FADE_GAP = 0.15;
/** A day's first N trades count as "early"; everything after is "late". */
export const EARLY_TRADES = 3;
/** Minimum active trading days before a trades-per-day baseline exists. */
export const BURST_MIN_DAYS = 5;

/** Tilt detectors also need position size, which TradeLike doesn't carry. */
export type TiltTradeLike = TradeLike & { qty: number; avg_entry: number };

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const notional = (t: TiltTradeLike) => t.qty * t.avg_entry;
const rupees = (x: number) => formatINR(x, { decimals: false });
const localDay = (iso: string) => toDateKey(new Date(iso));

/** "4 min" under 90 minutes, "1.5 hr" beyond. */
export function formatGap(ms: number): string {
  const min = ms / 60000;
  if (min < 90) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(1)} hr`;
}

/**
 * Revenge sizing — typical (median) position value of trades opened within
 * 15 minutes of a losing close vs everything else.
 */
export function sizingTiltInsight(closed: TiltTradeLike[]): Insight | null {
  const { revenge, rest } = splitRevenge(closed);
  const sized = (ts: TiltTradeLike[]) => ts.filter((t) => notional(t) > 0);
  const afterLoss = sized(revenge);
  const baseline = sized(rest);
  if (afterLoss.length < MIN_SAMPLE || baseline.length < MIN_SAMPLE) return null;
  const lossSize = median(afterLoss.map(notional));
  const baseSize = median(baseline.map(notional));
  if (baseSize <= 0) return null;
  const ratio = lossSize / baseSize;
  const tilted = ratio >= SIZE_SPIKE_RATIO;
  return {
    id: "tilt-sizing",
    severity: tilted ? "negative" : "positive",
    title: "Sizing after a loss",
    sentence: tilted
      ? `Within 15 minutes of a loss your typical position is ${ratio.toFixed(1)}× your usual size — that's revenge sizing.`
      : `No revenge sizing: positions opened right after a loss stay around your usual size.`,
    figures: [
      { label: `Typical size after a loss · ${afterLoss.length} trades`, text: rupees(lossSize) },
      { label: `Typical size otherwise · ${baseline.length} trades`, text: rupees(baseSize) },
      { label: "Net P&L right after losses", amount: netPnl(afterLoss) },
    ],
  };
}

/**
 * Rushed re-entries — median pause between a trade's close and the next entry
 * on the same day, split by whether the closed trade won or lost.
 */
export function paceTiltInsight(closed: TradeLike[]): Insight | null {
  const timed = closed
    .filter((t) => t.closed_at && hasEntryTime(t.opened_at))
    .sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime());
  const afterLoss: number[] = [];
  const afterWin: number[] = [];
  for (let i = 1; i < timed.length; i++) {
    const prev = timed[i - 1]!;
    const cur = timed[i]!;
    if (localDay(prev.closed_at!) !== localDay(cur.opened_at)) continue;
    const gap = new Date(cur.opened_at).getTime() - new Date(prev.closed_at!).getTime();
    if (gap < 0) continue; // overlapping positions — not a re-entry
    if (prev.net_pnl < 0) afterLoss.push(gap);
    else if (prev.net_pnl > 0) afterWin.push(gap);
  }
  if (afterLoss.length < MIN_SAMPLE || afterWin.length < MIN_SAMPLE) return null;
  const lossGap = median(afterLoss);
  const winGap = median(afterWin);
  const tilted = lossGap <= winGap * PACE_SPIKE_RATIO;
  return {
    id: "tilt-pace",
    severity: tilted ? "negative" : "positive",
    title: "Re-entry speed",
    sentence: tilted
      ? `After a loss you're back in within ${formatGap(lossGap)}, but after a win you wait ${formatGap(winGap)} — losses are rushing you back into the market.`
      : `No rushed re-entries: you typically wait ${formatGap(lossGap)} after a loss before the next trade, much like after a win (${formatGap(winGap)}).`,
    figures: [
      { label: `Pause after a loss · ${afterLoss.length} re-entries`, text: formatGap(lossGap) },
      { label: `Pause after a win · ${afterWin.length} re-entries`, text: formatGap(winGap) },
    ],
  };
}

/**
 * Late-day fade — win rate of each day's first EARLY_TRADES entries vs every
 * entry after them. Sequence-based on purpose: it tracks fatigue and
 * frustration through the session, not the clock (entry hour has its own
 * insight).
 */
export function fadeTiltInsight(closed: TradeLike[]): Insight | null {
  const byDay = new Map<string, TradeLike[]>();
  for (const t of closed) {
    if (!hasEntryTime(t.opened_at)) continue; // date-only imports can't be sequenced
    const day = localDay(t.opened_at);
    const arr = byDay.get(day);
    if (arr) arr.push(t);
    else byDay.set(day, [t]);
  }
  const early: TradeLike[] = [];
  const late: TradeLike[] = [];
  for (const dayTrades of byDay.values()) {
    dayTrades.sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime());
    for (let i = 0; i < dayTrades.length; i++) {
      (i < EARLY_TRADES ? early : late).push(dayTrades[i]!);
    }
  }
  if (early.length < MIN_SAMPLE || late.length < MIN_SAMPLE) return null;
  const earlyWin = winRate(early);
  const lateWin = winRate(late);
  const tilted = lateWin <= earlyWin - FADE_GAP;
  return {
    id: "tilt-fade",
    severity: tilted ? "negative" : "positive",
    title: "Late-session edge",
    sentence: tilted
      ? `Your first ${EARLY_TRADES} trades of a day win ${pct(earlyWin)}; everything after wins just ${pct(lateWin)} — your edge fades as the session wears on.`
      : `No late-day fade: trades after your first ${EARLY_TRADES} of a day win ${pct(lateWin)}, vs ${pct(earlyWin)} early on.`,
    figures: [
      {
        label: `First ${EARLY_TRADES} of a day · ${early.length} trades · ${pct(earlyWin)} win`,
        amount: netPnl(early),
      },
      {
        label: `Trade ${EARLY_TRADES + 1} onwards · ${late.length} trades · ${pct(lateWin)} win`,
        amount: netPnl(late),
      },
    ],
  };
}

/**
 * Overtrading bursts — days whose trade count is at least double the user's
 * own median (and at least 3 trades above it), compared with normal days.
 * No fixed "too many trades" number: the baseline is the user's.
 */
export function burstTiltInsight(closed: TradeLike[]): Insight | null {
  const byDay = new Map<string, TradeLike[]>();
  for (const t of closed) {
    const day = localDay(t.opened_at);
    const arr = byDay.get(day);
    if (arr) arr.push(t);
    else byDay.set(day, [t]);
  }
  if (byDay.size < BURST_MIN_DAYS) return null;
  const med = median([...byDay.values()].map((ts) => ts.length));
  const threshold = Math.max(2 * med, med + 3);
  const burst: TradeLike[] = [];
  const normal: TradeLike[] = [];
  let burstDays = 0;
  for (const dayTrades of byDay.values()) {
    if (dayTrades.length >= threshold) {
      burstDays++;
      burst.push(...dayTrades);
    } else {
      normal.push(...dayTrades);
    }
  }
  if (burst.length < MIN_SAMPLE || normal.length < MIN_SAMPLE) return null;
  const burstExp = expectancy(burst);
  const normalExp = expectancy(normal);
  const tilted = burstExp < normalExp;
  const medLabel = Number.isInteger(med) ? String(med) : med.toFixed(1);
  const thresholdLabel = Math.ceil(threshold);
  const dayWord = burstDays === 1 ? "day" : "days";
  return {
    id: "tilt-burst",
    severity: tilted ? "negative" : "positive",
    title: "Overtrading bursts",
    sentence: tilted
      ? `${burstDays} ${dayWord} ran hot — ${thresholdLabel}+ trades against your usual ${medLabel} a day — and the extra trades didn't pay.`
      : `Your busiest ${dayWord} held up: even at ${thresholdLabel}+ trades against your usual ${medLabel} a day, your average per trade kept pace.`,
    figures: [
      {
        label: `Burst ${dayWord} (${burstDays}) · ${burst.length} trades · ${pct(winRate(burst))} win`,
        amount: netPnl(burst),
      },
      { label: "Avg per trade on burst days", amount: burstExp },
      { label: "Avg per trade on normal days", amount: normalExp },
    ],
  };
}

/** All tilt findings, in display order. Closed trades only. */
export function computeTiltInsights(trades: TiltTradeLike[]): Insight[] {
  const closed = closedOnly(trades);
  return [
    sizingTiltInsight(closed),
    paceTiltInsight(closed),
    fadeTiltInsight(closed),
    burstTiltInsight(closed),
  ].filter((i): i is Insight => i !== null);
}
