"use client";

import * as React from "react";
import { Layers } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  defaultLotSize,
  lookupLotSize,
  lotsToUnits,
  type LotSizeEntry,
} from "@/lib/instruments/lot-sizes";
import type { Segment } from "../types";

function toNum(v: number | string | undefined | null): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Whole lots that `units` represents at `lotSize`, or null if it doesn't divide evenly. */
function unitsToWholeLots(units: number | undefined, lotSize: number | undefined): number | null {
  if (units == null || lotSize == null || !(lotSize > 0)) return null;
  if (!Number.isInteger(units) || units % lotSize !== 0) return null;
  return units / lotSize;
}

/**
 * SEG-10 — a lots↔units helper shown beneath the Qty input for DERIVATIVE legs
 * (FUT / OPT / COMM / CDS). It never owns the quantity: the Qty value in the form
 * (units) is the single source of truth — exactly what is persisted. Typing a
 * number of lots and a lot size simply WRITES units (lots × lotSize) back into
 * the form via `onUnits`, so the value flows unchanged into the charge engine.
 *
 * BUGFIX (lots blanked on leg switch): the parent remounts the active leg's
 * fields (`key={activeLeg}`) so uncontrolled inputs show that leg's values. That
 * remount used to reset the Lots field to empty even though the qty was still in
 * the form — the value looked lost. The lots display is now SEEDED from the
 * persisted units on mount, so switching back to a leg shows its lots again, and
 * the live "= N qty" readout always reflects the current units so a recovered leg
 * never reads as empty.
 *
 * The lot size auto-fills from the reference table when the symbol/segment is
 * recognised and is fully OVERRIDABLE. EQUITY never shows this helper.
 */
export function LotQtyHelper({
  symbol,
  segment,
  /** The current units value of the Qty field (controlled by the form). */
  units,
  /** Write a units value into the Qty field. */
  onUnits,
  className,
}: {
  symbol: string;
  segment: Segment;
  /** Current Qty value (units). May arrive as a raw input string from RHF. */
  units: number | string | undefined;
  onUnits: (units: number) => void;
  className?: string;
}) {
  const unitsNum = toNum(units);
  // Reference entry for the current symbol+segment (null when unknown).
  const ref: LotSizeEntry | null = React.useMemo(
    () => lookupLotSize(symbol, segment),
    [symbol, segment]
  );
  const refLot = React.useMemo(() => defaultLotSize(symbol, segment), [symbol, segment]);

  // The lot size in effect: a user override if they set one, else the reference.
  // Kept as a string so an empty override field is possible.
  const [lotOverride, setLotOverride] = React.useState<string>("");
  const lotSize = lotOverride.trim() !== "" ? toNum(lotOverride) : (refLot ?? undefined);
  const lotSizeValid = lotSize != null && lotSize > 0;

  // The Lots field is local (so typing feels natural), but it is SEEDED from the
  // persisted units on mount — this is what survives a leg switch. With no
  // override yet, the effective size is the reference lot.
  const [lots, setLots] = React.useState<string>(() => {
    const seeded = unitsToWholeLots(unitsNum, refLot ?? undefined);
    return seeded != null ? String(seeded) : "";
  });

  // When the symbol resolves to a new reference lot, clear a stale override so
  // the auto-filled size tracks the new symbol (the user can still re-override).
  React.useEffect(() => {
    setLotOverride("");
  }, [refLot]);

  // Auto-seed ONE lot the first time a recognised symbol resolves while the Qty
  // is still empty — so typing e.g. "SILVERMINI" immediately fills a sensible
  // quantity (1 lot = lotSize). Fires once; never clobbers an existing qty (an
  // edit-mode trade or a value the user already entered).
  const didSeed = React.useRef(false);
  React.useEffect(() => {
    if (didSeed.current) return;
    if (refLot == null) return; // symbol not recognised yet — wait
    if (unitsNum != null || lots.trim() !== "") {
      didSeed.current = true; // qty/lots already present — don't seed
      return;
    }
    didSeed.current = true;
    setLots("1");
    onUnits(lotsToUnits(1, refLot) ?? refLot);
  }, [refLot, unitsNum, lots, onUnits]);

  const applyLots = (lotsStr: string, size: number | undefined) => {
    const n = toNum(lotsStr);
    if (n == null || size == null || !(size > 0)) return;
    const computed = lotsToUnits(n, size);
    if (computed != null) onUnits(computed);
  };

  // Live qty: prefer the (lots × size) the user is editing; otherwise fall back
  // to the persisted units so a recovered leg always shows its quantity.
  const typedLots = toNum(lots);
  const computedUnits =
    typedLots != null && lotSizeValid ? lotsToUnits(typedLots, lotSize as number) : null;
  const shownUnits = computedUnits ?? unitsNum ?? null;
  // The whole-lot count the persisted units represent (drives the placeholder so
  // the field hints the right number even before the user types).
  const wholeLots = unitsToWholeLots(unitsNum, lotSize);

  return (
    <div className={cn("rounded-lg border bg-surface-2/40 p-2.5", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium text-muted">
        <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Quantity — in lots
        {ref && (
          <span className="text-[10px] text-muted/80">
            · {ref.symbol} {ref.lotSize}/lot
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-x-2 gap-y-2">
        <div className="space-y-1">
          <label className="micro-label" htmlFor="lot-count">
            Lots
          </label>
          <Input
            id="lot-count"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            aria-label="Lots"
            className="h-10 w-20"
            placeholder={wholeLots != null ? String(wholeLots) : "2"}
            value={lots}
            onChange={(e) => {
              setLots(e.target.value);
              applyLots(e.target.value, lotSize);
            }}
          />
        </div>
        <span className="pb-2.5 text-sm text-muted" aria-hidden>
          ×
        </span>
        <div className="space-y-1">
          <label className="micro-label" htmlFor="lot-size">
            Lot size
          </label>
          <Input
            id="lot-size"
            type="number"
            min="0"
            step="any"
            inputMode="numeric"
            aria-label="Lot size"
            className="h-10 w-24"
            placeholder={refLot != null ? String(refLot) : "size"}
            value={lotOverride}
            onChange={(e) => {
              setLotOverride(e.target.value);
              const size =
                e.target.value.trim() !== "" ? toNum(e.target.value) : (refLot ?? undefined);
              if (lots.trim() !== "") applyLots(lots, size);
            }}
          />
        </div>
        <span
          className="ml-auto pb-2.5 font-money text-sm font-medium tabular-nums text-foreground"
          aria-live="polite"
          data-testid="lot-units"
        >
          {shownUnits != null
            ? `= ${shownUnits.toLocaleString("en-IN")} qty`
            : refLot == null
              ? "enter lot size"
              : "= qty"}
        </span>
      </div>
    </div>
  );
}
