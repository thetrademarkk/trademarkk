/**
 * Pure Explore filter logic (BT-10). The discovery grid is filterable by index,
 * strategy category, and a free tag. Kept framework-free so the predicate is
 * unit-tested directly and the React grid is a thin renderer that just calls
 * `filterPresets`. An empty/`null` facet means "no filter on that axis".
 */

import type { IndexSymbol } from "../shared/instruments";
import type { PresetCategory, PresetMeta } from "./types";

export interface PresetFilter {
  index?: IndexSymbol | null;
  category?: PresetCategory | null;
  tag?: string | null;
}

/** The empty filter (everything passes). */
export const EMPTY_FILTER: PresetFilter = { index: null, category: null, tag: null };

/** True if a single preset matches the filter (all set facets must match). */
export function matchesFilter(meta: PresetMeta, filter: PresetFilter): boolean {
  if (filter.index && meta.index !== filter.index) return false;
  if (filter.category && meta.category !== filter.category) return false;
  if (filter.tag) {
    const want = filter.tag.toLowerCase();
    if (!meta.tags.some((t) => t.toLowerCase() === want)) return false;
  }
  return true;
}

/** Filter a list of preset metas, preserving input order. */
export function filterPresets<T extends { meta: PresetMeta } | PresetMeta>(
  items: T[],
  filter: PresetFilter
): T[] {
  return items.filter((it) => matchesFilter("meta" in it ? it.meta : (it as PresetMeta), filter));
}

/** All distinct tags across a list of presets, sorted, de-duplicated. */
export function allTags(metas: PresetMeta[]): string[] {
  const set = new Set<string>();
  for (const m of metas) for (const t of m.tags) set.add(t);
  return [...set].sort();
}

/** True when the filter has no active facet. */
export function isEmptyFilter(filter: PresetFilter): boolean {
  return !filter.index && !filter.category && !filter.tag;
}
