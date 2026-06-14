/**
 * Optional, honest community sentiment — pure, framework- and DB-free logic.
 *
 * A post may carry an OPTIONAL bullish/bearish sentiment tag. It is meaningful
 * only when the post mentions at least one $cashtag (the tag describes the
 * trader's lean on those tickers). It is NEVER a buy/sell recommendation: the
 * per-symbol gauge built from these tags is explicitly an aggregate of what the
 * community is *saying*, with a prominent not-advice disclaimer.
 *
 * These helpers take already-fetched, block-filtered rows (the server excludes
 * blocked authors before calling in) and turn them into a gauge. No network, no
 * clock — the recency window is applied in SQL by the caller — so the
 * percentages and the min-sample gate are deterministically unit-testable.
 */

/** The two supported sentiment leans. `null` = no sentiment set on a post. */
export const SENTIMENTS = ["bull", "bear"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

const SENTIMENT_SET = new Set<string>(SENTIMENTS);

export function isSentiment(value: unknown): value is Sentiment {
  return typeof value === "string" && SENTIMENT_SET.has(value);
}

/**
 * Normalizes an arbitrary stored/posted value into a known sentiment, or `null`
 * when absent/unrecognized (an empty string, NULL, or a garbled value all mean
 * "no sentiment"). Used on both the read and write paths so a future/garbled
 * cell can never break a gauge.
 */
export function normalizeSentiment(value: unknown): Sentiment | null {
  if (value === "bull" || value === "bear") return value;
  return null;
}

/**
 * Minimum number of sentiment-bearing posts a symbol needs in the window before
 * the gauge is shown. Below this the gauge reads "not enough signal" — a couple
 * of opinions are noise, not a community read.
 */
export const MIN_SENTIMENT_SAMPLE = 3;

/** Supported gauge windows — reuses the trending board's vocabulary. */
export type SentimentWindow = "24h" | "7d";

/** Hours covered by each window — also the SQL `since` boundary the server uses. */
export function sentimentWindowHours(window: SentimentWindow): number {
  return window === "24h" ? 24 : 24 * 7;
}

/** Normalizes an arbitrary query-string value to a valid window (default 24h). */
export function parseSentimentWindow(raw: string | null | undefined): SentimentWindow {
  return raw === "7d" ? "7d" : "24h";
}

/** The aggregate read for one symbol over a window. */
export interface SentimentGauge {
  /** Posts that set "bull" sentiment AND tagged the symbol in the window. */
  bull: number;
  /** Posts that set "bear" sentiment AND tagged the symbol in the window. */
  bear: number;
  /** bull + bear — the sentiment-bearing sample size. */
  total: number;
  /** Bullish share as an integer percent 0..100 (0 when total is 0). */
  bullPct: number;
  /** Bearish share as an integer percent 0..100 — always `100 - bullPct`. */
  bearPct: number;
  /**
   * True once the sample clears {@link MIN_SENTIMENT_SAMPLE}. When false the UI
   * shows "not enough signal" instead of a misleadingly precise percentage.
   */
  hasSignal: boolean;
}

/** A single sentiment-bearing occurrence (one tagged post that set a lean). */
export interface SentimentEvent {
  sentiment: Sentiment;
}

/**
 * Builds the gauge from raw sentiment-bearing events for one symbol.
 *
 *  - Counts bull vs bear.
 *  - `bullPct` is rounded to a whole percent; `bearPct` is `100 - bullPct` so
 *    the two always sum to exactly 100 (no rounding gap or overflow), and an
 *    all-neutral/empty sample reads 0/0.
 *  - `hasSignal` gates on {@link MIN_SENTIMENT_SAMPLE} (default 3) so a tiny
 *    sample never renders as a confident community read.
 *
 * @param events  block-filtered, in-window posts that tagged the symbol AND set
 *                a sentiment (the server applies the symbol/window/block filters).
 * @param minSample override the gate (default MIN_SENTIMENT_SAMPLE; tests pass 1).
 */
export function computeSentimentGauge(
  events: readonly SentimentEvent[],
  minSample: number = MIN_SENTIMENT_SAMPLE
): SentimentGauge {
  let bull = 0;
  let bear = 0;
  for (const e of events) {
    if (e.sentiment === "bull") bull++;
    else if (e.sentiment === "bear") bear++;
  }
  const total = bull + bear;
  const bullPct = total > 0 ? Math.round((bull / total) * 100) : 0;
  const bearPct = total > 0 ? 100 - bullPct : 0;
  return {
    bull,
    bear,
    total,
    bullPct,
    bearPct,
    hasSignal: total >= minSample,
  };
}

/** Metadata for rendering a sentiment toggle / chip (lucide icon names, no emoji). */
export interface SentimentMeta {
  value: Sentiment;
  /** Short label shown on the toggle and the chip. */
  label: string;
  /** lucide-react icon component name (resolved to a component in the UI). */
  icon: "TrendingUp" | "TrendingDown";
  /** Tailwind text-color class for the active/filled state. */
  colorClass: string;
}

export const SENTIMENT_META: Record<Sentiment, SentimentMeta> = {
  bull: {
    value: "bull",
    label: "Bullish",
    icon: "TrendingUp",
    colorClass: "text-profit",
  },
  bear: {
    value: "bear",
    label: "Bearish",
    icon: "TrendingDown",
    colorClass: "text-loss",
  },
};
