/* eslint-disable */
/**
 * Spotivibe service worker (M13; design decisions 1, 2, 3, 6).
 *
 * Hand-written, dependency-free, and deliberately small. Every request is
 * classified before anything is decided, because the failure modes differ per
 * class and one blanket policy cannot be right for all of them:
 *
 *   - a stale *page* is confusing, so a prerendered navigation is network-first;
 *   - a stale *search* is wrong, so search/radio/playlist are never cached;
 *   - a cached *player API* is a playback-compliance hazard, so YouTube and
 *     googlevideo are never cached, whatever the request looks like;
 *   - an *uncached shell* makes the whole milestone pointless, so hashed build
 *     assets are cache-first (their URLs cannot go stale).
 *   - a *browser error page* is a dead end, so a per-entity navigation that cannot
 *     reach the network falls back to the cached shell document: the application
 *     still loads and the route shows its own "could not load" state. It never
 *     falls back to another entity's response.
 *
 * Rules, in the order they are applied:
 *
 *   1. non-GET, or a `Range` request                      -> network only
 *   2. player/YouTube hosts                                -> network only
 *   3. content-hashed `/_next/static/*`, same-origin icons  -> cache first
 *   4. any same-origin navigation                         -> network, then this
 *                                                          route's own cached
 *                                                          document, then the shell
 *   6. `GET /api/{artist,album,similar,discover}`          -> network, then cache
 *   7. other `/api/*`                                     -> network only
 *   8. image requests (artwork)                            -> cache first
 *   9. anything else                                       -> network only
 *
 * Storage discipline (spec `pwa` — "Service worker update flow"): this worker
 * never touches IndexedDB and never deletes a cache it did not create. Its
 * caches are namespaced `spotivibe-<name>-v<VERSION>` and are dropped only when
 * the version changes, which is what makes a listener's data untouchable by
 * construction rather than by care.
 *
 * Bounded (design decision 3): every cache has a named maximum, evicted
 * first-in-first-out. The numbers are asserted by a static test, so raising one is
 * a deliberate edit rather than a silent growth.
 *
 * This file is a **classic** worker script, so it has no `import`/`export` - a
 * service worker registered without `{ type: "module" }` cannot parse them. The
 * tests therefore evaluate *these bytes* in a sandbox with a fake `self`, `caches`
 * and `fetch`, and drive the registered `fetch` handler directly, rather than
 * testing a copy of the logic in a module the worker does not run.
 */

/* The cache version. Bump it to retire every cache this worker owns. */
const VERSION = "v1";

/** Maximum entries per cache; FIFO eviction beyond it (design decision 3). */
const MAX_ENTRIES = {
  /** Hashed build assets and same-origin icons. */
  assets: 200,
  /** Rendered HTML for the app's own prerendered routes. */
  pages: 20,
  /** Keyless provider metadata responses. */
  metadata: 100,
  /** Artwork images. */
  artwork: 300,
};

/** How long a cached metadata response stays an acceptable answer (7 days). */
const METADATA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const CACHES = {
  assets: `spotivibe-assets-${VERSION}`,
  pages: `spotivibe-pages-${VERSION}`,
  metadata: `spotivibe-metadata-${VERSION}`,
  artwork: `spotivibe-artwork-${VERSION}`,
};

/**
 * The app's own prerendered routes. A navigation to one of these can fall back to
 * cache; a navigation to anything else (`/artist/…`, `/album/…`, `/playlist/…`)
 * must not, because a cached response for a *different* entity is a lie.
 */
const PRERENDERED_PATHS = [
  "/",
  "/discover",
  "/history",
  "/library",
  "/library/liked",
  "/now-playing",
  "/queue",
  "/search",
  "/settings",
];

/**
 * The shell document a per-entity navigation falls back to.
 *
 * The site root, because it is the one route every listener has visited before
 * opening any entity route - and because it is the route whose document is a shell
 * rather than an entity's content.
 */
const SHELL_URL = "/";

/** Hosts the worker must never mediate: the live player, and its media. */
const NEVER_CACHE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "googlevideo.com",
  "ytimg.com",
  "i.ytimg.com",
];

/**
 * The metadata endpoints that are safe to keep: every one of them is keyless and
 * profile-free by its own spec, so a stale copy is a convenience rather than a
 * leak. `/api/search`, `/api/radio` and `/api/playlist` are deliberately absent —
 * a search is a live question, a radio request is a rotation, and a playlist
 * resolution is an import path.
 */
const CACHEABLE_API_PATHS = ["/api/artist", "/api/album", "/api/similar", "/api/discover"];

/* ------------------------------------------------------------------ *
 * Classification (pure, and unit-tested directly)
 * ------------------------------------------------------------------ */

/** Whether a host is one the worker must never cache. */
function isNeverCacheHost(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  return NEVER_CACHE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * The class of a request, from the pieces the worker is allowed to rely on.
 *
 * Returns one of: `player`, `mutation`, `hashed-asset`, `page`, `entity-page`,
 * `metadata`, `live-api`, `artwork`, `passthrough`.
 */
function classifyRequest(request, url, origin) {
  if (request.method !== "GET") return "mutation";
  // A range request is a media seek; a partial response from cache would be wrong.
  if (request.headers.has("range")) return "mutation";
  if (isNeverCacheHost(url.hostname)) return "player";
  if (url.origin !== origin) return request.destination === "image" ? "artwork" : "passthrough";

  if (request.mode === "navigate") {
    return PRERENDERED_PATHS.includes(url.pathname) ? "page" : "entity-page";
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    return "hashed-asset";
  }
  if (url.pathname === "/icon.svg") return "hashed-asset";
  if (url.pathname.startsWith("/api/")) {
    return CACHEABLE_API_PATHS.includes(url.pathname) ? "metadata" : "live-api";
  }
  if (request.destination === "image") return "artwork";
  return "passthrough";
}

/** The cache a class fills, or `null` when the class is network-only. */
function cacheNameFor(classification) {
  switch (classification) {
    case "hashed-asset":
      return CACHES.assets;
    case "page":
      return CACHES.pages;
    case "metadata":
      return CACHES.metadata;
    case "artwork":
      return CACHES.artwork;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Cache maintenance
 * ------------------------------------------------------------------ */

/** Delete the oldest entries until the cache is within its bound. */
async function enforceBound(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  // `keys()` is in insertion order, so the head of the list is the oldest entry.
  for (const key of keys.slice(0, keys.length - max)) {
    await cache.delete(key);
  }
}

/**
 * Store a response and keep the cache within its bound.
 *
 * The key is a `Request` or a URL string. The string form matters: the Cache API
 * resolves it against the worker's scope, and `new Request("/")` throws inside a
 * worker - which is a bug this function's own first draft had, silently swallowed
 * by the precache's catch block.
 */
async function store(cacheName, request, response, max) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  await enforceBound(cacheName, max);
  return response;
}

/** A cached metadata response that is still an acceptable answer, or `null`. */
async function freshMetadata(request) {
  const cache = await caches.open(CACHES.metadata);
  const cached = await cache.match(request);
  if (!cached) return null;
  const storedAt = Number(cached.headers.get("x-spotivibe-cached-at") ?? "0");
  if (!Number.isFinite(storedAt) || storedAt === 0) return null;
  if (Date.now() - storedAt > METADATA_MAX_AGE_MS) {
    await cache.delete(request);
    return null;
  }
  return cached;
}

/* ------------------------------------------------------------------ *
 * Per-class handling
 * ------------------------------------------------------------------ */

/** Hashed assets and icons: a cache hit is correct by construction. */
async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  return store(cacheName, request, response, max);
}

/**
 * A navigation: always fresh when online, and never a dead end when not.
 *
 * Three outcomes, in order:
 *   1. the network answers - the response is returned and cached for next time;
 *   2. the network cannot answer and this exact route was cached before - that
 *      route's own document, which is the right content for the right URL;
 *   3. the network cannot answer and this route was never visited - the cached
 *      *shell document*, so the application still loads and the route renders its
 *      own state (a search page that cannot search, an error surface for an artist
 *      that cannot load). Failing the navigation instead hands the listener the
 *      browser's own error page: no navigation, no player, no way back.
 */
async function navigationFirst(request) {
  const cache = await caches.open(CACHES.pages);
  try {
    const response = await fetch(request);
    return await store(CACHES.pages, request, response, MAX_ENTRIES.pages);
  } catch (error) {
    const own = await cache.match(request);
    if (own) return own;
    const shell = await cache.match(SHELL_URL);
    if (shell) return shell;
    // Nothing cached at all: the failure is the honest answer, and the browser says so.
    throw error;
  }
}

/*
 * A per-entity navigation uses the same three outcomes as any other navigation
 * (`navigationFirst`): never another entity's response, and never a browser error
 * page. Offline, `/artist/someone` has no cached document of its own, so the shell
 * document boots the application and the route's own client-side data request is
 * what then fails, leaving the route's own "could not load" state on screen
 * (spec `pwa` - "A per-entity route falls back to the shell, never to another
 * entity").
 */

/** Metadata: live when reachable, cached within its freshness bound otherwise. */
async function metadataFirst(request) {
  const cache = await caches.open(CACHES.metadata);
  try {
    const response = await fetch(request);
    if (response.ok) {
      // The age is a header on the copy we store, so the stored response still
      // matches the body the client parses. The body is re-wrapped as text
      // rather than as a Blob: these are small JSON documents, and Blob-bodied
      // Response construction is not uniformly supported by every runtime a
      // worker can be handed.
      const body = await response.clone().text();
      const headers = new Headers(response.headers);
      headers.set("x-spotivibe-cached-at", String(Date.now()));
      await store(
        CACHES.metadata,
        request,
        new Response(body, { status: response.status, statusText: response.statusText, headers }),
        MAX_ENTRIES.metadata,
      );
    }
    return response;
  } catch (error) {
    const cached = await freshMetadata(request);
    if (cached) return cached;
    throw error;
  }
}

/** Artwork: display-only, third-party, and safe to serve slightly stale. */
async function artworkFirst(request) {
  const cache = await caches.open(CACHES.artwork);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => store(CACHES.artwork, request, response, MAX_ENTRIES.artwork))
    .catch(() => undefined);
  if (cached) return cached;
  const response = await network;
  if (response) return response;
  throw new Error("artwork unavailable");
}

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

self.addEventListener("install", (event) => {
  // Take over as soon as the new worker is installed: a waiting worker is
  // announced to the page, which decides when to activate it (design decision 6).
  event.waitUntil(self.skipWaiting());
  // One entry, fetched at install time: the shell document. Every per-entity
  // navigation falls back to it (see `navigationFirst`), so without it the very
  // first offline visit to an artist would hand the listener a browser error page
  // if they had never landed on the site root. A single HTML document is the
  // cheapest possible guarantee that "the app opens offline" is true from the
  // first visit rather than from the second.
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch(SHELL_URL, { credentials: "same-origin" });
        if (response.ok) {
          await store(CACHES.pages, SHELL_URL, response, MAX_ENTRIES.pages);
        }
      } catch {
        // An install that cannot reach the network still installs: the precache is
        // an improvement, not a precondition, and the worker's failure mode is
        // "go to the network", never "deny the request".
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Retire this worker's *own* previous caches and nothing else. A cache this
      // worker did not create is never deleted, and no storage API beyond Cache
      // Storage is touched at all.
      const owned = new Set(Object.values(CACHES));
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("spotivibe-") && !owned.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // The page asks for the waiting update to take over; `skipWaiting` alone is not
  // enough, because the page must also be re-rendered from the new build.
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(
      (async () => {
        await self.skipWaiting();
        const windows = await self.clients.matchAll({ type: "window" });
        for (const client of windows) client.postMessage({ type: "ACTIVATED" });
      })(),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return; // Not a URL we can reason about: the browser's default is correct.
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const origin = self.location.origin;
  const classification = classifyRequest(request, url, origin);
  const cacheName = cacheNameFor(classification);

  switch (classification) {
    case "hashed-asset":
      event.respondWith(cacheFirst(request, cacheName, MAX_ENTRIES.assets));
      return;
    case "page":
      event.respondWith(navigationFirst(request));
      return;
    case "metadata":
      event.respondWith(metadataFirst(request));
      return;
    case "entity-page":
      event.respondWith(navigationFirst(request));
      return;
    case "artwork":
      event.respondWith(artworkFirst(request));
      return;
    default:
      // `mutation`, `player`, `live-api`, `passthrough`: the browser's own network
      // path, untouched. Saying so explicitly is the point of the table — an
      // unlisted request is not a decision, it is a default.
      return;
  }
});
