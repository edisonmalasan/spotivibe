import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/music/errors";
import { parsePipedSearch, pipedProvider } from "@/server/music/providers/piped";

const here = dirname(fileURLToPath(import.meta.url));
const fixture: unknown = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "providers", "piped-search.json"), "utf8"),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("parsePipedSearch (captured live fixture)", () => {
  it("extracts stream items as candidates", () => {
    const candidates = parsePipedSearch(fixture);
    expect(candidates.length).toBeGreaterThan(5);
    for (const candidate of candidates) {
      expect(candidate.videoId).toBeTruthy();
      expect(candidate.title).toBeTruthy();
      expect(candidate.tier).toBe("piped");
    }
  });

  it("parses the video id from the watch URL with title, uploader, and duration", () => {
    const [first] = parsePipedSearch(fixture);
    expect(first).toMatchObject({
      videoId: "Rgrt_8mXrK8",
      title: "Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)",
      artistText: "Daft Punk",
      artistId: "UCRr1xG_2WIDs18a6cIiCxeA",
      durationSeconds: 249,
      tier: "piped",
    });
    expect(first?.artwork[0]?.url).toBeTruthy();
  });

  it("skips non-stream items", () => {
    const candidates = parsePipedSearch({
      items: [
        { type: "channel", url: "/channel/UC123", title: "Channel" },
        { type: "stream", url: "/watch?v=abc123", title: "Song", duration: 180 },
      ],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.videoId).toBe("abc123");
  });

  it("rejects bodies without an items array with a parse-kind ProviderError", () => {
    for (const invalid of [{ error: "Instance is blocked" }, null, [], "text"]) {
      expect(() => parsePipedSearch(invalid)).toThrow(ProviderError);
    }
  });
});

describe("pipedProvider.search (mocked fetch)", () => {
  it("queries the music_songs filter on the first instance", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => fixture,
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await pipedProvider.search({ query: "daft punk get lucky", limit: 20 });
    expect(candidates.length).toBeGreaterThan(5);

    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calls[0]?.[0]).toBe(
      "https://pipedapi.ducks.party/search?q=daft%20punk%20get%20lucky&filter=music_songs",
    );
    expect(calls).toHaveLength(1);
  });

  it("rotates to the second instance when the first fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://pipedapi.ducks.party")) {
        throw new TypeError("fetch failed");
      }
      return { ok: true, status: 200, json: async () => fixture } as unknown as Response;
    }) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await pipedProvider.search({ query: "q", limit: 20 });
    expect(candidates.length).toBeGreaterThan(5);
    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calls[1]?.[0]).toContain("https://api.piped.private.coffee/search");
  });

  it("fails with the last tier error when every instance fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(pipedProvider.search({ query: "q", limit: 20 })).rejects.toMatchObject({
      name: "ProviderError",
      tier: "piped",
      kind: "network",
    });
  });

  it("honors the SPOTIVIBE_PIPED_INSTANCES override and caps attempts at two", async () => {
    vi.stubEnv(
      "SPOTIVIBE_PIPED_INSTANCES",
      "https://p1.example,https://p2.example,https://p3.example",
    );
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    await expect(pipedProvider.search({ query: "q", limit: 20 })).rejects.toBeInstanceOf(
      ProviderError,
    );
    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[0]?.[0]).toContain("https://p1.example/search");
    expect(calls[1]?.[0]).toContain("https://p2.example/search");
  });
});
