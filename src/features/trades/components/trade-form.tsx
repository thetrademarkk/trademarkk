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

/**
 * Field order is deliberate (journaling priority): instrument → direction →
 * execution (qty/entry/exit) → risk plan (SL/target — drives R-multiple and
 * plan-vs-actual review) → setup & conviction → psychology tags → notes →
 * timing (auto-filled) → charges override. Everything is visible — hiding the
 * risk plan behind a toggle meant nobody filled it.
 */
interface TradeFormProps {
  tradeId?: string;
  defaults?: Partial<TradeFormValues>;
  onSaved?: () => void;
  /** Reports dirty state so the host dialog can guard accidental dismissal. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Persists in-progress values (quick-add) so nothing is ever lost. */
  onDraftChange?: (values: Partial<TradeFormValues>) => void;
  onSavedClearDraft?: () => void;
}

export function TradeForm({
  tradeId,
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
      // App-wide neutral default EQ + MIS. The host (QuickAdd) passes a SEG-08
      // trader-type default segment/product via `defaults` for a blank new-trade
      // form, so it's part of the initial render — the controlled segment select
      // reflects it without any post-mount mutation. Editing / restored drafts
      // pin their own segment through `defaults` too.
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

  // Default the account once accounts load.
  React.useEffect(() => {
    if (!watch("accountId") && accounts[0]) setValue("accountId", accounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Surface dirty state + stream a draft of every change to the host.
  React.useEffect(() => {
    onDirtyChange?.(formState.isDirty);
  }, [formState.isDirty, onDirtyChange]);
  React.useEffect(() => {
    if (!onDraftChange) return;
    const sub = watch((values) => onDraftChange(values as Partial<TradeFormValues>));
    return () => sub.unsubscribe();
  }, [watch, onDraftChange]);

  // When the segment changes, keep `product` valid for it (EQ products differ
  // from derivative products). Also clear option/expiry fields the new segment
  // doesn't use so stale data never persists.
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
    setActiveLeg(legCount); // jump to the new leg
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

  // Derived, read-only holding period from opened/closed timestamps.
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

  // Quick-apply a note/journal template — fills setup notes + playbook +
  // confidence in one click. Marks the form dirty so the draft + save flow run.
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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex justify-end">
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
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
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

      {/* Product — trader-type intent. EQ offers MIS/CNC/BTST/STBT; derivatives
          offer MIS/NRML. Drives the per-(segment,product) charge engine. */}
      <div className="space-y-1">
        <Label>Product</Label>
        <Controller
          control={control}
          name="product"
          render={({ field }) => {
            const allowed = productsForSegment(segment);
            return (
              <div className="grid grid-cols-2 gap-2 xs:grid-cols-4">
                {allowed.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={field.value === p}
                    onClick={() => field.onChange(p)}
                    className={cn(
                      "h-9 rounded-lg border px-2 text-xs font-medium transition-colors",
                      field.value === p
                        ? "border-accent bg-accent/15 text-accent"
                        : "text-muted hover:bg-surface-2"
                    )}
                  >
                    {PRODUCT_LABELS[p]}
                  </button>
                ))}
              </div>
            );
          }}
        />
        {err("product") && <p className="text-xs text-loss">{err("product")}</p>}
      </div>

      {/* ── Leg stepper: each strategy leg (straddle/spread) gets its own page ── */}
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

      {/* ── Active leg panel — keyed by leg so inputs remount with that leg's values ── */}
      <div key={activeLeg} className="space-y-4 rounded-lg border border-dashed p-3">
        {/* Strike + CE/PE: OPT only. Expiry: every derivative (FUT/OPT/COMM/CDS).
            Equity (cash) shows neither — it has no strike, type or expiry. */}
        {(segment === "OPT" || isDerivativeSegment(segment)) && (
          <div className="grid grid-cols-3 gap-2">
            {segment === "OPT" && (
              <>
                <div className="space-y-1">
                  <Label>Strike</Label>
                  {activeLeg === 0 ? (
                    <Input type="number" step="any" placeholder="24500" {...register("strike")} />
                  ) : (
                    <Input
                      type="number"
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
            )}
            <div className="space-y-1">
              <Label>Expiry{legCount > 1 ? " (all legs)" : ""}</Label>
              <Controller
                control={control}
                name="expiry"
                render={({ field }) => (
                  <DatePicker
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    disabled={activeLeg !== 0}
                    aria-label="Expiry date"
                  />
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
              <div className="grid grid-cols-2 gap-2">
                {(["long", "short"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => field.onChange(d)}
                    className={cn(
                      "h-9 rounded-lg border text-sm font-medium capitalize transition-colors",
                      field.value === d
                        ? d === "long"
                          ? "border-profit bg-profit/15 text-profit"
                          : "border-loss bg-loss/15 text-loss"
                        : "text-muted hover:bg-surface-2"
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label>Qty</Label>
            {activeLeg === 0 ? (
              <Input type="number" placeholder="75" {...register("qty")} />
            ) : (
              <Input
                type="number"
                placeholder="75"
                {...register(`extraLegs.${activeLeg - 1}.qty`)}
              />
            )}
            {activeLeg === 0 && err("qty") && <p className="text-xs text-loss">{err("qty")}</p>}
            {activeLeg > 0 && formState.errors.extraLegs?.[activeLeg - 1]?.qty && (
              <p className="text-xs text-loss">
                {formState.errors.extraLegs[activeLeg - 1]?.qty?.message}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Entry ₹</Label>
            {activeLeg === 0 ? (
              <Input type="number" step="any" placeholder="120.50" {...register("avgEntry")} />
            ) : (
              <Input
                type="number"
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
              <Input type="number" step="any" placeholder="blank = open" {...register("avgExit")} />
            ) : (
              <Input
                type="number"
                step="any"
                placeholder="blank = open"
                {...register(`extraLegs.${activeLeg - 1}.avgExit`)}
              />
            )}
          </div>
        </div>

        {/* SEG-10 — lots↔units helper. Derivatives only (EQ is plain units). It
            writes units (lots × lot size) into the active leg's Qty, which stays
            the single source of truth, so charges/P&L are byte-identical to
            typing the unit qty directly. Lot size auto-fills from the reference
            and is fully overridable; an unknown symbol never blocks entry. */}
        {segmentUsesLots(segment) && (
          <LotQtyHelper
            symbol={values.symbol}
            segment={segment}
            units={activeLeg === 0 ? values.qty : values.extraLegs?.[activeLeg - 1]?.qty}
            onUnits={(u) =>
              activeLeg === 0
                ? setValue("qty", u, { shouldDirty: true, shouldValidate: true })
                : setValue(`extraLegs.${activeLeg - 1}.qty`, u, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
            }
          />
        )}
      </div>

      <div className="space-y-4">
        {/* Risk plan — SL first: it powers R-multiples and plan-vs-actual review. */}
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label>Stop loss</Label>
            <Input
              type="number"
              step="any"
              placeholder="risk per trade"
              {...register("plannedSl")}
            />
          </div>
          <div className="space-y-1">
            <Label>Target</Label>
            <Input type="number" step="any" {...register("plannedTarget")} />
          </div>
          <div className="space-y-1">
            <Label>Planned entry</Label>
            <Input type="number" step="any" {...register("plannedEntry")} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
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
          <Textarea placeholder="What was the thesis? What did you see?" {...register("notes")} />
        </div>
        {/* Timing auto-fills to "now" — editing it is the exception, so it sits low. */}
        <div className="grid grid-cols-2 gap-2">
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
        {/* Derived, read-only holding period (from opened/closed). */}
        {holdLabel && (
          <p className="text-xs text-muted" data-testid="hold-period">
            Holding period: <span className="font-medium text-foreground">{holdLabel}</span>
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="manualCharges">Charges override ₹ (blank = auto-calculated)</Label>
          <Input
            id="manualCharges"
            type="number"
            step="any"
            aria-label="Charges override"
            {...register("manualCharges")}
          />
        </div>
      </div>

      {preview && (
        <div className="flex items-center justify-between rounded-lg border bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted text-xs">
            Gross <PnlText value={preview.gross} /> · Charges{" "}
            <span className="font-money">₹{preview.charges.toFixed(2)}</span>
            {preview.r != null && <> · {preview.r}R</>}
          </span>
          <PnlText value={preview.net} className="text-base font-semibold" />
        </div>
      )}

      <Button type="submit" className="w-full" disabled={saveTrade.isPending}>
        {saveTrade.isPending ? "Saving…" : tradeId ? "Update trade" : "Save trade"}
      </Button>
    </form>
  );
}
