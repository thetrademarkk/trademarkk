"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError, useStarterSuggestions, useToggleFollow, useToggleFollowTag } from "../api";
import { CommunityAvatar } from "./avatar";

/**
 * Cold-start "Get started" card — seed tags + popular authors a low-signal
 * viewer can follow with one tap so their For-You / Following feeds fill up.
 * Renders nothing when the server says the viewer is already well-connected
 * (`show:false`) or when there is nothing to suggest. Lucide icons, no emoji.
 */
export function StarterSuggestions({ enabled }: { enabled: boolean }) {
  const { data } = useStarterSuggestions(enabled);
  if (!enabled || !data?.show) return null;
  const hasTags = data.tags.length > 0;
  const hasAuthors = data.authors.length > 0;
  if (!hasTags && !hasAuthors) return null;

  return (
    <section
      data-starter-suggestions
      aria-label="Get started"
      className="rounded-xl border bg-surface p-4"
    >
      <div className="flex items-center gap-1.5">
        <UserPlus className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="text-sm font-semibold">Get started</h2>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">
        Follow a few tags and traders to shape your feed.
      </p>

      {hasTags && (
        <div className="mt-3">
          <p className="micro-label mb-1.5">Tags to follow</p>
          <div className="flex flex-wrap gap-1.5">
            {data.tags.map((t) => (
              <StarterTagChip key={t.tag} tag={t.tag} />
            ))}
          </div>
        </div>
      )}

      {hasAuthors && (
        <div className="mt-3">
          <p className="micro-label mb-1.5">Traders to follow</p>
          <ul className="space-y-2">
            {data.authors.map((a) => (
              <StarterAuthorRow
                key={a.username}
                username={a.username}
                displayName={a.displayName}
                avatar={a.avatar}
                reason={a.reason}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One tag chip with an optimistic follow toggle (reuses the tag-follow hook). */
function StarterTagChip({ tag }: { tag: string }) {
  const [followed, setFollowed] = React.useState(false);
  const toggle = useToggleFollowTag();
  const onClick = () => {
    setFollowed((v) => !v); // optimistic local flip; the hook patches the rail too
    toggle.mutate(tag, {
      onError: (e) => {
        setFollowed((v) => !v);
        toast.error(
          e instanceof ApiError && e.status === 429
            ? "Too many requests — try again shortly"
            : "Could not follow tag"
        );
      },
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={followed}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors",
        followed ? "border-accent bg-accent/15 text-accent" : "text-muted hover:text-foreground"
      )}
    >
      {followed ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : (
        <Plus className="h-3 w-3" aria-hidden />
      )}
      #{tag}
    </button>
  );
}

/** One author row with avatar + an optimistic follow button. */
function StarterAuthorRow({
  username,
  displayName,
  avatar,
  reason,
}: {
  username: string;
  displayName: string;
  avatar: string | null;
  reason: string;
}) {
  const [followed, setFollowed] = React.useState(false);
  const toggle = useToggleFollow(username);
  const onClick = () => {
    setFollowed(true);
    toggle.mutate(undefined, {
      onSuccess: (r) => setFollowed(r.following),
      onError: (e) => {
        setFollowed(false);
        toast.error(
          e instanceof ApiError && e.status === 429
            ? "Too many requests — try again shortly"
            : "Could not follow trader"
        );
      },
    });
  };
  return (
    <li className="flex items-center gap-2">
      <Link href={`/community/u/${username}`} className="shrink-0">
        <CommunityAvatar username={username} displayName={displayName} avatar={avatar} size="sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          href={`/community/u/${username}`}
          className="block truncate text-sm font-medium hover:text-accent"
        >
          {displayName}
        </Link>
        <p className="truncate text-xs text-muted">{reason}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={followed}
        aria-label={`Follow ${displayName}`}
        className={cn(
          "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
          followed
            ? "border-accent/30 bg-accent/10 text-accent"
            : "hover:border-accent hover:text-accent"
        )}
      >
        {followed ? (
          <span className="flex items-center gap-1">
            <Check className="h-3 w-3" aria-hidden /> Following
          </span>
        ) : (
          "Follow"
        )}
      </button>
    </li>
  );
}
