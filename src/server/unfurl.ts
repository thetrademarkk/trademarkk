import "server-only";
import { eq } from "drizzle-orm";
import { platformDb } from "./db/platform";
import { linkUnfurls } from "./db/platform-schema";
import { assertSafeUrl } from "./ssrf";
import { isUnfurlFresh, parseOgMeta, urlHash, type LinkUnfurl } from "@/features/community/unfurl";

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024; // cap the response read at ~512KB
const MAX_REDIRECTS = 3;
const USER_AGENT = "TradeMarkkBot/1.0 (+https://thetrademarkk.com)";

/** A DB row → public unfurl view (or null when we cached a "nothing here"). */
function rowToUnfurl(row: typeof linkUnfurls.$inferSelect): LinkUnfurl | null {
  if (!row.title && !row.description && !row.image) return null;
  return {
    url: row.url,
    title: row.title,
    description: row.description,
    image: row.image,
    siteName: row.siteName,
    fetchedAt: row.fetchedAt,
  };
}

/** Reads a cached unfurl by URL, regardless of freshness. */
async function readCache(url: string): Promise<typeof linkUnfurls.$inferSelect | undefined> {
  return platformDb
    .select()
    .from(linkUnfurls)
    .where(eq(linkUnfurls.urlHash, urlHash(url)))
    .get();
}

/** Upserts the unfurl cache row (negative results are cached too, as empty fields). */
async function writeCache(url: string, meta: LinkUnfurl | null): Promise<void> {
  const now = new Date().toISOString();
  await platformDb
    .insert(linkUnfurls)
    .values({
      urlHash: urlHash(url),
      url,
      title: meta?.title ?? null,
      description: meta?.description ?? null,
      image: meta?.image ?? null,
      siteName: meta?.siteName ?? null,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: linkUnfurls.urlHash,
      set: {
        url,
        title: meta?.title ?? null,
        description: meta?.description ?? null,
        image: meta?.image ?? null,
        siteName: meta?.siteName ?? null,
        fetchedAt: now,
      },
    })
    .catch(() => undefined); // caching must never break the request
}

/** Reads a capped slice of the response body as UTF-8 text. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
      if (total >= MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  }
  return new TextDecoder("utf-8").decode(concat(chunks, MAX_BYTES));
}

function concat(chunks: Uint8Array[], cap: number): Uint8Array {
  const out = new Uint8Array(
    Math.min(
      cap,
      chunks.reduce((n, c) => n + c.length, 0)
    )
  );
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const slice = c.subarray(0, out.length - off);
    out.set(slice, off);
    off += slice.length;
  }
  return out;
}

/**
 * Fetches and parses the OG/twitter meta for a URL, following redirects
 * MANUALLY so each hop is SSRF-re-validated (a public URL can't 30x into a
 * private host). Returns the sanitized unfurl, or null when there's nothing to
 * show or anything is unsafe. Never throws.
 */
export async function fetchUnfurl(rawUrl: string): Promise<LinkUnfurl | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = await assertSafeUrl(current);
    if (!safe.ok) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(safe.url.toString(), {
        method: "GET",
        redirect: "manual", // we re-validate each hop ourselves
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      clearTimeout(timer);
      return null;
    }
    clearTimeout(timer);

    // Manual redirect handling — re-validate the Location target next loop.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try {
        current = new URL(loc, safe.url).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (!res.ok) return null;

    const ctype = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ctype)) return null;

    const html = await readCapped(res).catch(() => "");
    if (!html) return null;
    return parseOgMeta(html, safe.url.toString());
  }
  return null; // too many redirects
}

/**
 * Returns the cached unfurl for a URL, fetching+caching on a miss or when the
 * cached copy is stale. A stale-but-present row is returned immediately and a
 * refresh is fired in the background (stale-while-revalidate) so a viewer never
 * blocks on a re-fetch. The whole thing degrades to null on any error.
 */
export async function getUnfurl(rawUrl: string): Promise<LinkUnfurl | null> {
  let cachedRow: typeof linkUnfurls.$inferSelect | undefined;
  try {
    cachedRow = await readCache(rawUrl);
  } catch {
    cachedRow = undefined;
  }

  if (cachedRow && isUnfurlFresh(cachedRow.fetchedAt)) {
    return rowToUnfurl(cachedRow);
  }

  if (cachedRow) {
    // Stale: serve it now, refresh in the background.
    void (async () => {
      const fresh = await fetchUnfurl(rawUrl);
      await writeCache(rawUrl, fresh);
    })();
    return rowToUnfurl(cachedRow);
  }

  // Cold miss — fetch synchronously (the route is called lazily on first view).
  const meta = await fetchUnfurl(rawUrl);
  await writeCache(rawUrl, meta);
  return meta;
}
