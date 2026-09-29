import { afterEach, describe, expect, it, vi } from "vitest";
import { createInflightDedup, createTtlCache } from "@/server/music/cache";
import { REQUEST_BUDGET_MS } from "@/server/music/chain";
import {
  RADIO_CACHE_MAX_ENTRIES,
  RADIO_CACHE_TTL_MS,
  RADIO_KINDS,
  RADIO_MAX_EXCLUDE,
  RADIO_MAX_LIMIT,
  RADIO_MAX_VARIANT,
  RADIO_PHRASE_CYCLES,
  RADIO_REQUEST_BUDGET_MS,
  RADIO_SEED_CAP,
  RADIO_SEED_CONCURRENCY,
  RADIO_SEED_TIMEOUT_MS,
  RADIO_TRACK_LIMIT,
  applyExclusions,
  defaultRadioDeps,
  planRadioSeeds,
  radioCacheKey,
  resolveRadio,
  type RadioDeps,
  type RadioOptions,
  type RadioResolution,
  type RadioSuccess,
  type RadioTrack,
} from "@/server/music/radio";
import { ProviderError } from "@/server/music/errors";
import type { MusicProvider, ProviderCandidate, TierId } from "@/server/music/types";
import { makeCandidate, makeTrack } from "./helpers/music-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

/** A tier that answers with an empty (but successful) result every time. */
function emptyProvider(id: TierId) {
  return fakeProvider(id, async () => []);
}

/** A tier whose answer is derived from its query text. */
function echoingProvider(id: TierId, prefix = "vid-") {
  return fakeProvider(id, async (request) => [
    makeCandidate({
      videoId: `${prefix}${request.query.replace(/\W+/g, "")}`,
      title: `Track for ${request.query}`,
      artistText: "Daft Punk",
    }),
  ]);
}

/** Fresh service state per test (the module keeps one process-wide copy). */
function freshDeps(chainOptions?: RadioOptions): RadioDeps {
  const options = {
    ttlMs: RADIO_CACHE_TTL_MS,
    maxEntries: RADIO_CACHE_MAX_ENTRIES,
  };
  return {
    cache: createTtlCache<RadioSuccess>(options),
    inflight: createInflightDedup<RadioResolution>(),
    ...(chainOptions !== undefined ? { chainOptions } : {}),
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

/** A resolved success, narrowed for assertions. */
function asSuccess(result: RadioResolution): RadioSuccess {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected a success");
  return result;
}

describe("planRadioSeeds — at most two seeds, rotated by the caller's variant", () => {
  it("plans the artist name framed by the variant's first phrase pair", () => {
    expect(planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant: 0 })).toEqual([
      { query: "Daft Punk songs", label: "radio" },
      { query: "Daft Punk radio", label: "radio" },
    ]);
    expect(planRadioSeeds({ kind: "artist", artist: "  Daft Punk  ", variant: 0 })[0]?.query).toBe(
      "Daft Punk songs",
    );
  });

  it("plans a track radio around the track's own public identity", () => {
    expect(
      planRadioSeeds({ kind: "track", title: "Get Lucky", artist: "Daft Punk", variant: 0 }),
    ).toEqual([
      { query: "Daft Punk Get Lucky", label: "radio" },
      { query: "Get Lucky Daft Punk similar", label: "radio" },
    ]);
    // A track identity is still a track identity without an artist.
    expect(planRadioSeeds({ kind: "track", title: "Get Lucky", variant: 0 })[0]?.query).toBe(
      "Get Lucky",
    );
  });

  it("never plans more than the documented cap, and dedupes identical queries", () => {
    for (let variant = 0; variant < RADIO_PHRASE_CYCLES * 3; variant += 1) {
      for (const plan of [
        { kind: "artist" as const, artist: "Daft Punk", variant },
        { kind: "track" as const, title: "Get Lucky", artist: "Daft Punk", variant },
      ]) {
        const seeds = planRadioSeeds(plan);
        expect(seeds.length, JSON.stringify(plan)).toBeLessThanOrEqual(RADIO_SEED_CAP);
        expect(seeds.length, JSON.stringify(plan)).toBeGreaterThan(0);
        expect(new Set(seeds.map((seed) => seed.query)).size).toBe(seeds.length);
        for (const seed of seeds) {
          expect(seed.query).toBe(seed.query.trim());
          expect(seed.query.length).toBeLessThanOrEqual(200);
          expect(seed.label.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("plans a different pair for every distinct variant in one cycle", () => {
    const artistPairs = Array.from({ length: RADIO_PHRASE_CYCLES }, (_value, variant) =>
      planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant }).map((seed) => seed.query),
    );
    expect(new Set(artistPairs.map((pair) => pair.join("|"))).size).toBe(RADIO_PHRASE_CYCLES);

    const trackPairs = Array.from({ length: RADIO_PHRASE_CYCLES }, (_value, variant) =>
      planRadioSeeds({ kind: "track", title: "Get Lucky", artist: "Daft Punk", variant }).map(
        (seed) => seed.query,
      ),
    );
    expect(new Set(trackPairs.map((pair) => pair.join("|"))).size).toBe(RADIO_PHRASE_CYCLES);
  });

  it("is deterministic: the same identity at the same variant always plans the same seeds", () => {
    // The rotation input is the identity and the variant — nothing else, and no
    // randomness or server-held state. Run it many times and interleave the two
    // kinds so a hidden global cursor would show up as a mismatch.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant: 3 })).toEqual(
        planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant: 3 }),
      );
      expect(
        planRadioSeeds({ kind: "track", title: "Get Lucky", artist: "Daft Punk", variant: 2 }),
      ).toEqual(
        planRadioSeeds({ kind: "track", title: "Get Lucky", artist: "Daft Punk", variant: 2 }),
      );
      // …while a different identity at the same variant is a different plan.
      expect(planRadioSeeds({ kind: "artist", artist: "Radiohead", variant: 3 })).not.toEqual(
        planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant: 3 }),
      );
    }
  });

  it("wraps the rotation index once a full cycle has been served", () => {
    const first = planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant: 0 });
    expect(
      planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant: RADIO_PHRASE_CYCLES }),
    ).toEqual(first);
    expect(
      planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant: RADIO_PHRASE_CYCLES + 1 }),
    ).toEqual(planRadioSeeds({ kind: "artist", artist: "Daft Punk", variant: 1 }));
  });

  it("plans nothing for a blank or absent identity, so nothing may substitute for it", () => {
    expect(planRadioSeeds({ kind: "artist", artist: "   " })).toEqual([]);
    expect(planRadioSeeds({ kind: "artist" })).toEqual([]);
    expect(planRadioSeeds({ kind: "track", title: "   ", artist: "Daft Punk" })).toEqual([]);
    expect(planRadioSeeds({ kind: "track", artist: "Daft Punk" })).toEqual([]);
  });

  it("length-bounds a composed seed built from an over-long identity", () => {
    const long = "x".repeat(400);
    for (const seed of planRadioSeeds({ kind: "artist", artist: long, variant: 0 })) {
      expect(seed.query.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("resolveRadio — bounded fan-out, one result set per cycle", () => {
  it("issues at most two provider queries and returns the echoed variant", async () => {
    const primary = echoingProvider("ytmusic");

    const result = await resolveRadio(
      { kind: "artist", artist: "Daft Punk", variant: 0 },
      freshDeps({ providers: [primary] }),
    );

    const success = asSuccess(result);
    expect(primary.queries).toEqual(["Daft Punk songs", "Daft Punk radio"]);
    expect(success.variant).toBe(0);
    expect(success.tracks.length).toBe(2);
    expect(success.diagnostics.seedsTried).toBe(2);
    expect(success.diagnostics.seedsFailed).toEqual([]);
    expect(success.diagnostics.cached).toBe(false);
    expect(success.diagnostics.resultCount).toBe(success.tracks.length);
    // No provider shape crossed the boundary.
    expect(JSON.stringify(success)).not.toContain("flexColumns");
  });

  it("runs its seeds sequentially, never more than one chain call at a time", async () => {
    const releases: Array<() => void> = [];
    let inFlight = 0;
    let peakInFlight = 0;
    const primary = fakeProvider("ytmusic", () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return new Promise<ProviderCandidate[]>((resolve) => {
        const index = releases.length;
        releases.push(() => {
          inFlight -= 1;
          resolve([
            makeCandidate({
              videoId: `vid${index}`,
              title: `Track ${index}`,
              artistText: "Daft Punk",
            }),
          ]);
        });
      });
    });

    const pending = resolveRadio(
      { kind: "artist", artist: "Daft Punk", variant: 0 },
      freshDeps({ providers: [primary] }),
    );

    // The first seed starts and stays open — the gate is real, not a timing guess.
    await vi.waitFor(() => expect(primary.calls).toBe(1));
    await flushPendingWork();
    // The second seed waits its turn: with a fan-out both would be inside the
    // chain right now, each burning its budget on the shared outbound limiter.
    expect(primary.calls).toBe(1);
    expect(peakInFlight).toBe(RADIO_SEED_CONCURRENCY);

    releases[0]?.();
    await vi.waitFor(() => expect(primary.calls).toBe(2));
    expect(peakInFlight).toBe(RADIO_SEED_CONCURRENCY);
    releases[1]?.();

    const success = asSuccess(await pending);
    // Bounding the fan-out must not shrink the refill: both seeds landed.
    expect(success.tracks).toHaveLength(2);
    expect(success.diagnostics.seedsTried).toBe(2);
    expect(success.diagnostics.seedsSkipped).toEqual([]);
  });

  it("gives every seed the radio seed budget, never the chain's own 8s default", async () => {
    // The chain builds its budget with `AbortSignal.timeout`, so the value each
    // seed runs on is directly observable here.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 0 },
        freshDeps({ providers: [echoingProvider("ytmusic")] }),
      ),
    );

    const budgets = timeoutSpy.mock.calls.map(([ms]) => ms);
    // One request deadline, then one chain deadline per planned seed.
    expect(budgets[0]).toBe(RADIO_REQUEST_BUDGET_MS);
    expect(budgets.slice(1)).toEqual([RADIO_SEED_TIMEOUT_MS, RADIO_SEED_TIMEOUT_MS]);
    expect(budgets).not.toContain(REQUEST_BUDGET_MS);
    expect(RADIO_SEED_TIMEOUT_MS).toBeGreaterThan(REQUEST_BUDGET_MS);
  });

  it("returns different material for two variants of one identity", async () => {
    const primary = echoingProvider("ytmusic");

    const first = asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 0 },
        freshDeps({ providers: [primary] }),
      ),
    );
    const second = asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 1 },
        freshDeps({ providers: [primary] }),
      ),
    );

    // Different seeds were asked, so the second cycle is not limited to what the
    // first returned.
    expect(primary.queries).toEqual([
      "Daft Punk songs",
      "Daft Punk radio",
      "Daft Punk live",
      "Daft Punk concert",
    ]);
    expect(first.tracks.map((track) => track.providerId)).not.toEqual(
      second.tracks.map((track) => track.providerId),
    );
    expect(second.variant).toBe(1);
  });

  it("reports a failed seed without failing the request, and names it", async () => {
    const flaky = fakeProvider("ytmusic", async (request) => {
      if (request.query === "Daft Punk songs") {
        throw new ProviderError("ytmusic", "network", "flaky");
      }
      return [
        makeCandidate({
          videoId: "vid-survivor",
          title: "Track",
          artistText: "Daft Punk",
        }),
      ];
    });

    const success = asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 0 },
        freshDeps({ providers: [flaky] }),
      ),
    );
    expect(success.diagnostics.seedsTried).toBe(2);
    expect(success.diagnostics.seedsFailed).toEqual(["Daft Punk songs"]);
    expect(success.tracks).toHaveLength(1);
  });

  it("returns the seeds it got and names the rest as budget-skipped, not failed", async () => {
    const slowFirst = fakeProvider("ytmusic", async (request) => {
      if (request.query === "Daft Punk songs") {
        await new Promise((resolve) => {
          setTimeout(resolve, 120);
        });
      }
      return [
        makeCandidate({
          videoId: `vid-${request.query.replace(/\W+/g, "")}`,
          title: "Track",
          artistText: "Daft Punk",
        }),
      ];
    });

    const success = asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 0 },
        freshDeps({ providers: [slowFirst], requestBudgetMs: 30 }),
      ),
    );
    expect(success.tracks).toHaveLength(1);
    // A budget outcome is reported as its own thing, never as a provider failure.
    expect(success.diagnostics.seedsTried).toBe(1);
    expect(success.diagnostics.seedsFailed).toEqual([]);
    expect(success.diagnostics.seedsSkipped).toEqual(["Daft Punk radio"]);
  });

  it("returns a structured upstream failure when every seed fails (spec scenario)", async () => {
    const result = await resolveRadio(
      { kind: "artist", artist: "Daft Punk", variant: 0 },
      freshDeps({
        providers: [failingProvider("ytmusic", "network"), failingProvider("ytweb", "http")],
      }),
    );

    expect(result).toMatchObject({ ok: false, reason: "upstream" });
    if (result.ok) return;
    expect(result.diagnostics.seedsTried).toBe(2);
    expect(result.diagnostics.seedsFailed).toHaveLength(2);
    expect(result.diagnostics.tiersTried.map((entry) => entry.tier)).toEqual([
      "ytmusic",
      "ytweb",
      "ytmusic",
      "ytweb",
    ]);
  });

  it("reports a provider that answered with nothing as unresolvable, not upstream", async () => {
    const result = await resolveRadio(
      { kind: "artist", artist: "Nobody At All", variant: 0 },
      freshDeps({ providers: [emptyProvider("ytmusic")] }),
    );

    // The chain reached a tier and it carried nothing usable: the identity was
    // tested and did not resolve. That is a different fact from an outage.
    expect(result).toMatchObject({ ok: false, reason: "unresolvable" });
    if (result.ok) return;
    expect(result.diagnostics.seedsTried).toBe(2);
    expect(result.diagnostics.tiersTried).toEqual([
      { tier: "ytmusic", outcome: "empty" },
      { tier: "ytmusic", outcome: "empty" },
    ]);
  });

  it("reports unresolvable for a request with no usable identity, without a provider call", async () => {
    const failing = failingProvider("ytmusic");
    const deps = freshDeps({ providers: [failing] });

    const artist = await resolveRadio({ kind: "artist", artist: "   ", variant: 0 }, deps);
    const track = await resolveRadio({ kind: "track", title: "", artist: "Daft Punk" }, deps);

    expect(artist).toMatchObject({ ok: false, reason: "unresolvable" });
    expect(track).toMatchObject({ ok: false, reason: "unresolvable" });
    // Nothing was substituted for the missing identity, so nothing was asked.
    expect(failing.calls).toBe(0);
  });

  it("propagates caller cancellation instead of swallowing it as a failed seed", async () => {
    const controller = new AbortController();
    const hanging = fakeProvider("ytmusic", () => {
      return new Promise<ProviderCandidate[]>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const pending = resolveRadio(
      { kind: "artist", artist: "Daft Punk", variant: 0, signal: controller.signal },
      freshDeps({ providers: [hanging] }),
    );
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name === "AbortError",
    );
  });

  it("bounds the returned track set at the documented limit", async () => {
    const many = fakeProvider("ytmusic", async (request) =>
      Array.from({ length: 12 }, (_value, index) =>
        makeCandidate({
          videoId: `vid-${index}-${request.query.replace(/\W+/g, "")}`,
          title: `Track ${index} for ${request.query}`,
          artistText: "Daft Punk",
        }),
      ),
    );

    const success = asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 0, limit: 5 },
        freshDeps({ providers: [many] }),
      ),
    );
    expect(success.tracks).toHaveLength(5);
    expect(RADIO_TRACK_LIMIT).toBe(20);
    expect(RADIO_MAX_LIMIT).toBe(50);
  });
});

describe("applyExclusions — the played set, enforced by id and by providerId", () => {
  const tracks: RadioTrack[] = [
    makeTrack({ id: "youtube:a", providerId: "a", title: "One" }),
    makeTrack({ id: "youtube:b", providerId: "b", title: "Two" }),
    makeTrack({ id: "youtube:c", providerId: "c", title: "Three" }),
  ];

  it("drops a track whose canonical id is excluded", () => {
    expect(applyExclusions(tracks, ["youtube:b"]).map((track) => track.providerId)).toEqual([
      "a",
      "c",
    ]);
  });

  it("drops a track whose bare providerId is excluded", () => {
    expect(applyExclusions(tracks, ["b"]).map((track) => track.providerId)).toEqual(["a", "c"]);
  });

  it("drops every excluded id when several are listed", () => {
    expect(applyExclusions(tracks, ["a", "youtube:c"]).map((track) => track.providerId)).toEqual([
      "b",
    ]);
  });

  it("keeps every track for an empty or blank list, and preserves order", () => {
    expect(applyExclusions(tracks)).toBe(tracks);
    expect(applyExclusions(tracks, [])).toBe(tracks);
    expect(applyExclusions(tracks, ["", "   "]).map((track) => track.providerId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("yields nothing when every id is excluded — an empty answer, not a substitution", () => {
    expect(applyExclusions(tracks, ["a", "b", "c"])).toEqual([]);
    expect(applyExclusions(tracks, ["youtube:a", "b", "youtube:c"])).toEqual([]);
  });
});

describe("resolveRadio — exclusions, bounds, and the empty-after-exclusion answer", () => {
  it("keeps every excluded id out of the result, by id and by providerId", async () => {
    // Three distinct tracks, one excluded by its canonical `id` and one by its
    // bare `providerId`, so both spellings of "already played" are proven.
    const primary = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "one", title: "One", artistText: "Daft Punk" }),
      makeCandidate({ videoId: "two", title: "Two", artistText: "Daft Punk" }),
      makeCandidate({ videoId: "three", title: "Three", artistText: "Daft Punk" }),
    ]);

    const success = asSuccess(
      await resolveRadio(
        {
          kind: "artist",
          artist: "Daft Punk",
          variant: 0,
          exclude: ["youtube:one", "two"],
        },
        freshDeps({ providers: [primary] }),
      ),
    );

    expect(success.tracks.map((track) => track.providerId)).toEqual(["three"]);
    for (const id of ["youtube:one", "one", "two"]) {
      expect(success.tracks.some((track) => track.id === id || track.providerId === id)).toBe(
        false,
      );
    }
  });

  it("keeps the unexcluded half of a partly-excluded result", async () => {
    const primary = echoingProvider("ytmusic");

    const success = asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 0, exclude: ["vid-DaftPunksongs"] },
        freshDeps({ providers: [primary] }),
      ),
    );

    expect(success.tracks.map((track) => track.providerId)).toEqual(["vid-DaftPunkradio"]);
  });

  it("reports an all-excluded result as unresolvable rather than substituting material", async () => {
    // A third unrelated track is what a substitution would smuggle in.
    const primary = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "otherVid", title: "Someone Else", artistText: "Another Band" }),
    ]);

    const result = await resolveRadio(
      {
        kind: "artist",
        artist: "Daft Punk",
        variant: 0,
        exclude: ["otherVid", "youtube:otherVid"],
      },
      freshDeps({ providers: [primary] }),
    );

    expect(result).toMatchObject({ ok: false, reason: "unresolvable" });
    if (result.ok) return;
    expect(result.diagnostics.resultCount).toBe(0);
    // The seeds did resolve — the request was answered, there was simply nothing
    // left after the exclusion.
    expect(result.diagnostics.seedsTried).toBe(2);
    expect(result.diagnostics.seedsFailed).toEqual([]);
  });

  it("rejects an over-long exclusion list before contacting any provider", async () => {
    const failing = failingProvider("ytmusic");
    const deps = freshDeps({ providers: [failing] });
    const tooMany = Array.from({ length: RADIO_MAX_EXCLUDE + 1 }, (_value, index) => `id-${index}`);

    const result = await resolveRadio(
      { kind: "artist", artist: "Daft Punk", variant: 0, exclude: tooMany },
      deps,
    );

    // A rejected list, never a silently truncated one: truncating would quietly
    // re-serve already-played tracks.
    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(failing.calls).toBe(0);
  });

  it("rejects an over-long excluded id before contacting any provider", async () => {
    const failing = failingProvider("ytmusic");
    const result = await resolveRadio(
      { kind: "artist", artist: "Daft Punk", variant: 0, exclude: ["x".repeat(500)] },
      freshDeps({ providers: [failing] }),
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(failing.calls).toBe(0);
  });

  it("accepts a list exactly on the documented bound", async () => {
    const primary = echoingProvider("ytmusic");
    const exactly = Array.from({ length: RADIO_MAX_EXCLUDE }, (_value, index) => `id-${index}`);

    asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 0, exclude: exactly },
        freshDeps({ providers: [primary] }),
      ),
    );
    expect(primary.calls).toBe(2);
  });

  it("ignores blank exclusion entries rather than counting them against the bound", async () => {
    const primary = echoingProvider("ytmusic");
    const padded = [
      ...Array.from({ length: RADIO_MAX_EXCLUDE }, (_value, index) => `id-${index}`),
      "",
      "   ",
    ];

    asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Daft Punk", variant: 0, exclude: padded },
        freshDeps({ providers: [primary] }),
      ),
    );
    expect(primary.calls).toBe(2);
  });

  it.each([
    ["an unknown kind", { kind: "playlist" as never }],
    ["a negative variant", { kind: "artist" as const, artist: "Daft Punk", variant: -1 }],
    ["a fractional variant", { kind: "artist" as const, artist: "Daft Punk", variant: 1.5 }],
    [
      "a variant past its bound",
      { kind: "artist" as const, artist: "Daft Punk", variant: RADIO_MAX_VARIANT + 1 },
    ],
    ["a zero limit", { kind: "artist" as const, artist: "Daft Punk", variant: 0, limit: 0 }],
    [
      "a limit past its bound",
      { kind: "artist" as const, artist: "Daft Punk", variant: 0, limit: RADIO_MAX_LIMIT + 1 },
    ],
  ])("rejects %s as invalid_request with no provider contact", async (_label, request) => {
    const failing = failingProvider("ytmusic");
    const result = await resolveRadio(request, freshDeps({ providers: [failing] }));

    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
    if (result.ok) return;
    // Every rejection happened before anything was sent upstream.
    expect(result.diagnostics.seedsTried).toBe(0);
    expect(result.diagnostics.tiersTried).toEqual([]);
    expect(failing.calls).toBe(0);
  });

  it("accepts the documented bound extremes of variant and limit", async () => {
    const primary = echoingProvider("ytmusic");
    const deps = freshDeps({ providers: [primary] });

    asSuccess(await resolveRadio({ kind: "artist", artist: "Daft Punk", variant: 0 }, deps));
    asSuccess(
      await resolveRadio({ kind: "artist", artist: "Daft Punk", variant: RADIO_MAX_VARIANT }, deps),
    );
    asSuccess(
      await resolveRadio(
        { kind: "artist", artist: "Nile Rodgers", variant: 0, limit: RADIO_MAX_LIMIT },
        deps,
      ),
    );
    expect(RADIO_MAX_VARIANT).toBe(999);
    expect(RADIO_MAX_EXCLUDE).toBe(60);
  });
});

describe("radio cache keys and the shared result cache", () => {
  it("builds stable, namespaced keys that distinguish every request input", () => {
    const base = radioCacheKey({ kind: "artist", artist: "Daft Punk", variant: 0 });
    expect(base.startsWith("radio:")).toBe(true);
    // Identity, case/whitespace-insensitive.
    expect(base).toBe(radioCacheKey({ kind: "artist", artist: "  daft punk ", variant: 0 }));
    // Every other input is part of the identity.
    expect(base).not.toBe(radioCacheKey({ kind: "artist", artist: "Daft Punk", variant: 1 }));
    expect(base).not.toBe(
      radioCacheKey({ kind: "track", title: "Daft Punk", artist: "Daft Punk", variant: 0 }),
    );
    expect(base).not.toBe(
      radioCacheKey({ kind: "artist", artist: "Daft Punk", variant: 0, limit: 5 }),
    );
    // The played set is part of it: two callers excluding different ids are
    // different requests, not one cached answer.
    expect(base).not.toBe(
      radioCacheKey({ kind: "artist", artist: "Daft Punk", variant: 0, exclude: ["a"] }),
    );
    expect(
      radioCacheKey({ kind: "artist", artist: "Daft Punk", variant: 0, exclude: ["a", "b"] }),
    ).toBe(radioCacheKey({ kind: "artist", artist: "Daft Punk", variant: 0, exclude: ["b", "a"] }));
  });

  it("shares one entry between variants that wrap onto the same curated cycle", () => {
    // The wrap means those two variants ask the identical question, so one
    // cached answer is right rather than a redundant re-query.
    expect(radioCacheKey({ kind: "artist", artist: "Daft Punk", variant: 0 })).toBe(
      radioCacheKey({
        kind: "artist",
        artist: "Daft Punk",
        variant: RADIO_PHRASE_CYCLES * 3,
      }),
    );
  });

  it("serves a repeat refill from the cache without a second chain call", async () => {
    const primary = echoingProvider("ytmusic");
    const deps = freshDeps({ providers: [primary] });

    const first = asSuccess(await resolveRadio({ kind: "artist", artist: "Daft Punk" }, deps));
    const second = asSuccess(await resolveRadio({ kind: "artist", artist: "Daft Punk" }, deps));

    expect(first.diagnostics.cached).toBe(false);
    expect(second.diagnostics.cached).toBe(true);
    expect(primary.calls).toBe(2); // the two planned seeds, once
    // The cached answer is the same material, not a re-resolution.
    expect(second.tracks).toEqual(first.tracks);
  });

  it("never caches a failure — the next refill retries upstream", async () => {
    const failing = failingProvider("ytmusic");
    const deps = freshDeps({ providers: [failing] });

    const first = await resolveRadio({ kind: "artist", artist: "Daft Punk" }, deps);
    const second = await resolveRadio({ kind: "artist", artist: "Daft Punk" }, deps);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(failing.calls).toBe(4); // two requests × two seeds
    expect(deps.cache.size).toBe(0);
  });

  it("shares one in-flight refill between identical concurrent requests", async () => {
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
                artistText: "Daft Punk",
              }),
            ]),
          );
        }),
    );
    const deps = freshDeps({ providers: [primary] });

    const first = resolveRadio({ kind: "artist", artist: "Daft Punk" }, deps);
    const second = resolveRadio({ kind: "artist", artist: "Daft Punk" }, deps);
    await vi.waitFor(() => expect(primary.calls).toBe(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(primary.calls).toBe(2));
    for (const release of releases) release();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(primary.calls).toBe(2);
    expect(deps.inflight.size).toBe(0);
  });

  it("exposes a documented process-wide default and the shared bounds", () => {
    expect(defaultRadioDeps.cache).toBeDefined();
    expect(defaultRadioDeps.inflight).toBeDefined();
    expect(RADIO_KINDS).toEqual(["track", "artist"]);
    expect(RADIO_SEED_CAP).toBe(2);
    expect(RADIO_SEED_CONCURRENCY).toBe(1);
    expect(RADIO_CACHE_TTL_MS).toBe(300_000);
  });
});
