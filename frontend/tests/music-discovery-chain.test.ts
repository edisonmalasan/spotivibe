import { afterEach, describe, expect, it, vi } from "vitest";
import { createInflightDedup, createTtlCache } from "@/server/music/cache";
import { REQUEST_BUDGET_MS, type ChainOptions } from "@/server/music/chain";
import {
  DISCOVERY_CACHE_MAX_ENTRIES,
  DISCOVERY_CACHE_TTL_MS,
  DISCOVERY_FEED_BUDGET_MS,
  DISCOVERY_SEED_CAP,
  DISCOVERY_SEED_CONCURRENCY,
  DISCOVERY_SEED_TIMEOUT_MS,
  discoveryCacheKey,
  resolveDiscovery,
  runDiscovery,
  type DiscoveryDeps,
  type DiscoveryRequest,
  type DiscoverySuccess,
} from "@/server/music/discovery";
import { trendingSeedsFor } from "@/server/music/discoverySeeds";
import { ProviderError } from "@/server/music/errors";
import { outboundLimiter } from "@/server/music/limiter";
import type { MusicProvider, ProviderCandidate, TierId } from "@/server/music/types";
import { makeCandidate } from "./helpers/music-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fake tier that records every query it was asked to run. */
function fakeProvider(
  id: TierId,
  impl: (request: { query: string; signal?: AbortSignal }) => Promise<ProviderCandidate[]>,
): MusicProvider & { calls: number; queries: string[] } {
  const provider = {
    id,
    calls: 0,
    queries: [] as string[],
    async search(request: { query: string; signal?: AbortSignal }) {
      provider.calls += 1;
      provider.queries.push(request.query);
      return impl(request);
    },
  };
  return provider;
}

/** A tier that always fails with a structured provider failure. */
function failingProvider(id: TierId, kind: ProviderError["kind"] = "network") {
  return fakeProvider(id, () => Promise.reject(new ProviderError(id, kind, `${id} ${kind}`)));
}

/**
 * A tier whose answer is derived from its query text, so different seeds yield
 * disjoint, attributable results.
 */
function echoingProvider(id: TierId, prefix: string) {
  return fakeProvider(id, async (request) => [
    makeCandidate({
      videoId: `${prefix}${request.query.replace(/\W+/g, "")}`,
      title: `Track for ${request.query}`,
      artistText: "Seed Artist",
    }),
  ]);
}

function baseRequest(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return { kind: "trending", languages: ["en"], limit: 20, ...overrides };
}

/** Fresh service state per test (the module keeps one process-wide copy). */
function freshDeps(
  chainOptions?: ChainOptions,
  cacheOptions: { ttlMs?: number; now?: () => number } = {},
): DiscoveryDeps {
  return {
    cache: createTtlCache<DiscoverySuccess>({
      ttlMs: cacheOptions.ttlMs ?? DISCOVERY_CACHE_TTL_MS,
      maxEntries: DISCOVERY_CACHE_MAX_ENTRIES,
      ...(cacheOptions.now ? { now: cacheOptions.now } : {}),
    }),
    inflight: createInflightDedup(),
    ...(chainOptions ? { chainOptions } : {}),
  };
}

/**
 * Let every already-queued microtask and macrotask run. Used to prove that
 * *nothing else started* while a deferred provider call is still open — the
 * evidence is the unreleased gate, and this only gives the runtime a chance to
 * prove it wrong.
 */
function flushPendingWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("resolveDiscovery — seed composition and language attribution", () => {
  it("runs one curated seed per language, then a second round, and stamps each track with its seed's language", async () => {
    const primary = echoingProvider("ytmusic", "vid-");
    const result = await resolveDiscovery(baseRequest({ languages: ["en", "es", "de"] }), {
      providers: [primary],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Language-fair planning: every language's first seed, then every
    // language's second (design decision 3 attribution).
    expect(primary.queries).toEqual([
      trendingSeedsFor("en")[0],
      trendingSeedsFor("es")[0],
      trendingSeedsFor("de")[0],
      trendingSeedsFor("en")[1],
      trendingSeedsFor("es")[1],
      trendingSeedsFor("de")[1],
    ]);
    expect(primary.calls).toBe(6);
    // Language attribution comes from the seed, not from the track text.
    expect(result.tracks.map((track) => track.language)).toEqual([
      "en",
      "es",
      "de",
      "en",
      "es",
      "de",
    ]);
    expect(result.diagnostics.languages).toEqual(["en", "es", "de"]);
    expect(result.diagnostics.seedsTried).toBe(6);
    expect(result.diagnostics.seedsFailed).toEqual([]);
  });

  it("composes caller terms per language for caller-seeded kinds", async () => {
    const primary = echoingProvider("ytmusic", "vid-");
    const result = await resolveDiscovery(
      baseRequest({ kind: "genre", languages: ["en", "fr"], seeds: ["jazz"] }),
      { providers: [primary] },
    );

    expect(result.ok).toBe(true);
    expect(primary.queries).toEqual(["jazz songs", "jazz chansons"]);
    if (result.ok) {
      expect(result.tracks.map((track) => track.language)).toEqual(["en", "fr"]);
    }
  });

  it("ignores caller terms for catalog kinds", async () => {
    const primary = echoingProvider("ytmusic", "vid-");
    const withSeeds = await resolveDiscovery(
      baseRequest({ languages: ["en"], seeds: ["injected"] }),
      { providers: [primary] },
    );
    expect(primary.queries).toEqual([trendingSeedsFor("en")[0], trendingSeedsFor("en")[1]]);
    expect(withSeeds.ok).toBe(true);
  });

  it("returns canonical tracks with a quality score and no provider shapes", async () => {
    const primary = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "vidA", title: "Get Lucky", durationSeconds: 249 }),
    ]);

    const result = await resolveDiscovery(
      baseRequest({ kind: "for-you", seeds: ["Daft Punk"], limit: 5 }),
      { providers: [primary] },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracks).toHaveLength(1);
    const track = result.tracks[0];
    expect(track?.id).toBe("youtube:vidA");
    expect(track?.source).toBe("youtube");
    expect(track?.providerId).toBe("vidA");
    expect(track?.language).toBe("en");
    expect(track?.qualityScore).toBeTypeOf("number");
    expect(track?.capabilities).toEqual({ stream: true, offlineDownload: false });
    expect(JSON.stringify(result)).not.toContain("flexColumns");
  });
});

describe("resolveDiscovery — per-seed failure tolerance", () => {
  it("keeps the feed successful when one seed fails and names the failed seed", async () => {
    const failingQuery = trendingSeedsFor("en")[0];
    const flaky = fakeProvider("ytmusic", async (request) => {
      if (request.query === failingQuery) {
        throw new ProviderError("ytmusic", "network", "flaky seed");
      }
      return [
        makeCandidate({
          videoId: `vid-${request.query.replace(/\W+/g, "")}`,
          title: `Track for ${request.query}`,
        }),
      ];
    });

    const result = await resolveDiscovery(baseRequest({ languages: ["en", "es"] }), {
      providers: [flaky],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Four planned seeds, one exhausted, three still produce the feed.
    expect(result.diagnostics.seedsTried).toBe(4);
    expect(result.diagnostics.seedsFailed).toEqual([failingQuery]);
    expect(result.tracks).toHaveLength(3);
    expect(result.diagnostics.resultCount).toBe(3);
    // The surviving seeds keep their own attribution (es, en, es).
    expect(result.tracks.map((track) => track.language)).toEqual(["es", "en", "es"]);
  });

  it("reports a failed seed even when a fallback tier rescued the same seed", async () => {
    const failing = failingProvider("ytmusic", "timeout");
    const rescue = echoingProvider("ytweb", "vid-");

    const result = await resolveDiscovery(baseRequest({ languages: ["en"], limit: 5 }), {
      providers: [failing, rescue],
    });

    // A tier-level failure inside the chain is not a failed seed: the chain
    // fell through and produced tracks.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.diagnostics.seedsFailed).toEqual([]);
  });

  it("returns a structured failure when every seed fails (spec scenario)", async () => {
    const failing = failingProvider("ytmusic", "network");
    const alsoFailing = failingProvider("ytweb", "http");

    const result = await resolveDiscovery(baseRequest({ languages: ["en", "es"] }), {
      providers: [failing, alsoFailing],
    });

    // Four planned seeds (two per language), all exhausted across both tiers.
    expect(result).toMatchObject({
      ok: false,
      reason: "upstream",
      diagnostics: {
        kind: "trending",
        seedsTried: 4,
        resultCount: 0,
        cached: false,
      },
    });
    if (result.ok) return;
    expect(result.diagnostics.seedsFailed).toHaveLength(4);
    // Tier outcomes survive the failure path — they are what a 503 is debugged with.
    expect(result.diagnostics.tiersTried).toHaveLength(8);
    expect(new Set(result.diagnostics.tiersTried.map((entry) => entry.tier))).toEqual(
      new Set(["ytmusic", "ytweb"]),
    );
    for (const entry of result.diagnostics.tiersTried) {
      expect(["network", "http"]).toContain(entry.outcome);
    }
  });

  it("treats a junk-only answer as a failed seed rather than an empty feed", async () => {
    const junk = fakeProvider("ytmusic", async () => [makeCandidate({ title: "DJ Vlog" })]);

    const result = await resolveDiscovery(baseRequest({ languages: ["en"] }), {
      providers: [junk],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.seedsFailed.length).toBeGreaterThan(0);
  });

  it("propagates caller cancellation instead of swallowing it as a failed seed", async () => {
    const controller = new AbortController();
    const hanging = fakeProvider("ytmusic", (request) => {
      void request;
      return new Promise<ProviderCandidate[]>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const pending = resolveDiscovery(
      baseRequest({ languages: ["en"], signal: controller.signal }),
      { providers: [hanging], budgetMs: 5000 },
    );
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name === "AbortError",
    );
  });
});

describe("resolveDiscovery — bounded seed concurrency and feed budget", () => {
  it("keeps at most DISCOVERY_SEED_CONCURRENCY chain calls in flight, so no seed spends its budget queued on the limiter", async () => {
    // Deferred answers: a seed stays "running" until this test releases it, so
    // the observation is a real gate, not a timing guess.
    const releases: Array<() => void> = [];
    let inFlight = 0;
    let peakInFlight = 0;
    const primary = fakeProvider("ytmusic", (request) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return new Promise<ProviderCandidate[]>((resolve) => {
        const index = releases.length;
        releases.push(() => {
          inFlight -= 1;
          resolve([makeCandidate({ videoId: `vid${index}`, title: `Track for ${request.query}` })]);
        });
      });
    });

    const pending = resolveDiscovery(baseRequest({ languages: ["en", "es"] }), {
      providers: [primary],
    });

    // Four planned seeds. The first starts and stays open.
    await vi.waitFor(() => expect(primary.calls).toBe(1));
    await flushPendingWork();
    // The other three wait their turn: with an unbounded fan-out they would all
    // be inside the chain right now, each burning its budget on the limiter.
    expect(primary.calls).toBe(1);
    expect(primary.queries).toEqual([trendingSeedsFor("en")[0]]);
    expect(peakInFlight).toBe(DISCOVERY_SEED_CONCURRENCY);

    for (let started = 2; started <= 4; started += 1) {
      releases[started - 2]?.();
      await vi.waitFor(() => expect(primary.calls).toBe(started));
      // Still exactly one at a time: the previous seed settled, this one began.
      expect(peakInFlight).toBe(DISCOVERY_SEED_CONCURRENCY);
    }
    releases[3]?.();

    const result = await pending;
    expect(result.ok).toBe(true);
    // Every planned seed still contributed: bounding the fan-out must not
    // shrink the feed.
    if (result.ok) {
      expect(result.tracks).toHaveLength(4);
      expect(result.diagnostics.seedsTried).toBe(4);
    }
    expect(result.diagnostics.seedsSkipped).toEqual([]);
    // Language-fair planning, still walked one seed at a time.
    expect(primary.queries).toEqual([
      trendingSeedsFor("en")[0],
      trendingSeedsFor("es")[0],
      trendingSeedsFor("en")[1],
      trendingSeedsFor("es")[1],
    ]);
  });

  it("gives every seed the discovery seed budget, never the chain's own 8s default", async () => {
    // The chain builds its budget with `AbortSignal.timeout`, so the value each
    // seed runs on is directly observable here.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    try {
      const primary = echoingProvider("ytmusic", "vid-");
      const result = await resolveDiscovery(baseRequest({ languages: ["en", "es"] }), {
        providers: [primary],
      });

      expect(result.ok).toBe(true);
      const budgets = timeoutSpy.mock.calls.map(([ms]) => ms);
      // One feed deadline, then one chain deadline per planned seed.
      expect(budgets[0]).toBe(DISCOVERY_FEED_BUDGET_MS);
      expect(budgets.slice(1)).toEqual(Array.from({ length: 4 }, () => DISCOVERY_SEED_TIMEOUT_MS));
      // The regression this pins: a seed on the chain's default budget can
      // exhaust it waiting for a limiter slot and be reported as `timeout`
      // without a provider ever being asked.
      expect(budgets).not.toContain(REQUEST_BUDGET_MS);
      expect(DISCOVERY_SEED_TIMEOUT_MS).toBeGreaterThan(REQUEST_BUDGET_MS);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("lets an explicit chain budget win, so a caller's own options still apply", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    try {
      const primary = echoingProvider("ytmusic", "vid-");
      await resolveDiscovery(baseRequest({ languages: ["en"] }), {
        providers: [primary],
        budgetMs: 1234,
      });

      const budgets = timeoutSpy.mock.calls.map(([ms]) => ms);
      expect(budgets[0]).toBe(DISCOVERY_FEED_BUDGET_MS);
      expect(budgets.slice(1)).toEqual([1234, 1234]);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("returns the seeds it got and names the rest as budget-skipped, not failed", async () => {
    const planned = [
      trendingSeedsFor("en")[0],
      trendingSeedsFor("es")[0],
      trendingSeedsFor("en")[1],
      trendingSeedsFor("es")[1],
    ];
    // The first seed outlasts the whole feed budget (4x the margin), so the
    // remaining three are never attempted. Its answer is still honoured — a
    // late result beats none.
    const slowFirst = fakeProvider("ytmusic", async (request) => {
      if (request.query === planned[0]) {
        await new Promise((resolve) => {
          setTimeout(resolve, 120);
        });
      }
      return [
        makeCandidate({
          videoId: `vid-${request.query.replace(/\W+/g, "")}`,
          title: `Track for ${request.query}`,
        }),
      ];
    });

    const result = await resolveDiscovery(baseRequest({ languages: ["en", "es"] }), {
      providers: [slowFirst],
      feedBudgetMs: 30,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0]?.language).toBe("en");
    // The budget outcome is reported as its own thing: a skipped seed is not a
    // provider failure, and must never be counted as one.
    expect(result.diagnostics.seedsTried).toBe(1);
    expect(result.diagnostics.seedsFailed).toEqual([]);
    expect(result.diagnostics.seedsSkipped).toEqual(planned.slice(1));
  });

  it("returns the structured upstream failure when the budget stopped every seed", async () => {
    // A tier that honours its signal, so the feed deadline ends the one seed
    // that started and the rest are never attempted at all.
    const hanging = fakeProvider(
      "ytmusic",
      ({ signal }) =>
        new Promise<ProviderCandidate[]>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const result = await resolveDiscovery(baseRequest({ languages: ["en", "es"] }), {
      providers: [hanging],
      feedBudgetMs: 30,
    });

    // A feed that produced nothing is a failure either way, and it is still the
    // structured upstream failure the route turns into a 503.
    expect(result).toMatchObject({ ok: false, reason: "upstream" });
    if (result.ok) return;
    expect(result.diagnostics.seedsTried).toBe(0);
    expect(result.diagnostics.seedsFailed).toEqual([]);
    expect(result.diagnostics.seedsSkipped).toHaveLength(4);
    expect(result.diagnostics.resultCount).toBe(0);
  });
});

describe("resolveDiscovery — merge, dedupe, and bounding", () => {
  it("collapses the same track returned by two seeds and keeps one attribution", async () => {
    const primary = fakeProvider("ytmusic", async () => [makeCandidate({ videoId: "vidSame" })]);

    const result = await resolveDiscovery(baseRequest({ languages: ["en", "es"] }), {
      providers: [primary],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tracks).toHaveLength(1);
      expect(result.tracks[0]?.providerId).toBe("vidSame");
      expect(result.diagnostics.resultCount).toBe(1);
    }
  });

  it("caps the merged feed at the requested limit", async () => {
    const primary = fakeProvider("ytmusic", async (request) =>
      Array.from({ length: 12 }, (_value, index) =>
        makeCandidate({
          videoId: `${request.query.slice(0, 4)}-${index}`,
          title: `Track ${index} for ${request.query}`,
        }),
      ),
    );

    const result = await resolveDiscovery(baseRequest({ languages: ["en", "es"], limit: 5 }), {
      providers: [primary],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tracks).toHaveLength(5);
      expect(result.diagnostics.resultCount).toBe(5);
    }
  });

  it("orders the merged feed by the shared quality score, best first", async () => {
    const primary = fakeProvider("ytmusic", async (request) => [
      makeCandidate({
        videoId: `${request.query}-a`,
        title: "No Duration At All",
        durationSeconds: undefined,
      }),
      makeCandidate({ videoId: `${request.query}-b`, title: "Get Lucky", durationSeconds: 249 }),
    ]);

    const result = await resolveDiscovery(
      baseRequest({ kind: "for-you", seeds: ["get lucky"], languages: ["en"] }),
      { providers: [primary] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const scores = result.tracks.map((track) => track.qualityScore ?? 0);
      expect(result.tracks[0]?.providerId.endsWith("-b")).toBe(true);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    }
  });

  it("applies the shared junk filter to every seed's results", async () => {
    const primary = fakeProvider("ytmusic", async (request) => [
      makeCandidate({ videoId: `${request.query}-junk`, title: "Artist Interview Special" }),
      makeCandidate({ videoId: `${request.query}-keep`, title: `Real Song ${request.query}` }),
    ]);

    const result = await resolveDiscovery(baseRequest({ languages: ["en", "es"] }), {
      providers: [primary],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Junk dropped per seed, one survivor per planned seed, none collapsed.
      expect(result.tracks).toHaveLength(4);
      expect(result.tracks.map((track) => track.language)).toEqual(["en", "es", "en", "es"]);
      expect(result.tracks.some((track) => track.title.includes("Interview"))).toBe(false);
    }
  });

  it("passes the caller's abort signal into every seed's chain", async () => {
    const controller = new AbortController();
    const primary = echoingProvider("ytmusic", "vid-");
    const acquireSpy = vi.spyOn(outboundLimiter, "acquire");
    try {
      const result = await resolveDiscovery(
        baseRequest({ languages: ["en", "es", "de"], signal: controller.signal }),
        { providers: [primary] },
      );
      expect(result.ok).toBe(true);
      expect(acquireSpy).toHaveBeenCalled();
    } finally {
      acquireSpy.mockRestore();
    }
  });

  it("defaults to the fixed four-tier order through the shared chain", async () => {
    const primary = failingProvider("ytmusic", "network");
    const second = failingProvider("ytweb", "timeout");
    const third = failingProvider("invidious", "parse");
    const fourth = failingProvider("piped", "http");

    const result = await resolveDiscovery(baseRequest({ languages: ["en"] }), {
      providers: [primary, second, third, fourth],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Two planned seeds, each walking all four tiers in order.
    expect(result.diagnostics.tiersTried.map((entry) => entry.tier)).toEqual([
      "ytmusic",
      "ytweb",
      "invidious",
      "piped",
      "ytmusic",
      "ytweb",
      "invidious",
      "piped",
    ]);
  });
});

describe("runDiscovery — cache and dedup", () => {
  it("builds a stable key from kind, sorted languages, sorted seeds, and limit", () => {
    const a = discoveryCacheKey({
      kind: "trending",
      languages: ["es", "en"],
      seeds: ["b", "a"],
      limit: 20,
    });
    const b = discoveryCacheKey({
      kind: "trending",
      languages: ["en", "es"],
      seeds: ["a", "b"],
      limit: 20,
    });
    expect(a).toBe(b);
    expect(a).toBe("discover:trending|en,es|a,b|20");
    expect(discoveryCacheKey({ kind: "mix", languages: ["en"], limit: 20 })).not.toBe(a);
    expect(discoveryCacheKey({ kind: "trending", languages: ["en"], limit: 10 })).not.toBe(a);
  });

  it("serves a repeat feed from the TTL cache without a second provider call", async () => {
    const primary = echoingProvider("ytmusic", "vid-");
    const deps = freshDeps({ providers: [primary] });

    const first = await runDiscovery(baseRequest({ languages: ["en"] }), deps);
    const second = await runDiscovery(baseRequest({ languages: ["en"] }), deps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok) expect(first.diagnostics.cached).toBe(false);
    if (second.ok) expect(second.diagnostics.cached).toBe(true);
    expect(primary.calls).toBe(2); // the two trending seeds, once
    expect(second.ok && second.tracks).toEqual(first.ok ? first.tracks : []);
  });

  it("re-queries the provider once the TTL has expired", async () => {
    let now = 1_000;
    const primary = echoingProvider("ytmusic", "vid-");
    const deps = freshDeps({ providers: [primary] }, { ttlMs: 500, now: () => now });

    const first = await runDiscovery(baseRequest({ languages: ["en"] }), deps);
    now += 499;
    const fresh = await runDiscovery(baseRequest({ languages: ["en"] }), deps);
    now += 2;
    const expired = await runDiscovery(baseRequest({ languages: ["en"] }), deps);

    expect(first.ok && first.diagnostics.cached).toBe(false);
    expect(fresh.ok && fresh.diagnostics.cached).toBe(true);
    expect(expired.ok && expired.diagnostics.cached).toBe(false);
    expect(primary.calls).toBe(4);
  });

  it("never caches a failure — the next request retries upstream", async () => {
    const failing = failingProvider("ytmusic");
    const deps = freshDeps({ providers: [failing] });

    const first = await runDiscovery(baseRequest({ languages: ["en"] }), deps);
    const second = await runDiscovery(baseRequest({ languages: ["en"] }), deps);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(failing.calls).toBe(4); // two seeds × two attempts
    expect(deps.cache.size).toBe(0);
  });

  it("shares one in-flight composition between identical concurrent feeds", async () => {
    const releases: Array<() => void> = [];
    const primary = fakeProvider(
      "ytmusic",
      () =>
        new Promise<ProviderCandidate[]>((resolve) => {
          releases.push(() =>
            resolve([
              makeCandidate({
                videoId: `vid${releases.length}`,
                title: `Track ${releases.length}`,
              }),
            ]),
          );
        }),
    );
    const deps = freshDeps({ providers: [primary] });

    const first = runDiscovery(baseRequest({ languages: ["en"] }), deps);
    const second = runDiscovery(baseRequest({ languages: ["en"] }), deps);
    // One composition of two planned seeds — not two compositions. The seeds
    // run one at a time, so each is released as it starts.
    await vi.waitFor(() => expect(primary.calls).toBe(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(primary.calls).toBe(2));
    for (const release of releases) release();

    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a).toBe(b);
    expect(primary.calls).toBe(2);
    expect(deps.inflight.size).toBe(0);
  });

  it("keeps different feeds independent", async () => {
    const primary = echoingProvider("ytmusic", "vid-");
    const deps = freshDeps({ providers: [primary] });

    await runDiscovery(baseRequest({ kind: "trending", languages: ["en"] }), deps);
    await runDiscovery(baseRequest({ kind: "podcast", languages: ["en"] }), deps);

    expect(primary.calls).toBe(4);
    expect(deps.cache.size).toBe(2);
  });

  it("bounds the fan-out at the documented seed cap", () => {
    expect(DISCOVERY_SEED_CAP).toBe(8);
    expect(DISCOVERY_CACHE_TTL_MS).toBe(300_000);
  });
});
