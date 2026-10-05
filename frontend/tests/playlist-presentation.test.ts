import { describe, expect, it } from "vitest";
import type { PlaylistRecord, Track } from "@/data/repositories";
import {
  artworkUrl,
  bestArtworkUrl,
  derivePlaylistArtwork,
  formatTotalDuration,
  songCountLabel,
  sumPlaylistDuration,
} from "@/lib/playlistPresentation";
import { filterPlaylists, libraryFilterMatches } from "@/features/library/libraryFilter";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M7 design §8 pure-helper matrices: cover derivation (distinctness, order,
 * 4-cap, resolution), duration summing/formatting, the song-count label, and
 * the shared local filter. These land with the library surface (tasks 5.1/5.2)
 * and are re-verified by task 7.1's hero coverage.
 */

function playlistWith(tracks: Track[]): PlaylistRecord {
  return {
    id: "pl-1",
    name: "Fixture",
    createdAt: 1,
    updatedAt: 1,
    tracks: tracks.map((track, index) => ({ track, addedAt: index })),
  };
}

describe("artwork selection", () => {
  it("picks the best-resolution URL for a track and skips artwork-less tracks", () => {
    expect(
      bestArtworkUrl(
        makeTrack({
          artwork: [
            { url: "https://img.test/small.jpg", width: 60 },
            { url: "https://img.test/large.jpg", width: 480 },
            { url: "https://img.test/mid.jpg", width: 120 },
          ],
        }),
      ),
    ).toBe("https://img.test/large.jpg");
    expect(bestArtworkUrl(makeTrack({ artwork: [] }))).toBeUndefined();
  });

  it("keeps the first entry when widths are unknown or tied", () => {
    expect(
      bestArtworkUrl(
        makeTrack({
          artwork: [{ url: "https://img.test/first.jpg" }, { url: "https://img.test/second.jpg" }],
        }),
      ),
    ).toBe("https://img.test/first.jpg");
    expect(
      bestArtworkUrl(
        makeTrack({
          artwork: [
            { url: "https://img.test/a.jpg", width: 100 },
            { url: "https://img.test/b.jpg", width: 100 },
          ],
        }),
      ),
    ).toBe("https://img.test/a.jpg");
  });

  it("treats a missing playlist-artwork list as no artwork", () => {
    expect(artworkUrl(undefined)).toBeUndefined();
    expect(artworkUrl([{ url: "https://img.test/cover.jpg", width: 64 }])).toBe(
      "https://img.test/cover.jpg",
    );
  });
});

describe("derivePlaylistArtwork", () => {
  const track = (id: string, url?: string): Track =>
    makeTrack({
      id: `youtube:${id}`,
      providerId: id,
      artwork: url === undefined ? [] : [{ url }],
    });

  it("returns an empty cover for an empty or artwork-less playlist", () => {
    expect(derivePlaylistArtwork(playlistWith([]))).toEqual([]);
    expect(derivePlaylistArtwork(playlistWith([track("a")]))).toEqual([]);
  });

  it("keeps first-occurrence order, skips distinct-less entries, and caps at four", () => {
    const playlist = playlistWith([
      track("a", "https://img.test/one.jpg"),
      track("b"), // no artwork — skipped
      track("c", "https://img.test/one.jpg"), // duplicate URL — skipped
      track("d", "https://img.test/two.jpg"),
      track("e", "https://img.test/three.jpg"),
      track("f", "https://img.test/four.jpg"),
      track("g", "https://img.test/five.jpg"), // beyond the 2×2 cap
    ]);
    expect(derivePlaylistArtwork(playlist)).toEqual([
      "https://img.test/one.jpg",
      "https://img.test/two.jpg",
      "https://img.test/three.jpg",
      "https://img.test/four.jpg",
    ]);
  });

  it("prefers the playlist's own artwork over a collage of its tracks (M23)", () => {
    // The gap this closes: the sidebar and the detail hero both preferred a playlist's
    // real cover while the library grid derived one, so the same record showed two
    // different pictures depending on where you looked. The preference now lives here,
    // where a fourth surface cannot forget it.
    const playlist = playlistWith([
      track("a", "https://img.test/one.jpg"),
      track("d", "https://img.test/two.jpg"),
    ]);
    playlist.artwork = [{ url: "https://img.test/playlist-own.jpg", width: 640 }];

    // A single URL, so it renders as one image rather than a grid.
    expect(derivePlaylistArtwork(playlist)).toEqual(["https://img.test/playlist-own.jpg"]);
  });

  it("falls back to track artwork when the playlist's own artwork has no usable URL", () => {
    // Present-but-unusable must not read as "this playlist has a cover". An empty
    // array is the only value that can honestly mean that, since `artworkUrl` returns
    // `undefined` for it.
    const playlist = playlistWith([track("a", "https://img.test/one.jpg")]);
    playlist.artwork = [];
    expect(derivePlaylistArtwork(playlist)).toEqual(["https://img.test/one.jpg"]);
  });

  it("uses the best-resolution entry of a playlist's own artwork", () => {
    const playlist = playlistWith([]);
    playlist.artwork = [
      { url: "https://img.test/own-small.jpg", width: 60 },
      { url: "https://img.test/own-large.jpg", width: 640 },
    ];
    expect(derivePlaylistArtwork(playlist)).toEqual(["https://img.test/own-large.jpg"]);
  });
});

describe("duration and count formatting", () => {
  it("sums only known positive durations", () => {
    expect(
      sumPlaylistDuration([
        makeTrack({ durationSeconds: 180 }),
        makeTrack({ durationSeconds: 200 }),
        makeTrack({ durationSeconds: undefined }),
        makeTrack({ durationSeconds: 0 }),
        makeTrack({ durationSeconds: -5 }),
      ]),
    ).toBe(380);
    expect(sumPlaylistDuration([])).toBe(0);
  });

  it("formats totals as minutes or hours+minutes with floor precision", () => {
    expect(formatTotalDuration(0)).toBeNull();
    expect(formatTotalDuration(30)).toBeNull(); // sub-minute totals omit "0 min"
    expect(formatTotalDuration(380)).toBe("6 min");
    expect(formatTotalDuration(59 * 60 + 59)).toBe("59 min");
    expect(formatTotalDuration(3600)).toBe("1 hr");
    expect(formatTotalDuration(3660)).toBe("1 hr 1 min");
    expect(formatTotalDuration(2 * 3600)).toBe("2 hr");
  });

  it("pluralizes the shared song-count label", () => {
    expect(songCountLabel(0)).toBe("0 songs");
    expect(songCountLabel(1)).toBe("1 song");
    expect(songCountLabel(12)).toBe("12 songs");
  });
});

describe("library filter", () => {
  it("matches case-insensitively on any provided text and ignores an empty query", () => {
    expect(libraryFilterMatches("road", "Road Trip")).toBe(true);
    expect(libraryFilterMatches("  ROAD ", "road trip")).toBe(true);
    expect(libraryFilterMatches("trip", "Road Trip", "Focus")).toBe(true);
    expect(libraryFilterMatches("jazz", "Road Trip")).toBe(false);
    expect(libraryFilterMatches("   ", "anything")).toBe(true);
  });

  it("filters playlists by name preserving order, and copies for an empty query", () => {
    const playlists = [
      { id: "1", name: "Road Trip" },
      { id: "2", name: "Focus" },
      { id: "3", name: "Sunday Roast" },
    ];
    expect(filterPlaylists(playlists, "roa").map((p) => p.id)).toEqual(["1", "3"]);
    const all = filterPlaylists(playlists, "");
    expect(all.map((p) => p.id)).toEqual(["1", "2", "3"]);
    expect(all).not.toBe(playlists); // a defensive copy, not the live array
    expect(filterPlaylists(playlists, "zzz")).toEqual([]);
  });
});
