import { describe, expect, it } from "vitest";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import {
  countLocalArtists,
  deriveSeedTerms,
  MAX_SEED_TERMS,
  MAX_TERM_LENGTH,
  recentlyPlayedTracks,
  RECENT_LIMIT,
} from "@/features/home/localSeeds";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M8 task 6.3 (spec: `discovery` — "Local-only personalization inputs" and
 * "Recently played and local listening signals"): what local taste may become
 * before it is allowed near a request.
 *
 * The whole point of this module is what it *cannot* return — a track object, a
 * track id, a like, or a history row — so the cases below assert both the
 * ranking and the shape of the payload.
 */

/** A liked track by `artist` (id-less, so identity falls back to the name). */
function liked(artist: string, id: string): Track {
  return makeTrack({ id, providerId: id, title: `Song ${id}`, artists: [{ name: artist }] });
}

/** A listening event for `artist`'s track, as the history store would hold it. */
function play(artist: string, id: string, playedAt: number): ListeningEventRecord {
  const track = makeTrack({ id, providerId: id, title: `Song ${id}`, artists: [{ name: artist }] });
  return {
    id: `event-${id}-${playedAt}`,
    trackId: id,
    track,
    playedAt,
    secondsPlayed: 0,
    context: "home",
  };
}

describe("deriveSeedTerms: ranking", () => {
  it("ranks an artist by likes plus plays, strongest first", () => {
    const terms = deriveSeedTerms({
      likedTracks: [liked("Alpha", "1"), liked("Beta", "2")],
      events: [play("Alpha", "3", 30), play("Alpha", "4", 20), play("Beta", "5", 10)],
    });

    // Alpha: 1 like + 2 plays = 3. Beta: 1 like + 1 play = 2.
    expect(terms).toEqual(["Alpha", "Beta"]);
  });

  it("breaks ties on first appearance so the order is deterministic", () => {
    const taste = {
      likedTracks: [liked("Zeta", "1"), liked("Yankee", "2")],
      events: [play("Zeta", "3", 30), play("Yankee", "4", 20)],
    };

    expect(deriveSeedTerms(taste)).toEqual(["Zeta", "Yankee"]);
    // Same inputs, same order — twice over.
    expect(deriveSeedTerms(taste)).toEqual(deriveSeedTerms(taste));
  });

  it("returns nothing when there is no local signal at all", () => {
    expect(deriveSeedTerms({ likedTracks: [], events: [] })).toEqual([]);
  });

  it("counts plays even when nothing is liked", () => {
    const terms = deriveSeedTerms({
      likedTracks: [],
      events: [play("Solo", "1", 10), play("Solo", "2", 20)],
    });
    expect(terms).toEqual(["Solo"]);
  });
});

describe("deriveSeedTerms: dedupe, caps, and payload shape", () => {
  it("dedupes one artist appearing across many likes and plays", () => {
    const terms = deriveSeedTerms({
      likedTracks: [liked("Radiohead", "1"), liked("Radiohead", "2")],
      events: [play("Radiohead", "3", 30), play("Radiohead", "4", 20)],
    });

    expect(terms).toEqual(["Radiohead"]);
  });

  it("dedupes artist names case-insensitively and on surrounding whitespace", () => {
    const terms = deriveSeedTerms({
      likedTracks: [liked("Daft Punk", "1")],
      events: [
        play("  daft punk  ", "2", 30),
        play("DAFT PUNK", "3", 20),
        play("Daft Punk", "4", 10),
      ],
    });

    expect(terms).toHaveLength(1);
    expect(terms[0]?.trim().toLowerCase()).toBe("daft punk");
  });

  it("keeps two genuinely different artists that share a prefix", () => {
    const terms = deriveSeedTerms({
      likedTracks: [liked("Bach", "1"), liked("Bachauer", "2")],
      events: [],
    });

    expect(terms).toEqual(["Bach", "Bachauer"]);
  });

  it("caps the list at the endpoint's own seed bound", () => {
    const likedTracks = Array.from({ length: 20 }, (_v, index) =>
      liked(`Artist ${index}`, `id-${index}`),
    );

    const terms = deriveSeedTerms({ likedTracks, events: [] });

    expect(MAX_SEED_TERMS).toBe(8);
    expect(terms).toHaveLength(MAX_SEED_TERMS);
  });

  it("caps each term at the endpoint's length bound and trims it", () => {
    const longName = `  ${"x".repeat(200)}  `;
    const terms = deriveSeedTerms({ likedTracks: [liked(longName, "1")], events: [] });

    expect(MAX_TERM_LENGTH).toBe(80);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toHaveLength(MAX_TERM_LENGTH);
    expect(terms[0]).toBe(terms[0]?.trim());
  });

  it("skips a blank artist name rather than sending an empty term", () => {
    const terms = deriveSeedTerms({
      likedTracks: [liked("   ", "1"), makeTrack({ id: "2", artists: [] })],
      events: [play("Real", "3", 10)],
    });

    expect(terms).toEqual(["Real"]);
  });

  it("carries artist names only — never a track, id, title, or count", () => {
    const terms = deriveSeedTerms({
      likedTracks: [liked("Alpha", "youtube:secret-video-id")],
      events: [play("Alpha", "youtube:other-id", 10)],
    });

    expect(terms).toEqual(["Alpha"]);
    const serialized = JSON.stringify(terms);
    expect(serialized).not.toContain("youtube:");
    expect(serialized).not.toContain("secret-video-id");
    expect(serialized).not.toContain("Song ");
    expect(serialized).not.toContain("context");
  });

  it("never mutates its inputs", () => {
    const likedTracks = [liked("Alpha", "1"), liked("Beta", "2")];
    const events = [play("Alpha", "3", 10)];
    const likedSnapshot = likedTracks.map((track) => track.id);
    const eventSnapshot = events.map((event) => event.id);

    deriveSeedTerms({ likedTracks, events });

    expect(likedTracks.map((track) => track.id)).toEqual(likedSnapshot);
    expect(events.map((event) => event.id)).toEqual(eventSnapshot);
  });
});

describe("countLocalArtists: the Smart Mixes gate", () => {
  it("counts distinct artists across likes and plays", () => {
    expect(
      countLocalArtists({
        likedTracks: [liked("Alpha", "1"), liked("Alpha", "2")],
        events: [play("Beta", "3", 10), play("Alpha", "4", 5)],
      }),
    ).toBe(2);
  });

  it("is zero for a fresh device", () => {
    expect(countLocalArtists({ likedTracks: [], events: [] })).toBe(0);
  });

  it("ignores tracks with no artist metadata", () => {
    expect(
      countLocalArtists({
        likedTracks: [makeTrack({ id: "1", artists: [] })],
        events: [],
      }),
    ).toBe(0);
  });
});

describe("recentlyPlayedTracks: newest-first, deduped, capped", () => {
  it("keeps the newest play of a repeated track and drops the older ones", () => {
    const events = [play("Alpha", "a", 300), play("Beta", "b", 200), play("Alpha", "a", 100)];

    expect(recentlyPlayedTracks(events).map((track) => track.id)).toEqual(["a", "b"]);
  });

  it("preserves the store's newest-first order for distinct tracks", () => {
    const events = [play("A", "a", 300), play("B", "b", 200), play("C", "c", 100)];

    expect(recentlyPlayedTracks(events).map((track) => track.id)).toEqual(["a", "b", "c"]);
  });

  it("caps the list at the shelf's card budget", () => {
    const events = Array.from({ length: 30 }, (_v, index) =>
      play(`Artist ${index}`, `id-${index}`, 1_000 - index),
    );

    expect(RECENT_LIMIT).toBe(10);
    expect(recentlyPlayedTracks(events)).toHaveLength(RECENT_LIMIT);
  });

  it("honors an explicit limit and returns nothing for no events", () => {
    const events = [play("A", "a", 2), play("B", "b", 1)];

    expect(recentlyPlayedTracks(events, 1).map((track) => track.id)).toEqual(["a"]);
    expect(recentlyPlayedTracks([], 10)).toEqual([]);
  });
});
