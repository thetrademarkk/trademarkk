"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { cn, formatINR, formatNumber } from "@/lib/utils";
import {
  buildLadder,
  estimateCoverage,
  estimatePremium,
  resolveIntentStrike,
  type EstimateChain,
  type LadderRung,
} from "@/features/backtest/builder/estimate-chain";
import { STRIKE_STEP } from "@/features/backtest/shared/instruments";
import type { OptionTypeT, StrikeSelector } from "@/features/backtest/builder/types";

export interface StrikeLadderProps {
  index: string;
  optionType: OptionTypeT;
  chain: EstimateChain;
  selector: StrikeSelector;
  onChange: (selector: StrikeSelector) => void;
  /** Stable id base for ARIA wiring (one ladder per leg). */
  idBase: string;
}

type Mode = StrikeSelector["mode"];
const MODE_TABS: { value: Mode; label: string }[] = [
  { value: "ATM_OFFSET", label: "ATM ±" },
  { value: "PERCENT", label: "Spot %" },
  { value: "PREMIUM", label: "Premium ₹" },
  { value: "EXACT", label: "Exact" },
  // Delta DEFERRED (D7) — no IV/Greeks data — so there is intentionally no delta tab.
];

/** Coverage pip: a 5-segment honesty bar (semantic tokens only). */
function CoveragePip({ coverage }: { coverage: number }) {
  const filled = Math.round(coverage * 5);
  const tone = coverage >= 0.7 ? "bg-profit" : coverage >= 0.4 ? "bg-warning" : "bg-loss";
  return (
    <span className="inline-flex items-center gap-px" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={cn("h-1 w-1.5 rounded-[1px]", i < filled ? tone : "bg-surface-2")}
        />
      ))}
    </span>
  );
}

/**
 * The interactive strike LADDER — the builder's tactile centrepiece. A
 * keyboard-navigable listbox of real grid strikes around ATM, ATM ring
 * highlighted, each rung showing an estimated premium + a coverage pip; thin
 * rungs (coverage ≤ floor) are dimmed and not selectable. Tabs switch between
 * ATM±offset / Premium ₹ / Exact selection modes (Delta deferred, D7).
 *
 * Stores the INTENT (offset / target / exact strike) on the leg — never a
 * resolved strike — so the strategy is date-range portable. Controlled value is
 * set on render via `selector`; never via a post-mount imperative setter.
 */
export function StrikeLadder({
  index,
  optionType,
  chain,
  selector,
  onChange,
  idBase,
}: StrikeLadderProps) {
  const rungs = React.useMemo(() => buildLadder(chain, optionType), [chain, optionType]);

  // The currently-selected offset (only meaningful in ATM_OFFSET mode; for other
  // modes the ladder highlights the resolved rung but selection lives in inputs).
  const selectedOffset = selector.mode === "ATM_OFFSET" ? selector.steps : null;

  const selectableRungs = React.useMemo(() => rungs.filter((r) => !r.thin), [rungs]);

  const selectOffset = React.useCallback(
    (offset: number) => onChange({ mode: "ATM_OFFSET", steps: offset }),
    [onChange]
  );

  // Keyboard: ←/→ step offset, Home/End deep ITM/OTM, 0/a = ATM. Only active in
  // ATM_OFFSET mode (the ladder is the selection surface there).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (selector.mode !== "ATM_OFFSET") return;
    const offsets = selectableRungs.map((r) => r.offset);
    if (offsets.length === 0) return;
    const cur = selectedOffset ?? 0;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      next = offsets.find((o) => o > cur) ?? offsets[offsets.length - 1]!;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      const lower = offsets.filter((o) => o < cur);
      next = lower.length ? lower[lower.length - 1]! : offsets[0]!;
    } else if (e.key === "Home") {
      next = offsets[0]!;
    } else if (e.key === "End") {
      next = offsets[offsets.length - 1]!;
    } else if (e.key === "0" || e.key.toLowerCase() === "a") {
      next = offsets.includes(0) ? 0 : offsets[0]!;
    }
    if (next !== null) {
      e.preventDefault();
      selectOffset(next);
    }
  };

  return (
    <div className="space-y-2" data-testid={`bt-strike-${idBase}`}>
      <Tabs
        value={selector.mode}
        onValueChange={(m) => {
          // Switching modes seeds a sane default for the new mode (no flicker).
          if (m === "ATM_OFFSET") onChange({ mode: "ATM_OFFSET", steps: 0 });
          else if (m === "PERCENT") onChange({ mode: "PERCENT", pct: 0 });
          else if (m === "PREMIUM") onChange({ mode: "PREMIUM", target: estDefaultPremium(rungs) });
          else if (m === "EXACT") onChange({ mode: "EXACT", strike: chain.atm });
        }}
      >
        <TabsList className="h-8">
          {MODE_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="px-2.5 py-0.5 text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {selector.mode === "ATM_OFFSET" && (
        <div
          role="listbox"
          aria-label={`Strike ladder for ${optionType}`}
          aria-orientation="horizontal"
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="flex gap-1 overflow-x-auto rounded-lg border bg-surface/40 p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid={`bt-ladder-${idBase}`}
        >
          {rungs.map((r) => (
            <Rung
              key={r.offset}
              rung={r}
              selected={selectedOffset === r.offset}
              onSelect={() => !r.thin && selectOffset(r.offset)}
            />
          ))}
        </div>
      )}

      {selector.mode === "PERCENT" && (
        <PercentSelector
          chain={chain}
          optionType={optionType}
          pct={selector.pct}
          onChange={(pct) => onChange({ mode: "PERCENT", pct })}
        />
      )}

      {selector.mode === "PREMIUM" && (
        <PremiumSelector
          rungs={rungs}
          target={selector.target}
          onChange={(target) => onChange({ mode: "PREMIUM", target })}
        />
      )}

      {selector.mode === "EXACT" && (
        <ExactSelector
          chain={chain}
          strike={selector.strike}
          onChange={(strike) => onChange({ mode: "EXACT", strike })}
        />
      )}

      <p className="text-[11px] text-muted">
        Premiums &amp; coverage are estimates for selection. {index} strikes resolve to real prices
        at run time.
      </p>
    </div>
  );
}

function Rung({
  rung,
  selected,
  onSelect,
}: {
  rung: LadderRung;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = rung.isAtm ? "ATM" : rung.offset > 0 ? `+${rung.offset}` : `${rung.offset}`;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-disabled={rung.thin}
      disabled={rung.thin}
      onClick={onSelect}
      data-rung-offset={rung.offset}
      data-atm={rung.isAtm || undefined}
      data-thin={rung.thin || undefined}
      data-selected={selected || undefined}
      className={cn(
        "flex min-w-[58px] shrink-0 flex-col items-center gap-0.5 rounded-md border px-1.5 py-1.5 text-center transition-colors",
        rung.isAtm && "border-accent",
        selected && "bg-accent/15 ring-2 ring-accent",
        rung.thin
          ? "cursor-not-allowed border-dashed opacity-45"
          : "hover:border-accent hover:bg-surface-2"
      )}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className="text-xs font-semibold tabular-nums">{formatNumber(rung.strike, 0)}</span>
      <span className="font-money text-[11px]">{formatINR(rung.premium, { decimals: true })}</span>
      <CoveragePip coverage={rung.coverage} />
    </button>
  );
}

/** Spot-% strike selector: a signed percentage offset from spot (−15…+15), with a
 * live preview of the strike it resolves to (the engine walks the fallback ladder
 * at run time; this is the estimate). +% is OTM for a call/away-from-spot, the
 * sign is literal "% above/below spot". */
function PercentSelector({
  chain,
  optionType,
  pct,
  onChange,
}: {
  chain: EstimateChain;
  optionType: OptionTypeT;
  pct: number;
  onChange: (pct: number) => void;
}) {
  const step = STRIKE_STEP[chain.index];
  const served = React.useMemo(
    () => resolveIntentStrike(chain.index, optionType, { mode: "PERCENT", pct }, chain),
    [chain, optionType, pct]
  );
  const premium =
    served != null ? estimatePremium(chain.index, optionType, served, chain.spot) : null;
  const coverage =
    served != null ? estimateCoverage(chain.index, Math.round((served - chain.atm) / step)) : null;

  return (
    <div className="space-y-2 rounded-lg border bg-surface/40 p-2.5">
      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted">Offset from spot</span>
        <span className="inline-flex items-center">
          <Input
            type="number"
            min={-15}
            max={15}
            step={0.5}
            value={Number.isFinite(pct) ? pct : ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange(Math.max(-15, Math.min(15, Number.isFinite(v) ? v : 0)));
            }}
            className="h-8 w-24 rounded-r-none"
            data-testid="bt-percent-offset"
          />
          <span className="rounded-r-md border border-l-0 bg-surface-2 px-2 py-1 text-xs text-muted">
            %
          </span>
        </span>
      </label>
      {served != null && (
        <p className="text-[11px] text-muted">
          {pct === 0 ? "At spot" : pct > 0 ? `${pct}% above spot` : `${Math.abs(pct)}% below spot`}{" "}
          ≈ <span className="font-medium text-foreground">{formatNumber(served, 0)}</span>
          {premium != null && <> @ est {formatINR(premium, { decimals: true })}</>}
          {coverage != null && <> · coverage {Math.round(coverage * 100)}%</>}
        </p>
      )}
    </div>
  );
}

function estDefaultPremium(rungs: LadderRung[]): number {
  const atm = rungs.find((r) => r.isAtm);
  return atm ? Math.max(0.05, Math.round(atm.premium)) : 50;
}

function PremiumSelector({
  rungs,
  target,
  onChange,
}: {
  rungs: LadderRung[];
  target: number;
  onChange: (target: number) => void;
}) {
  // Closest rung to the target premium (the served strike preview).
  const served = React.useMemo(() => {
    let best: LadderRung | null = null;
    let diff = Infinity;
    for (const r of rungs) {
      const d = Math.abs(r.premium - target);
      if (d < diff) {
        diff = d;
        best = r;
      }
    }
    return best;
  }, [rungs, target]);

  return (
    <div className="space-y-2 rounded-lg border bg-surface/40 p-2.5">
      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted">Target premium</span>
        <span className="inline-flex items-center">
          <span className="rounded-l-md border border-r-0 bg-surface-2 px-2 py-1 text-xs text-muted">
            ₹
          </span>
          <Input
            type="number"
            min={0.05}
            step={1}
            value={Number.isFinite(target) ? target : ""}
            onChange={(e) => onChange(Math.max(0.05, Number(e.target.value) || 0.05))}
            className="h-8 w-24 rounded-l-none"
            data-testid="bt-premium-target"
          />
        </span>
      </label>
      {served && (
        <p className="text-[11px] text-muted">
          Closest available:{" "}
          <span className="font-medium text-foreground">{formatNumber(served.strike, 0)}</span> @
          est {formatINR(served.premium, { decimals: true })} · coverage{" "}
          {Math.round(served.coverage * 100)}%
        </p>
      )}
    </div>
  );
}

function ExactSelector({
  chain,
  strike,
  onChange,
}: {
  chain: EstimateChain;
  strike: number;
  onChange: (strike: number) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border bg-surface/40 p-2.5">
      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted">Exact strike</span>
        <Input
          type="number"
          step={1}
          value={Number.isFinite(strike) ? strike : ""}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="h-8 w-28"
          data-testid="bt-exact-strike"
        />
      </label>
      <p className="text-[11px] text-muted">ATM is {formatNumber(chain.atm, 0)}.</p>
    </div>
  );
}
