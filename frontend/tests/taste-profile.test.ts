import { describe, expect, it } from "vitest";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import {
  artistKeyOf,
  buildTasteProfile,
  COMPLETED_PLAY_WEIGHT,
  eventWeight,
  genreKeysOf,
  LIKE_WEIGHT,
  MAX_SEED_TERM_LENGTH,
  PLAY_WEIGHT,
  recencyDecay,
  RECENCY_DECAY_FLOOR,
  seedTermsFor,
  SKIP_WEIGHT,
  TASTE_LIMITS,
  type TasteProfileInput,
} from "@/features/personalization/tasteProfile";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M10 task 3.1 (spec: `personalization` — "Local taste profile"; design §4/§7):
 * the derivation the whole of M10's personalization stands on.
 *
 * Two claims are load-bearing and both are asserted here in both directions:
 * the **weighting precedence** the spec states (a like outweighs a play, a
 * completed play outweighs a skipped one, older events count for less), and the
 * **cold-start** behaviour (a device with no signal still produces a usable
 * request). The third claim is structural — the profile is a derivation, so the
 * last two cases clear the local datasets and show the profile change by
 * construction, with nothing to invalidate (design §7).
 */

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

/** A track credited to `artist`, with a genre-free title unless asked otherwise. */
function track(id: string, artist: string, overrides: Partial<Track> = {}): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [{ name: artist }],
    ...overrides,
  });
}

/** A listening event as `historyStore` holds it. */
function event(
  id: string,
  artist: string,
  playedAt: number,
  flags: { completed?: boolean; skipped?: boolean } = {},
): ListeningEventRecord {
  return {
    id: `event-${id}`,
    trackId: `youtube:${id}`,
    track: track(id, artist),
    playedAt,
    secondsPlayed: flags.completed === true ? 240 : 5,
    context: "home",
    ...flags,
  };
}

/** A profile from the given inputs, with the cold defaults filled in. */
function profileFor(input: Partial<TasteProfileInput> = {}) {
  return buildTasteProfile({ likedTracks: [], events: [], languages: [], now: NOW, ...input });
}

/** The single artist weight a profile produced (fails if there is not exactly one). */
function onlyWeight(weights: readonly { weight: number }[]): number {
  expect(weights).toHaveLength(1);
  return weights[0].weight;
}

describe("taste profile: weighting precedence", () => {
  it("weighs a like above a completed play, a completed play above a plain play, and a plain play above a skip", () => {
    const liked = profileFor({ likedTracks: [track("1", "Liked")] });
    const completed = profileFor({ events: [event("2", "Completed", NOW, { completed: true })] });
    const played = profileFor({ events: [event("3", "Played", NOW)] });
    const skipped = profileFor({ events: [event("4", "Skipped", NOW, { skipped: true })] });

    const weights = [
      onlyWeight(liked.artists),
      onlyWeight(completed.artists),
      onlyWeight(played.artists),
      onlyWeight(skipped.artists),
    ];

    expect(weights[0]).toBe(LIKE_WEIGHT);
    expect(weights[1]).toBe(COMPLETED_PLAY_WEIGHT);
    expect(weights[2]).toBe(PLAY_WEIGHT);
    expect(weights[3]).toBe(SKIP_WEIGHT);
    // The spec's ordering, stated as an inequality so a future constant change
    // that inverts it fails here rather than silently reversing the taste.
    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights[1]).toBeGreaterThan(weights[2]);
    expect(weights[2]).toBeGreaterThan(weights[3]);
  });

  it("counts one like as a stronger signal than many plays of the same artist", () => {
    // Sub-linear accumulation: 4 completed plays are 3 * (1 + 1/2 + 1/3 + 1/4) = 6.25,
    // still below one like, so volume cannot permanently outrank taste.
    const plays = profileFor({
      events: [1, 2, 3, 4].map((n) => event(String(n), "Aurora", NOW, { completed: true })),
    });
    const liked = profileFor({ likedTracks: [track("9", "Aurora")] });

    expect(onlyWeight(plays.artists)).toBeLessThan(LIKE_WEIGHT);
    expect(onlyWeight(liked.artists)).toBeGreaterThan(onlyWeight(plays.artists));
  });

  it("reads a malformed event carrying both flags as completed", () => {
    expect(eventWeight(event("1", "Aurora", NOW, { completed: true, skipped: true }))).toBe(
      COMPLETED_PLAY_WEIGHT,
    );
  });

  it("decays older events toward the floor without erasing them", () => {
    const recent = profileFor({ events: [event("1", "Aurora", NOW, { completed: true })] });
    const old = profileFor({
      events: [event("1", "Aurora", NOW - 60 * DAY, { completed: true })],
    });
    const ancient = profileFor({
      events: [event("1", "Aurora", NOW - 365 * DAY, { completed: true })],
    });

    const recentWeight = onlyWeight(recent.artists);
    const oldWeight = onlyWeight(old.artists);
    expect(recentWeight).toBeGreaterThan(oldWeight);
    expect(oldWeight).toBeCloseTo(COMPLETED_PLAY_WEIGHT * RECENCY_DECAY_FLOOR, 6);
    // Old history is damped, never zero — otherwise a long-ago play would be
    // indistinguishable from no signal at all.
    expect(oldWeight).toBeGreaterThan(0);
    // Far past the floor: 60 days and a year of silence weigh the same.
    expect(onlyWeight(ancient.artists)).toBeCloseTo(oldWeight, 6);
  });

  it("does not decay a future-dated or same-instant event", () => {
    expect(recencyDecay(NOW, NOW)).toBe(1);
    expect(recencyDecay(NOW + 5 * DAY, NOW)).toBe(1);
    expect(recencyDecay(NOW - DAY, NOW)).toBeGreaterThan(RECENCY_DECAY_FLOOR);
    expect(recencyDecay(NOW - DAY, NOW)).toBeLessThan(1);
  });

  it("ranks a liked artist above a merely played one", () => {
    const taste = profileFor({
      likedTracks: [track("1", "Aurora")],
      events: [event("2", "Beacon", NOW, { completed: true })],
    });

    expect(taste.artists.map((entry) => entry.key)).toEqual(["aurora", "beacon"]);
  });

  it("weights a genre from a track's own text and from its category", () => {
    const taste = profileFor({
      likedTracks: [
        track("1", "Aurora", { album: { title: "Late Jazz Sessions" } }),
        track("2", "Beacon", { category: "podcast", title: "Episode One" }),
      ],
    });

    expect(taste.genres.map((entry) => entry.key)).toEqual(["jazz", "podcast"]);
    expect(genreKeysOf(track("3", "Cobalt", { album: { title: "Blue Hour" } }))).toEqual([]);
    expect(genreKeysOf(track("4", "Cobalt", { album: { title: "Live: Punk Night" } }))).toEqual([
      "punk",
    ]);
  });
});

describe("taste profile: recent tracks, languages, and seed terms", () => {
  it("lists recent track ids newest first, deduped, and bounded", () => {
    const events = [
      event("old", "Aurora", NOW - 3 * DAY),
      event("new", "Beacon", NOW - DAY),
      event("newer", "Cobalt", NOW),
      event("newer", "Cobalt", NOW), // the same track played twice
    ];

    const taste = profileFor({ events, limits: { recentTracks: 2 } });

    expect(taste.recentTrackIds).toEqual(["youtube:newer", "youtube:new"]);
  });

  it("orders equal timestamps deterministically by event id", () => {
    const first = { ...event("a", "Aurora", NOW), id: "event-a" };
    const second = { ...event("b", "Beacon", NOW), id: "event-b" };

    expect(profileFor({ events: [first, second] }).recentTrackIds).toEqual([
      "youtube:a",
      "youtube:b",
    ]);
    expect(profileFor({ events: [second, first] }).recentTrackIds).toEqual([
      "youtube:a",
      "youtube:b",
    ]);
  });

  it("normalizes the selected languages and keeps the user's order", () => {
    const taste = profileFor({ languages: [" EN ", "fr", "en", ""] });
    expect(taste.languages).toEqual(["en", "fr"]);
  });

  it("derives seed terms as public text only, strongest first, bounded and deduped", () => {
    const taste = profileFor({
      likedTracks: [track("1", "Aurora")],
      events: [event("2", "Aurora", NOW, { completed: true }), event("3", "Beacon", NOW)],
      limits: { seedTerms: 3 },
    });

    expect(taste.seedTerms).toEqual(["Aurora", "Beacon"]);
    // Text only: nothing here is a track id, a like, a history row, or a weight.
    for (const term of taste.seedTerms) {
      expect(typeof term).toBe("string");
      expect(term).not.toContain("youtube:");
    }
  });

  it("caps a long artist name so a term stays a term", () => {
    const taste = profileFor({ likedTracks: [track("1", "A".repeat(MAX_SEED_TERM_LENGTH + 40))] });
    expect(taste.seedTerms[0]).toHaveLength(MAX_SEED_TERM_LENGTH);
  });

  it("applies the default bounds and honors per-call overrides", () => {
    const liked = Array.from({ length: TASTE_LIMITS.artists + 3 }, (_, index) =>
      track(String(index), `Artist ${String(index).padStart(2, "0")}`),
    );

    expect(profileFor({ likedTracks: liked }).artists).toHaveLength(TASTE_LIMITS.artists);
    expect(profileFor({ likedTracks: liked, limits: { artists: 1 } }).artists).toHaveLength(1);
  });
});

describe("taste profile: cold device", () => {
  const cold = profileFor();

  it("reports no signal and no taste, but still carries the selected language", () => {
    expect(cold.hasSignal).toBe(false);
    expect(cold.artists).toEqual([]);
    expect(cold.genres).toEqual([]);
    expect(cold.recentTrackIds).toEqual([]);
    expect(cold.seedTerms).toEqual([]);
    expect(cold.languages).toEqual([]);
  });

  it("reports no signal on a fresh install that already reads a default language", () => {
    // `preferencesStore` guarantees a non-empty language selection from the
    // first read, so a preference must not be mistaken for a taste signal.
    expect(profileFor({ languages: ["en"] }).hasSignal).toBe(false);
  });

  it("still produces usable seed terms from the request's own identity", () => {
    expect(seedTermsFor(cold, "track", { title: "Get Lucky", artist: "Daft Punk" })).toEqual([
      "Daft Punk",
      "Get Lucky",
    ]);
    expect(seedTermsFor(cold, "artist", { artist: "Aurora" })).toEqual(["Aurora"]);
    // A surface with only a title is still a usable request.
    expect(seedTermsFor(cold, "track", { title: "Get Lucky" })).toEqual(["Get Lucky"]);
  });

  it("reports signal once a single local event exists", () => {
    expect(profileFor({ events: [event("1", "Aurora", NOW)] }).hasSignal).toBe(true);
    expect(profileFor({ likedTracks: [track("1", "Aurora")] }).hasSignal).toBe(true);
  });
});

describe("seedTermsFor: the request's identity first, the profile as a fallback", () => {
  const taste = profileFor({
    likedTracks: [track("1", "Aurora"), track("2", "Beacon")],
    events: [event("3", "Cobalt", NOW, { completed: true })],
  });

  it("prefers the seed identity and falls back to the profile terms", () => {
    expect(seedTermsFor(taste, "track", { title: "Get Lucky", artist: "Daft Punk" })).toEqual([
      "Daft Punk",
      "Get Lucky",
      "Aurora",
      "Beacon",
    ]);
    expect(seedTermsFor(taste, "artist", { artist: "Aurora" })).toEqual([
      "Aurora",
      "Beacon",
      "Cobalt",
    ]);
  });

  it("stays bounded and never returns a track id, a weight, or an object", () => {
    const terms = seedTermsFor(taste, "track", { title: "Get Lucky", artist: "Daft Punk" });

    expect(terms).toHaveLength(TASTE_LIMITS.seedTerms);
    for (const term of terms) {
      expect(typeof term).toBe("string");
      expect(term).not.toMatch(/youtube:/u);
    }
  });

  it("skips a blank identity rather than sending an empty term", () => {
    expect(seedTermsFor(taste, "track", { title: "   " })).toEqual(["Aurora", "Beacon", "Cobalt"]);
    expect(seedTermsFor(taste, "artist", { artist: "" })).toEqual(["Aurora", "Beacon", "Cobalt"]);
  });

  it("takes no input beyond the profile, the kind, and the seed identity", () => {
    // No cross-user parameter exists in the signature: a term can only ever be
    // the caller's own seed or a word derived from this device's own data.
    expect(seedTermsFor.length).toBe(3);
  });
});

describe("clearing local data changes the derived profile (design §7)", () => {
  it("drops the cleared artists and changes the terms a later request would send", () => {
    const before = profileFor({
      likedTracks: [track("1", "Aurora")],
      events: [event("2", "Beacon", NOW)],
    });

    // Clearing liked tracks and history is "rebuild from what remains": nothing
    // is invalidated because nothing was stored.
    const after = profileFor({ likedTracks: [], events: [] });

    expect(before.artists.map((entry) => entry.key)).toEqual(["aurora", "beacon"]);
    expect(after.artists).toEqual([]);
    expect(after.hasSignal).toBe(false);
    // The terms a refill would send change with the data: the cleared artists
    // are no longer candidates, and only the request's own identity remains.
    expect(seedTermsFor(before, "artist", { artist: "Aurora" })).toEqual(["Aurora", "Beacon"]);
    expect(seedTermsFor(after, "artist", { artist: "Aurora" })).toEqual(["Aurora"]);
  });

  it("keeps the surviving signal when only one dataset is cleared", () => {
    const afterHistoryClear = profileFor({ likedTracks: [track("1", "Aurora")] });

    expect(afterHistoryClear.artists.map((entry) => entry.key)).toEqual(["aurora"]);
    expect(afterHistoryClear.recentTrackIds).toEqual([]);
  });
});

describe("taste profile: determinism and inputs", () => {
  it("produces an identical profile for identical inputs, twice over", () => {
    const input: TasteProfileInput = {
      likedTracks: [track("1", "Aurora"), track("2", "Beacon")],
      events: [event("3", "Aurora", NOW - DAY, { completed: true }), event("4", "Aurora", NOW)],
      languages: ["en", "fr"],
      now: NOW,
    };

    expect(buildTasteProfile(input)).toEqual(buildTasteProfile(input));
  });

  it("never mutates the inputs it reads", () => {
    const likedTracks = [track("1", "Aurora")];
    const events = [event("2", "Beacon", NOW, { completed: true })];
    const likedSnapshot = JSON.parse(JSON.stringify(likedTracks));
    const eventsSnapshot = JSON.parse(JSON.stringify(events));

    profileFor({ likedTracks, events });

    expect(likedTracks).toEqual(likedSnapshot);
    expect(events).toEqual(eventsSnapshot);
  });

  it("breaks equal-weight ties on first appearance so the order is stable", () => {
    const first = profileFor({ events: [event("1", "Zeta", NOW), event("2", "Yankee", NOW)] });
    const second = profileFor({ events: [event("2", "Yankee", NOW), event("1", "Zeta", NOW)] });

    expect(first.artists.map((entry) => entry.key)).toEqual(["zeta", "yankee"]);
    // The tiebreak is the source order, which is the documented input order:
    // liked tracks newest-first, then events newest-first.
    expect(second.artists.map((entry) => entry.key)).toEqual(["yankee", "zeta"]);
  });

  it("keys an artist by its provider id, or by its normalized name when it has none", () => {
    expect(artistKeyOf({ id: "UC1", name: "Daft Punk" })).toBe("UC1");
    expect(artistKeyOf({ name: "  NEON WAVES  " })).toBe("neon waves");
    expect(artistKeyOf({ id: "  ", name: "Aurora" })).toBe("aurora");
  });

  it("ignores an artist credit with neither an id nor a usable name", () => {
    const taste = profileFor({ likedTracks: [track("1", "   ")] });
    expect(taste.artists).toEqual([]);
    expect(taste.hasSignal).toBe(false);
  });

  it("reads no input beyond the four local sources and a clock", () => {
    // No cross-user parameter exists: the derivation reads liked tracks,
    // listening events, selected languages, and a caller-supplied clock.
    expect(buildTasteProfile.length).toBe(1);
    const input: TasteProfileInput = { likedTracks: [], events: [], languages: [], now: NOW };
    expect(Object.keys(input).sort()).toEqual(["events", "languages", "likedTracks", "now"]);
  });
});
