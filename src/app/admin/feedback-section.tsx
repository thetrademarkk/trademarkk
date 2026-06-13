"use client";

import * as React from "react";
import { Inbox } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { cn, timeAgo } from "@/lib/utils";
import { useAdminOverview } from "./use-admin-overview";

const CATEGORY_VARIANT = { bug: "loss", idea: "default", other: "secondary" } as const;
const FILTERS = ["all", "bug", "idea", "other"] as const;

export function FeedbackSection() {
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("all");
  const { data, isLoading } = useAdminOverview();
  if (isLoading) return <Skeleton className="h-60 rounded-xl" />;

  const all = data?.feedback ?? [];
  const items = filter === "all" ? all : all.filter((f) => f.category === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5" role="tablist" aria-label="Feedback category">
        {FILTERS.map((f) => {
          const count = f === "all" ? all.length : all.filter((x) => x.category === f).length;
          return (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1.5 text-xs capitalize transition-colors",
                filter === f
                  ? "border-accent/40 bg-accent/12 font-medium text-accent"
                  : "text-muted hover:text-foreground"
              )}
            >
              {f} {count > 0 && <span className="font-money">{count}</span>}
            </button>
          );
        })}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filter === "all" ? "No feedback yet" : `No ${filter} feedback`}
          description="Feedback submitted from the site footer dialog lands here."
        />
      ) : (
        <div className="space-y-3">
          {items.map((f) => (
            <article key={f.id} className="rounded-xl border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge
                  variant={CATEGORY_VARIANT[f.category as keyof typeof CATEGORY_VARIANT] ?? "secondary"}
                >
                  {f.category}
                </Badge>
                {f.email && <span>{f.email}</span>}
                {f.path && <span className="font-mono">{f.path}</span>}
                <time dateTime={f.createdAt} className="ml-auto">
                  {timeAgo(f.createdAt)} ago
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{f.message}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
