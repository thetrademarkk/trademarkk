"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { deriveQualityChips, type RunResult } from "@/features/backtest/shared/run-result";
import { buildVerdictHeadline, buildCoverageCaveat } from "@/features/backtest/results/verdict";
import { buildBenchmark, type BenchmarkPoint } from "@/features/backtest/results/benchmark";
import type { FixtureSnapshot } from "@/lib/backtest/engine/adapters/fixture-source";
import { Card, CardContent } from "@/components/ui/card";
import { QualityChipRow } from "./quality-chip-row";
import { VerdictStatStrip } from "./verdict-stat-strip";
import { HeroEquityChart } from "./hero-equity-chart";
import { EvidenceTabs } from "./evidence-tabs";
import { TradeBlotter } from "./trade-blotter";
import { BtSection } from "../shared/bt-section";
import { CoverageSeam, seamFromCoverage } from "../shared/coverage-seam";

/** Coverage below this reads as a PARTIAL (honest low-coverage) verdict. */
export const PARTIAL_COVERAGE = 0.4;

/**
 * The READ-ONLY render of a finished RunResult: the full coverage-honesty layer
 * (quality chips → neutral verdict → 6 stats → hero equity/underwater) +
 * lazy evidence tabs + trade-by-trade blotter + the standing disclaimer.
 *
 * Extracted from results-view's DoneState so the SAME report renders in two
 * places identically: the live builder results (with the iteration toolbar +
 * per-stat deltas, owned by results-view) and the immutable public share page
 * `/backtesting/r/[shareId]` (no auth, no toolbar — `prevStats` omitted). A
 * shared run is read-only for everyone, owner included; this component never
 * mutates state, so it is safe to mount anonymously.
 */
export function RunResultReport({
  result,
  prevStats = null,
  snapshot = null,
}: {
  result: RunResult;
  prevStats?: RunResult["stats"] | null;
  snapshot?: FixtureSnapshot | null;
}) {
  const traded = result.blotter.filter((b) => b.legs.length > 0).length;
  const chips = React.useMemo(
    () => deriveQualityChips(result.coverage, traded),
    [result.coverage, traded]
  );
  const headline = buildVerdictHeadline(result);
  const caveat = buildCoverageCaveat(result);
  const isPartial = result.coverage.overall < PARTIAL_COVERAGE;
  const benchmark: BenchmarkPoint[] | null = React.useMemo(
    () => (snapshot ? buildBenchmark(result, snapshot) : null),
    [result, snapshot]
  );

  const seam = React.useMemo(() => seamFromCoverage(result.coverage), [result.coverage]);

  return (
    <div
      className="space-y-3 sm:space-y-6"
      data-testid="bt-results-done"
      data-partial={isPartial ? "true" : "false"}
    >
      {/* Tier 1 — VERDICT */}
      <BtSection number="01" eyebrow="Verdict" data-testid="bt-tier-verdict">
        <Card className="animate-slide-up">
          <CardContent className="space-y-3 pt-4">
            {isPartial && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 p-2.5 text-xs leading-5 text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Low data coverage ({Math.round(result.coverage.overall * 100)}%) — read this as a
                partial, indicative result, not a verdict.
              </div>
            )}
            <QualityChipRow chips={chips} filledBarFraction={result.coverage.filledBarFraction} />
            <p className="text-sm leading-6" data-testid="bt-verdict-headline">
              {headline}
            </p>
            {caveat && <p className="text-xs text-muted">{caveat}</p>}
            <VerdictStatStrip run={result} prevStats={prevStats} />
            {/* The hero equity is the one living amber curve; the Coverage Seam is
              welded full-width directly beneath it — the marquee honesty signal. */}
            <div>
              <HeroEquityChart curve={result.equityCurve} benchmark={benchmark} />
              <CoverageSeam
                segments={seam}
                className="mt-1"
                label="Data coverage across the equity period"
              />
            </div>
          </CardContent>
        </Card>
      </BtSection>

      {/* Tier 2 — EVIDENCE */}
      <BtSection number="02" eyebrow="Evidence" data-testid="bt-tier-evidence">
        <EvidenceTabs run={result} />
      </BtSection>

      {/* Tier 3 — TRADE-BY-TRADE */}
      <BtSection number="03" eyebrow="Trade-by-trade" data-testid="bt-tier-blotter">
        <TradeBlotter run={result} />
      </BtSection>

      <p className="rounded-lg border bg-surface-2/40 p-3 text-xs leading-5 text-muted">
        Backtests are hypothetical, use historical data with patchy options coverage, and exclude
        liquidity/impact beyond modelled slippage. Past performance is not indicative of future
        results.
      </p>
    </div>
  );
}
