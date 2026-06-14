"use client";

import * as React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { SENTIMENTS, type Sentiment } from "../sentiment";

const ICONS = { TrendingUp, TrendingDown } as const;

/**
 * Optional Bullish/Bearish sentiment toggle for the composer & edit form.
 *
 * It is meaningful only when the post mentions at least one $cashtag, so the
 * caller passes `disabled` (no ticker yet) — the control then renders a quiet
 * hint instead of active buttons. Clicking the active lean again clears it
 * (back to no sentiment). This is explicitly NOT a buy/sell call — the label
 * makes that clear and the per-symbol gauge it feeds carries a disclaimer.
 */
export function SentimentToggle({
  value,
  onChange,
  disabled = false,
  idPrefix = "sentiment",
}: {
  value: Sentiment | null;
  onChange: (next: Sentiment | null) => void;
  /** True when the post has no $cashtag yet — sentiment isn't applicable. */
  disabled?: boolean;
  idPrefix?: string;
}) {
  return (
    <fieldset disabled={disabled} className={cn(disabled && "opacity-60")}>
      <legend className="micro-label mb-1.5">Sentiment (optional)</legend>
      <div
        role="group"
        aria-label="Optional bullish or bearish lean on the tickers in this post"
        className="flex flex-wrap items-center gap-1.5"
      >
        {SENTIMENTS.map((s) => {
          const active = value === s;
          const Icon = s === "bull" ? ICONS.TrendingUp : ICONS.TrendingDown;
          const label = s === "bull" ? "Bullish" : "Bearish";
          return (
            <button
              key={s}
              type="button"
              id={`${idPrefix}-${s}`}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onChange(active ? null : s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                active
                  ? s === "bull"
                    ? "border-profit/50 bg-profit/10 text-profit"
                    : "border-loss/50 bg-loss/10 text-loss"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted">
        {disabled
          ? "Mention a $ticker to share an optional bullish/bearish lean."
          : "Optional — your lean on the tickers above. Not advice or a recommendation."}
      </p>
    </fieldset>
  );
}

/**
 * Compact bull/bear chip for a post card that carries a sentiment. Renders
 * nothing when there's no lean. Read-only, lucide icons, no emoji.
 */
export function SentimentChip({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) return null;
  const Icon = sentiment === "bull" ? TrendingUp : TrendingDown;
  const label = sentiment === "bull" ? "Bullish" : "Bearish";
  return (
    <span
      data-sentiment={sentiment}
      title="The author's optional lean — not advice"
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        sentiment === "bull" ? "bg-profit/10 text-profit" : "bg-loss/10 text-loss"
      )}
    >
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}
