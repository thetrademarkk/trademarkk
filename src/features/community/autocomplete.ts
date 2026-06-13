/**
 * Pure, DOM-free logic behind the composer typeahead — detecting the active
 * @mention / $cashtag / #hashtag token at the caret, completing it, and
 * resolving $cashtag suggestions client-side from the curated symbol list.
 *
 * Mentions and hashtags hit a tiny server endpoint (users are block-aware,
 * tags need post-counts); cashtags never touch the network — they match the
 * in-repo `COMMON_SYMBOLS` and accept any free-entered $SYMBOL the user types.
 *
 * Token grammars mirror the rest of the app:
 *   @handle   → [a-z0-9_]{1,20}      (mention regex is {3,20}; we trigger from 1)
 *   #hashtag  → [a-z0-9-]{1,20}      (tagSchema is [a-z0-9-]{2,20})
 *   $cashtag  → [A-Za-z0-9&-]{1,20}  (uppercased on completion; allows BAJAJ-AUTO, M&M)
 */

import { COMMON_SYMBOLS } from "./symbols";

export type TokenKind = "user" | "tag" | "cashtag";

export interface ActiveToken {
  kind: TokenKind;
  /** The query AFTER the trigger char (e.g. "ni" for "$ni"), already lowercased for user/tag. */
  query: string;
  /** Index of the trigger char in the full text (start of the token incl. @/$/#). */
  start: number;
  /** Index just past the caret (end of the token slice we will replace). */
  end: number;
}

/** Per-kind body charset AFTER the trigger character. */
const BODY: Record<TokenKind, RegExp> = {
  user: /[a-z0-9_]/i,
  tag: /[a-z0-9-]/i,
  cashtag: /[a-z0-9&-]/i,
};

const TRIGGER: Record<string, TokenKind> = { "@": "user", "#": "tag", $: "cashtag" };

const MAX_QUERY = 20;

/**
 * Finds the token the caret is currently inside, scanning the text BEFORE the
 * caret. Returns null when the caret isn't in a completable token.
 *
 * Rules that keep this from firing on ordinary prose:
 *  - the trigger must start a "word" — preceded by start-of-text or whitespace
 *    (so an email `a@b` or a mid-word `c$h` never triggers);
 *  - every char between the trigger and the caret must be a valid body char
 *    (a space ends the token);
 *  - the body length is capped (a runaway match is not a token).
 *
 * Works mid-text: only `before = text.slice(0, caret)` matters, so a caret in
 * the middle of "see $rel and" detects "$rel" while "and" is left untouched.
 */
export function detectActiveToken(text: string, caret: number): ActiveToken | null {
  const pos = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, pos);

  // Walk back from the caret to the nearest trigger or token-breaking char.
  let i = before.length - 1;
  while (i >= 0) {
    const ch = before[i]!;
    const kind = TRIGGER[ch];
    if (kind) {
      // The trigger must begin a word (start-of-text or preceded by whitespace).
      const prev = i > 0 ? before[i - 1]! : "";
      if (prev !== "" && !/\s/.test(prev)) return null;
      const query = before.slice(i + 1);
      if (query.length > MAX_QUERY) return null;
      // Every char after the trigger must be a valid body char for this kind.
      if (query.length > 0 && ![...query].every((c) => BODY[kind].test(c))) return null;
      return {
        kind,
        query: kind === "cashtag" ? query : query.toLowerCase(),
        start: i,
        end: pos,
      };
    }
    // A whitespace before hitting a trigger means the caret isn't in a token.
    if (/\s/.test(ch)) return null;
    // A char that can't belong to ANY token body also breaks the scan early.
    if (!BODY.user.test(ch) && !BODY.tag.test(ch) && !BODY.cashtag.test(ch)) return null;
    i--;
  }
  return null;
}

/** Uppercase-normalize a cashtag symbol (the only kind we case-fold on insert). */
export function normalizeCashtag(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Completes the detected token with the chosen value and a trailing space,
 * returning the new full text and the caret position to restore. The trigger
 * char is re-prefixed here so callers pass the bare value (e.g. "NIFTY").
 *
 * If the text already has whitespace immediately after the token we skip the
 * extra space (so completing "$ni| and" -> "$NIFTY and", never a double space),
 * but the caret still lands past the token + that space, ready to keep typing.
 */
export function completeToken(
  text: string,
  token: ActiveToken,
  value: string
): { text: string; caret: number } {
  const trigger = token.kind === "user" ? "@" : token.kind === "tag" ? "#" : "$";
  const followedBySpace = /\s/.test(text[token.end] ?? "");
  const inserted = `${trigger}${value}${followedBySpace ? "" : " "}`;
  const next = text.slice(0, token.start) + inserted + text.slice(token.end);
  // Caret sits just past the inserted token and the following space.
  const caret = token.start + inserted.length + (followedBySpace ? 1 : 0);
  return { text: next, caret };
}

export interface SymbolSuggestion {
  symbol: string;
}

/**
 * Prefix-matches the curated symbol list for a $cashtag query (case-insensitive).
 * Exact-prefix hits rank first, then alphabetical; capped at `limit` (default 8).
 * An empty query returns the first few indices/headline names as a starter set.
 */
export function matchSymbols(query: string, limit = 8): SymbolSuggestion[] {
  const q = query.trim().toUpperCase();
  if (q === "") return COMMON_SYMBOLS.slice(0, limit).map((symbol) => ({ symbol }));
  const matches = COMMON_SYMBOLS.filter((s) => s.startsWith(q));
  return matches.slice(0, limit).map((symbol) => ({ symbol }));
}
