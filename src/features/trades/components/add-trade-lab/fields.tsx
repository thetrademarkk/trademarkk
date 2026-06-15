"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { DatePicker, DateTimePicker } from "@/components/ui/date-time-picker";
import { PnlText } from "@/components/shared/pnl-text";
import { Controller } from "react-hook-form";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isDerivativeSegment, productsForSegment, type TradeFormValues } from "../../schemas";
import { segmentUsesLots } from "@/lib/instruments/lot-sizes";
import { TagPicker } from "../tag-picker";
import { LotQtyHelper } from "../lot-qty-helper";
import type { TradeCore } from "./use-trade-core";

const SEGMENT_OPTIONS: { value: TradeFormValues["segment"]; label: string }[] = [
  { value: "OPT", label: "Options" },
  { value: "FUT", label: "Futures" },
  { value: "EQ", label: "Equity" },
  { value: "COMM", label: "Commodity" },
  { value: "CDS", label: "Currency" },
];

const PRODUCT_LABELS: Record<NonNullable<TradeFormValues["product"]>, string> = {
  MIS: "Intraday (MIS)",
  CNC: "Delivery (CNC)",
  NRML: "Carry-forward (NRML)",
  BTST: "BTST",
  STBT: "STBT",
};

/** Small label that can be primary (foreground) or quiet (muted micro-label). */
export function FieldLabel({ children, quiet }: { children: React.ReactNode; quiet?: boolean }) {
  return quiet ? (
    <span className="text-xs text-muted">{children}</span>
  ) : (
    <Label className="text-foreground">{children}</Label>
  );
}

export function SymbolField({ core }: { core: TradeCore }) {
  const { register, formState } = core.form;
  return (
    <div className="space-y-1">
      <FieldLabel>Symbol</FieldLabel>
      <Input placeholder="NIFTY / RELIANCE" autoCapitalize="characters" {...register("symbol")} />
      {formState.errors.symbol && (
        <p className="text-xs text-loss">{formState.errors.symbol.message as string}</p>
      )}
    </div>
  );
}

export function SegmentField({ core }: { core: TradeCore }) {
  return (
    <div className="space-y-1">
      <FieldLabel>Segment</FieldLabel>
      <Controller
        control={core.form.control}
        name="segment"
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger aria-label="Segment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEGMENT_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </div>
  );
}

export function ProductField({ core, touch }: { core: TradeCore; touch?: boolean }) {
  return (
    <div className="space-y-1">
      <FieldLabel>Product</FieldLabel>
      <Controller
        control={core.form.control}
        name="product"
        render={({ field }) => {
          const allowed = productsForSegment(core.segment);
          return (
            <SegmentedControl
              ariaLabel="Product"
              value={field.value ?? undefined}
              onChange={field.onChange}
              size={touch ? "touch" : "sm"}
              columns={Math.min(allowed.length, 4)}
              options={allowed.map((p) => ({ value: p, label: PRODUCT_LABELS[p] }))}
            />
          );
        }}
      />
    </div>
  );
}

export function ExpiryField({ core }: { core: TradeCore }) {
  if (!isDerivativeSegment(core.segment)) return null;
  return (
    <div className="space-y-1">
      <FieldLabel>Expiry</FieldLabel>
      <Controller
        control={core.form.control}
        name="expiry"
        render={({ field }) => (
          <DatePicker
            value={field.value ?? ""}
            onChange={field.onChange}
            aria-label="Expiry date"
          />
        )}
      />
    </div>
  );
}

/** The leg tab strip — only meaningful for multi-leg. `compact` hides it at 1 leg. */
export function LegTabs({ core, compact }: { core: TradeCore; compact?: boolean }) {
  const { activeLeg, setActiveLeg, legCount, addLeg, removeLeg, legHasError } = core;
  if (compact && legCount === 1) {
    return (
      <button
        type="button"
        onClick={addLeg}
        className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add leg
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-surface-2/60 p-1">
      {Array.from({ length: legCount }).map((_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => setActiveLeg(i)}
          aria-current={activeLeg === i ? "step" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            activeLeg === i ? "bg-bg text-foreground shadow-sm" : "text-muted hover:text-foreground"
          )}
        >
          Leg {i + 1}
          {legHasError(i) && (
            <span className="h-1.5 w-1.5 rounded-full bg-loss" aria-label="has errors" />
          )}
          {i > 0 && activeLeg === i && (
            <span
              role="button"
              aria-label={`Remove leg ${i + 1}`}
              className="rounded text-muted hover:text-loss"
              onClick={(e) => {
                e.stopPropagation();
                removeLeg(i);
              }}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      ))}
      <button
        type="button"
        onClick={addLeg}
        className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add leg
      </button>
    </div>
  );
}

/** Strike + CE/PE (OPT only) for the active leg. */
export function StrikeType({ core }: { core: TradeCore }) {
  const { activeLeg } = core;
  const { register, control, formState } = core.form;
  if (core.segment !== "OPT") return null;
  return (
    <>
      <div className="space-y-1">
        <FieldLabel>Strike</FieldLabel>
        {activeLeg === 0 ? (
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="24500"
            {...register("strike")}
          />
        ) : (
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="24500"
            {...register(`extraLegs.${activeLeg - 1}.strike`)}
          />
        )}
        {activeLeg === 0 && formState.errors.strike && (
          <p className="text-xs text-loss">{formState.errors.strike.message as string}</p>
        )}
      </div>
      <div className="space-y-1">
        <FieldLabel>CE / PE</FieldLabel>
        <Controller
          control={control}
          name={activeLeg === 0 ? "optionType" : `extraLegs.${activeLeg - 1}.optionType`}
          render={({ field }) => (
            <Select value={(field.value as string) ?? ""} onValueChange={field.onChange}>
              <SelectTrigger aria-label="Option type">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CE">CE</SelectItem>
                <SelectItem value="PE">PE</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>
    </>
  );
}

export function DirectionField({ core, touch }: { core: TradeCore; touch?: boolean }) {
  const { activeLeg } = core;
  return (
    <div className="space-y-1">
      <FieldLabel>Direction</FieldLabel>
      <Controller
        control={core.form.control}
        name={activeLeg === 0 ? "direction" : `extraLegs.${activeLeg - 1}.direction`}
        render={({ field }) => (
          <SegmentedControl
            ariaLabel="Direction"
            value={field.value as "long" | "short"}
            onChange={field.onChange}
            capitalize
            size={touch ? "touch" : "sm"}
            options={[
              { value: "long", label: "long", tone: "profit" },
              { value: "short", label: "short", tone: "loss" },
            ]}
          />
        )}
      />
    </div>
  );
}

export function QtyField({ core }: { core: TradeCore }) {
  const { activeLeg } = core;
  const { register, setValue, watch, formState } = core.form;
  if (segmentUsesLots(core.segment)) {
    return (
      <div className="space-y-1.5">
        <LotQtyHelper
          symbol={watch("symbol")}
          segment={core.segment}
          units={activeLeg === 0 ? watch("qty") : watch(`extraLegs.${activeLeg - 1}.qty`)}
          onUnits={(u) =>
            activeLeg === 0
              ? setValue("qty", u, { shouldDirty: true, shouldValidate: true })
              : setValue(`extraLegs.${activeLeg - 1}.qty`, u, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
          }
        />
        {activeLeg === 0 && formState.errors.qty && (
          <p className="text-xs text-loss">{formState.errors.qty.message as string}</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <FieldLabel>Qty</FieldLabel>
      {activeLeg === 0 ? (
        <Input type="number" inputMode="numeric" placeholder="100" {...register("qty")} />
      ) : (
        <Input
          type="number"
          inputMode="numeric"
          placeholder="100"
          {...register(`extraLegs.${activeLeg - 1}.qty`)}
        />
      )}
      {activeLeg === 0 && formState.errors.qty && (
        <p className="text-xs text-loss">{formState.errors.qty.message as string}</p>
      )}
    </div>
  );
}

export function EntryExit({ core }: { core: TradeCore }) {
  const { activeLeg } = core;
  const { register, formState } = core.form;
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <FieldLabel>Entry ₹</FieldLabel>
        {activeLeg === 0 ? (
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="120.50"
            {...register("avgEntry")}
          />
        ) : (
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="120.50"
            {...register(`extraLegs.${activeLeg - 1}.avgEntry`)}
          />
        )}
        {activeLeg === 0 && formState.errors.avgEntry && (
          <p className="text-xs text-loss">{formState.errors.avgEntry.message as string}</p>
        )}
      </div>
      <div className="space-y-1">
        <FieldLabel>Exit ₹</FieldLabel>
        {activeLeg === 0 ? (
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="blank = open"
            {...register("avgExit")}
          />
        ) : (
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            placeholder="blank = open"
            {...register(`extraLegs.${activeLeg - 1}.avgExit`)}
          />
        )}
      </div>
    </div>
  );
}

export function RiskPlanFields({ core }: { core: TradeCore }) {
  const { register } = core.form;
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="space-y-1">
        <FieldLabel>Stop loss</FieldLabel>
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          placeholder="risk per trade"
          {...register("plannedSl")}
        />
      </div>
      <div className="space-y-1">
        <FieldLabel>Target</FieldLabel>
        <Input type="number" inputMode="decimal" step="any" {...register("plannedTarget")} />
      </div>
      <div className="space-y-1">
        <FieldLabel quiet>Planned entry</FieldLabel>
        <Input type="number" inputMode="decimal" step="any" {...register("plannedEntry")} />
      </div>
    </div>
  );
}

export function SetupFields({ core }: { core: TradeCore }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <FieldLabel>Playbook / setup</FieldLabel>
        <Controller
          control={core.form.control}
          name="playbookId"
          render={({ field }) => (
            <Select value={field.value ?? ""} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                {core.playbooks.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>
      <div className="space-y-1">
        <FieldLabel>Confidence</FieldLabel>
        <Controller
          control={core.form.control}
          name="confidence"
          render={({ field }) => (
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => field.onChange(field.value === n ? undefined : n)}
                  className={cn(
                    "h-9 flex-1 rounded-lg border text-sm transition-colors",
                    field.value && field.value >= n
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-muted hover:bg-surface-2"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

export function TagsField({ core }: { core: TradeCore }) {
  return (
    <Controller
      control={core.form.control}
      name="tagIds"
      render={({ field }) => <TagPicker value={field.value} onChange={field.onChange} />}
    />
  );
}

export function NotesField({ core }: { core: TradeCore }) {
  return (
    <div className="space-y-1">
      <FieldLabel>Notes</FieldLabel>
      <Textarea
        placeholder="What was the thesis? What did you see?"
        {...core.form.register("notes")}
      />
    </div>
  );
}

export function TimingFields({ core }: { core: TradeCore }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <FieldLabel quiet>Opened at</FieldLabel>
          <Controller
            control={core.form.control}
            name="openedAt"
            render={({ field }) => (
              <DateTimePicker
                value={field.value}
                onChange={field.onChange}
                disableFuture
                aria-label="Opened at"
              />
            )}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel quiet>Closed at</FieldLabel>
          <Controller
            control={core.form.control}
            name="closedAt"
            render={({ field }) => (
              <DateTimePicker
                value={field.value ?? ""}
                onChange={field.onChange}
                disableFuture
                aria-label="Closed at"
              />
            )}
          />
        </div>
      </div>
      {core.holdLabel && (
        <p className="text-xs text-muted">
          Holding period: <span className="font-medium text-foreground">{core.holdLabel}</span>
        </p>
      )}
    </div>
  );
}

export function ChargesField({ core }: { core: TradeCore }) {
  return (
    <div className="space-y-1">
      <FieldLabel quiet>Charges override ₹</FieldLabel>
      <Input
        type="number"
        inputMode="decimal"
        step="any"
        placeholder="blank = auto-calculated"
        aria-label="Charges override"
        {...core.form.register("manualCharges")}
      />
    </div>
  );
}

/** Open/Closed status pill derived from the exit field (text + tint, colorblind-safe). */
export function StatusChip({ core }: { core: TradeCore }) {
  return core.isClosed ? (
    <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
      Closed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Open
    </span>
  );
}

/** Live preview: Gross/Charges/Net for closed, or Exposure for open. */
export function PreviewBar({ core }: { core: TradeCore }) {
  if (core.preview) {
    const p = core.preview;
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-xs text-muted">
          Gross <PnlText value={p.gross} /> · Charges{" "}
          <span className="font-money">₹{p.charges.toFixed(2)}</span>
          {p.r != null && <> · {p.r}R</>}
        </span>
        <PnlText value={p.net} className="text-base font-semibold" />
      </div>
    );
  }
  if (core.exposure != null) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-xs text-muted">Open position</span>
        <span className="font-money text-sm font-semibold">
          Exposure ₹{core.exposure.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
        </span>
      </div>
    );
  }
  return <span className="text-xs text-muted">Enter qty &amp; entry to preview</span>;
}

const CHIPS: { key: keyof TradeCore["completeness"]; label: string }[] = [
  { key: "plan", label: "Plan" },
  { key: "setup", label: "Setup" },
  { key: "tags", label: "Tags" },
  { key: "notes", label: "Notes" },
];

/** Non-blocking journaling-completeness chips. Tap an empty one to jump to it. */
export function CompletenessChips({ core }: { core: TradeCore }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CHIPS.map((c) => {
        const filled = core.completeness[c.key];
        return (
          <span
            key={c.key}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium",
              filled
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-dashed border-border text-muted"
            )}
          >
            {c.label} {filled ? "✓" : "○"}
          </span>
        );
      })}
    </div>
  );
}
