"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useBuilderStore } from "@/features/backtest/builder/builder-store";
import type { LegDef, OverallRisk, StrategyDef } from "@/features/backtest/builder/types";

const RE_ENTRY_OPTIONS: {
  value: NonNullable<LegDef["reEntry"]>["mode"];
  label: string;
  hint: string;
}[] = [
  { value: "NONE", label: "None", hint: "Do not re-enter after a stop/target" },
  { value: "RE_ASAP", label: "Re-enter at new ATM", hint: "RE ASAP" },
  { value: "RE_COST", label: "Re-enter at the same price", hint: "RE Cost" },
  { value: "RE_MOMENTUM", label: "Re-enter on momentum", hint: "RE Momentum" },
];

/**
 * Step 4 — Risk. Overall (whole-strategy MTM) SL + Target in ₹ or % with a
 * trailing/max-loss disclosure, plus per-leg rules (plain-language re-entry
 * presets, never raw "RE ASAP"). Nothing blocks — the user can always run; we
 * nudge naked-short positions. The live rail overlays the overall SL/Target as
 * guide-lines on the payoff y-axis.
 */
export function RiskStep({ draft }: { draft: StrategyDef }) {
  const setRisk = useBuilderStore((s) => s.setRisk);
  const updateLeg = useBuilderStore((s) => s.updateLeg);
  const { risk } = draft;

  const slUnit = risk.stopLoss?.unit ?? "rupees";
  const tgtUnit = risk.target?.unit ?? "rupees";
  const [advanced, setAdvanced] = React.useState(Boolean(risk.trailing || risk.maxLossRupees));

  const setOverallSL = (value: number | null, unit: "rupees" | "pct" = slUnit) =>
    setRisk({ stopLoss: value === null ? undefined : { unit, value } } as Partial<OverallRisk>);
  const setOverallTgt = (value: number | null, unit: "rupees" | "pct" = tgtUnit) =>
    setRisk({ target: value === null ? undefined : { unit, value } } as Partial<OverallRisk>);

  return (
    <div className="space-y-6" data-testid="bt-step-risk">
      <header className="bt-boot bt-boot-1">
        <p className="bt-label text-accent">
          <span className="bt-prompt">risk</span>
        </p>
        <h2 className="bt-display mt-1 text-lg font-semibold">
          Manage <span className="bt-glow-text">risk</span>
        </h2>
        <p className="mt-1 text-sm text-muted">
          Overall stop and target on the whole strategy; per-leg rules are optional.
        </p>
      </header>

      <section className="bt-panel p-3.5 bt-boot bt-boot-2">
        <div className="bt-label">Overall (whole-strategy MTM)</div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <RupeePctField
            label="Stop loss"
            tone="loss"
            value={risk.stopLoss?.value ?? null}
            unit={slUnit}
            onValue={(v) => setOverallSL(v)}
            onUnit={(u) => setOverallSL(risk.stopLoss?.value ?? null, u)}
            testid="bt-overall-sl"
          />
          <RupeePctField
            label="Target"
            tone="profit"
            value={risk.target?.value ?? null}
            unit={tgtUnit}
            onValue={(v) => setOverallTgt(v)}
            onUnit={(u) => setOverallTgt(risk.target?.value ?? null, u)}
            testid="bt-overall-target"
          />
        </div>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          className="mt-3 font-mono text-xs font-medium uppercase tracking-wide text-accent"
          aria-expanded={advanced}
        >
          {advanced ? "− Hide advanced" : "+ Advanced (trailing, hard max loss)"}
        </button>
        {advanced && (
          <div className="mt-2 space-y-2 border-t pt-2 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-muted">Hard max loss ₹</span>
              <Input
                type="number"
                min={0}
                value={risk.maxLossRupees ?? ""}
                onChange={(e) =>
                  setRisk({ maxLossRupees: e.target.value ? Number(e.target.value) : undefined })
                }
                className="h-8 w-32 font-money"
                data-testid="bt-max-loss"
              />
            </label>
          </div>
        )}
      </section>

      <section className="bt-boot bt-boot-3">
        <div className="bt-label">Per-leg rules (optional)</div>
        <div className="mt-2 space-y-2">
          {draft.legs.map((leg, i) => (
            <PerLegRules key={leg.id} leg={leg} ordinal={i + 1} onUpdate={updateLeg} />
          ))}
        </div>
      </section>

      <p className="text-[11px] text-muted bt-boot bt-boot-4">
        The overall stop and target appear as guide-lines on the live payoff. Nothing blocks running
        — we only nudge unhedged-short risk.
      </p>
    </div>
  );
}

function RupeePctField({
  label,
  tone,
  value,
  unit,
  onValue,
  onUnit,
  testid,
}: {
  label: string;
  tone: "profit" | "loss";
  value: number | null;
  unit: "rupees" | "pct";
  onValue: (v: number | null) => void;
  onUnit: (u: "rupees" | "pct") => void;
  testid?: string;
}) {
  return (
    <div>
      <div className={cn("bt-label", tone === "loss" ? "text-loss" : "text-profit")}>{label}</div>
      <div className="mt-1 flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          value={value ?? ""}
          placeholder={unit === "pct" ? "% of margin" : "₹"}
          onChange={(e) => onValue(e.target.value ? Number(e.target.value) : null)}
          className="h-8 w-32 font-money"
          data-testid={testid}
        />
        <div className="inline-flex rounded-lg border bg-surface-2 p-0.5">
          {(["rupees", "pct"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => onUnit(u)}
              aria-pressed={unit === u}
              className={cn(
                "rounded-md px-2 py-0.5 font-mono text-xs transition-colors",
                unit === u ? "bg-surface font-medium text-accent shadow" : "text-muted"
              )}
            >
              {u === "rupees" ? "₹" : "%"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PerLegRules({
  leg,
  ordinal,
  onUpdate,
}: {
  leg: LegDef;
  ordinal: number;
  onUpdate: (legId: string, patch: Partial<LegDef>) => void;
}) {
  const [open, setOpen] = React.useState(Boolean(leg.stopLoss || leg.target || leg.reEntry));
  const reMode = leg.reEntry?.mode ?? "NONE";

  return (
    <div className="bt-panel" data-testid={`bt-perleg-${leg.id}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm"
        aria-expanded={open}
      >
        <span className="font-mono uppercase tracking-wide">
          Leg {ordinal} · {leg.side === "sell" ? "Sell" : "Buy"} {leg.optionType}
        </span>
        <span className="font-mono text-xs uppercase tracking-wide text-accent">
          {open ? "−" : "+ Add rules"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2.5 text-sm">
          <label className="flex items-center gap-2">
            <span className="bt-label w-20">Stop loss</span>
            <Input
              type="number"
              min={0}
              value={leg.stopLoss?.value ?? ""}
              placeholder="% of premium"
              onChange={(e) =>
                onUpdate(leg.id, {
                  stopLoss: e.target.value
                    ? {
                        unit: "pct",
                        basis: "premium",
                        value: Number(e.target.value),
                        refPrice: "traded",
                      }
                    : undefined,
                })
              }
              className="h-8 w-28 font-money"
              data-testid={`bt-leg-sl-${leg.id}`}
            />
            <span className="bt-label">% of premium</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="bt-label w-20">Target</span>
            <Input
              type="number"
              min={0}
              value={leg.target?.value ?? ""}
              placeholder="% of premium"
              onChange={(e) =>
                onUpdate(leg.id, {
                  target: e.target.value
                    ? {
                        unit: "pct",
                        basis: "premium",
                        value: Number(e.target.value),
                        refPrice: "traded",
                      }
                    : undefined,
                })
              }
              className="h-8 w-28 font-money"
            />
            <span className="bt-label">% of premium</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="bt-label w-20">Re-entry</span>
            <select
              value={reMode}
              onChange={(e) => {
                const mode = e.target.value as NonNullable<LegDef["reEntry"]>["mode"];
                onUpdate(leg.id, {
                  reEntry:
                    mode === "NONE"
                      ? undefined
                      : {
                          mode,
                          maxCount: leg.reEntry?.maxCount ?? 1,
                          ...(mode === "RE_MOMENTUM"
                            ? { momentum: leg.reEntry?.momentum ?? { unit: "pct", value: 10 } }
                            : {}),
                        },
                });
              }}
              className="h-8 rounded-lg border bg-surface-2 px-2 font-mono text-xs"
              data-testid={`bt-leg-reentry-${leg.id}`}
            >
              {RE_ENTRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
