"use client";

import * as React from "react";
import { Play, Square, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBacktestRunner } from "@/components/backtesting/backtest-runner-provider";
import { STATUS_LABEL, isActive } from "@/features/backtest/shared/backtest-status";
import { makeSampleStrategy, makeSampleDataPayload } from "./sample-backtest";
import { SampleResultCard } from "../sample-result-card";

/**
 * "Run sample backtest" — the minimal BT-05 proof that the worker runs the
 * BT-04 engine end-to-end in the browser. Feeds the committed golden NIFTY slice
 * + a 9:20 short straddle through the layout-owned `useBacktest` runner, shows
 * the live status transitions, then renders the real headline stats via the
 * shared SampleResultCard. The full builder is BT-06; this is intentionally tiny.
 */
export function SampleBacktestRunner() {
  const { status, result, progress, error, emptyReason, run, cancel } = useBacktestRunner();
  const active = isActive(status);

  const onRun = () => run(makeSampleStrategy(), makeSampleDataPayload());

  return (
    <section className="mt-12 rounded-2xl border bg-surface/50 p-5" data-testid="bt-sample-runner">
      <h2 className="text-lg font-semibold">Run a sample backtest in your browser</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
        Runs a NIFTY 9:20 short straddle over a real two-day window entirely on your machine — the
        engine executes in a Web Worker so the page never freezes. This proves the run pipeline; the
        full no-code builder and results screen are on the way.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={onRun} disabled={active} data-testid="bt-run-sample">
          {active ? (
            <>
              <Loader2 className="animate-spin" aria-hidden /> Running…
            </>
          ) : (
            <>
              <Play aria-hidden /> Run sample backtest
            </>
          )}
        </Button>
        {active && (
          <Button type="button" variant="outline" onClick={cancel} data-testid="bt-cancel">
            <Square aria-hidden /> Cancel
          </Button>
        )}
        {/* Live, descriptive status counter (no spinner-only). */}
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
        <p className="mt-4 flex items-center gap-2 text-sm text-loss" data-testid="bt-error">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          {error ?? "The backtest failed to run."}
        </p>
      )}

      {status === "empty" && (
        <p className="mt-4 text-sm text-muted" data-testid="bt-empty">
          {emptyReason ?? "No tradeable days in this range."}
        </p>
      )}

      {status === "done" && result && (
        <div className="mt-5" data-testid="bt-result">
          <SampleResultCard run={result} />
        </div>
      )}
    </section>
  );
}
