import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RADIO_ARTIST_LENGTH,
  MAX_RADIO_EXCLUDE,
  MAX_RADIO_LIMIT,
  MAX_RADIO_TITLE_LENGTH,
  MAX_RADIO_VARIANT,
  RADIO_ENDPOINT,
  RADIO_KINDS,
  RadioApiError,
  buildRadioQuery,
  fetchRadioFeed,
  isRetryableRadioError,
  parseRadioResponse,
  type RadioApiErrorCode,
  type RadioFeedRequest,
} from "@/features/personalization/radioApi";
import { makeTrack } from "./helpers/music-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A well-formed success body for the given ids. */
function successBody(ids: string[] = ["vid000001"]): unknown {
  return {
    tracks: ids.map((id) => makeTrack({ id: `youtube:${id}`, providerId: id, title: `T ${id}` })),
    variant: 3,
    diagnostics: { seedsTried: 2, cached: false, resultCount: ids.length },
  };
}

/** An error body in the route's `{ error: { code, message } }` envelope. */
function errorBody(code: string): unknown {
  return { error: { code, message: `${code} happened` } };
}

/** fetch mock answering with one JSON body. */
function stubFetch(
  body: unknown,
  init: { ok?: boolean; status?: number } = {},
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () =>
      ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => body,
      }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The code carried by a thrown `RadioApiError`. */
function codeOf(error: unknown): RadioApiErrorCode | undefined {
  return error instanceof RadioApiError ? error.code : undefined;
}

/** Assert a request rejects with a `RadioApiError` carrying `code`. */
async function expectRadioError(promise: Promise<unknown>, code: RadioApiErrorCode): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(RadioApiError);
  expect(codeOf(error)).toBe(code);
}

describe("buildRadioQuery — the request carries only the documented inputs", () => {
  it("builds an artist refill from kind, artist, and the caller's variant", () => {
    const params = buildRadioQuery({ kind: "artist", artist: "Daft Punk", variant: 0 });
    expect(params.get("kind")).toBe("artist");
    expect(params.get("artist")).toBe("Daft Punk");
    expect(params.get("variant")).toBe("0");
  });

  it("builds a track refill from kind, title, and the caller's variant", () => {
    const params = buildRadioQuery({
      kind: "track",
      title: "Get Lucky",
      artist: "Daft Punk",
      variant: 2,
    });
    expect(params.get("kind")).toBe("track");
    expect(params.get("title")).toBe("Get Lucky");
    expect(params.get("artist")).toBe("Daft Punk");
    expect(params.get("variant")).toBe("2");
  });

  it("carries exactly the six documented keys, and no personalization field", () => {
    const params = buildRadioQuery({
      kind: "track",
      title: "Get Lucky",
      artist: "Daft Punk",
      variant: 1,
      limit: 10,
      exclude: ["youtube:a", "youtube:b"],
    });

    // The whole accepted surface, asserted as a sorted set so an *extra* key
    // fails this just as a missing one does.
    expect([...params.keys()].sort()).toEqual([
      "artist",
      "exclude",
      "kind",
      "limit",
      "title",
      "variant",
    ]);
    // Nothing that could carry a taste profile, a liked track, or a listener.
    for (const key of [
      "liked",
      "likedIds",
      "playlists",
      "history",
      "listeningHistory",
      "profile",
      "tasteProfile",
      "weights",
      "genres",
      "artists",
      "userId",
      "languages",
      "seedTerms",
    ]) {
      expect(params.has(key), key).toBe(false);
    }
    expect(params.toString()).not.toContain("profile");
  });

  it("omits the optional keys it was not given, and never emits an empty value", () => {
    const minimal = buildRadioQuery({ kind: "artist", artist: "Daft Punk", variant: 0 });
    expect([...minimal.keys()].sort()).toEqual(["artist", "kind", "variant"]);

    const withTitleOnly = buildRadioQuery({ kind: "track", title: "Get Lucky", variant: 0 });
    expect([...withTitleOnly.keys()].sort()).toEqual(["kind", "title", "variant"]);
  });

  it("sends the exclusion list as comma-separated ids and drops blank entries", () => {
    const params = buildRadioQuery({
      kind: "artist",
      artist: "Daft Punk",
      variant: 0,
      exclude: ["youtube:a", "  ", "", " youtube:b "],
    });
    expect(params.get("exclude")).toBe("youtube:a,youtube:b");
  });

  it("omits exclude entirely for an empty played set", () => {
    const params = buildRadioQuery({
      kind: "artist",
      artist: "Daft Punk",
      variant: 0,
      exclude: [],
    });
    expect(params.has("exclude")).toBe(false);
  });

  it("exposes the endpoint and the bounds it enforces", () => {
    expect(RADIO_ENDPOINT).toBe("/api/radio");
    expect(RADIO_KINDS).toEqual(["track", "artist"]);
    expect(MAX_RADIO_EXCLUDE).toBe(60);
    expect(MAX_RADIO_TITLE_LENGTH).toBe(200);
    expect(MAX_RADIO_ARTIST_LENGTH).toBe(200);
    expect(MAX_RADIO_VARIANT).toBe(999);
    expect(MAX_RADIO_LIMIT).toBe(50);
  });
});

describe("buildRadioQuery — local bounds, checked before any network call", () => {
  it.each([
    ["an unknown kind", { kind: "playlist" as never, artist: "Daft Punk", variant: 0 }],
    ["an artist radio with no artist", { kind: "artist" as const, artist: "   ", variant: 0 }],
    ["a track radio with no title", { kind: "track" as const, title: "", variant: 0 }],
    [
      "an over-length artist",
      { kind: "artist" as const, artist: "x".repeat(MAX_RADIO_ARTIST_LENGTH + 1), variant: 0 },
    ],
    [
      "an over-length title",
      {
        kind: "track" as const,
        title: "x".repeat(MAX_RADIO_TITLE_LENGTH + 1),
        variant: 0,
      },
    ],
    [
      "an over-length artist narrowing on a track radio",
      {
        kind: "track" as const,
        title: "Get Lucky",
        artist: "x".repeat(MAX_RADIO_ARTIST_LENGTH + 1),
        variant: 0,
      },
    ],
    ["a negative variant", { kind: "artist" as const, artist: "Daft Punk", variant: -1 }],
    ["a fractional variant", { kind: "artist" as const, artist: "Daft Punk", variant: 1.5 }],
    [
      "a variant past its bound",
      { kind: "artist" as const, artist: "Daft Punk", variant: MAX_RADIO_VARIANT + 1 },
    ],
    ["a zero limit", { kind: "artist" as const, artist: "Daft Punk", variant: 0, limit: 0 }],
    [
      "a limit past its bound",
      { kind: "artist" as const, artist: "Daft Punk", variant: 0, limit: MAX_RADIO_LIMIT + 1 },
    ],
  ])("rejects %s with invalid_request", (label, request) => {
    expect(() => buildRadioQuery(request as RadioFeedRequest), label).toThrowError(RadioApiError);
    try {
      buildRadioQuery(request as RadioFeedRequest);
    } catch (error) {
      expect(codeOf(error), label).toBe("invalid_request");
    }
  });

  it("rejects an over-long exclusion list rather than truncating it", () => {
    const tooMany = Array.from({ length: MAX_RADIO_EXCLUDE + 1 }, (_v, index) => `id-${index}`);
    try {
      buildRadioQuery({ kind: "artist", artist: "Daft Punk", variant: 0, exclude: tooMany });
      throw new Error("expected a rejection");
    } catch (error) {
      expect(codeOf(error)).toBe("invalid_request");
    }
  });

  it("accepts a list exactly on the documented bound and every bound extreme", () => {
    const exactly = Array.from({ length: MAX_RADIO_EXCLUDE }, (_v, index) => `id-${index}`);
    const params = buildRadioQuery({
      kind: "artist",
      artist: "x".repeat(MAX_RADIO_ARTIST_LENGTH),
      variant: MAX_RADIO_VARIANT,
      limit: MAX_RADIO_LIMIT,
      exclude: exactly,
    });
    expect(params.get("exclude")?.split(",")).toHaveLength(MAX_RADIO_EXCLUDE);
    expect(params.get("variant")).toBe(String(MAX_RADIO_VARIANT));
    expect(params.get("limit")).toBe(String(MAX_RADIO_LIMIT));
  });
});

describe("parseRadioResponse — validating a success body", () => {
  it("returns the tracks and the echoed variant", () => {
    const feed = parseRadioResponse(successBody(["a", "b"]));
    expect(feed.tracks.map((track) => track.providerId)).toEqual(["a", "b"]);
    expect(feed.variant).toBe(3);
  });

  it("reports an empty result as unresolvable, never as an empty success", () => {
    // The spec's "empty result, not a substitution" case reaching the client:
    // the engine ends the radio on this rather than looping on it.
    try {
      parseRadioResponse(successBody([]));
      throw new Error("expected a rejection");
    } catch (error) {
      expect(codeOf(error)).toBe("unresolvable");
    }
  });

  it.each([
    ["a non-object body", "nope"],
    ["a null body", null],
    ["an array body", []],
    ["a missing tracks array", { variant: 1 }],
    ["a non-array tracks field", { tracks: {}, variant: 1 }],
    [
      "a malformed track",
      { tracks: [{ id: 1, providerId: "a", title: "x", artists: [] }], variant: 1 },
    ],
    ["a missing variant", { tracks: [makeTrack()] }],
    ["a non-integer variant", { tracks: [makeTrack()], variant: 1.5 }],
    ["a variant past its bound", { tracks: [makeTrack()], variant: MAX_RADIO_VARIANT + 1 }],
  ])("reports %s as an upstream contract violation", (label, body) => {
    try {
      parseRadioResponse(body);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(codeOf(error), label).toBe("upstream_unavailable");
    }
  });

  it("reads the tracks in the server's resolved order, untouched", () => {
    const ids = ["c", "a", "b"];
    const feed = parseRadioResponse(successBody(ids));
    expect(feed.tracks.map((track) => track.providerId)).toEqual(ids);
  });
});

describe("fetchRadioFeed — the request and the error mapping", () => {
  it("requests the documented path with the documented parameters", async () => {
    const fetchMock = stubFetch(successBody());

    const feed = await fetchRadioFeed({
      kind: "artist",
      artist: "Daft Punk",
      variant: 4,
      limit: 12,
      exclude: ["youtube:a", "youtube:b"],
    });

    expect(feed.variant).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(calledUrl, "http://localhost:3000");
    expect(url.pathname).toBe("/api/radio");
    expect([...url.searchParams.keys()].sort()).toEqual([
      "artist",
      "exclude",
      "kind",
      "limit",
      "variant",
    ]);
    expect(url.searchParams.get("exclude")).toBe("youtube:a,youtube:b");
    expect(init.signal).toBeUndefined();
  });

  it("passes a caller-owned abort signal straight through to fetch", async () => {
    const fetchMock = stubFetch(successBody());
    const controller = new AbortController();

    await fetchRadioFeed(
      { kind: "artist", artist: "Daft Punk", variant: 0 },
      { signal: controller.signal },
    );

    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBe(controller.signal);
  });

  it("rejects an out-of-bounds request locally, without a network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "  ", variant: 0 }),
      "invalid_request",
    );
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: MAX_RADIO_VARIANT + 1 }),
      "invalid_request",
    );
    await expectRadioError(
      fetchRadioFeed({
        kind: "artist",
        artist: "Daft Punk",
        variant: 0,
        exclude: Array.from({ length: MAX_RADIO_EXCLUDE + 1 }, (_v, index) => `id-${index}`),
      }),
      "invalid_request",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each<[string, number, RadioApiErrorCode]>([
    ["a 400 invalid_request body", 400, "invalid_request"],
    ["a 404 unresolvable body", 404, "unresolvable"],
    ["a 503 upstream_unavailable body", 503, "upstream_unavailable"],
  ])("maps %s onto its designed code", async (_label, status, code) => {
    stubFetch(errorBody(code), { ok: false, status });
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: 0 }),
      code,
    );
  });

  it("reads a flat error-string body too, so one encoding is not assumed", async () => {
    stubFetch({ error: "unresolvable" }, { ok: false, status: 404 });
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: 0 }),
      "unresolvable",
    );
  });

  it.each<[number, RadioApiErrorCode]>([
    [500, "upstream_unavailable"],
    [418, "upstream_unavailable"],
    [422, "invalid_request"],
  ])("falls back to the status when the body carries no designed code", async (status, code) => {
    stubFetch({ something: "else" }, { ok: false, status });
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: 0 }),
      code,
    );
  });

  it("maps a transport failure to network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: 0 }),
      "network",
    );
  });

  it("maps a non-JSON error body to a designed code rather than network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: false,
            status: 503,
            json: async () => {
              throw new SyntaxError("Unexpected token <");
            },
          }) as unknown as Response,
      ),
    );
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: 0 }),
      "upstream_unavailable",
    );
  });

  it("rethrows a caller abort instead of reporting it as a network failure", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        void init;
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );
    controller.abort();

    await expect(
      fetchRadioFeed(
        { kind: "artist", artist: "Daft Punk", variant: 0 },
        { signal: controller.signal },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name === "AbortError",
    );
  });

  it("maps a 200 body that resolved nothing to unresolvable", async () => {
    stubFetch(successBody([]));
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: 0 }),
      "unresolvable",
    );
  });

  it("maps a malformed 200 body to upstream_unavailable", async () => {
    stubFetch({ tracks: "not-an-array", variant: 0 });
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: 0 }),
      "upstream_unavailable",
    );
  });

  it("maps a body that dies mid-read to network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected end of JSON input");
            },
          }) as unknown as Response,
      ),
    );
    await expectRadioError(
      fetchRadioFeed({ kind: "artist", artist: "Daft Punk", variant: 0 }),
      "network",
    );
  });
});

describe("RadioApiError and isRetryableRadioError", () => {
  it("carries its code and a useful message", () => {
    const error = new RadioApiError("unresolvable");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("RadioApiError");
    expect(error.code).toBe("unresolvable");
    expect(error.message).toContain("unresolvable");
  });

  it("offers a retry for transient and transport failures only", () => {
    expect(isRetryableRadioError("network")).toBe(true);
    expect(isRetryableRadioError("upstream_unavailable")).toBe(true);
    // A settled answer and a rejected request are both dead ends.
    expect(isRetryableRadioError("unresolvable")).toBe(false);
    expect(isRetryableRadioError("invalid_request")).toBe(false);
  });
});
