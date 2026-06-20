"use client";

import * as React from "react";
import { Copy, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatINR, formatNumber } from "@/lib/utils";
import { LOT_SIZE, type IndexSymbol } from "@/features/backtest/shared/instruments";
import { useBuilderStore } from "@/features/backtest/builder/builder-store";
import {
  estimateLegStrikeAndPremium,
  makeEstimateChain,
  resolveIntentStrike,
  type EstimateChain,
} from "@/features/backtest/builder/estimate-chain";
import {
  TEMPLATES,
  TEMPLATE_OUTLOOKS,
  templatesByOutlook,
} from "@/features/backtest/builder/templates";
import type { LegDef, StrategyDef, StrikeSelector } from "@/features/backtest/builder/types";
import { StrikeLadder } from "../strike-ladder";
import { SegmentedControl } from "../segmented-control";

/**
 * Step 2 — Legs (the centrepiece). A template gallery for the fastest on-ramp,
 * then per-leg cards: Buy/Sell + CE/PE toggles, a lots stepper with the auto
 * qty readout, and the interactive strike ladder. Duplicate is the fast path to
 * spreads. ≥1 leg required to continue (gated by the wizard).
 */
export function LegsStep({ draft }: { draft: StrategyDef }) {
  const applyTemplate = useBuilderStore((s) => s.applyTemplate);
  const addLeg = useBuilderStore((s) => s.addLeg);

  const chain = React.useMemo(() => makeEstimateChain(draft.market.symbol), [draft.market.symbol]);
  const [showTemplates, setShowTemplates] = React.useState(false);

  return (
    <div className="space-y-5" data-testid="bt-step-legs">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Build your legs</h2>
          <p className="mt-1 text-sm text-muted">
            {draft.legs.length} leg{draft.legs.length === 1 ? "" : "s"} · start from a template or
            add legs by hand.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowTemplates((v) => !v)}
          data-testid="bt-toggle-templates"
        >
          {showTemplates ? "Hide templates" : "Templates"}
        </Button>
      </header>

      {showTemplates && (
        <div className="rounded-xl border bg-surface/40 p-3" data-testid="bt-template-gallery">
          {TEMPLATE_OUTLOOKS.map((outlook) => (
            <div key={outlook} className="mb-3 last:mb-0">
              <div className="micro-label">{outlook}</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {templatesByOutlook(outlook).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      applyTemplate(t.id);
                      setShowTemplates(false);
                    }}
                    data-template={t.id}
                    title={t.blurb}
                    className="rounded-lg border bg-surface px-3 py-2 text-left text-xs transition-colors hover:border-accent hover:bg-surface-2"
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted">{t.legs().length} legs</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {draft.legs.map((leg, i) => (
          <LegCard
            key={leg.id}
            index={draft.market.symbol}
            leg={leg}
            ordinal={i + 1}
            chain={chain}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addLeg}
        disabled={draft.legs.length >= 8}
        data-testid="bt-add-leg"
      >
        <Plus aria-hidden /> Add leg
      </Button>
      {TEMPLATES.length > 0 && draft.legs.length >= 8 && (
        <p className="text-[11px] text-muted">Maximum 8 legs.</p>
      )}
    </div>
  );
}

function LegCard({
  index,
  leg,
  ordinal,
  chain,
}: {
  index: IndexSymbol;
  leg: LegDef;
  ordinal: number;
  chain: EstimateChain;
}) {
  const updateLeg = useBuilderStore((s) => s.updateLeg);
  const duplicateLeg = useBuilderStore((s) => s.duplicateLeg);
  const removeLeg = useBuilderStore((s) => s.removeLeg);
  const canRemove = useBuilderStore((s) => s.draft.legs.length) > 1;

  const qty = leg.lots * LOT_SIZE[index];
  const sell = leg.side === "sell";

  // Served-strike preview (estimate) for the leg's current intent.
  const served = React.useMemo(
    () => estimateLegStrikeAndPremium(index, leg, chain),
    [index, leg, chain]
  );
  const requested = React.useMemo(
    () => resolveIntentStrike(index, leg.optionType, leg.strike, chain),
    [index, leg.optionType, leg.strike, chain]
  );

  const onStrikeChange = (selector: StrikeSelector) => updateLeg(leg.id, { strike: selector });

  return (
    <div
      className={cn(
        "rounded-lg border-l-4 bg-surface p-3.5",
        sell ? "border-l-loss" : "border-l-profit"
      )}
      data-testid={`bt-leg-${leg.id}`}
      data-leg-side={leg.side}
      data-leg-type={leg.optionType}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted">Leg {ordinal}</span>

        {/* Buy/Sell */}
        <SegmentedControl<LegDef["side"]>
          value={leg.side}
          options={[
            { value: "buy", label: "Buy" },
            { value: "sell", label: "Sell" },
          ]}
          onChange={(v) => updateLeg(leg.id, { side: v })}
          ariaLabel="Leg direction"
          testid={`bt-side-${leg.id}`}
        />
        {/* CE/PE */}
        <SegmentedControl<LegDef["optionType"]>
          value={leg.optionType}
          options={[
            { value: "CE", label: "CE" },
            { value: "PE", label: "PE" },
          ]}
          onChange={(v) => updateLeg(leg.id, { optionType: v })}
          ariaLabel="Option type"
          testid={`bt-type-${leg.id}`}
        />

        {/* Lots stepper */}
        <div className="inline-flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Decrease lots"
            onClick={() => updateLeg(leg.id, { lots: Math.max(1, leg.lots - 1) })}
          >
            <Minus aria-hidden />
          </Button>
          <span className="w-6 text-center text-sm tabular-nums" data-testid={`bt-lots-${leg.id}`}>
            {leg.lots}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            aria-label="Increase lots"
            onClick={() => updateLeg(leg.id, { lots: Math.min(100, leg.lots + 1) })}
          >
            <Plus aria-hidden />
          </Button>
          <span className="ml-1 text-[11px] text-muted">= {qty} qty</span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Duplicate leg"
            onClick={() => duplicateLeg(leg.id)}
          >
            <Copy aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Delete leg"
            disabled={!canRemove}
            onClick={() => removeLeg(leg.id)}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <StrikeLadder
          index={index}
          optionType={leg.optionType}
          chain={chain}
          selector={leg.strike}
          onChange={onStrikeChange}
          idBase={leg.id}
        />
      </div>

      {served && (
        <div className="mt-2 text-[11px] text-muted" data-testid={`bt-served-${leg.id}`}>
          Served: {formatNumber(served.strike, 0)} {leg.optionType} · est{" "}
          {formatINR(served.premium, { decimals: true })}
          {requested !== null && requested !== served.strike && (
            <span className="ml-1 text-warning">(requested {formatNumber(requested, 0)})</span>
          )}
        </div>
      )}
    </div>
  );
}
