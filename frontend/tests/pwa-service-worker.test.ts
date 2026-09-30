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
          const url = typeof request === "string" ? request : request.url;
          const hit = entries.get(url);
          return hit === undefined ? undefined : hit.clone();
        },
        async put(request: Request | string, response: Response) {
          entries.set(typeof request === "string" ? request : request.url, response);
        },
        async delete(request: Request | string) {
          entries.delete(typeof request === "string" ? request : request.url);
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

  it("never answers a live question from cache", async () => {
    // Search, radio and playlist are deliberate absences from the cacheable set.
    // `undefined` here is the worker's way of saying "not mine to handle": it does
    // not call `respondWith` at all, so the browser performs the request itself.
    for (const path of ["/api/search?q=x", "/api/radio?kind=track", "/api/playlist?id=PL1"]) {
      const response = await worker.respond(get(`${ORIGIN}${path}`, { mode: "cors" }));
      expect(response, path).toBeUndefined();
      expect(worker.caches.sizeOf("spotivibe-metadata-v1"), path).toBe(0);
      expect(worker.caches.sizeOf("spotivibe-pages-v1"), path).toBe(0);
    }
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

  it("refuses to substitute another entity's cached page", async () => {
    // A cached `/artist/x` answering for `/artist/y` would be a lie, so a
    // per-entity navigation has no cached fallback at all.
    worker.fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const response = await worker.respond(get(`${ORIGIN}/artist/Bjork`, { mode: "navigate" }));
    expect(response).toBeUndefined();
    expect(worker.caches.sizeOf("spotivibe-pages-v1")).toBe(0);
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
    worker.caches.deleted.length = 0;
    await worker.fire("activate");
    // Nothing to retire on a first activation, and nothing outside the namespace.
    expect(worker.caches.deleted).toEqual([]);
    // A cache this worker does not own is left alone even when it is named
    // similarly: the filter is the versioned namespace, not a prefix match.
    expect(workerSource).toMatch(/name\.startsWith\("spotivibe-"\)/);
    expect(workerSource).toMatch(/!owned\.has\(name\)/);
  });

  it("takes over on install and honours the page's activation message", async () => {
    await worker.fire("install");
    expect(worker.skipWaiting).toHaveBeenCalled();

    const postMessage = vi.fn();
    worker.clients.matchAll = vi.fn(async () => [{ postMessage }]);
    await worker.fire("message", { data: { type: "SKIP_WAITING" } });
    expect(worker.skipWaiting).toHaveBeenCalledTimes(2);
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
