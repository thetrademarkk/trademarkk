import * as React from "react";
import { cn } from "@/lib/utils";
import type { CoverageReport } from "@/features/backtest/shared/run-result";

/**
 * THE COVERAGE SEAM — the TAPE signature honesty motif, made visible.
 *
 * A 4px strip welded directly beneath a curve. One grammar, three states:
 *   real  → solid `--bt-rule`        (real bars existed here)
 *   sub   → `.bt-hatch` diagonal weave (substituted to a nearer strike)
 *   gap   → transparent               (no data — absent)
 *
 * So "never a fabricated curve" becomes something you literally SEE. It reuses
 * the existing `.bt-hatch` token, so it inherits every theme + the colorblind
 * palette for free. The `spark` variant is the shrunk 5-segment pip for preset
 * cards; the default `seam` runs full-width under the hero equity in Results.
 *
 * Segments are derived from the EXISTING coverage data (RunResult.coverage or a
 * preset's coverage fraction) — no parallel coverage path, so the honesty signal
 * can never desync from the real substitution logic.
 */

export type SeamKind = "real" | "sub" | "gap";
export interface SeamSegment {
  kind: SeamKind;
  /** Relative weight of this segment (flex-grow basis). */
  frac: number;
}

export function CoverageSeam({
  segments,
  variant = "seam",
  className,
  label = "Data coverage across the period",
}: {
  segments: SeamSegment[];
  variant?: "seam" | "spark";
  className?: string;
  label?: string;
}) {
  const clean = segments.filter((s) => s.frac > 0);
  if (clean.length === 0) return null;
  return (
    <div
      className={cn("bt-seam", variant === "spark" && "bt-seam-spark", className)}
      role="img"
      aria-label={label}
      data-testid="bt-coverage-seam"
      data-seam-variant={variant}
    >
      {clean.map((s, i) => (
        <i
          key={i}
          style={{ flexGrow: s.frac, flexBasis: 0 }}
          data-seam-kind={s.kind}
          className={cn(
            s.kind === "real" && "bt-seam-real",
            s.kind === "sub" && "bt-hatch",
            s.kind === "gap" && "bt-seam-gap"
          )}
        />
      ))}
    </div>
  );
}

/**
 * Derive seam segments from a finished run's CoverageReport. The report carries
 * aggregate fractions (no per-x ranges), so we render the seam as three honest
 * proportions: real (filled bars), substituted, and absent (excluded days). The
 * proportions are computed against the run's traded span so the seam reads as
 * "this much of the window was real / patched / missing".
 */
export function seamFromCoverage(coverage: CoverageReport): SeamSegment[] {
  // filledBarFraction is the truest "real data present" signal (0..1).
  const real = clamp01(coverage.filledBarFraction || coverage.overall);
  // Substituted days vs excluded days carve up the remainder honestly.
  const subs = Math.max(0, coverage.substitutions);
  const excl = Math.max(0, coverage.excludedDays);
  const remainder = Math.max(0, 1 - real);
  const denom = subs + excl;
  const sub = denom > 0 ? remainder * (subs / denom) : remainder;
  const gap = denom > 0 ? remainder * (excl / denom) : 0;
  return [
    { kind: "real", frac: real },
    { kind: "sub", frac: sub },
    { kind: "gap", frac: gap },
  ];
}

/**
 * Derive a 5-segment spark for a preset card from its coverage fraction (0..1).
 * `usedSymbolFallback` flips the partial buckets to the hatch (substituted)
 * grammar — the card-scale form of the same honesty signal.
 */
export function sparkFromFraction(
  fraction: number | null,
  usedSymbolFallback = false
): SeamSegment[] {
  const f = fraction == null ? 0 : clamp01(fraction);
  const filled = Math.round(f * 5);
  return Array.from({ length: 5 }, (_, i) => {
    if (i < filled) return { kind: "real" as const, frac: 1 };
    // The first unfilled bucket is "substituted" when a symbol fallback was used,
    // otherwise it's an absent gap.
    return { kind: usedSymbolFallback && i === filled ? "sub" : "gap", frac: 1 };
  });
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}
