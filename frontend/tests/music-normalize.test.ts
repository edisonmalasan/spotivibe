import { describe, expect, it } from "vitest";
import {
  candidateToTrack,
  parseDurationText,
  pickArtwork,
  PODCAST_DURATION_THRESHOLD_S,
  resolveCategory,
  splitArtists,
  TRACK_ID_PREFIX,
} from "@/server/music/normalize";
import { makeCandidate } from "./helpers/music-fixtures";

describe("parseDurationText", () => {
  it("parses M:SS and H:MM:SS into seconds", () => {
    expect(parseDurationText("4:09")).toBe(249);
    expect(parseDurationText("3:45")).toBe(225);
    expect(parseDurationText("1:02:03")).toBe(3723);
    expect(parseDurationText(" 6:10 ")).toBe(370);
  });

  it("returns 0 for text that is not a parsable duration", () => {
    expect(parseDurationText("Premiere")).toBe(0);
    expect(parseDurationText("")).toBe(0);
    expect(parseDurationText("4")).toBe(0);
    expect(parseDurationText("1:two")).toBe(0);
    expect(parseDurationText("1:2:3:4")).toBe(0);
  });
});

describe("pickArtwork", () => {
  it("orders largest first and dedupes by URL", () => {
    const artwork = pickArtwork(
      [
        { url: "https://img.test/small.jpg", width: 120, height: 90 },
        { url: "https://img.test/large.jpg", width: 720, height: 405 },
        { url: "https://img.test/small.jpg", width: 120, height: 90 },
      ],
      "vid000001",
    );
    expect(artwork).toHaveLength(2);
    expect(artwork[0]?.url).toBe("https://img.test/large.jpg");
    expect(artwork[0]?.width).toBe(720);
    expect(artwork[1]?.url).toBe("https://img.test/small.jpg");
  });

  it("keeps source order when sizes are unknown (stable sort)", () => {
    const artwork = pickArtwork(
      [{ url: "https://img.test/a.jpg" }, { url: "https://img.test/b.jpg" }],
      "vid000001",
    );
    expect(artwork.map((entry) => entry.url)).toEqual([
      "https://img.test/a.jpg",
      "https://img.test/b.jpg",
    ]);
  });

  it("falls back to the ytimg default when no artwork is present", () => {
    expect(pickArtwork([], "vid000001")).toEqual([
      { url: "https://i.ytimg.com/vi/vid000001/hqdefault.jpg" },
    ]);
    expect(pickArtwork([{ url: "" }], "vid000001")).toEqual([
      { url: "https://i.ytimg.com/vi/vid000001/hqdefault.jpg" },
    ]);
  });
});

describe("splitArtists", () => {
  it("returns no artists for absent text", () => {
    expect(splitArtists(undefined)).toEqual([]);
    expect(splitArtists("")).toEqual([]);
    expect(splitArtists("   ")).toEqual([]);
  });

  it("splits on commas, ampersands, and bullets", () => {
    expect(splitArtists("Daft Punk, Pharrell Williams, Nile Rodgers")).toEqual([
      { name: "Daft Punk" },
      { name: "Pharrell Williams" },
      { name: "Nile Rodgers" },
    ]);
    expect(splitArtists("A & B")).toEqual([{ name: "A" }, { name: "B" }]);
    expect(splitArtists("A • B")).toEqual([{ name: "A" }, { name: "B" }]);
  });

  it("attaches a single channel id to the first artist", () => {
    expect(splitArtists("Daft Punk", "UC_channel")).toEqual([
      { name: "Daft Punk", id: "UC_channel" },
    ]);
    expect(splitArtists("A, B", "UC_channel")).toEqual([
      { name: "A", id: "UC_channel" },
      { name: "B" },
    ]);
  });
});

describe("resolveCategory", () => {
  it("prefers an explicit provider marker over the heuristic", () => {
    expect(resolveCategory("music", 5000)).toBe("music");
    expect(resolveCategory("podcast", 90)).toBe("podcast");
  });

  it("falls back to the duration heuristic at the documented threshold", () => {
    expect(resolveCategory(undefined, PODCAST_DURATION_THRESHOLD_S)).toBe("music");
    expect(resolveCategory(undefined, PODCAST_DURATION_THRESHOLD_S + 1)).toBe("podcast");
    expect(resolveCategory(undefined, 1300)).toBe("podcast");
    expect(resolveCategory(undefined, 249)).toBe("music");
    expect(resolveCategory(undefined, undefined)).toBe("music");
  });
});

describe("candidateToTrack", () => {
  it("maps a candidate onto the canonical Track shape (ROADMAP §8.1)", () => {
    const track = candidateToTrack(
      makeCandidate({
        videoId: "Rgrt_8mXrK8",
        title: "Get Lucky",
        artistText: "Daft Punk, Pharrell Williams, Nile Rodgers",
        albumTitle: "Random Access Memories",
        albumId: "MPREb_K8qWMWVqXGi",
        artwork: [
          { url: "https://img.test/small.jpg", width: 60, height: 60 },
          { url: "https://img.test/large.jpg", width: 720, height: 720 },
        ],
        durationSeconds: 249,
      }),
    );
    expect(track).toEqual({
      id: `${TRACK_ID_PREFIX}Rgrt_8mXrK8`,
      source: "youtube",
      providerId: "Rgrt_8mXrK8",
      title: "Get Lucky",
      artists: [{ name: "Daft Punk" }, { name: "Pharrell Williams" }, { name: "Nile Rodgers" }],
      album: { id: "MPREb_K8qWMWVqXGi", title: "Random Access Memories" },
      artwork: [
        { url: "https://img.test/large.jpg", width: 720, height: 720 },
        { url: "https://img.test/small.jpg", width: 60, height: 60 },
      ],
      durationSeconds: 249,
      category: "music",
      capabilities: { stream: true, offlineDownload: false },
    });
    expect(track.qualityScore).toBeUndefined();
    expect(track.explicit).toBeUndefined();
  });

  it("omits the album and keeps capabilities YouTube-safe when absent", () => {
    const track = candidateToTrack(makeCandidate({ albumTitle: undefined, albumId: undefined }));
    expect(track.album).toBeUndefined();
    expect(track.capabilities).toEqual({ stream: true, offlineDownload: false });
  });

  it("categorizes by heuristic when the tier provides no marker", () => {
    expect(candidateToTrack(makeCandidate({ durationSeconds: 1300 })).category).toBe("podcast");
    expect(candidateToTrack(makeCandidate({ durationSeconds: undefined })).category).toBe("music");
  });
});
