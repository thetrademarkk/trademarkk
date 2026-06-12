"use client";

import * as React from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PenSquare, Search, X } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Composer, Feed, SUGGESTED_TAGS, useMyProfile } from "@/features/community";
import { useTrendingTags, type FeedScope, type FeedSort } from "@/features/community/api";

function CommunityHome() {
  const router = useRouter();
  const tag = useSearchParams().get("tag");
  const [view, setView] = React.useState<{ sort: FeedSort; scope: FeedScope }>({
    sort: "latest",
    scope: "all",
  });
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [searchInput, setSearchInput] = React.useState("");
  const [search, setSearch] = React.useState<string | null>(null);
  const { data: session } = useSession();
  const { data: me } = useMyProfile(Boolean(session));
  const { data: trending } = useTrendingTags();
  const topics =
    trending?.tags && trending.tags.length > 0
      ? trending.tags.map((t) => ({ tag: t.tag, count: t.count }))
      : SUGGESTED_TAGS.map((t) => ({ tag: t, count: 0 }));

  const tabs: { id: string; label: string; sort: FeedSort; scope: FeedScope }[] = [
    { id: "latest", label: "Latest", sort: "latest", scope: "all" },
    { id: "top", label: "Top this week", sort: "top", scope: "all" },
    { id: "following", label: "Following", sort: "latest", scope: "following" },
    { id: "saved", label: "Saved", sort: "latest", scope: "saved" },
  ];
  const activeTab =
    tabs.find((t) => t.sort === view.sort && t.scope === view.scope)?.id ?? "latest";

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[190px_minmax(0,1fr)_250px]">
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
                  href={tag === t.tag ? "/community" : `/community?tag=${t.tag}`}
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
        </div>
      </aside>

      {/* ── Feed ── */}
      <section aria-label="Community feed" className="min-w-0">
        <form
          className="relative mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim() || null);
          }}
          role="search"
        >
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" aria-hidden />
          <Input
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              if (e.target.value === "") setSearch(null);
            }}
            placeholder="Search posts…"
            className="pl-9"
            aria-label="Search posts"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-3 top-2.5 text-muted hover:text-foreground"
              onClick={() => {
                setSearch(null);
                setSearchInput("");
              }}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>
        <div className="mb-4 flex items-center gap-1 overflow-x-auto lg:hidden">
          <Link
            href="/community/leaderboard"
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted"
          >
            Leaderboard
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
        {tag && (
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="rounded-md bg-accent/10 px-2 py-1 font-medium text-accent">
              #{tag}
            </span>
            <button
              onClick={() => router.push("/community")}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Clear filter
            </button>
          </div>
        )}
        <Feed sort={view.sort} tag={tag} search={search} scope={view.scope} />
      </section>

      {/* ── Right rail ── */}
      <aside className="hidden lg:block">
        <div className="sticky top-20 space-y-4">
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
        className="fixed bottom-5 right-5 z-40 flex h-13 w-13 items-center justify-center rounded-full bg-accent p-3.5 text-accent-fg shadow-lg transition-transform active:scale-95 lg:hidden"
      >
        <PenSquare className="h-5 w-5" aria-hidden />
      </button>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Write a post</DialogTitle>
          </DialogHeader>
          <Composer onPosted={() => setComposeOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function CommunityPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl p-6">
          <Skeleton className="h-64" />
        </div>
      }
    >
      <CommunityHome />
    </Suspense>
  );
}
