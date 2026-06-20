"use client";

import * as React from "react";
import Link from "next/link";
import { GraduationCap, Lock, PencilRuler, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PRESET_CATEGORY_LABEL } from "@/features/backtest/presets/catalogue";
import type { PresetCard as PresetCardData } from "@/features/backtest/presets/coverage-resolver";
import { INDEX_META } from "@/features/backtest/shared/instruments";
import { CoverageBadge } from "./coverage-badge";
import { CoverageSeam, sparkFromFraction } from "../shared/coverage-seam";

/**
 * One preset card in the Explore grid (BT-10, item 3). Shows the title, thesis,
 * an index chip, descriptive tags, the MANDATORY CoverageBadge, and "what it
 * teaches" — with "Open in builder" (hydrates the BT-06 wizard with the preset's
 * exact StrategyDef) and "Run". Presets without local data show an honest LOCKED
 * Run action (NOT a fake result); the same definition runs unchanged once BT-08
 * connects the live data layer.
 *
 * All copy is descriptive — these are EDUCATIONAL examples, never recommendations.
 */

const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function PresetCard({ card }: { card: PresetCardData }) {
  const { meta, coverage, runnableNow } = card;
  const indexLabel = INDEX_META[meta.index].label;
  const detail =
    coverage.totalExpiries > 0 && !coverage.usedSymbolFallback
      ? `${coverage.matchedExpiries} of ${coverage.totalExpiries} expiries in this window are in the dataset.`
      : coverage.usedSymbolFallback
        ? "Shown from the per-index coverage rollup (no exact expiry match yet)."
        : undefined;

  return (
    <article
      data-testid="preset-card"
      data-preset-id={meta.id}
      data-runnable={runnableNow ? "1" : "0"}
      className="flex h-full flex-col rounded-lg border bg-surface p-4 transition-colors hover:border-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{indexLabel}</Badge>
          <Badge variant="outline">{PRESET_CATEGORY_LABEL[meta.category]}</Badge>
        </div>
        <CoverageBadge
          fraction={coverage.fraction}
          symbol={meta.index}
          scope="in this period"
          detail={detail}
          size="md"
        />
      </div>

      {/* Coverage spark — the seam at card scale (solid=real, hatch=substituted). */}
      <CoverageSeam
        variant="spark"
        segments={sparkFromFraction(coverage.fraction, coverage.usedSymbolFallback)}
        className="mt-2.5"
        label="Data coverage for this preset"
      />

      <h3 className="mt-3 line-clamp-3 text-base font-semibold leading-snug">{meta.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{meta.thesis}</p>

      <div className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 p-3">
        <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="line-clamp-3 text-xs leading-5 text-muted">
          <span className="font-medium text-foreground">What it teaches: </span>
          {meta.teaches}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        {meta.tags.slice(0, 5).map((t) => (
          <span key={t} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
            {t}
          </span>
        ))}
      </div>

      <p className="micro-label mt-2">
        {meta.periodLabel} · {DIFFICULTY_LABEL[meta.difficulty] ?? meta.difficulty}
      </p>

      {/* mt-auto pins the action row to the card bottom so every card's buttons
          align on a row, regardless of how much thesis/teaches text sits above. */}
      <div className="mt-auto flex items-center gap-2 pt-4">
        <Button asChild size="sm" variant="outline" className="flex-1">
          <Link
            href={`/backtesting/build?preset=${encodeURIComponent(meta.id)}`}
            data-testid="preset-open-builder"
          >
            <PencilRuler className="h-3.5 w-3.5" aria-hidden />
            Open in builder
          </Link>
        </Button>
        {runnableNow ? (
          <Button asChild size="sm" className="flex-1" data-testid="preset-run">
            <Link href={`/backtesting/build?preset=${encodeURIComponent(meta.id)}&run=1`}>
              <Play className="h-3.5 w-3.5" aria-hidden />
              Run
            </Link>
          </Button>
        ) : (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className={cn("w-full text-muted")}
                    aria-disabled="true"
                    data-testid="preset-run-locked"
                    onClick={(e) => e.preventDefault()}
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden />
                    Locked
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px] leading-5">
                This strategy&apos;s window isn&apos;t in the dataset yet. You can still open it in
                the builder to inspect its legs — results unlock as the dataset&apos;s coverage
                expands.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </article>
  );
}
