"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Check, Hash, Info, MessageSquareText, PenSquare, Plus } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Composer, Feed, SignInGate } from "@/features/community";
import { COMMUNITY_DRAFT_KEY, readDraft } from "@/features/community/draft";
import { useFollowedTags, useToggleFollowTag, type FeedSort } from "@/features/community/api";

/**
 * Dedicated topic/tag page — Latest / Top tabs over posts carrying the tag, a
 * Follow button (followed tags surface in the viewer's Following feed), and a
 * composer. The header (#tag / post count) is server-rendered for SEO; this
 * client shell owns the tabs, feed, follow toggle and composer dialog.
 */
export function TagPage({ tag, initialCount }: { tag: string; initialCount: number }) {
  const [sort, setSort] = React.useState<FeedSort>("latest");
  const [composeOpen, setComposeOpen] = React.useState(false);
  const [gateOpen, setGateOpen] = React.useState(false);
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  const { data: followed } = useFollowedTags(signedIn);
  const toggleFollow = useToggleFollowTag();
  const isFollowing = (followed?.tags ?? []).includes(tag);

  const onFollow = () => {
    if (!signedIn) {
      setGateOpen(true);
      return;
    }
    toggleFollow.mutate(tag);
  };

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

      {/* Topic header */}
      <header className="rounded-xl border bg-surface p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"
          >
            <Hash className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight break-words">#{tag}</h1>
            <p className="mt-1 text-xs text-muted">
              <span className="font-money">{initialCount}</span>{" "}
              {initialCount === 1 ? "post" : "posts"}
            </p>
          </div>
          <Button
            size="sm"
            variant={isFollowing ? "outline" : "default"}
            className="shrink-0"
            aria-pressed={isFollowing}
            disabled={toggleFollow.isPending}
            onClick={onFollow}
          >
            {isFollowing ? (
              <>
                <Check aria-hidden /> <span className="hidden sm:inline">Following</span>
              </>
            ) : (
              <>
                <Plus aria-hidden /> <span className="hidden sm:inline">Follow</span>
              </>
            )}
          </Button>
        </div>

        <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-[11px] leading-4 text-muted">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          <span data-not-advice>
            Educational discussion only — nothing tagged #{tag} is investment advice, a
            recommendation, or a buy/sell call. Follow this topic to see its posts in your Following
            feed.
          </span>
        </p>
      </header>

      {/* Tabs */}
      <div role="tablist" aria-label={`${tag} sort`} className="mt-4 flex items-center gap-1">
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
        <Button size="sm" className="ml-auto shrink-0" onClick={() => setComposeOpen(true)}>
          <PenSquare aria-hidden /> <span className="hidden sm:inline">Post</span>
        </Button>
      </div>

      {/* Feed scoped to this tag */}
      <section aria-label={`Posts tagged ${tag}`} className="mt-3">
        <Feed sort={sort} tag={tag} scope="all" />
      </section>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden />
        Add #{tag} to a post to include it here.
      </p>

      <SignInGate
        open={gateOpen}
        onOpenChange={setGateOpen}
        onAuthed={() => toggleFollow.mutate(tag)}
      />

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent
          onInteractOutside={(e) => {
            if (readDraft(COMMUNITY_DRAFT_KEY)) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Post in #{tag}</DialogTitle>
          </DialogHeader>
          <Composer draftKey={COMMUNITY_DRAFT_KEY} onPosted={() => setComposeOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
