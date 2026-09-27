import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";

const here = dirname(fileURLToPath(import.meta.url));
const ytmFixture: unknown = JSON.parse(
  readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8"),
);

const BASE_URL = "http://localhost:3000/api/search";

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

function routeUrl(query?: string, limit?: string): string {
  const params = new URLSearchParams();
  if (query !== undefined) params.set("q", query);
  if (limit !== undefined) params.set("limit", limit);
  return `${BASE_URL}?${params.toString()}`;
}

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

describe("GET /api/search — success path", () => {
  it("returns canonical tracks, safe diagnostics, and shared cache headers", async () => {
    stubFetch(ytmFixture);

    const response = await GET(new Request(routeUrl("daft punk get lucky")));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");

    const body = (await response.json()) as {
      tracks: Record<string, unknown>[];
      diagnostics: Record<string, unknown>;
    };
    expect(body.tracks.length).toBeGreaterThan(0);
    expect(body.tracks.length).toBeLessThanOrEqual(20);

    for (const track of body.tracks) {
      // Canonical fields only — no renderer/provider structures cross the boundary.
      for (const key of Object.keys(track)) expect(CANONICAL_TRACK_KEYS.has(key)).toBe(true);
      expect(track.source).toBe("youtube");
      expect(typeof track.providerId).toBe("string");
      expect(typeof track.qualityScore).toBe("number");
      expect(track.capabilities).toEqual({ stream: true, offlineDownload: false });
    }
    expect(JSON.stringify(body)).not.toContain("flexColumns");
    expect(JSON.stringify(body)).not.toContain("musicResponsiveListItem");

    // Diagnostics safe subset: only tier ids/outcomes and cache state.
    expect(Object.keys(body.diagnostics).sort()).toEqual([
      "cached",
      "resultCount",
      "tier",
      "tiersTried",
    ]);
    expect(body.diagnostics.tier).toBe("ytmusic");
    expect(body.diagnostics.cached).toBe(false);
    for (const entry of body.diagnostics.tiersTried as { tier: string; outcome: string }[]) {
      expect(Object.keys(entry).sort()).toEqual(["outcome", "tier"]);
    }
  });

  it("marks a repeat query within the TTL as cached without re-querying", async () => {
    const fetchMock = stubFetch(ytmFixture);

    const first = await GET(new Request(routeUrl("cache hit query")));
    const second = await GET(new Request(routeUrl("  CACHE HIT QUERY  ")));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const firstBody = (await first.json()) as { diagnostics: { cached: boolean } };
    const secondBody = (await second.json()) as {
      diagnostics: { cached: boolean };
      tracks: unknown[];
    };
    expect(firstBody.diagnostics.cached).toBe(false);
    expect(secondBody.diagnostics.cached).toBe(true);
    expect(secondBody.tracks.length).toBeGreaterThan(0);
  });

  it("applies the default limit and honors an explicit one", async () => {
    stubFetch(ytmFixture);

    const defaulted = await GET(new Request(routeUrl("limit default query")));
    expect(defaulted.status).toBe(200);
    const defaultedBody = (await defaulted.json()) as { tracks: unknown[] };
    expect(defaultedBody.tracks.length).toBeGreaterThan(5);

    const bounded = await GET(new Request(routeUrl("limit explicit query", "5")));
    expect(bounded.status).toBe(200);
    const boundedBody = (await bounded.json()) as { tracks: unknown[] };
    expect(boundedBody.tracks).toHaveLength(5);
  });
});

describe("GET /api/search — validation (400, no upstream calls)", () => {
  it.each([
    ["missing q", routeUrl()],
    ["empty q", routeUrl("")],
    ["whitespace-only q", routeUrl("   ")],
    ["over-length q", routeUrl("x".repeat(201))],
    ["zero limit", routeUrl("query", "0")],
    ["over-max limit", routeUrl("query", "51")],
    ["non-numeric limit", routeUrl("query", "abc")],
    ["fractional limit", routeUrl("query", "2.5")],
  ])("rejects %s with a structured 400 and never contacts a provider", async (_label, url) => {
    const fetchMock = stubFetch(ytmFixture);

    const response = await GET(new Request(url));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_query");
    expect(body.error.message).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/search — all tiers failed (503)", () => {
  it("returns a structured, human-readable 503 with no-store", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(routeUrl("upstream down query")));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.message).toMatch(/unavailable/i);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not cache failures — the next request retries upstream", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", failing);

    const first = await GET(new Request(routeUrl("flaky query")));
    const second = await GET(new Request(routeUrl("flaky query")));

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(failing.mock.calls.length).toBeGreaterThanOrEqual(6); // 2 requests × ≥3 tiers
  });
});

describe("GET /api/search — keyless baseline (task 5.2)", () => {
  it("completes with an empty server environment (no provider configuration)", async () => {
    vi.stubEnv("SPOTIVIBE_INVIDIOUS_INSTANCES", "");
    vi.stubEnv("SPOTIVIBE_PIPED_INSTANCES", "");
    vi.stubEnv("YOUTUBE_API_KEY", "");
    stubFetch(ytmFixture);

    const response = await GET(new Request(routeUrl("keyless baseline query")));

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      tracks: unknown[];
      diagnostics: { tier: string };
    };
    expect(body.tracks.length).toBeGreaterThan(0);
    expect(body.diagnostics.tier).toBe("ytmusic");
  });
});
