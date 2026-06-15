"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useTradeCore } from "./use-trade-core";
import {
  SymbolField,
  SegmentField,
  ProductField,
  ExpiryField,
  LegTabs,
  StrikeType,
  DirectionField,
  QtyField,
  EntryExit,
  RiskPlanFields,
  SetupFields,
  TagsField,
  NotesField,
  TimingFields,
  ChargesField,
  StatusChip,
  PreviewBar,
  CompletenessChips,
} from "./fields";

function Zone({
  title,
  action,
  children,
  quiet,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  quiet?: boolean;
}) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 id={id} className="text-[11px] font-medium uppercase tracking-wide text-muted">
          {title}
        </h3>
        {action}
      </div>
      <div className={quiet ? "" : "space-y-4 rounded-lg border bg-surface-2/40 p-3"}>
        {children}
      </div>
    </section>
  );
}

/**
 * Variant B — Calm Zones. Five explicitly-labeled sections (Instrument · Position ·
 * Risk plan · Journal · Timing) for maximal scannability, plus the pinned footer.
 */
export function VariantCalmZones({ touch, onSaved }: { touch?: boolean; onSaved?: () => void }) {
  const core = useTradeCore({ onSaved });
  return (
    <form onSubmit={core.onSubmit} className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Zone title="Instrument">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <SymbolField core={core} />
            </div>
            <SegmentField core={core} />
          </div>
          <ProductField core={core} touch={touch} />
          <ExpiryField core={core} />
        </Zone>

        <Zone
          title="Position"
          action={
            <div className="flex items-center gap-2">
              <StatusChip core={core} />
              <LegTabs core={core} compact />
            </div>
          }
        >
          {core.segment === "OPT" && (
            <div className="grid grid-cols-2 gap-2">
              <StrikeType core={core} />
            </div>
          )}
          <DirectionField core={core} touch={touch} />
          <QtyField core={core} />
          <EntryExit core={core} />
        </Zone>

        <Zone title="Risk plan">
          <RiskPlanFields core={core} />
        </Zone>

        <Zone title="Journal">
          <SetupFields core={core} />
          <TagsField core={core} />
          <NotesField core={core} />
        </Zone>

        <Zone title="Timing & charges" quiet>
          <TimingFields core={core} />
          <ChargesField core={core} />
        </Zone>
      </div>

      <div className="shrink-0 space-y-2 border-t bg-surface px-4 py-3">
        <PreviewBar core={core} />
        <CompletenessChips core={core} />
        <Button type="submit" className="w-full" disabled={core.saving}>
          {core.saving ? "Saving…" : "Save trade"}
        </Button>
      </div>
    </form>
  );
}
