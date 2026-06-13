/**
 * Pulse — public platform-transparency stats. Pure shaping/derivation logic
 * (unit-tested); the DB queries live in src/server/pulse.ts.
 *
 * Honesty contract (same as public-stats.ts): every number is an aggregate
 * the platform can actually see. Per-user journals live in each user's own
 * database and are NOT centrally readable. Web vitals are first-party field
 * samples collected via the `web-vitals` lib — Vercel has no stable REST API
 * for reading its Web Analytics / Speed Insights data, so we measure and
 * publish our own.
 */

export const VITAL_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type VitalMetric = (typeof VITAL_METRICS)[number];

export interface DailyCount {
  /** ISO day, e.g. "2026-06-12". */
  day: string;
  count: number;
}

export interface DailyViews {
  day: string;
  views: number;
  /** Distinct signed-in users seen that day. */
  actives: number;
}

export type VitalRating = "good" | "needs-improvement" | "poor";

export interface VitalSummary {
  metric: VitalMetric;
  /** 75th percentile of field samples (ms; CLS is unitless). Null when no data. */
  p75: number | null;
  samples: number;
  rating: VitalRating | null;
}

export interface PulseTotals {
  traders: number;
  traders7d: number;
  active7d: number;
  active30d: number;
  posts: number;
  posts7d: number;
  comments: number;
  likes: number;
  views30d: number;
  longestStreak: number;
}

export interface PulseData {
  totals: PulseTotals;
  signupsDaily: DailyCount[];
  viewsDaily: DailyViews[];
  postsDaily: DailyCount[];
  topPages: { path: string; views: number }[];
  vitals: VitalSummary[];
  generatedAt: string;
}

/** Floor to a safe non-negative integer; anything unparseable becomes 0. */
export const safeCount = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** UTC ISO day string for a date. */
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Zero-fills a daily series so charts show honest flat lines instead of
 * skipping empty days. `rows` may arrive unordered with unknown extra days;
 * only the window [now - days + 1, now] is kept.
 */
export function fillDailySeries(
  rows: { day?: unknown; count?: unknown }[],
  days: number,
  now: Date = new Date()
): DailyCount[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day)) {
      byDay.set(r.day, safeCount(r.count));
    }
  }
  const out: DailyCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = isoDay(new Date(now.getTime() - i * 864e5));
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

/** Same zero-fill for the two-series page-view trend. */
export function fillDailyViews(
  rows: { day?: unknown; views?: unknown; actives?: unknown }[],
  days: number,
  now: Date = new Date()
): DailyViews[] {
  const byDay = new Map<string, { views: number; actives: number }>();
  for (const r of rows) {
    if (typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day)) {
      byDay.set(r.day, { views: safeCount(r.views), actives: safeCount(r.actives) });
    }
  }
  const out: DailyViews[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = isoDay(new Date(now.getTime() - i * 864e5));
    const hit = byDay.get(day);
    out.push({ day, views: hit?.views ?? 0, actives: hit?.actives ?? 0 });
  }
  return out;
}

/** Nearest-rank 75th percentile. Returns null for an empty sample set. */
export function p75(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const idx = Math.ceil(0.75 * clean.length) - 1;
  return clean[Math.max(0, idx)]!;
}

/** Google's Core Web Vitals thresholds: [good ≤, poor >]. */
export const VITAL_THRESHOLDS: Record<VitalMetric, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
};

export function rateVital(metric: VitalMetric, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[metric];
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

/** Builds the per-metric field summary from raw sample values. */
export function summarizeVitals(samplesByMetric: Record<string, number[]>): VitalSummary[] {
  return VITAL_METRICS.map((metric) => {
    const values = samplesByMetric[metric] ?? [];
    const pct = p75(values);
    return {
      metric,
      p75: pct,
      samples: values.filter((v) => Number.isFinite(v) && v >= 0).length,
      rating: pct === null ? null : rateVital(metric, pct),
    };
  });
}

/** Display formatting: ms for timing metrics (s above 1000), raw score for CLS. */
export function formatVitalValue(metric: VitalMetric, value: number): string {
  if (metric === "CLS") return value.toFixed(3);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export interface RawPulseTotals {
  traders?: unknown;
  traders7d?: unknown;
  active7d?: unknown;
  active30d?: unknown;
  posts?: unknown;
  posts7d?: unknown;
  comments?: unknown;
  likes?: unknown;
  views30d?: unknown;
  longestStreak?: unknown;
}

/**
 * Clamps raw totals into the public shape. Invariants: nothing negative/NaN,
 * and active/new-trader counts can never exceed registered traders.
 */
export function shapePulseTotals(raw: RawPulseTotals): PulseTotals {
  const traders = safeCount(raw.traders);
  return {
    traders,
    traders7d: Math.min(safeCount(raw.traders7d), traders),
    active7d: Math.min(safeCount(raw.active7d), traders),
    active30d: Math.min(safeCount(raw.active30d), traders),
    posts: safeCount(raw.posts),
    posts7d: safeCount(raw.posts7d),
    comments: safeCount(raw.comments),
    likes: safeCount(raw.likes),
    views30d: safeCount(raw.views30d),
    longestStreak: safeCount(raw.longestStreak),
  };
}
