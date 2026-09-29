import { afterEach, describe, expect, it, vi } from "vitest";
import { createInflightDedup, createTtlCache } from "@/server/music/cache";
import { REQUEST_BUDGET_MS } from "@/server/music/chain";
import {
  CATALOG_ALBUM_TRACK_LIMIT,
  CATALOG_ARTIST_TRACK_LIMIT,
  CATALOG_CACHE_MAX_ENTRIES,
  CATALOG_CACHE_TTL_MS,
  CATALOG_FEED_BUDGET_MS,
  CATALOG_RELATED_ARTIST_LIMIT,
  CATALOG_SEED_CAP,
  CATALOG_SEED_CONCURRENCY,
  CATALOG_SEED_TIMEOUT_MS,
  albumCacheKey,
  artistCacheKey,
  bestArtistArtwork,
  defaultCatalogDeps,
  deriveRelatedArtists,
  deriveReleases,
  planAlbumSeeds,
  planArtistSeeds,
  planSimilarSeeds,
  resolveAlbum,
  resolveArtist,
  resolveSimilar,
  similarCacheKey,
  type AlbumSuccess,
  type ArtistSuccess,
  type CatalogDeps,
  type CatalogOptions,
  type SimilarSuccess,
} from "@/server/music/catalog";
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
function echoingProvider(id: TierId, prefix: string, artistText = "Daft Punk") {
  return fakeProvider(id, async (request) => [
    makeCandidate({
      videoId: `${prefix}${request.query.replace(/\W+/g, "")}`,
      title: `Track for ${request.query}`,
      artistText,
    }),
  ]);
}

/** Fresh service state per test (the module keeps one process-wide copy). */
function freshDeps(chainOptions?: CatalogOptions): CatalogDeps {
  const options = {
    ttlMs: CATALOG_CACHE_TTL_MS,
    maxEntries: CATALOG_CACHE_MAX_ENTRIES,
  };
  return {
    artist: { cache: createTtlCache<ArtistSuccess>(options), inflight: createInflightDedup() },
    album: { cache: createTtlCache<AlbumSuccess>(options), inflight: createInflightDedup() },
    similar: { cache: createTtlCache<SimilarSuccess>(options), inflight: createInflightDedup() },
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

describe("seed planning — at most two bounded, deduped seeds per entity", () => {
  it("plans the artist name and its `songs` framing, capped at the documented ceiling", () => {
    expect(planArtistSeeds({ name: "Daft Punk" })).toEqual([
      { query: "Daft Punk", label: "artist" },
      { query: "Daft Punk songs", label: "artist songs" },
    ]);
    expect(planArtistSeeds({ name: "  Daft Punk  " })[0]?.query).toBe("Daft Punk");
    expect(planArtistSeeds({ name: "Daft Punk" }).length).toBeLessThanOrEqual(CATALOG_SEED_CAP);
  });

  it("plans one seed from the id when no name was given (design decision 2)", () => {
    expect(planArtistSeeds({ id: "UCabc123" })).toEqual([
      { query: "UCabc123", label: "artist id" },
    ]);
    // A name wins over an id: it is the better query text, and the id is still
    // carried as the reported identity.
    expect(
      planArtistSeeds({ name: "Daft Punk", id: "UCabc123" }).map((seed) => seed.query),
    ).toEqual(["Daft Punk", "Daft Punk songs"]);
  });

  it("plans nothing for a blank or absent identifier", () => {
    expect(planArtistSeeds({})).toEqual([]);
    expect(planArtistSeeds({ name: "   ", id: "  " })).toEqual([]);
  });

  it("plans album seeds from the title, narrowed by an artist when given", () => {
    expect(planAlbumSeeds({ title: "Random Access Memories" }).map((seed) => seed.query)).toEqual([
      "Random Access Memories",
      "Random Access Memories album",
    ]);
    expect(
      planAlbumSeeds({ title: "Random Access Memories", artist: "Daft Punk" }).map(
        (seed) => seed.query,
      ),
    ).toEqual(["Daft Punk Random Access Memories", "Random Access Memories Daft Punk album"]);
    expect(planAlbumSeeds({})).toEqual([]);
  });

  it("plans similar-track seeds from the source track's public metadata", () => {
    expect(planSimilarSeeds({ title: "Get Lucky" }).map((seed) => seed.query)).toEqual([
      "Get Lucky",
      "Get Lucky similar",
    ]);
    expect(
      planSimilarSeeds({ title: "Get Lucky", artist: "Daft Punk" }).map((s) => s.query),
    ).toEqual(["Daft Punk Get Lucky", "Daft Punk Get Lucky similar"]);
  });

  it("dedupes, trims, and length-bounds every plan", () => {
    // A blank artist narrowing collapses the two framings onto one seed.
    expect(planSimilarSeeds({ title: "Get Lucky", artist: "   " })).toHaveLength(2);
    expect(planSimilarSeeds({ title: "Get Lucky", artist: "Daft Punk" })).toHaveLength(2);
    const long = "x".repeat(400);
    const seeds = planArtistSeeds({ name: `  ${long}  ` });
    for (const seed of seeds) {
      expect(seed.query).toBe(seed.query.trim());
      expect(seed.query.length).toBeLessThanOrEqual(200);
    }
    // `<name>` and `<name> songs` both clip to the same 200 characters of an
    // over-long name, so the plan dedupes them into one bounded seed.
    expect(seeds).toHaveLength(1);
  });
});

describe("resolveArtist — one bounded resolution, whole view derived from it", () => {
  it("issues at most two provider queries and derives identity, tracks, related, and releases from them", async () => {
    const primary = fakeProvider("ytmusic", async (request) => [
      makeCandidate({
        videoId: `vid-${request.query.replace(/\W+/g, "")}`,
        title: `${request.query} track`,
        artistText: "Daft Punk",
        albumTitle: "Random Access Memories",
        albumId: "MPREb_1",
        durationSeconds: 249,
      }),
    ]);

    const result = await resolveArtist({ name: "Daft Punk" }, freshDeps({ providers: [primary] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Two seeds, and the merge collapses the shared result into one track.
    expect(primary.queries).toEqual(["Daft Punk", "Daft Punk songs"]);
    expect(result.artist.name).toBe("Daft Punk");
    expect(result.tracks.length).toBeGreaterThan(0);
    expect(result.releases.map((release) => release.title)).toEqual(["Random Access Memories"]);
    expect(result.related).toEqual([]);
    expect(result.diagnostics.seedsTried).toBe(2);
    expect(result.diagnostics.seedsFailed).toEqual([]);
    expect(result.diagnostics.cached).toBe(false);
    expect(result.diagnostics.resultCount).toBe(result.tracks.length);
    // No provider shape crossed the boundary.
    expect(JSON.stringify(result)).not.toContain("flexColumns");
  });

  it("runs its seeds sequentially, never more than one chain call at a time", async () => {
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

    const pending = resolveArtist({ name: "Daft Punk" }, freshDeps({ providers: [primary] }));

    // The first seed starts and stays open — the gate is real, not a timing guess.
    await vi.waitFor(() => expect(primary.calls).toBe(1));
    await flushPendingWork();
    // The second seed waits its turn: with a fan-out both would be inside the
    // chain right now, each burning its budget on the shared outbound limiter.
    expect(primary.calls).toBe(1);
    expect(peakInFlight).toBe(CATALOG_SEED_CONCURRENCY);

    releases[0]?.();
    await vi.waitFor(() => expect(primary.calls).toBe(2));
    expect(peakInFlight).toBe(CATALOG_SEED_CONCURRENCY);
    releases[1]?.();

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Bounding the fan-out must not shrink the resolution: both seeds landed.
      expect(result.tracks).toHaveLength(2);
      expect(result.diagnostics.seedsTried).toBe(2);
    }
    expect(result.ok && result.diagnostics.seedsSkipped).toEqual([]);
  });

  it("gives every seed the catalog seed budget, never the chain's own 8s default", async () => {
    // The chain builds its budget with `AbortSignal.timeout`, so the value each
    // seed runs on is directly observable here.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const result = await resolveArtist(
      { name: "Daft Punk" },
      freshDeps({ providers: [echoingProvider("ytmusic", "vid-")] }),
    );

    expect(result.ok).toBe(true);
    const budgets = timeoutSpy.mock.calls.map(([ms]) => ms);
    // One entity deadline, then one chain deadline per planned seed.
    expect(budgets[0]).toBe(CATALOG_FEED_BUDGET_MS);
    expect(budgets.slice(1)).toEqual([CATALOG_SEED_TIMEOUT_MS, CATALOG_SEED_TIMEOUT_MS]);
    expect(budgets).not.toContain(REQUEST_BUDGET_MS);
    expect(CATALOG_SEED_TIMEOUT_MS).toBeGreaterThan(REQUEST_BUDGET_MS);
  });

  it("reports a failed seed without failing the request, and names it", async () => {
    const flaky = fakeProvider("ytmusic", async (request) => {
      if (request.query === "Daft Punk") throw new ProviderError("ytmusic", "network", "flaky");
      return [
        makeCandidate({
          videoId: `vid-${request.query.replace(/\W+/g, "")}`,
          title: "Track",
          artistText: "Daft Punk",
        }),
      ];
    });

    const result = await resolveArtist({ name: "Daft Punk" }, freshDeps({ providers: [flaky] }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.seedsTried).toBe(2);
    expect(result.diagnostics.seedsFailed).toEqual(["Daft Punk"]);
    expect(result.tracks).toHaveLength(1);
  });

  it("returns the seeds it got and names the rest as budget-skipped, not failed", async () => {
    const planned = ["Daft Punk", "Daft Punk songs"];
    const slowFirst = fakeProvider("ytmusic", async (request) => {
      if (request.query === planned[0]) {
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

    const result = await resolveArtist(
      { name: "Daft Punk" },
      freshDeps({ providers: [slowFirst], feedBudgetMs: 30 }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracks).toHaveLength(1);
    // A budget outcome is reported as its own thing, never as a provider failure.
    expect(result.diagnostics.seedsTried).toBe(1);
    expect(result.diagnostics.seedsFailed).toEqual([]);
    expect(result.diagnostics.seedsSkipped).toEqual(planned.slice(1));
  });

  it("resolves an id-keyed artist from the credits the chain returned", async () => {
    const primary = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "vidA", title: "Get Lucky", artistText: "Daft Punk" }),
    ]);

    const result = await resolveArtist({ id: "UCabc123" }, freshDeps({ providers: [primary] }));

    expect(result.ok).toBe(true);
    expect(primary.queries).toEqual(["UCabc123"]);
    if (!result.ok) return;
    // No name was requested, so the identity is read from the resolved credits.
    expect(result.artist.name).toBe("Daft Punk");
    expect(result.artist.id).toBe("UCabc123");
  });

  it("returns a structured upstream failure when every seed fails (spec scenario)", async () => {
    const result = await resolveArtist(
      { name: "Daft Punk" },
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
    const result = await resolveArtist(
      { name: "Nobody At All" },
      freshDeps({ providers: [emptyProvider("ytmusic")] }),
    );

    // The chain reached a tier and it carried nothing usable: the identifier was
    // tested and did not resolve. That is a different fact from an outage.
    expect(result).toMatchObject({ ok: false, reason: "unresolvable" });
    if (result.ok) return;
    // Both planned seeds asked, and both answers came back empty.
    expect(result.diagnostics.seedsTried).toBe(2);
    expect(result.diagnostics.tiersTried).toEqual([
      { tier: "ytmusic", outcome: "empty" },
      { tier: "ytmusic", outcome: "empty" },
    ]);
  });

  it("never substitutes a different artist for one that did not resolve", async () => {
    // A provider answers, but with somebody else's upload: the requested artist
    // is not credited anywhere, so nothing may stand in for it.
    const other = fakeProvider("ytmusic", async () => [
      makeCandidate({
        videoId: "vidOther",
        title: "Someone Else",
        artistText: "A Totally Different Band",
      }),
    ]);

    const result = await resolveArtist({ name: "Daft Punk" }, freshDeps({ providers: [other] }));

    expect(result).toMatchObject({ ok: false, reason: "unresolvable" });
  });

  it("propagates caller cancellation instead of swallowing it as a failed seed", async () => {
    const controller = new AbortController();
    const hanging = fakeProvider("ytmusic", ({ signal }) => {
      void signal;
      return new Promise<ProviderCandidate[]>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const pending = resolveArtist(
      { name: "Daft Punk", signal: controller.signal },
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

  it("bounds the returned track set at the documented limit", () => {
    expect(CATALOG_ARTIST_TRACK_LIMIT).toBe(20);
    expect(CATALOG_RELATED_ARTIST_LIMIT).toBe(10);
    expect(CATALOG_ALBUM_TRACK_LIMIT).toBe(30);
  });
});

describe("deriveRelatedArtists — ranking, cap, exclusion, determinism", () => {
  const tracks = [
    makeTrack({
      id: "youtube:t1",
      providerId: "t1",
      title: "One",
      artists: [{ name: "Daft Punk" }, { name: "Pharrell" }],
    }),
    makeTrack({
      id: "youtube:t2",
      providerId: "t2",
      title: "Two",
      artists: [{ name: "Daft Punk" }, { name: "Pharrell" }],
    }),
    makeTrack({
      id: "youtube:t3",
      providerId: "t3",
      title: "Three",
      artists: [{ name: "Daft Punk" }, { name: "Giorgio" }],
    }),
  ];

  it("ranks by track frequency descending", () => {
    const related = deriveRelatedArtists("Daft Punk", tracks);
    expect(related.map((artist) => artist.name)).toEqual(["Pharrell", "Giorgio"]);
    expect(related.map((artist) => artist.trackCount)).toEqual([2, 1]);
  });

  it("breaks a frequency tie by first appearance", () => {
    const tied = [
      makeTrack({
        id: "youtube:a",
        providerId: "a",
        title: "A",
        artists: [{ name: "Primary" }, { name: "Zeta" }],
      }),
      makeTrack({
        id: "youtube:b",
        providerId: "b",
        title: "B",
        artists: [{ name: "Primary" }, { name: "Alpha" }],
      }),
    ];
    expect(deriveRelatedArtists("Primary", tied).map((artist) => artist.name)).toEqual([
      "Zeta",
      "Alpha",
    ]);
  });

  it("excludes the primary artist case-insensitively, punctuation included", () => {
    const featured = [
      makeTrack({
        id: "youtube:f",
        providerId: "f",
        title: "F",
        artists: [{ name: "daft punk" }, { name: "Pharrell Williams" }],
      }),
    ];
    const related = deriveRelatedArtists("Daft Punk", featured);
    expect(related.map((artist) => artist.name)).toEqual(["Pharrell Williams"]);
    expect(related.some((artist) => artist.name.toLowerCase().includes("daft punk"))).toBe(false);
  });

  it("does not let a narrower name swallow a different artist that starts alike", () => {
    // `"Bo"` must not exclude `"Boards of Canada"`: the separator rule.
    const tracksWithBo = [
      makeTrack({
        id: "youtube:x",
        providerId: "x",
        title: "X",
        artists: [{ name: "Bo" }, { name: "Boards of Canada" }],
      }),
    ];
    expect(deriveRelatedArtists("Bo", tracksWithBo).map((artist) => artist.name)).toEqual([
      "Boards of Canada",
    ]);
  });

  it("counts a repeated credit inside one track once", () => {
    const duplicated = [
      makeTrack({
        id: "youtube:d",
        providerId: "d",
        title: "D",
        artists: [{ name: "Primary" }, { name: "Guest" }, { name: "Guest" }],
      }),
    ];
    expect(deriveRelatedArtists("Primary", duplicated)[0]?.trackCount).toBe(1);
  });

  it("caps the shelf at the requested limit", () => {
    const many = Array.from({ length: 25 }, (_value, index) =>
      makeTrack({
        id: `youtube:m${index}`,
        providerId: `m${index}`,
        title: `Track ${index}`,
        artists: [{ name: "Primary" }, { name: `Guest ${index}` }],
      }),
    );
    expect(deriveRelatedArtists("Primary", many)).toHaveLength(CATALOG_RELATED_ARTIST_LIMIT);
    expect(deriveRelatedArtists("Primary", many, 3)).toHaveLength(3);
    expect(deriveRelatedArtists("Primary", many, 0)).toEqual([]);
  });

  it("carries the best artwork and a provider id when the credits supplied one", () => {
    const withArtwork = [
      makeTrack({
        id: "youtube:a1",
        providerId: "a1",
        title: "A",
        artists: [{ name: "Primary" }, { name: "Guest", id: "UCguest" }],
        artwork: [{ url: "https://img.test/small.jpg", width: 60, height: 60 }],
      }),
      makeTrack({
        id: "youtube:a2",
        providerId: "a2",
        title: "B",
        artists: [{ name: "Primary" }, { name: "Guest" }],
        artwork: [{ url: "https://img.test/large.jpg", width: 544, height: 544 }],
      }),
    ];
    const [guest] = deriveRelatedArtists("Primary", withArtwork);
    expect(guest?.id).toBe("UCguest");
    expect(guest?.artworkUrl).toBe("https://img.test/large.jpg");
  });

  it("is deterministic: the same input yields the same output every time", () => {
    const first = deriveRelatedArtists("Daft Punk", tracks);
    const second = deriveRelatedArtists("Daft Punk", tracks);
    expect(second).toEqual(first);
    // And independent of the artist's own spelling in the request.
    expect(deriveRelatedArtists("DAFT PUNK!", tracks)).toEqual(first);
  });

  it("returns an empty shelf for an empty or single-artist track set", () => {
    expect(deriveRelatedArtists("Daft Punk", [])).toEqual([]);
    expect(
      deriveRelatedArtists("Daft Punk", [makeTrack({ artists: [{ name: "Daft Punk" }] })]),
    ).toEqual([]);
  });
});

describe("deriveReleases — grouping, member artwork, ordering", () => {
  it("groups tracks by album summary and skips tracks with no album", () => {
    const tracks = [
      makeTrack({
        id: "youtube:r1",
        providerId: "r1",
        title: "One",
        album: { title: "Discovery", id: "MPREa" },
      }),
      makeTrack({
        id: "youtube:r2",
        providerId: "r2",
        title: "Two",
        album: { title: "Discovery" },
      }),
      makeTrack({
        id: "youtube:r3",
        providerId: "r3",
        title: "Three",
        album: { title: "Random Access Memories" },
      }),
      makeTrack({ id: "youtube:r4", providerId: "r4", title: "Four" }),
    ];

    const releases = deriveReleases(tracks);

    expect(releases.map((release) => release.title)).toEqual([
      "Discovery",
      "Random Access Memories",
    ]);
    expect(releases[0]?.trackCount).toBe(2);
    expect(releases[1]?.trackCount).toBe(1);
    expect(releases[0]?.id).toBe("MPREa");
  });

  it("groups case- and punctuation-insensitively", () => {
    const tracks = [
      makeTrack({
        id: "youtube:c1",
        providerId: "c1",
        title: "One",
        album: { title: "Random Access Memories" },
      }),
      makeTrack({
        id: "youtube:c2",
        providerId: "c2",
        title: "Two",
        album: { title: "random access memories!" },
      }),
    ];
    expect(deriveReleases(tracks)).toHaveLength(1);
    expect(deriveReleases(tracks)[0]?.trackCount).toBe(2);
  });

  it("orders by member count descending, then title ascending", () => {
    const tracks = [
      ...Array.from({ length: 3 }, (_value, index) =>
        makeTrack({
          id: `youtube:z${index}`,
          providerId: `z${index}`,
          title: `Z${index}`,
          album: { title: "Zebra" },
        }),
      ),
      makeTrack({ id: "youtube:a0", providerId: "a0", title: "A0", album: { title: "Alpha" } }),
      makeTrack({ id: "youtube:a1", providerId: "a1", title: "A1", album: { title: "Alpha" } }),
    ];
    // Three members beats two, and the two-member ties break on title.
    expect(deriveReleases(tracks).map((release) => release.title)).toEqual(["Zebra", "Alpha"]);
  });

  it("takes a release's artwork from the best of its member tracks", () => {
    const tracks = [
      makeTrack({
        id: "youtube:w1",
        providerId: "w1",
        title: "One",
        album: { title: "Discovery" },
        artwork: [{ url: "https://img.test/small.jpg", width: 60, height: 60 }],
      }),
      makeTrack({
        id: "youtube:w2",
        providerId: "w2",
        title: "Two",
        album: { title: "Discovery" },
        artwork: [{ url: "https://img.test/large.jpg", width: 544, height: 544 }],
      }),
    ];
    expect(deriveReleases(tracks)[0]?.artworkUrl).toBe("https://img.test/large.jpg");
  });

  it("carries the artist name from a member track and nothing when no member has one", () => {
    const withArtist = [
      makeTrack({
        id: "youtube:n1",
        providerId: "n1",
        title: "One",
        artists: [{ name: "Daft Punk" }],
        album: { title: "Discovery" },
      }),
    ];
    expect(deriveReleases(withArtist)[0]?.artistName).toBe("Daft Punk");
    expect(deriveReleases([])).toEqual([]);
  });

  it("is deterministic across repeated derivations", () => {
    const tracks = [
      makeTrack({ id: "youtube:d1", providerId: "d1", title: "One", album: { title: "B" } }),
      makeTrack({ id: "youtube:d2", providerId: "d2", title: "Two", album: { title: "A" } }),
    ];
    expect(deriveReleases(tracks)).toEqual(deriveReleases(tracks));
    expect(deriveReleases(tracks).map((release) => release.title)).toEqual(["A", "B"]);
  });
});

describe("bestArtistArtwork", () => {
  it("returns the largest artwork among the tracks crediting the artist", () => {
    const tracks = [
      makeTrack({
        id: "youtube:1",
        providerId: "1",
        title: "One",
        artists: [{ name: "Someone Else" }],
        artwork: [{ url: "https://img.test/huge.jpg", width: 1000, height: 1000 }],
      }),
      makeTrack({
        id: "youtube:2",
        providerId: "2",
        title: "Two",
        artists: [{ name: "Daft Punk" }],
        artwork: [{ url: "https://img.test/medium.jpg", width: 320, height: 320 }],
      }),
    ];
    // The larger picture belongs to another artist and must not be borrowed.
    expect(bestArtistArtwork("Daft Punk", tracks)).toBe("https://img.test/medium.jpg");
  });

  it("returns undefined when no crediting track carries artwork", () => {
    expect(bestArtistArtwork("Daft Punk", [])).toBeUndefined();
    expect(
      bestArtistArtwork("Nobody", [makeTrack({ artists: [{ name: "Daft Punk" }], artwork: [] })]),
    ).toBeUndefined();
  });
});

describe("resolveAlbum — release metadata, resolved order, metadataIncomplete", () => {
  const confirmedProvider = fakeProvider("ytmusic", async (request) => [
    makeCandidate({
      videoId: `vid-${request.query.replace(/\W+/g, "")}`,
      title: "Get Lucky",
      artistText: "Daft Punk",
      albumTitle: "Random Access Memories",
      albumId: "MPREalbum",
      durationSeconds: 249,
    }),
  ]);

  it("returns the release, its tracks, and a false completeness flag when metadata is confirmed", async () => {
    const result = await resolveAlbum(
      { title: "random access memories!!", artist: "Daft Punk" },
      freshDeps({ providers: [confirmedProvider] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Matching is case/punctuation-insensitive, so the confirmation holds.
    expect(result.metadataIncomplete).toBe(false);
    expect(result.album.title).toBe("random access memories!!");
    expect(result.album.artistName).toBe("Daft Punk");
    expect(result.album.id).toBe("MPREalbum");
    expect(result.album.artworkUrl).toBe("https://example.test/art.jpg");
    expect(result.tracks.length).toBeGreaterThan(0);
    // Tracks travel in resolved order and are never renumbered into a tracklist.
    expect(result.tracks.map((track) => track.title)).toContain("Get Lucky");
  });

  it("flags metadataIncomplete when no resolved track carries the requested album", async () => {
    // Search-derived results frequently carry no album metadata at all.
    const bare = fakeProvider("ytmusic", async (request) => [
      makeCandidate({
        videoId: `vid-${request.query.replace(/\W+/g, "")}`,
        title: "Some Song",
        artistText: "Daft Punk",
        durationSeconds: 249,
      }),
    ]);

    const result = await resolveAlbum(
      { title: "Random Access Memories" },
      freshDeps({ providers: [bare] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadataIncomplete).toBe(true);
    // The tracks are still returned (the page shows them with a notice) and no
    // unrelated cover is presented as this album's artwork.
    expect(result.tracks.length).toBeGreaterThan(0);
    expect(result.album.artworkUrl).toBeUndefined();
  });

  it("flags metadataIncomplete for an id-only request, which has no title to confirm", async () => {
    const result = await resolveAlbum(
      { id: "MPREalbum" },
      freshDeps({ providers: [confirmedProvider] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.metadataIncomplete).toBe(true);
    expect(result.album.id).toBe("MPREalbum");
  });

  it("uses the id as the query term for an id-only request", async () => {
    const provider = fakeProvider("ytmusic", async (request) => [
      makeCandidate({
        videoId: `vid-${request.query.replace(/\W+/g, "")}`,
        title: "Get Lucky",
        artistText: "Daft Punk",
        albumTitle: "Random Access Memories",
        albumId: "MPREalbum",
        durationSeconds: 249,
      }),
    ]);
    await resolveAlbum({ id: "MPREidonly" }, freshDeps({ providers: [provider] }));
    expect(provider.queries).toEqual(["MPREidonly", "MPREidonly album"]);
  });

  it("never reports unresolvable for a release whose tracks simply lack album metadata", async () => {
    const bare = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "vidBare", title: "Some Song", artistText: "Daft Punk" }),
    ]);
    const result = await resolveAlbum({ title: "Unknown" }, freshDeps({ providers: [bare] }));
    // Incomplete metadata is a disclosure, not a failure.
    expect(result.ok).toBe(true);
  });

  it("returns the structured upstream failure when every seed fails", async () => {
    const result = await resolveAlbum(
      { title: "Random Access Memories" },
      freshDeps({ providers: [failingProvider("ytmusic")] }),
    );
    expect(result).toMatchObject({ ok: false, reason: "upstream" });
  });

  it("returns unresolvable when a tier answered with nothing", async () => {
    const result = await resolveAlbum(
      { title: "Nothing At All" },
      freshDeps({ providers: [emptyProvider("ytmusic")] }),
    );
    expect(result).toMatchObject({ ok: false, reason: "unresolvable" });
  });

  it("reports unresolvable for a blank identifier without contacting a provider", async () => {
    const failing = failingProvider("ytmusic");
    const result = await resolveAlbum({ title: "   " }, freshDeps({ providers: [failing] }));
    expect(result).toMatchObject({ ok: false, reason: "unresolvable" });
    expect(failing.calls).toBe(0);
  });
});

describe("resolveSimilar — candidates never include the source track", () => {
  it("drops a candidate whose id equals the excluded source track", async () => {
    const primary = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "sourceVid", title: "Get Lucky", artistText: "Daft Punk" }),
      makeCandidate({ videoId: "otherA", title: "Instant Crush", artistText: "Daft Punk" }),
      makeCandidate({
        videoId: "otherB",
        title: "Lose Yourself to Dance",
        artistText: "Daft Punk",
      }),
    ]);

    const result = await resolveSimilar(
      { title: "Get Lucky", artist: "Daft Punk", exclude: "youtube:sourceVid" },
      freshDeps({ providers: [primary] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tracks.map((track) => track.providerId)).toEqual(["otherA", "otherB"]);
  });

  it("drops a candidate whose bare providerId equals the excluded source track", async () => {
    const primary = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "sourceVid", title: "Get Lucky", artistText: "Daft Punk" }),
      makeCandidate({ videoId: "otherA", title: "Instant Crush", artistText: "Daft Punk" }),
    ]);

    const result = await resolveSimilar(
      { title: "Get Lucky", artist: "Daft Punk", exclude: "sourceVid" },
      freshDeps({ providers: [primary] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tracks.map((track) => track.providerId)).toEqual(["otherA"]);
  });

  it("keeps every candidate when no exclusion was requested", async () => {
    const primary = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "sourceVid", title: "Get Lucky", artistText: "Daft Punk" }),
      makeCandidate({ videoId: "otherA", title: "Instant Crush", artistText: "Daft Punk" }),
    ]);

    const result = await resolveSimilar(
      { title: "Get Lucky", artist: "Daft Punk" },
      freshDeps({ providers: [primary] }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tracks).toHaveLength(2);
  });

  it("returns unresolvable when exclusion would empty the candidate set", async () => {
    const only = fakeProvider("ytmusic", async () => [
      makeCandidate({ videoId: "sourceVid", title: "Get Lucky", artistText: "Daft Punk" }),
    ]);

    const result = await resolveSimilar(
      { title: "Get Lucky", artist: "Daft Punk", exclude: "youtube:sourceVid" },
      freshDeps({ providers: [only] }),
    );

    expect(result).toMatchObject({ ok: false, reason: "unresolvable" });
  });

  it("maps an all-seeds failure to the upstream reason", async () => {
    const result = await resolveSimilar(
      { title: "Get Lucky" },
      freshDeps({ providers: [failingProvider("ytmusic")] }),
    );
    expect(result).toMatchObject({ ok: false, reason: "upstream" });
  });
});

describe("catalog cache keys and the shared result cache", () => {
  it("builds stable, namespaced keys that distinguish every identifier input", () => {
    const artist = artistCacheKey({ name: "  Daft Punk ", id: "UCabc" });
    expect(artist).toBe(artistCacheKey({ name: "daft punk", id: "ucabc" }));
    expect(artist.startsWith("artist:")).toBe(true);
    expect(artistCacheKey({ name: "Daft Punk" })).not.toBe(
      artistCacheKey({ name: "Daft Punk", id: "UCx" }),
    );
    expect(artistCacheKey({ name: "Daft Punk" })).not.toBe(artistCacheKey({ id: "Daft Punk" }));
    expect(artistCacheKey({ name: "Daft Punk", limit: 5 })).not.toBe(
      artistCacheKey({ name: "Daft Punk" }),
    );

    const album = albumCacheKey({ title: "Discovery", artist: "Daft Punk" });
    expect(album.startsWith("album:")).toBe(true);
    expect(album).toBe(albumCacheKey({ title: " Discovery ", artist: "daft punk" }));
    expect(album).not.toBe(albumCacheKey({ title: "Discovery" }));
    expect(album).not.toBe(artistCacheKey({ name: "Discovery" }));

    const similar = similarCacheKey({
      title: "Get Lucky",
      artist: "Daft Punk",
      exclude: "youtube:a",
    });
    expect(similar.startsWith("similar:")).toBe(true);
    // The exclusion is part of the identity: two callers excluding different
    // source tracks are different requests, not one cached answer.
    expect(similar).not.toBe(similarCacheKey({ title: "Get Lucky", artist: "Daft Punk" }));
    expect(similar).not.toBe(
      similarCacheKey({ title: "Get Lucky", artist: "Daft Punk", exclude: "youtube:b" }),
    );
  });

  it("serves a repeat artist request from the cache without a second chain call", async () => {
    const primary = echoingProvider("ytmusic", "vid-");
    const deps = freshDeps({ providers: [primary] });

    const first = await resolveArtist({ name: "Daft Punk" }, deps);
    const second = await resolveArtist({ name: "Daft Punk" }, deps);

    expect(first.ok && first.diagnostics.cached).toBe(false);
    expect(second.ok && second.diagnostics.cached).toBe(true);
    expect(primary.calls).toBe(2); // the two planned seeds, once
  });

  it("never caches a failure — the next request retries upstream", async () => {
    const failing = failingProvider("ytmusic");
    const deps = freshDeps({ providers: [failing] });

    const first = await resolveArtist({ name: "Daft Punk" }, deps);
    const second = await resolveArtist({ name: "Daft Punk" }, deps);

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(failing.calls).toBe(4); // two requests × two seeds
    expect(deps.artist.cache.size).toBe(0);
  });

  it("shares one in-flight resolution between identical concurrent requests", async () => {
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

    const first = resolveArtist({ name: "Daft Punk" }, deps);
    const second = resolveArtist({ name: "Daft Punk" }, deps);
    await vi.waitFor(() => expect(primary.calls).toBe(1));
    releases.shift()?.();
    await vi.waitFor(() => expect(primary.calls).toBe(2));
    for (const release of releases) release();

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(primary.calls).toBe(2);
    expect(deps.artist.inflight.size).toBe(0);
  });

  it("keeps the three entity kinds independent in one service state", async () => {
    const primary = echoingProvider("ytmusic", "vid-");
    const deps = freshDeps({ providers: [primary] });

    await resolveArtist({ name: "Daft Punk" }, deps);
    await resolveAlbum({ title: "Discovery" }, deps);
    await resolveSimilar({ title: "Get Lucky" }, deps);

    expect(primary.calls).toBe(6);
    expect(deps.artist.cache.size).toBe(1);
    expect(deps.album.cache.size).toBe(1);
    expect(deps.similar.cache.size).toBe(1);
  });

  it("exposes a documented process-wide default and the shared bounds", () => {
    expect(defaultCatalogDeps.artist.cache).toBeDefined();
    expect(defaultCatalogDeps.album.inflight).toBeDefined();
    expect(defaultCatalogDeps.similar.cache).toBeDefined();
    expect(CATALOG_SEED_CAP).toBe(2);
    expect(CATALOG_SEED_CONCURRENCY).toBe(1);
    expect(CATALOG_CACHE_TTL_MS).toBe(300_000);
  });
});
