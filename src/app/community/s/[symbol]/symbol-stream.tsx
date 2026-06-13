"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Info, LineChart, MessageSquareText, PenSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Composer, Feed } from "@/features/community";
import { SentimentGauge } from "@/features/community/components/sentiment-gauge";
import { COMMUNITY_DRAFT_KEY, readDraft } from "@/features/community/draft";
import type { FeedSort } from "@/features/community/api";
import type { Exchange } from "@/features/community/symbols";

/**
 * Per-symbol ($cashtag) stream — Latest / Top tabs over posts tagged with the
 * symbol, a not-advice banner, and a composer pre-seeded with the cashtag.
 * The header (symbol/name/exchange/count) is server-rendered for SEO; this
 * client shell owns the tabs, feed and composer dialog.
 */
export function SymbolStream({
  symbol,
  name,
  exchange,
  initialCount,
}: {
  symbol: string;
  name: string | null;
  exchange: Exchange | null;
  initialCount: number;
}) {
  const [sort, setSort] = React.useState<FeedSort>("latest");
  const [composeOpen, setComposeOpen] = React.useState(false);

  const tabs: { id: FeedSort; label: string }[] = [
    { id: "latest", label: "Latest" },
    { id: "top", label: "Top" },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link
        href="/community"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to community
      </Link>

      {/* ── Symbol header ── */}
      <header className="rounded-xl border bg-surface p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"
          >
            <LineChart className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold leading-tight">
              <span className="font-money">${symbol}</span>
              {exchange && (
                <span className="rounded-md border px-1.5 py-0.5 text-[11px] font-medium text-muted">
                  {exchange}
                </span>
              )}
            </h1>
            {name && <p className="truncate text-sm text-muted">{name}</p>}
            <p className="mt-1 text-xs text-muted">
              <span className="font-money">{initialCount}</span>{" "}
              {initialCount === 1 ? "post" : "posts"}
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => setComposeOpen(true)}>
            <PenSquare aria-hidden /> <span className="hidden sm:inline">Post</span>
          </Button>
        </div>

        {/* Not-advice banner — non-negotiable on a per-ticker page. */}
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-[11px] leading-4 text-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span data-not-advice>
            Educational discussion only — nothing here about ${symbol} is investment advice, a
            recommendation, or a buy/sell call.
          </span>
        </p>
      </header>

      {/* ── 24h/7d community sentiment gauge (never a buy/sell signal) ── */}
      <SentimentGauge symbol={symbol} />

      {/* ── Tabs ── */}
      <div
        role="tablist"
        aria-label={`${symbol} stream sort`}
        className="mt-4 flex items-center gap-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={sort === t.id}
            onClick={() => setSort(t.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              sort === t.id
                ? "bg-accent/12 font-medium text-accent"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Feed scoped to this symbol ── */}
      <section aria-label={`Posts about ${symbol}`} className="mt-3">
        <Feed sort={sort} tag={null} scope="all" symbol={symbol} />
      </section>

      {/* Empty-state nudge with the leading icon (Feed renders its own empty
          state too; this is just the always-present invitation to contribute). */}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
        Tag ${symbol} in a post to add it here.
      </p>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent
          onInteractOutside={(e) => {
            if (readDraft(COMMUNITY_DRAFT_KEY)) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Post about ${symbol}</DialogTitle>
          </DialogHeader>
          <Composer draftKey={COMMUNITY_DRAFT_KEY} onPosted={() => setComposeOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
