"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, Pencil, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { PnlText } from "@/components/shared/pnl-text";
import { ShareImagePanel } from "@/components/shared/share-image-panel";
import { TagChip } from "@/components/shared/tag-chip";
import { compressImage, imageFromClipboard } from "@/lib/images";
import { formatHoldTime, formatINR, todayKey } from "@/lib/utils";
import { describeInstrument } from "../types";
import { useAddAttachment, useDeleteAttachment, useDeleteTrade, useTrade } from "../queries";
import { buildTradeShareCard } from "../share-card";
import { isoToLocalInput } from "../utils";
import { TradeForm } from "./trade-form";
import type { TradeFormValues } from "../schemas";
import { Composer, type TradeCard } from "@/features/community";
import { PayoffDiagram } from "@/features/analytics/components/payoff-diagram";
import type { PayoffLeg } from "@/lib/options/payoff";

export function TradeDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data: trade, isLoading } = useTrade(id);
  const deleteTrade = useDeleteTrade();
  const addAttachment = useAddAttachment();
  const deleteAttachment = useDeleteAttachment();
  const [editOpen, setEditOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const editDirtyRef = React.useRef(false);
  const confirmDialog = useConfirm();

  React.useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const file = imageFromClipboard(e);
      if (!file) return;
      const data = await compressImage(file);
      await addAttachment.mutateAsync({ tradeId: id, data });
      toast.success("Screenshot attached");
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [id, addAttachment]);

  if (isLoading) return <Skeleton className="h-64" />;
  if (!trade) return <p className="text-sm text-muted">Trade not found.</p>;

  const formDefaults: Partial<TradeFormValues> = {
    accountId: trade.account_id,
    symbol: trade.symbol,
    segment: trade.segment,
    expiry: trade.expiry ?? undefined,
    strike: trade.strike ?? undefined,
    optionType: trade.option_type ?? undefined,
    direction: trade.direction,
    qty: trade.qty,
    avgEntry: trade.avg_entry,
    avgExit: trade.avg_exit ?? undefined,
    plannedEntry: trade.planned_entry ?? undefined,
    plannedSl: trade.planned_sl ?? undefined,
    plannedTarget: trade.planned_target ?? undefined,
    openedAt: isoToLocalInput(trade.opened_at),
    closedAt: trade.closed_at ? isoToLocalInput(trade.closed_at) : undefined,
    playbookId: trade.playbook_id ?? undefined,
    confidence: trade.confidence ?? undefined,
    notes: trade.notes ?? undefined,
    tagIds: trade.tags.map((t) => t.id),
    // Strategy legs 2..N (leg 1 already lives in the top-level fields).
    extraLegs:
      trade.legs.length > 1
        ? trade.legs.slice(1).map((l) => ({
            strike: l.strike ?? undefined,
            optionType: l.option_type ?? undefined,
            direction: l.direction,
            qty: l.qty,
            avgEntry: l.avg_entry,
            avgExit: l.avg_exit ?? undefined,
          }))
        : undefined,
  };

  const handleDelete = async () => {
    const ok = await confirmDialog({
      title: "Delete this trade?",
      description: "Journal links and attachments go with it. This cannot be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    await deleteTrade.mutateAsync(id);
    toast.success("Trade deleted");
    router.replace("/app/trades");
  };

  const journalDate = trade.opened_at.slice(0, 10);

  // Payoff diagram inputs: multi-leg trades carry explicit leg rows; a
  // single-leg OPT trade lives in the top-level fields (no leg row stored).
  const payoffLegs: PayoffLeg[] =
    trade.segment === "OPT"
      ? trade.legs.length > 0
        ? trade.legs
            .filter((l) => l.strike != null && l.option_type != null)
            .map((l) => ({
              strike: l.strike!,
              optionType: l.option_type!,
              direction: l.direction,
              qty: l.qty,
              premium: l.avg_entry,
            }))
        : trade.strike != null && trade.option_type != null
          ? [
              {
                strike: trade.strike,
                optionType: trade.option_type,
                direction: trade.direction,
                qty: trade.qty,
                premium: trade.avg_entry,
              },
            ]
          : []
      : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/app/trades" aria-label="Back to trades">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">{describeInstrument(trade)}</h1>
        <Badge variant={trade.direction === "long" ? "profit" : "loss"}>{trade.direction}</Badge>
        {trade.status === "open" && <Badge variant="warning">open</Badge>}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
            <Share2 className="h-3.5 w-3.5" /> Share
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>P&L breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Gross P&L</span>
              <PnlText value={trade.gross_pnl} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Charges</span>
              <span className="font-money">{formatINR(trade.charges, { decimals: true })}</span>
            </div>
            <div className="flex justify-between border-t pt-1.5 font-semibold">
              <span>Net P&L</span>
              <PnlText value={trade.net_pnl} className="text-base" />
            </div>
            {trade.r_multiple != null && (
              <div className="flex justify-between">
                <span className="text-muted">R multiple</span>
                <span className="font-money">{trade.r_multiple}R</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Execution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Qty</span>
              <span className="font-money">{trade.qty}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Avg entry</span>
              <span className="font-money">{trade.avg_entry.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Avg exit</span>
              <span className="font-money">{trade.avg_exit?.toFixed(2) ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Hold time</span>
              <span>{formatHoldTime(trade.opened_at, trade.closed_at)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Opened</span>
              <span className="text-xs">{new Date(trade.opened_at).toLocaleString("en-IN")}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Plan vs actual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Planned entry</span>
              <span className="font-money">{trade.planned_entry?.toFixed(2) ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Stop loss</span>
              <span className="font-money">{trade.planned_sl?.toFixed(2) ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Target</span>
              <span className="font-money">{trade.planned_target?.toFixed(2) ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Confidence</span>
              <span>{trade.confidence ? "★".repeat(trade.confidence) : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Setup</span>
              <span>{trade.playbook_name ?? "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {payoffLegs.length > 0 && <PayoffDiagram symbol={trade.symbol} legs={payoffLegs} />}

      {trade.legs.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Strategy legs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {trade.legs.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <Badge variant={l.direction === "long" ? "profit" : "loss"}>{l.direction}</Badge>
                  <span className="font-money">
                    {l.strike ?? "—"} {l.option_type ?? ""}
                  </span>
                  <span className="text-muted">× {l.qty}</span>
                </span>
                <span className="text-muted">
                  entry {l.avg_entry.toFixed(2)}
                  {l.avg_exit != null ? ` · exit ${l.avg_exit.toFixed(2)}` : ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {trade.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {trade.tags.map((t) => (
            <TagChip key={t.id} name={t.name} color={t.color} />
          ))}
        </div>
      )}

      {trade.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{trade.notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Screenshots</CardTitle>
          <label className="cursor-pointer">
            <span className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <ImagePlus className="h-3.5 w-3.5" /> Add (or paste anywhere)
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const data = await compressImage(f);
                await addAttachment.mutateAsync({ tradeId: id, data });
                toast.success("Screenshot attached");
              }}
            />
          </label>
        </CardHeader>
        <CardContent>
          {trade.attachments.length === 0 ? (
            <p className="text-xs text-muted">
              No screenshots yet. Paste a chart screenshot (Ctrl+V) to attach it.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {trade.attachments.map((a) => (
                <div key={a.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.data}
                    alt={a.caption ?? "Trade screenshot"}
                    className="rounded-lg border"
                  />
                  <button
                    onClick={() => deleteAttachment.mutate(a.id)}
                    className="absolute right-1 top-1 hidden rounded bg-black/70 p-1 text-white group-hover:block"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button variant="link" asChild className="px-0">
        <Link href={`/app/journal?date=${journalDate}`}>
          → View journal for {journalDate === todayKey() ? "today" : journalDate}
        </Link>
      </Button>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent
          onInteractOutside={(e) => {
            // Unsaved edits? A misclick outside must not discard them.
            if (editDirtyRef.current) e.preventDefault();
          }}
        >
          <DialogTitle className="sr-only">Edit trade</DialogTitle>
          <TradeForm
            tradeId={id}
            title="Edit trade"
            defaults={formDefaults}
            onSaved={() => setEditOpen(false)}
            onDirtyChange={(d) => (editDirtyRef.current = d)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Share trade</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="image">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="image">Image</TabsTrigger>
              <TabsTrigger value="post">Community post</TabsTrigger>
            </TabsList>
            <TabsContent value="image">
              <ShareImagePanel
                allowPnl={trade.status === "closed"}
                build={(includePnl) =>
                  buildTradeShareCard({ ...trade, legCount: trade.legs.length }, { includePnl })
                }
              />
            </TabsContent>
            <TabsContent value="post">
              <Composer
                tradeCard={
                  {
                    symbol: trade.symbol,
                    segment: trade.segment,
                    strike: trade.strike,
                    optionType: trade.option_type,
                    expiry: trade.expiry,
                    direction: trade.direction,
                    entry: trade.avg_entry,
                    exit: trade.avg_exit,
                    sl: trade.planned_sl,
                    target: trade.planned_target,
                    rMultiple: trade.r_multiple,
                    netPnl: trade.status === "closed" ? trade.net_pnl : null,
                    holdMins: trade.closed_at
                      ? Math.round(
                          (new Date(trade.closed_at).getTime() -
                            new Date(trade.opened_at).getTime()) /
                            60000
                        )
                      : null,
                    openedAt: trade.opened_at,
                  } satisfies TradeCard
                }
                onPosted={() => setShareOpen(false)}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
