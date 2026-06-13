"use client";

import * as React from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Hash, PenSquare, X } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Composer,
  Feed,
  InlineComposer,
  SUGGESTED_TAGS,
  TrendingBoard,
  useMyProfile,
} from "@/features/community";
import { WatchlistRail } from "@/features/community/components/watchlist-rail";
import {
  useFollowedTags,
  useTrendingTags,
  type FeedScope,
  type FeedSort,
} from "@/features/community/api";
import type { FeedResponse } from "@/features/community/types";
import { FEED_CONTEXT_KEY } from "@/features/community/back-nav";
import { COMMUNITY_DRAFT_KEY, readDraft } from "@/features/community/draft";

/**
 * useSearchParams CSR-bails everything up to the nearest Suspense boundary on
 * a static route — if CommunityHome read it directly, the prerendered document
 * would only contain the fallback and the ISR-seeded feed would never reach
 * the HTML. This bridge isolates the bailout to a render-nothing child.
 */
function ParamsBridge({ onParams }: { onParams: (tag: string | null, q: string | null) => void }) {
  const params = useSearchParams();
  const tag = params.get("tag");
  const q = params.get("q");
  React.useEffect(() => {
    onParams(tag, q);
  }, [tag, q, onParams]);
  return null;
}

function CommunityHome({ initialFeed }: { initialFeed: FeedResponse | null }) {
  const router = useRouter();
  const [tag, setTag] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState<string | null>(null);
  const onParams = React.useCallback((t: string | null, q: string | null) => {
    setTag(t);
    setSearch(q);
  }, []);
  // Remember the active filters so the post detail's back link can restore them.
  React.useEffect(() => {
    try {
      sessionStorage.setItem(FEED_CONTEXT_KEY, window.location.search);
    } catch {
      /* storage blocked — back link falls back to the plain feed */
    }
  }, [tag, search]);
  const [view, setView] = React.useState<{ sort: FeedSort; scope: FeedScope }>({
    sort: "latest",
    scope: "all",
  });
  const [composeOpen, setComposeOpen] = React.useState(false);
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  const { data: me } = useMyProfile(signedIn);
  const { data: trending } = useTrendingTags();
  const { data: followedTags } = useFollowedTags(signedIn);
  const topics =
    trending?.tags && trending.tags.length > 0
      ? trending.tags.map((t) => ({ tag: t.tag, count: t.count }))
      : SUGGESTED_TAGS.map((t) => ({ tag: t, count: 0 }));

  const tabs: { id: string; label: string; sort: FeedSort; scope: FeedScope }[] = [
    { id: "latest", label: "Latest", sort: "latest", scope: "all" },
    { id: "top", label: "Top this week", sort: "top", scope: "all" },
    { id: "following", label: "Following", sort: "latest", scope: "following" },
    // Watchlist (watched symbols OR followed authors) — only meaningful signed in.
    ...(signedIn
      ? [{ id: "watchlist", label: "Watchlist", sort: "latest", scope: "watchlist" } as const]
      : []),
    { id: "saved", label: "Saved", sort: "latest", scope: "saved" },
  ];
  const activeTab =
    tabs.find((t) => t.sort === view.sort && t.scope === view.scope)?.id ?? "latest";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[190px_minmax(0,1fr)_250px]">
      <Suspense fallback={null}>
        <ParamsBridge onParams={onParams} />
      </Suspense>
      {/* ── Left rail ── */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 space-y-5">
          <nav aria-label="Feed" className="space-y-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setView({ sort: t.sort, scope: t.scope })}
                aria-pressed={activeTab === t.id}
                className={cn(
                  "block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  activeTab === t.id
                    ? "bg-accent/12 font-medium text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
            <Link
              href="/community/leaderboard"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Leaderboard
            </Link>
            <Link
              href="/community/trending"
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Trending
            </Link>
            {me && (
              <Link
                href={`/community/u/${me.username}`}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                My posts
              </Link>
            )}
          </nav>
          <div>
            <p className="micro-label mb-2 px-3">
              {trending?.tags?.length ? "Trending topics" : "Topics"}
            </p>
            <div className="flex flex-wrap gap-1.5 px-3">
              {topics.map((t) => (
                <Link
                  key={t.tag}
                  href={`/community/t/${t.tag}`}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs transition-colors",
                    tag === t.tag
                      ? "border-accent bg-accent/15 text-accent"
                      : "text-muted hover:text-foreground"
                  )}
                >
                  #{t.tag}
                  {t.count > 0 && <span className="ml-1 opacity-60">{t.count}</span>}
                </Link>
              ))}
            </div>
          </div>
          {followedTags?.tags && followedTags.tags.length > 0 && (
            <div>
              <p className="micro-label mb-2 flex items-center gap-1 px-3">
                <Hash className="h-3 w-3" aria-hidden /> Followed tags
              </p>
              <div className="flex flex-wrap gap-1.5 px-3">
                {followedTags.tags.map((t) => (
                  <Link
                    key={t}
                    href={`/community/t/${t}`}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-xs transition-colors",
                      tag === t
                        ? "border-accent bg-accent/15 text-accent"
                        : "text-muted hover:text-foreground"
                    )}
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            </div>
          )}
          <WatchlistRail enabled={signedIn} />
        </div>
      </aside>

      {/* ── Feed ── */}
      <section aria-label="Community feed" className="min-w-0">
        <InlineComposer />
        <div className="mb-4 flex items-center gap-1 overflow-x-auto lg:hidden">
          <Link
            href="/community/leaderboard"
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted"
          >
            Leaderboard
          </Link>
          <Link
            href="/community/trending"
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted"
          >
            Trending
          </Link>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setView({ sort: t.sort, scope: t.scope })}
              aria-pressed={activeTab === t.id}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm",
                activeTab === t.id ? "bg-accent/12 font-medium text-accent" : "text-muted"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {(tag || search) && (
          <div className="mb-3 flex items-center gap-2 text-sm">
            {tag && (
              <span className="rounded-md bg-accent/10 px-2 py-1 font-medium text-accent">
                #{tag}
              </span>
            )}
            {search && (
              <span className="rounded-md bg-accent/10 px-2 py-1 font-medium text-accent">
                &ldquo;{search}&rdquo;
              </span>
            )}
            <button
              onClick={() => router.push("/community")}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Clear filter
            </button>
          </div>
        )}
        <Feed
          sort={view.sort}
          tag={tag}
          search={search}
          scope={view.scope}
          // Server-rendered first page only fits the default view; every other
          // combination fetches as before.
          initialFeed={
            view.sort === "latest" && view.scope === "all" && !tag && !search ? initialFeed : null
          }
        />
      </section>

      {/* ── Right rail ── */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 space-y-4">
          <TrendingBoard variant="compact" />
          <div className="rounded-xl border bg-surface p-4">
            <h2 className="text-sm font-semibold">Share with the community</h2>
            <p className="mt-1 text-xs leading-5 text-muted">
              A setup that worked, a lesson that hurt, a question that nags — someone here needs it.
            </p>
            <Button className="mt-3 w-full" onClick={() => setComposeOpen(true)}>
              <PenSquare aria-hidden /> Write a post
            </Button>
          </div>
          <div className="rounded-xl border bg-surface p-4 text-xs leading-5 text-muted">
            <h2 className="mb-1.5 text-sm font-semibold text-foreground">House rules</h2>
            <ul className="list-disc space-y-1 pl-4">
              <li>Educational discussion only — no tips or calls.</li>
              <li>No paid-group promotion, no spam.</li>
              <li>Share losses as proudly as wins.</li>
              <li>Be kind. Report what isn&apos;t.</li>
            </ul>
          </div>
        </div>
      </aside>

      {/* Mobile compose FAB */}
      <button
        aria-label="Write a post"
        onClick={() => setComposeOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex h-13 w-13 items-center justify-center rounded-full bg-accent-solid p-3.5 text-accent-fg shadow-lg transition-transform active:scale-95 lg:hidden"
      >
        <PenSquare className="h-5 w-5" aria-hidden />
      </button>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent
          // A stray backdrop click shouldn't discard a post in progress.
          // (The draft is persisted too, so Escape / close never loses work.)
          onInteractOutside={(e) => {
            if (readDraft(COMMUNITY_DRAFT_KEY)) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Write a post</DialogTitle>
          </DialogHeader>
          <Composer draftKey={COMMUNITY_DRAFT_KEY} onPosted={() => setComposeOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function CommunityHomePage({ initialFeed }: { initialFeed: FeedResponse | null }) {
  return <CommunityHome initialFeed={initialFeed} />;
}
