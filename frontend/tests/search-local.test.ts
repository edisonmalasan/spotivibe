import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { loadLocalLibrary, searchLocalLibrary } from "@/features/search/localSearch";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Task 7.1 (design §6): the local fallback searches liked tracks, playlist
 * tracks, and a bounded slice of listening history — deduplicated by track id
 * with first-source-wins order — using a case-insensitive title/artist
 * substring match.
 */

const likedA = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Karma Police",
  artists: [{ name: "Radiohead" }],
});
const likedB = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Weird Fishes",
  artists: [{ name: "Radiohead" }],
});
const playlistTrack = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "Get Lucky",
  artists: [{ name: "Daft Punk" }],
});
const historyTrack = makeTrack({
  id: "youtube:ddd",
  providerId: "ddd",
  title: "Blue Monday",
  artists: [{ name: "New Order" }],
});

let repositories: RepositorySet;

beforeEach(async () => {
  repositories = await getLocalData();
  await repositories.resetAll();
});

/** Seed every local source, deliberately overlapping the same track ids. */
async function seedLibrary(): Promise<void> {
  // Explicit likedAt values: likedTracks.list() is newest-first, and two
  // quick likes can share a Date.now() millisecond — the stable sort would
  // then fall back to key order and flip the expected sequence.
  await repositories.likedTracks.like(likedA, 2_000);
  await repositories.likedTracks.like(likedB, 1_000);

  const playlist = await repositories.playlists.create({ name: "Mix" });
  await repositories.playlists.addTrack(playlist.id, likedA); // already liked
  await repositories.playlists.addTrack(playlist.id, playlistTrack);

  // The same track played twice plus two already-seen tracks: none may leak
  // duplicates into the flattened library.
  for (const track of [likedA, playlistTrack, historyTrack, historyTrack]) {
    await repositories.listeningHistory.record({
      trackId: track.id,
      track,
      playedAt: Date.now(),
      secondsPlayed: 30,
      context: "search",
    });
  }
}

describe("loadLocalLibrary (task 7.1)", () => {
  it("flattens liked, playlist, and history tracks deduped by id in source order", async () => {
    await seedLibrary();

    const library = await loadLocalLibrary();

    expect(library.tracks.map((track) => track.id)).toEqual([
      "youtube:aaa", // liked first
      "youtube:bbb",
      "youtube:ccc", // playlist contribution (likedA was already present)
      "youtube:ddd", // history contribution only
    ]);
    expect(new Set(library.tracks.map((track) => track.id)).size).toBe(library.tracks.length);
  });

  it("returns an empty library when no local source holds any track", async () => {
    const library = await loadLocalLibrary();
    expect(library.tracks).toEqual([]);
  });
});

describe("searchLocalLibrary (task 7.1)", () => {
  it("matches a title substring regardless of case", async () => {
    await seedLibrary();
    const library = await loadLocalLibrary();

    expect(searchLocalLibrary(library, "karma police").map((track) => track.id)).toEqual([
      "youtube:aaa",
    ]);
    expect(searchLocalLibrary(library, "KARMA").map((track) => track.id)).toEqual(["youtube:aaa"]);
  });

  it("matches an artist name substring regardless of case", async () => {
    await seedLibrary();
    const library = await loadLocalLibrary();

    expect(searchLocalLibrary(library, "new or").map((track) => track.id)).toEqual(["youtube:ddd"]);
    expect(searchLocalLibrary(library, "DAFT").map((track) => track.id)).toEqual(["youtube:ccc"]);
  });

  it("returns no matches for a non-matching or blank query", async () => {
    await seedLibrary();
    const library = await loadLocalLibrary();

    expect(searchLocalLibrary(library, "zzzz-not-a-track")).toEqual([]);
    expect(searchLocalLibrary(library, "   ")).toEqual([]);
  });

  it("never returns the same track twice when many sources contain it", async () => {
    await seedLibrary();
    const library = await loadLocalLibrary();

    const matches = searchLocalLibrary(library, "radiohead");
    expect(matches.map((track) => track.id)).toEqual(["youtube:aaa", "youtube:bbb"]);
  });

  it("keeps a liked song out of a podcast search (M12)", async () => {
    // The fallback is presented under an **Episodes** heading in podcast mode, so a
    // music match there would be a mislabelled row. The mode narrows the matches,
    // not the matching rule: the same needle, the same sources, podcast records only.
    await seedLibrary();
    await repositories.likedTracks.like(
      makeTrack({
        id: "youtube:eee",
        providerId: "eee",
        title: "Rome: A Podcast",
        artists: [{ name: "History Hour" }],
        category: "podcast",
        durationSeconds: 3600,
      }),
    );
    const library = await loadLocalLibrary();

    // Music mode (the default, and what every pre-M12 caller gets) is unchanged.
    expect(searchLocalLibrary(library, "rome").map((track) => track.id)).toEqual(["youtube:eee"]);
    expect(searchLocalLibrary(library, "rome", "music").map((track) => track.id)).toEqual([
      "youtube:eee",
    ]);
    // Podcast mode returns the episode and nothing else — including a *song* whose
    // title contains the same word, which is what "Karma Police" would be.
    await repositories.likedTracks.like(likedA);
    const withSong = await loadLocalLibrary();
    expect(searchLocalLibrary(withSong, "karma", "podcast").map((track) => track.id)).toEqual([]);
    expect(searchLocalLibrary(withSong, "rome", "podcast").map((track) => track.id)).toEqual([
      "youtube:eee",
    ]);
    // And a query with no podcast match yields nothing, so the surface shows the
    // podcast empty state rather than a music row.
    expect(searchLocalLibrary(withSong, "radiohead", "podcast")).toEqual([]);
  });
});
