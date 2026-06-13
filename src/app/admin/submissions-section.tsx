"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Newspaper, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RichContent } from "@/components/ui/rich-editor";
import { EmptyState } from "@/components/shared/empty-state";
import { cn, timeAgo } from "@/lib/utils";

interface Submission {
  id: string;
  title: string;
  excerpt: string;
  contentHtml: string;
  status: string;
  createdAt: string;
  authorName: string;
  authorHandle: string | null;
}

const STATUSES = ["pending", "approved", "rejected"] as const;

/** Blog review queue: community submissions → approve to publish, or reject. */
export function SubmissionsSection() {
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("pending");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-submissions", status],
    queryFn: async () => {
      const res = await fetch(`/api/blog/submissions?status=${status}`);
      if (!res.ok) throw new Error("Failed to load");
      return (await res.json()) as { submissions: Submission[] };
    },
  });

  const review = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "approve" | "reject" }) => {
      const res = await fetch(`/api/blog/submissions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error("Review failed");
      return action;
    },
    onSuccess: (action) => {
      toast.success(action === "approve" ? "Published" : "Rejected");
      void qc.invalidateQueries({ queryKey: ["admin-submissions"] });
      void qc.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: () => toast.error("Action failed"),
  });

  const submissions = data?.submissions ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" role="tablist" aria-label="Submission status">
        {STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1.5 text-xs capitalize transition-colors",
              status === s
                ? "border-accent/40 bg-accent/12 font-medium text-accent"
                : "text-muted hover:text-foreground"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : submissions.length === 0 ? (
        <EmptyState
          icon={Newspaper}
          title={`No ${status} submissions`}
          description={
            status === "pending"
              ? "Community blog submissions waiting for review will appear here."
              : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {submissions.map((s) => (
            <article key={s.id} className="rounded-xl border bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{s.title}</h2>
                  <p className="mt-0.5 text-xs text-muted">
                    by {s.authorName}
                    {s.authorHandle && ` (@${s.authorHandle})`} · {timeAgo(s.createdAt)} ago
                  </p>
                </div>
                {status === "pending" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="profit"
                      disabled={review.isPending}
                      onClick={() => review.mutate({ id: s.id, action: "approve" })}
                    >
                      {review.isPending ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <Check aria-hidden />
                      )}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={review.isPending}
                      onClick={() => review.mutate({ id: s.id, action: "reject" })}
                    >
                      <X aria-hidden /> Reject
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-2 text-sm text-muted">{s.excerpt}</p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-medium text-accent">
                  Preview full article
                </summary>
                <RichContent
                  html={s.contentHtml}
                  className="mt-3 rounded-lg border bg-surface-2/30 p-4 text-sm"
                />
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
