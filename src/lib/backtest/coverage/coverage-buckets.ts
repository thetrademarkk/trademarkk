/**
 * Coverage bucketing — the PURE honesty layer that turns a raw data-coverage
 * fraction (0..1, from the committed manifest summary) into a three-way bucket
 * (high / medium / low) plus an honest "unknown" when the manifest has NO entry
 * for the query. This is what the mandatory CoverageBadge renders on every
 * preset card and on every preset run result. NO cherry-picking — a low number
 * (or an absent one) is surfaced exactly, never hidden.
 *
 * Thresholds follow the plan's coverage rule (D-UI): >=70% high, 40-69% medium,
 * <40% low. The chosen colour tokens are the codebase's semantic status tokens
 * (profit / warning / loss) so all four themes + colourblind/reduced-motion are
 * inherited for free. Descriptive only — a bucket NEVER implies profitability.
 *
 * Framework-free so it is unit-tested directly; the React CoverageBadge is a
 * thin renderer over `bucketForCoverage`.
 */

/** The three honest coverage buckets, plus "unknown" for an absent manifest entry. */
export type CoverageBucket = "high" | "medium" | "low" | "unknown";

/** Inclusive lower bounds (as fractions 0..1) for the high / medium buckets. */
export const COVERAGE_HIGH_MIN = 0.7 as const;
export const COVERAGE_MEDIUM_MIN = 0.4 as const;

export interface CoverageBucketInfo {
  bucket: CoverageBucket;
  /** Coverage as a fraction 0..1, or null when unknown. */
  fraction: number | null;
  /** Rounded whole-percent for display, or null when unknown. */
  percent: number | null;
  /** Short pill label ("High" / "Medium" / "Low" / "Unknown"). */
  label: string;
  /** A semantic token suffix for the pill colour (profit | warning | loss | muted). */
  tone: "profit" | "warning" | "loss" | "muted";
}

const LABELS: Record<CoverageBucket, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Unknown",
};

const TONES: Record<CoverageBucket, CoverageBucketInfo["tone"]> = {
  high: "profit",
  medium: "warning",
  low: "loss",
  unknown: "muted",
};

/**
 * Bucket a raw coverage fraction (0..1). `null`/`undefined`/non-finite => the
 * honest "unknown" bucket (manifest has no real number for this query — we say
 * so rather than guessing). Values are clamped to [0,1] for display so a stray
 * 1.01 still renders "100%".
 */
export function bucketForCoverage(fraction: number | null | undefined): CoverageBucketInfo {
  if (fraction == null || !Number.isFinite(fraction)) {
    return {
      bucket: "unknown",
      fraction: null,
      percent: null,
      label: LABELS.unknown,
      tone: TONES.unknown,
    };
  }
  const f = Math.min(1, Math.max(0, fraction));
  const bucket: CoverageBucket =
    f >= COVERAGE_HIGH_MIN ? "high" : f >= COVERAGE_MEDIUM_MIN ? "medium" : "low";
  return {
    bucket,
    fraction: f,
    percent: Math.round(f * 100),
    label: LABELS[bucket],
    tone: TONES[bucket],
  };
}

/**
 * An honest, descriptive tooltip sentence for a (symbol, scope) at a given
 * coverage. Surfaces low coverage plainly ("results are partial") and is fully
 * transparent when the number is unknown. NEVER mentions profitability.
 */
export function coverageTooltip(symbol: string, scope: string, info: CoverageBucketInfo): string {
  if (info.bucket === "unknown" || info.percent == null) {
    return `Data coverage for ${symbol} ${scope} is not in the committed manifest yet — treat any result as unverified until the full market dataset is live.`;
  }
  const base = `${symbol} ~${info.percent}% covered ${scope}`;
  if (info.bucket === "high") {
    return `${base} — most session bars are present, but coverage is never a profitability signal.`;
  }
  if (info.bucket === "medium") {
    return `${base} — a meaningful share of bars is missing, so results are partial.`;
  }
  return `${base} — large gaps in the data, so results are highly partial and should be read with caution.`;
}
