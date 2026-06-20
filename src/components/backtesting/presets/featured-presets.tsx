import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { featuredPresetCards } from "@/features/backtest/presets/build-cards";
import { PresetCard } from "./preset-card";

/**
 * Featured templates strip for the /backtesting landing (BT-10, item 3). A
 * server component: it computes the coverage for a small, index-spread subset of
 * presets at build time (manifest stays server-side) and links to the full
 * Explore surface. Each card carries its mandatory CoverageBadge + the
 * educational framing inherited from the card itself.
 */
export function FeaturedPresets() {
  const cards = featuredPresetCards();
  if (cards.length === 0) return null;

  return (
    <section className="mt-12" data-testid="featured-presets">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div>
          <p className="bt-label text-accent">
            <span className="bt-prompt">preset library</span>
          </p>
          <h2 className="bt-display mt-1 text-lg font-semibold">Start from a strategy</h2>
        </div>
        <Link
          href="/backtesting/explore"
          className="bt-bracket inline-flex items-center gap-1 text-xs"
          data-testid="explore-link"
        >
          Explore all <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <p className="mb-3 text-xs text-muted">
        Educational examples to learn the mechanics — not trade recommendations. Each shows honestly
        how much real data backs it.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <PresetCard key={card.meta.id} card={card} />
        ))}
      </div>
    </section>
  );
}
