"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Flag, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { timeAgo } from "@/lib/utils";
import { useAdminReports } from "./use-admin-overview";

/** Moderation queue: review reported content, dismiss or remove it. */
export function ReportsSection() {
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const { data, isLoading } = useAdminReports();

  const act = useMutation({
    mutationFn: async (input: { reportId: string; action: "dismiss" | "delete-content" }) => {
      const res = await fetch("/api/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Action failed");
      return input.action;
    },
    onSuccess: (action) => {
      toast.success(action === "dismiss" ? "Report dismissed" : "Content removed");
      void qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: () => toast.error("Action failed"),
  });

  if (isLoading) return <Skeleton className="h-60 rounded-xl" />;
  const reports = data?.reports ?? [];
  const flagged = data?.flagged ?? [];

  if (reports.length === 0 && flagged.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Moderation queue is clear"
        description="No open reports and nothing auto-flagged. New reports from the community land here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {flagged.length > 0 && (
        <section className="rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Flag className="h-4 w-4 text-warning" aria-hidden />
            Auto-flagged by the quality gate
            <Badge variant="secondary">{flagged.length}</Badge>
          </h3>
          <p className="mt-1 text-xs text-muted">
            Posts the content-quality gate flagged for review (tip/all-caps language). Not yet
            reported by the community — open in context to review or remove.
          </p>
          <ul className="mt-3 space-y-2">
            {flagged.map((p) => (
              <li key={p.id} className="rounded-lg border bg-surface px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge variant="warning">{p.flag}</Badge>
                  <span>by @{p.author}</span>
                  <time dateTime={p.createdAt} className="ml-auto">
                    {timeAgo(p.createdAt)} ago
                  </time>
                </div>
                <p className="mt-1.5 line-clamp-2">{p.preview}</p>
                <a
                  href={`/community/post/${p.id}`}
                  target="_blank"
                  rel="noopener"
                  className="mt-1.5 inline-block text-xs text-accent hover:underline"
                >
                  View in context
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {reports.map((r) => (
        <article key={r.id} className="rounded-xl border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge variant="warning">{r.targetType}</Badge>
            {r.reason && <Badge variant="secondary">{r.reason.split(":")[0]}</Badge>}
            <span>reported by @{r.reporter}</span>
            <time dateTime={r.createdAt} className="ml-auto">
              {timeAgo(r.createdAt)} ago
            </time>
          </div>
          {r.reason?.includes(":") && (
            <p className="mt-1.5 text-xs italic text-muted">
              “{r.reason.slice(r.reason.indexOf(":") + 1).trim()}”
            </p>
          )}
          <p className="mt-2 rounded-lg bg-surface-2/50 px-3 py-2 text-sm">
            {r.targetPreview ?? <span className="italic text-muted">Content already deleted</span>}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {r.postId && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/community/post/${r.postId}`} target="_blank" rel="noopener">
                  View in context
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={act.isPending}
              onClick={() => act.mutate({ reportId: r.id, action: "dismiss" })}
            >
              {act.isPending ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Check aria-hidden />
              )}
              Dismiss
            </Button>
            {r.targetPreview && (
              <Button
                variant="destructive"
                size="sm"
                disabled={act.isPending}
                onClick={async () =>
                  (await confirmDialog({
                    title: "Delete the reported content?",
                    description: "This cannot be undone.",
                    confirmLabel: "Remove content",
                    destructive: true,
                  })) && act.mutate({ reportId: r.id, action: "delete-content" })
                }
              >
                <Trash2 aria-hidden /> Remove content
              </Button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
