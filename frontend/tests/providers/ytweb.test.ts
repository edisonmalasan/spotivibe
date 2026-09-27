import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/music/errors";
import { parseYtwebSearch, ytwebProvider } from "@/server/music/providers/ytweb";

const here = dirname(fileURLToPath(import.meta.url));
const fixture: unknown = JSON.parse(
  readFileSync(join(here, "..", "fixtures", "providers", "ytweb-search.json"), "utf8"),
);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseYtwebSearch (captured live fixture)", () => {
  it("extracts videoRenderer results as candidates", () => {
    const candidates = parseYtwebSearch(fixture);
    expect(candidates).toHaveLength(17);
    for (const candidate of candidates) {
      expect(candidate.videoId).toBeTruthy();
      expect(candidate.title).toBeTruthy();
      expect(candidate.tier).toBe("ytweb");
    }
  });

  it("parses title, channel, duration, and artwork", () => {
    const [first] = parseYtwebSearch(fixture);
    expect(first).toMatchObject({
      videoId: "5NV6Rdv1a3I",
      title: "Daft Punk - Get Lucky (Official Audio) ft. Pharrell Williams, Nile Rodgers",
      artistText: "Daft Punk",
      artistId: "UC_kRDKYrUlrbtrSiyu5Tflg",
      durationSeconds: 249, // "4:09"
      tier: "ytweb",
    });
    expect(first?.artwork.length).toBeGreaterThan(0);
    expect(first?.artwork[0]?.url).toContain("i.ytimg.com/vi/5NV6Rdv1a3I");
  });

  it("keeps durations numeric or undefined (absent lengthText)", () => {
    for (const candidate of parseYtwebSearch(fixture)) {
      expect(
        candidate.durationSeconds === undefined || typeof candidate.durationSeconds === "number",
      ).toBe(true);
    }
  });

  it("rejects a non-object body with a parse-kind ProviderError", () => {
    expect(() => parseYtwebSearch(null)).toThrow(ProviderError);
    expect(() => parseYtwebSearch([])).toThrow(ProviderError);
  });

  it("returns no candidates for a response without renderers", () => {
    expect(parseYtwebSearch({ responseContext: {} })).toEqual([]);
  });
});

describe("ytwebProvider.search (mocked fetch)", () => {
  it("appends ' song' to the query (reference-derived web search behavior)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => fixture,
    })) as unknown as ReturnType<typeof vi.fn>;
    vi.stubGlobal("fetch", fetchMock);

    const candidates = await ytwebProvider.search({ query: "daft punk get lucky", limit: 20 });
    expect(candidates).toHaveLength(17);

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toBe("https://www.youtube.com/youtubei/v1/search");
    const body = JSON.parse(init.body as string) as {
      query: string;
      context: { client: { clientName: string } };
    };
    expect(body.query).toBe("daft punk get lucky song");
    expect(body.context.client.clientName).toBe("WEB");
  });

  it("wraps http failures as a ProviderError with kind http and the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => ({ ok: false, status: 403, json: async () => ({}) }) as unknown as Response,
      ),
    );
    await expect(ytwebProvider.search({ query: "q", limit: 20 })).rejects.toMatchObject({
      name: "ProviderError",
      tier: "ytweb",
      kind: "http",
    });
  });

  it("wraps invalid JSON bodies as a ProviderError with kind parse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected token");
            },
          }) as unknown as Response,
      ),
    );
    await expect(ytwebProvider.search({ query: "q", limit: 20 })).rejects.toMatchObject({
      name: "ProviderError",
      tier: "ytweb",
      kind: "parse",
    });
  });
});
