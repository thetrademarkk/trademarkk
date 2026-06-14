"use client";

import * as React from "react";
import Link from "next/link";
import { Check, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError, useToggleFollow, useWhoToFollow, type WhoToFollowSuggestion } from "../api";
import { CommunityAvatar } from "./avatar";
import { ReputationChip } from "./reputation-chip";

/**
 * "Who to follow" right-rail card — relevant, non-spammy follow recommendations
 * for the signed-in viewer. Each row shows the candidate's avatar, name, a quiet
 * reputation-tier chip (community standing, NOT trading skill), the honest reason
 * line ("Followed by 3 people you follow", "Also posts about #banknifty", …) and
 * a Follow button. Following a suggestion optimistically removes it from the card
 * (you don't need to be re-suggested someone you just followed); "Dismiss" hides
 * one without following. Renders nothing when there is nothing to suggest or when
 * signed out. Lucide icons only, no emoji, mobile-clean.
 */
export function WhoToFollow({ enabled }: { enabled: boolean }) {
  const { data } = useWhoToFollow(enabled);
  // Locally hide rows the viewer has acted on (followed or dismissed) so the card
  // updates instantly without a refetch flash.
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set());

  if (!enabled || !data?.show) return null;
  const visible = data.suggestions.filter((s) => !hidden.has(s.userId));
  if (visible.length === 0) return null;

  const hide = (userId: string) => setHidden((prev) => new Set(prev).add(userId));

  return (
    <section
      data-who-to-follow
      aria-label="Who to follow"
      className="rounded-xl border bg-surface p-4"
    >
      <div className="flex items-center gap-1.5">
        <UserPlus className="h-4 w-4 text-accent" aria-hidden />
        <h2 className="text-sm font-semibold">Who to follow</h2>
      </div>
      <ul className="mt-3 space-y-3">
        {visible.map((s) => (
          <WhoToFollowRow key={s.userId} suggestion={s} onResolved={() => hide(s.userId)} />
        ))}
      </ul>
    </section>
  );
}

/** One suggestion row with an optimistic Follow + a quiet Dismiss. */
function WhoToFollowRow({
  suggestion,
  onResolved,
}: {
  suggestion: WhoToFollowSuggestion;
  onResolved: () => void;
}) {
  const { username, displayName, avatar, reputationTier, reason } = suggestion;
  const [following, setFollowing] = React.useState(false);
  const toggle = useToggleFollow(username);

  const onFollow = () => {
    setFollowing(true); // optimistic
    toggle.mutate(undefined, {
      onSuccess: (r) => {
        if (r.following) {
          // Followed — remove the row shortly so the Following state is seen first.
          window.setTimeout(onResolved, 350);
        } else {
          // The toggle un-followed (shouldn't happen from here) — revert.
          setFollowing(false);
        }
      },
      onError: (e) => {
        setFollowing(false);
        toast.error(
          e instanceof ApiError && e.status === 429
            ? "Too many requests — try again shortly"
            : "Could not follow trader"
        );
      },
    });
  };

  return (
    <li className="flex items-center gap-2" data-suggestion-user={username}>
      <Link href={`/community/u/${username}`} className="shrink-0">
        <CommunityAvatar username={username} displayName={displayName} avatar={avatar} size="sm" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/community/u/${username}`}
            className="block truncate text-sm font-medium hover:text-accent"
          >
            {displayName}
          </Link>
          <ReputationChip tier={reputationTier} />
        </div>
        <p className="truncate text-xs text-muted">{reason}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onFollow}
          disabled={following}
          aria-label={`Follow ${displayName}`}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
            following
              ? "border-accent/30 bg-accent/10 text-accent"
              : "hover:border-accent hover:text-accent"
          )}
        >
          {following ? (
            <span className="flex items-center gap-1">
              <Check className="h-3 w-3" aria-hidden /> Following
            </span>
          ) : (
            "Follow"
          )}
        </button>
        <button
          type="button"
          onClick={onResolved}
          aria-label={`Dismiss ${displayName}`}
          className="rounded-md p-1 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </li>
  );
}
