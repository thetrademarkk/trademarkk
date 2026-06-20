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
      <header className="flex items-center justify-between gap-2 bt-boot bt-boot-1">
        <div>
          <p className="bt-label text-accent">
            <span className="bt-prompt">legs</span>
          </p>
          <h2 className="bt-display mt-1 text-lg font-semibold">
            Build your <span className="bt-glow-text">legs</span>
          </h2>
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
          className="font-mono uppercase tracking-wide"
        >
          {showTemplates ? "Hide templates" : "Templates"}
        </Button>
      </header>

      {showTemplates && (
        <div className="bt-panel p-3 bt-boot bt-boot-2" data-testid="bt-template-gallery">
          {TEMPLATE_OUTLOOKS.map((outlook) => (
            <div key={outlook} className="mb-3 last:mb-0">
              <div className="bt-label">{outlook}</div>
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
                    className="bt-panel bt-ticks px-3 py-2 text-left text-xs transition-colors hover:border-accent hover:bg-surface-2"
                  >
                    <div className="font-medium">{t.name}</div>
                    <div className="bt-label mt-0.5">{t.legs().length} legs</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 bt-boot bt-boot-3">
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
        className="font-mono uppercase tracking-wide"
      >
        <Plus aria-hidden /> Add leg
      </Button>
      {TEMPLATES.length > 0 && draft.legs.length >= 8 && (
        <p className="bt-label">Maximum 8 legs.</p>
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
      className={cn("bt-panel border-l-4 p-3.5", sell ? "border-l-loss/60" : "border-l-profit/60")}
      data-testid={`bt-leg-${leg.id}`}
      data-leg-side={leg.side}
      data-leg-type={leg.optionType}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="bt-label">Leg {ordinal}</span>

        {/* Buy/Sell */}
        <Segmented
          value={leg.side}
          options={[
            { value: "buy", label: "Buy" },
            { value: "sell", label: "Sell" },
          ]}
          onChange={(v) => updateLeg(leg.id, { side: v as LegDef["side"] })}
          testid={`bt-side-${leg.id}`}
        />
        {/* CE/PE */}
        <Segmented
          value={leg.optionType}
          options={[
            { value: "CE", label: "CE" },
            { value: "PE", label: "PE" },
          ]}
          onChange={(v) => updateLeg(leg.id, { optionType: v as LegDef["optionType"] })}
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
          <span className="bt-num w-6 text-center text-sm" data-testid={`bt-lots-${leg.id}`}>
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
          <span className="bt-label ml-1">
            = <span className="font-money normal-case tracking-normal text-muted">{qty}</span> qty
          </span>
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
          <span className="bt-label">Served</span>{" "}
          <span className="font-money text-foreground">{formatNumber(served.strike, 0)}</span>{" "}
          {leg.optionType} · est{" "}
          <span className="font-money">{formatINR(served.premium, { decimals: true })}</span>
          {requested !== null && requested !== served.strike && (
            <span className="ml-1 text-loss">
              (requested <span className="font-money">{formatNumber(requested, 0)}</span>)
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
  testid,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  testid?: string;
}) {
  return (
    <div className="inline-flex rounded-lg border bg-surface-2 p-0.5" data-testid={testid}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          data-value={o.value}
          data-active={value === o.value || undefined}
          className={cn(
            "rounded-md px-2.5 py-0.5 font-mono text-xs uppercase tracking-wide transition-colors",
            value === o.value
              ? "bg-surface font-medium text-accent shadow"
              : "text-muted hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
