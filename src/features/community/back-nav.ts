/**
 * Back-navigation context for the post detail page. The feed page remembers
 * its active filters (e.g. "?tag=banknifty") in sessionStorage; the detail
 * page's back link restores them instead of dumping the reader on a reset feed.
 */

export const FEED_CONTEXT_KEY = "tm.community-feed-search";

/** Only a bare query string survives — anything else falls back to the plain feed. */
const SAFE_SEARCH = /^\?[A-Za-z0-9=&%_.~:+-]{1,180}$/;

export function communityBackHref(storedSearch: string | null | undefined): string {
  if (!storedSearch || !SAFE_SEARCH.test(storedSearch)) return "/community";
  return `/community${storedSearch}`;
}
