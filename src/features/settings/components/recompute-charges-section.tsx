"use client";

import * as React from "react";
import { Calculator, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatINR } from "@/lib/utils";
import { useApplyRecompute, useRecomputePreview } from "@/features/trades";
import type { RecomputePreview } from "@/features/trades";

const DONE_KEY = "charges_recomputed_at";

/**
 * SEG-04 — "Recompute charges" maintenance card.
 *
 * Trades logged before the segment×product (delivery / intraday) model had
 * their charges computed by the old engine, which applied the INTRADAY STT
 * branch to every equity trade. This card previews + applies the corrected
 * per-(segment,product) charges (only charges / net P&L change; never gross).
 *
 * One-time by nature: once the user has run it (or there was nothing to fix),
 * a persisted marker (`charges_recomputed_at`) hides the whole card — it's a
 * maintenance fix the user shouldn't have to see again.
 */
export function RecomputeChargesSection() {
  const { db } = useDb();
  const qc = useQueryClient();
  const preview = useRecomputePreview();
  const apply = useApplyRecompute();
  const confirm = useConfirm();
  const [lastResult, setLastResult] = React.useState<RecomputePreview | null>(null);
  const busy = preview.isPending || apply.isPending;

  const { data: doneAt } = useQuery({
    queryKey: ["charges-recomputed-at"],
    queryFn: async () => {
      const res = await db.execute(`SELECT value FROM settings WHERE key = ?`, [DONE_KEY]);
      return (res.rows[0]?.value as string | undefined) ?? null;
    },
  });

  const markDone = async () => {
    await db.execute(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
      DONE_KEY,
      new Date().toISOString(),
    ]);
    void qc.invalidateQueries({ queryKey: ["charges-recomputed-at"] });
  };

  const run = async () => {
    setLastResult(null);
    let p: RecomputePreview;
    try {
      p = await preview.mutateAsync();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check charges");
      return;
    }

    if (p.changedCount === 0) {
      setLastResult(p);
      if (p.considered > 0) void markDone(); // nothing to fix → charges are already correct
      toast.success(
        p.considered === 0
          ? "No closed trades to check yet"
          : "All charges are already correct — nothing to recompute"
      );
      return;
    }

    const deltaWord = p.chargesDelta < 0 ? "reduced" : "increased";
    const ok = await confirm({
      title: `Recompute ${p.changedCount} trade${p.changedCount === 1 ? "" : "s"}?`,
      description:
        `${p.changedCount} of ${p.considered} closed trades will have their charges ${deltaWord} ` +
        `by ${formatINR(Math.abs(p.chargesDelta), { decimals: true })} in total ` +
        `(net P&L ${p.netDelta >= 0 ? "+" : "−"}${formatINR(Math.abs(p.netDelta), { decimals: true })}). ` +
        `Only charges and net P&L change — your entries, exits and gross P&L stay exactly as they are.`,
      confirmLabel: "Recompute charges",
    });
    if (!ok) return;

    try {
      const applied = await apply.mutateAsync();
      setLastResult(applied);
      void markDone();
      toast.success(
        `Recomputed ${applied.changedCount} trade${applied.changedCount === 1 ? "" : "s"}`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Recompute failed");
    }
  };

  const applied = !busy && lastResult != null && !preview.isPending;

  // Once the user has recomputed (flag persisted), hide the whole card — it's a
  // one-time maintenance fix and they don't want to see it again afterwards.
  if (doneAt) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <Calculator className="h-4 w-4 text-accent" aria-hidden />
        <CardTitle>Recompute charges</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">
          Older trades may have been logged before TradeMarkk knew the difference between an
          intraday and a delivery position. Their charges (and net P&amp;L) were estimated using
          intraday rates for <em>every</em> equity trade. Recomputing re-runs the current
          per-segment, per-product engine — correcting delivery STT, stamp duty and DP charges — so
          delivery and swing trades show their true cost.
        </p>
        <div className="flex items-start gap-2 rounded-lg border bg-surface-2/50 p-2.5 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Only <strong>charges</strong> and <strong>net P&amp;L</strong> are updated — your
            entries, exits and gross P&amp;L are never changed. You will see a preview and confirm
            before anything is written, and running it again is safe.
          </span>
        </div>

        {lastResult && lastResult.nullProductEqCount > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              {lastResult.nullProductEqCount} equity trade
              {lastResult.nullProductEqCount === 1 ? "" : "s"} could not be classified as intraday
              or delivery, so {lastResult.nullProductEqCount === 1 ? "it is" : "they are"} charged
              as intraday for now. Open the trade and set its product (intraday / delivery) to
              correct its charges.
            </span>
          </div>
        )}

        {applied && lastResult && lastResult.changedCount > 0 && (
          <div
            className="flex items-start gap-2 rounded-lg border border-profit/40 bg-profit/10 p-2.5 text-xs"
            data-testid="recompute-result"
          >
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-profit" aria-hidden />
            <span>
              Corrected {lastResult.changedCount} trade
              {lastResult.changedCount === 1 ? "" : "s"} — charges{" "}
              {lastResult.chargesDelta < 0 ? "down" : "up"}{" "}
              {formatINR(Math.abs(lastResult.chargesDelta), { decimals: true })}, net P&amp;L{" "}
              {lastResult.netDelta >= 0 ? "+" : "−"}
              {formatINR(Math.abs(lastResult.netDelta), { decimals: true })}.
            </span>
          </div>
        )}

        <Button size="sm" onClick={run} disabled={busy} data-testid="recompute-charges-btn">
          <Calculator className="h-3.5 w-3.5" />
          {busy ? "Checking…" : "Check & recompute charges"}
        </Button>
      </CardContent>
    </Card>
  );
}
