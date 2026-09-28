import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/music/errors";
import { finalizePlaylistEntries } from "@/server/music/normalize";
import { parsePipedPlaylist, pipedPlaylistResolver } from "@/server/music/providers/piped";
import type { PlaylistEntry } from "@/server/music/types";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "providers");

function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

type AnyRecord = Record<string, unknown>;

/**
 * `piped-playlist-entries.json` is a *constructed* success fixture (see the
 * fixtures README): real playlist metadata captured 2026-09-29 plus captured
 * Piped stream items, because no live public instance returned playlist
 * entries on that date. `piped-playlist.json` is the real capture and serves
 * as the degraded-instance (metadata without entries) case.
 */
const entriesFixture = fixture<AnyRecord>("piped-playlist-entries.json");
const degradedFixture = fixture("piped-playlist.json");
const missingFixture = fixture("piped-playlist-missing.json");

const PLAYLIST_ID = "PLQdn7YisXz3PVuntxWtNNhIXbpZQ2-fyP";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Piped reads bodies as text (definitive envelopes must survive non-2xx). */
function serveText(...bodies: unknown[]): ReturnType<typeof vi.fn> {
  let call = 0;
  return vi.fn(async () => {
    const body = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return {
      ok: true,
      status: 200,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as unknown as Response;
  });
}

/* ------------------------------------------------------------------ *
 * Parser (fixture-based, pure).
 * ------------------------------------------------------------------ */

describe("parsePipedPlaylist (captured + constructed fixtures)", () => {
  it("extracts name, description, total, and every stream entry", () => {
    const page = parsePipedPlaylist(entriesFixture);

    expect(page.title).toBe(
      "Perfect Sunday Morning Songs - Cozy Sunday Chill Music Playlist (Updated 2026)",
    );
    expect(page.description).toContain("If you liked this playlist");
    expect(page.videoCount).toBe(20);
    expect(page.nextpage).toBeUndefined();
    expect(page.entries).toHaveLength(20);
  });

  it("normalizes each stream to a canonical candidate", () => {
    const { entries } = parsePipedPlaylist(entriesFixture);

    expect(entries[0]).toMatchObject({
      videoId: "Rgrt_8mXrK8",
      title: "Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)",
      artistText: "Daft Punk",
      artistId: "UCRr1xG_2WIDs18a6cIiCxeA",
      durationSeconds: 249,
      tier: "piped",
    });
    expect(entries[0]?.artwork.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(entry).not.toBeNull();
      expect(entry?.videoId).toBeTruthy();
      expect(entry?.tier).toBe("piped");
    }
  });

  it("parses the real metadata-only capture as a degraded listing", () => {
    const page = parsePipedPlaylist(degradedFixture);
    expect(page.videoCount).toBe(200);
    expect(page.entries).toHaveLength(0);
    expect(page.title).toContain("Perfect Sunday Morning Songs");
  });

  it("fails with a parse-kind ProviderError for malformed responses", () => {
    for (const invalid of [missingFixture, null, "text", 42, [], { name: "no streams" }]) {
      try {
        parsePipedPlaylist(invalid);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ProviderError);
        expect(error).toMatchObject({ name: "ProviderError", tier: "piped", kind: "parse" });
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Resolver (mocked fetch).
 * ------------------------------------------------------------------ */

describe("pipedPlaylistResolver (mocked fetch)", () => {
  it("fetches /playlists/<id> from the first instance and returns the listing", async () => {
    const fetchMock = serveText(entriesFixture);
    vi.stubGlobal("fetch", fetchMock);

    const resolution = await pipedPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });

    expect(resolution.title).toContain("Perfect Sunday Morning Songs");
    expect(resolution.truncated).toBe(false);
    expect(resolution.entries).toHaveLength(20);
    expect(resolution.entries[0]?.videoId).toBe("Rgrt_8mXrK8");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://pipedapi.ducks.party/playlists/${PLAYLIST_ID}`);
  });

  it("treats a ContentNotAvailableException body as definitive, even on non-2xx", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify(missingFixture),
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pipedPlaylistResolver.resolvePlaylist({ playlistId: "PLmissingmissingmissingmissing" }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "piped", kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats the same envelope as definitive when the instance answers HTTP 200", async () => {
    vi.stubGlobal("fetch", serveText(missingFixture));

    await expect(
      pipedPlaylistResolver.resolvePlaylist({ playlistId: "PLmissingmissingmissingmissing" }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "piped", kind: "unavailable" });
  });

  it("falls through with kind empty when an instance reports videos but serves none", async () => {
    vi.stubGlobal("fetch", serveText(degradedFixture));

    await expect(
      pipedPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "piped", kind: "empty" });
  });

  it("wraps a malformed body as kind parse and a network failure as kind network", async () => {
    vi.stubGlobal("fetch", serveText("<html>gateway</html>"));
    await expect(
      pipedPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "piped", kind: "parse" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(
      pipedPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "piped", kind: "network" });
  });

  it("follows nextpage tokens when the instance provides them", async () => {
    const streams = entriesFixture.relatedStreams as AnyRecord[];
    const fetchMock = serveText(
      { ...entriesFixture, relatedStreams: streams.slice(0, 8), nextpage: "tok-1" },
      { ...entriesFixture, relatedStreams: streams.slice(8), nextpage: null },
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolution = await pipedPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });

    expect(resolution.entries).toHaveLength(20);
    expect(resolution.truncated).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl] = fetchMock.mock.calls[0] as unknown as [string];
    const [secondUrl] = fetchMock.mock.calls[1] as unknown as [string];
    expect(firstUrl).not.toContain("nextpage=");
    expect(secondUrl).toContain("?nextpage=tok-1");
  });

  it("keeps an unavailable stream as null so it is skipped and counted, not dropped", async () => {
    const body = clone(entriesFixture);
    const streams = body.relatedStreams as AnyRecord[];
    delete streams[0].url; // no resolvable video id
    vi.stubGlobal("fetch", serveText(body));

    const resolution = await pipedPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });
    expect(resolution.entries).toHaveLength(20);
    expect(resolution.entries[0]).toBeNull();

    const { tracks, skipped } = finalizePlaylistEntries(resolution.entries as PlaylistEntry[]);
    expect(skipped).toBe(1);
    expect(tracks).toHaveLength(19);
    for (const track of tracks) expect(track).not.toHaveProperty("qualityScore");
  });

  it("skips and counts non-stream items and dedupes repeated ids keep-first", async () => {
    const body = clone(entriesFixture);
    const streams = body.relatedStreams as AnyRecord[];
    streams.push({ ...clone(streams[0]), type: "channel" }); // not a stream
    streams.push(clone(streams[0])); // duplicate video id
    vi.stubGlobal("fetch", serveText(body));

    const resolution = await pipedPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });
    expect(resolution.entries).toHaveLength(22);

    const { tracks, skipped } = finalizePlaylistEntries(resolution.entries as PlaylistEntry[]);
    expect(skipped).toBe(1); // the non-stream row
    expect(tracks).toHaveLength(20);
    expect(tracks.filter((track) => track.providerId === "Rgrt_8mXrK8")).toHaveLength(1);
  });
});
