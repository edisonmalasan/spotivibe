import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/music/errors";
import { parseYtmusicSearch, ytmusicProvider } from "@/server/music/providers/ytmusic";

const here = dirname(fileURLToPath(import.meta.url));
const fixture: unknown = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "providers", "ytm-search.json"), "utf8"),
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseYtmusicSearch (captured live fixture)", () => {
  it("extracts every songs-shelf item as a candidate", () => {
    const candidates = parseYtmusicSearch(fixture);
    expect(candidates).toHaveLength(20);
    for (const candidate of candidates) {
      expect(candidate.videoId).toBeTruthy();
      expect(candidate.title).toBeTruthy();
      expect(candidate.tier).toBe("ytmusic");
      expect(candidate.artwork.length).toBeGreaterThan(0);
      for (const artwork of candidate.artwork) expect(artwork.url).toBeTruthy();
    }
  });

  it("parses title, artists, album, and duration from the flex columns", () => {
    const [first, second] = parseYtmusicSearch(fixture);
    expect(first).toMatchObject({
      videoId: "Rgrt_8mXrK8",
      title: "Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)",
      artistText: "Daft Punk, Pharrell Williams, Nile Rodgers",
      albumTitle: "Get Lucky (Radio Edit - feat. Pharrell Williams and Nile Rodgers)",
      durationSeconds: 249, // "4:09" — parsed, not Lyrix's hard-coded 240
      tier: "ytmusic",
    });
    expect(second).toMatchObject({
      videoId: "4D7u5KF7SP8",
      albumTitle: "Random Access Memories",
      albumId: "MPREb_K8qWMWVqXGi",
      durationSeconds: 370, // "6:10"
    });
  });

  it("never produces candidates with unparsable durations for present duration text", () => {
    for (const candidate of parseYtmusicSearch(fixture)) {
      expect(candidate.durationSeconds).toBeGreaterThanOrEqual(60);
    }
  });

  it("rejects a non-object body with a parse-kind ProviderError", () => {
    for (const invalid of [null, "text", 42, []]) {
      expect(() => parseYtmusicSearch(invalid)).toThrow(ProviderError);
      try {
        parseYtmusicSearch(invalid);
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toMatchObject({ name: "ProviderError", tier: "ytmusic", kind: "parse" });
      }
    }
  });

  it("returns no candidates for an object without music items", () => {
    expect(parseYtmusicSearch({ responseContext: {} })).toEqual([]);
  });
});

describe("ytmusicProvider.search (mocked fetch)", () => {
  it("posts the WEB_REMIX context, query, and songs filter param", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => fixture,
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await ytmusicProvider.search({ query: "daft punk get lucky", limit: 20 });
    expect(candidates.length).toBe(20);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toBe("https://music.youtube.com/youtubei/v1/search");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Origin: "https://music.youtube.com",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init.body as string) as {
      query: string;
      params: string;
      context: { client: { clientName: string } };
    };
    expect(body.query).toBe("daft punk get lucky");
    expect(body.params).toBe("EgWKAQIIAQ%3D%3D");
    expect(body.context.client.clientName).toBe("WEB_REMIX");
  });

  it("wraps network failures as a ProviderError with kind network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(ytmusicProvider.search({ query: "q", limit: 20 })).rejects.toMatchObject({
      name: "ProviderError",
      tier: "ytmusic",
      kind: "network",
    });
  });

  it("propagates caller aborts untouched (not a tier failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) {
          return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      ytmusicProvider.search({ query: "q", limit: 20, signal: controller.signal }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
  });
});
