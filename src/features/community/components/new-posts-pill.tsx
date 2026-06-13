"use client";

import * as React from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { newPostsLabel } from "../new-posts";

/**
 * The floating "N new posts" pill (rank-15). Sits just below the sticky header,
 * centered over the feed, and only appears when `count > 0`. Clicking it loads
 * the new posts in at the top of the feed and scrolls there. Purely presentational
 * — the Feed owns the count + the "load new" behaviour.
 *
 * Accessibility: it is a real <button>, and an offscreen `aria-live="polite"`
 * region announces the count change without stealing focus or interrupting a
 * screen-reader user mid-read.
 */
export function NewPostsPill({ count, onLoad }: { count: number; onLoad: () => void }) {
  const label = newPostsLabel(count);
  return (
    // Sticky so it rides at the top of the feed column as the user scrolls; the
    // zero-height wrapper means it never reserves layout space when hidden.
    <div className="pointer-events-none sticky top-16 z-30 -mb-1 flex h-0 justify-center">
      {/* Polite live region — announces the count without grabbing focus. */}
      <span className="sr-only" role="status" aria-live="polite">
        {count > 0 ? label : ""}
      </span>
      <button
        type="button"
        onClick={onLoad}
        aria-label={`Load ${label}`}
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-solid px-3.5 py-1.5",
          "text-xs font-medium text-accent-fg shadow-lg transition-all duration-200",
          "hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
          count > 0
            ? "translate-y-0 scale-100 opacity-100"
            : "pointer-events-none -translate-y-2 scale-95 opacity-0"
        )}
        // Keep it out of the tab order while hidden.
        tabIndex={count > 0 ? 0 : -1}
        aria-hidden={count > 0 ? undefined : true}
        data-testid="new-posts-pill"
      >
        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
        {label}
      </button>
    </div>
  );
}
