"use client";

import * as React from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info, TriangleAlert } from "lucide-react";
import { cn, formatINR } from "@/lib/utils";
import type {
  DisciplineMetric,
  Divergence,
  JournalCompare,
} from "@/features/backtest/journal-compare/compare";
import { CompareOverlayChart } from "./compare-overlay-chart";

const INDEX_LABEL: Record<string, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "BANK NIFTY",
  SENSEX: "SENSEX",
};

function fmtMetric(m: DisciplineMetric, which: "real" | "baseline" | "delta"): string {
  const v = m[which];
  const signed = which === "delta";
  switch (m.unit) {
    case "rupees":
      return formatINR(v, { decimals: true, signed });
    case "pct":
      return `${signed && v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
    case "minutes": {
      const sign = signed && v >= 0 ? "+" : "";
      const abs = Math.abs(v);
      const h = Math.floor(abs / 60);
      const mm = Math.round(abs % 60);
      const body = h > 0 ? `${h}h ${mm}m` : `${mm}m`;
      return `${sign}${v < 0 ? "-" : ""}${body}`;
    }
    case "count":
      return `${signed && v >= 0 ? "+" : ""}${v}`;
    case "ratio":
      return `${signed && v >= 0 ? "+" : ""}${v >= 9999 ? "∞" : v.toFixed(2)}`;
  }
}

/** Direction icon for a delta — purely directional, NOT "better/worse". */
function DeltaArrow({ delta }: { delta: number }) {
  if (delta > 0) return <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />;
  if (delta < 0) return <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />;
  return <ArrowRight className="h-3.5 w-3.5" aria-hidden />;
}

/**
 * The descriptive journal-compare result. Renders the honest framing banner, the
 * two-color equity overlay, the discipline-metrics table (real vs baseline +
 * descriptive delta), and the divergences list. Every label frames this as a
 * MIRROR for self-review — never a verdict on skill.
 */
export function JournalCompareView({ compare }: { compare: JournalCompare }) {
  return (
    <div className="space-y-5" data-testid="bt-compare-result">
      {/* Honest framing — always first, never optional. */}
      <div className="flex items-start gap-2 rounded-lg border bg-surface-2/40 p-3 text-xs leading-5 text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <span>
          This is a <strong className="font-medium text-foreground">mirror for self-review</strong>,
          not a verdict. The mechanical baseline is one rules-only version of the idea at a point in
          time — not &ldquo;the right answer&rdquo;. It shows <em>where</em> your real{" "}
          {INDEX_LABEL[compare.index] ?? compare.index} trading diverged from that baseline, so you
          can ask your own questions.
        </span>
      </div>

      {/* Coverage / sample caveats. */}
      {(compare.lowSample || compare.outOfRangeTrades > 0) && (
        <div
          className="flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-warning"
          data-testid="bt-compare-caveats"
        >
          {compare.lowSample && (
            <span data-testid="bt-compare-lowsample">
              <TriangleAlert className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
              Small sample ({compare.sampleTrades} comparable trade
              {compare.sampleTrades === 1 ? "" : "s"}) — read this as indicative, not conclusive.
            </span>
          )}
          {compare.outOfRangeTrades > 0 && (
            <span data-testid="bt-compare-outofrange">
              {compare.outOfRangeTrades} of your {INDEX_LABEL[compare.index] ?? compare.index} trade
              {compare.outOfRangeTrades === 1 ? "" : "s"} fell outside the baseline&rsquo;s date
              range and are not included in this comparison.
            </span>
          )}
        </div>
      )}

      {/* Equity overlay. */}
      <section className="rounded-2xl border bg-surface p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Cumulative P&amp;L — you vs the baseline</h3>
          <span className="text-xs text-muted">
            {compare.period.from} → {compare.period.to}
          </span>
        </div>
        <div className="mb-2 flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-[var(--accent-solid)]" aria-hidden />
            Your trading
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-0 w-4 border-t-2 border-dashed border-[var(--text-muted)]"
              aria-hidden
            />
            Mechanical baseline
          </span>
        </div>
        <CompareOverlayChart overlay={compare.overlay} />
      </section>

      {/* Discipline / edge metrics. */}
      <section className="rounded-2xl border bg-surface p-4" data-testid="bt-compare-metrics">
        <h3 className="mb-3 text-sm font-semibold">Where your trading and the baseline differ</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Metric</th>
                <th className="py-2 pr-3 text-right font-medium">You</th>
                <th className="py-2 pr-3 text-right font-medium">Baseline</th>
                <th className="py-2 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              {compare.metrics.map((m) => (
                <tr key={m.key} className="border-b last:border-0" data-metric={m.key}>
                  <td className="py-2 pr-3">{m.label}</td>
                  <td className="py-2 pr-3 text-right font-money tabular-nums">
                    {fmtMetric(m, "real")}
                  </td>
                  <td className="py-2 pr-3 text-right font-money tabular-nums text-muted">
                    {fmtMetric(m, "baseline")}
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right font-money tabular-nums",
                      m.delta > 0 ? "text-profit" : m.delta < 0 ? "text-loss" : "text-muted"
                    )}
                  >
                    <span className="inline-flex items-center justify-end gap-1">
                      <DeltaArrow delta={m.delta} />
                      {fmtMetric(m, "delta")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-muted">
          &ldquo;Difference&rdquo; is your value minus the baseline&rsquo;s — directional only. A
          green/red tint marks the sign, not a judgement.
        </p>
      </section>

      {/* Divergences. */}
      <DivergencesSection compare={compare} />
    </div>
  );
}

function DivergencesSection({ compare }: { compare: JournalCompare }) {
  const d = compare.divergences;
  const hasAny = d.discretionaryDays > 0 || d.skippedSignalDays > 0;

  return (
    <section className="rounded-2xl border bg-surface p-4" data-testid="bt-compare-divergences">
      <h3 className="mb-1 text-sm font-semibold">
        Divergences — days you and the baseline differed
      </h3>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <DivStat
          label="Your discretionary days"
          value={String(d.discretionaryDays)}
          sub={`${formatINR(d.discretionaryNet, { signed: true, decimals: true })} net`}
        />
        <DivStat
          label="Baseline signals you skipped"
          value={String(d.skippedSignalDays)}
          sub={`${formatINR(d.skippedSignalNet, { signed: true, decimals: true })} baseline net`}
        />
        <DivStat label="Days you both traded" value={String(d.overlapDays)} />
      </div>

      {hasAny ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Day</th>
                <th className="py-2 pr-3 font-medium">What happened</th>
                <th className="py-2 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((row) => (
                <DivergenceRow key={`${row.kind}-${row.day}`} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted">
          On every comparable day, you and the mechanical baseline either both traded or both sat
          out — no divergences in this window.
        </p>
      )}
    </section>
  );
}

function DivStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-surface-2/40 p-2.5">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] leading-4 text-muted">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] font-money tabular-nums text-muted">{sub}</div>}
    </div>
  );
}

function DivergenceRow({ row }: { row: Divergence }) {
  const discretionary = row.kind === "discretionary";
  const net = discretionary ? row.realNet : row.baselineNet;
  return (
    <tr className="border-b last:border-0" data-divergence={row.kind}>
      <td className="py-2 pr-3 tabular-nums">
        {new Date(row.day + "T12:00:00").toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })}
      </td>
      <td className="py-2 pr-3 text-muted">
        {discretionary
          ? `You traded (${row.realTradeCount} trade${row.realTradeCount === 1 ? "" : "s"}); the baseline sat out`
          : "The baseline had a signal; you logged no trade"}
      </td>
      <td
        className={cn(
          "py-2 text-right font-money tabular-nums",
          net > 0 ? "text-profit" : net < 0 ? "text-loss" : "text-muted"
        )}
      >
        {formatINR(net, { signed: true, decimals: true })}
      </td>
    </tr>
  );
}
