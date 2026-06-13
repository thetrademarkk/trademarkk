"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ApiError, useToggleWatch, useWatchedSymbols } from "../api";
import { isWatched } from "../watchlist";

/**
 * Watch / Unwatch toggle for a symbol's stream page. Watched symbols flow into
 * the viewer's Watchlist feed scope. Optimistic via {@link useToggleWatch} (the
 * cache flips instantly, rolls back on error). Signed-out viewers get a prompt
 * to sign in. Lucide icons, no emoji, 360px-clean.
 */
export function WatchButton({ symbol, className }: { symbol: string; className?: string }) {
  const { data: session } = useSession();
  const signedIn = Boolean(session);
  const { data } = useWatchedSymbols(signedIn);
  const toggle = useToggleWatch();
  const watching = isWatched(data?.symbols ?? [], symbol);

  const onClick = () => {
    if (!signedIn) {
      toast.message("Sign in to watch symbols", {
        description: `Watch $${symbol} to see its posts in your Watchlist feed.`,
      });
      return;
    }
    toggle.mutate(symbol, {
      onError: (e) =>
        toast.error(
          e instanceof ApiError && e.status === 429
            ? "Too many requests — try again shortly"
            : "Could not update watchlist"
        ),
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={watching ? "secondary" : "outline"}
      aria-pressed={watching}
      // Stable accessible name even when the label text is hidden on phones.
      aria-label={watching ? "Watching" : "Watch"}
      data-watching={watching ? "true" : "false"}
      onClick={onClick}
      className={cn("shrink-0", className)}
    >
      {watching ? (
        <>
          <EyeOff aria-hidden /> <span className="hidden sm:inline">Watching</span>
        </>
      ) : (
        <>
          <Eye aria-hidden /> <span className="hidden sm:inline">Watch</span>
        </>
      )}
    </Button>
  );
}
