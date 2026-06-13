"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownUp,
  Ban,
  Check,
  ExternalLink,
  Flag,
  Loader2,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { cn, timeAgo } from "@/lib/utils";
import {
  useModQueue,
  type ModQueueItemView,
  type ModSort,
  type ModSourceFilter,
  type ModStatusFilter,
} from "./use-admin-overview";

type ActionInput = {
  action: "dismiss" | "delete-content" | "clear-flag" | "ban-user" | "unban-user";
  reportId?: string;
  postId?: string;
  userId?: string;
};

const SOURCE_TABS: { id: ModSourceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "report", label: "Reports" },
  { id: "flag", label: "Auto-flagged" },
];

const STATUS_TABS: { id: ModStatusFilter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "actioned", label: "Actioned" },
  { id: "all", label: "All" },
];

/**
 * Unified moderation queue (rank-14): user reports + auto-flagged posts in one
 * filterable, paginated list. Admin-only — the API gates every call on isAdmin.
 */
export function ReportsSection() {
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const [source, setSource] = React.useState<ModSourceFilter>("all");
  const [status, setStatus] = React.useState<ModStatusFilter>("open");
  const [sort, setSort] = React.useState<ModSort>("newest");
  const [page, setPage] = React.useState(1);

  const { data, isLoading, isFetching } = useModQueue({ source, status, sort, page });

  const act = useMutation({
    mutationFn: async (input: ActionInput) => {
      const res = await fetch("/api/admin/moderation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Action failed");
      return input.action;
    },
    onSuccess: (action) => {
      toast.success(
        action === "dismiss"
          ? "Report dismissed"
          : action === "delete-content"
            ? "Content removed"
            : action === "clear-flag"
              ? "Flag cleared"
              : action === "ban-user"
                ? "User suspended"
                : "User reinstated"
      );
      void qc.invalidateQueries({ queryKey: ["admin-moderation"] });
    },
    onError: () => toast.error("Action failed"),
  });

  // Reset to page 1 whenever a filter changes.
  const changeFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  if (isLoading) return <Skeleton className="h-72 rounded-xl" />;

  const items = data?.items ?? [];
  const open = data?.openCounts ?? { reports: 0, flags: 0 };

  return (
    <div className="space-y-4">
      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <SegTabs
          ariaLabel="Filter by source"
          tabs={SOURCE_TABS.map((t) => ({
            ...t,
            count: t.id === "report" ? open.reports : t.id === "flag" ? open.flags : undefined,
          }))}
          active={source}
          onSelect={(id) => changeFilter(() => setSource(id))}
        />
        <SegTabs
          ariaLabel="Filter by status"
          tabs={STATUS_TABS}
          active={status}
          onSelect={(id) => changeFilter(() => setStatus(id))}
        />
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => changeFilter(() => setSort((s) => (s === "newest" ? "oldest" : "newest")))}
        >
          <ArrowDownUp aria-hidden />
          {sort === "newest" ? "Newest first" : "Oldest first"}
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={status === "open" ? "Moderation queue is clear" : "Nothing here"}
          description={
            status === "open"
              ? "No open reports and nothing auto-flagged. New reports from the community land here."
              : "No items match this filter."
          }
        />
      ) : (
        <ul className="space-y-3" data-testid="mod-queue">
          {items.map((it) => (
            <ModRow
              key={it.key}
              item={it}
              busy={act.isPending}
              onDismiss={() => act.mutate({ action: "dismiss", reportId: it.key })}
              onClearFlag={() => act.mutate({ action: "clear-flag", postId: it.targetId })}
              onDelete={async () => {
                const ok = await confirmDialog({
                  title: "Delete this content?",
                  description: "This removes the post/comment for everyone. It cannot be undone.",
                  confirmLabel: "Remove content",
                  destructive: true,
                });
                if (!ok) return;
                if (it.source === "report")
                  act.mutate({ action: "delete-content", reportId: it.key });
                // Auto-flagged posts have no report row — clear the flag is the
                // queue action; deletion of an unreported post happens in-context.
              }}
              onBan={async () => {
                if (!it.authorId) return;
                const banning = !it.authorBanned;
                const ok = await confirmDialog({
                  title: banning ? `Suspend @${it.author}?` : `Reinstate @${it.author}?`,
                  description: banning
                    ? "They will be blocked from posting or commenting until reinstated. Existing content stays."
                    : "They will be able to post and comment again.",
                  confirmLabel: banning ? "Suspend user" : "Reinstate user",
                  destructive: banning,
                });
                if (!ok) return;
                act.mutate({
                  action: banning ? "ban-user" : "unban-user",
                  userId: it.authorId,
                });
              }}
            />
          ))}
        </ul>
      )}

      {/* ── Pagination ── */}
      {data && data.pageCount > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted">
            Page <span className="font-money">{data.page}</span> of{" "}
            <span className="font-money">{data.pageCount}</span> · {data.total} total
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={data.page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page >= data.pageCount || isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A horizontal segmented button group used for the source/status filters. */
function SegTabs<T extends string>({
  tabs,
  active,
  onSelect,
  ariaLabel,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onSelect: (id: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-lg bg-surface-2/60 p-1"
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.id)}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors",
              isActive
                ? "bg-surface font-medium text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            )}
          >
            {t.label}
            {typeof t.count === "number" && t.count > 0 && (
              <span className="rounded-full bg-warning/15 px-1.5 font-money text-[10px] leading-none text-warning">
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** One moderation queue row: content preview + context + moderator actions. */
function ModRow({
  item,
  busy,
  onDismiss,
  onDelete,
  onClearFlag,
  onBan,
}: {
  item: ModQueueItemView;
  busy: boolean;
  onDismiss: () => void;
  onDelete: () => void;
  onClearFlag: () => void;
  onBan: () => void;
}) {
  const isFlag = item.source === "flag";
  return (
    <li
      className={cn(
        "rounded-xl border bg-surface p-4",
        isFlag ? "border-warning/40 bg-warning/5" : ""
      )}
      data-source={item.source}
      data-status={item.status}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Badge variant={isFlag ? "warning" : "secondary"}>
          {isFlag ? (
            <>
              <Flag className="h-3 w-3" aria-hidden /> {item.label}
            </>
          ) : (
            item.targetType
          )}
        </Badge>
        {!isFlag && <Badge variant="outline">{item.label}</Badge>}
        {item.author && <span>by @{item.author}</span>}
        {item.authorBanned && (
          <Badge variant="loss">
            <Ban className="h-3 w-3" aria-hidden /> suspended
          </Badge>
        )}
        {item.reporter && <span>· reported by @{item.reporter}</span>}
        {item.status === "actioned" && <Badge variant="outline">actioned</Badge>}
        <time dateTime={item.createdAt} className="ml-auto">
          {timeAgo(item.createdAt)} ago
        </time>
      </div>

      {item.note && <p className="mt-1.5 text-xs italic text-muted">“{item.note}”</p>}

      <p className="mt-2 rounded-lg bg-surface-2/50 px-3 py-2 text-sm">
        {item.preview ?? <span className="italic text-muted">Content already deleted</span>}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.postId && (
          <Button variant="outline" size="sm" asChild>
            <a href={`/community/post/${item.postId}`} target="_blank" rel="noopener">
              <ExternalLink aria-hidden /> View in context
            </a>
          </Button>
        )}

        {/* Dismiss is a report-only action (a flag is cleared instead). */}
        {item.source === "report" && item.status === "open" && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onDismiss}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            Dismiss
          </Button>
        )}

        {isFlag && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onClearFlag}>
            <Check aria-hidden /> Clear flag
          </Button>
        )}

        {/* Delete the underlying content (reported items only — a flagged post is
            removed in-context; clearing the flag is the queue action here). */}
        {item.source === "report" && item.preview && (
          <Button variant="destructive" size="sm" disabled={busy} onClick={onDelete}>
            <Trash2 aria-hidden /> Remove content
          </Button>
        )}

        {/* Suspend / reinstate the author. */}
        {item.authorId && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onBan}>
            {item.authorBanned ? (
              <>
                <ShieldCheck aria-hidden /> Reinstate
              </>
            ) : (
              <>
                <ShieldOff aria-hidden /> Suspend user
              </>
            )}
          </Button>
        )}
      </div>
    </li>
  );
}
