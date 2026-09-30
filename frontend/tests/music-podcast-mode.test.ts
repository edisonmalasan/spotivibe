import { describe, expect, it, vi } from "vitest";
import { tiersForCategory, toResultTracks } from "@/server/music/chain";
import { searchCacheKey } from "@/server/music/search";
import { resolveCategory, resolveCategoryForRequest } from "@/server/music/normalize";
import { ytwebSearchBody } from "@/server/music/providers/ytweb";
import type { MusicProvider, ProviderCandidate, TierId } from "@/server/music/types";
import { makeCandidate } from "./helpers/music-fixtures";

/**
 * M12 tasks 1.1-1.3 and 2.1: the podcast mode plumbing, one layer at a time.
 *
 * The properties that matter are all "what does this layer do with the mode", so
 * each is tested on its own rather than only through the route: the cache key
 * cannot cross modes, the tier order cannot include a tier that answers with
 * music, the upstream request must actually change, and category resolution must
 * prefer the request's question without moving any music-mode behavior.
 */

/** A fake tier that records the requests it was given. */
function fakeProvider(id: TierId, candidates: ProviderCandidate[] = []) {
  const seen: { category?: string; query: string }[] = [];
  const provider: MusicProvider & { calls: number; seen: typeof seen } = {
    id,
    calls: 0,
    seen,
    async search(request) {
      provider.calls += 1;
      seen.push({ category: request.category, query: request.query });
      return candidates;
    },
  };
  return provider;
}

describe("the search mode reaches the cache key", () => {
  it("separates the two questions so one mode can never be served the other", () => {
    const music = searchCacheKey("history", 20);
    const podcast = searchCacheKey("history", 20, "podcast");

    expect(music).not.toBe(podcast);
    // An absent category is music, so a pre-M12 key and a music key are one key —
    // the cache keeps serving what it already had.
    expect(searchCacheKey("history", 20, undefined)).toBe(music);
    expect(searchCacheKey("history", 20, "music")).toBe(music);
    // Case and surrounding space are normalized exactly as before.
    expect(searchCacheKey("  History  ", 20, "podcast")).toBe(
      searchCacheKey("history", 20, "podcast"),
    );
  });
});

describe("podcast mode queries only tiers that can answer it", () => {
  const tiers: MusicProvider[] = [
    fakeProvider("ytmusic"),
    fakeProvider("ytweb"),
    fakeProvider("invidious"),
    fakeProvider("piped"),
  ];

  it("drops YouTube Music and keeps every fallback", () => {
    expect(tiersForCategory("podcast", tiers).map((tier) => tier.id)).toEqual([
      "ytweb",
      "invidious",
      "piped",
    ]);
  });

  it("leaves the music order untouched", () => {
    expect(tiersForCategory("music", tiers).map((tier) => tier.id)).toEqual([
      "ytmusic",
      "ytweb",
      "invidious",
      "piped",
    ]);
    expect(tiersForCategory("music", tiers)).toBe(tiers);
  });
});

describe("the podcast question changes the upstream request", () => {
  it("keeps the music request byte-identical", () => {
    const body = ytwebSearchBody("history of rome");
    expect(body).toEqual({
      context: expect.objectContaining({ client: expect.objectContaining({ clientName: "WEB" }) }),
      query: "history of rome song",
    });
    // An explicit music mode sends exactly what no mode sends.
    expect(ytwebSearchBody("history of rome", "music")).toEqual(body);
    expect(body).not.toHaveProperty("params");
  });

  it("drops the music suffix and adds the podcast type hint", () => {
    const body = ytwebSearchBody("history of rome", "podcast");
    expect(body.query).toBe("history of rome");
    expect(body.params).toBeTruthy();
    expect(body.params).not.toContain("song");
  });
});

describe("category resolution prefers the question asked", () => {
  it("labels a short spoken-word result as a podcast in podcast mode", () => {
    expect(resolveCategoryForRequest("podcast", { durationSeconds: 360 })).toBe("podcast");
    // Even with no duration at all: the request knows what it asked for.
    expect(resolveCategoryForRequest("podcast", { durationSeconds: undefined })).toBe("podcast");
  });

  it("leaves music-mode resolution exactly as it was", () => {
    // The pre-M12 heuristic still labels long items as podcasts in music mode.
    expect(resolveCategoryForRequest("music", { durationSeconds: 1800 })).toBe("podcast");
    expect(resolveCategoryForRequest("music", { durationSeconds: 240 })).toBe("music");
    expect(resolveCategory(undefined, 1800)).toBe("podcast");
    expect(resolveCategory(undefined, 240)).toBe("music");
  });

  it("lets an explicit provider hint win in both modes", () => {
    // The provider knows more than either the request or the duration guess.
    expect(
      resolveCategoryForRequest("podcast", { categoryHint: "music", durationSeconds: 360 }),
    ).toBe("music");
    expect(
      resolveCategoryForRequest("music", { categoryHint: "podcast", durationSeconds: 240 }),
    ).toBe("podcast");
  });
});

describe("the shared pipeline applies the mode's rules", () => {
  it("keeps a spoken-word title a podcast search would reject as music", () => {
    // 900s is under the music heuristic's podcast threshold, so in music mode this
    // candidate really is music — and music results drop it on the "interview"
    // marker. The same candidate asked about as podcasts survives: the marker is a
    // music rule, and the duration clears the podcast floor (decision 4).
    const candidate = makeCandidate({
      videoId: "ep1",
      title: "Interview: The Fall of Rome",
      durationSeconds: 900,
    });

    const asMusic = toResultTracks([candidate], "rome", 10, "music");
    const asPodcast = toResultTracks([candidate], "rome", 10, "podcast");

    expect(asMusic).toHaveLength(0);
    expect(asPodcast).toHaveLength(1);
    expect(asPodcast[0]?.category).toBe("podcast");
  });

  it("defaults to the music pipeline when no mode is passed", () => {
    const candidate = makeCandidate({
      videoId: "ep2",
      title: "Interview: Two",
      durationSeconds: 900,
    });
    expect(toResultTracks([candidate], "two", 10)).toHaveLength(0);
  });

  it("still drops Shorts and podcast promo fragments in podcast mode", () => {
    const shorts = makeCandidate({
      videoId: "s1",
      title: "History Shorts: Rome in 60 seconds",
      durationSeconds: 900,
    });
    const trailer = makeCandidate({
      videoId: "t1",
      title: "The Fall of Rome — Season trailer",
      durationSeconds: 60,
    });

    expect(toResultTracks([shorts], "rome", 10, "podcast")).toHaveLength(0);
    // A 60-second trailer is below the podcast floor and marked as a promo; either
    // rule rejects it. The same title in music mode only meets the music bounds,
    // and 60s clears the music floor — the promo rule is podcast-only.
    expect(toResultTracks([trailer], "rome", 10, "podcast")).toHaveLength(0);
    expect(toResultTracks([trailer], "rome", 10, "music")).toHaveLength(1);
  });
});
describe("the mode reaches each tier it queries", () => {
  it("passes the category through to the provider call", async () => {
    const tier = fakeProvider("ytweb", [makeCandidate({ videoId: "x", durationSeconds: 1200 })]);
    const { runChain } = await import("@/server/music/chain");
    const result = await runChain(
      { query: "news", limit: 5, category: "podcast" },
      { providers: [tier], budgetMs: 1000 },
    );

    expect(result.ok).toBe(true);
    expect(tier.seen).toEqual([{ category: "podcast", query: "news" }]);
  });
});

describe("diagnostics record a tier skipped for category reasons", () => {
  it("names the skipped tier instead of omitting it", async () => {
    const ytmusic = fakeProvider("ytmusic");
    const ytweb = fakeProvider("ytweb");
    const { runChain } = await import("@/server/music/chain");
    // Both tiers answer with nothing usable, so the diagnostics list every tier.
    const result = await runChain(
      { query: "news", limit: 5, category: "podcast" },
      { providers: [ytmusic, ytweb], budgetMs: 1000 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.tiersTried).toEqual([
      { tier: "ytmusic", outcome: "skipped" },
      { tier: "ytweb", outcome: "empty" },
    ]);
    // And the skipped tier was genuinely never contacted.
    expect(ytmusic.calls).toBe(0);
    expect(ytweb.calls).toBe(1);
  });
});

describe("a podcast request never touches a music tier, even on failure", () => {
  it("records the skip before any attempt is made", async () => {
    const { runChain } = await import("@/server/music/chain");
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    const provider: MusicProvider = { id: "ytweb", search: failing };

    const result = await runChain(
      { query: "news", limit: 5, category: "podcast" },
      {
        providers: [{ id: "ytmusic", search: vi.fn() }, provider],
        budgetMs: 1000,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const skipped = result.tiersTried.find((entry) => entry.tier === "ytmusic");
    expect(skipped?.outcome).toBe("skipped");
  });
});
