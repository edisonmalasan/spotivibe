import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/playlist/route";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures", "providers");

function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as T;
}

const firstPage: unknown = fixture("ytm-playlist.json");
const continuationPage: unknown = fixture("ytm-playlist-continuation.json");
const missingPage: unknown = fixture("ytm-playlist-missing.json");

const BASE_URL = "http://localhost:3000/api/playlist";

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
  "capabilities",
]);

/**
 * Each scenario uses its own playlist id: the route's success cache lives at
 * module scope for the whole process (documented shared state), exactly as it
 * does in production.
 */
function routeUrl(src?: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (src !== undefined) params.set("src", src);
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  return `${BASE_URL}?${params.toString()}`;
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/playlist — validation (400, no upstream call)", () => {
  it.each([
    ["missing src", routeUrl()],
    ["empty src", routeUrl("")],
    ["whitespace-only src", routeUrl("   ")],
    ["over-length src", routeUrl("x".repeat(501))],
    ["arbitrary text", routeUrl("my favorite playlist")],
    ["non-YouTube host", routeUrl("https://example.com/playlist?list=PLaaaaaaaaaaaa")],
    ["protocol-less YouTube URL", routeUrl("www.youtube.com/playlist?list=PLaaaaaaaaaaaa")],
    ["URL without a list parameter", routeUrl("https://www.youtube.com/watch?v=3E78T8h5EhA")],
  ])("rejects %s with a structured 400 and never contacts a provider", async (_label, url) => {
    const fetchMock = vi.fn(async () => {
      throw new Error("a provider was contacted");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(url));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "invalid_input" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/playlist — error mappings", () => {
  it("maps a definitive upstream unavailable answer to 404 and stops at the first tier", async () => {
    const fetchMock = servePages(missingPage);
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(routeUrl("PLroute404aaaaa")));

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "playlist_unavailable" });
    // The definitive answer ends the chain — no fallback tier is contacted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps an all-tiers-failed resolution to 503 with no-store", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(routeUrl("PLroute503aaaaa")));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "upstream_unavailable" });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("does not cache failures — the next request retries upstream", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await GET(new Request(routeUrl("PLrouteFlakyaaaaa")));
    const second = await GET(new Request(routeUrl("PLrouteFlakyaaaaa")));

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(8); // 2 requests × ≥4 tiers
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
    const request = new Request(routeUrl("PLroute499aaaaa"), { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    const response = await GET(request);

    expect(response.status).toBe(499);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});

describe("GET /api/playlist — success contract", () => {
  it("returns the playlist, canonical tracks, tier-only diagnostics, and the 60s cache header", async () => {
    const fetchMock = servePages(firstPage, continuationPage);
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(routeUrl("PLrouteOkaaaaaa")));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");

    const body = (await response.json()) as {
      playlist: Record<string, unknown>;
      diagnostics: Record<string, unknown>;
    };

    expect(Object.keys(body).sort()).toEqual(["diagnostics", "playlist"]);
    expect(Object.keys(body.playlist).sort()).toEqual([
      "description",
      "skipped",
      "title",
      "tracks",
    ]);
    expect(body.playlist.title).toContain("Perfect Sunday Morning Songs");
    expect(body.playlist.skipped).toBe(0);
    expect(body.playlist.truncated).toBeUndefined();

    const tracks = body.playlist.tracks as Record<string, unknown>[];
    expect(tracks).toHaveLength(200);
    for (const track of tracks) {
      for (const key of Object.keys(track)) expect(CANONICAL_TRACK_KEYS.has(key)).toBe(true);
      expect(track.source).toBe("youtube");
      expect(typeof track.providerId).toBe("string");
      expect(track).not.toHaveProperty("qualityScore");
      expect(track.capabilities).toEqual({ stream: true, offlineDownload: false });
    }
    // Source order survives the boundary (first row → first track).
    expect(tracks[0]?.providerId).toBe("3E78T8h5EhA");
    expect(tracks[100]?.providerId).toBe("ZQFmRXgeR-s");

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("flexColumns");
    expect(serialized).not.toContain("musicResponsiveListItem");
    expect(serialized).not.toContain("playlistItemData");
    expect(serialized).not.toContain("qualityScore");

    // Diagnostics carry tier ids/outcomes only.
    expect(Object.keys(body.diagnostics)).toEqual(["tiers"]);
    const tiers = body.diagnostics.tiers as { tier: string; outcome: string }[];
    expect(tiers.length).toBeGreaterThan(0);
    for (const entry of tiers) expect(Object.keys(entry).sort()).toEqual(["outcome", "tier"]);
  });

  it("serves a repeat request for the same playlist from the result cache", async () => {
    const fetchMock = servePages(firstPage, continuationPage);
    vi.stubGlobal("fetch", fetchMock);

    const first = await GET(new Request(routeUrl("PLrouteCachedaa")));
    const second = await GET(new Request(routeUrl("PLrouteCachedaa")));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one resolution: first page + continuation
    const body = (await second.json()) as { playlist: { tracks: unknown[] } };
    expect(body.playlist.tracks).toHaveLength(200);
  });

  it("accepts only `src` — extra parameters never feed local data into the response", async () => {
    const fetchMock = servePages(firstPage, continuationPage);
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        routeUrl("PLrouteExtraparam", {
          name: "Injected name",
          description: "Injected description",
          tracks: JSON.stringify([{ id: "local:1" }]),
          likedIds: "local:1",
        }),
      ),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { playlist: Record<string, unknown> };
    expect(Object.keys(body).sort()).toEqual(["diagnostics", "playlist"]);
    expect(body.playlist.title).toContain("Perfect Sunday Morning Songs");
    expect(JSON.stringify(body)).not.toContain("local:1");
    expect(JSON.stringify(body)).not.toContain("Injected");

    // The outbound call carries only the playlist id — no user data.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("music.youtube.com/youtubei/v1/browse");
    expect(init.body).toContain("VLPLrouteExtraparam");
    expect(init.body).not.toContain("Injected");
    expect(init.body).not.toContain("local:1");
  });
});
