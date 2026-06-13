/**
 * Pure, DOM- and DB-free helpers for the Watchlist feed scope. A watched symbol
 * surfaces its posts in the viewer's Watchlist feed (alongside posts by followed
 * users) — the symbol-axis mirror of "follow a tag". These helpers keep the
 * symbol grammar, the optimistic watch/unwatch decision, and the cross-source
 * post de-duplication unit-testable without a database.
 *
 * The symbol grammar mirrors the $cashtag token (`[A-Za-z0-9&-]{1,20}`, see
 * cashtags.ts): the same value that can tag a post can be watched — so a watched
 * symbol always points at a real per-symbol stream (/community/s/[symbol]).
 */

import { normalizeSymbol } from "./symbols";

/** Symbol token grammar — identical body charset to the $cashtag link regex. */
export const SYMBOL_PATTERN = /^[A-Z0-9&-]{1,20}$/;

/** Max distinct symbols a single user may watch (generous; guards the left rail + queries). */
export const MAX_WATCHED_SYMBOLS = 50;

/**
 * Normalizes a raw symbol value (with or without a leading `$`) to its canonical
 * stored form: trimmed, `$`-stripped, UPPERCASE. Returns `null` when the result
 * is not a valid symbol token (so callers can 400 / ignore rather than persist
 * junk into the join). Reuses {@link normalizeSymbol} so the canonical form is
 * identical to the one `post_symbols` rows use.
 */
export function normalizeWatchSymbol(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = normalizeSymbol(raw);
  return SYMBOL_PATTERN.test(s) ? s : null;
}

/** True when `raw` is a syntactically valid watch symbol (after normalization). */
export function isValidWatchSymbol(raw: string | null | undefined): boolean {
  return normalizeWatchSymbol(raw) !== null;
}

/**
 * Decides the next state of a watch toggle given whether the symbol is currently
 * watched. Pure mirror of the server's insert/delete so the optimistic client
 * update and the server agree exactly.
 */
export function planWatchToggle(currentlyWatched: boolean): {
  watch: boolean;
  nextWatched: boolean;
} {
  return { watch: !currentlyWatched, nextWatched: !currentlyWatched };
}

/**
 * Optimistically toggles a symbol within the viewer's watchlist, keeping it
 * sorted and capped. Used by the per-symbol stream's Watch button + the
 * left-rail "Your watchlist" list so watching from the stream page reflects
 * instantly without a refetch. Invalid input is ignored (returns a copy).
 */
export function toggleWatchedSymbol(list: readonly string[], symbol: string): string[] {
  const s = normalizeWatchSymbol(symbol);
  if (!s) return [...list];
  const set = new Set(list.map((x) => x.toUpperCase()));
  if (set.has(s)) {
    set.delete(s);
  } else if (set.size < MAX_WATCHED_SYMBOLS) {
    set.add(s);
  }
  return [...set].sort();
}

/** True when the (normalized) symbol is in the watched list (case-insensitive). */
export function isWatched(list: readonly string[], symbol: string): boolean {
  const s = normalizeWatchSymbol(symbol);
  if (!s) return false;
  return list.some((x) => x.toUpperCase() === s);
}

/** A minimal shape every post view satisfies — enough to de-duplicate by id. */
interface HasId {
  id: string;
}

/**
 * De-duplicates a list of posts by id, preserving first-seen order. The Watchlist
 * feed unions posts by followed users with posts tagging a watched symbol, so a
 * single post that matches BOTH (a followed author who also tagged a watched
 * symbol) must appear exactly once. The DB query already returns each row once
 * (correlated EXISTS, not a JOIN), but this guards any JS-assembled union too.
 */
export function dedupePostsById<T extends HasId>(posts: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const p of posts) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
