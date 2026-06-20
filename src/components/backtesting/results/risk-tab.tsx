"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { formatINR, formatNumber } from "@/lib/utils";
import { EquityCone } from "@/features/analytics/components/equity-cone";
import { topDrawdownEpisodes } from "@/features/backtest/results/equity-series";
import { monteCarloFromRun } from "@/lib/backtest/mc-cone";
import { MIN_TRADES } from "@/lib/montecarlo/simulate";
import type { RunResult } from "@/features/backtest/shared/run-result";

/**
 * Risk tab — the honesty headliner. Top drawdown-periods table + the Monte-Carlo
 * cone (reuses src/lib/montecarlo via mc-cone, rendered with the existing
 * <EquityCone> SVG). The cone is GATED at MIN_TRADES = 30: below that we show an
 * honest "not enough data" note instead of a misleading projection.
 */
export function RiskTab({ run }: { run: RunResult }) {
  const episodes = React.useMemo(() => topDrawdownEpisodes(run.equityCurve, 5), [run]);
  const cone = React.useMemo(() => monteCarloFromRun(run), [run]);
  const traded = run.blotter.filter((b) => b.legs.length > 0).length;

  return (
    <div className="space-y-5" data-testid="bt-risk-tab">
      <section className="bt-boot bt-boot-1">
        <h3 className="bt-display mb-2 text-sm font-semibold">Worst drawdown periods</h3>
        {episodes.length === 0 ? (
          <p className="text-sm text-muted">
            No drawdown — equity never dipped below a prior peak.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="bt-label py-1.5">#</th>
                  <th className="bt-label py-1.5">Depth</th>
                  <th className="bt-label py-1.5">Length</th>
                  <th className="bt-label py-1.5">Started</th>
                </tr>
              </thead>
              <tbody>
                {episodes.map((e, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5 font-money tabular-nums text-muted">{i + 1}</td>
                    <td className="py-1.5 font-money tabular-nums text-loss">
                      {formatINR(e.depth, { decimals: true })}
                    </td>
                    <td className="py-1.5 font-money tabular-nums">{e.durationDays}d</td>
                    <td className="py-1.5 font-money text-xs tabular-nums text-muted">
                      {new Date(e.startTs + 5.5 * 3600_000).toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bt-boot bt-boot-2">
        <h3 className="bt-display mb-1 text-sm font-semibold">Monte-Carlo cone</h3>
        {cone ? (
          <>
            <p className="mb-2 text-xs text-muted">
              {cone.sampleSize} trade-days bootstrapped ({cone.basis === "R" ? "R-units" : "rupees"}
              ). 95th-percentile drawdown{" "}
              <span className="font-money text-loss">
                {cone.basis === "R"
                  ? `${formatNumber(cone.sim.worstMaxDrawdown, 1)}R`
                  : formatINR(-cone.sim.worstMaxDrawdown)}
              </span>{" "}
              · risk of ruin {(cone.sim.riskOfRuin * 100).toFixed(0)}%.
            </p>
            <EquityCone cone={cone.sim.cone} startEquity={cone.sim.meta.startEquityR} />
          </>
        ) : (
          <p
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-warning"
            data-testid="bt-cone-lowsample"
          >
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Need {MIN_TRADES}+ trade-days for a meaningful projection ({traded} so far). We hide the
            cone rather than show a misleading one.
          </p>
        )}
      </section>
    </div>
  );
}
