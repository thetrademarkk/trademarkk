/**
 * Link OG unfurls — pure, framework-free logic shared by the server fetcher,
 * the API route, and the unit tests. No I/O, no React, no Node-only APIs here:
 * the actual fetch + DNS resolution + SSRF guard live in `src/server/unfurl.ts`
 * and `src/server/ssrf.ts`.
 *
 * We unfurl AT MOST the first link in a post body, lazily (on first view) and
 * cache the result so re-renders are free. Everything extracted from a remote
 * page is treated as untrusted text — never HTML — so a card can never inject
 * markup. The card image, when present, is rendered via next/image (CSP allows
 * remote hosts only through the configured loader); a lucide globe is the
 * fallback when there's no usable image.
 */

/** A cached, sanitized preview of an external link. All fields are plain text. */
export interface LinkUnfurl {
  /** The exact URL that was unfurled (the first link in the post body). */
  url: string;
  title: string | null;
  description: string | null;
  /** Absolute https image URL, or null when none/unsafe. */
  image: string | null;
  /** og:site_name or the host as a fallback. */
  siteName: string | null;
  /** ISO timestamp the meta was fetched (drives TTL refresh). */
  fetchedAt: string;
}

/** How long a cached unfurl stays fresh before a background re-fetch (7 days). */
export const UNFURL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Max characters we keep for each text field (defensive truncation). */
const MAX_TITLE = 200;
const MAX_DESC = 400;
const MAX_SITE = 80;

// A URL inside a post body. Mirrors the linkifier in rich-text.tsx so the FIRST
// link we unfurl is exactly the first link a reader sees rendered. http(s) only
// — the SSRF guard later rejects anything that isn't https, but we never even
// surface a bare http link as unfurlable.
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Extracts the FIRST link in a post body, or null. Trailing punctuation that's
 * almost never part of a URL (closing brackets, sentence punctuation) is
 * trimmed so "see https://example.com." unfurls example.com, not "…com.".
 */
export function extractFirstLink(body: string): string | null {
  const m = body.match(URL_IN_TEXT);
  if (!m || !m[0]) return null;
  let url = m[0];
  // Strip trailing punctuation that commonly abuts a URL in prose.
  url = url.replace(/[.,;:!?)\]}'"]+$/, "");
  return url.length >= 11 ? url : null; // "https://a.b" is the shortest plausible
}

/** True only for a syntactically valid absolute https URL. */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Stable hex hash of a URL for use as the cache primary key. FNV-1a (32-bit) is
 * plenty for a cache key (no security property needed — the SSRF guard, not the
 * key, provides safety) and keeps this module dependency-free / edge-safe.
 */
export function urlHash(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Whether a cached unfurl (by its ISO fetchedAt) is still within the TTL. */
export function isUnfurlFresh(fetchedAt: string, now = Date.now(), ttlMs = UNFURL_TTL_MS): boolean {
  const t = Date.parse(fetchedAt);
  if (Number.isNaN(t)) return false;
  return now - t < ttlMs;
}

/** Collapses whitespace, strips control chars, decodes entities, truncates. */
function cleanText(raw: string | null | undefined, max: number): string | null {
  if (!raw) return null;
  const decoded = decodeEntities(raw)
    // Drop any stray angle brackets so a value can never be mistaken for markup.
    .replace(/[<>]/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!decoded) return null;
  return decoded.length > max ? decoded.slice(0, max).trimEnd() + "…" : decoded;
}

/** Decodes the handful of HTML entities that show up in meta-tag content. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#x?0*2f;/gi, "/")
    .replace(/&#(\d{1,7});/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)));
}

function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

/** Pulls the `content` of a `<meta>` tag whose name/property matches `key`. */
function metaContent(html: string, key: string): string | null {
  // Match property|name="key" ... content="..." in EITHER attribute order.
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)\\s*=\\s*["']${k}["'][^>]*\\bcontent\\s*=\\s*["']([^"']*)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${k}["']`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1] != null) return m[1];
  }
  return null;
}

/** The `<title>` element text, as a last-resort title. */
function titleTag(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m && m[1] != null ? m[1] : null;
}

/**
 * Resolves a possibly-relative image URL against the page URL and keeps it ONLY
 * if it's an absolute https URL (the next/image loader + CSP both require it).
 * Protocol-relative (`//host/x`) and root/relative paths are resolved; anything
 * that ends up non-https (http, data:, javascript:) is dropped.
 */
function resolveImage(raw: string | null, pageUrl: string): string | null {
  const cleaned = cleanText(raw, 2000);
  if (!cleaned) return null;
  try {
    const abs = new URL(cleaned, pageUrl);
    return abs.protocol === "https:" ? abs.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Parses OG / Twitter-card / fallback meta from a page's HTML into a sanitized
 * unfurl. `url` is the final URL the HTML was fetched from (used to resolve a
 * relative og:image and as the site-name fallback host). Pure — never throws.
 *
 * Returns null only when there's nothing worth showing (no title at all).
 */
export function parseOgMeta(html: string, url: string): LinkUnfurl | null {
  // Only scan the <head>; bodies can be huge and never carry meta tags.
  const headEnd = html.search(/<\/head>/i);
  const scope = headEnd > 0 ? html.slice(0, headEnd) : html.slice(0, 100_000);

  const title =
    cleanText(metaContent(scope, "og:title"), MAX_TITLE) ??
    cleanText(metaContent(scope, "twitter:title"), MAX_TITLE) ??
    cleanText(titleTag(scope), MAX_TITLE);
  const description =
    cleanText(metaContent(scope, "og:description"), MAX_DESC) ??
    cleanText(metaContent(scope, "twitter:description"), MAX_DESC) ??
    cleanText(metaContent(scope, "description"), MAX_DESC);
  const image =
    resolveImage(metaContent(scope, "og:image"), url) ??
    resolveImage(metaContent(scope, "og:image:url"), url) ??
    resolveImage(metaContent(scope, "twitter:image"), url) ??
    resolveImage(metaContent(scope, "twitter:image:src"), url);
  let host: string | null = null;
  try {
    host = new URL(url).host.replace(/^www\./, "");
  } catch {
    /* malformed final URL — leave host null */
  }
  const siteName = cleanText(metaContent(scope, "og:site_name"), MAX_SITE) ?? host;

  // A card needs at least a title to be worth rendering. A bare host with no
  // title is just a link the reader already sees — skip it.
  if (!title) return null;

  return {
    url,
    title,
    description,
    image,
    siteName,
    fetchedAt: new Date().toISOString(),
  };
}
