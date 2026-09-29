import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData } from "@/data/localData";
import {
  buildMixProfile,
  generateMix,
  mixIdentityKey,
  refreshMix,
  MIX_MAX_ROUNDS,
  MIX_TARGET_TRACKS,
} from "@/features/mixes/generateMix";
import { buildTasteProfile, type TasteProfile } from "@/features/personalization/tasteProfile";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M11 task 3.4/3.5: how a mix is built, and what a refresh may and may not do.
 *
 * The contract under test (spec `mixes` — "Smart Mix generation", "Refreshing a
 * mix"): a mix is composed from the feed the product already has, bounded; no
 * local taste signal means no mix at all; and a refresh keeps the **identity and
 * the name** the listener learned, re-deriving only the contents.
 */

const NOW = 1_700_000_000_000;

function feedOf(count: number, offset = 0) {
  return Array.from({ length: count }, (_unused, index) =>
    makeTrack({
      id: `youtube:feed${offset + index}`,
      providerId: `feed${offset + index}`,
      title: `Feed Song ${offset + index}`,
      artists: [{ name: "Aurora" }],
    }),
  );
}

function feedResponse(tracks: ReturnType<typeof feedOf>) {
  return {
    tracks,
    diagnostics: { tier: "ytmusic", attempts: [] },
  } as unknown as Awaited<
    ReturnType<typeof import("@/features/home/discoveryApi").fetchDiscoveryFeed>
  >;
}

/** A profile with a real taste signal, so `hasSignal` is true. */
function signaledProfile(): TasteProfile {
  return buildTasteProfile({
    likedTracks: [makeTrack({ id: "youtube:liked1", providerId: "liked1", title: "Liked" })],
    events: [],
    languages: ["en"],
    now: NOW,
  });
}

function coldProfile(): TasteProfile {
  return buildTasteProfile({ likedTracks: [], events: [], languages: ["en"], now: NOW });
}

beforeEach(async () => {
  // Every test starts from an empty local dataset: generation excludes recently
  // played tracks, so a history event left by a previous test would silently
  // shrink the mix built here.
  const data = await getLocalData();
  await data.mixes.clear();
  await data.listeningHistory.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateMix: a mix is built from the profile, within bounds", () => {
  it("stores a named mix whose seeds are the profile's own terms", async () => {
    const fetchFeed = vi.fn().mockResolvedValue(feedResponse(feedOf(6)));
    const outcome = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed,
    });

    expect(outcome.status).toBe("created");
    if (outcome.status !== "created") return;
    expect(outcome.mix.name).not.toBe("");
    expect(outcome.mix.tracks).toHaveLength(6);
    expect(outcome.mix.seeds.length).toBeGreaterThan(0);
    // The name must be derived from the mix's own contents, and every track here
    // is by one artist — so the name is that artist.
    expect(outcome.mix.name).toBe("Aurora");

    // Persisted, not just returned: a mix has to survive a reload.
    const stored = await (await getLocalData()).mixes.list();
    expect(stored.map((mix) => mix.id)).toContain(outcome.mix.id);
  });

  it("requests only the composable mix feed, capped, never a new capability", async () => {
    const fetchFeed = vi.fn().mockResolvedValue(feedResponse(feedOf(20)));
    await generateMix({
      profile: signaledProfile(),
      languages: ["en", "es"],
      now: NOW,
      maxRounds: 1,
      fetchFeed,
    });

    expect(fetchFeed).toHaveBeenCalledTimes(1);
    const request = fetchFeed.mock.calls[0][0];
    expect(request.kind).toBe("mix");
    expect(request.languages).toEqual(["en", "es"]);
    expect(request.limit).toBeLessThanOrEqual(20);
  });

  it("spends at most the bounded number of rounds", async () => {
    const fetchFeed = vi.fn().mockResolvedValue(feedResponse(feedOf(3)));
    await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      maxRounds: MIX_MAX_ROUNDS,
      fetchFeed,
    });
    // The first round already reached the target, so no further round is spent.
    expect(fetchFeed.mock.calls.length).toBeLessThanOrEqual(MIX_MAX_ROUNDS);
    expect(fetchFeed.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("stops early when a round adds nothing new", async () => {
    // The same page every round: the first round collects it, and the second
    // proves a retry cannot add anything, so the remaining round is never spent.
    const fetchFeed = vi.fn().mockResolvedValue(feedResponse(feedOf(2)));
    const outcome = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed,
    });
    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(fetchFeed.mock.calls.length).toBeLessThan(MIX_MAX_ROUNDS);
    expect(outcome.status).toBe("created");
  });

  it("never repeats a track across rounds and caps the mix at the target size", async () => {
    const fetchFeed = vi
      .fn()
      .mockResolvedValueOnce(feedResponse(feedOf(MIX_TARGET_TRACKS, 0)))
      .mockResolvedValue(feedResponse(feedOf(5, 0)));
    const outcome = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed,
    });
    if (outcome.status !== "created") throw new Error("expected a created mix");
    const ids = outcome.mix.tracks.map((track) => track.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(MIX_TARGET_TRACKS);
  });

  it("builds no mix at all without a local taste signal", async () => {
    const fetchFeed = vi.fn().mockResolvedValue(feedResponse(feedOf(10)));
    const outcome = await generateMix({
      profile: coldProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed,
    });
    // Decision 5: no signal, no mix — and no provider spend either.
    expect(outcome.status).toBe("no-signal");
    expect(fetchFeed).not.toHaveBeenCalled();
    expect(await (await getLocalData()).mixes.list()).toEqual([]);
  });

  it("reports an empty feed as empty, not as a failure", async () => {
    const fetchFeed = vi.fn().mockResolvedValue(feedResponse([]));
    const outcome = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed,
    });
    expect(outcome.status).toBe("empty");
  });

  it("reports a provider failure as unavailable and stores nothing", async () => {
    const fetchFeed = vi.fn().mockRejectedValue(new Error("upstream is down"));
    const outcome = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed,
    });
    expect(outcome.status).toBe("unavailable");
    expect(await (await getLocalData()).mixes.list()).toEqual([]);
  });

  it("keeps what it already collected when a later round fails", async () => {
    const fetchFeed = vi
      .fn()
      .mockResolvedValueOnce(feedResponse(feedOf(4)))
      .mockRejectedValue(new Error("upstream is down"));
    const outcome = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed,
    });
    if (outcome.status !== "created") throw new Error("expected the partial mix to survive");
    expect(outcome.mix.tracks).toHaveLength(4);
  });

  it("excludes tracks played in the last day", async () => {
    const data = await getLocalData();
    await data.listeningHistory.record({
      trackId: "youtube:feed0",
      track: feedOf(1)[0],
      playedAt: NOW - 60_000,
      secondsPlayed: 200,
      completed: true,
      context: "home",
    });
    const fetchFeed = vi.fn().mockResolvedValue(feedResponse(feedOf(4)));
    const outcome = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed,
    });
    if (outcome.status !== "created") throw new Error("expected a created mix");
    expect(outcome.mix.tracks.map((track) => track.providerId)).not.toContain("feed0");
    expect(outcome.mix.tracks).toHaveLength(3);
  });
});

describe("refreshMix: same identity, same name, new contents", () => {
  it("keeps the id and name while replacing the tracks", async () => {
    const first = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed: vi.fn().mockResolvedValue(feedResponse(feedOf(4))),
    });
    if (first.status !== "created") throw new Error("expected a created mix");

    const replacement = await refreshMix(first.mix, {
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW + 1000,
      fetchFeed: vi.fn().mockResolvedValue(feedResponse(feedOf(4, 100))),
    });

    expect(replacement?.id).toBe(first.mix.id);
    expect(replacement?.name).toBe(first.mix.name);
    expect(replacement?.tracks[0]?.providerId).toBe("feed100");

    const stored = await (await getLocalData()).mixes.get(first.mix.id);
    expect(stored?.tracks[0]?.providerId).toBe("feed100");
    // One record, not two: a refresh must never duplicate the mix.
    expect(await (await getLocalData()).mixes.list()).toHaveLength(1);
  });

  it("leaves the mix untouched when the refresh finds nothing new", async () => {
    const first = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed: vi.fn().mockResolvedValue(feedResponse(feedOf(4))),
    });
    if (first.status !== "created") throw new Error("expected a created mix");

    const unchanged = await refreshMix(first.mix, {
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW + 1000,
      // Every track is already in the mix, so the exclusion leaves nothing.
      fetchFeed: vi.fn().mockResolvedValue(feedResponse(feedOf(4))),
    });

    expect(unchanged).toBeUndefined();
    const stored = await (await getLocalData()).mixes.get(first.mix.id);
    expect(stored?.tracks).toHaveLength(4);
  });

  it("does not recreate a mix that no longer exists, and spends no provider work", async () => {
    const first = await generateMix({
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW,
      fetchFeed: vi.fn().mockResolvedValue(feedResponse(feedOf(4))),
    });
    if (first.status !== "created") throw new Error("expected a created mix");
    await (await getLocalData()).mixes.remove(first.mix.id);

    const fetchFeed = vi.fn().mockResolvedValue(feedResponse(feedOf(4, 100)));
    const result = await refreshMix(first.mix, {
      profile: signaledProfile(),
      languages: ["en"],
      now: NOW + 1000,
      fetchFeed,
    });

    expect(result).toBeUndefined();
    expect(await (await getLocalData()).mixes.list()).toEqual([]);
    // A stale surface holding a deleted mix must not resurrect it — and the
    // check happens before any provider request, not after.
    expect(fetchFeed).not.toHaveBeenCalled();
  });
});

describe("mixIdentityKey", () => {
  it("is stable for the same seeds and period, and case/space insensitive", () => {
    const first = mixIdentityKey(["Aurora", "Jazz"], "2026-09-30");
    expect(mixIdentityKey([" aurora ", "JAZZ"], "2026-09-30")).toBe(first);
    expect(mixIdentityKey(["Aurora", "Jazz"], "2026-10-01")).not.toBe(first);
  });

  it("ignores empty seed entries rather than making every mix distinct", () => {
    expect(mixIdentityKey(["Aurora", "  "], "2026-09-30")).toBe(
      mixIdentityKey(["Aurora"], "2026-09-30"),
    );
  });
});

describe("buildMixProfile", () => {
  it("derives the profile from local datasets, with no signal on a cold device", async () => {
    const data = await getLocalData();
    await data.listeningHistory.clear();
    await data.likedTracks.clear();

    const cold = await buildMixProfile(NOW);
    expect(cold?.hasSignal).toBe(false);

    await data.likedTracks.like(
      makeTrack({ id: "youtube:liked9", providerId: "liked9", title: "Liked" }),
      NOW,
    );
    const warm = await buildMixProfile(NOW);
    expect(warm?.hasSignal).toBe(true);
    expect(warm?.seedTerms.length).toBeGreaterThan(0);
  });
});
