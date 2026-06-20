"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STEP_LABEL,
  WIZARD_STEPS,
  stepIndex,
  type WizardStep,
} from "@/features/backtest/builder/types";

export interface StepperProps {
  current: WizardStep;
  /** Steps that have passed validation (so a future node is reachable). */
  reachable: (step: WizardStep) => boolean;
  onJump: (step: WizardStep) => void;
}

/**
 * The wizard stepper — 5 nodes (Setup · Legs · Timing · Risk · Review).
 * Completed nodes (before current) jump back losslessly; future nodes are
 * disabled until reachable. Desktop = labelled dots + track; mobile collapses to
 * "n / 5 · Label" + a thin progress bar.
 */
export function Stepper({ current, reachable, onJump }: StepperProps) {
  const curIdx = stepIndex(current);
  const total = WIZARD_STEPS.length;
  const pct = ((curIdx + 1) / total) * 100;

  return (
    <nav aria-label="Builder steps" data-testid="bt-stepper">
      {/* Desktop: dotted track. */}
      <ol className="hidden items-center gap-1 sm:flex">
        {WIZARD_STEPS.map((step, i) => {
          const done = i < curIdx;
          const isCurrent = i === curIdx;
          const canJump = done || isCurrent || reachable(step);
          return (
            <li key={step} className="flex items-center gap-1">
              <button
                type="button"
                disabled={!canJump}
                onClick={() => canJump && onJump(step)}
                aria-current={isCurrent ? "step" : undefined}
                data-step={step}
                data-state={done ? "done" : isCurrent ? "current" : "future"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  isCurrent && "text-foreground",
                  done && "text-foreground hover:bg-surface-2",
                  !done && !isCurrent && "text-muted",
                  !canJump && "cursor-not-allowed opacity-60"
                )}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-full font-mono text-[10px]",
                    done
                      ? "bg-accent-solid text-accent-fg"
                      : isCurrent
                        ? "border-2 border-accent ring-2 ring-accent"
                        : "border border-border"
                  )}
                >
                  {done ? <Check className="h-2.5 w-2.5" aria-hidden /> : i + 1}
                </span>
                {STEP_LABEL[step]}
              </button>
              {i < total - 1 && (
                <span
                  aria-hidden
                  className={cn("h-px w-4", i < curIdx ? "bg-accent" : "bg-border")}
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* Mobile: crumb + thin progress bar. */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium" data-testid="bt-stepper-mobile">
            {curIdx + 1} / {total} · {STEP_LABEL[current]}
          </span>
        </div>
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent-solid transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </nav>
  );
}
