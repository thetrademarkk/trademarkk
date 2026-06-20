"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  INDEX_META,
  INDEX_SYMBOLS,
  type IndexSymbol,
} from "@/features/backtest/shared/instruments";
import { useBuilderStore } from "@/features/backtest/builder/builder-store";
import { defaultRange } from "@/features/backtest/builder/draft";
import { parseInterval } from "@/lib/backtest/data/interval";
import type { StrategyDef } from "@/features/backtest/builder/types";

const INTERVALS = ["1m", "3m", "5m", "15m"] as const;

const QUICK_RANGES: { label: string; months: number | "max" }[] = [
  { label: "1M", months: 1 },
  { label: "3M", months: 3 },
  { label: "6M", months: 6 },
  { label: "1Y", months: 12 },
  { label: "Max", months: "max" },
];

/**
 * Honest 5-segment coverage signal for the data-confidence panel (presentational
 * only — the live data layer is BT-08). SENSEX is the sparsest, so it reads as a
 * partial/warn bar; the others as near-complete.
 */
const COVERAGE: Record<"full" | "sparse", (string | 0)[]> = {
  full: ["1", "1", "1", "1", "warn"],
  sparse: ["1", "1", "warn", "warn", "bad"],
};

/**
 * Step 1 — Setup. Index (radio cards with lot size + honest coverage hint),
 * candle interval, date range with quick chips. Smart defaults so the very
 * first run is well-covered and never empty. SENSEX is honestly tinted (data
 * starts later, worst coverage) rather than a clean green tick.
 */
export function SetupStep({ draft }: { draft: StrategyDef }) {
  const setIndexSymbol = useBuilderStore((s) => s.setIndexSymbol);
  const setMarket = useBuilderStore((s) => s.setMarket);
  const setDateRange = useBuilderStore((s) => s.setDateRange);

  const { symbol, interval, dateRange } = draft.market;

  const applyQuick = (months: number | "max") => {
    const dataStart = INDEX_META[symbol].dataStart;
    if (months === "max") {
      setDateRange({ start: dataStart, end: new Date().toISOString().slice(0, 10) });
      return;
    }
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - months);
    const startIso = start.toISOString().slice(0, 10);
    setDateRange({
      start: startIso < dataStart ? dataStart : startIso,
      end: end.toISOString().slice(0, 10),
    });
  };

  return (
    <div className="space-y-6" data-testid="bt-step-setup">
      <header className="bt-boot bt-boot-1">
        <p className="bt-label text-accent">
          <span className="bt-prompt">step 01 — setup</span>
        </p>
        <h2 className="bt-display mt-1.5 text-lg font-semibold">
          Set up your <span className="bt-glow-text">backtest</span>
        </h2>
        <p className="mt-1 text-sm text-muted">Pick a market, candle size and date range.</p>
      </header>

      {/* Index */}
      <fieldset className="bt-boot bt-boot-2">
        <legend className="bt-label">Index</legend>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {INDEX_SYMBOLS.map((sym) => {
            const meta = INDEX_META[sym];
            const active = symbol === sym;
            const sensex = sym === "SENSEX";
            return (
              <button
                key={sym}
                type="button"
                onClick={() => setIndexSymbol(sym as IndexSymbol)}
                aria-pressed={active}
                data-index={sym}
                data-active={active || undefined}
                className={cn(
                  "bt-panel bt-ticks p-3 text-left transition-colors",
                  active
                    ? "bt-panel-active"
                    : "hover:border-accent hover:[box-shadow:0_0_28px_-14px_var(--bt-glow)]",
                  sensex && !active && "bg-warning/5"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="bt-display text-sm font-semibold">{meta.label}</span>
                  {active && <span className="h-2 w-2 rounded-full bg-accent-solid" aria-hidden />}
                </div>
                <div className="bt-label mt-1.5">
                  lot <span className="bt-num text-foreground">{meta.lotSize}</span>
                </div>
                <div className={cn("mt-1 text-[11px]", sensex ? "text-warning" : "text-muted")}>
                  {meta.dataStart.slice(0, 4)}–now {sensex ? "" : "✓"}
                </div>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Interval */}
      <fieldset className="bt-boot bt-boot-3">
        <legend className="bt-label">Candle interval</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-surface-2 p-0.5">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => setMarket({ interval: iv })}
                aria-pressed={interval === iv}
                data-interval={iv}
                className={cn(
                  "rounded-md px-3 py-1 text-sm transition-colors",
                  interval === iv
                    ? "bg-surface font-medium shadow"
                    : "text-muted hover:text-foreground"
                )}
              >
                {iv}
              </button>
            ))}
          </div>
          <CustomInterval
            interval={interval}
            isPreset={(INTERVALS as readonly string[]).includes(interval)}
            onCommit={(iv) => setMarket({ interval: iv })}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted">
          1m is most precise; coarser candles run faster but may miss intraday SL/target hits. Type
          any interval — e.g. <span className="font-medium text-foreground">10m</span>,{" "}
          <span className="font-medium text-foreground">30m</span>,{" "}
          <span className="font-medium text-foreground">1h</span> or{" "}
          <span className="font-medium text-foreground">1d</span>.
        </p>
      </fieldset>

      {/* Date range */}
      <fieldset className="bt-boot bt-boot-4">
        <legend className="bt-label">Date range</legend>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="bt-label">From</span>
            <Input
              type="date"
              value={dateRange.start}
              max={dateRange.end}
              min={INDEX_META[symbol].dataStart}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="mt-1 w-40"
              data-testid="bt-date-from"
            />
          </label>
          <label className="text-xs">
            <span className="bt-label">To</span>
            <Input
              type="date"
              value={dateRange.end}
              min={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="mt-1 w-40"
              data-testid="bt-date-to"
            />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {QUICK_RANGES.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => applyQuick(q.months)}
              className="bt-bracket px-1.5 py-1 text-xs"
            >
              {q.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Honest coverage hint (estimate-based — the live data layer is BT-08). */}
      <div className="bt-panel bg-surface/50 p-3 text-xs bt-boot bt-boot-5">
        <div className="flex items-center justify-between gap-3">
          <div className="bt-label text-accent">
            <span className="bt-prompt">data confidence</span>
          </div>
          <span
            className="bt-meter"
            role="img"
            aria-label={symbol === "SENSEX" ? "Coverage: partial" : "Coverage: high"}
          >
            {COVERAGE[symbol === "SENSEX" ? "sparse" : "full"].map((on, i) => (
              <span key={i} className="bt-meter-seg" data-on={on || undefined} />
            ))}
          </span>
        </div>
        <p className="mt-2 leading-5 text-muted">
          {symbol === "SENSEX"
            ? "SENSEX has the sparsest option coverage and starts in 2022 — the honesty layer matters most here. Far strikes may snap to the nearest liquid one."
            : "Index spot is complete; most ATM±5 strikes are present. Thin far strikes snap to the nearest liquid strike, flagged in the result."}
        </p>
      </div>

      <p className="text-[11px] text-muted bt-boot bt-boot-6">
        Defaults to the last 3 months of {INDEX_META[symbol].label}, clamped to{" "}
        <span className="font-money text-foreground">{defaultRange(symbol).start}</span> so the
        first run is well-covered.
      </p>
    </div>
  );
}

/**
 * Free-form interval input — type ANY timeframe (e.g. "10m", "30m", "1h", "1d")
 * and it commits on a valid token (validated by the resampler's parseInterval, the
 * single source of truth). Invalid input shows a red ring and is not committed.
 * Highlighted (accent) when the active interval is a custom value, not a preset.
 */
function CustomInterval({
  interval,
  isPreset,
  onCommit,
}: {
  interval: string;
  isPreset: boolean;
  onCommit: (interval: string) => void;
}) {
  // Seed from the current interval when it's a custom value (so it round-trips).
  const [text, setText] = React.useState(isPreset ? "" : interval);
  const parsed = parseInterval(text.trim());
  const valid = text.trim().length > 0 && parsed.valid;

  const commit = () => {
    if (valid) onCommit(text.trim());
  };

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span>Custom</span>
      <Input
        type="text"
        inputMode="text"
        value={text}
        placeholder="30m"
        aria-label="Custom candle interval"
        data-testid="bt-interval-custom"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        className={cn(
          "h-8 w-20",
          text.trim().length > 0 && !valid && "border-loss focus-visible:ring-loss",
          !isPreset && interval === text.trim() && valid && "border-accent"
        )}
      />
    </label>
  );
}
