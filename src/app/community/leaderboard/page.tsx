"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Flame, Heart, MessageCircle, PenSquare, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { CommunityAvatar } from "@/features/community";
import { ReputationChip } from "@/features/community/components/reputation-chip";
import { useLeaderboard } from "@/features/community/api";
import { topBadge } from "@/lib/streak-badges";
import type { LeaderboardRow } from "@/features/community/types";

const PODIUM_RING = ["ring-yellow-400", "ring-slate-300", "ring-amber-600"];

function metric(row: LeaderboardRow, board: "contrib" | "streak") {
  return board === "streak" ? `${row.current} days` : `${row.score} pts`;
}

function RowBadge({ best }: { best?: number }) {
  const b = best != null ? topBadge(best) : null;
  if (!b) return null;
  return (
    <span
      title={b.name}
      className={cn("flex h-6 w-6 items-center justify-center rounded-full", b.bg)}
    >
      <b.icon className={cn("h-3.5 w-3.5", b.color)} aria-hidden />
    </span>
  );
}

export default function LeaderboardPage() {
  const [board, setBoard] = React.useState<"contrib" | "streak">("contrib");
  const [period, setPeriod] = React.useState<"month" | "all">("month");
  const { data, isLoading } = useLeaderboard(board, period);
  const rows = data?.rows ?? [];
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        href="/community"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to community
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Trophy className="h-5 w-5 text-accent" aria-hidden /> Leaderboard
        </h1>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-surface-2/60 p-1 text-xs font-medium">
          {(["contrib", "streak"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBoard(b)}
              aria-pressed={board === b}
              className={cn(
                "rounded-md px-3 py-1.5 transition-colors",
                board === b ? "bg-bg text-foreground shadow-sm" : "text-muted hover:text-foreground"
              )}
            >
              {b === "contrib" ? "Contributors" : "Streaks"}
            </button>
          ))}
        </div>
        {board === "contrib" && (
          <div className="flex items-center gap-1 rounded-lg bg-surface-2/60 p-1 text-xs font-medium">
            {(["month", "all"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  period === p
                    ? "bg-bg text-foreground shadow-sm"
                    : "text-muted hover:text-foreground"
                )}
              >
                {p === "month" ? "30 days" : "All time"}
              </button>
            ))}
          </div>
        )}
      </div>

      {board === "streak" && (
        <p className="mt-2 text-xs text-muted">
          Shared by choice from each trader&apos;s own journal.
        </p>
      )}

      {isLoading ? (
        <Skeleton className="mt-6 h-72 rounded-xl" />
      ) : rows.length === 0 ? (
        <p className="mt-12 rounded-xl border border-dashed py-14 text-center text-sm text-muted">
          {board === "streak"
            ? "No shared streaks yet — be the first! Turn it on from the flame in your journal header."
            : "No activity yet this period."}
        </p>
      ) : (
        <>
          {/* ── Podium ── */}
          {podium.length === 3 && (
            <div className="mt-6 grid grid-cols-3 items-end gap-3">
              {[podium[1]!, podium[0]!, podium[2]!].map((r, i) => {
                const place = i === 1 ? 0 : i === 0 ? 1 : 2;
                return (
                  <Link
                    key={r.username}
                    href={`/community/u/${r.username}`}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-xl border bg-surface p-4 text-center transition-transform hover:-translate-y-0.5",
                      place === 0 && "pb-7 pt-6",
                      r.me && "border-accent/60"
                    )}
                  >
                    <span
                      className={cn(
                        "rounded-full ring-2 ring-offset-2 ring-offset-surface",
                        PODIUM_RING[place]
                      )}
                    >
                      <CommunityAvatar
                        size={place === 0 ? "lg" : "md"}
                        username={r.username}
                        displayName={r.displayName}
                        avatar={r.avatar}
                      />
                    </span>
                    <span className="font-money text-lg font-bold leading-none">#{r.rank}</span>
                    <span className="w-full truncate text-sm font-medium">{r.displayName}</span>
                    <span className="font-money text-xs text-muted">{metric(r, board)}</span>
                    <RowBadge best={r.best} />
                  </Link>
                );
              })}
            </div>
          )}

          {/* ── Rows ── */}
          <div className="mt-4 divide-y rounded-xl border bg-surface">
            {(podium.length === 3 ? rest : rows).map((r) => (
              <Link
                key={r.username}
                href={`/community/u/${r.username}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60",
                  r.me && "bg-accent/5"
                )}
              >
                <span className="w-7 shrink-0 font-money text-sm text-muted">#{r.rank}</span>
                <CommunityAvatar
                  size="sm"
                  username={r.username}
                  displayName={r.displayName}
                  avatar={r.avatar}
                />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{r.displayName}</span>
                  {board === "contrib" && <ReputationChip tier={r.reputationTier} />}
                  {r.me && <span className="text-xs text-accent">(you)</span>}
                </span>
                {board === "contrib" ? (
                  <span className="hidden items-center gap-3 text-xs text-muted sm:flex">
                    <span className="flex items-center gap-1">
                      <PenSquare className="h-3 w-3" aria-hidden />
                      {r.posts}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageCircle className="h-3 w-3" aria-hidden />
                      {r.comments}
                    </span>
                    <span className="flex items-center gap-1">
                      <Heart className="h-3 w-3" aria-hidden />
                      {r.likesReceived}
                    </span>
                  </span>
                ) : (
                  <span className="hidden items-center gap-1 text-xs text-muted sm:flex">
                    <Flame className="h-3 w-3 text-warning" aria-hidden /> best {r.best}
                  </span>
                )}
                <RowBadge best={r.best} />
                <span className="w-20 shrink-0 text-right font-money text-sm font-semibold">
                  {metric(r, board)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
