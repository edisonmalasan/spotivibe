import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runChain, toResultTracks } from "@/server/music/chain";
import { ProviderError } from "@/server/music/errors";
import type { MusicProvider, ProviderCandidate, TierId } from "@/server/music/types";
import { makeCandidate } from "./helpers/music-fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const ytwebFixture: unknown = JSON.parse(
  readFileSync(join(here, "fixtures", "providers", "ytweb-search.json"), "utf8"),
);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fake tier with a call counter. */
function fakeProvider(
  id: TierId,
  impl: () => Promise<ProviderCandidate[]>,
): MusicProvider & { calls: number } {
  const provider = {
    id,
    calls: 0,
    async search() {
      provider.calls += 1;
      return impl();
    },
  };
  return provider;
}

function rejectWith(kind: ProviderError["kind"]): () => Promise<ProviderCandidate[]> {
  return () => Promise.reject(new ProviderError("ytmusic", kind, `${kind} failure`));
}

/** fetch mock: the given URL prefix hangs until aborted; everything else resolves `body`. */
function hangingFetch(urlPrefix: string, body?: unknown): unknown {
  return vi.fn((url: string, init?: RequestInit) => {
    if (String(url).startsWith(urlPrefix)) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => body,
    }) as Promise<Response>;
  });
}

describe("runChain — tier order and stopping", () => {
  it("stops at the first tier with usable results", async () => {
    const primary = fakeProvider("ytmusic", async () => [makeCandidate()]);
    const fallback = fakeProvider("ytweb", async () => [makeCandidate({ videoId: "vid2" })]);
    const unused = fakeProvider("invidious", async () => [makeCandidate({ videoId: "vid3" })]);

    const result = await runChain(
      { query: "daft punk", limit: 20 },
      { providers: [primary, fallback, unused] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.tier).toBe("ytmusic");
      expect(result.diagnostics.tiersTried).toEqual([{ tier: "ytmusic", outcome: "ok" }]);
      expect(result.diagnostics.resultCount).toBe(1);
      expect(result.tracks[0]).toMatchObject({
        id: "youtube:vid000001",
        providerId: "vid000001",
        source: "youtube",
      });
      expect(result.tracks[0]?.qualityScore).toBeTypeOf("number");
    }
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(0);
    expect(unused.calls).toBe(0);
  });

  it("falls through a network failure to the next tier with structured diagnostics", async () => {
    const primary = fakeProvider("ytmusic", rejectWith("network"));
    const fallback = fakeProvider("ytweb", async () => [makeCandidate()]);

    const result = await runChain({ query: "q", limit: 20 }, { providers: [primary, fallback] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.tier).toBe("ytweb");
      expect(result.diagnostics.tiersTried).toEqual([
        { tier: "ytmusic", outcome: "network" },
        { tier: "ytweb", outcome: "ok" },
      ]);
    }
  });

  it("treats a junk-only answer as unusable and falls through (spec scenario)", async () => {
    const junkOnly = fakeProvider("ytmusic", async () => [
      makeCandidate({ title: "Artist Interview Compilation" }),
    ]);
    const fallback = fakeProvider("ytweb", async () => [makeCandidate({ videoId: "vid2" })]);

    const result = await runChain({ query: "q", limit: 20 }, { providers: [junkOnly, fallback] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.tier).toBe("ytweb");
      expect(result.diagnostics.tiersTried[0]).toEqual({ tier: "ytmusic", outcome: "empty" });
    }
  });

  it("keeps walking past middle-tier failures and stops before unused tiers", async () => {
    const first = fakeProvider("ytmusic", rejectWith("network"));
    const second = fakeProvider("ytweb", rejectWith("timeout"));
    const third = fakeProvider("invidious", async () => [makeCandidate()]);
    const fourth = fakeProvider("piped", async () => [makeCandidate({ videoId: "vid9" })]);

    const result = await runChain(
      { query: "q", limit: 20 },
      { providers: [first, second, third, fourth] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.tier).toBe("invidious");
      expect(result.diagnostics.tiersTried).toEqual([
        { tier: "ytmusic", outcome: "network" },
        { tier: "ytweb", outcome: "timeout" },
        { tier: "invidious", outcome: "ok" },
      ]);
    }
    expect(fourth.calls).toBe(0);
  });

  it("returns a structured failure — never a throw — when every tier fails (spec scenario)", async () => {
    const kinds: ProviderError["kind"][] = ["network", "timeout", "http", "parse"];
    const providers = kinds.map((kind, index) => {
      const id: TierId = (["ytmusic", "ytweb", "invidious", "piped"] as const)[index];
      return fakeProvider(id, () => Promise.reject(new ProviderError(id, kind, `${kind}`)));
    });

    const result = await runChain({ query: "q", limit: 20 }, { providers });

    expect(result).toMatchObject({
      ok: false,
      tiersTried: [
        { tier: "ytmusic", outcome: "network" },
        { tier: "ytweb", outcome: "timeout" },
        { tier: "invidious", outcome: "http" },
        { tier: "piped", outcome: "parse" },
      ],
    });
  });

  it("applies the requested limit after normalization, filtering, and dedupe", async () => {
    const candidates = Array.from({ length: 30 }, (_value, index) =>
      makeCandidate({ videoId: `vid${index}`, title: `Unique Song ${index}` }),
    );
    const primary = fakeProvider("ytmusic", async () => candidates);

    const result = await runChain({ query: "q", limit: 5 }, { providers: [primary] });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tracks).toHaveLength(5);
  });
});

describe("runChain — timeouts, budget, and cancellation", () => {
  it("aborts a hung upstream on the per-attempt timeout and falls through", async () => {
    // Real short timers instead of fake timers: AbortSignal.timeout is a
    // native clock, so the test drives it with a short injected timeout.
    vi.stubGlobal("fetch", hangingFetch("https://music.youtube.com", ytwebFixture));

    const result = await runChain({ query: "daft punk", limit: 20 }, { attemptTimeoutMs: 60 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.tier).toBe("ytweb");
      expect(result.diagnostics.tiersTried).toEqual([
        { tier: "ytmusic", outcome: "timeout" },
        { tier: "ytweb", outcome: "ok" },
      ]);
    }
  });

  it("stops the chain when the total budget expires, marking the rest skipped", async () => {
    vi.stubGlobal("fetch", hangingFetch("https://music.youtube.com"));

    const result = await runChain(
      { query: "q", limit: 20 },
      { budgetMs: 80, attemptTimeoutMs: 5000 },
    );

    expect(result).toMatchObject({
      ok: false,
      tiersTried: [
        { tier: "ytmusic", outcome: "timeout" },
        { tier: "ytweb", outcome: "skipped" },
        { tier: "invidious", outcome: "skipped" },
        { tier: "piped", outcome: "skipped" },
      ],
    });
  });

  it("propagates caller cancellation instead of recording a tier outcome", async () => {
    vi.stubGlobal("fetch", hangingFetch("https://music.youtube.com"));

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    // Name-based check: the abort reason may come from a different realm
    // (Node vs jsdom DOMException), so `instanceof` is unreliable here.
    await expect(
      runChain(
        { query: "q", limit: 20, signal: controller.signal },
        { budgetMs: 5000, attemptTimeoutMs: 5000 },
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name === "AbortError",
    );
  });
});

describe("toResultTracks", () => {
  it("runs the shared pipeline: junk dropped, dups collapsed, best scored first", () => {
    const tracks = toResultTracks(
      [
        makeCandidate({ videoId: "vidA", title: "Get Lucky", durationSeconds: 249 }),
        makeCandidate({ videoId: "vidB", title: "Artist Interview" }),
        makeCandidate({ videoId: "vidC", title: "Get Lucky!", durationSeconds: undefined }),
        makeCandidate({ videoId: "vidD", title: "Instant Crush", durationSeconds: 337 }),
      ],
      "get lucky instant",
      10,
    );

    expect(tracks.map((track) => track.providerId)).toEqual(["vidA", "vidD"]);
    expect(tracks[0]?.qualityScore).toBeGreaterThan(tracks[1]?.qualityScore ?? 0);
  });
});
