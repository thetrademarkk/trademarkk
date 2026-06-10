"use client";

import * as React from "react";
import { useForm, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PnlText } from "@/components/shared/pnl-text";
import { cn } from "@/lib/utils";
import { tradeFormSchema, type TradeFormValues } from "../schemas";
import { useAccounts, usePlaybooks, useSaveTrade } from "../queries";
import { deriveTradeNumbers, nowLocalInput } from "../utils";
import { TagPicker } from "./tag-picker";

interface TradeFormProps {
  tradeId?: string;
  defaults?: Partial<TradeFormValues>;
  quick?: boolean;
  onSaved?: () => void;
}

export function TradeForm({ tradeId, defaults, quick = false, onSaved }: TradeFormProps) {
  const { data: accounts = [] } = useAccounts();
  const { data: playbooks = [] } = usePlaybooks();
  const saveTrade = useSaveTrade();
  const [showMore, setShowMore] = React.useState(!quick);

  const form = useForm<TradeFormValues>({
    resolver: zodResolver(tradeFormSchema) as Resolver<TradeFormValues>,
    defaultValues: {
      accountId: accounts[0]?.id ?? "",
      symbol: "",
      segment: "OPT",
      direction: "long",
      openedAt: nowLocalInput(),
      tagIds: [],
      ...defaults,
    },
  });
  const { register, handleSubmit, watch, control, setValue, formState } = form;

  // Default the account once accounts load.
  React.useEffect(() => {
    if (!watch("accountId") && accounts[0]) setValue("accountId", accounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

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
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save trade");
    }
  });

  const err = (name: keyof TradeFormValues) => formState.errors[name]?.message as string | undefined;
  const segment = values.segment;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <Label>Symbol</Label>
          <Input placeholder="NIFTY / RELIANCE" autoCapitalize="characters" {...register("symbol")} />
          {err("symbol") && <p className="text-xs text-loss">{err("symbol")}</p>}
        </div>
        <div className="space-y-1">
          <Label>Segment</Label>
          <Controller
            control={control}
            name="segment"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPT">Options</SelectItem>
                  <SelectItem value="FUT">Futures</SelectItem>
                  <SelectItem value="EQ">Equity</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      {segment === "OPT" && (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label>Strike</Label>
            <Input type="number" step="any" placeholder="24500" {...register("strike")} />
            {err("strike") && <p className="text-xs text-loss">{err("strike")}</p>}
          </div>
          <div className="space-y-1">
            <Label>CE / PE</Label>
            <Controller
              control={control}
              name="optionType"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CE">CE</SelectItem>
                    <SelectItem value="PE">PE</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1">
            <Label>Expiry</Label>
            <Input type="date" {...register("expiry")} />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label>Direction</Label>
        <Controller
          control={control}
          name="direction"
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
          <Input type="number" placeholder="75" {...register("qty")} />
          {err("qty") && <p className="text-xs text-loss">{err("qty")}</p>}
        </div>
        <div className="space-y-1">
          <Label>Entry ₹</Label>
          <Input type="number" step="any" placeholder="120.50" {...register("avgEntry")} />
          {err("avgEntry") && <p className="text-xs text-loss">{err("avgEntry")}</p>}
        </div>
        <div className="space-y-1">
          <Label>Exit ₹</Label>
          <Input type="number" step="any" placeholder="blank = open" {...register("avgExit")} />
        </div>
      </div>

      {quick && (
        <button
          type="button"
          onClick={() => setShowMore((s) => !s)}
          className="text-xs text-accent hover:underline"
        >
          {showMore ? "Hide options" : "More options (SL, playbook, tags…)"}
        </button>
      )}

      {showMore && (
        <div className="space-y-4 animate-fade-in">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Planned entry</Label>
              <Input type="number" step="any" {...register("plannedEntry")} />
            </div>
            <div className="space-y-1">
              <Label>Stop loss</Label>
              <Input type="number" step="any" {...register("plannedSl")} />
            </div>
            <div className="space-y-1">
              <Label>Target</Label>
              <Input type="number" step="any" {...register("plannedTarget")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Opened at</Label>
              <Input type="datetime-local" {...register("openedAt")} />
            </div>
            <div className="space-y-1">
              <Label>Closed at</Label>
              <Input type="datetime-local" {...register("closedAt")} />
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
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      {playbooks.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
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
          <div className="space-y-1">
            <Label>Charges override ₹ (blank = auto-calculated)</Label>
            <Input type="number" step="any" {...register("manualCharges")} />
          </div>
        </div>
      )}

      {preview && (
        <div className="flex items-center justify-between rounded-lg border bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted text-xs">
            Gross <PnlText value={preview.gross} /> · Charges{" "}
            <span className="font-money">₹{preview.charges.toFixed(0)}</span>
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
