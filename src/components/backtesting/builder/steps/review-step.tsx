"use client";

import * as React from "react";
import { Loader2, Pencil, Play, Square, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR, formatNumber } from "@/lib/utils";
import { useBacktestRunner } from "@/components/backtesting/backtest-runner-provider";
import { STATUS_LABEL, isActive } from "@/features/backtest/shared/backtest-status";
import { INDEX_META } from "@/features/backtest/shared/instruments";
import { builderHfPayload } from "@/features/backtest/builder/run-adapter";
import type { StrategyDef, WizardStep } from "@/features/backtest/builder/types";
import { ResultsView } from "@/components/backtesting/results/results-view";

/**
 * Step 5 — Review & run. Read-only recap of the whole strategy with inline
 * "edit" jumps, an overfitting disclaimer, and the big Run button. Run is
 * anonymous-allowed and drives the LAYOUT-owned worker runner (BT-05). Once a run
 * is started the full BT-07 ResultsView renders inline (verdict → evidence →
 * drill-down, with the 5 run states), and "Change one thing" jumps back to the
 * Legs step so the next run is compared against this one (per-stat deltas).
 */
export function ReviewStep({
  draft,
  onEdit,
  autoRun = false,
  onAutoRunConsumed,
}: {
  draft: StrategyDef;
  onEdit: (step: WizardStep) => void;
  /** Kick off a run once on mount (preset card "Run" deep link). */
  autoRun?: boolean;
  onAutoRunConsumed?: () => void;
}) {
  const { status, result, progress, error, emptyReason, run, cancel } = useBacktestRunner();
  const active = isActive(status);
  const meta = INDEX_META[draft.market.symbol];

  // LIVE run: the user's EXACT strategy (symbol / interval / date range,
  // unchanged) against the real HuggingFace 1-minute dataset via the worker's
  // duckdb-wasm data layer. Coverage-honesty comes from the run RESULT's
  // coverageReport (per-leg served-strike coverage + confidence), so no fixture
  // snapshot is needed; an empty window resolves to an honest `empty` state.
  const payload = React.useMemo(() => builderHfPayload(), []);
  const ranStrategy = draft; // run exactly what the user built — no clamp
  const onRun = React.useCallback(() => run(ranStrategy, payload), [run, ranStrategy, payload]);

  // Auto-run once for a preset "Run" deep link (the data-backed presets execute
  // immediately; the honest-locked ones never reach here — their card Run is
  // disabled). Guarded so it fires exactly once.
  const autoRan = React.useRef(false);
  React.useEffect(() => {
    if (autoRun && !autoRan.current) {
      autoRan.current = true;
      onRun();
      onAutoRunConsumed?.();
    }
  }, [autoRun, onRun, onAutoRunConsumed]);

  return (
    <div className="space-y-5" data-testid="bt-step-review">
      <header className="bt-boot bt-boot-1">
        <p className="bt-label text-accent">
          <span className="bt-prompt">review &amp; run</span>
        </p>
        <h2 className="bt-display mt-1 text-lg font-semibold">
          Review your <span className="bt-glow-text">backtest</span>
        </h2>
        <p className="mt-1 text-sm text-muted">A final recap, then run it in your browser.</p>
      </header>

      {/* Terminal "ticket summary" — the whole strategy on one bracketed panel. */}
      <dl className="bt-panel bt-ticks divide-y text-sm bt-boot bt-boot-2">
        <Row label="Strategy" onEdit={() => onEdit("legs")}>
          <span className="font-medium">{draft.name}</span> · {meta.label}
        </Row>
        <Row label="Range" onEdit={() => onEdit("setup")}>
          <span className="font-money">{draft.market.dateRange.start}</span> →{" "}
          <span className="font-money">{draft.market.dateRange.end}</span> · {draft.market.interval}
        </Row>
        <Row label="Legs" onEdit={() => onEdit("legs")}>
          <ul className="space-y-0.5">
            {draft.legs.map((l) => (
              <li key={l.id}>
                {l.side === "sell" ? "Sell" : "Buy"} <span className="font-money">{l.lots}×</span>{" "}
                {l.optionType} · {strikeLabel(l.strike)}
              </li>
            ))}
          </ul>
        </Row>
        <Row label="Timing" onEdit={() => onEdit("timing")}>
          <span className="font-money">{draft.timing.entryTime}</span> →{" "}
          <span className="font-money">{draft.timing.exitTime}</span> IST
        </Row>
        <Row label="Risk" onEdit={() => onEdit("risk")}>
          {riskLabel(draft)}
        </Row>
      </dl>

      <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-5 text-warning bt-boot bt-boot-3">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Backtests can over-fit. Past results never guarantee future returns. This educational run
        executes your legs against live 1-minute market data, with honest coverage shown on every
        result.
      </p>

      <div className="bt-boot bt-boot-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="lg"
            onClick={onRun}
            disabled={active}
            data-testid="bt-run"
            className="font-mono uppercase tracking-wide"
          >
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
            <Button
              type="button"
              variant="outline"
              onClick={cancel}
              data-testid="bt-cancel"
              className="font-mono uppercase tracking-wide"
            >
              <Square aria-hidden /> Cancel
            </Button>
          )}
          <span
            className="text-sm text-muted"
            data-testid="bt-status"
            data-status={status}
            role="status"
            aria-live="polite"
          >
            <span className="bt-label">{STATUS_LABEL[status]}</span>
            {active && progress ? (
              <span className="bt-num ml-1.5 text-accent">
                {Math.round(progress.fraction * 100)}%
              </span>
            ) : (
              ""
            )}
          </span>
        </div>
        {/* Progress rail — amber scanline sweep while the run is in flight. */}
        {active && (
          <div
            className="bt-scanline mt-3 h-0.5 overflow-hidden rounded-full bg-surface-2"
            aria-hidden
          >
            <div
              className="h-full bg-accent transition-[width] duration-300"
              style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {/* The full BT-07 results UI (verdict → evidence → drill-down) renders once
          a run has been started. "Change one thing" jumps back to Legs (ghosting
          the prev run via the per-stat deltas); Re-run replays the same draft. */}
      {status !== "idle" && (
        <div data-testid="bt-result" className="pt-1">
          {/* Coverage honesty is rendered inside ResultsView from the run
              result's own coverageReport (per-leg served-strike coverage +
              confidence) — see run-result.ts. */}
          <ResultsView
            status={status}
            result={result}
            progress={progress}
            error={error}
            emptyReason={emptyReason}
            strategy={ranStrategy}
            onEdit={() => onEdit("legs")}
            onReRun={onRun}
          />
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
        <dt className="bt-label">{label}</dt>
        <dd className="mt-0.5">{children}</dd>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="bt-bracket inline-flex items-center gap-1 text-xs"
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
