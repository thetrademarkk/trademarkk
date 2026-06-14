"use client";

import * as React from "react";
import { Info, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSymbolSentiment } from "../api";

/**
 * Per-symbol community sentiment gauge — the bull/bear split among recent posts
 * that tagged the symbol AND set a lean. Explicitly NOT a buy/sell signal: it
 * shows counts + a not-advice disclaimer, and withholds itself below a minimum
 * sample ("not enough signal"). Lucide icons, no emoji, 360px-clean.
 */
export function SentimentGauge({ symbol }: { symbol: string }) {
  const [window, setWindow] = React.useState<"24h" | "7d">("24h");
  const { data, isLoading } = useSymbolSentiment(symbol, window);
  const gauge = data?.gauge;

  const windows: { id: "24h" | "7d"; label: string }[] = [
    { id: "24h", label: "24h" },
    { id: "7d", label: "7d" },
  ];

  return (
    <section
      data-testid="sentiment-gauge"
      aria-label={`Community sentiment for ${symbol}`}
      className="mt-4 rounded-xl border bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Community sentiment</h2>
        <div role="tablist" aria-label="Sentiment window" className="flex items-center gap-1">
          {windows.map((w) => (
            <button
              key={w.id}
              role="tab"
              aria-selected={window === w.id}
              onClick={() => setWindow(w.id)}
              className={cn(
                "rounded-md px-2 py-0.5 text-xs transition-colors",
                window === w.id
                  ? "bg-accent/12 font-medium text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && !gauge ? (
        <p className="mt-3 text-xs text-muted">Loading…</p>
      ) : gauge && gauge.hasSignal ? (
        <div className="mt-3">
          {/* Bull/bear split bar — proportional, profit/loss-tinted. */}
          <div
            className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
            role="img"
            aria-label={`${gauge.bullPct}% bullish, ${gauge.bearPct}% bearish among ${gauge.total} posts`}
          >
            <div className="h-full bg-profit" style={{ width: `${gauge.bullPct}%` }} />
            <div className="h-full bg-loss" style={{ width: `${gauge.bearPct}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-profit">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              <span className="font-money">{gauge.bullPct}%</span> Bullish
              <span className="text-muted">({gauge.bull})</span>
            </span>
            <span className="inline-flex items-center gap-1 font-medium text-loss">
              <span className="text-muted">({gauge.bear})</span> Bearish{" "}
              <span className="font-money">{gauge.bearPct}%</span>
              <TrendingDown className="h-3.5 w-3.5" aria-hidden />
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            From <span className="font-money">{gauge.total}</span>{" "}
            {gauge.total === 1 ? "post" : "posts"} that tagged ${symbol} in the last{" "}
            {window === "24h" ? "24 hours" : "7 days"}.
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">
          Not enough signal yet — sentiment appears once a few traders share a lean on ${symbol}.
        </p>
      )}

      <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-[11px] leading-4 text-muted">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
        <span data-not-advice>
          Community sentiment from posts — NOT advice or a recommendation. It reflects what traders
          are saying about ${symbol}, not a buy/sell call.
        </span>
      </p>
    </section>
  );
}
