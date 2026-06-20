"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBuilderStore } from "@/features/backtest/builder/builder-store";
import { makeEstimateChain } from "@/features/backtest/builder/estimate-chain";
import { buildPayoffSummary } from "@/features/backtest/builder/payoff-rail";
import { canAdvance, validateStep } from "@/features/backtest/builder/validation";
import { nextStep, prevStep, type WizardStep } from "@/features/backtest/builder/types";
import { Stepper } from "./stepper";
import { LivePayoffRail } from "./live-payoff-rail";
import { MobilePayoff } from "./mobile-payoff";
import { SetupStep } from "./steps/setup-step";
import { LegsStep } from "./steps/legs-step";
import { TimingStep } from "./steps/timing-step";
import { RiskStep } from "./steps/risk-step";
import { ReviewStep } from "./steps/review-step";

/**
 * The no-code builder SHELL (BT-06). One persistent two-pane layout:
 *   left  = the active wizard step (changes),
 *   right = the ALWAYS-MOUNTED live payoff rail (desktop ≥lg; never unmounts).
 * On mobile the rail collapses to a sticky mini-payoff PEER bar + a vaul sheet.
 *
 * All state lives in the zustand builder store (autosaved to localStorage), so
 * every step is deep-linkable and Back/Continue is lossless. Continue is BLOCKED
 * while the current step is invalid (inline errors shown); a future stepper node
 * is reachable only once its predecessors validate.
 */
export function BuilderShell({
  autoRun = false,
  onAutoRunConsumed,
}: {
  /** When true, the Review step kicks off a run automatically once (preset "Run"). */
  autoRun?: boolean;
  onAutoRunConsumed?: () => void;
} = {}) {
  const draft = useBuilderStore((s) => s.draft);
  const step = useBuilderStore((s) => s.step);
  const setStep = useBuilderStore((s) => s.setStep);
  const savedAt = useBuilderStore((s) => s.savedAt);

  // Show errors only after a blocked Continue (don't punish mid-typing).
  const [showErrors, setShowErrors] = React.useState(false);

  // The live payoff summary — recomputed whenever legs/index change.
  const chain = React.useMemo(() => makeEstimateChain(draft.market.symbol), [draft.market.symbol]);
  const summary = React.useMemo(() => buildPayoffSummary(draft, chain), [draft, chain]);

  const guides = React.useMemo(
    () => ({
      target: draft.risk.target?.unit === "rupees" ? draft.risk.target.value : undefined,
      stopLoss: draft.risk.stopLoss?.unit === "rupees" ? draft.risk.stopLoss.value : undefined,
    }),
    [draft.risk]
  );

  const validation = validateStep(step, draft);
  const reachable = React.useCallback(
    (target: WizardStep) => {
      // A future node is reachable only if every step before it validates.
      const order: WizardStep[] = ["setup", "legs", "timing", "risk", "review"];
      const idx = order.indexOf(target);
      return order.slice(0, idx).every((s) => canAdvance(s, draft));
    },
    [draft]
  );

  const goTo = (target: WizardStep) => {
    setShowErrors(false);
    setStep(target);
  };

  const onContinue = () => {
    if (!validation.ok) {
      setShowErrors(true);
      return;
    }
    const next = nextStep(step);
    if (next) goTo(next);
  };
  const onBack = () => {
    const prev = prevStep(step);
    if (prev) goTo(prev);
  };

  const isReview = step === "review";

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      {/* Sticky header: title + saved tick + stepper. */}
      <div className="sticky top-14 z-20 border-b bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <h1 className="text-sm font-semibold">Build a strategy</h1>
          <span
            className="inline-flex items-center gap-1 text-[11px] text-muted"
            data-testid="bt-saved"
            key={savedAt}
          >
            <Check className="h-3 w-3 text-profit" aria-hidden /> Saved
          </span>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-2.5">
          <Stepper current={step} reachable={reachable} onJump={goTo} />
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 py-5 lg:grid-cols-[1fr_360px]">
        {/* Left: step content. */}
        <div>
          {step === "setup" && <SetupStep draft={draft} />}
          {step === "legs" && <LegsStep draft={draft} />}
          {step === "timing" && <TimingStep draft={draft} />}
          {step === "risk" && <RiskStep draft={draft} />}
          {step === "review" && (
            <ReviewStep
              draft={draft}
              onEdit={goTo}
              autoRun={autoRun}
              onAutoRunConsumed={onAutoRunConsumed}
            />
          )}

          {/* Inline validation feedback. */}
          {showErrors && validation.errors.length > 0 && (
            <ul
              className="mt-4 space-y-1 rounded-lg border border-loss/60 bg-loss/10 p-3 text-sm text-loss"
              data-testid="bt-errors"
            >
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {validation.warnings.length > 0 && (
            <ul
              className="mt-4 space-y-1 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm text-warning"
              data-testid="bt-warnings"
            >
              {validation.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {/* Back / Continue (Review has its own Run CTA). */}
          {!isReview && (
            <div className="mt-6 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={onBack}
                disabled={step === "setup"}
                data-testid="bt-back"
              >
                <ArrowLeft aria-hidden /> Back
              </Button>
              <Button
                type="button"
                onClick={onContinue}
                aria-disabled={!validation.ok}
                className={cn(!validation.ok && "opacity-60")}
                data-testid="bt-continue"
              >
                {step === "risk" ? "Review & run" : "Continue"} <ArrowRight aria-hidden />
              </Button>
            </div>
          )}
          {isReview && (
            <div className="mt-6">
              <Button type="button" variant="ghost" onClick={onBack} data-testid="bt-back">
                <ArrowLeft aria-hidden /> Back
              </Button>
            </div>
          )}
        </div>

        {/* Right: ALWAYS-MOUNTED live payoff rail (desktop). */}
        <aside className="hidden lg:block">
          <div className="sticky top-32">
            <LivePayoffRail summary={summary} guides={guides} />
          </div>
        </aside>
      </div>

      {/* Mobile: sticky mini-payoff PEER + sheet. */}
      <MobilePayoff summary={summary} guides={guides} />
    </div>
  );
}
