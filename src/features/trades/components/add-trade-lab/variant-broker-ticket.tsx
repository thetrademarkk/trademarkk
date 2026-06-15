"use client";

import { Button } from "@/components/ui/button";
import { PnlText } from "@/components/shared/pnl-text";
import { useTradeCore, type TradeCore } from "./use-trade-core";
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function RailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-money">{children}</span>
    </div>
  );
}

/** The persistent desktop summary — always shows the financial consequence. */
function SummaryRail({ core }: { core: TradeCore }) {
  const p = core.preview;
  return (
    <div className="sticky top-0 space-y-3 self-start rounded-lg border bg-surface-2/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Summary</span>
        <StatusChip core={core} />
      </div>
      {p ? (
        <>
          <RailRow label="Gross">
            <PnlText value={p.gross} />
          </RailRow>
          <RailRow label="Charges">₹{p.charges.toFixed(2)}</RailRow>
          {p.r != null && <RailRow label="R multiple">{p.r}R</RailRow>}
          <div className="border-t pt-2">
            <RailRow label="Net">
              <PnlText value={p.net} className="text-base font-semibold" />
            </RailRow>
          </div>
        </>
      ) : (
        <RailRow label={core.exposure != null ? "Exposure" : "Net"}>
          {core.exposure != null
            ? `₹${core.exposure.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
            : "—"}
        </RailRow>
      )}
      <RailRow label="Holding">{core.holdLabel ?? "—"}</RailRow>
      <div className="pt-1">
        <CompletenessChips core={core} />
      </div>
      <Button type="submit" className="w-full" disabled={core.saving}>
        {core.saving ? "Saving…" : "Save trade"}
      </Button>
    </div>
  );
}

/**
 * Variant C — Adaptive Broker Ticket. Form on the left, a persistent summary rail
 * on the right (desktop). On mobile it collapses to a single column + footer.
 */
export function VariantBrokerTicket({ touch, onSaved }: { touch?: boolean; onSaved?: () => void }) {
  const core = useTradeCore({ onSaved });

  const formSections = (
    <div className="space-y-5">
      <Group title="Instrument">
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <SymbolField core={core} />
          </div>
          <SegmentField core={core} />
        </div>
        <ProductField core={core} touch={touch} />
        <ExpiryField core={core} />
      </Group>
      <Group title="Execution">
        <div className="flex items-center justify-end">
          <LegTabs core={core} compact />
        </div>
        {core.segment === "OPT" && (
          <div className="grid grid-cols-2 gap-2">
            <StrikeType core={core} />
          </div>
        )}
        <DirectionField core={core} touch={touch} />
        <QtyField core={core} />
        <EntryExit core={core} />
      </Group>
      <Group title="Plan & journal">
        <RiskPlanFields core={core} />
        <SetupFields core={core} />
        <TagsField core={core} />
        <NotesField core={core} />
      </Group>
      <Group title="Timing & charges">
        <TimingFields core={core} />
        <ChargesField core={core} />
      </Group>
    </div>
  );

  if (touch) {
    return (
      <form onSubmit={core.onSubmit} className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto p-4">{formSections}</div>
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

  return (
    <form onSubmit={core.onSubmit} className="h-full overflow-y-auto p-4">
      <div className="grid grid-cols-[1fr_220px] gap-4">
        {formSections}
        <SummaryRail core={core} />
      </div>
    </form>
  );
}
