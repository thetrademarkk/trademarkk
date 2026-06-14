import "server-only";
import https from "node:https";
import { eq } from "drizzle-orm";
import { platformDb } from "./db/platform";
import { linkUnfurls } from "./db/platform-schema";
import { assertSafeUrl, type SafeTarget } from "./ssrf";
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
 * The IP-PINNED network primitive. Connects to the EXACT pre-validated address
 * (`target.addresses[0]`) instead of letting the TLS/HTTP stack re-resolve the
 * hostname — this is the fix for the DNS-rebinding TOCTOU: the address that was
 * validated by assertSafeUrl is the address we connect to, so a low-TTL attacker
 * domain cannot return a public IP to the validator and a private IP to the
 * connect. The original hostname is still used for TLS SNI (`servername`) and
 * the HTTP `Host` header so virtual hosts + certificate validation keep working.
 *
 * Runs on the Node.js runtime (node:https). Redirects are NOT followed here
 * (`redirect: "manual"` semantics): a 3xx response is returned verbatim so the
 * caller re-validates AND re-pins the Location target on the next hop. Never
 * follows more than the single request it is given.
 *
 * Returns a standard `Response`. Pulled out as a module-level binding
 * (`pinnedFetchImpl`) so unit tests can substitute a deterministic transport.
 */
async function pinnedHttpsGet(target: SafeTarget, signal: AbortSignal): Promise<Response> {
  const { url } = target;
  const pinned = target.addresses[0];
  if (!pinned) throw new Error("no pinned address");
  const port = url.port ? Number(url.port) : 443;
  const path = `${url.pathname}${url.search}`;

  return await new Promise<Response>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const req = https.request(
      {
        host: pinned.address, // dial the literal validated IP …
        port,
        path,
        method: "GET",
        servername: url.hostname, // … but present the real hostname for TLS SNI …
        family: pinned.family,
        // Belt-and-suspenders: even though `host` is already a literal IP (so no
        // resolution happens), hard-pin the lookup hook to the validated address
        // so there is provably no second, independent DNS resolution.
        lookup: (_hostname, _opts, cb) =>
          (cb as (e: Error | null, a: string, f: number) => void)(
            null,
            pinned.address,
            pinned.family
          ),
        headers: {
          host: url.port ? `${url.hostname}:${url.port}` : url.hostname, // … and Host.
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) for (const one of v) headers.append(k, one);
          else if (v != null) headers.set(k, v);
        }
        // For a 3xx we don't need the body — return early so the caller redirects.
        if (status >= 300 && status < 400) {
          res.resume(); // drain + free the socket
          resolve(new Response(null, { status, headers }));
          return;
        }
        const chunks: Uint8Array[] = [];
        let total = 0;
        let settled = false;
        // Decode the capped bytes to text and hand back a single Response. Body
        // is a string (unambiguous BodyInit) so readCapped() re-reads it cleanly.
        const finish = () => {
          if (settled) return;
          settled = true;
          const body = new TextDecoder("utf-8").decode(concat(chunks, MAX_BYTES));
          resolve(new Response(body, { status, headers }));
        };
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total >= MAX_BYTES) res.destroy(); // honour the size cap
        });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", reject);
      }
    );
    const onAbort = () => req.destroy(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", (e) => {
      signal.removeEventListener("abort", onAbort);
      reject(e);
    });
    req.on("close", () => signal.removeEventListener("abort", onAbort));
    req.end();
  });
}

/**
 * Indirection point for the pinned transport. Production uses pinnedHttpsGet;
 * unit tests swap it via __setPinnedTransport to assert exactly which IP would
 * be dialled (proving validation-IP === connection-IP) without real sockets.
 */
type PinnedTransport = (target: SafeTarget, signal: AbortSignal) => Promise<Response>;
let pinnedFetchImpl: PinnedTransport = pinnedHttpsGet;

/** TEST-ONLY: override the pinned transport. Returns a restore function. */
export function __setPinnedTransport(fn: PinnedTransport): () => void {
  const prev = pinnedFetchImpl;
  pinnedFetchImpl = fn;
  return () => {
    pinnedFetchImpl = prev;
  };
}

/**
 * Fetches and parses the OG/twitter meta for a URL, following redirects
 * MANUALLY so each hop is SSRF-re-validated AND re-pinned (a public URL can't
 * 30x into a private host, and the connection always goes to the exact IP that
 * assertSafeUrl validated for THIS hop). Returns the sanitized unfurl, or null
 * when there's nothing to show or anything is unsafe. Never throws.
 */
export async function fetchUnfurl(rawUrl: string): Promise<LinkUnfurl | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Re-validate + re-resolve on EVERY hop. `safe.addresses` is the pinned set
    // we connect to — validation-IP === connection-IP, defeating DNS rebinding.
    const safe = await assertSafeUrl(current);
    if (!safe.ok) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await pinnedFetchImpl(safe, controller.signal);
    } catch {
      clearTimeout(timer);
      return null;
    }
    clearTimeout(timer);

    // Manual redirect handling — re-validate AND re-pin the Location target next
    // loop (a fresh assertSafeUrl runs at the top of the loop for `current`).
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
