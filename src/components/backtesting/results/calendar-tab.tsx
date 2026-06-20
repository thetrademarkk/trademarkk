"use client";

import * as React from "react";
import { formatINR } from "@/lib/utils";
import { buildCalendarBuckets } from "@/features/backtest/results/calendar-buckets";
import type { RunResult } from "@/features/backtest/shared/run-result";

/**
 * Calendar tab — India-specific edge: per-weekday P&L and the expiry-day vs
 * non-expiry-day split (Thursday/Tuesday expiry effects matter for index-options
 * sellers). Each bar/row shows `n` so a low-sample bucket is visibly flagged.
 */
export function CalendarTab({ run }: { run: RunResult }) {
  const buckets = React.useMemo(() => buildCalendarBuckets(run), [run]);
  const maxAbs = Math.max(1, ...buckets.weekdays.map((w) => Math.abs(w.net)));

  return (
    <div className="grid gap-6 md:grid-cols-2" data-testid="bt-calendar-tab">
      <section className="bt-boot bt-boot-1">
        <h3 className="bt-display mb-2 text-sm font-semibold">P&L by weekday</h3>
        <div className="space-y-1.5">
          {buckets.weekdays.map((w) => {
            const frac = Math.abs(w.net) / maxAbs;
            return (
              <div key={w.weekday} className="flex items-center gap-2 text-xs">
                <span className="bt-label w-9 normal-case tracking-normal">{w.label}</span>
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-surface-2">
                  <div
                    className={
                      w.net >= 0
                        ? "absolute inset-y-0 left-0 bg-profit/40"
                        : "absolute inset-y-0 left-0 bg-loss/40"
                    }
                    style={{ width: `${Math.round(frac * 100)}%` }}
                    aria-hidden
                  />
                </div>
                <span className="w-24 text-right font-money tabular-nums">
                  {formatINR(w.net, { signed: true })}
                </span>
                <span className="w-8 text-right font-money tabular-nums text-muted">n={w.n}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bt-boot bt-boot-2">
        <h3 className="bt-display mb-2 text-sm font-semibold">Expiry vs non-expiry days</h3>
        <div className="grid grid-cols-2 gap-3">
          <SplitCard
            label="Expiry days"
            net={buckets.expirySplit.expiry.net}
            n={buckets.expirySplit.expiry.n}
          />
          <SplitCard
            label="Non-expiry"
            net={buckets.expirySplit.nonExpiry.net}
            n={buckets.expirySplit.nonExpiry.n}
          />
        </div>
        <p className="bt-label mt-2 normal-case leading-5 tracking-normal">
          Split by the strategy&apos;s dominant expiry rule. Low-n buckets are noisy — read the
          counts.
        </p>
      </section>
    </div>
  );
}

function SplitCard({ label, net, n }: { label: string; net: number; n: number }) {
  return (
    <div className="bt-panel p-3">
      <div className="bt-label">{label}</div>
      <div
        className={`bt-num mt-1.5 text-lg tabular-nums ${net > 0 ? "text-profit" : net < 0 ? "text-loss" : "text-foreground"}`}
      >
        {formatINR(net, { signed: true })}
      </div>
      <div className="mt-1 font-money text-xs tabular-nums text-muted">n={n}</div>
    </div>
  );
}
