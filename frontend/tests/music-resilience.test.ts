import { describe, expect, it, vi } from "vitest";
import { createInflightDedup, createTtlCache } from "@/server/music/cache";
import { runChain } from "@/server/music/chain";
import { createSemaphore } from "@/server/music/limiter";
import { ProviderError } from "@/server/music/errors";
import {
  runSearch,
  searchCacheKey,
  SEARCH_CACHE_TTL_MS,
  type SearchDeps,
} from "@/server/music/search";
import type { MusicProvider, SearchResult, SearchSuccess, TierId } from "@/server/music/types";
import { makeCandidate } from "./helpers/music-fixtures";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cross-realm safe: abort reasons may be Node's or jsdom's DOMException. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function makeDeps(chainOptions: SearchDeps["chainOptions"]): SearchDeps {
  return {
    cache: createTtlCache<SearchSuccess>({ ttlMs: SEARCH_CACHE_TTL_MS, maxEntries: 10 }),
    inflight: createInflightDedup<SearchResult>(),
    chainOptions,
  };
}

describe("createSemaphore", () => {
  it("never exceeds the cap and grants waits in FIFO order", async () => {
    const semaphore = createSemaphore(2);
    let active = 0;
    let peak = 0;
    const grantOrder: number[] = [];

    await Promise.all(
      Array.from({ length: 6 }, (_value, index) =>
        (async () => {
          const release = await semaphore.acquire();
          active += 1;
          peak = Math.max(peak, active);
          grantOrder.push(index);
          await delay(5);
          active -= 1;
          release();
        })(),
      ),
    );

    expect(peak).toBe(2);
    expect(grantOrder).toEqual([0, 1, 2, 3, 4, 5]);
    expect(semaphore.activeCount).toBe(0);
    expect(semaphore.pendingCount).toBe(0);
  });

  it("release is idempotent and the gate stays healthy", async () => {
    const semaphore = createSemaphore(1);
    const release = await semaphore.acquire();
    release();
    release(); // second release must not free an extra slot
    expect(semaphore.activeCount).toBe(0);
    const releaseNext = await semaphore.acquire();
    releaseNext();
    expect(semaphore.activeCount).toBe(0);
  });

  it("rejects a queued waiter on abort without ever firing it", async () => {
    const semaphore = createSemaphore(1);
    const releaseFirst = await semaphore.acquire();

    const controller = new AbortController();
    const queued = semaphore.acquire(controller.signal);
    const assertion = expect(queued).rejects.toSatisfy(isAbortError);
    controller.abort();
    await assertion;

    expect(semaphore.pendingCount).toBe(0);
    expect(semaphore.activeCount).toBe(1); // only the held slot
    releaseFirst();
    const releaseNext = await semaphore.acquire();
    releaseNext();
  });

  it("rejects a pre-aborted signal immediately and validates its limit", async () => {
    const semaphore = createSemaphore(1);
    const controller = new AbortController();
    controller.abort();
    await expect(semaphore.acquire(controller.signal)).rejects.toSatisfy(isAbortError);
    expect(() => createSemaphore(0)).toThrow();
  });
});

describe("runChain with an injected limiter", () => {
  it("serializes upstream calls through the gate (cap observed)", async () => {
    const limiter = createSemaphore(1);
    let active = 0;
    let peak = 0;
    const slow = (id: TierId): MusicProvider => ({
      id,
      async search() {
        active += 1;
        peak = Math.max(peak, active);
        await delay(30);
        active -= 1;
        return [makeCandidate({ videoId: `vid-${id}` })];
      },
    });

    await Promise.all([
      runChain({ query: "a", limit: 10 }, { providers: [slow("ytmusic")], limiter }),
      runChain({ query: "b", limit: 10 }, { providers: [slow("ytweb")], limiter }),
    ]);

    expect(peak).toBe(1);
  });
});

describe("createTtlCache", () => {
  it("hits within the TTL and evicts on expiry", () => {
    let nowMs = 0;
    const cache = createTtlCache<number>({ ttlMs: 100, maxEntries: 10, now: () => nowMs });

    expect(cache.get("a")).toBeUndefined();
    cache.set("a", 1);
    nowMs = 99;
    expect(cache.get("a")).toBe(1);
    nowMs = 100;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the oldest entry beyond maxEntries (insertion order)", () => {
    let nowMs = 0;
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2, now: () => nowMs });
    cache.set("a", 1);
    nowMs = 1;
    cache.set("b", 2);
    nowMs = 2;
    cache.set("c", 3);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("re-setting a key refreshes its value and recency", () => {
    let nowMs = 0;
    const cache = createTtlCache<number>({ ttlMs: 100, maxEntries: 2, now: () => nowMs });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);
    nowMs = 50;
    cache.set("b2", 3); // exceeds maxEntries → oldest is "b"
    expect(cache.get("a")).toBe(10);
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("createInflightDedup", () => {
  it("shares one in-flight run per key", async () => {
    const dedup = createInflightDedup<string>();
    let calls = 0;
    const factory = async () => {
      calls += 1;
      await delay(10);
      return "ok";
    };

    const [first, second] = await Promise.all([dedup.run("k", factory), dedup.run("k", factory)]);

    expect(calls).toBe(1);
    expect(first).toBe("ok");
    expect(second).toBe("ok");
    expect(dedup.size).toBe(0);
  });

  it("frees the key on settle and shares rejections", async () => {
    const dedup = createInflightDedup<string>();
    let calls = 0;
    const factory = async () => {
      calls += 1;
      throw new Error("boom");
    };

    const first = dedup.run("k", factory);
    const second = dedup.run("k", factory);
    await expect(first).rejects.toThrow("boom");
    await expect(second).rejects.toThrow("boom");
    expect(calls).toBe(1);
    expect(dedup.size).toBe(0);

    // Settled keys retry fresh.
    await expect(dedup.run("k", factory)).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });
});

describe("runSearch", () => {
  it("marks cache hits and serves normalized-equal queries once upstream", async () => {
    const search = vi.fn(async () => [makeCandidate()]);
    const deps = makeDeps({ providers: [{ id: "ytmusic", search }] });

    const first = await runSearch({ query: "Daft Punk", limit: 20 }, deps);
    const second = await runSearch({ query: "  daft punk  ", limit: 20 }, deps);

    expect(search).toHaveBeenCalledTimes(1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.diagnostics.cached).toBe(false);
      expect(second.diagnostics.cached).toBe(true);
      expect(second.tracks).toEqual(first.tracks);
    }
    expect(searchCacheKey(" Daft Punk ", 20)).toBe(searchCacheKey("daft punk", 20));
    expect(searchCacheKey("daft punk", 20)).not.toBe(searchCacheKey("daft punk", 50));
  });

  it("shares one upstream call for concurrent identical queries (dedup)", async () => {
    let calls = 0;
    const search = vi.fn(async () => {
      calls += 1;
      await delay(20);
      return [makeCandidate()];
    });
    const deps = makeDeps({ providers: [{ id: "ytmusic", search }] });

    const [first, second] = await Promise.all([
      runSearch({ query: "get lucky", limit: 10 }, deps),
      runSearch({ query: "GET LUCKY", limit: 10 }, deps),
    ]);

    expect(calls).toBe(1);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.tracks).toEqual(first.tracks);
      expect(first.diagnostics.cached).toBe(false);
      expect(second.diagnostics.cached).toBe(false); // shared live call, not a cache hit
    }
  });

  it("never caches failures — the next call retries upstream", async () => {
    let calls = 0;
    const search = vi.fn(async () => {
      calls += 1;
      throw new ProviderError("ytmusic", "network", "upstream down");
    });
    const deps = makeDeps({ providers: [{ id: "ytmusic", search }] });

    const first = await runSearch({ query: "q", limit: 20 }, deps);
    const second = await runSearch({ query: "q", limit: 20 }, deps);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(calls).toBe(2);
  });

  it("falls back to a live query after TTL expiry", async () => {
    let calls = 0;
    const search = vi.fn(async () => {
      calls += 1;
      return [makeCandidate()];
    });
    const deps: SearchDeps = {
      cache: createTtlCache<SearchSuccess>({ ttlMs: 15, maxEntries: 10 }),
      inflight: createInflightDedup<SearchResult>(),
      chainOptions: { providers: [{ id: "ytmusic", search }] },
    };

    await runSearch({ query: "q", limit: 20 }, deps);
    await runSearch({ query: "q", limit: 20 }, deps);
    expect(calls).toBe(1);

    await delay(25);
    const afterExpiry = await runSearch({ query: "q", limit: 20 }, deps);
    expect(calls).toBe(2);
    expect(afterExpiry.ok && afterExpiry.diagnostics.cached).toBe(false);
  });
});
