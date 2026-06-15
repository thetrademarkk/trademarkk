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

/**
 * SEG-10 — a lots↔units helper shown beneath the Qty input for DERIVATIVE legs
 * (FUT / OPT / COMM / CDS). It never owns the quantity: the Qty input remains
 * the single source of truth (units, exactly what is persisted). Typing a number
 * of lots and a lot size simply WRITES units (lots × lotSize) into Qty via
 * `onUnits`, so the value flows unchanged into the charge engine + P&L.
 *
 * The lot size auto-fills from the reference table when the symbol/segment is
 * recognised, and is fully OVERRIDABLE — an unknown symbol just starts blank and
 * the user can type a lot size or ignore the helper entirely and type units into
 * Qty directly. EQUITY never shows this helper (cash is traded in plain units).
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
  // RHF number inputs surface raw strings via watch(); coerce defensively.
  const unitsNum =
    units === undefined || units === null || units === "" ? undefined : Number(units);
  // Reference entry for the current symbol+segment (null when unknown).
  const ref: LotSizeEntry | null = React.useMemo(
    () => lookupLotSize(symbol, segment),
    [symbol, segment]
  );
  const refLot = React.useMemo(() => defaultLotSize(symbol, segment), [symbol, segment]);

  // The lot size in effect: a user override if they set one, else the reference.
  // Kept as a string so an empty override field is possible.
  const [lotOverride, setLotOverride] = React.useState<string>("");
  const [lots, setLots] = React.useState<string>("");

  // When the symbol resolves to a new reference lot, clear a stale override so
  // the auto-filled size tracks the symbol (the user can still re-override).
  React.useEffect(() => {
    setLotOverride("");
  }, [refLot]);

  const lotSize = lotOverride.trim() !== "" ? Number(lotOverride) : (refLot ?? undefined);
  const lotSizeValid = lotSize != null && Number.isFinite(lotSize) && lotSize > 0;

  const applyLots = (lotsStr: string, sizeStr: string | number | undefined) => {
    const size =
      typeof sizeStr === "string"
        ? sizeStr.trim() !== ""
          ? Number(sizeStr)
          : (refLot ?? NaN)
        : (sizeStr ?? NaN);
    const n = Number(lotsStr);
    if (lotsStr.trim() === "" || !Number.isFinite(n)) return;
    const computed = lotsToUnits(n, size);
    if (computed != null) onUnits(computed);
  };

  // The exact lot count the current units represent (display sync), only when it
  // divides evenly — so the lots field stays in step if the user edits Qty.
  const unitsLots =
    lotSizeValid &&
    unitsNum != null &&
    Number.isInteger(unitsNum) &&
    unitsNum % (lotSize as number) === 0
      ? unitsNum / (lotSize as number)
      : null;

  return (
    <div className={cn("rounded-lg border bg-surface-2/40 p-2.5", className)}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <Layers className="h-3.5 w-3.5" aria-hidden />
        Quantity — in lots
        {ref && (
          <span className="text-[10px] text-muted/80">
            · {ref.symbol} default {ref.lotSize}/lot
          </span>
        )}
      </div>
      <div className="flex items-end gap-2">
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
            className="h-9 w-20"
            placeholder={unitsLots != null ? String(unitsLots) : "2"}
            value={lots}
            onChange={(e) => {
              setLots(e.target.value);
              applyLots(e.target.value, lotOverride === "" ? (refLot ?? undefined) : lotOverride);
            }}
          />
        </div>
        <span className="pb-2 text-sm text-muted" aria-hidden>
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
            className="h-9 w-24"
            placeholder={refLot != null ? String(refLot) : "size"}
            value={lotOverride}
            onChange={(e) => {
              setLotOverride(e.target.value);
              if (lots.trim() !== "") applyLots(lots, e.target.value);
            }}
          />
        </div>
        <span
          className="pb-2 text-sm font-medium text-foreground"
          aria-live="polite"
          data-testid="lot-units"
        >
          {lots.trim() !== "" && lotSizeValid
            ? `= ${lotsToUnits(Number(lots), lotSize as number) ?? "—"} qty`
            : refLot == null
              ? "unknown symbol — type qty"
              : "= qty"}
        </span>
      </div>
    </div>
  );
}
