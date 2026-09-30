import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/search/route";
import type { Track } from "@/data/repositories";

/**
 * M12 task 3.1: the route's input surface gains exactly one parameter.
 *
 * `category` is enumerated rather than free text, so an unknown value is
 * rejected by the same 400 path as an empty query and no provider is contacted.
 * The other three properties are the ones that keep this from becoming a data
 * channel: the default is music, the response carries the resolved category, and
 * the accepted keys are exactly `q`, `limit`, `category`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ytmFixture: unknown = JSON.parse(
  readFileSync(join(here, "fixtures", "providers", "ytm-search.json"), "utf8"),
);

const BASE_URL = "http://localhost:3000/api/search";

function routeUrl(params: Record<string, string>): string {
  return `${BASE_URL}?${new URLSearchParams(params).toString()}`;
}

function stubFetch(body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function get(url: string): Promise<Response> {
  return GET(new Request(url));
}

/**
 * A minimal YouTube Web search body holding two long-form episodes.
 *
 * The suite's existing ytweb fixture is all music at 2-18 minutes, which is the
 * wrong shape for this route: a podcast request pins the category, so the only
 * honest way to assert the response is to give the pipeline something that *is* a
 * podcast result set. Both titles deliberately contain words music rules reject
 * ("interview", "remix") and both durations clear the podcast floor.
 */
function podcastSearchBody(): unknown {
  const video = (videoId: string, title: string, lengthText: string, channel: string) => ({
    videoRenderer: {
      videoId,
      title: { runs: [{ text: title }] },
      lengthText: { simpleText: lengthText },
      ownerText: { runs: [{ text: channel }] },
      thumbnail: {
        thumbnails: [{ url: `https://example.test/${videoId}.jpg`, width: 120, height: 120 }],
      },
    },
  });

  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: [
                    video(
                      "ep-ro-1",
                      "Interview: The Fall of Rome, part one",
                      "1:02:11",
                      "History Hour",
                    ),
                    video(
                      "ep-mi-1",
                      "The Remix nobody asked for — episode 12",
                      "48:07",
                      "Late Night Talk",
                    ),
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/api/search: the category parameter (M12)", () => {
  it("accepts podcast and returns podcast-labelled tracks", async () => {
    stubFetch(podcastSearchBody());
    const response = await get(routeUrl({ q: "history", category: "podcast" }));
    expect(response.status).toBe(200);

    const body = (await response.json()) as { tracks: Track[] };
    expect(body.tracks).toHaveLength(2);
    // The mode is a promise about the result set: every track must honour it, and
    // both titles carry words the *music* rules would have deleted.
    expect(body.tracks.every((track) => track.category === "podcast")).toBe(true);
    expect(body.tracks.map((track) => track.title)).toEqual([
      "Interview: The Fall of Rome, part one",
      "The Remix nobody asked for — episode 12",
    ]);
    expect(body.tracks[0]?.durationSeconds).toBe(3731);
  });

  it("sends the podcast question upstream, not the music one", async () => {
    const fetchMock = stubFetch(podcastSearchBody());
    // A distinct query from the case above: the service caches successful results
    // for a minute, so an identical request would answer from cache and prove
    // nothing about what went upstream.
    const response = await get(routeUrl({ q: "true crime", category: "podcast" }));
    expect(response.status).toBe(200);

    // Podcast mode skips YouTube Music, so the only requests that went out are the
    // Web tier's — and its body carries the podcast hint with no " song" suffix.
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")));
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.every((body) => body.params !== undefined)).toBe(true);
    expect(bodies.some((body) => String(body.query).includes(" song"))).toBe(false);
    expect(bodies.every((body) => body.query === "true crime")).toBe(true);
  });

  it("never serves a music-mode result for a podcast query, or the reverse", async () => {
    // The cache key carries the category (task 1.1), and this is where that stops
    // being an implementation detail. The podcast request succeeds first, so it is
    // genuinely cached — failures are never cached, which would make a cache
    // assertion here vacuous.
    const fetchMock = stubFetch(podcastSearchBody());
    const first = await get(routeUrl({ q: "cache probe", category: "podcast" }));
    expect(first.status).toBe(200);
    const afterPodcast = fetchMock.mock.calls.length;
    expect(afterPodcast).toBeGreaterThan(0);

    const repeat = await get(routeUrl({ q: "cache probe", category: "podcast" }));
    expect(repeat.status).toBe(200);
    const repeatBody = (await repeat.json()) as { diagnostics?: { cached?: boolean } };
    // Same mode, same query: the cache answers, so no second upstream call.
    expect(repeatBody.diagnostics?.cached).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(afterPodcast);

    await get(routeUrl({ q: "cache probe" }));
    // Other mode, same query: a different key, so it cannot reuse that entry.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterPodcast);
  });

  it("defaults to music when the parameter is absent", async () => {
    stubFetch(ytmFixture);
    const response = await get(routeUrl({ q: "lo-fi" }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { tracks: Track[] };
    expect(body.tracks.length).toBeGreaterThan(0);
    // The M3 fixture carries ordinary music results; a podcast request would
    // have relabelled them.
    expect(body.tracks.every((track) => track.category === "music")).toBe(true);
  });

  it("rejects an unknown category without contacting a provider", async () => {
    const fetchMock = stubFetch(ytmFixture);
    const response = await get(routeUrl({ q: "history", category: "audiobooks" }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_query");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts exactly q, limit, and category", async () => {
    const source = readFileSync(
      join(here, "..", "src", "app", "api", "search", "route.ts"),
      "utf8",
    );
    const accepted = [...source.matchAll(/\bparams\.get(?:All)?\(\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    // The exact set, so a future local-data parameter fails here rather than
    // shipping outward (the same rule the discovery and catalog routes carry).
    expect([...new Set(accepted)].sort()).toEqual(["category", "limit", "q"]);
  });

  it("reads no liked, playlist, history, or profile parameter", async () => {
    const source = readFileSync(
      join(here, "..", "src", "app", "api", "search", "route.ts"),
      "utf8",
    );
    const accepted = [...source.matchAll(/\bparams\.get(?:All)?\(\s*["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    for (const key of [
      "liked",
      "likedIds",
      "playlist",
      "history",
      "listeningHistory",
      "profile",
      "deviceId",
    ]) {
      expect(accepted, key).not.toContain(key);
    }
  });
});
