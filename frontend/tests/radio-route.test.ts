import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as radioGet } from "@/app/api/radio/route";
import { RADIO_MAX_EXCLUDE, RADIO_MAX_LIMIT, RADIO_MAX_VARIANT } from "@/server/music/radio";

// `new URL(<literal>, import.meta.url)` is rewritten by Vite — resolve the
// bare `import.meta.url` instead, as the other route tests do.
const here = dirname(fileURLToPath(import.meta.url));
function routeSource(...segments: string[]): string {
  return readFileSync(join(here, "..", "src", "app", "api", ...segments), "utf8");
}
const radioSource = routeSource("radio", "route.ts");

/** Canonical Track fields (ROADMAP §8.1) — nothing outside this set may appear. */
const CANONICAL_TRACK_KEYS = new Set([
  "id",
  "source",
  "providerId",
  "title",
  "artists",
  "album",
  "artwork",
  "durationSeconds",
  "category",
  "explicit",
  "language",
  "qualityScore",
  "capabilities",
]);

/**
 * Local-library/taste-profile names that must never be **read** as a query
 * parameter by this endpoint. `artists` and `genres` are here because a taste
 * profile is sent as weights over exactly those, and a parameter of that name
 * would be a profile leaving the device.
 */
const LOCAL_QUERY_KEYS = [
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

/**
 * The same names minus the canonical `Track` fields (`artists`, `album`, …), for
 * the check that a *response* carries none of them: a track's own artist credits
 * are provider metadata, not user data.
 */
const ECHOED_LOCAL_KEYS = LOCAL_QUERY_KEYS.filter((key) => !CANONICAL_TRACK_KEYS.has(key));

/** The exact input surface this endpoint documents. */
const ACCEPTED_KEYS = ["artist", "exclude", "kind", "limit", "title", "variant"];

/**
 * The resolver's success cache lives at module scope for the whole process
 * (documented shared state), exactly as it does in production — so every
 * scenario below uses its own identity. An identity that collided with an
 * earlier scenario would be served from the cache and would not exercise the
 * path its test names.
 */
let scenario = 0;
function uniqueArtist(): string {
  scenario += 1;
  return `Route Radio Artist ${scenario}`;
}

function url(params: Record<string, string> = {}): string {
  const base = "http://localhost:3000/api/radio";
  const search = new URLSearchParams(params).toString();
  return search.length > 0 ? `${base}?${search}` : base;
}

/** fetch mock returning a body whose items credit `artistText`. */
function stubFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function searchFixture(): unknown {
  return JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/radio — invalid input (400, no provider contact)", () => {
  it.each([
    ["no parameters at all", {}],
    ["an unknown kind", { kind: "playlist", artist: "Daft Punk" }],
    ["a missing kind", { artist: "Daft Punk" }],
    ["a blank kind", { kind: "  ", artist: "Daft Punk" }],
    ["an artist radio with no artist", { kind: "artist" }],
    ["an artist radio with a blank artist", { kind: "artist", artist: "   " }],
    ["a track radio with no title", { kind: "track" }],
    ["a track radio with a blank title", { kind: "track", title: "   " }],
    ["an over-length artist", { kind: "artist", artist: "x".repeat(201) }],
    ["an over-length title", { kind: "track", title: "x".repeat(201) }],
    ["a negative variant", { kind: "artist", artist: "Daft Punk", variant: "-1" }],
    ["a fractional variant", { kind: "artist", artist: "Daft Punk", variant: "1.5" }],
    ["a non-numeric variant", { kind: "artist", artist: "Daft Punk", variant: "next" }],
    ["a variant past its bound", { kind: "artist", artist: "Daft Punk", variant: "1000" }],
    ["a zero limit", { kind: "artist", artist: "Daft Punk", limit: "0" }],
    ["a negative limit", { kind: "artist", artist: "Daft Punk", limit: "-5" }],
    ["a fractional limit", { kind: "artist", artist: "Daft Punk", limit: "2.5" }],
    ["a limit past its bound", { kind: "artist", artist: "Daft Punk", limit: "51" }],
  ])("rejects %s with a structured 400 and never contacts a provider", async (_label, params) => {
    const fetchMock = vi.fn(async () => {
      throw new Error("a provider was contacted");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await radioGet(new Request(url(params)));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an over-long exclusion list instead of silently truncating it", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("a provider was contacted");
    });
    vi.stubGlobal("fetch", fetchMock);
    const tooMany = Array.from({ length: RADIO_MAX_EXCLUDE + 1 }, (_v, index) => `id-${index}`);

    const response = await radioGet(
      new Request(url({ kind: "artist", artist: "Daft Punk", exclude: tooMany.join(",") })),
    );

    // A truncated list would quietly re-serve already-played tracks, so the
    // whole request is refused before anything was sent.
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toMatch(/at most 60/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an over-long excluded id", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("a provider was contacted");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await radioGet(
      new Request(
        url({ kind: "artist", artist: "Daft Punk", exclude: `youtube:${"z".repeat(200)}` }),
      ),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts every documented bound extreme", async () => {
    const fetchMock = stubFetch(searchFixture());

    const response = await radioGet(
      new Request(
        url({
          kind: "artist",
          artist: uniqueArtist(),
          title: "y".repeat(200),
          variant: String(RADIO_MAX_VARIANT),
          limit: String(RADIO_MAX_LIMIT),
          exclude: Array.from({ length: RADIO_MAX_EXCLUDE }, (_v, index) => `id-${index}`).join(
            ",",
          ),
        }),
      ),
    );

    // The bounds are accepted, so the request reaches the resolver rather than
    // being rejected at the schema.
    expect(response.status).not.toBe(400);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("GET /api/radio — success contract", () => {
  it("returns canonical tracks, the echoed variant, diagnostics, and the 300s cache header", async () => {
    stubFetch(searchFixture());

    const response = await radioGet(
      new Request(url({ kind: "artist", artist: uniqueArtist(), variant: "0" })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["diagnostics", "tracks", "variant"]);
    expect(body.variant).toBe(0);

    const tracks = body.tracks as Record<string, unknown>[];
    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) {
      for (const key of Object.keys(track)) expect(CANONICAL_TRACK_KEYS.has(key), key).toBe(true);
      expect(track.source).toBe("youtube");
      expect(track.capabilities).toEqual({ stream: true, offlineDownload: false });
    }

    // Diagnostics are the documented safe subset and never a provider shape.
    const diagnostics = body.diagnostics as Record<string, unknown>;
    expect(Object.keys(diagnostics).sort()).toEqual([
      "cached",
      "resultCount",
      "seedsFailed",
      "seedsSkipped",
      "seedsTried",
      "tiersTried",
    ]);
    expect(diagnostics.cached).toBe(false);
    expect(diagnostics.seedsTried).toBeGreaterThanOrEqual(1);
    expect(diagnostics.seedsTried).toBeLessThanOrEqual(2);
    expect(JSON.stringify(body)).not.toContain("flexColumns");
    expect(JSON.stringify(body)).not.toContain("musicResponsiveListItem");
  });

  it("serves a track radio and reports the variant it planned from", async () => {
    stubFetch(searchFixture());

    const response = await radioGet(
      new Request(
        url({
          kind: "track",
          title: `Route Radio Track ${(scenario += 1)}`,
          artist: "Daft Punk",
          variant: "3",
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { tracks: unknown[]; variant: number };
    expect(body.variant).toBe(3);
    expect(body.tracks.length).toBeGreaterThan(0);
  });

  it("answers a repeat request from the result cache without re-querying the provider", async () => {
    const fetchMock = stubFetch(searchFixture());
    const artist = uniqueArtist();

    const first = await radioGet(new Request(url({ kind: "artist", artist })));
    const second = await radioGet(new Request(url({ kind: "artist", artist })));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(2); // one resolution of two seeds
    const firstBody = (await first.json()) as { diagnostics: { cached: boolean } };
    const secondBody = (await second.json()) as { diagnostics: { cached: boolean } };
    expect(firstBody.diagnostics.cached).toBe(false);
    expect(secondBody.diagnostics.cached).toBe(true);
  });

  it("honors the exclusion list server-side, by canonical id and by providerId", async () => {
    stubFetch(searchFixture());
    const artist = uniqueArtist();

    const probe = (await radioGet(new Request(url({ kind: "artist", artist })))).json() as Promise<{
      tracks: { id: string; providerId: string }[];
    }>;
    const { tracks } = await probe;
    expect(tracks.length).toBeGreaterThan(1);
    const [first, second] = tracks as [
      { id: string; providerId: string },
      { id: string; providerId: string },
    ];

    // Exclude one track by its canonical id and one by its bare providerId, and
    // assert neither spelling of either id comes back.
    const response = await radioGet(
      new Request(
        url({
          kind: "artist",
          artist: uniqueArtist(),
          exclude: `${first?.id},${second?.providerId}`,
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { tracks: { id: string; providerId: string }[] };
    for (const id of [first?.id, first?.providerId, second?.id, second?.providerId]) {
      expect(body.tracks.some((track) => track.id === id || track.providerId === id)).toBe(false);
    }
  });
});

describe("GET /api/radio — unresolvable (404) vs upstream (503)", () => {
  it("maps a provider that answered with nothing to a structured 404", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        contents: {
          tabbedSearchResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  title: "YT Music",
                  selected: true,
                  content: { sectionListRenderer: { contents: [] } },
                },
              },
            ],
          },
        },
      }),
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    const response = await radioGet(new Request(url({ kind: "artist", artist: uniqueArtist() })));

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unresolvable");
    expect(body.error.message).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("maps an all-excluded result to a 404 rather than substituting material", async () => {
    stubFetch(searchFixture());
    const artist = uniqueArtist();
    const probe = (await radioGet(new Request(url({ kind: "artist", artist })))).json() as Promise<{
      tracks: { id: string; providerId: string }[];
    }>;
    const { tracks } = await probe;
    expect(tracks.length).toBeGreaterThan(0);
    // Exclude every id the previous resolution returned, in both spellings.
    const everyId = tracks.flatMap((track) => [track.id, track.providerId]);

    const response = await radioGet(
      new Request(url({ kind: "artist", artist, exclude: everyId.join(",") })),
    );

    // The spec's "empty result, not a substitution" case: the endpoint reports
    // an empty feed rather than serving something outside this identity.
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unresolvable");
  });

  it("maps a total provider outage to a structured 503", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await radioGet(new Request(url({ kind: "artist", artist: uniqueArtist() })));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.message).toMatch(/unavailable/i);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("answers 499 when the caller aborts mid-flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );

    const controller = new AbortController();
    const request = new Request(url({ kind: "artist", artist: uniqueArtist() }), {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);

    const response = await radioGet(request);

    expect(response.status).toBe(499);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});

describe("GET /api/radio — the accepted inputs are exactly the documented keys", () => {
  it("reads no query parameter other than the six documented ones", () => {
    const read = [
      ...new Set([...radioSource.matchAll(/params\.get\("([^"]+)"\)/g)].map((match) => match[1])),
    ].sort();
    expect(read).toEqual(ACCEPTED_KEYS);
  });

  it("declares no accepted query key that names a local dataset or a caller", () => {
    const read = [...radioSource.matchAll(/params\.get\("([^"]+)"\)/g)].map((match) => match[1]);
    for (const key of LOCAL_QUERY_KEYS) expect(read).not.toContain(key);
  });

  it("ignores extra personalization parameters and never echoes local data back", async () => {
    stubFetch(searchFixture());

    const response = await radioGet(
      new Request(
        url({
          kind: "artist",
          artist: uniqueArtist(),
          likedIds: "local:1",
          playlists: "local:playlist",
          listeningHistory: "local:history",
          profile: '{"artists":[{"name":"Daft Punk","weight":9}]}',
          userId: "local:user",
        }),
      ),
    );

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    for (const key of ECHOED_LOCAL_KEYS) expect(serialized).not.toContain(key);
    expect(serialized).not.toContain("local:");
  });

  it("sends only the radio identity and its rotation index upstream", async () => {
    const fetchMock = stubFetch(searchFixture());
    const artist = uniqueArtist();

    await radioGet(new Request(url({ kind: "artist", artist, variant: "2" })));

    const bodies = fetchMock.mock.calls.map((call) => String((call[1] as RequestInit).body));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      // The curated seed phrases and the identity — nothing about the caller.
      expect(body).toContain(artist);
      expect(body).not.toContain("local:");
      expect(body).not.toContain("likedIds");
    }
  });
});

describe("GET /api/radio — metadata only, no local library, keyless", () => {
  it("returns no media bytes from /api/radio", () => {
    const mediaByteIndicators: Array<{ label: string; pattern: RegExp }> = [
      { label: "byte-body read", pattern: /\.\s*arrayBuffer\s*\(/ },
      { label: "blob body", pattern: /\.\s*blob\s*\(/ },
      { label: "raw response body", pattern: /new\s+Response\s*\(\s*(?!null\b)/ },
      { label: "streamed body", pattern: /new\s+ReadableStream|\bpipeThrough\b|\bpipeTo\b/ },
      {
        label: "media MIME type",
        pattern: /\b(?:audio|video)\/[a-z0-9.+-]+|\bapplication\/octet-stream/i,
      },
    ];
    const offenders = mediaByteIndicators
      .filter(({ pattern }) => pattern.test(radioSource))
      .map(({ label }) => label);
    expect(offenders).toEqual([]);
  });

  it("imports nothing from the local data layer", () => {
    const dataLayerImports = [...radioSource.matchAll(/from\s*["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((specifier) => specifier.startsWith("@/data/"));
    expect(dataLayerImports).toEqual([]);
  });

  it("serves the endpoint with no provider configuration configured", async () => {
    vi.stubEnv("SPOTIVIBE_INVIDIOUS_INSTANCES", "");
    vi.stubEnv("SPOTIVIBE_PIPED_INSTANCES", "");
    vi.stubEnv("YOUTUBE_API_KEY", "");
    stubFetch(searchFixture());

    const response = await radioGet(new Request(url({ kind: "artist", artist: uniqueArtist() })));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      diagnostics: { tiersTried: { tier: string }[] };
    };
    // The keyless primary tier answers; no credential is required.
    expect(body.diagnostics.tiersTried[0]?.tier).toBe("ytmusic");
  });
});
