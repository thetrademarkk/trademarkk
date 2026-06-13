/**
 * Pure helpers behind the header search typeahead (Search v2).
 * Flattening results into one keyboard-navigable list, match highlighting,
 * snippet windows and recent-search persistence — all DOM-free except the
 * thin localStorage wrappers at the bottom (best-effort, mirrors draft.ts).
 */

import type { SearchResponse } from "./types";

export const RECENT_SEARCHES_KEY = "tm.community-recent-searches";
export const SEARCH_MIN_CHARS = 2;
export const SEARCH_MAX_CHARS = 60;
export const RECENT_SEARCHES_MAX = 5;

export interface SearchItem {
  key: string;
  group: "user" | "tag" | "post" | "query";
  href: string;
  /** Present on query/recent rows — the term to record in recent searches. */
  term?: string;
}

/**
 * One ordered list drives both rendering and ArrowUp/ArrowDown — users first
 * (people are the highest-intent match), then topics, then posts, and always
 * a final "search the feed" row so Enter never dead-ends.
 */
export function flattenSearchItems(res: SearchResponse, q: string): SearchItem[] {
  const term = q.trim().slice(0, SEARCH_MAX_CHARS);
  const items: SearchItem[] = [];
  for (const u of res.users) {
    items.push({ key: `user:${u.username}`, group: "user", href: `/community/u/${u.username}` });
  }
  for (const t of res.tags) {
    items.push({
      key: `tag:${t.tag}`,
      group: "tag",
      href: `/community?tag=${encodeURIComponent(t.tag)}`,
    });
  }
  for (const p of res.posts) {
    items.push({ key: `post:${p.id}`, group: "post", href: `/community/post/${p.id}` });
  }
  if (term.length > 0) {
    items.push({
      key: "query",
      group: "query",
      href: `/community?q=${encodeURIComponent(term)}`,
      term,
    });
  }
  return items;
}

/**
 * Keyboard navigation with wrap-around. -1 means "nothing highlighted"
 * (the input itself); ArrowDown enters at the top, ArrowUp at the bottom.
 */
export function moveActive(current: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/**
 * Case-insensitive first-occurrence split for bolding the matched substring —
 * `null` when the query doesn't appear (caller renders plain text).
 */
export function splitMatch(text: string, q: string): [string, string, string] | null {
  const term = q.trim();
  if (!term) return null;
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return null;
  return [text.slice(0, idx), text.slice(idx, idx + term.length), text.slice(idx + term.length)];
}

/**
 * A compact window around the first match so the hit is visible even when it
 * sits deep inside a long post body. Whitespace collapses first (bodies have
 * newlines); a leading/trailing ellipsis marks clipped sides.
 */
export function searchSnippet(body: string, q: string, max = 110): string {
  const text = body.replace(/\s+/g, " ").trim();
  const term = q.trim().toLowerCase();
  const idx = term ? text.toLowerCase().indexOf(term) : -1;

  // No match, or it already fits the plain head of the text.
  if (idx === -1 || idx + term.length <= max - 10) {
    return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
  }

  // Window starting a little before the match, snapped to a word boundary.
  let start = Math.max(0, idx - 30);
  const space = text.indexOf(" ", start);
  if (space !== -1 && space < idx) start = space + 1;
  const slice = text.slice(start, start + max).trimEnd();
  return `${start > 0 ? "…" : ""}${slice}${start + max < text.length ? "…" : ""}`;
}

/** Clamp whatever came out of storage into a safe, deduped list of terms. */
export function sanitizeRecentSearches(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of parsed) {
    if (typeof v !== "string") continue;
    const term = v.trim().slice(0, SEARCH_MAX_CHARS);
    if (term.length < SEARCH_MIN_CHARS || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    out.push(term);
    if (out.length >= RECENT_SEARCHES_MAX) break;
  }
  return out;
}

/** Newest first, case-insensitive dedupe, capped — pure so it's testable. */
export function pushRecentSearch(list: string[], raw: string): string[] {
  const term = raw.trim().slice(0, SEARCH_MAX_CHARS);
  if (term.length < SEARCH_MIN_CHARS) return list;
  const rest = list.filter((t) => t.toLowerCase() !== term.toLowerCase());
  return [term, ...rest].slice(0, RECENT_SEARCHES_MAX);
}

/* ── Best-effort storage wrappers (never throw — privacy modes, SSR) ────── */

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadRecentSearches(): string[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(RECENT_SEARCHES_KEY);
    return raw ? sanitizeRecentSearches(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearches(list: string[]): void {
  const s = storage();
  if (!s) return;
  try {
    if (list.length === 0) s.removeItem(RECENT_SEARCHES_KEY);
    else s.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, RECENT_SEARCHES_MAX)));
  } catch {
    // quota / blocked storage — recents are a convenience, never an error
  }
}

export function clearRecentSearches(): void {
  saveRecentSearches([]);
}
