"use client";

import * as React from "react";
import { Info, ShieldQuestion, TrendingDown } from "lucide-react";
import { formatINR, formatNumber } from "@/lib/utils";
import { EquityCone } from "@/features/analytics/components/equity-cone";
import { walkForward, walkForwardCurve } from "@/lib/backtest/walkforward";
import { robustnessFromRun, MIN_TRADES } from "@/lib/backtest/robustness";
import { deflatedSharpe } from "@/lib/backtest/deflated-sharpe";
import { monteCarloFromRun } from "@/lib/backtest/mc-cone";
import type { RunResult } from "@/features/backtest/shared/run-result";
import { WalkForwardCurve } from "./walkforward-curve";

/**
 * Robustness / walk-forward tab (BT-11) — the HONESTY rigor layer. Everything
 * here is DESCRIPTIVE (D10): walk-forward IS/OOS split, Monte-Carlo resampling
 * spread, and a deflated-Sharpe overfitting CAUTION. Nothing recommends a trade.
 *
 * All compute is pure + memoised; this tab is lazy-mounted by EvidenceTabs so the
 * resampling only runs when the tab is opened. Reuses the existing Recharts idiom
 * (WalkForwardCurve) and EquityCone — NO new charting dependency.
 */
export function RobustnessTab({ run }: { run: RunResult }) {
  const traded = run.blotter.filter((b) => b.legs.length > 0).length;

  const wf = React.useMemo(() => walkForward(run), [run]);
  const wfCurve = React.useMemo(() => walkForwardCurve(run, wf), [run, wf]);
  const robustness = React.useMemo(() => robustnessFromRun(run), [run]);
  const cone = React.useMemo(() => monteCarloFromRun(run), [run]);
  const coach = React.useMemo(() => {
    const dailyNets = run.blotter.filter((b) => b.legs.length > 0).map((b) => b.net);
    return deflatedSharpe({ dailyNets, annualizedSharpe: run.stats.sharpe });
  }, [run]);

  return (
    <div className="space-y-6" data-testid="bt-robustness-tab">
      {/* ── Walk-forward IS/OOS ─────────────────────────────────────────── */}
      <section data-testid="bt-wf-section">
        <h3 className="mb-1 text-sm font-semibold">Walk-forward (in-sample vs out-of-sample)</h3>
        {wfCurve.length > 0 ? (
          <>
            <p className="mb-2 text-xs leading-5 text-muted" data-testid="bt-wf-summary">
              {wf.summary}
            </p>
            <WalkForwardCurve curve={wfCurve} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-4 rounded-sm"
                  style={{ background: "var(--accent-solid)" }}
                  aria-hidden
                />
                In-sample
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-4 rounded-sm"
                  style={{ background: "var(--profit)" }}
                  aria-hidden
                />
                Out-of-sample
              </span>
            </div>

            {/* Per-window table */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm" data-testid="bt-wf-table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted">
                    <th className="py-1.5 font-normal">Fold</th>
                    <th className="py-1.5 font-normal">IS net</th>
                    <th className="py-1.5 font-normal">OOS net</th>
                    <th className="py-1.5 font-normal">OOS ÷ IS</th>
                    <th className="py-1.5 font-normal">OOS Sharpe</th>
                  </tr>
                </thead>
                <tbody>
                  {wf.windows.map((w) => (
                    <tr key={w.index} className="border-b last:border-0" data-wf-fold={w.index}>
                      <td className="py-1.5 text-muted">
                        {w.index}
                        {w.lowCoverage && (
                          <span className="ml-1 text-[10px] text-warning">low-coverage</span>
                        )}
                      </td>
                      <td className="py-1.5 font-money tabular-nums">
                        {formatINR(w.isNet, { signed: true })}
                      </td>
                      <td
                        className={`py-1.5 font-money tabular-nums ${w.oosNet >= 0 ? "text-profit" : "text-loss"}`}
                      >
                        {formatINR(w.oosNet, { signed: true })}
                      </td>
                      <td className="py-1.5 tabular-nums text-muted">
                        {w.oosToIsNetRatio === null
                          ? "—"
                          : `${Math.round(w.oosToIsNetRatio * 100)}%`}
                      </td>
                      <td className="py-1.5 tabular-nums text-muted">
                        {formatNumber(w.oosMetrics.sharpe, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <HonestNote testid="bt-wf-lowsample">
            Not enough trade-days ({traded}) to form a meaningful in-sample / out-of-sample split.
            We show nothing rather than a misleading split.
          </HonestNote>
        )}
      </section>

      {/* ── Monte-Carlo robustness ──────────────────────────────────────── */}
      <section data-testid="bt-mc-section">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <TrendingDown className="h-4 w-4 text-muted" aria-hidden />
          How much could be luck? (Monte-Carlo)
        </h3>
        {robustness && cone ? (
          <>
            <p className="mb-2 text-xs leading-5 text-muted" data-testid="bt-mc-summary">
              {robustness.summary}
            </p>
            <EquityCone cone={cone.sim.cone} startEquity={cone.sim.meta.startEquityR} />
            <dl
              className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"
              data-testid="bt-mc-distribution"
            >
              <OutcomeTile
                label="Terminal P&L · 5th pct"
                value={fmtUnit(robustness.terminalPnl.p5, robustness.unit)}
                tone={robustness.terminalPnl.p5 >= 0 ? "profit" : "loss"}
              />
              <OutcomeTile
                label="Terminal P&L · median"
                value={fmtUnit(robustness.terminalPnl.p50, robustness.unit)}
                tone={robustness.terminalPnl.p50 >= 0 ? "profit" : "loss"}
              />
              <OutcomeTile
                label="Terminal P&L · 95th pct"
                value={fmtUnit(robustness.terminalPnl.p95, robustness.unit)}
                tone="profit"
              />
              <OutcomeTile
                label="Max drawdown · 95th pct"
                value={fmtUnit(robustness.maxDrawdown.p95, robustness.unit)}
                tone="loss"
              />
            </dl>
            <p className="mt-2 text-[11px] text-muted">
              {Math.round(robustness.probNetPositive * 100)}% of resampled paths finished
              net-positive
              {robustness.basis === "R"
                ? ` · risk of ruin ${Math.round(robustness.riskOfRuin * 100)}%`
                : ""}
              . Order-shuffle 95th-pct max drawdown{" "}
              <span className="font-money text-loss">
                {fmtUnit(robustness.shuffleMaxDrawdown.p95, robustness.unit)}
              </span>
              .
            </p>
          </>
        ) : (
          <HonestNote testid="bt-mc-lowsample">
            Need {MIN_TRADES}+ trade-days to resample meaningfully ({traded} so far). Too few trades
            to be meaningful — we hide the distribution rather than show a misleading one.
          </HonestNote>
        )}
      </section>

      {/* ── Overfitting coach (deflated Sharpe) ─────────────────────────── */}
      <section data-testid="bt-coach-section">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <ShieldQuestion className="h-4 w-4 text-muted" aria-hidden />
          Overfitting check (deflated Sharpe)
        </h3>
        <div
          className={`rounded-lg border p-3 text-xs leading-5 ${
            coach.caution === "elevated"
              ? "border-warning/40 bg-warning/5 text-warning"
              : "border-border bg-surface-2/40 text-muted"
          }`}
          data-testid="bt-coach-card"
          data-caution={coach.caution}
        >
          <p>{coach.message}</p>
          {coach.dsr !== null && (
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
              <span>
                <dt className="inline text-muted">Sharpe:</dt>{" "}
                <dd className="inline font-medium">{formatNumber(coach.annualizedSharpe, 2)}</dd>
              </span>
              <span>
                <dt className="inline text-muted">PSR:</dt>{" "}
                <dd className="inline font-medium">{Math.round((coach.psr ?? 0) * 100)}%</dd>
              </span>
              <span>
                <dt className="inline text-muted">Deflated SR:</dt>{" "}
                <dd className="inline font-medium">{Math.round((coach.dsr ?? 0) * 100)}%</dd>
              </span>
              <span>
                <dt className="inline text-muted">Sample:</dt>{" "}
                <dd className="inline font-medium">{coach.sampleSize} trade-days</dd>
              </span>
            </dl>
          )}
          <p className="mt-2 text-[10px] text-muted">
            Concept: Probabilistic &amp; Deflated Sharpe Ratio (Bailey &amp; López de Prado, 2014).
            This is an educational caution, not a recommendation.
          </p>
        </div>
      </section>
    </div>
  );
}

function OutcomeTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "profit" | "loss";
}) {
  return (
    <div className="rounded-lg border bg-surface-2/40 p-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`font-money tabular-nums ${tone === "profit" ? "text-profit" : "text-loss"}`}>
        {value}
      </dd>
    </div>
  );
}

function HonestNote({ children, testid }: { children: React.ReactNode; testid: string }) {
  return (
    <p
      className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-warning"
      data-testid={testid}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/** Format a value in the cone's unit: ₹ (rupees) or R (risk-multiples). */
function fmtUnit(value: number, unit: "₹" | "R"): string {
  if (unit === "R") return `${formatNumber(value, 1)}R`;
  return formatINR(value, { signed: true });
}
