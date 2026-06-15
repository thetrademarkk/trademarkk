"use client";

import * as React from "react";
import { Layers, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { newId } from "@/lib/id";
import { formatPct } from "@/lib/utils";
import { closedOnly, groupBy } from "@/lib/stats/stats";
import { usePlaybooks, useTrades, type PlaybookRow } from "@/features/trades";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { PnlText } from "@/components/shared/pnl-text";
import { Ring } from "@/components/shared/ring";
import { PageHeader } from "@/components/shared/page-header";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function PlaybooksPanel() {
  const { db } = useDb();
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const { data: playbooks = [] } = usePlaybooks();
  const { data: trades = [] } = useTrades({});
  const [editing, setEditing] = React.useState<PlaybookRow | "new" | null>(null);

  const save = useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      description: string;
      criteria: string;
    }) => {
      const ts = new Date().toISOString();
      if (input.id) {
        await db.execute(
          `UPDATE playbooks SET name = ?, description = ?, criteria = ?, updated_at = ? WHERE id = ?`,
          [input.name, input.description, input.criteria, ts, input.id]
        );
      } else {
        await db.execute(
          `INSERT INTO playbooks (id, name, description, criteria, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [newId(), input.name, input.description, input.criteria, ts, ts]
        );
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      setEditing(null);
      toast.success("Playbook saved");
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await db.batch([
        { sql: `UPDATE trades SET playbook_id = NULL WHERE playbook_id = ?`, args: [id] },
        { sql: `DELETE FROM playbooks WHERE id = ?`, args: [id] },
      ]);
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  const closed = closedOnly(trades);
  const statsByPlaybook = new Map(
    groupBy(
      closed.filter((t) => t.playbook_id),
      (t) => t.playbook_id ?? ""
    ).map((s) => [s.key, s])
  );
  const unassigned = closed.filter((t) => !t.playbook_id).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Playbooks"
        description="Your setups, with proof of which ones pay."
        actions={
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus /> New playbook
          </Button>
        }
      />
      {unassigned > 0 && (
        <p className="inline-flex items-center gap-1.5 text-sm text-muted">
          <TriangleAlert className="h-3.5 w-3.5 text-warning" aria-hidden />
          {unassigned} closed trades have no setup assigned.
        </p>
      )}

      {playbooks.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No playbooks yet"
          description="Define your setups (criteria, rules) and track performance per setup."
          action={<Button onClick={() => setEditing("new")}>Create your first playbook</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {playbooks.map((p) => {
            const s = statsByPlaybook.get(p.id);
            return (
              <Card key={p.id}>
                <CardHeader className="flex-row items-start justify-between">
                  <div>
                    <CardTitle>{p.name}</CardTitle>
                    {p.description && <p className="mt-1 text-xs text-muted">{p.description}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted hover:text-loss"
                      aria-label="Delete playbook"
                      onClick={async () =>
                        (await confirmDialog({
                          title: "Delete playbook?",
                          description: "Trades keep their data.",
                          confirmLabel: "Delete",
                          destructive: true,
                        })) && remove.mutate(p.id)
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {s ? (
                    <div className="flex items-center gap-4">
                      <Ring
                        value={s.winRate * 100}
                        label={formatPct(s.winRate, 0)}
                        sub="win rate"
                        size={76}
                        stroke={7}
                        color={s.netPnl >= 0 ? "var(--profit)" : "var(--loss)"}
                      />
                      <div className="grid flex-1 grid-cols-2 gap-2 text-sm">
                        <div>
                          <div className="micro-label">Net P&L</div>
                          <PnlText value={s.netPnl} />
                        </div>
                        <div>
                          <div className="micro-label">Trades</div>
                          <span className="font-money">{s.trades}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted">No closed trades with this setup yet.</p>
                  )}
                  {p.criteria && (
                    <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs text-muted font-sans">
                      {p.criteria}
                    </pre>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New playbook" : "Edit playbook"}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save.mutate({
                id: editing !== "new" && editing ? editing.id : undefined,
                name: String(f.get("name")),
                description: String(f.get("description") ?? ""),
                criteria: String(f.get("criteria") ?? ""),
              });
            }}
          >
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                name="name"
                required
                defaultValue={editing !== "new" ? editing?.name : ""}
                placeholder="Opening Range Breakout"
              />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input
                name="description"
                defaultValue={editing !== "new" ? (editing?.description ?? "") : ""}
                placeholder="One-line summary"
              />
            </div>
            <div className="space-y-1">
              <Label>Criteria checklist</Label>
              <Textarea
                name="criteria"
                rows={5}
                defaultValue={editing !== "new" ? (editing?.criteria ?? "") : ""}
                placeholder={"- 15m range defined\n- Breakout with volume\n- Entry on retest"}
              />
            </div>
            <Button type="submit" className="w-full" disabled={save.isPending}>
              Save playbook
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
