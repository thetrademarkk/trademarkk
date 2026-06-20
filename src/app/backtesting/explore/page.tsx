import type { Metadata } from "next";
import { GraduationCap, Telescope } from "lucide-react";
import { ExploreGrid } from "@/components/backtesting/presets/explore-grid";
import { buildPresetCards } from "@/features/backtest/presets/build-cards";
import { allTags } from "@/features/backtest/presets/filter";
import { PRESET_INDICES } from "@/features/backtest/presets/catalogue";

export const metadata: Metadata = {
  title: "Explore strategies",
  description:
    "Browse founder-vetted educational options strategy examples for NIFTY, BANKNIFTY & SENSEX — each honest about data coverage. Open any in the no-code builder and run it.",
  alternates: { canonical: "/backtesting/explore" },
};

/**
 * /backtesting/explore — the BT-10 discovery surface. A server component: it
 * builds the preset cards (each with honest coverage precomputed from the
 * committed manifest, and a run-vs-locked flag) and hands them to the client
 * grid. Statically renderable — no client data fetch, no worker import.
 *
 * Framing is non-negotiable: these are EDUCATIONAL examples to learn the
 * mechanics, never trade recommendations.
 */
export default function ExplorePage() {
  const cards = buildPresetCards();
  const tags = allTags(cards.map((c) => c.meta));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <header className="max-w-2xl bt-boot bt-boot-1">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/15">
          <Telescope className="h-5 w-5 text-accent" aria-hidden />
        </span>
        <p className="mt-4 bt-label text-accent">
          <span className="bt-prompt">strategy library</span>
        </p>
        <h1 className="bt-display mt-2 text-2xl font-bold sm:text-3xl">
          Explore <span className="bt-glow-text">strategies</span>
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          A library of worked options strategies across NIFTY, BANK NIFTY and SENSEX. Open any one
          in the no-code builder to tweak it, or run it to see the result shape — every card shows
          honestly how much real data backs it.
        </p>
      </header>

      {/* Honest framing banner — required */}
      <div
        className="mt-5 flex items-start gap-2 bt-panel p-3 text-xs leading-5 text-muted bt-boot bt-boot-2"
        data-testid="explore-disclaimer"
      >
        <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p>
          <span className="font-medium text-foreground">
            Educational examples to learn the mechanics — not trade recommendations.
          </span>{" "}
          Nothing here is a signal to copy, and a coverage badge is never a profitability claim.
          Past performance never guarantees future results.
        </p>
      </div>

      <div className="mt-7 bt-boot bt-boot-3">
        <ExploreGrid cards={cards} indices={PRESET_INDICES} tags={tags} />
      </div>
    </div>
  );
}
