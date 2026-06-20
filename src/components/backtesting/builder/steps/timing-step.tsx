"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useBuilderStore } from "@/features/backtest/builder/builder-store";
import type { StrategyDef } from "@/features/backtest/builder/types";

const DAYS = [
  { n: 1, label: "Mon" },
  { n: 2, label: "Tue" },
  { n: 3, label: "Wed" },
  { n: 4, label: "Thu" },
  { n: 5, label: "Fri" },
] as const;

/**
 * Step 3 — Timing. Fixed-time entry/exit (default 09:20 → 15:15 IST), with an
 * "Advanced" disclosure for days-of-week and days-from-expiry filters. Indicator
 * entries are shown as "soon" (architected-for, not built). Entry must precede
 * exit (gated by the wizard).
 */
export function TimingStep({ draft }: { draft: StrategyDef }) {
  const setTiming = useBuilderStore((s) => s.setTiming);
  const { entryTime, exitTime, daysOfWeek } = draft.timing;
  const [advanced, setAdvanced] = React.useState(
    Boolean(daysOfWeek?.length || draft.timing.daysFromExpiry?.length)
  );

  const selectedDays = daysOfWeek ?? [1, 2, 3, 4, 5];
  const toggleDay = (n: number) => {
    const next = selectedDays.includes(n)
      ? selectedDays.filter((d) => d !== n)
      : [...selectedDays, n].sort((a, b) => a - b);
    // All 5 selected → store undefined (means "all weekdays").
    setTiming({ daysOfWeek: next.length === 5 ? undefined : next });
  };

  return (
    <div className="space-y-6" data-testid="bt-step-timing">
      <header>
        <h2 className="text-lg font-semibold">When do you enter and exit?</h2>
        <p className="mt-1 text-sm text-muted">Fixed-time intraday entry and square-off (IST).</p>
      </header>

      <fieldset>
        <legend className="micro-label">Entry</legend>
        <div className="mt-2 inline-flex rounded-lg border bg-surface-2 p-0.5">
          <span className="rounded-md bg-surface px-3 py-1 text-sm font-medium shadow">
            Fixed time
          </span>
          <span className="px-3 py-1 text-sm text-muted">Indicator · soon</span>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-muted">Enter at</span>
          <Input
            type="time"
            value={entryTime}
            onChange={(e) => setTiming({ entryTime: e.target.value })}
            className="w-32"
            data-testid="bt-entry-time"
          />
          <span className="text-[11px] text-muted">IST · first candle after open</span>
        </label>
      </fieldset>

      <fieldset>
        <legend className="micro-label">Exit</legend>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-muted">Square off at</span>
          <Input
            type="time"
            value={exitTime}
            onChange={(e) => setTiming({ exitTime: e.target.value })}
            className="w-32"
            data-testid="bt-exit-time"
          />
          <span className="text-[11px] text-muted">IST</span>
        </label>
      </fieldset>

      <div className="rounded-xl border bg-surface/40">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium"
          aria-expanded={advanced}
          data-testid="bt-timing-advanced"
        >
          Advanced — when does this strategy run?
          <span className="text-muted">{advanced ? "−" : "+"}</span>
        </button>
        {advanced && (
          <div className="space-y-3 border-t px-3 py-3">
            <div>
              <div className="text-[11px] text-muted">Days of week</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {DAYS.map((d) => (
                  <button
                    key={d.n}
                    type="button"
                    onClick={() => toggleDay(d.n)}
                    aria-pressed={selectedDays.includes(d.n)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs transition-colors",
                      selectedDays.includes(d.n)
                        ? "border-accent bg-accent/10 text-foreground"
                        : "text-muted hover:border-accent"
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted">
        Timing affects realized P&amp;L in the result, not the at-expiry payoff diagram.
      </p>
    </div>
  );
}
