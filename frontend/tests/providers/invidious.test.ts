import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/music/errors";
import { invidiousProvider, parseInvidiousSearch } from "@/server/music/providers/invidious";

const here = dirname(fileURLToPath(import.meta.url));
const fixture: unknown = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "providers", "invidious-search.json"), "utf8"),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("parseInvidiousSearch (captured live fixture)", () => {
  it("extracts every video item as a candidate", () => {
    const candidates = parseInvidiousSearch(fixture);
    expect(candidates).toHaveLength(20);
    for (const candidate of candidates) {
      expect(candidate.videoId).toBeTruthy();
      expect(candidate.title).toBeTruthy();
      expect(candidate.tier).toBe("invidious");
      expect(candidate.artwork.length).toBeGreaterThan(0);
    }
  });

  it("parses title, author, channel id, duration, and artwork", () => {
    const [first] = parseInvidiousSearch(fixture);
    expect(first).toMatchObject({
      videoId: "5NV6Rdv1a3I",
      title: "Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers",
      artistText: "Daft Punk",
      artistId: "UC_kRDKYrUlrbtrSiyu5Tflg",
      durationSeconds: 249,
      tier: "invidious",
    });
  });

  it("rejects a non-array body with a parse-kind ProviderError", () => {
    for (const invalid of [{ error: "not found" }, null, "text", 42]) {
      expect(() => parseInvidiousSearch(invalid)).toThrow(ProviderError);
    }
  });

  it("skips non-video items", () => {
    const candidates = parseInvidiousSearch([
      { type: "playlist", title: "Mix", videoId: "PL_x" },
      { type: "video", title: "Song", videoId: "abc123", lengthSeconds: 200 },
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.videoId).toBe("abc123");
  });
});

describe("invidiousProvider.search (mocked fetch)", () => {
  it("rotates to the second instance when the first fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("https://yewtu.be")) throw new TypeError("fetch failed");
      return { ok: true, status: 200, json: async () => fixture } as unknown as Response;
    }) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await invidiousProvider.search({ query: "daft punk", limit: 20 });
    expect(candidates).toHaveLength(20);

    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calls[0]?.[0]).toContain("https://yewtu.be/api/v1/search");
    expect(calls[1]?.[0]).toContain("https://invidious.f5.si/api/v1/search");
    expect(calls[0][0]).toContain("q=daft%20punk");
    expect(calls[0][0]).toContain("type=video");
  });

  it("fails with the last tier error when every instance fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(invidiousProvider.search({ query: "q", limit: 20 })).rejects.toMatchObject({
      name: "ProviderError",
      tier: "invidious",
      kind: "network",
    });
  });

  it("honors the SPOTIVIBE_INVIDIOUS_INSTANCES override", async () => {
    vi.stubEnv("SPOTIVIBE_INVIDIOUS_INSTANCES", "https://custom.example/,https://second.example");
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    await expect(invidiousProvider.search({ query: "q", limit: 20 })).rejects.toBeInstanceOf(
      ProviderError,
    );
    const calls = fetchMock.mock.calls as unknown as Array<[string]>;
    expect(calls[0]?.[0]).toContain("https://custom.example/api/v1/search");
    expect(calls[1]?.[0]).toContain("https://second.example/api/v1/search");
  });

  it("caps rotation at two instance attempts regardless of override size", async () => {
    vi.stubEnv(
      "SPOTIVIBE_INVIDIOUS_INSTANCES",
      "https://one.example,https://two.example,https://three.example",
    );
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    await expect(invidiousProvider.search({ query: "q", limit: 20 })).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates caller aborts untouched instead of rotating", async () => {
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
      invidiousProvider.search({ query: "q", limit: 20, signal: controller.signal }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === "AbortError",
    );
  });
});
