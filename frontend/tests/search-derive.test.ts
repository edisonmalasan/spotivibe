import { describe, expect, it } from "vitest";
import { deriveResults } from "@/features/search/derive";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Pure derivation coverage (design decision §1 / spec "Result sections from
 * canonical metadata"): everything is computed from the canonical Track
 * contract, in relevance order, with deterministic Top Result selection.
 */

const getLucky = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Get Lucky",
  artists: [{ name: "Daft Punk" }],
  album: { title: "Discovery" },
});
const instantCrush = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Instant Crush",
  artists: [{ name: "Daft Punk" }],
  album: { title: "Random Access Memories" },
});
const oneMoreTime = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "One More Time",
  artists: [{ name: "Daft Punk" }],
  album: { title: "Discovery" },
});

describe("deriveResults — songs (task 3.1)", () => {
  it("collapses duplicates by id and providerId with the first occurrence winning", () => {
    const repeatedId = makeTrack({ id: "youtube:aaa", providerId: "zzz", title: "Get Lucky" });
    const repeatedProvider = makeTrack({ id: "youtube:qqq", providerId: "bbb", title: "Other" });

    const { songs } = deriveResults([getLucky, instantCrush, repeatedId, repeatedProvider], "x");

    expect(songs.map((track) => track.id)).toEqual(["youtube:aaa", "youtube:bbb"]);
  });

  it("preserves API relevance order", () => {
    const { songs } = deriveResults([oneMoreTime, getLucky, instantCrush], "x");
    expect(songs.map((track) => track.title)).toEqual([
      "One More Time",
      "Get Lucky",
      "Instant Crush",
    ]);
  });
});

describe("deriveResults — artists and albums (task 3.1)", () => {
  it("emits one artist entry per normalized name, first occurrence winning", () => {
    const cased = makeTrack({
      id: "youtube:ddd",
      providerId: "ddd",
      artists: [{ name: " daft punk " }],
    });
    const unnamed = makeTrack({ id: "youtube:eee", providerId: "eee", artists: [] });

    const { artists } = deriveResults([getLucky, cased, unnamed, instantCrush], "x");

    expect(artists).toHaveLength(1);
    expect(artists[0].name).toBe("Daft Punk");
    expect(artists[0].track.id).toBe("youtube:aaa"); // representative = first result
  });

  it("emits one album entry per title + primary artist identity", () => {
    const { albums } = deriveResults([getLucky, oneMoreTime, instantCrush], "x");

    expect(albums.map((album) => album.title)).toEqual(["Discovery", "Random Access Memories"]);
    expect(albums[0].artistName).toBe("Daft Punk");
  });

  it("keeps same-titled albums by different primary artists separate", () => {
    const otherArtist = makeTrack({
      id: "youtube:fff",
      providerId: "fff",
      title: "Homework",
      artists: [{ name: "Air" }],
      album: { title: "Discovery" },
    });

    const { albums } = deriveResults([getLucky, otherArtist], "x");

    expect(albums).toHaveLength(2);
    expect(albums.map((album) => album.artistName)).toEqual(["Daft Punk", "Air"]);
  });

  it("emits no album entry where album metadata does not resolve", () => {
    const bare = makeTrack({
      id: "youtube:ggg",
      providerId: "ggg",
      title: "Untitled",
      album: undefined,
    });

    const { albums, artists } = deriveResults([bare, getLucky], "x");

    expect(albums.map((album) => album.title)).toEqual(["Discovery"]);
    expect(artists.map((artist) => artist.name)).toEqual(["Daft Punk"]); // artists still resolve
  });
});

describe("deriveResults — exact-match Top Result rule (task 3.2)", () => {
  it("prefers an exact artist match over album and track matches", () => {
    const sameName = makeTrack({
      id: "youtube:hhh",
      providerId: "hhh",
      title: "Daft Punk",
      artists: [{ name: "Daft Punk" }],
      album: { title: "Daft Punk" },
    });

    const { topResult } = deriveResults([sameName], " daft punk ");

    expect(topResult).toEqual({
      kind: "artist",
      artist: expect.objectContaining({ name: "Daft Punk" }),
    });
  });

  it("falls back to an exact album match when no artist matches", () => {
    const { topResult } = deriveResults([getLucky, instantCrush], "discovery");

    expect(topResult?.kind).toBe("album");
    expect(topResult?.kind === "album" && topResult.album.title).toBe("Discovery");
  });

  it("falls back to the #1 track title when neither artist nor album matches", () => {
    const { topResult } = deriveResults([oneMoreTime, getLucky], "one more time");
    expect(topResult?.kind).toBe("track");
  });

  it("returns no Top Result when only a lower-ranked track title matches", () => {
    const { topResult } = deriveResults([oneMoreTime, getLucky], "get lucky");
    expect(topResult).toBeNull();
  });

  it("returns no Top Result for partial (non-exact) matches", () => {
    expect(deriveResults([getLucky], "daft").topResult).toBeNull();
    expect(deriveResults([getLucky], "discover").topResult).toBeNull();
    expect(deriveResults([getLucky], "get lucky!!").topResult).toBeNull();
  });

  it("returns no Top Result for an empty query", () => {
    expect(deriveResults([getLucky], "   ").topResult).toBeNull();
  });

  it("never removes the Top Result item from Songs", () => {
    const { songs, topResult } = deriveResults([getLucky, instantCrush], "Get Lucky");

    expect(topResult?.kind).toBe("track");
    expect(songs.map((track) => track.title)).toEqual(["Get Lucky", "Instant Crush"]);
  });
});
