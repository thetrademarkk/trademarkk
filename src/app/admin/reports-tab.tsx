"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { timeAgo } from "@/lib/utils";

interface ReportRow {
  id: string;
  targetType: "post" | "comment";
  targetId: string;
  reason: string | null;
  createdAt: string;
  reporter: string;
  targetPreview: string | null;
  postId: string | null;
}

/** Moderation queue: review reported content, dismiss or remove it. */
export function ReportsTab() {
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-reports"],
    queryFn: async () => {
      const res = await fetch("/api/admin/reports");
      if (!res.ok) throw new Error("Failed to load reports");
      return (await res.json()) as { reports: ReportRow[] };
    },
  });

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

  if (reports.length === 0) {
    return (
      <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted">
        No open reports.
      </p>
    );
  }

  return (
    <div className="space-y-3">
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
