import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/music/errors";
import { finalizePlaylistEntries } from "@/server/music/normalize";
import {
  parseYtmusicPlaylistPage,
  ytmusicPlaylistResolver,
} from "@/server/music/providers/ytmusic";
import type { PlaylistEntry } from "@/server/music/types";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "providers");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

const firstPage: unknown = fixture("ytm-playlist.json");
const continuationPage: unknown = fixture("ytm-playlist-continuation.json");
const smallPage: unknown = fixture("ytm-playlist-small.json");
const missingPage: unknown = fixture("ytm-playlist-missing.json");

const PLAYLIST_ID = "PLQdn7YisXz3PVuntxWtNNhIXbpZQ2-fyP";

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ *
 * Fixture-manipulation helpers (deep clones — fixtures stay pristine).
 * ------------------------------------------------------------------ */

type AnyRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The shelf array that holds `musicResponsiveListItemRenderer` rows. */
function shelfRows(body: AnyRecord): AnyRecord[] {
  let found: AnyRecord[] | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as AnyRecord;
    const shelf = record.musicPlaylistShelfRenderer as AnyRecord | undefined;
    if (shelf && Array.isArray(shelf.contents)) {
      found = shelf.contents as AnyRecord[];
      return;
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(body);
  if (found === undefined) throw new Error("fixture has no playlist shelf");
  return found;
}

/** Turn one row into an unavailable entry: no id anywhere the parser looks. */
function makeRowUnavailable(wrapper: AnyRecord): void {
  const row = (wrapper.musicResponsiveListItemRenderer as AnyRecord | undefined) ?? wrapper;
  delete row.playlistItemData;
  const columns = (row.flexColumns ?? []) as AnyRecord[];
  for (const column of columns) {
    const renderer = column.musicResponsiveListItemFlexColumnRenderer as AnyRecord | undefined;
    const text = renderer?.text as { runs?: AnyRecord[] } | undefined;
    for (const run of text?.runs ?? []) delete run.navigationEndpoint;
  }
}

/** Overwrite the first continuation token in the body (truncation tests). */
function setContinuationToken(body: AnyRecord, token: string): void {
  let done = false;
  const walk = (node: unknown): void => {
    if (done || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as AnyRecord;
    const endpoint = record.continuationEndpoint as AnyRecord | undefined;
    const command = endpoint?.continuationCommand as AnyRecord | undefined;
    if (command && typeof command.token === "string") {
      command.token = token;
      done = true;
      return;
    }
    for (const child of Object.values(record)) walk(child);
  };
  walk(body);
  if (!done) throw new Error("fixture has no continuation token");
}

/** Delete every continuation token so the resolver stops after one page. */
function stripContinuation(body: AnyRecord): void {
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const record = node as AnyRecord;
    delete record.continuationItemRenderer;
    for (const child of Object.values(record)) walk(child);
  };
  walk(body);
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

describe("parseYtmusicPlaylistPage (captured live fixture)", () => {
  it("extracts the header title, real description, rows, and continuation", () => {
    const page = parseYtmusicPlaylistPage(firstPage);

    expect(page.title).toBe(
      "Perfect Sunday Morning Songs - Cozy Sunday Chill Music Playlist (Updated 2026)",
    );
    expect(page.description?.startsWith(page.title as string)).toBe(true);
    expect(page.description).toContain("If you liked this playlist");
    expect(page.entries).toHaveLength(100);
    expect(page.continuation).toBeTypeOf("string");
  });

  it("extracts video id, title, artist, duration, and artwork per row", () => {
    const { entries } = parseYtmusicPlaylistPage(firstPage);

    expect(entries[0]).toMatchObject({
      videoId: "3E78T8h5EhA",
      title: "Sunflower (Spider-Man: Into the Spider-Verse)",
      artistText: "Post Malone, Swae Lee",
      durationSeconds: 123, // "2:03" from the fixed column
      tier: "ytmusic",
    });
    expect(entries[0]?.artwork.length).toBeGreaterThan(0);
    expect(entries[1]).toMatchObject({ videoId: "8F2s8ivKXNY", artistText: "Oliver Tree" });

    // Every row resolves — no nulls in this capture.
    for (const entry of entries) {
      expect(entry).not.toBeNull();
      expect(entry?.videoId).toBeTruthy();
      expect(entry?.title).toBeTruthy();
      expect(entry?.tier).toBe("ytmusic");
    }
  });

  it("parses continuation responses as rows with no further token", () => {
    const page = parseYtmusicPlaylistPage(continuationPage);
    expect(page.title).toBeUndefined();
    expect(page.entries).toHaveLength(100);
    expect(page.continuation).toBeUndefined();
    expect(page.entries[0]).toMatchObject({ videoId: "ZQFmRXgeR-s", artistText: "Olivia Rodrigo" });
  });

  it("parses a small playlist header without a description shelf", () => {
    const page = parseYtmusicPlaylistPage(smallPage);
    expect(page.title).toBe("sleep playlist bts");
    expect(page.description).toBeUndefined();
    expect(page.entries).toHaveLength(7);
    expect(page.entries[0]).toMatchObject({
      videoId: "AY-JjVwBdkI",
      durationSeconds: 11542, // "3:12:22"
    });
  });

  it("classifies a contents-less, title-less response as definitively unavailable", () => {
    try {
      parseYtmusicPlaylistPage(missingPage);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ name: "ProviderError", tier: "ytmusic", kind: "unavailable" });
    }
  });

  it("rejects bodies with nothing recognizable as a parse failure", () => {
    for (const invalid of [null, "text", 42, [], { responseContext: {} }]) {
      try {
        parseYtmusicPlaylistPage(invalid);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toMatchObject({ name: "ProviderError", tier: "ytmusic", kind: "parse" });
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Resolver (mocked fetch): continuation joining and failure classes.
 * ------------------------------------------------------------------ */

describe("ytmusicPlaylistResolver (mocked fetch)", () => {
  it("browses VL<id>, follows the continuation, and returns 200 entries in source order", async () => {
    const fetchMock = servePages(firstPage, continuationPage);
    vi.stubGlobal("fetch", fetchMock);

    const resolution = await ytmusicPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });

    expect(resolution.title).toBe(
      "Perfect Sunday Morning Songs - Cozy Sunday Chill Music Playlist (Updated 2026)",
    );
    expect(resolution.description).toContain("red-music.com");
    expect(resolution.truncated).toBe(false);
    expect(resolution.entries).toHaveLength(200);

    // Source order: first-page rows keep their positions, continuation rows follow.
    expect(resolution.entries[0]?.videoId).toBe("3E78T8h5EhA");
    expect(resolution.entries[99]?.videoId).toBe("viimfQi_pUw");
    expect(resolution.entries[100]?.videoId).toBe("ZQFmRXgeR-s");
    expect(resolution.entries[199]?.videoId).toBe("L3dPK8tDn6g");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(firstUrl).toContain("/youtubei/v1/browse");
    const firstBody = JSON.parse(firstInit.body as string) as {
      browseId?: string;
      context: { client: { clientName: string } };
    };
    expect(firstBody.browseId).toBe(`VL${PLAYLIST_ID}`);
    expect(firstBody.context.client.clientName).toBe("WEB_REMIX");
    expect(secondUrl).toBe(firstUrl);
    const secondBody = JSON.parse(secondInit.body as string) as {
      browseId?: string;
      continuation?: string;
    };
    expect(secondBody.browseId).toBeUndefined();
    expect(secondBody.continuation).toBeTypeOf("string");
  });

  it("surfaces a definitive missing-playlist answer as kind unavailable", async () => {
    vi.stubGlobal("fetch", servePages(missingPage));

    await expect(
      ytmusicPlaylistResolver.resolvePlaylist({ playlistId: "PLmissingmissingmissingmissing" }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "ytmusic", kind: "unavailable" });
  });

  it("wraps network failures as kind network (falls through to the next tier)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(
      ytmusicPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "ytmusic", kind: "network" });
  });

  it("marks a truncated result when the entry cap cuts the playlist short", async () => {
    // Every page hands out a fresh continuation token past the 500-entry cap.
    let token = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        token += 1;
        const body = clone(firstPage) as AnyRecord;
        setContinuationToken(body, `tok${token}`);
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      }),
    );

    const resolution = await ytmusicPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });

    expect(resolution.entries).toHaveLength(500);
    expect(resolution.truncated).toBe(true);
  });

  it("keeps an unavailable row as null so it is skipped and counted, not dropped", async () => {
    const body = clone(firstPage) as AnyRecord;
    makeRowUnavailable(shelfRows(body)[0] as AnyRecord);
    stripContinuation(body);
    vi.stubGlobal("fetch", servePages(body));

    const resolution = await ytmusicPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });
    expect(resolution.entries).toHaveLength(100);
    expect(resolution.entries[0]).toBeNull();

    const { tracks, skipped } = finalizePlaylistEntries(resolution.entries as PlaylistEntry[]);
    expect(skipped).toBe(1);
    expect(tracks).toHaveLength(99);
    for (const track of tracks) expect(track).not.toHaveProperty("qualityScore");
  });

  it("dedupes repeated video ids keep-first through finalization", async () => {
    const body = clone(firstPage) as AnyRecord;
    const rows = shelfRows(body);
    rows.push(clone(rows[1] as AnyRecord)); // same video twice
    stripContinuation(body);
    vi.stubGlobal("fetch", servePages(body));

    const resolution = await ytmusicPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });
    expect(resolution.entries).toHaveLength(101);

    const { tracks, skipped } = finalizePlaylistEntries(resolution.entries as PlaylistEntry[]);
    expect(skipped).toBe(0);
    expect(tracks).toHaveLength(100);
    expect(tracks[1]?.providerId).toBe("8F2s8ivKXNY");
    expect(tracks.filter((track) => track.providerId === "8F2s8ivKXNY")).toHaveLength(1);
  });
});
