"use client";

import * as React from "react";
import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { QualityChip } from "@/features/backtest/shared/run-result";

/**
 * The QUALITY CHIP ROW — the coverage-honesty layer, surfaced prominently above
 * the verdict. This is the product moat: filled-bar fraction, substituted /
 * illiquid / excluded days and low-coverage warnings are loud here, never
 * footnotes. Quiet-by-default (a clean run shows a single green coverage chip),
 * loud-on-problem.
 *
 * Each chip carries a tooltip explaining the threshold so the number is
 * self-documenting. Tone maps to the semantic profit/warning/loss tokens only.
 */

function chipVariant(level: QualityChip["level"]): "profit" | "warning" | "loss" {
  return level === "good" ? "profit" : level === "warning" ? "warning" : "loss";
}

const CHIP_HELP: Record<QualityChip["kind"], string> = {
  coverage:
    "Share of the requested option data that was actually present. ≥70% reads green, 40–69% amber, <40% red — patchy coverage means treat the numbers as indicative.",
  liquidity:
    "Days where a leg filled on a low-volume / sparse strike. Fills on thin liquidity are less reliable than the headline suggests.",
  substitution:
    "Days where the exact requested strike was missing, so the engine fell back to the nearest available one. These rows are marked with an amber asterisk in the trade log.",
  sample:
    "Number of trade-days in the run. Under 30 is statistically thin — the Monte-Carlo cone and Sharpe-derived figures are suppressed below this.",
  slippage: "Adverse slippage is modelled on every fill and already baked into the P&L.",
  excluded: "Days skipped entirely because a required leg had no data at all (MISSING_LEG).",
};

export function QualityChipRow({
  chips,
  filledBarFraction,
  onCoverageClick,
}: {
  chips: QualityChip[];
  /** 0..1 — fraction of expected minute-bars actually present. */
  filledBarFraction: number;
  /** Optional: scroll to the coverage detail when the coverage chip is clicked. */
  onCoverageClick?: () => void;
}) {
  const hasProblem = chips.some((c) => c.level !== "good");
  const barPct = Math.round(filledBarFraction * 100);
  // 5-segment coverage honesty meter — one seg per 20% of bars filled. Tone
  // tracks the same thresholds as the filled-bar badge (≥90 good, ≥60 warn).
  const filledSegs = Math.round(filledBarFraction * 5);
  const meterTone: "1" | "warn" | "bad" = barPct >= 90 ? "1" : barPct >= 60 ? "warn" : "bad";

  return (
    <TooltipProvider delayDuration={150}>
      <div
        className="flex flex-wrap items-center gap-1.5"
        data-testid="bt-quality-chips"
        aria-label="Data coverage and quality"
      >
        {hasProblem ? (
          <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5 text-profit" aria-hidden />
        )}

        {chips.map((c, i) => (
          <Tooltip key={`${c.kind}-${i}`}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={c.kind === "coverage" ? onCoverageClick : undefined}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-md"
                data-chip-kind={c.kind}
                data-chip-level={c.level}
              >
                <Badge variant={chipVariant(c.level)} className="cursor-help">
                  {c.label}
                  <Info className="h-3 w-3 opacity-60" aria-hidden />
                </Badge>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px] text-xs leading-5">
              {CHIP_HELP[c.kind]}
            </TooltipContent>
          </Tooltip>
        ))}

        {/* Filled-bar fraction — the rawest honesty signal. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="focus:outline-none rounded-md inline-flex items-center gap-1.5"
            >
              <span className="bt-meter" aria-hidden>
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className="bt-meter-seg"
                    data-on={i < filledSegs ? meterTone : undefined}
                  />
                ))}
              </span>
              <Badge variant={barPct >= 90 ? "profit" : barPct >= 60 ? "warning" : "loss"}>
                <span className="bt-num">{barPct}</span>% bars filled
                <Info className="h-3 w-3 opacity-60" aria-hidden />
              </Badge>
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[260px] text-xs leading-5">
            Fraction of the expected 1-minute bars that were actually present in the dataset across
            the run. Gaps are filled adversely, never invented.
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
