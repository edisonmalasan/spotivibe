import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as lyricsGet } from "@/app/api/lyrics/route";
import { resetLyricsCaches } from "@/server/lyrics/lyricsService";

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(
  join(here, "..", "src", "app", "api", "lyrics", "route.ts"),
  "utf8",
);

const VIDEO_ID = "dQw4w9WgXcQ";

/** Build a request to the route with the given query parameters. */
function request(params: Record<string, string | undefined>): Request {
  const url = new URL("http://localhost/api/lyrics");
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return new Request(url, { signal: new AbortController().signal });
}

const OK_QUERY = {
  videoId: VIDEO_ID,
  title: "Artist - Song (Official Video)",
  artist: "Artist",
  channel: "Channel",
  duration: "210",
};

/** Stub the global fetch the service ultimately uses. */
function stubProvider(body: unknown, init?: { status?: number; reject?: Error }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (init?.reject) throw init.reject;
    return new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

beforeEach(() => {
  resetLyricsCaches();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/lyrics — validation", () => {
  it("rejects a missing video id before any provider call", async () => {
    const provider = stubProvider([]);
    const response = await lyricsGet(request({ title: "Song" }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(provider).not.toHaveBeenCalled();
  });

  it("rejects a malformed video id", async () => {
    // Lyrix's own route validates with `/^[a-zA-Z0-9_-]{11}$/`; an over-short or over-long id is
    // the malformed input the spec names, and it must never reach an extractor.
    for (const videoId of ["short", "way-too-long-video-id", "has spaces", "bad!chars!"]) {
      const provider = stubProvider([]);
      const response = await lyricsGet(request({ ...OK_QUERY, videoId }));
      expect(response.status, `videoId ${JSON.stringify(videoId)}`).toBe(400);
      expect(provider).not.toHaveBeenCalled();
    }
  });

  it("rejects an over-long title rather than truncating it", async () => {
    const response = await lyricsGet(request({ ...OK_QUERY, title: "x".repeat(1000) }));
    expect(response.status).toBe(400);
  });

  it("rejects a negative or absurd duration", async () => {
    expect((await lyricsGet(request({ ...OK_QUERY, duration: "-5" }))).status).toBe(400);
    expect((await lyricsGet(request({ ...OK_QUERY, duration: "99999999" }))).status).toBe(400);
  });

  it("rejects a non-integer duration", async () => {
    expect((await lyricsGet(request({ ...OK_QUERY, duration: "12.5" }))).status).toBe(400);
  });

  it("treats an empty duration as unknown rather than malformed", async () => {
    // `?duration=` is "not given", not a bad number. Reporting 400 for an omitted optional
    // parameter would be a validation bug that a real client hits constantly.
    stubProvider([]);
    const response = await lyricsGet(request({ ...OK_QUERY, duration: "" }));
    expect(response.status).toBe(200);
  });

  it("accepts a request with only a video id, since duration is optional", async () => {
    stubProvider([]);
    const response = await lyricsGet(request({ videoId: VIDEO_ID }));
    expect(response.status).toBe(200);
  });
});

describe("GET /api/lyrics — outcomes", () => {
  it("returns the provider's raw strings on a hit", async () => {
    stubProvider([
      { trackName: "Song", duration: 210, syncedLyrics: "[00:10]a", plainLyrics: "a" },
    ]);
    const response = await lyricsGet(request(OK_QUERY));
    const body = await response.json();

    expect(response.status).toBe(200);
    // Parsing is the client's concern (design decision 1): the route returns text, not lines.
    expect(body).toEqual({
      status: "ok",
      syncedLyrics: "[00:10]a",
      plainLyrics: "a",
    });
  });

  it("returns 200 with an explicit unavailable status, not a 404 and not a 5xx", async () => {
    // The load-bearing assertion of this route. "No lyrics for this track" is a successful
    // answer to the question asked, and the most common answer for a large part of the
    // catalogue. A client distinguishing absent from broken by status code will get it wrong.
    stubProvider([]);
    const response = await lyricsGet(request(OK_QUERY));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.status).toBeLessThan(400);
    expect(body.status).toBe("unavailable");
    expect(body.syncedLyrics).toBeNull();
    expect(body.plainLyrics).toBeNull();
  });

  it("caches an unavailable answer only briefly", async () => {
    // A shared cache holding this for a week would hide lyrics for a track that gains them.
    stubProvider([]);
    const response = await lyricsGet(request(OK_QUERY));
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "")?.[1]);
    expect(maxAge).toBeLessThanOrEqual(300);
  });

  it("returns 503 when the provider cannot be reached", async () => {
    stubProvider(null, { reject: new TypeError("network down") });
    const response = await lyricsGet(request(OK_QUERY));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("upstream_unavailable");
  });

  it("returns 503 rather than 200/unavailable when the provider answers unintelligibly", async () => {
    // An HTML error page from a proxy is a failure, not "this song has no words". Collapsing the
    // two would show the listener "no lyrics" for a provider outage.
    stubProvider("<html>502</html>" as never);
    const response = await lyricsGet(request(OK_QUERY));
    expect(response.status).toBe(503);
  });

  it("does not cache a failure, so the next request retries", async () => {
    const provider = stubProvider(null, { reject: new TypeError("down") });
    await lyricsGet(request(OK_QUERY));
    expect(provider).toHaveBeenCalledTimes(1);

    provider.mockRestore();
    stubProvider([{ trackName: "Song", duration: 210, syncedLyrics: "[00:01]x" }]);
    const recovered = await lyricsGet(request(OK_QUERY));
    expect((await recovered.json()).status).toBe("ok");
  });

  it("returns 499 when the caller disconnects mid-flight", async () => {
    const controller = new AbortController();
    const url = new URL("http://localhost/api/lyrics");
    for (const [key, value] of Object.entries(OK_QUERY)) url.searchParams.set(key, value);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });

    const response = await lyricsGet(
      new Request(url, { signal: controller.signal as unknown as AbortSignal }),
    );
    expect(response.status).toBe(499);
  });

  it("marks errors no-store so a transient failure is not cached by a proxy", async () => {
    stubProvider(null, { reject: new TypeError("down") });
    const response = await lyricsGet(request(OK_QUERY));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/lyrics — privacy boundary", () => {
  // The spotivibe rule, asserted rather than assumed: a taste profile is weights over local data,
  // and a query parameter of one of these names would be a profile leaving the device.
  const LOCAL_ONLY_KEYS = [
    "liked",
    "likedIds",
    "likes",
    "playlists",
    "history",
    "listeningHistory",
    "profile",
    "tasteProfile",
    "weights",
    "genres",
    "artists",
    "userId",
    "sessionId",
  ];

  it("reads no taste-profile parameter", () => {
    for (const key of LOCAL_ONLY_KEYS) {
      expect(routeSource, `route must not read a \`${key}\` parameter`).not.toContain(
        `params.get("${key}")`,
      );
    }
  });

  it("sends only the track's own metadata to the provider", async () => {
    const provider = stubProvider([]);
    await lyricsGet(request(OK_QUERY));
    const url = String(provider.mock.calls[0]?.[0]);
    expect(url).toContain("track_name=");
    // The cleaned query must not carry the decoration the raw title had.
    expect(url).not.toContain("Official");
  });
});
