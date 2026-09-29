import { describe, expect, it } from "vitest";
import type { Track } from "@/data/repositories";
import { groupArtistsByIdentity } from "@/features/recommendations/artists";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M8 task 5.2: the Popular Artists shelf's derivation (spec: `discovery` —
 * "Popular artists shelf"). The shelf has no artist endpoint to query, so the
 * entries come from the same discovery results: one entry per canonical artist
 * identity, deterministic position, best available artwork.
 */

/** A track credited to `artist` (an id when given, else a name), with artwork. */
function artistTrack(
  id: string,
  artist: { id?: string; name: string },
  artwork: Track["artwork"] = [],
): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title: `Song ${id}`,
    artists: [artist],
    artwork,
  });
}

const daftPunk = { id: "UC1", name: "Daft Punk" };
const neonWaves = { name: "Neon Waves" };

describe("groupArtistsByIdentity: one entry per artist", () => {
  it("lists an artist once and counts every track by them", () => {
    const first = artistTrack("t1", daftPunk);
    const second = artistTrack("t2", daftPunk);
    const other = artistTrack("t3", neonWaves);

    const entries = groupArtistsByIdentity([first, second, other]);

    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("UC1");
    expect(entries[0].name).toBe("Daft Punk");
    expect(entries[0].trackCount).toBe(2);
    expect(entries[0].sampleTrack).toBe(first);
    expect(entries[1].id).toBe("neon waves");
    expect(entries[1].trackCount).toBe(1);
  });

  it("falls back to the normalized artist name when no id is known", () => {
    const entries = groupArtistsByIdentity([
      artistTrack("t1", { name: "Neon Waves" }),
      artistTrack("t2", { name: "  NEON WAVES  " }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("neon waves");
    expect(entries[0].name).toBe("Neon Waves"); // first spelling wins
    expect(entries[0].trackCount).toBe(2);
  });

  it("orders artists by first appearance", () => {
    const entries = groupArtistsByIdentity([
      artistTrack("t1", neonWaves),
      artistTrack("t2", daftPunk),
      artistTrack("t3", neonWaves),
    ]);

    expect(entries.map((entry) => entry.id)).toEqual(["neon waves", "UC1"]);
  });

  it("skips tracks with no artist metadata", () => {
    const anonymous = makeTrack({ id: "youtube:t1", providerId: "t1", artists: [] });
    const blank = artistTrack("t2", { name: "   " });
    const named = artistTrack("t3", neonWaves);

    const entries = groupArtistsByIdentity([anonymous, blank, named]);

    expect(entries.map((entry) => entry.name)).toEqual(["Neon Waves"]);
  });

  it("returns nothing for results with no artists at all", () => {
    expect(groupArtistsByIdentity([makeTrack({ artists: [] })])).toEqual([]);
    expect(groupArtistsByIdentity([])).toEqual([]);
  });
});

describe("groupArtistsByIdentity: artwork selection", () => {
  it("picks the largest cover across an artist's tracks", () => {
    const entries = groupArtistsByIdentity([
      artistTrack("t1", daftPunk, [{ url: "https://example.test/small.jpg", width: 60 }]),
      artistTrack("t2", daftPunk, [{ url: "https://example.test/large.jpg", width: 544 }]),
    ]);

    expect(entries[0].artworkUrl).toBe("https://example.test/large.jpg");
  });

  it("keeps the first cover when a later one is not larger", () => {
    const entries = groupArtistsByIdentity([
      artistTrack("t1", daftPunk, [{ url: "https://example.test/first.jpg", width: 544 }]),
      artistTrack("t2", daftPunk, [{ url: "https://example.test/later.jpg", width: 120 }]),
    ]);

    expect(entries[0].artworkUrl).toBe("https://example.test/first.jpg");
  });

  it("takes the best cover of one track from that track's own artwork list", () => {
    const entries = groupArtistsByIdentity([
      artistTrack("t1", daftPunk, [
        { url: "https://example.test/small.jpg", width: 60 },
        { url: "https://example.test/large.jpg", width: 544 },
      ]),
    ]);

    expect(entries[0].artworkUrl).toBe("https://example.test/large.jpg");
  });

  it("recovers artwork from a later track when the first has none", () => {
    const entries = groupArtistsByIdentity([
      artistTrack("t1", daftPunk),
      artistTrack("t2", daftPunk, [{ url: "https://example.test/cover.jpg", width: 226 }]),
    ]);

    expect(entries[0].artworkUrl).toBe("https://example.test/cover.jpg");
  });

  it("leaves the artwork undefined when no track of that artist has any", () => {
    const entries = groupArtistsByIdentity([artistTrack("t1", daftPunk)]);

    expect(entries[0].artworkUrl).toBeUndefined();
  });
});

describe("groupArtistsByIdentity: bounds and stability", () => {
  const many = Array.from({ length: 14 }, (_, index) =>
    artistTrack(`t${index}`, { id: `UC${index}`, name: `Artist ${index}` }),
  );

  it("defaults to ten artists", () => {
    expect(groupArtistsByIdentity(many)).toHaveLength(10);
    expect(groupArtistsByIdentity(many).map((entry) => entry.id)).toEqual(
      many.slice(0, 10).map((_, index) => `UC${index}`),
    );
  });

  it("respects an explicit limit", () => {
    expect(groupArtistsByIdentity(many, 3).map((entry) => entry.id)).toEqual(["UC0", "UC1", "UC2"]);
    expect(groupArtistsByIdentity(many, 100)).toHaveLength(14);
  });

  it("is deterministic and leaves its input untouched", () => {
    const tracks = [artistTrack("t1", daftPunk), artistTrack("t2", neonWaves)];
    const before = tracks.map((track) => track.id);

    const first = groupArtistsByIdentity(tracks);
    const second = groupArtistsByIdentity(tracks);

    expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id));
    second.forEach((entry, index) => expect(entry.sampleTrack).toBe(first[index].sampleTrack));
    expect(tracks.map((track) => track.id)).toEqual(before);
  });
});
