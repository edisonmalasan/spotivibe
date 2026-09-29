import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/music/errors";
import { finalizePlaylistEntries } from "@/server/music/normalize";
import { parseYtwebPlaylistPage, ytwebPlaylistResolver } from "@/server/music/providers/ytweb";
import type { PlaylistEntry } from "@/server/music/types";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "fixtures", "providers");

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

const firstPage: unknown = fixture("ytweb-playlist.json");
const continuationPage: unknown = fixture("ytweb-playlist-continuation.json");
const smallPage: unknown = fixture("ytweb-playlist-small.json");
const missingPage: unknown = fixture("ytweb-playlist-missing.json");

const PLAYLIST_ID = "PLQdn7YisXz3PVuntxWtNNhIXbpZQ2-fyP";

afterEach(() => {
  vi.unstubAllGlobals();
});

type AnyRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

describe("parseYtwebPlaylistPage (captured live fixture)", () => {
  it("extracts the metadata title, real description, rows, and continuation", () => {
    const page = parseYtwebPlaylistPage(firstPage);

    expect(page.title).toBe(
      "Perfect Sunday Morning Songs - Cozy Sunday Chill Music Playlist (Updated 2026)",
    );
    expect(page.description?.startsWith(page.title as string)).toBe(true);
    expect(page.description).toContain("If you liked this playlist");
    expect(page.entries).toHaveLength(100);
    expect(page.continuation).toBeTypeOf("string");
  });

  it("extracts video id, title, artist, duration, and artwork per lockup row", () => {
    const { entries } = parseYtwebPlaylistPage(firstPage);

    expect(entries[0]).toMatchObject({
      videoId: "3E78T8h5EhA",
      title: "Post Malone & Swae Lee - Sunflower",
      artistText: "Post Malone",
      durationSeconds: 123,
      tier: "ytweb",
    });
    expect(entries[0]?.artwork.length).toBeGreaterThan(0);
    expect(entries[1]).toMatchObject({ videoId: "8F2s8ivKXNY", artistText: "Oliver Tree" });

    for (const entry of entries) {
      expect(entry).not.toBeNull();
      expect(entry?.videoId).toBeTruthy();
      expect(entry?.title).toBeTruthy();
      expect(entry?.tier).toBe("ytweb");
    }
  });

  it("parses continuation responses as rows with no further token", () => {
    const page = parseYtwebPlaylistPage(continuationPage);
    expect(page.entries).toHaveLength(100);
    expect(page.continuation).toBeUndefined();
    expect(page.entries[0]).toMatchObject({
      videoId: "ZQFmRXgeR-s",
      artistText: "Olivia Rodrigo",
      title: "Olivia Rodrigo - happier (Lyric Video)",
    });
  });

  it("omits the empty description of a small playlist", () => {
    const page = parseYtwebPlaylistPage(smallPage);
    expect(page.title).toBe("sleep playlist bts");
    expect(page.description).toBeUndefined();
    expect(page.entries).toHaveLength(7);
    expect(page.entries[0]).toMatchObject({
      videoId: "AY-JjVwBdkI",
      durationSeconds: 11542, // "3:12:22"
    });
  });

  it("classifies the ERROR alert of a missing playlist as definitively unavailable", () => {
    try {
      parseYtwebPlaylistPage(missingPage);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ name: "ProviderError", tier: "ytweb", kind: "unavailable" });
    }
  });

  it("rejects bodies with nothing recognizable as a parse failure", () => {
    for (const invalid of [null, "text", 42, [], { responseContext: {} }]) {
      try {
        parseYtwebPlaylistPage(invalid);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toMatchObject({ name: "ProviderError", tier: "ytweb", kind: "parse" });
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Resolver (mocked fetch): continuation joining and failure classes.
 * ------------------------------------------------------------------ */

describe("ytwebPlaylistResolver (mocked fetch)", () => {
  it("browses VL<id>, follows the continuation, and returns 200 entries in source order", async () => {
    const fetchMock = servePages(firstPage, continuationPage);
    vi.stubGlobal("fetch", fetchMock);

    const resolution = await ytwebPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });

    expect(resolution.title).toBe(
      "Perfect Sunday Morning Songs - Cozy Sunday Chill Music Playlist (Updated 2026)",
    );
    expect(resolution.description).toContain("red-music.com");
    expect(resolution.truncated).toBe(false);
    expect(resolution.entries).toHaveLength(200);
    expect(resolution.entries[0]?.videoId).toBe("3E78T8h5EhA");
    expect(resolution.entries[99]?.videoId).toBe("viimfQi_pUw");
    expect(resolution.entries[100]?.videoId).toBe("ZQFmRXgeR-s");
    expect(resolution.entries[199]?.videoId).toBe("L3dPK8tDn6g");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(firstUrl).toContain("/youtubei/v1/browse");
    const firstBody = JSON.parse(firstInit.body as string) as {
      browseId?: string;
      context: { client: { clientName: string } };
    };
    expect(firstBody.browseId).toBe(`VL${PLAYLIST_ID}`);
    expect(firstBody.context.client.clientName).toBe("WEB");
    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string,
    ) as { browseId?: string; continuation?: string };
    expect(secondBody.browseId).toBeUndefined();
    expect(secondBody.continuation).toBeTypeOf("string");
  });

  it("surfaces the ERROR alert of a missing playlist as kind unavailable", async () => {
    vi.stubGlobal("fetch", servePages(missingPage));

    await expect(
      ytwebPlaylistResolver.resolvePlaylist({ playlistId: "PLmissingmissingmissingmissing" }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "ytweb", kind: "unavailable" });
  });

  it("wraps network failures as kind network (falls through to the next tier)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(
      ytwebPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID }),
    ).rejects.toMatchObject({ name: "ProviderError", tier: "ytweb", kind: "network" });
  });

  it("marks a truncated result when the entry cap cuts the playlist short", async () => {
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

    const resolution = await ytwebPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });

    expect(resolution.entries).toHaveLength(500);
    expect(resolution.truncated).toBe(true);
  });

  it("keeps an unavailable row as null so it is skipped and counted, not dropped", async () => {
    const body = clone(firstPage) as AnyRecord;
    // A lockup whose content id is missing renders for a deleted/private video.
    const lockup = findLockup(body);
    expect(lockup).toBeDefined();
    delete (lockup as AnyRecord).contentId;
    stripContinuation(body);
    vi.stubGlobal("fetch", servePages(body));

    const resolution = await ytwebPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });
    expect(resolution.entries).toHaveLength(100);
    expect(resolution.entries[0]).toBeNull();

    const { tracks, skipped } = finalizePlaylistEntries(resolution.entries as PlaylistEntry[]);
    expect(skipped).toBe(1);
    expect(tracks).toHaveLength(99);
    for (const track of tracks) expect(track).not.toHaveProperty("qualityScore");
  });

  it("dedupes repeated video ids keep-first through finalization", async () => {
    const body = clone(firstPage) as AnyRecord;
    const rows = ytwebRows(body);
    rows.push({ lockupViewModel: clone((rows[0] as AnyRecord).lockupViewModel) });
    stripContinuation(body);
    vi.stubGlobal("fetch", servePages(body));

    const resolution = await ytwebPlaylistResolver.resolvePlaylist({ playlistId: PLAYLIST_ID });
    expect(resolution.entries).toHaveLength(101);

    const { tracks, skipped } = finalizePlaylistEntries(resolution.entries as PlaylistEntry[]);
    expect(skipped).toBe(0);
    expect(tracks).toHaveLength(100);
    expect(tracks.filter((track) => track.providerId === "3E78T8h5EhA")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Fixture-manipulation helpers for lockup rows.
 * ------------------------------------------------------------------ */

/** The first item array in the body that holds `lockupViewModel` rows. */
function ytwebRows(body: AnyRecord): AnyRecord[] {
  let found: AnyRecord[] | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined) return;
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      const hasLockup = node.some(
        (item) => item !== null && typeof item === "object" && "lockupViewModel" in item,
      );
      if (hasLockup) {
        found = node as AnyRecord[];
        return;
      }
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(body);
  if (found === undefined) throw new Error("fixture has no lockup rows");
  return found;
}

/** First `lockupViewModel` node anywhere in the body. */
function findLockup(body: AnyRecord): AnyRecord | undefined {
  const walk = (node: unknown): AnyRecord | undefined => {
    if (node === null || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return undefined;
    }
    const record = node as AnyRecord;
    if (record.lockupViewModel && typeof record.lockupViewModel === "object") {
      return record.lockupViewModel as AnyRecord;
    }
    for (const child of Object.values(record)) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  };
  return walk(body);
}
