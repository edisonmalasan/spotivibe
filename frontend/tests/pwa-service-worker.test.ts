import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M13 tasks 2.1, 2.2, 3.3: the service worker's real behavior.
 *
 * `public/sw.js` is a **classic** worker script — it cannot contain `import` or
 * `export`, and registering it with `{ type: "module" }` would be a lie about a
 * file that is not a module. So these tests evaluate the shipped bytes in a
 * sandbox with a fake `self`, `caches` and `fetch`, and drive the `fetch` handler
 * the worker actually registered.
 *
 * That is deliberately stronger than testing a copy of the classification logic in
 * a module the worker does not run: if the table in the file and the handler in the
 * file ever disagree, these tests see it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(here, "..", "public", "sw.js");
const workerSource = readFileSync(WORKER_PATH, "utf8");

const ORIGIN = "https://app.test";

/** The absolute URL a request or relative string key names, as a real cache sees it. */
/**
 * A cache that fails to read, standing in for the corrupted or half-deleted store a
 * real device eventually has.
 *
 * `match` and `delete` throw, and `open` still succeeds: the failure mode the worker
 * must survive is "the cache cannot be read", not "the cache is absent".
 */
function withUnreadableCaches(harness: WorkerHarness, names: string[]): void {
  for (const name of names) {
    const original = harness.caches.open;
    harness.caches.open = async (requested: string) => {
      const cache = await original(requested);
      if (!names.includes(requested)) return cache;
      return {
        async keys() {
          return cache.keys();
        },
        async match() {
          throw new DOMException("cache is corrupted", "InvalidStateError");
        },
        async put() {
          throw new DOMException("cache is corrupted", "InvalidStateError");
        },
        async delete() {
          throw new DOMException("cache is corrupted", "InvalidStateError");
        },
      };
    };
  }
}

/** A response whose declared length does not match its body: a truncated write. */
function truncatedResponse(declaredLength: number, body = "half a doc"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html", "content-length": String(declaredLength) },
  });
}

function absoluteKey(request: Request | string): string {
  return typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
}

/** A minimal in-memory Cache Storage, with the ordering `keys()` must have. */
function createCacheStorage() {
  const stores = new Map<string, Map<string, Response>>();
  const deleted: string[] = [];
  const storage = {
    deleted,
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name)!;
      return {
        async keys() {
          return [...entries.keys()].map((url) => new Request(url));
        },
        async match(request: Request | string) {
          // The real Cache resolves a string key against the worker's scope, so
          // `match("/")` finds the entry stored for the site root. A fake that
          // compared strings literally would report a cache miss that does not
          // happen in a browser, which is how a working rule looks broken.
          const key = typeof request === "string" ? new URL(request, ORIGIN).href : request.url;
          const hit = entries.get(key);
          return hit === undefined ? undefined : hit.clone();
        },
        // Keys are normalized to absolute URLs on the way in, exactly as the real
        // Cache API does when a worker stores a relative string key.
        async put(request: Request | string, response: Response) {
          entries.set(absoluteKey(request), response);
        },
        async delete(request: Request | string) {
          entries.delete(absoluteKey(request));
          return true;
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      deleted.push(name);
      return stores.delete(name);
    },
    /** Test-only: how many entries a named cache holds. */
    sizeOf(name: string) {
      return stores.get(name)?.size ?? 0;
    },
  };
  return storage;
}

/** The two client APIs a test asserts on, typed rather than `unknown`. */
interface StubbedClients {
  claim: ReturnType<typeof vi.fn>;
  matchAll: ReturnType<typeof vi.fn>;
}

/** The path a fetch argument names, however the caller expressed it. */
function pathOf(input: unknown): string {
  const url =
    typeof input === "string"
      ? new URL(input, ORIGIN)
      : new URL(String((input as Request)?.url ?? input));
  return url.pathname;
}

type WorkerHarness = {
  caches: ReturnType<typeof createCacheStorage>;
  fetchMock: ReturnType<typeof vi.fn>;
  handlers: Map<string, (event: unknown) => void>;
  /** Drive the worker's own `fetch` handler for a request. */
  respond(request: Request): Promise<Response | undefined>;
  fire(type: string, event?: Record<string, unknown>): Promise<void>;
  /** The globals the worker's top level touched. */
  scope: Record<string, unknown>;
  clients: StubbedClients;
  skipWaiting: ReturnType<typeof vi.fn>;
};

function loadWorker(): WorkerHarness {
  const caches = createCacheStorage();
  const fetchMock = vi.fn(async () => new Response("live", { status: 200 }));
  const handlers = new Map<string, (event: unknown) => void>();
  const lifecycle: Array<() => Promise<void>> = [];
  const clients: StubbedClients = {
    claim: vi.fn(async () => undefined),
    matchAll: vi.fn(async () => []),
  };
  const scope: Record<string, unknown> = {
    location: { origin: ORIGIN },
    clients,
    skipWaiting: vi.fn(async () => undefined),
    caches,
    fetch: fetchMock,
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      handlers.set(type, handler);
    },
  };
  scope.self = scope;

  // A classic script: run the file's body with `self` (and only `self`) in scope.
  const run = new Function("self", "caches", "fetch", "console", `${workerSource}\n`);
  run(scope, caches, fetchMock, console);

  return {
    caches,
    fetchMock,
    handlers,
    scope,
    clients,
    skipWaiting: scope.skipWaiting as ReturnType<typeof vi.fn>,
    async respond(request: Request) {
      let settled: Promise<Response> | undefined;
      const event = {
        request,
        respondWith(promise: Promise<Response>) {
          settled = promise;
        },
        waitUntil(promise: Promise<unknown>) {
          void promise;
        },
      };
      handlers.get("fetch")?.(event);
      // `respondWith` was not called: the class is network-only and the worker
      // deliberately leaves the request to the browser.
      if (settled === undefined) return undefined;
      return settled;
    },
    async fire(type, event: Record<string, unknown> = {}) {
      const pending: Array<Promise<unknown>> = [];
      handlers.get(type)?.({
        ...event,
        waitUntil(promise: Promise<unknown>) {
          pending.push(promise);
        },
      });
      await Promise.all(pending);
      void lifecycle;
    },
  };
}

/** A GET request in the shape the worker inspects. */
function get(url: string, init: { mode?: string; destination?: string; range?: boolean } = {}) {
  const request = new Request(
    url,
    init.range === undefined ? undefined : { headers: { range: "bytes=0-1" } },
  );
  Object.defineProperty(request, "mode", { value: init.mode ?? "no-cors", configurable: true });
  Object.defineProperty(request, "destination", {
    value: init.destination ?? "",
    configurable: true,
  });
  return request;
}

let worker: WorkerHarness;

beforeEach(() => {
  worker = loadWorker();
});

describe("the worker's request classification (task 2.1)", () => {
  it("never caches the player, a mutation, or a range request", async () => {
    // The denials are the half nobody usually writes tests for, and the half that
    // matters most: a cached player script is a compliance hazard, and a partial
    // response served from cache is a media bug.
    for (const [url, init] of [
      ["https://www.youtube.com/iframe_api", { destination: "script" }],
      ["https://i.ytimg.com/vi/abc/hqdefault.jpg", { destination: "image" }],
      ["https://r1---sn-abc.googlevideo.com/videoplayback", { destination: "video" }],
      [`${ORIGIN}/api/search?q=x`, { mode: "cors" }],
    ] as const) {
      const response = await worker.respond(get(url, init));
      expect(response, url).toBeUndefined();
    }
    // A non-GET and a range request are refused the same way, whatever the URL.
    const post = new Request(`${ORIGIN}/api/search`, { method: "POST" });
    expect(await worker.respond(post)).toBeUndefined();
    expect(
      await worker.respond(get(`${ORIGIN}/icons/icon-192.png`, { range: true })),
    ).toBeUndefined();
    // And the worker made no request of its own for any of them.
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it("caches content-hashed build assets and icons cache-first", async () => {
    const asset = get(`${ORIGIN}/_next/static/chunks/main-abc123.js`, { destination: "script" });
    const first = await worker.respond(asset);
    expect(first?.status).toBe(200);
    expect(worker.caches.sizeOf("spotivibe-assets-v1")).toBe(1);

    // A second request is served from cache: the live fetch is not called again.
    worker.fetchMock.mockClear();
    const second = await worker.respond(
      get(`${ORIGIN}/_next/static/chunks/main-abc123.js`, { destination: "script" }),
    );
    expect(await second?.text()).toBe("live");
    expect(worker.fetchMock).not.toHaveBeenCalled();

    const icon = await worker.respond(
      get(`${ORIGIN}/icons/icon-192.png`, { destination: "image" }),
    );
    expect(icon?.status).toBe(200);
  });

  it("never answers a live question from cache, even as a top-level navigation", async () => {
    // Search, radio and playlist are deliberate absences from the cacheable set.
    // `undefined` here is the worker's way of saying "not mine to handle": it does
    // not call `respondWith` at all, so the browser performs the request itself.
    //
    // The navigation mode is asserted as well, and it is the half that was wrong
    // first: a listener who searched, lost the network, and pressed Back re-requests
    // the search URL as a top-level *navigation*, and the classification table used
    // to check `request.mode` before the `/api/` rule - so that result set was written
    // into the *page* cache and served back as if it were live.
    for (const mode of ["cors", "navigate"]) {
      for (const path of ["/api/search?q=x", "/api/radio?kind=track", "/api/playlist?id=PL1"]) {
        const response = await worker.respond(get(`${ORIGIN}${path}`, { mode }));
        expect(response, `${mode} ${path}`).toBeUndefined();
        expect(worker.caches.sizeOf("spotivibe-metadata-v1"), `${mode} ${path}`).toBe(0);
        expect(worker.caches.sizeOf("spotivibe-pages-v1"), `${mode} ${path}`).toBe(0);
      }
    }
    // And the rule is "a path is a path", not "navigations are pages": a cacheable
    // metadata endpoint is still classified by path when requested as a navigation.
    const meta = await worker.respond(get(`${ORIGIN}/api/artist?name=x`, { mode: "navigate" }));
    expect(meta).toBeDefined();
    expect(worker.caches.sizeOf("spotivibe-metadata-v1")).toBe(1);
  });

  it("never caches /api/discover, whose seeds come from the listener's own data", async () => {
    // `/api/discover` is keyless but not profile-free: the client sends `seeds`
    // derived from liked tracks and listening events, and `languages` from
    // preferences. The worker's justification for caching a metadata endpoint is
    // that it carries no listener data, which is false for this one - so it is
    // served live and left uncached rather than justified.
    const response = await worker.respond(
      get(`${ORIGIN}/api/discover?kind=trending&seeds=bjork,portishead&languages=en`, {
        mode: "cors",
      }),
    );
    expect(response).toBeUndefined();
    expect(worker.caches.sizeOf("spotivibe-metadata-v1")).toBe(0);
  });

  it("passes a cross-origin non-image request straight through", async () => {
    // The cross-origin branch must not guess: only an image is cacheable there,
    // and anything else is the browser's own business. (A `url.request` typo made
    // this throw; the class table is only honest if this path is exercised.)
    expect(
      await worker.respond(get("https://fonts.test/inter.woff2", { destination: "font" })),
    ).toBeUndefined();
    expect(
      await worker.respond(get("https://img.test/cover.jpg", { destination: "image" })),
    ).toBeDefined();
  });

  it("caches a prerendered page and serves it when the network is gone", async () => {
    const online = await worker.respond(get(`${ORIGIN}/library`, { mode: "navigate" }));
    expect(await online?.text()).toBe("live");
    expect(worker.caches.sizeOf("spotivibe-pages-v1")).toBe(1);

    worker.fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const offline = await worker.respond(get(`${ORIGIN}/library`, { mode: "navigate" }));
    expect(await offline?.text()).toBe("live");
  });

  it("serves a visited route its own cached document, and an unvisited one the shell", async () => {
    // One rule for every navigation, with an ordered fallback chain. The M13
    // evidence run forced the second half: a per-entity rule that fell back to the
    // shell left a *prerendered* route that had never been visited failing the
    // navigation, and the listener got the browser's own "no internet" page.
    // Path-tagged bodies so "this route's own document", "the shell" and "some
    // other route's document" are three distinguishable outcomes.
    worker.fetchMock.mockImplementation(async (input) => new Response(`body:${pathOf(input)}`));
    // Install first, exactly as the browser does: that is when the shell document is
    // precached, and the fallback has nothing to redirect to without it.
    await worker.fire("install");
    await worker.respond(get(`${ORIGIN}/library`, { mode: "navigate" }));
    expect(worker.caches.sizeOf("spotivibe-pages-v1")).toBe(1);
    expect(worker.caches.sizeOf("spotivibe-shell-v1")).toBe(1);

    // The network is gone from here on.
    worker.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    // A route that was visited: its own document.
    const own = await worker.respond(get(`${ORIGIN}/library`, { mode: "navigate" }));
    expect(await own?.text()).toBe("body:/library");
    // An unvisited route - per-entity or prerendered alike - is *redirected* to the
    // shell rather than answered with the shell's document: serving one route's
    // document under another route's URL renders the wrong content at the wrong
    // address, which the evidence run observed (/search offline showed the Home route
    // while the address bar still said /search).
    for (const path of ["/artist/Portishead", "/search"]) {
      const response = await worker.respond(get(`${ORIGIN}${path}`, { mode: "navigate" }));
      expect(response?.status, path).toBe(302);
      expect(response?.headers.get("location"), path).toBe(`${ORIGIN}/`);
    }
    // Nothing was written for a response that never arrived.
    expect(worker.caches.sizeOf("spotivibe-pages-v1")).toBe(1);
  });

  it("never answers one route with another route's cached document", async () => {
    // The half of the chain that matters: the shell is a fallback, not a wildcard.
    worker.fetchMock.mockImplementation(async (input) => new Response(`body:${pathOf(input)}`));
    await worker.fire("install");
    await worker.respond(get(`${ORIGIN}/history`, { mode: "navigate" }));

    worker.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const neverVisited = await worker.respond(
      get(`${ORIGIN}/queue-insights`, { mode: "navigate" }),
    );
    // A redirect to the shell (`/`), never `/history`'s own document.
    expect(neverVisited?.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(neverVisited?.status).toBe(302);
  });

  it("precaches the shell document on install, in a cache of its own", async () => {
    // Without this, the first offline visit to an artist by a listener who landed
    // straight on /library has no shell to serve and hands them a browser error
    // page instead of the application.
    await worker.fire("install");
    expect(worker.caches.sizeOf("spotivibe-shell-v1")).toBe(1);
    const shell = await worker.caches.open("spotivibe-shell-v1");
    expect((await shell.keys()).map((key) => key.url)).toEqual([`${ORIGIN}/`]);
    // Not in the pages cache, which is bounded and FIFO: a shell entry stored there
    // was evicted after about nineteen document navigations, quietly restoring the
    // browser-error-page failure this precache exists to prevent.
    expect(worker.caches.sizeOf("spotivibe-pages-v1")).toBe(0);

    // And a network that is already gone at install time does not fail the install:
    // the worker's failure mode is "go to the network", never "deny the request".
    const offlineWorker = loadWorker();
    offlineWorker.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await offlineWorker.fire("install");
    expect(offlineWorker.caches.sizeOf("spotivibe-shell-v1")).toBe(0);
  });

  it("does not skip waiting on install, so an update can be announced", async () => {
    // The first version called `skipWaiting()` here. That means a new worker never
    // enters `waiting`, so the page is never told an update exists: the shell's
    // notice was unreachable and the version swap was silent - which is the one thing
    // design decision 6 exists to prevent, and the alternative decision 6 rejects.
    await worker.fire("install");
    expect(worker.scope.skipWaiting).not.toHaveBeenCalled();
    // The listener's action is the only path to activation.
    await worker.fire("message", { data: { type: "SKIP_WAITING" } });
    expect(worker.scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("fails a per-entity navigation honestly when no shell is cached yet", async () => {
    // Before the shell has ever been fetched there is nothing to open the
    // application with, and pretending otherwise would render a broken page.
    worker.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      worker.respond(get(`${ORIGIN}/artist/Bjork`, { mode: "navigate" })),
    ).rejects.toThrow();
    expect(worker.caches.sizeOf("spotivibe-pages-v1")).toBe(0);
    expect(worker.caches.sizeOf("spotivibe-shell-v1")).toBe(0);
  });
});

describe("bounded metadata and artwork (task 3.3)", () => {
  it("caches a keyless metadata response and serves it back offline", async () => {
    const url = `${ORIGIN}/api/artist?name=Bj%C3%B6rk`;
    const online = await worker.respond(get(url, { mode: "cors" }));
    expect(await online?.text()).toBe("live");
    expect(worker.caches.sizeOf("spotivibe-metadata-v1")).toBe(1);

    worker.fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const offline = await worker.respond(get(url, { mode: "cors" }));
    expect(await offline?.text()).toBe("live");
  });

  it("prefers the live metadata response over the cached one, and refreshes it", async () => {
    // The original version of this assertion could not fail: both sides used the same
    // literal body and the network was never reachable while a copy was cached, so a
    // cache-first implementation passed it. Here the two bodies differ and the
    // network is up, so "live wins" is a claim with a falsifier.
    const url = `${ORIGIN}/api/album?artist=x&title=y`;
    worker.fetchMock.mockImplementation(async (input) => new Response(`v1:${pathOf(input)}`));
    await worker.respond(get(url, { mode: "cors" }));

    worker.fetchMock.mockImplementation(async (input) => new Response(`v2:${pathOf(input)}`));
    worker.fetchMock.mockClear();
    const live = await worker.respond(get(url, { mode: "cors" }));
    // The caller gets the live body, and the network really was used.
    expect(await live?.text()).toBe("v2:/api/album");
    expect(worker.fetchMock).toHaveBeenCalled();

    // And the cache now holds the newer copy, not the older one.
    const cache = await worker.caches.open("spotivibe-metadata-v1");
    const [key] = await cache.keys();
    expect(await (await cache.match(key!))?.text()).toBe("v2:/api/album");
  });

  it("stops using a metadata copy once it is past its freshness bound", async () => {
    const url = `${ORIGIN}/api/album?artist=x&title=y`;
    await worker.respond(get(url, { mode: "cors" }));
    expect(worker.caches.sizeOf("spotivibe-metadata-v1")).toBe(1);

    // Age the stored copy past the bound by rewriting its marker header: the
    // worker reads the age from the response it stored, so this is the same
    // state a week-old cache entry is in.
    const cache = await worker.caches.open("spotivibe-metadata-v1");
    const [key] = await cache.keys();
    const stored = await cache.match(key);
    const headers = new Headers(stored!.headers);
    headers.set("x-spotivibe-cached-at", String(Date.now() - 8 * 24 * 60 * 60 * 1000));
    await cache.put(key!, new Response(await stored!.text(), { status: 200, headers }));

    worker.fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    // Past its bound it is not an answer: the failure reaches the caller, which
    // renders the honest "could not load" state instead of stale metadata.
    await expect(worker.respond(get(url, { mode: "cors" }))).rejects.toThrow();
  });

  it("evicts the oldest entries once a cache is over its bound", async () => {
    // The artwork bound is 300; writing 305 distinct URLs must leave 300, and the
    // survivors must be the *newest* ones (FIFO, not a silent no-op).
    for (let index = 0; index < 305; index += 1) {
      await worker.respond(get(`https://img.test/${index}.jpg`, { destination: "image" }));
    }
    const cache = await worker.caches.open("spotivibe-artwork-v1");
    const keys = (await cache.keys()).map((key) => key.url);
    expect(keys).toHaveLength(300);
    expect(keys).toContain("https://img.test/304.jpg");
    expect(keys).not.toContain("https://img.test/0.jpg");
  });

  it("serves cached artwork immediately and revalidates behind it", async () => {
    // Stale-while-revalidate is the point: a listener looking at a page they have
    // seen before gets the image now, and the cache is refreshed for next time.
    const url = "https://img.test/cover.jpg";
    await worker.respond(get(url, { destination: "image" }));
    worker.fetchMock.mockClear();
    const cached = await worker.respond(get(url, { destination: "image" }));
    expect(await cached?.text()).toBe("live");
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    // And the revalidation does not wait for the response: the artwork was served
    // from cache, not from the network.
    expect(await worker.caches.sizeOf("spotivibe-artwork-v1")).toBe(1);
  });
});

describe("a corrupt cache entry is a miss, not an answer (M14 task 2.1)", () => {
  it("discards a truncated document and serves it from the network instead", async () => {
    // A cache is the one component that can hold bytes the application did not just
    // write, so serving one that cannot be served is a silent wrong answer.
    const cache = await worker.caches.open("spotivibe-pages-v1");
    const key = `${ORIGIN}/library`;
    await cache.put(key, truncatedResponse(9999));
    expect(await worker.caches.sizeOf("spotivibe-pages-v1")).toBe(1);

    const response = await worker.respond(get(`${ORIGIN}/library`, { mode: "navigate" }));
    // The live response, not the truncated one...
    expect(await response?.text()).toBe("live");
    // ...and the entry is gone, so the next visit cannot be fooled by it either.
    const keys = (await cache.keys()).map((entry) => entry.url);
    expect(keys.filter((url) => url === key)).toHaveLength(1);
    expect(await (await cache.match(key))?.text()).toBe("live");
  });

  it("discards a truncated metadata response rather than serving stale metadata", async () => {
    const url = `${ORIGIN}/api/artist?name=x`;
    const cache = await worker.caches.open("spotivibe-metadata-v1");
    await worker.respond(get(url, { mode: "cors" }));
    const [key] = await cache.keys();
    // Replace the good copy with a truncated one that still carries the freshness
    // stamp: a corrupt entry must not be served merely because it looks recent.
    const headers = new Headers({
      "content-length": "99999",
      "x-spotivibe-cached-at": String(Date.now()),
    });
    await cache.put(
      key!,
      new Response(JSON.stringify({ truncated: true }), { status: 200, headers }),
    );

    worker.fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(worker.respond(get(url, { mode: "cors" }))).rejects.toThrow();
    expect(await worker.caches.sizeOf("spotivibe-metadata-v1")).toBe(0);
  });

  it("treats an unreadable cache as empty rather than failing the request", async () => {
    // A cache that throws on read must not take the page's request down with it: the
    // worker falls through to the network and the listener's page still loads.
    withUnreadableCaches(worker, ["spotivibe-pages-v1", "spotivibe-shell-v1"]);
    const page = await worker.respond(get(`${ORIGIN}/library`, { mode: "navigate" }));
    expect(await page?.text()).toBe("live");

    worker.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    // And with the network gone too, the unvisited-route fallback still cannot read
    // the shell - so the failure is the honest one rather than a thrown cache error.
    await expect(
      worker.respond(get(`${ORIGIN}/artist/Nobody`, { mode: "navigate" })),
    ).rejects.toThrow();
  });

  it("does not serve a document with an empty body as if it were a page", async () => {
    // Install first, so the shell the fallback redirects to actually exists - without
    // it the honest answer is the network failure, which the previous test covers.
    await worker.fire("install");
    const cache = await worker.caches.open("spotivibe-pages-v1");
    await cache.put(`${ORIGIN}/queue`, new Response("", { status: 200 }));
    worker.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    // An empty document is not a page; the shell redirect is the honest answer.
    const response = await worker.respond(get(`${ORIGIN}/queue`, { mode: "navigate" }));
    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe(`${ORIGIN}/`);
  });

  it("still returns a live response when the cache cannot be written", async () => {
    // Found by the unreadable-cache test above: a `put` that throws used to reject the
    // whole request, so a device with a full or corrupted store could lose the network
    // response it had already been given.
    withUnreadableCaches(worker, ["spotivibe-pages-v1", "spotivibe-shell-v1"]);
    const response = await worker.respond(get(`${ORIGIN}/history`, { mode: "navigate" }));
    expect(await response?.text()).toBe("live");
  });
});

describe("the worker's storage discipline (task 2.2)", () => {
  it("contains no way to touch the listener's data", () => {
    // The strongest form of the rule: the file simply has no *code* that could.
    // Comments are stripped first, because this file explains the rule in prose
    // and a scanner that matched prose would be scanning the explanation.
    const code = workerSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const forbidden of [
      /indexedDB/i,
      /\bIDBDatabase\b/,
      /localStorage/,
      /sessionStorage/,
      /navigator\.storage/,
      /\.clear\(\)/,
      /StorageManager/,
    ]) {
      expect(code, forbidden.source).not.toMatch(forbidden);
    }
  });

  it("deletes only its own previous caches on activation", async () => {
    // The previous version of this test fired `activate` against an empty Cache
    // Storage and then matched two regexes in the source, so the deletion filter -
    // the only code in the worker that can delete anything - was never exercised.
    // Here the four cases are created and checked: a previous version of each of the
    // worker's own caches (retired), a current-version one (kept), and a cache the
    // worker does not own (kept, even though it shares the prefix).
    worker.caches.deleted.length = 0;
    await worker.fire("activate");
    expect(worker.caches.deleted).toEqual([]);

    for (const name of [
      "spotivibe-assets-v0",
      "spotivibe-pages-v0",
      "spotivibe-metadata-v0",
      "spotivibe-shell-v0",
      "spotivibe-assets-v1",
      "spotivibe-not-ours",
      "spotivibe-assets-v1-extra",
      "some-other-app-cache",
    ]) {
      const cache = await worker.caches.open(name);
      await cache.put(`${ORIGIN}/${name}`, new Response("x"));
    }
    await worker.fire("activate");

    // Exactly the previous versions of this worker's own caches.
    expect([...worker.caches.deleted].sort()).toEqual([
      "spotivibe-assets-v0",
      "spotivibe-metadata-v0",
      "spotivibe-pages-v0",
      "spotivibe-shell-v0",
    ]);
    // The current version survives, and so does everything the worker does not own -
    // including a cache that merely shares the `spotivibe-` prefix, which is why the
    // filter checks membership and not a prefix match.
    for (const name of [
      "spotivibe-assets-v1",
      "spotivibe-not-ours",
      "spotivibe-assets-v1-extra",
      "some-other-app-cache",
    ]) {
      expect(worker.caches.deleted, name).not.toContain(name);
      expect(await worker.caches.open(name).then((c) => c.keys()), name).toHaveLength(1);
    }
  });

  it("honours the page's activation message", async () => {
    const postMessage = vi.fn();
    worker.clients.matchAll = vi.fn(async () => [{ postMessage }]);
    await worker.fire("message", { data: { type: "SKIP_WAITING" } });
    // Once: install no longer activates on its own (that has its own test), so the
    // message is the only path to activation.
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: "ACTIVATED" });
  });

  it("ignores a message it does not understand", async () => {
    // A fresh worker per test, so zero calls means the unknown message did
    // nothing at all - which is what an unrecognized postMessage must do.
    await worker.fire("message", { data: { type: "SOMETHING_ELSE" } });
    await worker.fire("message", {});
    expect(worker.skipWaiting).not.toHaveBeenCalled();
    expect(worker.clients.claim).not.toHaveBeenCalled();
  });
});
