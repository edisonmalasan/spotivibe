import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as artistGet } from "@/app/api/artist/route";
import { GET as albumGet } from "@/app/api/album/route";
import { GET as similarGet } from "@/app/api/similar/route";

// `new URL(<literal>, import.meta.url)` is rewritten by Vite — resolve the
// bare `import.meta.url` instead, as the other route tests do.
const here = dirname(fileURLToPath(import.meta.url));
function routeSource(...segments: string[]): string {
  return readFileSync(join(here, "..", "src", "app", "api", ...segments), "utf8");
}
const artistSource = routeSource("artist", "route.ts");
const albumSource = routeSource("album", "route.ts");
const similarSource = routeSource("similar", "route.ts");

/**
 * The three endpoint handlers this file exercises. The routes are the only
 * transport boundary the catalog service has, so every branch they own is
 * asserted here rather than in the service test.
 */
const ENDPOINTS = [
  {
    name: "artist",
    get: artistGet,
    source: artistSource,
    base: "http://localhost:3000/api/artist",
    valid: { name: "Route Artist Alpha" },
    acceptedKeys: ["id", "name"],
  },
  {
    name: "album",
    get: albumGet,
    source: albumSource,
    base: "http://localhost:3000/api/album",
    valid: { title: "Route Album Bravo" },
    acceptedKeys: ["artist", "id", "title"],
  },
  {
    name: "similar",
    get: similarGet,
    source: similarSource,
    base: "http://localhost:3000/api/similar",
    valid: { title: "Route Track Charlie" },
    acceptedKeys: ["artist", "exclude", "title"],
  },
] as const;

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

/** Local-library field names that must never reach these endpoints. */
const LOCAL_DATASET_KEYS = ["likedIds", "playlists", "history", "listeningHistory", "likes"];

/**
 * The resolver's success cache lives at module scope for the whole process
 * (documented shared state), exactly as it does in production — so every
 * scenario below uses its own identifier. An identifier that collided with an
 * earlier scenario would be served from the cache and would not exercise the
 * path its test names.
 */
let scenario = 0;
function uniqueKey(prefix: string): string {
  scenario += 1;
  return `${prefix} ${scenario}`;
}

/**
 * Artist names the `ytm-search.json` fixture actually credits, cycled per
 * scenario.
 *
 * A name-keyed artist resolution only answers with tracks that credit the
 * requested artist (the service must not substitute a different entity), so a
 * synthetic name would resolve to 404 rather than exercising the 200 contract.
 */
const FIXTURE_ARTISTS = [
  "Daft Punk",
  "Pharrell Williams",
  "Nile Rodgers",
  "Julian Casablancas",
  "Vitamin String Quartet",
  "Mark Knopfler",
];
function fixtureArtist(): string {
  scenario += 1;
  return FIXTURE_ARTISTS[scenario % FIXTURE_ARTISTS.length] as string;
}

function url(base: string, params: Record<string, string> = {}): string {
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(ENDPOINTS)(
  "GET /api/$name — invalid input (400, no provider contact)",
  (endpoint) => {
    it.each([
      ["no parameters at all", {}],
      ["a blank required parameter", { ...endpoint.valid, ...blankKey(endpoint) }],
      ["a whitespace-only required parameter", { ...endpoint.valid, ...blankKey(endpoint, "   ") }],
      ["an over-length parameter", { ...endpoint.valid, ...overLengthKey(endpoint) }],
    ])("rejects %s with a structured 400 and never contacts a provider", async (_label, params) => {
      const fetchMock = vi.fn(async () => {
        throw new Error("a provider was contacted");
      });
      vi.stubGlobal("fetch", fetchMock);

      const response = await endpoint.get(new Request(url(endpoint.base, params)));

      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("invalid_request");
      expect(body.error.message).toBeTruthy();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("accepts every documented bound extreme", async () => {
      const fetchMock = stubFetch(
        JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
      );

      const response = await endpoint.get(
        new Request(
          url(endpoint.base, {
            ...endpoint.valid,
            ...boundExtremeKey(endpoint, fixtureArtist()),
          }),
        ),
      );

      // The bounds are accepted, so the request reaches the resolver rather than
      // being rejected at the schema.
      expect(response.status).not.toBe(400);
      expect(fetchMock).toHaveBeenCalled();
    });
  },
);

/** The required parameter of an endpoint, blanked. */
function blankKey(endpoint: (typeof ENDPOINTS)[number], value = ""): Record<string, string> {
  return { [requiredKey(endpoint)]: value };
}

/** The required parameter of an endpoint, pushed past its documented bound. */
function overLengthKey(endpoint: (typeof ENDPOINTS)[number]): Record<string, string> {
  return { [requiredKey(endpoint)]: "x".repeat(300) };
}

function requiredKey(endpoint: (typeof ENDPOINTS)[number]): string {
  if (endpoint.name === "artist") return "name";
  if (endpoint.name === "album") return "title";
  return "title";
}

/** The parameter pair that sits exactly on each endpoint's documented bounds. */
function boundExtremeKey(
  endpoint: (typeof ENDPOINTS)[number],
  value: string,
): Record<string, string> {
  if (endpoint.name === "artist") return { name: value, id: "y".repeat(64) };
  if (endpoint.name === "album")
    return { title: value, artist: "y".repeat(200), id: "z".repeat(64) };
  return { title: value, artist: "y".repeat(200), exclude: `youtube:${"z".repeat(11)}` };
}

describe("GET /api/artist — success contract", () => {
  it("returns identity, tracks, related artists, releases, diagnostics, and the 300s cache header", async () => {
    stubFetch(
      JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
    );

    const response = await artistGet(
      new Request(url(ENDPOINTS[0].base, { name: fixtureArtist() })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "artist",
      "diagnostics",
      "related",
      "releases",
      "tracks",
    ]);

    const artist = body.artist as Record<string, unknown>;
    expect(typeof artist.name).toBe("string");
    for (const key of Object.keys(artist)) {
      expect(["id", "name", "artworkUrl"]).toContain(key);
    }

    const tracks = body.tracks as Record<string, unknown>[];
    expect(tracks.length).toBeGreaterThan(0);
    for (const track of tracks) {
      for (const key of Object.keys(track)) expect(CANONICAL_TRACK_KEYS.has(key), key).toBe(true);
      expect(track.source).toBe("youtube");
      expect(track.capabilities).toEqual({ stream: true, offlineDownload: false });
    }

    for (const related of body.related as Record<string, unknown>[]) {
      for (const key of Object.keys(related)) {
        expect(["id", "name", "artworkUrl", "trackCount"]).toContain(key);
      }
    }
    for (const release of body.releases as Record<string, unknown>[]) {
      for (const key of Object.keys(release)) {
        expect(["id", "title", "artistName", "artworkUrl", "trackCount"]).toContain(key);
      }
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

  it("resolves an id-keyed artist without a name", async () => {
    stubFetch(
      JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
    );

    const response = await artistGet(
      new Request(url(ENDPOINTS[0].base, { id: uniqueKey("UCqxfqu95j") })),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { artist: { id?: string } };
    // The id is carried through as the entity identity.
    expect(typeof body.artist.id).toBe("string");
  });

  it("serves a repeat request from the result cache without re-querying the provider", async () => {
    const fixture = JSON.parse(
      readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8"),
    );
    const fetchMock = stubFetch(fixture);
    const name = fixtureArtist();

    const first = await artistGet(new Request(url(ENDPOINTS[0].base, { name })));
    const second = await artistGet(new Request(url(ENDPOINTS[0].base, { name })));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(2); // one resolution of two seeds
    const firstBody = (await first.json()) as { diagnostics: { cached: boolean } };
    const secondBody = (await second.json()) as { diagnostics: { cached: boolean } };
    expect(firstBody.diagnostics.cached).toBe(false);
    expect(secondBody.diagnostics.cached).toBe(true);
  });
});

describe("GET /api/artist — unresolvable (404) vs upstream (503)", () => {
  it("maps a provider that answered with nothing to a structured 404", async () => {
    // A tier answered; the filters dropped everything it carried.
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

    const response = await artistGet(
      new Request(url(ENDPOINTS[0].base, { name: uniqueKey("Nobody At All") })),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("unresolvable");
    expect(body.error.message).toBeTruthy();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("maps a total provider outage to a structured 503", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await artistGet(
      new Request(url(ENDPOINTS[0].base, { name: uniqueKey("Outage Artist") })),
    );

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
    const request = new Request(url(ENDPOINTS[0].base, { name: uniqueKey("Aborted") }), {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);

    const response = await artistGet(request);

    expect(response.status).toBe(499);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});

describe("GET /api/album — success contract and completeness flag", () => {
  it("returns the release, its tracks, metadataIncomplete, diagnostics, and the cache header", async () => {
    stubFetch(
      JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
    );

    const response = await albumGet(
      new Request(url(ENDPOINTS[1].base, { title: uniqueKey("Random Access Memories") })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");

    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "album",
      "diagnostics",
      "metadataIncomplete",
      "tracks",
    ]);
    // The flag is always explicit — the page never has to guess (design 3).
    expect(typeof body.metadataIncomplete).toBe("boolean");

    const album = body.album as Record<string, unknown>;
    // The `ytm-search` fixture carries no album metadata at all, so this release
    // is genuinely unconfirmed and **no title is claimed**: echoing the requested
    // text would have put a search phrase in the page heading, and echoing an id
    // would have put a provider token there. The view renders neutral copy instead.
    expect(body.metadataIncomplete).toBe(true);
    expect(album.title).toBeUndefined();
    for (const key of Object.keys(album)) {
      expect(["id", "title", "artistName", "artworkUrl", "year"]).toContain(key);
    }
    expect((body.tracks as unknown[]).length).toBeGreaterThan(0);
  });

  it("accepts an artist narrowing and an id alongside the title", async () => {
    stubFetch(
      JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
    );

    const response = await albumGet(
      new Request(
        url(ENDPOINTS[1].base, {
          title: uniqueKey("Discovery"),
          artist: "Daft Punk",
          id: "MPREroutealbum",
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { album: { artistName?: string } };
    expect(body.album.artistName).toBe("Daft Punk");
  });

  it("maps a total provider outage to a structured 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const response = await albumGet(
      new Request(url(ENDPOINTS[1].base, { title: uniqueKey("Outage Album") })),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unavailable");
  });
});

describe("GET /api/similar — source-track exclusion", () => {
  it("never returns the excluded source track among the candidates", async () => {
    // The exclusion is applied server-side against canonical track ids, so a
    // candidate echoed back by the tier under the excluded id is still dropped.
    const excluded = "youtube:routeSrcVid1";
    stubFetch(
      JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
    );

    const response = await similarGet(
      new Request(
        url(ENDPOINTS[2].base, {
          title: uniqueKey("Exclusion Probe"),
          artist: "Daft Punk",
          exclude: excluded,
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { tracks: Record<string, unknown>[] };
    for (const track of body.tracks) {
      expect(track.id).not.toBe(excluded);
      expect(track.providerId).not.toBe("routeSrcVid1");
    }
  });

  it("returns candidates and diagnostics with the cache header", async () => {
    stubFetch(
      JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
    );

    const response = await similarGet(
      new Request(
        url(ENDPOINTS[2].base, {
          title: uniqueKey("Get Lucky"),
          artist: "Daft Punk",
          exclude: "youtube:routeExcludeVid",
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    const body = (await response.json()) as { tracks: Record<string, unknown>[] };
    expect(Object.keys(body).sort()).toEqual(["diagnostics", "tracks"]);
    for (const track of body.tracks) {
      expect(track.id).not.toBe("youtube:routeExcludeVid");
      expect(track.providerId).not.toBe("routeExcludeVid");
    }
  });

  it("works without an exclude parameter", async () => {
    stubFetch(
      JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
    );

    const response = await similarGet(
      new Request(url(ENDPOINTS[2].base, { title: uniqueKey("Get Lucky") })),
    );

    expect(response.status).toBe(200);
  });

  it("maps a total provider outage to a structured 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const response = await similarGet(
      new Request(url(ENDPOINTS[2].base, { title: uniqueKey("Outage Similar") })),
    );

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("upstream_unavailable");
  });
});

describe("the catalog endpoints — accepted inputs are exactly the documented keys", () => {
  it.each(ENDPOINTS)("reads no query parameter other than $acceptedKeys", (endpoint) => {
    const read = [
      ...new Set(
        [...endpoint.source.matchAll(/params\.get\("([^"]+)"\)/g)].map((match) => match[1]),
      ),
    ].sort();
    expect(read).toEqual([...endpoint.acceptedKeys].sort());
  });

  it.each(ENDPOINTS)("declares no accepted query key for $name", (endpoint) => {
    const read = [...endpoint.source.matchAll(/params\.get\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    for (const key of LOCAL_DATASET_KEYS) expect(read).not.toContain(key);
  });

  it.each(ENDPOINTS)(
    "ignores extra $name parameters and never echoes local data back",
    async (endpoint) => {
      stubFetch(
        JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
      );

      const response = await endpoint.get(
        new Request(
          url(endpoint.base, {
            ...endpoint.valid,
            name: uniqueKey("Local Leak"),
            title: uniqueKey("Local Leak"),
            likedIds: "local:1",
            playlists: JSON.stringify([{ id: "local:playlist" }]),
            listeningHistory: JSON.stringify([{ trackId: "local:history" }]),
          }),
        ),
      );

      // `similar` requires only `title`, which is supplied; the others accept the
      // name/title they were given. Either way the extras are ignored.
      const serialized = JSON.stringify(await response.json());
      for (const key of LOCAL_DATASET_KEYS) expect(serialized).not.toContain(key);
      expect(serialized).not.toContain("local:1");
    },
  );

  it.each(ENDPOINTS)("sends only the entity identifier upstream for $name", async (endpoint) => {
    const fetchMock = stubFetch(
      JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
    );
    const marker = endpoint.name === "artist" ? fixtureArtist() : uniqueKey("Upstream Only");

    await endpoint.get(
      new Request(url(endpoint.base, { ...endpoint.valid, ...seedKey(endpoint, marker) })),
    );

    const bodies = fetchMock.mock.calls.map((call) => String((call[1] as RequestInit).body));
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).toContain(marker);
      expect(body).not.toContain("local:");
    }
  });
});

/** The identifier parameter an endpoint actually reads for the outbound query. */
function seedKey(endpoint: (typeof ENDPOINTS)[number], value: string): Record<string, string> {
  if (endpoint.name === "artist") return { name: value };
  if (endpoint.name === "album") return { title: value };
  return { title: value };
}

describe("the catalog endpoints — metadata only, no local library, keyless", () => {
  it.each(ENDPOINTS)("returns no media bytes from /api/$name", (endpoint) => {
    const mediaByteIndicators: Array<{ label: string; pattern: RegExp }> = [
      { label: "byte-body read", pattern: /\.\s*arrayBuffer\s*\(/ },
      { label: "blob body", pattern: /\.\s*blob\s*\(/ },
      { label: "raw response body", pattern: /new\s+Response\s*\(\s*(?!null\b)/ },
      { label: "streamed body", pattern: /new\s+ReadableStream|\bpipeThrough\b|\bpipeTo\b/ },
      {
        label: "media MIME type",
        pattern: /\b(?:audio|video)\/[a-z0-9.+-]+|application\/octet-stream/i,
      },
    ];
    const offenders = mediaByteIndicators
      .filter(({ pattern }) => pattern.test(endpoint.source))
      .map(({ label }) => label);
    expect(offenders).toEqual([]);
  });

  it.each(ENDPOINTS)(
    "serves /api/$name with no provider configuration configured",
    async (endpoint) => {
      vi.stubEnv("SPOTIVIBE_INVIDIOUS_INSTANCES", "");
      vi.stubEnv("SPOTIVIBE_PIPED_INSTANCES", "");
      vi.stubEnv("YOUTUBE_API_KEY", "");
      stubFetch(
        JSON.parse(readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8")),
      );

      const response = await endpoint.get(
        new Request(
          url(endpoint.base, {
            ...endpoint.valid,
            ...seedKey(
              endpoint,
              endpoint.name === "artist" ? fixtureArtist() : uniqueKey("Keyless"),
            ),
          }),
        ),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        diagnostics: { tiersTried: { tier: string }[] };
      };
      // The keyless primary tier answers; no credential is required.
      expect(body.diagnostics.tiersTried[0]?.tier).toBe("ytmusic");
    },
  );
});
