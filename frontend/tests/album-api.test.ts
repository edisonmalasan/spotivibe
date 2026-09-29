import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALBUM_ENDPOINT,
  AlbumApiError,
  buildAlbumQuery,
  fetchAlbum,
  isRetryableAlbumError,
  MAX_ALBUM_ARTIST_LENGTH,
  MAX_ALBUM_ID_LENGTH,
  MAX_ALBUM_TITLE_LENGTH,
  parseAlbumResponse,
} from "@/features/album/albumApi";
import type { Track } from "@/data/repositories";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M9 task 4.1 (spec: `catalog` — "Album page" / "Catalog entity keys and
 * resolution requests"; design §2/§3).
 *
 * The client contract: query construction and its bounds, body parsing
 * (including the honest `unresolvable` answers and the
 * `metadataIncomplete` pass-through), and the mapping from every response the
 * route can produce onto the four designed error codes.
 */

const CHANNEL_ID = "UCaurorachannel00000000";

const alpha = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const beta = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta" });

/** A well-formed 200 body with per-test overridable fields. */
function successBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    album: {
      id: "UCdawnrelease0000000000",
      title: "Dawn Chorus",
      artistName: "Aurora",
      artworkUrl: "https://example.test/dawn.jpg",
    },
    tracks: [alpha, beta],
    metadataIncomplete: false,
    diagnostics: { seedsTried: 2, cached: false },
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The designed code a `fetchAlbum` call fails with, or `"resolved"`. */
async function failingCode(body: unknown, status: number): Promise<string> {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(jsonResponse(body, status))),
  );
  try {
    await fetchAlbum({ key: "Dawn Chorus" });
    return "resolved";
  } catch (error) {
    return error instanceof AlbumApiError ? error.code : `threw:${String(error)}`;
  }
}

describe("buildAlbumQuery", () => {
  it("sends an id key as `id` and nothing else", () => {
    expect(buildAlbumQuery({ key: CHANNEL_ID })).toBe(`${ALBUM_ENDPOINT}?id=${CHANNEL_ID}`);
  });

  it("sends a composed key as `title` plus `artist`", () => {
    expect(buildAlbumQuery({ key: "Dawn Chorus - Aurora" })).toBe(
      `${ALBUM_ENDPOINT}?title=Dawn+Chorus&artist=Aurora`,
    );
  });

  it("sends a bare title as `title` alone", () => {
    expect(buildAlbumQuery({ key: "Dawn Chorus" })).toBe(`${ALBUM_ENDPOINT}?title=Dawn+Chorus`);
  });

  it("refuses a blank key before any network call", () => {
    expect(() => buildAlbumQuery({ key: "" })).toThrow(AlbumApiError);
    expect(() => buildAlbumQuery({ key: "   " })).toThrowError(/An album key is required\./);
  });

  it("mirrors the server's bounds, accepting the limit and rejecting one past it", () => {
    // Bounds are the route's zod maxima; a client that let a longer string
    // through would earn a 400 for a key the user could not have typed.
    expect([MAX_ALBUM_ID_LENGTH, MAX_ALBUM_TITLE_LENGTH, MAX_ALBUM_ARTIST_LENGTH]).toEqual([
      64, 200, 200,
    ]);

    // Text at an exact length, shaped so it can only be a title: a bare run of
    // letters long enough would be classified as an id, which is the other
    // branch and the other bound.
    const atBound = (length: number) => `${"d".repeat(length - 6)} album`;

    expect(() =>
      buildAlbumQuery({ key: `UC${"t".repeat(MAX_ALBUM_ID_LENGTH - 2)}` }),
    ).not.toThrow();
    expect(() => buildAlbumQuery({ key: `UC${"t".repeat(MAX_ALBUM_ID_LENGTH - 1)}` })).toThrow(
      /at most 64 characters/,
    );
    expect(() => buildAlbumQuery({ key: atBound(MAX_ALBUM_TITLE_LENGTH) })).not.toThrow();
    expect(() => buildAlbumQuery({ key: atBound(MAX_ALBUM_TITLE_LENGTH + 1) })).toThrow(
      /title must be at most 200 characters/,
    );
    // The artist is bounded independently of the title it narrows.
    expect(() =>
      buildAlbumQuery({
        key: `${atBound(MAX_ALBUM_TITLE_LENGTH)} - ${atBound(MAX_ALBUM_ARTIST_LENGTH)}`,
      }),
    ).not.toThrow();
    expect(() =>
      buildAlbumQuery({ key: `Dawn Chorus - ${atBound(MAX_ALBUM_ARTIST_LENGTH + 1)}` }),
    ).toThrow(/artist must be at most 200 characters/);
  });

  it("can construct nothing but the release identifier", () => {
    // The local-first contract, asserted structurally: a liked-track, playlist,
    // or history parameter does not exist on this request.
    const query = buildAlbumQuery({ key: "Dawn Chorus - Aurora" });
    expect([...new URLSearchParams(query.slice(query.indexOf("?") + 1)).keys()].sort()).toEqual([
      "artist",
      "title",
    ]);
  });
});

describe("parseAlbumResponse", () => {
  it("returns the release, its tracks, and the diagnostics envelope", () => {
    const detail = parseAlbumResponse(successBody());

    expect(detail.album).toEqual({
      id: "UCdawnrelease0000000000",
      title: "Dawn Chorus",
      artistName: "Aurora",
      artworkUrl: "https://example.test/dawn.jpg",
      year: undefined,
    });
    expect(detail.tracks).toEqual([alpha, beta]);
    expect(detail.metadataIncomplete).toBe(false);
    expect(detail.diagnostics.raw).toEqual({ seedsTried: 2, cached: false });
  });

  it("carries `metadataIncomplete` through rather than resolving it", () => {
    // Design §3: the server owns that judgement, so the page is told, not asked
    // to re-derive it.
    expect(parseAlbumResponse(successBody({ metadataIncomplete: true })).metadataIncomplete).toBe(
      true,
    );
    // Only an explicit `true` is true, so a body predating the field does not nag.
    expect(
      parseAlbumResponse(successBody({ metadataIncomplete: undefined })).metadataIncomplete,
    ).toBe(false);
    expect(parseAlbumResponse(successBody({ metadataIncomplete: "yes" })).metadataIncomplete).toBe(
      false,
    );
  });

  it("preserves the resolved track order exactly, never re-sorting it", () => {
    // A deliberately unsorted list: the server's order is the only order there is.
    const order = [beta, alpha];
    expect(parseAlbumResponse(successBody({ tracks: order })).tracks).toEqual(order);
  });

  it("keeps optional release metadata optional rather than inventing it", () => {
    // An id-only resolution has no title-only id, no artist, and no cover: the
    // page falls back to a placeholder, so absent fields must be `undefined`.
    const detail = parseAlbumResponse(
      successBody({ album: { title: "Dawn Chorus" }, metadataIncomplete: true }),
    );
    expect(detail.album).toEqual({
      id: undefined,
      title: "Dawn Chorus",
      artistName: undefined,
      artworkUrl: undefined,
      year: undefined,
    });
  });

  it("accepts a year only as a positive whole number", () => {
    expect(parseAlbumResponse(successBody({ album: { title: "X", year: 2019 } })).album.year).toBe(
      2019,
    );
    expect(
      parseAlbumResponse(successBody({ album: { title: "X", year: 0 } })).album.year,
    ).toBeUndefined();
    expect(
      parseAlbumResponse(successBody({ album: { title: "X", year: 2001.5 } })).album.year,
    ).toBeUndefined();
    expect(
      parseAlbumResponse(successBody({ album: { title: "X", year: "2019" } })).album.year,
    ).toBeUndefined();
  });

  it("drops blank optional strings rather than rendering empty metadata", () => {
    const detail = parseAlbumResponse(
      successBody({ album: { id: "  ", title: "Dawn Chorus", artistName: "", artworkUrl: " " } }),
    );
    expect(detail.album.id).toBeUndefined();
    expect(detail.album.artistName).toBeUndefined();
    expect(detail.album.artworkUrl).toBeUndefined();
  });

  it("reports a body with no usable release as unresolvable", () => {
    // "The provider resolved no release here" — a recoverable not-found, not a
    // failure, and never a substituted entity.
    for (const album of [undefined, null, {}, { title: "   " }, { title: 42 }]) {
      expect(() => parseAlbumResponse(successBody({ album }))).toThrowError(
        /did not resolve a release/,
      );
      try {
        parseAlbumResponse(successBody({ album }));
      } catch (error) {
        expect((error as AlbumApiError).code).toBe("unresolvable");
      }
    }
  });

  it("reports a 200 body with no tracks as unresolvable", () => {
    // A resolved release with nothing to play, like, or add would render a hero
    // over an empty list — the "blank region" the spec forbids.
    try {
      parseAlbumResponse(successBody({ tracks: [] }));
      expect.unreachable("an empty track list must not parse");
    } catch (error) {
      expect((error as AlbumApiError).code).toBe("unresolvable");
    }
  });

  it("reports a body that breaks the contract's shape as upstream_unavailable", () => {
    const bodies: unknown[] = [
      null,
      undefined,
      "Dawn Chorus",
      42,
      // An array is `typeof "object"` but is not the `{ … }` envelope.
      [alpha],
      { album: { title: "Dawn Chorus" } },
      successBody({ tracks: "Alpha" }),
      successBody({ tracks: [alpha, { title: "no id" }] }),
      successBody({ tracks: [alpha, { ...alpha, artists: "Aurora" }] }),
    ];
    for (const body of bodies) {
      try {
        parseAlbumResponse(body);
        expect.unreachable(`expected ${JSON.stringify(body)} to be rejected`);
      } catch (error) {
        expect((error as AlbumApiError).code, JSON.stringify(body)).toBe("upstream_unavailable");
      }
    }
  });

  it("keeps the diagnostics envelope usable even when absent", () => {
    expect(parseAlbumResponse(successBody({ diagnostics: undefined })).diagnostics).toEqual({
      raw: {},
    });
  });
});

describe("fetchAlbum", () => {
  it("resolves a 200 body and reports what it carried", async () => {
    const requested: Array<{ url: string; signal?: AbortSignal | null }> = [];
    const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requested.push({ url: String(input), signal: init?.signal });
      return Promise.resolve(jsonResponse(successBody()));
    });
    vi.stubGlobal("fetch", mock);

    const detail = await fetchAlbum({ key: "Dawn Chorus - Aurora" });

    expect(detail.album.title).toBe("Dawn Chorus");
    expect(detail.tracks).toEqual([alpha, beta]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(requested).toEqual([
      { url: `${ALBUM_ENDPOINT}?title=Dawn+Chorus&artist=Aurora`, signal: undefined },
    ]);
  });

  it("forwards a caller-owned abort signal", async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | null | undefined> = [];
    const mock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return Promise.resolve(jsonResponse(successBody()));
    });
    vi.stubGlobal("fetch", mock);

    await fetchAlbum({ key: "Dawn Chorus", signal: controller.signal });

    expect(signals).toEqual([controller.signal]);
  });

  it("fails an over-long key locally, without a network call", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);

    await expect(
      fetchAlbum({ key: `${"d".repeat(MAX_ALBUM_TITLE_LENGTH)} album` }),
    ).rejects.toBeInstanceOf(AlbumApiError);
    await expect(fetchAlbum({ key: "   " })).rejects.toMatchObject({ code: "invalid_request" });
    expect(mock).not.toHaveBeenCalled();
  });

  it("reads the server's structured error code", async () => {
    await expect(
      failingCode({ error: { code: "invalid_request", message: "title is required" } }, 400),
    ).resolves.toBe("invalid_request");
    await expect(failingCode({ error: { code: "unresolvable" } }, 404)).resolves.toBe(
      "unresolvable",
    );
    await expect(failingCode({ error: { code: "upstream_unavailable" } }, 503)).resolves.toBe(
      "upstream_unavailable",
    );
  });

  it("also reads a flat error-string body, in either position", async () => {
    await expect(failingCode({ error: "unresolvable" }, 404)).resolves.toBe("unresolvable");
    await expect(failingCode({ code: "unresolvable" }, 404)).resolves.toBe("unresolvable");
  });

  it("falls back to the status when the body carries no code", async () => {
    await expect(failingCode({}, 400)).resolves.toBe("invalid_request");
    await expect(failingCode({}, 422)).resolves.toBe("invalid_request");
    await expect(failingCode({}, 404)).resolves.toBe("unresolvable");
    // Any other unexpected status collapses onto the retryable code so the UI
    // always speaks one of the four designed answers.
    await expect(failingCode({}, 500)).resolves.toBe("upstream_unavailable");
    await expect(failingCode({}, 499)).resolves.toBe("upstream_unavailable");
  });

  it("falls back to the status when the error body is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          json: async () => {
            throw new TypeError("Unexpected token < in JSON");
          },
        } as unknown as Response),
      ),
    );

    await expect(fetchAlbum({ key: "Dawn Chorus" })).rejects.toMatchObject({
      code: "unresolvable",
    });
  });

  it("reports a transport failure as `network`", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await expect(fetchAlbum({ key: "Dawn Chorus" })).rejects.toMatchObject({ code: "network" });
  });

  it("rethrows a caller abort instead of reporting it as a failure", async () => {
    const controller = new AbortController();
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        controller.abort();
        return Promise.reject(abort);
      }),
    );

    await expect(fetchAlbum({ key: "Dawn Chorus", signal: controller.signal })).rejects.toBe(abort);
  });

  it("re-reads a body that dies mid-parse as a transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => {
            throw new TypeError("network error");
          },
        } as unknown as Response),
      ),
    );

    await expect(fetchAlbum({ key: "Dawn Chorus" })).rejects.toMatchObject({ code: "network" });
  });

  it("surfaces the designed code rather than a parse failure from a 200 body", async () => {
    await expect(failingCode(successBody({ tracks: [] }), 200)).resolves.toBe("unresolvable");
  });
});

describe("isRetryableAlbumError", () => {
  it("offers a retry for everything except a key that names no release", () => {
    expect(isRetryableAlbumError("upstream_unavailable")).toBe(true);
    expect(isRetryableAlbumError("network")).toBe(true);
    // A client bug may well be gone on a newer deploy, so a retry is still
    // offered for it.
    expect(isRetryableAlbumError("invalid_request")).toBe(true);
    // Retrying re-sends the same dead identifier.
    expect(isRetryableAlbumError("unresolvable")).toBe(false);
  });

  it("names the error type it reports", () => {
    const error = new AlbumApiError("unresolvable");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AlbumApiError");
    expect(error.message).toContain("unresolvable");
  });
});

describe("the album client contract", () => {
  it("parses a real Track[] shape end to end", () => {
    // Guard against a parser that accepts fixtures but not a canonical track
    // carrying an album summary and full artwork.
    const track: Track = makeTrack({
      id: "youtube:ccc",
      providerId: "ccc",
      title: "Gamma",
      album: { id: "UCdawnrelease0000000000", title: "Dawn Chorus" },
      artwork: [{ url: "https://example.test/g.jpg", width: 640, height: 640 }],
    });
    const detail = parseAlbumResponse(successBody({ tracks: [track] }));
    expect(detail.tracks[0].album?.title).toBe("Dawn Chorus");
  });
});
