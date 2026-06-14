/* TradeMarkk service worker — offline app shell + static asset caching.
 *
 * CSP-clean: uses only the Cache and Fetch APIs (no eval / no inline import of
 * remote code), satisfying the strict CSP. Never caches /api or auth responses
 * and never stores per-user data — only the public app shell, static assets and
 * the sql.js wasm that powers LOCAL (in-browser) mode offline.
 *
 * VERSION is build-derived: scripts/gen-sw.mjs rewrites the placeholder below
 * with the Vercel commit SHA / Next buildId at build time so every deploy ships
 * a byte-different worker, forcing install + old-cache purge. The literal token
 * is itself a valid (if static) cache key, so the worker is safe even unbuilt.
 */
const VERSION = "__TM_SW_VERSION__";

// Precached on install: the offline notice, the LOCAL app shell entry point, the
// brand icons and the sql.js wasm + glue so LOCAL DB init works on first load
// offline. The shell route ("/app/dashboard") is the manifest start_url; caching
// its document lets the client-side LOCAL app boot with no network.
const APP_SHELL = "/app/dashboard";
const PRECACHE = [
  "/offline",
  APP_SHELL,
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
  "/sqljs/sql-wasm.wasm",
  "/sqljs/sql-wasm-browser.wasm",
];

// Stable cache key for the last successfully-fetched app-shell document. Kept in
// the same versioned cache so it is purged on activate when VERSION changes.
const SHELL_DOC_KEY = "/__tm_shell_doc";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then(async (cache) => {
      // addAll is atomic-fail; precache best-effort so one 404 (e.g. a missing
      // wasm in dev) doesn't abort the whole install and leave no shell cached.
      await Promise.all(
        PRECACHE.map((path) =>
          cache.add(path).catch(() => {
            /* best-effort precache; offline strategy degrades gracefully */
          })
        )
      );
      // Do NOT call skipWaiting() here: a new worker waits until the page tells
      // it to (SKIP_WAITING message) so we never swap assets mid-session.
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Page-driven update gate (PWA-04): the page surfaces a "new version" toast and
// only then asks the waiting worker to activate, so refreshes are user-initiated.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  // Never touch API / auth / data routes — they must always hit the network and
  // never be cached (per-user data, auth cookies, mutations).
  if (url.pathname.startsWith("/api/")) return;

  // App navigations: network-first, but cache successful shell documents and
  // fall back to the last-good document — then the precached LOCAL shell — and
  // only show /offline when nothing usable is cached.
  if (request.mode === "navigate") {
    event.respondWith(handleNavigate(request, url));
    return;
  }

  // Hashed static assets & wasm: cache-first with a network fill and an offline
  // fallback so a missing chunk/wasm offline degrades instead of hard-failing.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/sqljs/") ||
    url.pathname.startsWith("/icons/")
  ) {
    event.respondWith(handleAsset(request));
  }
});

async function handleNavigate(request, url) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    // Cache only OK, same-origin ("basic") HTML documents — never opaque,
    // redirect or error responses (PWA-08 cache-poisoning guard). Store under a
    // single stable shell key so the cache holds one good document, not one per
    // visited URL.
    if (res.ok && res.type === "basic") {
      cache.put(SHELL_DOC_KEY, res.clone()).catch(() => {});
      // Keep the precached LOCAL shell route fresh too.
      if (url.pathname === APP_SHELL) cache.put(APP_SHELL, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    // Offline: serve the last good document, then the precached LOCAL shell,
    // then the dedicated offline notice. LOCAL mode (sql.js/IndexedDB) can then
    // boot fully offline from the cached shell + precached wasm.
    return (
      (await cache.match(SHELL_DOC_KEY)) ??
      (await cache.match(APP_SHELL)) ??
      (await cache.match("/offline")) ??
      Response.error()
    );
  }
}

async function handleAsset(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    // Only cache successful, same-origin responses — never 4xx/5xx or opaque
    // (PWA-08): a poisoned chunk/wasm would otherwise stick forever cache-first.
    if (res.ok && res.type === "basic") {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    // Offline with nothing cached for this asset (PWA-09): re-check the cache
    // (a concurrent fill may have landed) then fail soft rather than throwing a
    // raw ChunkLoadError / wasm-init crash.
    const fallback = await cache.match(request);
    if (fallback) return fallback;
    throw err;
  }
}
