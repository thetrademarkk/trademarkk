"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowRight, ClipboardList, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useDraftStore } from "@/stores/draft-store";
import { productsForSegment } from "@/features/trades/schemas";
import type { Segment, Product } from "@/features/trades/types";
import { usePlansStore } from "@/stores/plans-store";
import { planToFormDefaults, planRiskReward, type TradePlan } from "../pre-trade-plan";

const SEGMENT_OPTIONS: { value: Segment; label: string }[] = [
  { value: "EQ", label: "Equity" },
  { value: "FUT", label: "Futures" },
  { value: "OPT", label: "Options" },
  { value: "COMM", label: "Commodity" },
  { value: "CDS", label: "Currency" },
];
const PRODUCT_LABELS: Record<Product, string> = {
  MIS: "Intraday",
  CNC: "Delivery",
  NRML: "Carry-forward",
  BTST: "BTST",
  STBT: "STBT",
};

const num = (s: string): number | undefined => {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * "Plan a trade": log an idea (symbol/segment/product/direction + planned
 * entry/SL/target + rationale) BEFORE execution. Saved client-side; taking the
 * plan opens the quick-add form pre-filled, writing the planned_* columns so
 * plan-adherence (discipline v2) has real planned levels to grade against.
 */
export function PlanTradeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { plans, add, markExecuted, remove } = usePlansStore();
  const { setQuickAddOpen } = useUiStore();
  const { setTradeDraft } = useDraftStore();

  const [symbol, setSymbol] = React.useState("");
  const [segment, setSegment] = React.useState<Segment>("EQ");
  const [direction, setDirection] = React.useState<"long" | "short">("long");
  const [product, setProduct] = React.useState<Product>("MIS");
  const [entry, setEntry] = React.useState("");
  const [sl, setSl] = React.useState("");
  const [target, setTarget] = React.useState("");
  const [rationale, setRationale] = React.useState("");

  // Keep product valid when the segment changes.
  React.useEffect(() => {
    const allowed = productsForSegment(segment);
    if (!allowed.includes(product) && allowed[0]) setProduct(allowed[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  const reset = () => {
    setSymbol("");
    setEntry("");
    setSl("");
    setTarget("");
    setRationale("");
  };

  const liveRR = React.useMemo(() => {
    const e = num(entry);
    const s = num(sl);
    if (e == null || s == null || e === s) return null;
    const t = num(target);
    if (t == null) return null;
    return Math.round((Math.abs(t - e) / Math.abs(e - s)) * 100) / 100;
  }, [entry, sl, target]);

  const savePlan = () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      toast.error("Add a symbol to plan a trade");
      return;
    }
    const id = add({
      symbol: sym,
      segment,
      product,
      direction,
      plannedEntry: num(entry),
      plannedSl: num(sl),
      plannedTarget: num(target),
      rationale: rationale.trim() || undefined,
    });
    if (id) {
      toast.success("Plan logged");
      reset();
    }
  };

  const takePlan = (plan: TradePlan) => {
    setTradeDraft(planToFormDefaults(plan));
    markExecuted(plan.id);
    onOpenChange(false);
    setQuickAddOpen(true);
  };

  const pending = plans.filter((p) => !p.executedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-accent" aria-hidden /> Plan a trade
          </DialogTitle>
          <DialogDescription>
            Log the idea before you take it. Taking a plan pre-fills the trade form with your
            planned entry, stop and target.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <Label>Symbol</Label>
              <Input
                placeholder="NIFTY / RELIANCE"
                autoCapitalize="characters"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Segment</Label>
              <Select value={segment} onValueChange={(v) => setSegment(v as Segment)}>
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
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Direction</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["long", "short"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDirection(d)}
                    className={cn(
                      "h-9 rounded-lg border text-sm font-medium capitalize transition-colors",
                      direction === d
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
            </div>
            <div className="space-y-1">
              <Label>Product</Label>
              <Select value={product} onValueChange={(v) => setProduct(v as Product)}>
                <SelectTrigger aria-label="Product">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {productsForSegment(segment).map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRODUCT_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label>Planned entry</Label>
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                aria-label="Planned entry"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Stop loss</Label>
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                aria-label="Planned stop loss"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Target</Label>
              <Input
                type="number"
                step="any"
                inputMode="decimal"
                aria-label="Planned target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </div>
          </div>
          {liveRR != null && (
            <p className="text-xs text-muted" data-testid="plan-rr">
              Planned reward:risk ={" "}
              <span className="font-medium text-foreground">{liveRR.toFixed(2)}R</span>
            </p>
          )}

          <div className="space-y-1">
            <Label>Why this idea? (optional)</Label>
            <Textarea
              rows={2}
              placeholder="Thesis, trigger, invalidation…"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </div>

          <Button className="w-full" onClick={savePlan}>
            Log plan
          </Button>
        </div>

        {pending.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <div className="micro-label">Planned trades ({pending.length})</div>
            <div className="space-y-1.5">
              {pending.map((p) => {
                const rr = planRiskReward(p);
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg border bg-surface-2/50 px-3 py-2"
                    data-testid="planned-trade"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="truncate">{p.symbol}</span>
                        <span
                          className={cn(
                            "text-[11px] uppercase",
                            p.direction === "long" ? "text-profit" : "text-loss"
                          )}
                        >
                          {p.direction}
                        </span>
                        <span className="text-[11px] text-muted">{p.segment}</span>
                      </div>
                      <div className="text-xs text-muted">
                        {p.plannedEntry != null && <>Entry {p.plannedEntry} </>}
                        {p.plannedSl != null && <>· SL {p.plannedSl} </>}
                        {p.plannedTarget != null && <>· T {p.plannedTarget} </>}
                        {rr != null && <>· {rr.toFixed(2)}R</>}
                      </div>
                    </div>
                    <Button size="sm" className="h-8 shrink-0" onClick={() => takePlan(p)}>
                      Take <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted hover:text-loss"
                      aria-label={`Delete plan ${p.symbol}`}
                      onClick={() => remove(p.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
