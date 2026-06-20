"use client";

import * as React from "react";
import { useForm, useFieldArray, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { cn, formatHoldTime } from "@/lib/utils";
import {
  isDerivativeSegment,
  productsForSegment,
  tradeFormSchema,
  type TradeFormValues,
} from "../schemas";
import { useAccounts, usePlaybooks, useSaveTrade } from "../queries";
import { deriveTradeNumbers, localInputToIso, nowLocalInput } from "../utils";
import { TagPicker } from "./tag-picker";
import { LotQtyHelper } from "./lot-qty-helper";
import { segmentUsesLots } from "@/lib/instruments/lot-sizes";
import { TemplateMenu } from "@/features/workflow";
import type { TemplatePatch } from "@/features/workflow";

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

interface TradeFormProps {
  tradeId?: string;
  /** Shown as the inline heading (host dialogs render their own sr-only title). */
  title?: string;
  defaults?: Partial<TradeFormValues>;
  onSaved?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onDraftChange?: (values: Partial<TradeFormValues>) => void;
  onSavedClearDraft?: () => void;
}

/** A labeled form section (Instrument / Execution / Plan & journal / Timing). */
function Group({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One label/value line in the summary rail. */
function RailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-money">{children}</span>
    </div>
  );
}

/**
 * The Add/Edit trade modal — "Adaptive Broker Ticket" layout: labeled form
 * sections on the left and a persistent summary rail on the right (desktop),
 * which stacks below the form as a summary+Save footer on mobile. The rail shows
 * the running consequence (Net / charges / R, or Exposure for an open trade),
 * holding period, journaling-completeness chips and the Save button.
 *
 * Everything stays VISIBLE (no field is hidden behind a toggle — a prior attempt
 * at that killed journaling completion). Draft persistence, the dirty-dismiss
 * guard and edit mode are all preserved via the host callbacks.
 */
export function TradeForm({
  tradeId,
  title,
  defaults,
  onSaved,
  onDirtyChange,
  onDraftChange,
  onSavedClearDraft,
}: TradeFormProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: playbooks = [] } = usePlaybooks();
  const saveTrade = useSaveTrade();

  const form = useForm<TradeFormValues>({
    resolver: zodResolver(tradeFormSchema) as Resolver<TradeFormValues>,
    defaultValues: {
      accountId: accounts[0]?.id ?? "",
      symbol: "",
      segment: "EQ",
      product: "MIS",
      direction: "long",
      openedAt: nowLocalInput(),
      tagIds: [],
      ...defaults,
    },
  });
  const { register, handleSubmit, watch, control, setValue, formState } = form;
  const extraLegs = useFieldArray({ control, name: "extraLegs" });
  const [activeLeg, setActiveLeg] = React.useState(0);
  const legCount = 1 + extraLegs.fields.length;

  React.useEffect(() => {
    if (!watch("accountId") && accounts[0]) setValue("accountId", accounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  React.useEffect(() => {
    onDirtyChange?.(formState.isDirty);
  }, [formState.isDirty, onDirtyChange]);
  React.useEffect(() => {
    if (!onDraftChange) return;
    const sub = watch((values) => onDraftChange(values as Partial<TradeFormValues>));
    return () => sub.unsubscribe();
  }, [watch, onDraftChange]);

  const segment = watch("segment");
  React.useEffect(() => {
    const allowed = productsForSegment(segment);
    const current = form.getValues("product");
    if (!current || !allowed.includes(current)) setValue("product", allowed[0]);
    if (segment !== "OPT") {
      setValue("strike", undefined);
      setValue("optionType", undefined);
    }
    if (!isDerivativeSegment(segment)) setValue("expiry", undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  const addLeg = () => {
    extraLegs.append({
      direction: "long",
      qty: "" as unknown as number,
      avgEntry: "" as unknown as number,
      avgExit: undefined,
      strike: undefined,
      optionType: undefined,
    });
    setActiveLeg(legCount);
  };
  const removeLeg = (i: number) => {
    extraLegs.remove(i - 1);
    setActiveLeg(Math.max(0, i - 1));
  };
  const legHasError = (i: number): boolean => {
    if (i === 0)
      return Boolean(formState.errors.strike || formState.errors.qty || formState.errors.avgEntry);
    return Boolean(formState.errors.extraLegs?.[i - 1]);
  };

  const values = watch();
  const account = accounts.find((a) => a.id === values.accountId);
  const preview = React.useMemo(() => {
    try {
      const parsed = tradeFormSchema.safeParse(values);
      if (!parsed.success || parsed.data.avgExit == null) return null;
      return deriveTradeNumbers(parsed.data, account?.charge_profile ?? "zerodha");
    } catch {
      return null;
    }
  }, [values, account]);

  // Open-trade notional exposure = Σ(qty × entry) across legs — so the rail is
  // never empty for an open position (deriveTradeNumbers needs an exit).
  const exposure = React.useMemo(() => {
    const legs = [
      { qty: values.qty, entry: values.avgEntry },
      ...(values.extraLegs ?? []).map((l) => ({ qty: l.qty, entry: l.avgEntry })),
    ];
    let sum = 0;
    let any = false;
    for (const l of legs) {
      const q = Number(l.qty);
      const e = Number(l.entry);
      if (Number.isFinite(q) && Number.isFinite(e) && q > 0 && e > 0) {
        sum += q * e;
        any = true;
      }
    }
    return any ? sum : null;
  }, [values]);

  const isClosed = values.avgExit != null && String(values.avgExit).trim() !== "";

  const onSubmit = handleSubmit(async (data) => {
    try {
      await saveTrade.mutateAsync({ values: data, id: tradeId });
      toast.success(tradeId ? "Trade updated" : "Trade saved");
      onSavedClearDraft?.();
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save trade");
    }
  });

  const err = (name: keyof TradeFormValues) =>
    formState.errors[name]?.message as string | undefined;

  const holdLabel = React.useMemo(() => {
    if (!values.openedAt) return null;
    try {
      const openedIso = localInputToIso(values.openedAt);
      const closedIso = values.closedAt ? localInputToIso(values.closedAt) : null;
      return formatHoldTime(openedIso, closedIso);
    } catch {
      return null;
    }
  }, [values.openedAt, values.closedAt]);

  const completeness = {
    plan: Boolean(values.plannedSl || values.plannedTarget),
    setup: Boolean(values.confidence || values.playbookId),
    tags: (values.tagIds?.length ?? 0) > 0,
    notes: Boolean(values.notes?.trim()),
  };

  const applyTemplate = React.useCallback(
    (patch: TemplatePatch) => {
      setValue("notes", patch.notes, { shouldDirty: true });
      if (patch.playbookId !== undefined)
        setValue("playbookId", patch.playbookId, { shouldDirty: true });
      if (patch.confidence !== undefined)
        setValue("confidence", patch.confidence, { shouldDirty: true });
    },
    [setValue]
  );

  const usesLots = segmentUsesLots(segment);
  const legUnits = activeLeg === 0 ? values.qty : values.extraLegs?.[activeLeg - 1]?.qty;
  const setLegUnits = (u: number) =>
    activeLeg === 0
      ? setValue("qty", u, { shouldDirty: true, shouldValidate: true })
      : setValue(`extraLegs.${activeLeg - 1}.qty`, u, { shouldDirty: true, shouldValidate: true });

  const statusChip = isClosed ? (
    <span className="rounded-full border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
      Closed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Open
    </span>
  );

  const completenessChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      {(
        [
          ["plan", "Plan"],
          ["setup", "Setup"],
          ["tags", "Tags"],
          ["notes", "Notes"],
        ] as const
      ).map(([k, label]) => (
        <span
          key={k}
          className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            completeness[k]
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-dashed text-muted"
          )}
        >
          {label} {completeness[k] ? "✓" : "○"}
        </span>
      ))}
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div
        className={cn("flex items-center gap-2 pr-6", title ? "justify-between" : "justify-end")}
      >
        {title && <span className="text-base font-semibold">{title}</span>}
        <TemplateMenu
          onApply={applyTemplate}
          current={{
            notes: values.notes,
            playbookId: values.playbookId,
            confidence: values.confidence,
          }}
          playbooks={playbooks}
        />
      </div>

      <div className="md:grid md:grid-cols-[1fr_13rem] md:gap-5">
        {/* ── LEFT: form sections ── */}
        <div className="space-y-5">
          <Group title="Instrument">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-2">
                <Label>Symbol</Label>
                <Input
                  placeholder="NIFTY / RELIANCE"
                  autoCapitalize="characters"
                  {...register("symbol")}
                />
                {err("symbol") && <p className="text-xs text-loss">{err("symbol")}</p>}
              </div>
              <div className="space-y-1">
                <Label>Segment</Label>
                <Controller
                  control={control}
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
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Product</Label>
                <Controller
                  control={control}
                  name="product"
                  render={({ field }) => {
                    const allowed = productsForSegment(segment);
                    return (
                      <SegmentedControl
                        ariaLabel="Product"
                        value={field.value ?? undefined}
                        onChange={field.onChange}
                        columns={Math.min(allowed.length, 2)}
                        className="gap-2"
                        options={allowed.map((p) => ({ value: p, label: PRODUCT_LABELS[p] }))}
                      />
                    );
                  }}
                />
                {err("product") && <p className="text-xs text-loss">{err("product")}</p>}
              </div>
              {isDerivativeSegment(segment) && (
                <div className="space-y-1">
                  <Label>Expiry</Label>
                  <Controller
                    control={control}
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
              )}
            </div>
          </Group>

          <Group
            title="Execution"
            action={
              <div className="flex items-center gap-2">
                {statusChip}
                {legCount === 1 ? (
                  <button
                    type="button"
                    onClick={addLeg}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden /> Add leg
                  </button>
                ) : null}
              </div>
            }
          >
            {legCount > 1 && (
              <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-surface-2/60 p-1">
                {Array.from({ length: legCount }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveLeg(i)}
                    aria-current={activeLeg === i ? "step" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      activeLeg === i
                        ? "bg-bg text-foreground shadow-sm"
                        : "text-muted hover:text-foreground"
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
            )}

            <div key={activeLeg} className="space-y-3">
              {segment === "OPT" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Strike</Label>
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
                    {activeLeg === 0 && err("strike") && (
                      <p className="text-xs text-loss">{err("strike")}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label>CE / PE</Label>
                    <Controller
                      control={control}
                      name={
                        activeLeg === 0 ? "optionType" : `extraLegs.${activeLeg - 1}.optionType`
                      }
                      render={({ field }) => (
                        <Select
                          value={(field.value as string) ?? ""}
                          onValueChange={field.onChange}
                        >
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
                </div>
              )}

              <div className="space-y-1">
                <Label>Direction</Label>
                <Controller
                  control={control}
                  name={activeLeg === 0 ? "direction" : `extraLegs.${activeLeg - 1}.direction`}
                  render={({ field }) => (
                    <SegmentedControl
                      ariaLabel="Direction"
                      value={field.value as "long" | "short"}
                      onChange={field.onChange}
                      capitalize
                      options={[
                        { value: "long", label: "long", tone: "profit" },
                        { value: "short", label: "short", tone: "loss" },
                      ]}
                    />
                  )}
                />
              </div>

              {usesLots ? (
                <div className="space-y-1.5">
                  <LotQtyHelper
                    symbol={values.symbol}
                    segment={segment}
                    units={legUnits}
                    onUnits={setLegUnits}
                  />
                  {activeLeg === 0 && err("qty") && (
                    <p className="text-xs text-loss">{err("qty")}</p>
                  )}
                  {activeLeg > 0 && formState.errors.extraLegs?.[activeLeg - 1]?.qty && (
                    <p className="text-xs text-loss">
                      {formState.errors.extraLegs[activeLeg - 1]?.qty?.message}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Qty</Label>
                  {activeLeg === 0 ? (
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="100"
                      {...register("qty")}
                    />
                  ) : (
                    <Input
                      type="number"
                      inputMode="numeric"
                      placeholder="100"
                      {...register(`extraLegs.${activeLeg - 1}.qty`)}
                    />
                  )}
                  {activeLeg === 0 && err("qty") && (
                    <p className="text-xs text-loss">{err("qty")}</p>
                  )}
                  {activeLeg > 0 && formState.errors.extraLegs?.[activeLeg - 1]?.qty && (
                    <p className="text-xs text-loss">
                      {formState.errors.extraLegs[activeLeg - 1]?.qty?.message}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Entry ₹</Label>
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
                  {activeLeg === 0 && err("avgEntry") && (
                    <p className="text-xs text-loss">{err("avgEntry")}</p>
                  )}
                  {activeLeg > 0 && formState.errors.extraLegs?.[activeLeg - 1]?.avgEntry && (
                    <p className="text-xs text-loss">
                      {formState.errors.extraLegs[activeLeg - 1]?.avgEntry?.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label>Exit ₹</Label>
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
            </div>
          </Group>

          <Group title="Plan & journal">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>Stop loss</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  placeholder="risk per trade"
                  {...register("plannedSl")}
                />
              </div>
              <div className="space-y-1">
                <Label>Target</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  {...register("plannedTarget")}
                />
              </div>
              <div className="space-y-1">
                <Label>Planned entry</Label>
                <Input type="number" inputMode="decimal" step="any" {...register("plannedEntry")} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Playbook / setup</Label>
                <Controller
                  control={control}
                  name="playbookId"
                  render={({ field }) => (
                    <Select value={field.value ?? ""} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        {playbooks.map((p) => (
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
                <Label>Confidence</Label>
                <Controller
                  control={control}
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
                              : "text-muted hover:bg-surface-2"
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
            <Controller
              control={control}
              name="tagIds"
              render={({ field }) => <TagPicker value={field.value} onChange={field.onChange} />}
            />
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                placeholder="What was the thesis? What did you see?"
                {...register("notes")}
              />
            </div>
          </Group>

          <Group title="Timing & charges">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Opened at</Label>
                <Controller
                  control={control}
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
                <Label>Closed at</Label>
                <Controller
                  control={control}
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
            {holdLabel && (
              <p className="text-xs text-muted" data-testid="hold-period">
                Holding period: <span className="font-medium text-foreground">{holdLabel}</span>
              </p>
            )}
            <div className="space-y-1">
              <Label>Charges override ₹</Label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="blank = auto-calculated"
                aria-label="Charges override"
                {...register("manualCharges")}
              />
            </div>
          </Group>
        </div>

        {/* ── RIGHT: summary rail (desktop) / bottom summary + Save (mobile) ── */}
        <aside className="hidden space-y-3 rounded-lg border bg-surface-2/40 p-3 md:flex md:flex-col md:self-start md:[position:sticky] md:top-0">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-muted">
            Summary
          </span>
          <RailRow label="Status">{statusChip}</RailRow>
          {preview ? (
            <>
              <RailRow label="Gross">
                <PnlText value={preview.gross} />
              </RailRow>
              <RailRow label="Charges">₹{preview.charges.toFixed(2)}</RailRow>
              {preview.r != null && <RailRow label="R multiple">{preview.r}R</RailRow>}
              <div className="border-t pt-2">
                <RailRow label="Net">
                  <PnlText value={preview.net} className="text-base font-semibold" />
                </RailRow>
              </div>
            </>
          ) : (
            <RailRow label={exposure != null ? "Exposure" : "Net"}>
              {exposure != null
                ? `₹${exposure.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                : "—"}
            </RailRow>
          )}
          <RailRow label="Holding">{holdLabel ?? "—"}</RailRow>
          <div className="border-t pt-2">{completenessChips}</div>
          <Button type="submit" className="w-full" disabled={saveTrade.isPending}>
            {saveTrade.isPending ? "Saving…" : tradeId ? "Update trade" : "Save trade"}
          </Button>
        </aside>
      </div>

      {/* Mobile broker-ticket footer — the consequence + Save, always reachable */}
      <div className="sticky bottom-0 z-10 -mx-5 -mb-5 border-t bg-surface/95 px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
        <div className="mb-2">{completenessChips}</div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted">
              {preview || exposure == null ? "Net" : "Exposure"}
            </div>
            <div className="truncate font-money text-base font-semibold tabular-nums">
              {preview ? (
                <PnlText value={preview.net} />
              ) : exposure != null ? (
                `₹${exposure.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
              ) : (
                "—"
              )}
            </div>
          </div>
          <Button type="submit" className="h-11 shrink-0 px-6" disabled={saveTrade.isPending}>
            {saveTrade.isPending ? "Saving…" : tradeId ? "Update" : "Save trade"}
          </Button>
        </div>
      </div>
    </form>
  );
}
