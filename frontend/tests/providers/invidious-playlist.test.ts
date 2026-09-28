import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/music/errors";
import { finalizePlaylistEntries } from "@/server/music/normalize";
import {
  invidiousPlaylistResolver,
  parseInvidiousPlaylist,
} from "@/server/music/providers/invidious";
import type { PlaylistEntry } from "@/server/music/types";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "providers");

function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

const playlistFixture = fixture<AnyRecord>("invidious-playlist.json");
const missingFixture = fixture("invidious-playlist-missing.json");

const PLAYLIST_ID = "PLQdn7YisXz3PVuntxWtNNhIXbpZQ2-fyP";

type AnyRecord = Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** fetch mock serving a fixed sequence of JSON bodies in call order. */
function servePages(...bodies: unknown[]): ReturnType<typeof vi.fn> {
  let call = 0;
  return vi.fn(async () => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
}

/* ------------------------------------------------------------------ *
 * Parser (fixture-based, pure).
 * ------------------------------------------------------------------ */

describe("parseInvidiousPlaylist (captured live fixture)", () => {
  it("extracts title, description, the instance-reported total, and every video", () => {
    const page = parseInvidiousPlaylist(playlistFixture);

    expect(page.title).toBe(
      "Perfect Sunday Morning Songs - Cozy Sunday Chill Music Playlist (Updated 2026)",
    );
    expect(page.description).toContain("If you liked this playlist");
    expect(page.videoCount).toBe(200);
    expect(page.entries).toHaveLength(200);
  });

  it("normalizes each video to a canonical candidate", () => {
    const { entries } = parseInvidiousPlaylist(playlistFixture);

    expect(entries[0]).toMatchObject({
      videoId: "3E78T8h5EhA",
      title: "Post Malone & Swae Lee - Sunflower",
      artistText: "Post Malone",
      artistId: "UCeLHszkByNZtPKcaVXOCOQQ",
      durationSeconds: 123,
      tier: "invidious",
    });
    expect(entries[0]?.artwork.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry).not.toBeNull();
      expect(entry?.videoId).toBeTruthy();
      expect(entry?.tier).toBe("invidious");
    }
  });

  it("fails with a parse-kind ProviderError for malformed responses", () => {
    for (const invalid of [missingFixture, null, "text", 42, [], { title: "no videos" }]) {
      try {
        parseInvidiousPlaylist(invalid);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect(error).toMatchObject({ name: "ProviderError", tier: "invidious", kind: "parse" });
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Resolver (mocked fetch).
 * ------------------------------------------------------------------ */

describe("invidiousPlaylistResolver (mocked fetch)", () => {
  it("resolves a full listing from the first instance in one page", async () => {
    const fetchMock = servePages(playlistFixture);
    vi.stubGlobal("fetch", fetchMock);

    const resolution = await invidiousPlaylistResolver.resolvePlaylist({
      playlistId: PLAYLIST_ID,
    });

    expect(resolution.title).toContain("Perfect Sunday Morning Songs");
    expect(resolution.truncated).toBe(false);
    expect(resolution.entries).toHaveLength(200);
    expect(resolution.entries[0]?.videoId).toBe("3E78T8h5EhA");
    expect(resolution.entries[199]?.videoId).toBe("L3dPK8tDn6g");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://yewtu.be/api/v1/playlists/${PLAYLIST_ID}`);
  });

  it("maps an HTTP 404 to a definitive unavailable answer without rotating", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => missingFixture,
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      invidiousPlaylistResolver.resolvePlaylist({ playlistId: "PLmissingmissingmissingmissing" }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "invidious", kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls through with kind empty when an instance reports videos but serves none", async () => {
    vi.stubGlobal(
      "fetch",
      servePages({ title: "Perfect Sunday Morning", videoCount: 200, videos: [] }),
    );

    await expect(
      invidiousPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "invidious", kind: "empty" });
  });

  it("wraps a network failure as kind network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(
      invidiousPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "invidious", kind: "network" });
  });

  it("pages with ?page=N while the instance reports more entries", async () => {
    const videos = playlistFixture.videos as AnyRecord[];
    const fetchMock = servePages(
      { ...playlistFixture, videos: videos.slice(0, 100) },
      { ...playlistFixture, videos: videos.slice(100) },
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolution = await invidiousPlaylistResolver.resolvePlaylist({
      playlistId: PLAYLIST_ID,
    });

    expect(resolution.entries).toHaveLength(200);
    expect(resolution.truncated).toBe(false);
    expect(resolution.entries[100]?.videoId).toBe("ZQFmRXgeR-s");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const [secondUrl] = fetchMock.mock.calls[1] as unknown as [string];
    expect(firstUrl).not.toContain("page=");
    expect(secondUrl).toContain(`?page=2`);
  });

  it("keeps an unavailable video as null so it is skipped and counted, not dropped", async () => {
    const body = clone(playlistFixture);
    const videos = body.videos as AnyRecord[];
    delete videos[0].videoId;
    vi.stubGlobal("fetch", servePages(body));

    const resolution = await invidiousPlaylistResolver.resolvePlaylist({
      playlistId: PLAYLIST_ID,
    });
    expect(resolution.entries).toHaveLength(200);
    expect(resolution.entries[0]).toBeNull();

    const { tracks, skipped } = finalizePlaylistEntries(resolution.entries as PlaylistEntry[]);
    expect(skipped).toBe(1);
    expect(tracks).toHaveLength(199);
    expect(tracks[0]?.providerId).toBe("8F2s8ivKXNY");
    for (const track of tracks) expect(track).not.toHaveProperty("qualityScore");
  });

  it("dedupes repeated video ids keep-first through finalization", async () => {
    const body = clone(playlistFixture);
    const videos = body.videos as AnyRecord[];
    videos.push(clone(videos[0])); // same video twice
    vi.stubGlobal("fetch", servePages(body));

    const resolution = await invidiousPlaylistResolver.resolvePlaylist({
      playlistId: PLAYLIST_ID,
    });
    expect(resolution.entries).toHaveLength(201);

    const { tracks, skipped } = finalizePlaylistEntries(resolution.entries as PlaylistEntry[]);
    expect(skipped).toBe(0);
    expect(tracks).toHaveLength(200);
    expect(tracks.filter((track) => track.providerId === "3E78T8h5EhA")).toHaveLength(1);
  });
});
