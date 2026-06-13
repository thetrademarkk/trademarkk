/**
 * Hold-horizon classification — pure, no I/O. Derives each trade's holding
 * horizon from its entry/exit timestamps (interpreted in IST, the timezone
 * Indian brokers settle on) and its product, so the analytics can adapt to the
 * kind of trader the data describes: an intraday scalper, a swing trader or a
 * positional/delivery investor.
 *
 *  - intraday   — squared off the same IST calendar day, OR product = MIS.
 *  - swing      — held overnight, up to 7 calendar days.
 *  - positional — held strictly more than 7 calendar days.
 *
 * CNC (delivery equity) and NRML (carry-forward derivatives) are by definition
 * held overnight, so a CNC/NRML trade is never intraday even when the stored
 * timestamps look same-day (e.g. a date-only import). Legacy trades carry
 * product = null and fall back to the timestamp test, matching the rest of the
 * app's "null product behaves like the inferred holding pattern" rule.
 *
 * Everything here is paise-irrelevant (it only counts and classifies), runs
 * identically across hosted / BYOD / local modes, and uses no market data.
 */
import { istDateKey } from "@/lib/tax/fy";
import type { TradeLike } from "./stats";

export type Horizon = "intraday" | "swing" | "positional";

/** Trades carry an optional product; horizon only needs these few fields. */
export type HorizonTradeLike = TradeLike & { product?: string | null };

/** Calendar days between two IST dates (whole days, exit − entry). */
export function istCalendarDaysHeld(openedAt: string, closedAt: string): number {
  const a = istDateKey(openedAt);
  const b = istDateKey(closedAt);
  // Compare at midnight UTC of each IST date key to dodge any offset edge.
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (Number.isNaN(ms)) return 0;
  return Math.round(ms / 86_400_000);
}

/** Calendar days a still-open trade has been held, as of `now` (IST). */
export function istCalendarDaysOpen(openedAt: string, now: Date = new Date()): number {
  return istCalendarDaysHeld(openedAt, now.toISOString());
}

/** Swing tops out at this many calendar days held; beyond it is positional. */
export const SWING_MAX_DAYS = 7;

/**
 * The holding horizon of a single (closed) trade. Returns null when the trade
 * has no close date — an open trade isn't realised, so it has no final horizon.
 */
export function classifyHorizon(t: HorizonTradeLike): Horizon | null {
  if (!t.closed_at) return null;
  const product = t.product ?? null;
  // Carry products are overnight by definition, regardless of the timestamps.
  if (product === "MIS") return "intraday";
  if (product === "CNC" || product === "NRML" || product === "BTST" || product === "STBT") {
    const days = istCalendarDaysHeld(t.opened_at, t.closed_at);
    return days > SWING_MAX_DAYS ? "positional" : "swing";
  }
  // No product (legacy) → fall back to the timestamps.
  if (istDateKey(t.opened_at) === istDateKey(t.closed_at)) return "intraday";
  const days = istCalendarDaysHeld(t.opened_at, t.closed_at);
  return days > SWING_MAX_DAYS ? "positional" : "swing";
}

export const HORIZON_ORDER: Horizon[] = ["intraday", "swing", "positional"];

export const HORIZON_LABEL: Record<Horizon, string> = {
  intraday: "Intraday",
  swing: "Swing (1–7 days)",
  positional: "Positional (>7 days)",
};

export interface HorizonBucket {
  horizon: Horizon;
  label: string;
  trades: number;
  netPnl: number;
  winRate: number;
  /** True once the bucket clears MIN_SAMPLE — the UI greys/suppresses the rest. */
  enough: boolean;
}

/** Minimum trades behind a horizon bucket before its win-rate/P&L is signal. */
export const MIN_SAMPLE = 5;

/**
 * Count, net P&L and win rate per holding-horizon bucket, over the closed
 * trades that can be classified. Buckets below MIN_SAMPLE are still returned
 * (so the mix is honest) but flagged `enough:false`. Returns buckets in the
 * fixed intraday → swing → positional order; empty buckets are dropped.
 */
export function holdingPeriodBuckets(trades: HorizonTradeLike[]): HorizonBucket[] {
  const groups = new Map<Horizon, HorizonTradeLike[]>();
  for (const t of trades) {
    const h = classifyHorizon(t);
    if (!h) continue;
    const arr = groups.get(h);
    if (arr) arr.push(t);
    else groups.set(h, [t]);
  }
  return HORIZON_ORDER.filter((h) => groups.has(h)).map((h) => {
    const ts = groups.get(h)!;
    const wins = ts.filter((t) => t.net_pnl > 0).length;
    return {
      horizon: h,
      label: HORIZON_LABEL[h],
      trades: ts.length,
      netPnl: ts.reduce((s, t) => s + t.net_pnl, 0),
      winRate: ts.length ? wins / ts.length : 0,
      enough: ts.length >= MIN_SAMPLE,
    };
  });
}

export interface HorizonMix {
  /** Closed, classifiable trades counted toward the mix. */
  total: number;
  intraday: number;
  swing: number;
  positional: number;
  /** Fractions in [0,1] — 0 when total is 0. */
  intradayPct: number;
  swingPct: number;
  positionalPct: number;
  /** Combined swing + positional fraction — the "held overnight" share. */
  multiDayPct: number;
}

/** The mix of holding horizons across the classifiable closed trades. */
export function horizonMix(trades: HorizonTradeLike[]): HorizonMix {
  let intraday = 0;
  let swing = 0;
  let positional = 0;
  for (const t of trades) {
    const h = classifyHorizon(t);
    if (h === "intraday") intraday++;
    else if (h === "swing") swing++;
    else if (h === "positional") positional++;
  }
  const total = intraday + swing + positional;
  const frac = (n: number) => (total === 0 ? 0 : n / total);
  return {
    total,
    intraday,
    swing,
    positional,
    intradayPct: frac(intraday),
    swingPct: frac(swing),
    positionalPct: frac(positional),
    multiDayPct: frac(swing + positional),
  };
}

/**
 * Minimum classifiable trades before the mix is trusted to gate panels — below
 * this we never hide anything (too little data to judge the trader's style).
 */
export const GATE_MIN_TRADES = MIN_SAMPLE;

/**
 * Share of multi-day trades at or above which the intraday-only panels
 * (entry-hour, expiry-day, minutes-between-trades) are predominantly
 * irrelevant and should be gated/labelled.
 */
export const MULTI_DAY_GATE_PCT = 0.7;

/**
 * Data-driven gate for the intraday-only panels. True ⇒ hide or label them as
 * "intraday only", because the user's trades are predominantly multi-day.
 * Degrades gracefully: with too few classifiable trades (< GATE_MIN_TRADES) it
 * returns false so a new/thin journal never hides panels.
 */
export function shouldGateIntradayPanels(mix: HorizonMix): boolean {
  if (mix.total < GATE_MIN_TRADES) return false;
  return mix.multiDayPct >= MULTI_DAY_GATE_PCT;
}

export interface TradingStyle {
  /** The horizon that describes the trader, or null when there's no data. */
  dominant: Horizon | null;
  /** Whole-percent share of the dominant horizon (0–100). */
  pct: number;
  /** A one-line summary, e.g. "Mostly positional — 68% of trades held >7 days". */
  summary: string;
  mix: HorizonMix;
}

const STYLE_PHRASE: Record<Horizon, string> = {
  intraday: "squared off same day",
  swing: "held 1–7 days",
  positional: "held over a week",
};

/**
 * A short "trading style" summary for the dashboard/analytics header. Picks the
 * dominant horizon; calls the trader "mostly X" when it clears 60%, otherwise
 * "mixed". Returns a null dominant + neutral copy when there's no data.
 */
export function tradingStyle(trades: HorizonTradeLike[]): TradingStyle {
  const mix = horizonMix(trades);
  if (mix.total === 0) {
    return {
      dominant: null,
      pct: 0,
      summary: "Not enough closed trades to read your style yet.",
      mix,
    };
  }
  const ranked: { h: Horizon; pct: number }[] = (
    [
      { h: "intraday", pct: mix.intradayPct },
      { h: "swing", pct: mix.swingPct },
      { h: "positional", pct: mix.positionalPct },
    ] as { h: Horizon; pct: number }[]
  ).sort((a, b) => b.pct - a.pct);
  const top = ranked[0]!;
  const pct = Math.round(top.pct * 100);
  const dominant = top.h;
  const styleWord =
    dominant === "intraday" ? "intraday" : dominant === "swing" ? "swing" : "positional";
  const summary =
    top.pct >= 0.6
      ? `Mostly ${styleWord} — ${pct}% of trades ${STYLE_PHRASE[dominant]}.`
      : `Mixed style — ${pct}% ${styleWord}, the rest spread across other horizons.`;
  return { dominant, pct, summary, mix };
}

/**
 * Which way the trader-type-adaptive dashboard should lean:
 *  - `positional` — predominantly multi-day; surface OPEN positions + holding
 *    period, de-emphasise the intraday day-stats.
 *  - `intraday`   — predominantly same-day; keep the day-focused KPIs forward.
 *  - `balanced`   — mixed, or too thin to judge; show everything (graceful
 *    degradation — we never hard-remove a panel for a new/thin journal).
 */
export type DashboardEmphasis = "intraday" | "positional" | "balanced";

/**
 * Pick the dashboard emphasis from the holding-horizon mix. Mirrors the
 * intraday-panel gate's thresholds so the dashboard and the analytics page tell
 * the same story: a journal with < GATE_MIN_TRADES classifiable closed trades
 * stays `balanced` (too little data), at/above MULTI_DAY_GATE_PCT multi-day it
 * leans `positional`, and a symmetric intraday-dominant share leans `intraday`.
 */
export function dashboardEmphasis(mix: HorizonMix): DashboardEmphasis {
  if (mix.total < GATE_MIN_TRADES) return "balanced";
  if (mix.multiDayPct >= MULTI_DAY_GATE_PCT) return "positional";
  if (mix.intradayPct >= MULTI_DAY_GATE_PCT) return "intraday";
  return "balanced";
}
