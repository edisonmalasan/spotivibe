import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARTIST_ENDPOINT,
  ArtistApiError,
  isRetryableArtistError,
  MAX_ARTIST_ID_LENGTH,
  MAX_ARTIST_NAME_LENGTH,
  buildArtistQuery,
  fetchArtist,
  parseArtistResponse,
  type ArtistApiErrorCode,
} from "@/features/artist/artistApi";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M9 task 3.2: the client artist API contract (spec: `catalog` — "Catalog
 * entity keys and resolution requests"; design §1/§2).
 *
 * Query construction and the bounds that keep a request server-valid, response
 * parsing (canonical tracks plus the derived sections, diagnostics left opaque),
 * and the four designed error codes. The two cases this module exists to get
 * right are pinned hardest: a **200 body that resolved nothing** is
 * `unresolvable` — not a success with empty sections — and a key is sent as
 * `id` **or** `name`, never both, so an unresolvable id is never re-sent as a
 * name that might match a different artist.
 */

const CHANNEL_ID = "UCabcdefghijklmnopqrstuv";

const trackA = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Alpha",
  artists: [{ name: "Aurora" }],
  album: { title: "Dawn" },
});
const trackB = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Beta",
  artists: [{ name: "Aurora" }, { name: "Beacon" }],
});

function query(key: string): URLSearchParams {
  return new URL(buildArtistQuery({ key }), "http://local.test").searchParams;
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** The route's structured error envelope: `{ error: { code, message } }`. */
function errorResponse(status: number, code: string): Response {
  return { ok: false, status, json: async () => ({ error: { code } }) } as unknown as Response;
}

function flatErrorResponse(status: number, code: string): Response {
  return { ok: false, status, json: async () => ({ error: code }) } as unknown as Response;
}

function brokenErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("Body was not JSON.");
    },
  } as unknown as Response;
}

/** A minimal valid 200 payload, with the sections a caller wants to vary. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artist: { id: CHANNEL_ID, name: "Aurora", artworkUrl: "https://example.test/a.jpg" },
    tracks: [trackA, trackB],
    related: [{ id: "UCbeacon", name: "Beacon", trackCount: 1 }],
    releases: [{ id: "UCdawn", title: "Dawn", artistName: "Aurora", trackCount: 1 }],
    diagnostics: { seedsTried: 2, resultCount: 2, cached: false },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("artist query construction", () => {
  it("sends an id-shaped key as `id` and nothing else", () => {
    const params = query(CHANNEL_ID);
    expect([...params.keys()]).toEqual(["id"]);
    expect(params.get("id")).toBe(CHANNEL_ID);
    expect(params.get("name")).toBeNull();
  });

  it("sends a text key as `name` and nothing else", () => {
    const params = query("Aurora Sky");
    expect([...params.keys()]).toEqual(["name"]);
    expect(params.get("name")).toBe("Aurora Sky");
    expect(params.get("id")).toBeNull();
  });

  it("targets the artist endpoint and passes a caller-owned signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => okResponse(body()));
    vi.stubGlobal("fetch", fetchMock);

    const detail = await fetchArtist({ key: CHANNEL_ID, signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`${ARTIST_ENDPOINT}?`),
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(detail.artist.name).toBe("Aurora");
  });

  it("carries only the identifier — no library, user, or history parameter", () => {
    // The request surface is a fixed two-key contract; a liked-track, playlist,
    // or history field has no place in it (spec: "Requests carry only the
    // identifier").
    expect([...query(CHANNEL_ID).keys()]).toEqual(["id"]);
    expect([...query("Aurora Sky").keys()]).toEqual(["name"]);
    expect(buildArtistQuery({ key: "Aurora Sky" })).not.toContain(trackA.id);
    expect(buildArtistQuery({ key: "Aurora Sky" })).not.toContain("youtube:");
    expect(buildArtistQuery({ key: "Aurora Sky" })).not.toContain(trackA.title);
  });
});

describe("artist parameter bounds", () => {
  it("rejects a blank key before touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const key of ["", "   ", "\n\t "]) {
      expect(() => buildArtistQuery({ key })).toThrow(
        expect.objectContaining({ code: "invalid_request" }),
      );
    }
    await expect(fetchArtist({ key: "  " })).rejects.toMatchObject({
      name: "ArtistApiError",
      code: "invalid_request",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an identifier past its bound, in both key shapes", () => {
    expect(() => buildArtistQuery({ key: `UC${"a".repeat(MAX_ARTIST_ID_LENGTH)}` })).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
    // The bound is inclusive: exactly at the limit still builds.
    expect(buildArtistQuery({ key: "U".repeat(MAX_ARTIST_ID_LENGTH) })).toContain(ARTIST_ENDPOINT);

    // A name long enough to be bounded must still be *name*-shaped, or it would
    // classify as an opaque id and be measured against the other bound.
    const name = (length: number) => `Aurora ${"a".repeat(length - 7)}`;
    expect(() => buildArtistQuery({ key: name(MAX_ARTIST_NAME_LENGTH + 1) })).toThrow(
      expect.objectContaining({ code: "invalid_request" }),
    );
    expect(buildArtistQuery({ key: name(MAX_ARTIST_NAME_LENGTH) })).toContain(ARTIST_ENDPOINT);
  });

  it("fails an out-of-bounds request before touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchArtist({ key: "a".repeat(MAX_ARTIST_NAME_LENGTH + 1) }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("artist response parsing", () => {
  it("returns the identity, the canonical tracks, and both derived sections", () => {
    const detail = parseArtistResponse(body());

    expect(detail.artist).toEqual({
      id: CHANNEL_ID,
      name: "Aurora",
      artworkUrl: "https://example.test/a.jpg",
    });
    expect(detail.tracks).toEqual([trackA, trackB]);
    expect(detail.related).toEqual([
      { id: "UCbeacon", name: "Beacon", artworkUrl: undefined, trackCount: 1 },
    ]);
    expect(detail.releases).toEqual([
      { id: "UCdawn", title: "Dawn", artistName: "Aurora", artworkUrl: undefined, trackCount: 1 },
    ]);
  });

  it("keeps the diagnostics envelope opaque rather than making it a contract", () => {
    // No client surface renders a diagnostic field, and provider tier
    // outcomes must not become a client contract — so nothing is projected and
    // the untouched payload is still available.
    const detail = parseArtistResponse(body());
    expect(detail.diagnostics.raw).toEqual({
      seedsTried: 2,
      resultCount: 2,
      cached: false,
    });
    expect(parseArtistResponse(body({ diagnostics: undefined })).diagnostics).toEqual({ raw: {} });
    expect(parseArtistResponse(body({ diagnostics: "nope" })).diagnostics).toEqual({ raw: {} });
  });

  it("reports a 200 body that resolved no tracks as unresolvable", () => {
    // The load-bearing case: an artist with no tracks would render an identity
    // and three empty sections — exactly the "blank region" the spec forbids —
    // so this is a not-found answer, not a success.
    expect(() => parseArtistResponse(body({ tracks: [] }))).toThrow(
      expect.objectContaining({ name: "ArtistApiError", code: "unresolvable" }),
    );
  });

  it("reports a 200 body with no usable artist as unresolvable", () => {
    for (const artist of [
      undefined,
      null,
      {},
      { name: "" },
      { name: "   " },
      { name: 42 },
      "nope",
    ]) {
      expect(() => parseArtistResponse(body({ artist }))).toThrow(
        expect.objectContaining({ code: "unresolvable" }),
      );
    }
  });

  it("reports a body that violates the contract shape as upstream_unavailable", () => {
    // Not a resolution answer — a broken contract — so it is a retryable failure
    // rather than a claim that this artist does not exist. A body with no
    // `tracks` at all is a broken payload, distinct from one that resolved an
    // artist and then found nothing (which is `unresolvable`).
    for (const bad of [null, "nope", 42, [], { artist: { name: "Aurora" } }]) {
      expect(() => parseArtistResponse(bad)).toThrow(
        expect.objectContaining({ code: "upstream_unavailable" }),
      );
    }
    expect(() => parseArtistResponse(body({ tracks: "nope" }))).toThrow(
      expect.objectContaining({ code: "upstream_unavailable" }),
    );
    expect(() => parseArtistResponse(body({ tracks: [trackA, { nope: true }] }))).toThrow(
      expect.objectContaining({ code: "upstream_unavailable" }),
    );
  });

  it("drops unusable derived entries instead of failing the whole page", () => {
    // Releases and related artists are "where the provider gave us something";
    // one bad entry must not cost the user the entire artist page.
    const detail = parseArtistResponse(
      body({
        related: [null, {}, { name: "" }, { name: "Beacon", trackCount: 4 }],
        releases: ["nope", { title: "" }, { title: "Dawn" }],
      }),
    );
    expect(detail.related.map((entry) => entry.name)).toEqual(["Beacon"]);
    expect(detail.releases.map((entry) => entry.title)).toEqual(["Dawn"]);
  });

  it("treats absent derived sections and absent counts as empty, not as a failure", () => {
    const detail = parseArtistResponse({
      artist: { name: "Aurora" },
      tracks: [trackA],
    });
    expect(detail.related).toEqual([]);
    expect(detail.releases).toEqual([]);
    expect(detail.artist.id).toBeUndefined();

    const counted = parseArtistResponse(
      body({
        related: [{ name: "Beacon", trackCount: -3 }],
        releases: [{ title: "Dawn", trackCount: "many" }],
      }),
    );
    expect(counted.related[0]?.trackCount).toBe(0);
    expect(counted.releases[0]?.trackCount).toBe(0);
  });

  it("keeps the parsed tracks canonical", () => {
    const detail = parseArtistResponse(body());
    expect(detail.tracks[0]).toMatchObject({
      id: "youtube:aaa",
      source: "youtube",
      providerId: "aaa",
      category: "music",
    });
  });
});

describe("artist error codes", () => {
  it("maps a 400 structured error onto invalid_request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(400, "invalid_request")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      name: "ArtistApiError",
      code: "invalid_request",
    });
  });

  it("maps a 404 structured error onto unresolvable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "unresolvable")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      name: "ArtistApiError",
      code: "unresolvable",
    });
  });

  it("maps a 503 structured error onto upstream_unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(503, "upstream_unavailable")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      name: "ArtistApiError",
      code: "upstream_unavailable",
    });
  });

  it("falls back to the status for non-JSON, unknown-code, and flat bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => brokenErrorResponse(400)),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      code: "invalid_request",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(400, "mystery")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      code: "invalid_request",
    });

    // A body code outranks the status when the two disagree.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => flatErrorResponse(500, "unresolvable")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({ code: "unresolvable" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => flatErrorResponse(500, "invalid_input")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      code: "invalid_request",
    });

    // No readable code: the status decides.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, "mystery")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({ code: "unresolvable" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(499, "mystery")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(500, "mystery")),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      code: "upstream_unavailable",
    });
  });

  it("maps a fetch rejection onto network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      name: "ArtistApiError",
      code: "network",
    });
  });

  it("maps a malformed success body onto upstream_unavailable", async () => {
    // The identity resolves, so this is a broken *payload* rather than an
    // unresolvable artist.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(body({ tracks: "nope" }))),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({
      name: "ArtistApiError",
      code: "upstream_unavailable",
    });
  });

  it("maps a 200 body that resolved nothing onto unresolvable through fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse(body({ tracks: [] }))),
    );
    await expect(fetchArtist({ key: "Aurora" })).rejects.toMatchObject({ code: "unresolvable" });
  });

  it("rethrows an abort instead of reporting a network failure", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw abortError;
      }),
    );

    await expect(fetchArtist({ key: "Aurora", signal: controller.signal })).rejects.toBe(
      abortError,
    );
  });
});

describe("ArtistApiError", () => {
  it("names itself and defaults its message from the code", () => {
    const error = new ArtistApiError("network");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ArtistApiError");
    expect(error.message).toContain("network");
    expect(new ArtistApiError("unresolvable", "custom").message).toBe("custom");
  });

  it("treats every code but unresolvable as worth retrying", () => {
    // `unresolvable` is the route saying this key names no artist; re-sending
    // the same dead identifier is not a recovery.
    const retryable: ArtistApiErrorCode[] = ["invalid_request", "upstream_unavailable", "network"];
    for (const code of retryable) expect(isRetryableArtistError(code), code).toBe(true);
    expect(isRetryableArtistError("unresolvable")).toBe(false);
  });
});
