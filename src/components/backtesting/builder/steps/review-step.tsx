"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Pencil, Play, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR, formatNumber } from "@/lib/utils";
import { useBacktestRunner } from "@/components/backtesting/backtest-runner-provider";
import { STATUS_LABEL, isActive } from "@/features/backtest/shared/backtest-status";
import { INDEX_META } from "@/features/backtest/shared/instruments";
import {
  adaptDraftForGoldenRun,
  builderDataPayload,
} from "@/features/backtest/builder/run-adapter";
import type { StrategyDef, WizardStep } from "@/features/backtest/builder/types";
import { SampleResultCard } from "../../../../app/backtesting/sample-result-card";

/**
 * Step 5 — Review & run. Read-only recap of the whole strategy with inline
 * "edit" jumps, an overfitting disclaimer, and the big Run button. Run is
 * anonymous-allowed and drives the LAYOUT-owned worker runner (BT-05). The full
 * BT-07 results UI is the next item — here we surface the RunResult headline
 * inline (the SampleResultCard already renders the real result shape).
 */
export function ReviewStep({
  draft,
  onEdit,
}: {
  draft: StrategyDef;
  onEdit: (step: WizardStep) => void;
}) {
  const { status, result, progress, error, emptyReason, run, cancel } = useBacktestRunner();
  const active = isActive(status);
  const meta = INDEX_META[draft.market.symbol];

  const onRun = () => run(adaptDraftForGoldenRun(draft), builderDataPayload());

  return (
    <div className="space-y-5" data-testid="bt-step-review">
      <header>
        <h2 className="text-lg font-semibold">Review your backtest</h2>
        <p className="mt-1 text-sm text-muted">A final recap, then run it in your browser.</p>
      </header>

      <dl className="divide-y rounded-xl border bg-surface/40 text-sm">
        <Row label="Strategy" onEdit={() => onEdit("legs")}>
          <span className="font-medium">{draft.name}</span> · {meta.label}
        </Row>
        <Row label="Range" onEdit={() => onEdit("setup")}>
          {draft.market.dateRange.start} → {draft.market.dateRange.end} · {draft.market.interval}
        </Row>
        <Row label="Legs" onEdit={() => onEdit("legs")}>
          <ul className="space-y-0.5">
            {draft.legs.map((l) => (
              <li key={l.id}>
                {l.side === "sell" ? "Sell" : "Buy"} {l.lots}× {l.optionType} ·{" "}
                {strikeLabel(l.strike)}
              </li>
            ))}
          </ul>
        </Row>
        <Row label="Timing" onEdit={() => onEdit("timing")}>
          {draft.timing.entryTime} → {draft.timing.exitTime} IST
        </Row>
        <Row label="Risk" onEdit={() => onEdit("risk")}>
          {riskLabel(draft)}
        </Row>
      </dl>

      <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-warning">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Backtests can over-fit. Past results never guarantee future returns. This educational run
        executes your legs against a committed sample window; the full historical data layer is on
        the way.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" onClick={onRun} disabled={active} data-testid="bt-run">
          {active ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Running…
            </>
          ) : (
            <>
              <Play aria-hidden /> Run backtest
            </>
          )}
        </Button>
        {active && (
          <Button type="button" variant="outline" onClick={cancel} data-testid="bt-cancel">
            <Square aria-hidden /> Cancel
          </Button>
        )}
        <span
          className="text-sm tabular-nums text-muted"
          data-testid="bt-status"
          data-status={status}
          role="status"
          aria-live="polite"
        >
          {STATUS_LABEL[status]}
          {active && progress ? ` · ${Math.round(progress.fraction * 100)}%` : ""}
        </span>
      </div>

      {status === "error" && (
        <p className="flex items-center gap-2 text-sm text-loss" data-testid="bt-error">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error ?? "The backtest failed to run."}
        </p>
      )}
      {status === "empty" && (
        <p className="text-sm text-muted" data-testid="bt-empty">
          {emptyReason ?? "No tradeable days in this range."}
        </p>
      )}
      {status === "done" && result && (
        <div data-testid="bt-result">
          <SampleResultCard run={result} />
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3.5 py-2.5">
      <div className="flex-1">
        <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
        <dd className="mt-0.5">{children}</dd>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        aria-label={`Edit ${label}`}
      >
        <Pencil className="h-3 w-3" aria-hidden />
        Edit
      </button>
    </div>
  );
}

function strikeLabel(s: StrategyDef["legs"][number]["strike"]): string {
  switch (s.mode) {
    case "ATM_OFFSET":
      return s.steps === 0 ? "ATM" : `ATM ${s.steps > 0 ? "+" : ""}${s.steps}`;
    case "PERCENT":
      return `${s.pct > 0 ? "+" : ""}${s.pct}%`;
    case "PREMIUM":
      return `premium ≈ ${formatINR(s.target, { decimals: true })}`;
    case "EXACT":
      return `${formatNumber(s.strike, 0)} exact`;
  }
}

function riskLabel(draft: StrategyDef): string {
  const parts: string[] = [];
  const sl = draft.risk.stopLoss;
  const tgt = draft.risk.target;
  if (sl) parts.push(`SL ${sl.unit === "pct" ? `${sl.value}%` : formatINR(sl.value)}`);
  if (tgt) parts.push(`Target ${tgt.unit === "pct" ? `${tgt.value}%` : formatINR(tgt.value)}`);
  const perLeg = draft.legs.filter((l) => l.stopLoss || l.target).length;
  if (perLeg) parts.push(`${perLeg} per-leg rule${perLeg === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "No stops set — square-off at exit time only";
}
