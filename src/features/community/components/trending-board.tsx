"use client";

import * as React from "react";
import Link from "next/link";
import { Flame, Hash, Info, LineChart, TrendingUp, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTrending, type TrendingBoardItem } from "../api";
import { formatCount } from "../format";

type Window = "24h" | "7d";

/** A trending row links to the right surface: tickers → /s/, topics → /t/. */
function rowHref(kind: "ticker" | "topic", key: string): string {
  return kind === "ticker"
    ? `/community/s/${encodeURIComponent(key)}`
    : `/community/t/${encodeURIComponent(key)}`;
}

/** A single ranked row: rank, label, and the unique-author / post counts. */
function TrendingRow({
  kind,
  rank,
  item,
  compact,
}: {
  kind: "ticker" | "topic";
  rank: number;
  item: TrendingBoardItem;
  compact: boolean;
}) {
  const label = kind === "ticker" ? `$${item.key}` : `#${item.key}`;
  return (
    <li>
      <Link
        href={rowHref(kind, item.key)}
        data-trending-row={kind}
        className={cn(
          "group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2",
          compact ? "text-sm" : "text-sm sm:text-base"
        )}
      >
        <span
          aria-hidden
          className="w-4 shrink-0 text-right font-money text-xs tabular-nums text-muted"
        >
          {rank}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium group-hover:text-accent">{label}</span>
        <span
          className="flex shrink-0 items-center gap-1 text-xs text-muted"
          title="Distinct authors discussing this"
        >
          <Users className="h-3.5 w-3.5" aria-hidden />
          <span className="font-money tabular-nums">{formatCount(item.authors)}</span>
        </span>
        <span
          className="hidden shrink-0 items-center gap-1 text-xs text-muted xs:flex"
          title="Posts in this window"
        >
          <TrendingUp className="h-3.5 w-3.5" aria-hidden />
          <span className="font-money tabular-nums">{formatCount(item.posts)}</span>
        </span>
      </Link>
    </li>
  );
}

/** One ranked column (Tickers or Topics) with its own empty state. */
function TrendingColumn({
  kind,
  items,
  compact,
}: {
  kind: "ticker" | "topic";
  items: TrendingBoardItem[];
  compact: boolean;
}) {
  const Icon = kind === "ticker" ? LineChart : Hash;
  const heading = kind === "ticker" ? "Trending tickers" : "Trending topics";
  return (
    <section aria-label={heading} className="min-w-0">
      <h2 className="micro-label mb-2 flex items-center gap-1.5 px-2">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {heading}
      </h2>
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted">Not enough activity yet.</p>
      ) : (
        <ol className="space-y-0.5">
          {items.map((item, i) => (
            <TrendingRow key={item.key} kind={kind} rank={i + 1} item={item} compact={compact} />
          ))}
        </ol>
      )}
    </section>
  );
}

/** The non-negotiable "discussion volume, not a recommendation" disclaimer. */
function Disclaimer({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-[11px] leading-4 text-muted",
        className
      )}
    >
      <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
      <span data-not-advice>
        Reflects community discussion volume, not a recommendation or tip. Ranked by the number of
        distinct traders discussing each — never a buy/sell signal.
      </span>
    </p>
  );
}

const WINDOWS: { id: Window; label: string }[] = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
];

/**
 * Trending board — what the community is actively discussing, ranked by the
 * number of DISTINCT traders talking about each ticker / topic (so one prolific
 * poster can't manufacture a trend). Two variants:
 *
 *  - `variant="full"` (the /community/trending page): a two-column board with a
 *    24h / 7d window toggle and a prominent disclaimer.
 *  - `variant="compact"` (the right-rail widget): the same data, condensed to
 *    the top few of each, a smaller window toggle, and a link to the full board.
 *
 * Both share the `useTrending` query (block-aware server-side, CDN-cached for
 * anonymous viewers). Never a buy/sell signal — the disclaimer is always shown.
 */
export function TrendingBoard({
  variant = "full",
  topN,
}: {
  variant?: "full" | "compact";
  topN?: number;
}) {
  const compact = variant === "compact";
  const [window, setWindow] = React.useState<Window>("24h");
  const { data, isLoading } = useTrending(window);

  const limit = topN ?? (compact ? 5 : undefined);
  const tickers = limit ? (data?.tickers ?? []).slice(0, limit) : (data?.tickers ?? []);
  const topics = limit ? (data?.topics ?? []).slice(0, limit) : (data?.topics ?? []);

  // These buttons FILTER the same board (no separate tabpanel per window), so an
  // aria-pressed button group is the honest, fully keyboard-reachable pattern —
  // a role="tab" without arrow-key roving + a tabpanel would mislead AT users.
  const toggle = (
    <div role="group" aria-label="Trending window" className="flex items-center gap-1">
      {WINDOWS.map((w) => (
        <button
          key={w.id}
          type="button"
          aria-pressed={window === w.id}
          aria-label={`Show the last ${w.label}`}
          onClick={() => setWindow(w.id)}
          className={cn(
            "rounded-md px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            window === w.id
              ? "bg-accent/12 font-medium text-accent"
              : "text-muted hover:bg-surface-2 hover:text-foreground"
          )}
        >
          {w.label}
        </button>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className="rounded-xl border bg-surface p-4" data-testid="trending-widget">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Flame className="h-4 w-4 text-accent" aria-hidden /> Trending
          </h2>
          {toggle}
        </div>
        <Disclaimer className="mb-3" />
        <div className="space-y-3">
          <TrendingColumn kind="ticker" items={tickers} compact />
          <TrendingColumn kind="topic" items={topics} compact />
        </div>
        <Link
          href="/community/trending"
          className="mt-3 block text-center text-xs font-medium text-accent hover:underline"
        >
          See full board
        </Link>
        {isLoading && <span className="sr-only">Loading trending</span>}
      </div>
    );
  }

  return (
    <div data-testid="trending-board">
      <Disclaimer className="mb-5" />
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-xs text-muted">Latest community discussion focus</p>
        {toggle}
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-xl border bg-surface p-4">
          <TrendingColumn kind="ticker" items={tickers} compact={false} />
        </div>
        <div className="rounded-xl border bg-surface p-4">
          <TrendingColumn kind="topic" items={topics} compact={false} />
        </div>
      </div>
      {isLoading && <span className="sr-only">Loading trending</span>}
    </div>
  );
}
