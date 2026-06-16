/**
 * Coverage MATH — the pure confidence score (07-data-layer.md §7d) and the
 * gap-fill policy classification (§7c). No DuckDB, no network — these run over
 * already-derived coverage inputs and a list of gap lengths.
 *
 * Everything here is deterministic and unit-testable; the SQL that PRODUCES the
 * inputs (the coverage manifest in §7a, the grid LEFT JOIN in §7c) is a separate
 * later step. This module only does arithmetic the spec declares verbatim.
 */

/** Session minutes per trading day at 1m: 09:15–15:30 inclusive (07-data-layer §7a). */
export const EXPECTED_BARS_PER_DAY = 375;

/**
 * Gap threshold (minutes). Gaps of THIS LENGTH OR SHORTER are forward-filled
 * (LOCF); longer gaps snap to the last real bar (07-data-layer §7c). The spec's
 * worked rule: "Short gaps (≤ N = 3 consecutive minutes)".
 */
export const MAX_LOCF_GAP_MIN = 3;

/* ────────────────────────────── confidence ────────────────────────────── */

/** Inputs to the §7d confidence score — all pre-derived fractions / counts. */
export interface ConfidenceInputs {
  /** Mean coverage (0–1) over the legs we ACTUALLY traded (served strikes). */
  avgServedLegCoverage: number;
  /** 0–1 fraction of bars that were forward-filled (penalized). */
  filledBarFraction: number;
  /** 0–1 fraction of trading days dropped (whole-day-missing legs). */
  excludedDayFraction: number;
  /** 0–1 fraction of legs whose served strike === requested strike. */
  exactStrikeFraction: number;
}

/** Confidence band thresholds (§7d). */
export type ConfidenceBand = "High" | "Medium" | "Low";

/** Weighted confidence components, exactly as the §7d formula declares them. */
export const CONFIDENCE_WEIGHTS = {
  avgServedLegCoverage: 0.45,
  filledBarComplement: 0.25,
  excludedDayComplement: 0.2,
  exactStrike: 0.1,
} as const;

/** Clamp x into [0, 1]; defensive against caller-supplied junk. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The 0–100 Confidence score (07-data-layer §7d, verbatim):
 *
 *   confidence = round(100 * (
 *       0.45 * avgServedLegCoverage
 *     + 0.25 * (1 - filledBarFraction)
 *     + 0.20 * (1 - excludedDayFraction)
 *     + 0.10 * exactStrikeFraction))
 *
 * Inputs are clamped to [0,1] so the result is always a finite integer 0–100.
 */
export function confidenceScore(inp: ConfidenceInputs): number {
  const avgCov = clamp01(inp.avgServedLegCoverage);
  const filled = clamp01(inp.filledBarFraction);
  const excluded = clamp01(inp.excludedDayFraction);
  const exact = clamp01(inp.exactStrikeFraction);

  const raw =
    CONFIDENCE_WEIGHTS.avgServedLegCoverage * avgCov +
    CONFIDENCE_WEIGHTS.filledBarComplement * (1 - filled) +
    CONFIDENCE_WEIGHTS.excludedDayComplement * (1 - excluded) +
    CONFIDENCE_WEIGHTS.exactStrike * exact;

  return Math.round(100 * raw);
}

/**
 * Confidence band from the 0–100 score (§7d):
 *   ≥ 80 → "High"; ≥ 55 → "Medium"; else "Low".
 */
export function confidenceBand(score: number): ConfidenceBand {
  if (score >= 80) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

/** Score + band in one call. */
export function computeConfidence(inp: ConfidenceInputs): {
  score: number;
  band: ConfidenceBand;
} {
  const score = confidenceScore(inp);
  return { score, band: confidenceBand(score) };
}

/* ─────────────────────────── gap classification ─────────────────────────── */

/**
 * Gap-fill policy for a single intra-series gap (07-data-layer §7c):
 *   - "locf"      — ≤ 3 consecutive missing minutes: forward-fill last close.
 *   - "snap"      — > 3 minutes: do NOT fabricate; an entry/exit landing here
 *                   snaps to the last real bar ≤ target time (gapFilled flag).
 *   - "excluded"  — a WHOLE trading day missing for a resolved leg: the day is
 *                   excluded from the backtest for that leg.
 */
export type GapPolicy = "locf" | "snap" | "excluded";

/**
 * Classify one gap by its length in consecutive missing minutes.
 *
 * `wholeDay` marks a gap that spans the entire trading session for a resolved
 * leg (the §7c "whole-day missing" case) — that day is EXCLUDED regardless of
 * raw length. Otherwise the ≤3 / >3 threshold decides LOCF vs snap.
 *
 * A non-positive length is not a gap and classifies as "locf" (nothing to fill).
 */
export function classifyGap(missingMinutes: number, wholeDay = false): GapPolicy {
  if (wholeDay) return "excluded";
  if (missingMinutes <= MAX_LOCF_GAP_MIN) return "locf";
  return "snap";
}

/** Convenience: is this gap short enough to forward-fill (LOCF)? */
export function isLocfGap(missingMinutes: number): boolean {
  return missingMinutes > 0 && missingMinutes <= MAX_LOCF_GAP_MIN;
}

/**
 * A gap spanning a full trading session counts as whole-day-missing. With 375
 * expected bars per day, a 375-minute (or longer) hole means no real print all
 * day → excluded. Pure helper so callers needn't hardcode 375.
 */
export function isWholeDayGap(missingMinutes: number): boolean {
  return missingMinutes >= EXPECTED_BARS_PER_DAY;
}
