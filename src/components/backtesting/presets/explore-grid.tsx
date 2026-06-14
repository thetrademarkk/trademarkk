"use client";

import * as React from "react";
import { FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PRESET_CATEGORY_LABEL,
  PRESET_CATEGORY_ORDER,
} from "@/features/backtest/presets/catalogue";
import {
  EMPTY_FILTER,
  filterPresets,
  isEmptyFilter,
  matchesFilter,
  type PresetFilter,
} from "@/features/backtest/presets/filter";
import type { PresetCard as PresetCardData } from "@/features/backtest/presets/coverage-resolver";
import type { PresetCategory } from "@/features/backtest/presets/types";
import { INDEX_META, type IndexSymbol } from "@/features/backtest/shared/instruments";
import { PresetCard } from "./preset-card";

/**
 * The client Explore grid (BT-10, item 3): a filterable discovery grid of preset
 * cards. Filters by index / strategy category / tag are pure (filter.ts); the
 * cards (with precomputed coverage) are passed in from the server component so
 * the manifest JSON never reaches the client.
 *
 * Mobile-clean: filter chips wrap + horizontally scroll, the grid collapses to a
 * single column at 360px.
 */
export function ExploreGrid({
  cards,
  indices,
  tags,
}: {
  cards: PresetCardData[];
  indices: IndexSymbol[];
  tags: string[];
}) {
  const [filter, setFilter] = React.useState<PresetFilter>(EMPTY_FILTER);

  const categories = React.useMemo<PresetCategory[]>(
    () => PRESET_CATEGORY_ORDER.filter((c) => cards.some((card) => card.meta.category === c)),
    [cards]
  );

  const visible = React.useMemo(() => filterPresets(cards, filter), [cards, filter]);

  const setFacet = <K extends keyof PresetFilter>(key: K, value: PresetFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: f[key] === value ? null : value }));

  return (
    <div>
      {/* Filter bar */}
      <div className="space-y-3" data-testid="explore-filters">
        <FacetRow label="Index">
          {indices.map((sym) => (
            <Chip
              key={sym}
              active={filter.index === sym}
              onClick={() => setFacet("index", sym)}
              data-testid={`filter-index-${sym}`}
            >
              {INDEX_META[sym].label}
            </Chip>
          ))}
        </FacetRow>

        <FacetRow label="Strategy type">
          {categories.map((c) => (
            <Chip
              key={c}
              active={filter.category === c}
              onClick={() => setFacet("category", c)}
              data-testid={`filter-category-${c}`}
            >
              {PRESET_CATEGORY_LABEL[c]}
            </Chip>
          ))}
        </FacetRow>

        {tags.length > 0 && (
          <FacetRow label="Tag">
            {tags.map((t) => (
              <Chip
                key={t}
                active={filter.tag === t}
                onClick={() => setFacet("tag", t)}
                data-testid={`filter-tag-${t}`}
              >
                {t}
              </Chip>
            ))}
          </FacetRow>
        )}

        {!isEmptyFilter(filter) && (
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            data-testid="filter-clear"
          >
            <FilterX className="h-3.5 w-3.5" aria-hidden />
            Clear filters · {visible.length} of {cards.length}
          </button>
        )}
      </div>

      {/* Grid */}
      {visible.length > 0 ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="preset-grid">
          {visible.map((card) => (
            <PresetCard key={card.meta.id} card={card} />
          ))}
        </div>
      ) : (
        <p className="mt-8 rounded-xl border bg-surface/50 p-6 text-center text-sm text-muted">
          No educational examples match those filters yet.
        </p>
      )}
    </div>
  );
}

function FacetRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1 w-20 shrink-0 text-[11px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  className,
  ...props
}: { active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-accent bg-accent/15 text-accent"
          : "bg-surface text-muted hover:border-accent",
        className
      )}
      {...props}
    />
  );
}

/** Re-export for tests that want the predicate without React. */
export { matchesFilter };
