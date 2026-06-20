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
      <header className="bt-boot bt-boot-1">
        <p className="bt-label text-accent">
          <span className="bt-prompt">timing</span>
        </p>
        <h2 className="bt-display mt-1 text-lg font-semibold">
          When do you <span className="bt-glow-text">enter</span> and exit?
        </h2>
        <p className="mt-1 text-sm text-muted">Fixed-time intraday entry and square-off (IST).</p>
      </header>

      <fieldset className="bt-boot bt-boot-2">
        <legend className="bt-label">Entry</legend>
        <div className="mt-2 inline-flex rounded-lg border bg-surface-2 p-0.5">
          <span className="rounded-md bg-surface px-3 py-1 font-mono text-sm font-medium uppercase tracking-wide text-accent shadow">
            Fixed time
          </span>
          <span className="px-3 py-1 font-mono text-sm uppercase tracking-wide text-muted">
            Indicator · soon
          </span>
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-muted">Enter at</span>
          <Input
            type="time"
            value={entryTime}
            onChange={(e) => setTiming({ entryTime: e.target.value })}
            className="w-32 font-money"
            data-testid="bt-entry-time"
          />
          <span className="bt-label">IST · first candle after open</span>
        </label>
      </fieldset>

      <fieldset className="bt-boot bt-boot-3">
        <legend className="bt-label">Exit</legend>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-muted">Square off at</span>
          <Input
            type="time"
            value={exitTime}
            onChange={(e) => setTiming({ exitTime: e.target.value })}
            className="w-32 font-money"
            data-testid="bt-exit-time"
          />
          <span className="bt-label">IST</span>
        </label>
      </fieldset>

      <div className="bt-panel bt-boot bt-boot-4">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2.5 font-mono text-sm font-medium uppercase tracking-wide"
          aria-expanded={advanced}
          data-testid="bt-timing-advanced"
        >
          Advanced — when does this strategy run?
          <span className="text-accent">{advanced ? "−" : "+"}</span>
        </button>
        {advanced && (
          <div className="space-y-3 border-t px-3 py-3">
            <div>
              <div className="bt-label">Days of week</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {DAYS.map((d) => (
                  <button
                    key={d.n}
                    type="button"
                    onClick={() => toggleDay(d.n)}
                    aria-pressed={selectedDays.includes(d.n)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 font-mono text-xs uppercase tracking-wide transition-colors",
                      selectedDays.includes(d.n)
                        ? "border-accent bg-accent/10 text-accent"
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

      <p className="text-[11px] text-muted bt-boot bt-boot-5">
        Timing affects realized P&amp;L in the result, not the at-expiry payoff diagram.
      </p>
    </div>
  );
}
