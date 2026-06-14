"use client";

import * as React from "react";
import Link from "next/link";
import { Eye, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, useToggleWatch, useWatchedSymbols } from "../api";

/**
 * Left-rail "Your watchlist" mini-list — the signed-in viewer's watched symbols,
 * each linking to its per-symbol stream with an inline unwatch (×) so the list
 * doubles as a manage view (see + remove). Renders nothing when the watchlist is
 * empty. Lucide icons, no emoji. Mirrors the "Followed tags" rail.
 */
export function WatchlistRail({ enabled }: { enabled: boolean }) {
  const { data } = useWatchedSymbols(enabled);
  const toggle = useToggleWatch();
  const symbols = data?.symbols ?? [];
  if (!enabled || symbols.length === 0) return null;

  const unwatch = (symbol: string) =>
    toggle.mutate(symbol, {
      onError: (e) =>
        toast.error(
          e instanceof ApiError && e.status === 429
            ? "Too many requests — try again shortly"
            : "Could not update watchlist"
        ),
    });

  return (
    <div data-watchlist-rail>
      <p className="micro-label mb-2 flex items-center gap-1 px-3">
        <Eye className="h-3 w-3" aria-hidden /> Your watchlist
      </p>
      <div className="flex flex-wrap gap-1.5 px-3">
        {symbols.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted transition-colors hover:text-foreground"
          >
            <Link href={`/community/s/${s}`} className="font-money hover:text-accent">
              ${s}
            </Link>
            <button
              type="button"
              aria-label={`Unwatch $${s}`}
              onClick={() => unwatch(s)}
              className="-mr-0.5 rounded p-0.5 text-muted hover:text-loss"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
