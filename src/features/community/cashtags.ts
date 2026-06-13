/**
 * Pure, DOM-free $cashtag extraction shared by post create/edit and the
 * per-symbol stream pages. A cashtag is a `$SYMBOL` token in the post body:
 * the same grammar the composer typeahead and rich-text linkifier use.
 *
 * Rules (mirrors rich-text.tsx so what links is exactly what we store):
 *  - the `$` must begin a word (start-of-text or preceded by whitespace), so a
 *    mid-word `ca$h` never counts;
 *  - the body charset is [A-Za-z0-9&-] (allows BAJAJ-AUTO, M&M);
 *  - symbols normalize to UPPERCASE; both curated and free-entered tickers are
 *    kept (an unknown ticker is still a valid stream — we just can't enrich it);
 *  - results are de-duplicated and capped so one post can't fan out unbounded.
 */

import { normalizeSymbol } from "./symbols";

/** Max distinct cashtags persisted per post (generous; guards against abuse). */
export const MAX_POST_CASHTAGS = 12;

/** Min / max length of the symbol token AFTER the `$` (matches the link regex). */
const MIN_LEN = 1;
const MAX_LEN = 20;

// Word-initial `$` (start or after whitespace) + 1..20 body chars, then a
// word boundary so a runaway 25-char token is rejected, not truncated to 20
// (mirrors the composer's detectActiveToken). The capture is the bare symbol.
const CASHTAG = /(?:^|\s)\$([A-Za-z0-9&-]{1,20})(?![A-Za-z0-9&-])/g;

/**
 * Extracts the unique, normalized (UPPERCASE) cashtag symbols from a post body,
 * preserving first-seen order and capped at {@link MAX_POST_CASHTAGS}. A symbol
 * that normalizes to empty (e.g. a lone `$`) is skipped. Both known and unknown
 * tickers are returned — validation/enrichment is the caller's concern.
 */
export function extractCashtags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CASHTAG)) {
    const raw = m[1];
    if (!raw) continue;
    const symbol = normalizeSymbol(raw);
    if (symbol.length < MIN_LEN || symbol.length > MAX_LEN) continue;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
    if (out.length >= MAX_POST_CASHTAGS) break;
  }
  return out;
}

/**
 * Diffs old vs new cashtag sets for an edit, so the join table can be updated
 * minimally: `added` get inserted, `removed` get deleted, untouched ones stay.
 * Both inputs are normalized through {@link extractCashtags} first.
 */
export function diffCashtags(
  oldText: string,
  newText: string
): { added: string[]; removed: string[]; next: string[] } {
  const before = new Set(extractCashtags(oldText));
  const next = extractCashtags(newText);
  const after = new Set(next);
  const added = next.filter((s) => !before.has(s));
  const removed = [...before].filter((s) => !after.has(s));
  return { added, removed, next };
}

/**
 * Pure plan for re-syncing a post's join rows to match its body, given the
 * symbols ALREADY persisted. Returns which symbols to insert and which to
 * delete — the minimal set of writes. Used by the server `syncPostSymbols`
 * (DB side-effects) so the decision is unit-testable without a database.
 */
export function planSymbolSync(
  existing: readonly string[],
  body: string
): { toAdd: string[]; toRemove: string[]; want: string[] } {
  const have = new Set(existing.map((s) => s.toUpperCase()));
  const want = extractCashtags(body);
  const wantSet = new Set(want);
  const toAdd = want.filter((s) => !have.has(s));
  const toRemove = [...have].filter((s) => !wantSet.has(s));
  return { toAdd, toRemove, want };
}
