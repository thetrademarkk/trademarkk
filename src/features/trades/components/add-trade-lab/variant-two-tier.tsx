"use client";

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

function Seam({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted">
      <span className="h-px flex-1 bg-border" />
      {children}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Variant A — Two-Tier Ticket. A box-free ESSENTIALS spine (the 15-second path)
 * above one recessed, always-open "Plan & journal" well, with a pinned footer
 * carrying the live preview, completeness chips and Save. Nothing is hidden.
 */
export function VariantTwoTier({ touch, onSaved }: { touch?: boolean; onSaved?: () => void }) {
  const core = useTradeCore({ onSaved });
  return (
    <form onSubmit={core.onSubmit} className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* ── ESSENTIALS (no box — the primary spine) ── */}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <SymbolField core={core} />
          </div>
          <SegmentField core={core} />
        </div>
        <ProductField core={core} touch={touch} />
        <ExpiryField core={core} />

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Position</span>
          <div className="flex items-center gap-2">
            <StatusChip core={core} />
            <LegTabs core={core} compact />
          </div>
        </div>
        {core.segment === "OPT" && (
          <div className="grid grid-cols-2 gap-2">
            <StrikeType core={core} />
          </div>
        )}
        <DirectionField core={core} touch={touch} />
        <QtyField core={core} />
        <EntryExit core={core} />

        {/* ── PLAN & JOURNAL (recessed well, always open) ── */}
        <Seam>Plan &amp; journal</Seam>
        <div className="space-y-4 rounded-lg border bg-surface-2/40 p-3">
          <RiskPlanFields core={core} />
          <SetupFields core={core} />
          <TagsField core={core} />
          <NotesField core={core} />
        </div>

        {/* ── timing & charges (quiet, still visible) ── */}
        <div className="space-y-3 pt-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Timing &amp; charges
          </p>
          <TimingFields core={core} />
          <ChargesField core={core} />
        </div>
      </div>

      {/* ── pinned footer ── */}
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
