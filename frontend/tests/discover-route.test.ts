import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/discover/route";
import { DISCOVERY_SEED_CAP } from "@/server/music/discovery";
import { DISCOVERY_KINDS, trendingSeedsFor } from "@/server/music/discoverySeeds";

// `new URL(<literal>, import.meta.url)` is rewritten by Vite — resolve the
// bare `import.meta.url` instead, as the other route tests do.
const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(
  join(here, "..", "src", "app", "api", "discover", "route.ts"),
  "utf8",
);

const ytmFixture: unknown = JSON.parse(
  readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8"),
);

const BASE_URL = "http://localhost:3000/api/discover";

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

/** Local-library field names that must never reach this endpoint. */
const LOCAL_DATASET_KEYS = ["likedIds", "playlists", "history", "listeningHistory", "likes"];

/**
 * The route's success cache lives at module scope for the whole process
 * (documented shared state), exactly as it does in production — so every
 * scenario below uses its own kind/languages/seeds/limit tuple. A tuple that
 * collides with an earlier scenario would be served from the cache and would
 * not exercise the path its test names.
 */
function routeUrl(params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params);
  const query = search.toString();
  return query.length > 0 ? `${BASE_URL}?${query}` : BASE_URL;
}

/** fetch mock returning `body` for every call. */
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

describe("GET /api/discover — success contract", () => {
  it("returns canonical tracks, language attribution, diagnostics, and the 300s cache header", async () => {
    stubFetch(ytmFixture);

    const response = await GET(new Request(routeUrl({ kind: "trending", languages: "en" })));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(response.headers.get("Content-Type")).toContain("application/json");

    const body = (await response.json()) as {
      tracks: Record<string, unknown>[];
      diagnostics: Record<string, unknown>;
    };
    expect(Object.keys(body).sort()).toEqual(["diagnostics", "tracks"]);
    expect(body.tracks.length).toBeGreaterThan(0);
    expect(body.tracks.length).toBeLessThanOrEqual(20);

    for (const track of body.tracks) {
      for (const key of Object.keys(track)) expect(CANONICAL_TRACK_KEYS.has(key), key).toBe(true);
      expect(track.source).toBe("youtube");
      expect(typeof track.providerId).toBe("string");
      expect(track.language).toBe("en");
      expect(typeof track.qualityScore).toBe("number");
      expect(track.capabilities).toEqual({ stream: true, offlineDownload: false });
    }
    // Canonical fields only — no renderer/provider structures cross the boundary.
    expect(JSON.stringify(body)).not.toContain("flexColumns");
    expect(JSON.stringify(body)).not.toContain("musicResponsiveListItem");

    expect(Object.keys(body.diagnostics).sort()).toEqual([
      "cached",
      "kind",
      "languages",
      "resultCount",
      "seedsFailed",
      "seedsSkipped",
      "seedsTried",
      "tiersTried",
    ]);
    expect(body.diagnostics.kind).toBe("trending");
    expect(body.diagnostics.languages).toEqual(["en"]);
    expect(body.diagnostics.cached).toBe(false);
    expect(body.diagnostics.seedsTried).toBe(2);
    expect(body.diagnostics.seedsFailed).toEqual([]);
    expect(body.diagnostics.resultCount).toBe(body.tracks.length);
    for (const entry of body.diagnostics.tiersTried as Record<string, unknown>[]) {
      expect(Object.keys(entry).sort()).toEqual(["outcome", "tier"]);
    }
  });

  it("defaults to the `en` language and a limit of 20 when both are omitted", async () => {
    stubFetch(ytmFixture);

    const response = await GET(new Request(routeUrl({ kind: "collection" })));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tracks: Record<string, unknown>[];
      diagnostics: { languages: string[] };
    };
    expect(body.diagnostics.languages).toEqual(["en"]);
    expect(body.tracks.length).toBeLessThanOrEqual(20);
    for (const track of body.tracks) expect(track.language).toBe("en");
  });

  it("attribution follows the requested languages across every feed kind", async () => {
    for (const kind of DISCOVERY_KINDS) {
      vi.unstubAllGlobals();
      stubFetch(ytmFixture);
      const callerSeeded = kind === "genre" || kind === "for-you" || kind === "mix";
      const params = {
        kind,
        languages: "en,ja",
        ...(callerSeeded ? { seeds: `term-${kind}` } : {}),
      };

      const response = await GET(new Request(routeUrl(params)));

      expect(response.status, kind).toBe(200);
      const body = (await response.json()) as {
        tracks: Record<string, unknown>[];
        diagnostics: { kind: string; languages: string[] };
      };
      expect(body.diagnostics.kind).toBe(kind);
      expect(body.diagnostics.languages).toEqual(["en", "ja"]);
      expect(body.tracks.length, kind).toBeGreaterThan(0);
      for (const track of body.tracks) expect(["en", "ja"]).toContain(track.language);
    }
  });

  it("honors an explicit limit", async () => {
    stubFetch(ytmFixture);

    const response = await GET(
      new Request(routeUrl({ kind: "trending", languages: "en", limit: "5" })),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tracks: unknown[];
      diagnostics: { resultCount: number };
    };
    expect(body.tracks).toHaveLength(5);
    expect(body.diagnostics.resultCount).toBe(5);
  });

  it("serves a repeat feed from the result cache without re-querying the provider", async () => {
    const fetchMock = stubFetch(ytmFixture);

    const first = await GET(new Request(routeUrl({ kind: "trending", languages: "es" })));
    const second = await GET(new Request(routeUrl({ kind: "trending", languages: "es" })));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(2); // one composition of two seeds
    const firstBody = (await first.json()) as { diagnostics: { cached: boolean } };
    const secondBody = (await second.json()) as { diagnostics: { cached: boolean } };
    expect(firstBody.diagnostics.cached).toBe(false);
    expect(secondBody.diagnostics.cached).toBe(true);
  });

  it("does not cache failures — the next request retries upstream", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", failing);

    const first = await GET(new Request(routeUrl({ kind: "podcast", languages: "fr" })));
    const second = await GET(new Request(routeUrl({ kind: "podcast", languages: "fr" })));

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(failing.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe("GET /api/discover — validation (400, no upstream calls)", () => {
  it.each([
    ["missing kind", routeUrl({ languages: "en" })],
    ["empty kind", routeUrl({ kind: "", languages: "en" })],
    ["unknown kind", routeUrl({ kind: "charts", languages: "en" })],
    ["wrong-cased kind", routeUrl({ kind: "Trending", languages: "en" })],
    ["unknown language code", routeUrl({ kind: "trending", languages: "xx" })],
    ["one unknown among known languages", routeUrl({ kind: "trending", languages: "en,xx" })],
    ["empty language list", routeUrl({ kind: "trending", languages: "," })],
    ["too many languages", routeUrl({ kind: "trending", languages: "en,es,fr,de,pt,it,nl,sv,no" })],
    ["zero limit", routeUrl({ kind: "trending", languages: "en", limit: "0" })],
    ["over-max limit", routeUrl({ kind: "trending", languages: "en", limit: "51" })],
    ["non-numeric limit", routeUrl({ kind: "trending", languages: "en", limit: "abc" })],
    ["fractional limit", routeUrl({ kind: "trending", languages: "en", limit: "2.5" })],
    ["over-length seed term", routeUrl({ kind: "genre", languages: "en", seeds: "x".repeat(81) })],
    [
      "too many seed terms",
      routeUrl({ kind: "genre", languages: "en", seeds: "a,b,c,d,e,f,g,h,i" }),
    ],
    ["missing seeds for a caller-seeded kind", routeUrl({ kind: "for-you", languages: "en" })],
    ["empty seeds for a caller-seeded kind", routeUrl({ kind: "mix", languages: "en", seeds: "" })],
  ])("rejects %s with a structured 400 and never contacts a provider", async (_label, url) => {
    const fetchMock = vi.fn(async () => {
      throw new Error("a provider was contacted");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(url));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the documented bound extremes", async () => {
    const fetchMock = stubFetch(ytmFixture);

    const maxLanguages = routeUrl({
      kind: "trending",
      languages: "en,es,fr,de,pt,it,nl,sv",
      limit: "1",
    });
    const maxSeeds = routeUrl({
      kind: "genre",
      languages: "en",
      seeds: Array.from({ length: DISCOVERY_SEED_CAP }, (_v, i) => `t${i}`).join(","),
    });
    const maxLengthSeed = routeUrl({ kind: "genre", languages: "en", seeds: "x".repeat(80) });

    expect((await GET(new Request(maxLanguages))).status).toBe(200);
    expect((await GET(new Request(maxSeeds))).status).toBe(200);
    expect((await GET(new Request(maxLengthSeed))).status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("GET /api/discover — upstream failure (503) and abort (499)", () => {
  it("maps an all-seeds failure to a structured 503 with no-store", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(routeUrl({ kind: "collection", languages: "de" })));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.message).toMatch(/unavailable/i);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("keeps the feed successful — and never a 503 — when only one seed fails", async () => {
    // One seed's query fails on every tier; the other seed still answers.
    const failingQuery = trendingSeedsFor("pt")[0];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (String(init?.body).includes(failingQuery)) throw new TypeError("fetch failed");
      return { ok: true, status: 200, json: async () => ytmFixture } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(routeUrl({ kind: "trending", languages: "pt" })));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tracks: unknown[];
      diagnostics: { seedsTried: number; seedsFailed: string[] };
    };
    expect(body.diagnostics.seedsTried).toBe(2);
    expect(body.diagnostics.seedsFailed).toEqual([failingQuery]);
    expect(body.tracks.length).toBeGreaterThan(0);
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
    const request = new Request(routeUrl({ kind: "genre", languages: "it", seeds: "aborted" }), {
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);

    const response = await GET(request);

    expect(response.status).toBe(499);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});

describe("GET /api/discover — accepted inputs are exactly the documented keys", () => {
  it("reads no query parameter other than kind, languages, seeds, and limit", () => {
    const read = [...routeSource.matchAll(/params\.get\("([^"]+)"\)/g)].map((match) => match[1]);
    expect([...new Set(read)].sort()).toEqual(["kind", "languages", "limit", "seeds"]);
  });

  it("declares no accepted query key for liked tracks, playlists, or history", () => {
    const read = [...routeSource.matchAll(/params\.get\("([^"]+)"\)/g)].map((match) => match[1]);
    for (const key of LOCAL_DATASET_KEYS) expect(read).not.toContain(key);
  });

  it("ignores extra parameters and never echoes local data back into the response", async () => {
    stubFetch(ytmFixture);

    const response = await GET(
      new Request(
        routeUrl({
          kind: "trending",
          languages: "nl",
          likedIds: "local:1",
          playlists: JSON.stringify([{ id: "local:playlist" }]),
          listeningHistory: JSON.stringify([{ trackId: "local:history" }]),
        }),
      ),
    );

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    for (const key of LOCAL_DATASET_KEYS) expect(serialized).not.toContain(key);
    expect(serialized).not.toContain("local:1");
  });

  it("sends only the feed kind, languages, and seed terms upstream", async () => {
    const fetchMock = stubFetch(ytmFixture);

    await GET(new Request(routeUrl({ kind: "genre", languages: "en,fr", seeds: "jazz" })));

    const bodies = fetchMock.mock.calls.map((call) => String((call[1] as RequestInit).body));
    // Two languages, one term each — no caller data beyond the term itself.
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect(body).toContain("jazz");
      expect(body).not.toContain("local:");
    }
  });
});

describe("GET /api/discover — metadata only", () => {
  it("returns no media bytes: the route body is JSON with no stream or media type", async () => {
    // The same indicator set `architecture.test.ts` applies to every route.
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
      .filter(({ pattern }) => pattern.test(routeSource))
      .map(({ label }) => label);
    expect(offenders).toEqual([]);
  });

  it("returns JSON metadata only — no base64 payload, blob URL, or media URL", async () => {
    stubFetch(ytmFixture);

    const response = await GET(
      new Request(routeUrl({ kind: "trending", languages: "sv", limit: "7" })),
    );
    const text = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Type")).not.toMatch(/audio|video|octet-stream/i);
    expect(text).not.toMatch(/data:[a-z/+-]+;base64,/);
    expect(text).not.toContain("blob:");
    // The only URLs in a track are artwork URLs; no media location is present.
    const body = JSON.parse(text) as { tracks: Record<string, unknown>[] };
    for (const track of body.tracks) {
      for (const key of Object.keys(track)) {
        expect(["streamUrl", "audioUrl", "url", "src", "data", "bytes"]).not.toContain(key);
      }
      for (const artwork of track.artwork as { url: string }[]) {
        expect(artwork.url.startsWith("https://")).toBe(true);
      }
    }
  });
});

describe("GET /api/discover — keyless baseline", () => {
  it("serves a feed with no provider configuration and no stored user profile", async () => {
    vi.stubEnv("SPOTIVIBE_INVIDIOUS_INSTANCES", "");
    vi.stubEnv("SPOTIVIBE_PIPED_INSTANCES", "");
    vi.stubEnv("YOUTUBE_API_KEY", "");
    stubFetch(ytmFixture);

    const response = await GET(
      new Request(routeUrl({ kind: "mix", languages: "en", seeds: "keyless" })),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tracks: unknown[];
      diagnostics: { tiersTried: { tier: string }[] };
    };
    expect(body.tracks.length).toBeGreaterThan(0);
    expect(body.diagnostics.tiersTried[0]?.tier).toBe("ytmusic");
  });
});
