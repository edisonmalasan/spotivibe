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
  await repositories.likedTracks.like(likedA);
  await repositories.likedTracks.like(likedB);

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
});
