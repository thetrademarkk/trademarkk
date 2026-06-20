"use client";

import * as React from "react";
import { Check, ChevronDown, Search, Tag as TagIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
 * The filter bar is a clean, on-brand control surface: a search box, two
 * segmented controls (Index / Strategy type, each with a leading "All"), and a
 * Tags popover that replaces what used to be a wall of ~17 flat chips. On mobile
 * the segmented controls scroll horizontally instead of wrapping, and the search
 * goes full-width.
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
  const [query, setQuery] = React.useState("");

  const categories = React.useMemo<PresetCategory[]>(
    () => PRESET_CATEGORY_ORDER.filter((c) => cards.some((card) => card.meta.category === c)),
    [cards]
  );

  // Facet filtering (pure model) then a free-text pass over title/thesis/tags.
  const visible = React.useMemo(() => {
    const byFacet = filterPresets(cards, filter);
    const q = query.trim().toLowerCase();
    if (!q) return byFacet;
    return byFacet.filter((card) => {
      const { title, thesis, tags: cardTags } = card.meta;
      return (
        title.toLowerCase().includes(q) ||
        thesis.toLowerCase().includes(q) ||
        cardTags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [cards, filter, query]);

  const setFacet = <K extends keyof PresetFilter>(key: K, value: PresetFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  const active = !isEmptyFilter(filter) || query.trim().length > 0;
  const reset = () => {
    setFilter(EMPTY_FILTER);
    setQuery("");
  };

  return (
    <div>
      {/* Filter bar */}
      <div
        className="space-y-3 rounded-lg border bg-surface p-3 sm:p-4"
        data-testid="explore-filters"
      >
        {/* Row 1 — search + results count */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search strategies…"
              aria-label="Search strategies"
              data-testid="explore-search"
              className="h-9 w-full rounded-lg border bg-surface-2 pl-9 pr-3 text-sm shadow-sm transition-colors placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <p className="text-xs text-muted sm:shrink-0">
            Showing <span className="font-medium text-foreground">{visible.length}</span> of{" "}
            {cards.length} strategies
          </p>
        </div>

        {/* Row 2 — Index segmented control */}
        <Segmented label="Index">
          <SegOption active={!filter.index} onClick={() => setFacet("index", null)}>
            All
          </SegOption>
          {indices.map((sym) => (
            <SegOption
              key={sym}
              active={filter.index === sym}
              onClick={() => setFacet("index", sym)}
              data-testid={`filter-index-${sym}`}
            >
              {INDEX_META[sym].label}
            </SegOption>
          ))}
        </Segmented>

        {/* Row 3 — Strategy type segmented control + Tags popover */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Segmented label="Strategy type" className="min-w-0 md:flex-1">
            <SegOption active={!filter.category} onClick={() => setFacet("category", null)}>
              All
            </SegOption>
            {categories.map((c) => (
              <SegOption
                key={c}
                active={filter.category === c}
                onClick={() => setFacet("category", c)}
                data-testid={`filter-category-${c}`}
              >
                {PRESET_CATEGORY_LABEL[c]}
              </SegOption>
            ))}
          </Segmented>

          {tags.length > 0 && (
            <div className="flex shrink-0 items-center gap-2">
              <TagsPopover
                tags={tags}
                selected={filter.tag ?? null}
                onSelect={(t) => setFacet("tag", t)}
              />
              {filter.tag && (
                <button
                  type="button"
                  onClick={() => setFacet("tag", null)}
                  className="inline-flex items-center gap-1 rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/25"
                  aria-label={`Remove tag ${filter.tag}`}
                >
                  {filter.tag}
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Row 4 — Clear all (count already shown in Row 1) */}
        {active && (
          <div className="flex items-center justify-end border-t pt-3">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
              data-testid="filter-clear"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Grid */}
      {visible.length > 0 ? (
        <div
          className="mt-5 grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="preset-grid"
        >
          {visible.map((card) => (
            <PresetCard key={card.meta.id} card={card} />
          ))}
        </div>
      ) : (
        <p className="mt-12 rounded-lg border bg-surface p-6 text-center text-sm text-foreground">
          No educational examples match those filters yet.
        </p>
      )}
    </div>
  );
}

/**
 * A labelled segmented control: a leading micro-label and a single horizontally
 * scrollable track of options (no wrapping wall on mobile).
 */
function Segmented({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="micro-label w-16 shrink-0 xs:w-20">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="flex min-w-0 flex-1 snap-x snap-mandatory gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
    </div>
  );
}

function SegOption({
  active,
  className,
  ...props
}: { active: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        active
          ? "bg-accent-solid text-accent-fg shadow-sm"
          : "text-muted hover:bg-surface hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

/**
 * The Tags popover: a single trigger ("Tags ▾", or the selected tag) opening a
 * small filter input + a scrollable, single-select list. Replaces the old
 * 17-chip wall. Selecting a tag toggles `filter.tag`.
 */
function TagsPopover({
  tags,
  selected,
  onSelect,
}: {
  tags: string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");

  const shown = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? tags.filter((t) => t.toLowerCase().includes(needle)) : tags;
  }, [tags, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Filter by tag"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            selected
              ? "border-accent/40 bg-accent/10 text-accent"
              : "bg-surface text-muted hover:border-accent hover:text-foreground"
          )}
        >
          <TagIcon className="h-3.5 w-3.5" aria-hidden />
          {selected ?? "Tags"}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[calc(100vw-2rem)] p-0 sm:w-60">
        <div className="border-b p-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter tags…"
              aria-label="Filter tags"
              data-testid="explore-tag-search"
              className="h-8 w-full rounded-md border bg-surface-2 pl-8 pr-2 text-xs placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        </div>
        <div role="listbox" aria-label="Tags" className="max-h-56 overflow-y-auto p-1">
          {shown.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted">No tags match.</p>
          ) : (
            shown.map((t) => {
              const isActive = selected === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onSelect(isActive ? null : t);
                    setOpen(false);
                  }}
                  data-testid={`filter-tag-${t}`}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    isActive
                      ? "bg-accent/15 font-medium text-accent"
                      : "text-foreground hover:bg-surface-2"
                  )}
                >
                  {t}
                  {isActive && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Re-export for tests that want the predicate without React. */
export { matchesFilter };
