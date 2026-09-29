import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import {
  DISCOVERY_ENDPOINT,
  DISCOVERY_KINDS,
  DISCOVERY_LIMIT,
  DiscoveryError,
  MAX_DISCOVERY_LIMIT,
  MAX_DISCOVERY_LANGUAGES,
  MAX_DISCOVERY_SEEDS,
  MAX_SEED_LENGTH,
  MIN_DISCOVERY_LIMIT,
  buildDiscoveryQuery,
  fetchDiscoveryFeed,
  isDiscoveryKind,
  parseDiscoveryDiagnostics,
  parseDiscoveryResponse,
  type DiscoveryFeedRequest,
} from "@/features/home/discoveryApi";
import { DISCOVERY_KINDS as SERVER_DISCOVERY_KINDS } from "@/server/music/discoverySeeds";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M8 task 3.1: the client discovery API contract — query construction, the
 * parameter bounds that keep a request server-valid, response parsing (tracks
 * only; provider diagnostics stay opaque), and the three designed error codes.
 */

/** The feed kinds the contract is written against, in documented order. */
const EXPECTED_DISCOVERY_KINDS = [
  "trending",
  "genre",
  "podcast",
  "collection",
  "for-you",
  "mix",
] as const;

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Beta", language: "es" });

function query(request: DiscoveryFeedRequest): URLSearchParams {
  return new URL(buildDiscoveryQuery(request), "http://local.test").searchParams;
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/** The route's structured error envelope: `{ error: { code, message } }`. */
function errorResponse(status: number, code: string): Response {
  return { ok: false, status, json: async () => ({ error: { code } }) } as unknown as Response;
}

/** The M7 playlist envelope, which the client also has to tolerate. */
function flatErrorResponse(status: number, code: string): Response {
  return { ok: false, status, json: async () => ({ error: code }) } as unknown as Response;
}

function brokenErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => {
      throw new Error("Body was not JSON.");
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("discovery query construction", () => {
  it("builds kind + languages + limit by default", () => {
    const params = query({ kind: "trending", languages: ["en", "es"] });
    expect(params.get("kind")).toBe("trending");
    expect(params.get("languages")).toBe("en,es");
    expect(params.get("limit")).toBe(String(DISCOVERY_LIMIT));
    expect(params.get("seeds")).toBeNull();
  });

  it("adds comma-separated seeds when the caller supplies taste terms", () => {
    const params = query({ kind: "for-you", languages: ["en"], seeds: ["daft punk", "bossa"] });
    expect(params.get("kind")).toBe("for-you");
    expect(params.get("seeds")).toBe("daft punk,bossa");
  });

  it("targets the discovery endpoint and passes a caller-owned signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () =>
      okResponse({ tracks: [trackA], diagnostics: { kind: "mix" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const feed = await fetchDiscoveryFeed({
      kind: "mix",
      languages: ["en"],
      limit: 5,
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`${DISCOVERY_ENDPOINT}?`),
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(feed.tracks).toEqual([trackA]);
  });

  it("accepts every documented feed kind and rejects anything else", () => {
    for (const kind of DISCOVERY_KINDS) {
      expect(isDiscoveryKind(kind)).toBe(true);
      expect(query({ kind, languages: ["en"] }).get("kind")).toBe(kind);
    }
    expect(isDiscoveryKind("charts")).toBe(false);
    expect(isDiscoveryKind(undefined)).toBe(false);
    expect(() => buildDiscoveryQuery({ kind: "charts" as never, languages: ["en"] })).toThrow(
      DiscoveryError,
    );
  });
});

describe("discovery parameter bounds", () => {
  it("rejects an empty, blank, or entirely unknown language list without a network call", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const languages of [[], [""], ["  "], ["klingon"]]) {
      expect(() => buildDiscoveryQuery({ kind: "genre", languages })).toThrow(
        expect.objectContaining({ code: "invalid_request" }),
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops unknown/duplicate codes and caps the selection", () => {
    const params = query({
      kind: "podcast",
      languages: ["ja", "klingon", "ja", "en", "fr", "de", "pt", "it", "nl", "sv", "no"],
    });
    const codes = params.get("languages")?.split(",") ?? [];
    expect(codes).toEqual(["ja", "en", "fr", "de", "pt", "it", "nl", "sv"]);
    expect(codes).toHaveLength(MAX_DISCOVERY_LANGUAGES);
  });

  it("caps seed terms and each term's length", () => {
    const long = "x".repeat(200);
    const seeds = Array.from({ length: MAX_DISCOVERY_SEEDS + 4 }, (_, index) => `seed-${index}`);
    const params = query({ kind: "for-you", languages: ["en"], seeds: [long, ...seeds] });
    const sent = params.get("seeds")?.split(",") ?? [];
    expect(sent[0]).toBe("x".repeat(MAX_SEED_LENGTH));
    expect(sent).toHaveLength(MAX_DISCOVERY_SEEDS);
  });

  it("rejects an explicitly supplied seed list with no usable term", () => {
    expect(() =>
      buildDiscoveryQuery({ kind: "for-you", languages: ["en"], seeds: ["  "] }),
    ).toThrow(expect.objectContaining({ code: "invalid_request" }));
    // An omitted or empty seed list is legitimate: the server uses its catalog.
    expect(buildDiscoveryQuery({ kind: "for-you", languages: ["en"], seeds: [] })).toContain(
      DISCOVERY_ENDPOINT,
    );
  });

  it("keeps an in-range limit and rejects one outside 1..50", () => {
    expect(
      query({ kind: "trending", languages: ["en"], limit: MIN_DISCOVERY_LIMIT }).get("limit"),
    ).toBe("1");
    expect(
      query({ kind: "trending", languages: ["en"], limit: MAX_DISCOVERY_LIMIT }).get("limit"),
    ).toBe("50");
    for (const limit of [0, -1, MAX_DISCOVERY_LIMIT + 1, 2.5, Number.NaN]) {
      expect(() => buildDiscoveryQuery({ kind: "trending", languages: ["en"], limit })).toThrow(
        expect.objectContaining({ code: "invalid_request" }),
      );
    }
  });

  it("fails an out-of-bounds request before touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDiscoveryFeed({ kind: "trending", languages: [], limit: 20 }),
    ).rejects.toMatchObject({ name: "DiscoveryError", code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("discovery response parsing", () => {
  it("returns canonical tracks and the safe diagnostics projection", () => {
    const feed = parseDiscoveryResponse({
      tracks: [trackA, trackB],
      diagnostics: {
        kind: "trending",
        languages: ["en", "es"],
        seedsTried: 3,
        seedsFailed: ["flaky"],
        resultCount: 2,
        cached: true,
        // Provider tier outcomes must not become part of the client contract.
        tiersTried: [{ tier: "ytmusic", outcome: "success" }],
      },
    });

    expect(feed.tracks).toEqual([trackA, trackB]);
    expect(feed.diagnostics).toMatchObject({
      kind: "trending",
      languages: ["en", "es"],
      seedsTried: 3,
      seedsFailed: ["flaky"],
      resultCount: 2,
      cached: true,
    });
    // Nothing provider-specific leaks into the typed projection.
    expect(feed.diagnostics).not.toHaveProperty("tiersTried");
    expect(feed.diagnostics.raw).toHaveProperty("tiersTried");
  });

  it("tolerates absent or malformed diagnostics", () => {
    expect(parseDiscoveryResponse({ tracks: [] }).diagnostics).toEqual({ raw: {} });
    expect(
      parseDiscoveryResponse({ tracks: [], diagnostics: { languages: "en", resultCount: {} } })
        .diagnostics,
    ).toEqual({
      kind: undefined,
      languages: undefined,
      seedsTried: undefined,
      seedsFailed: undefined,
      resultCount: undefined,
      cached: undefined,
      raw: { languages: "en", resultCount: {} },
    });
    expect(parseDiscoveryDiagnostics("nope")).toEqual({ raw: {} });
    expect(parseDiscoveryDiagnostics(null)).toEqual({ raw: {} });
  });

  it("accepts an empty feed as a valid empty shelf", () => {
    expect(parseDiscoveryResponse({ tracks: [] }).tracks).toEqual([]);
  });

  it("rejects a body that is not an object or holds malformed tracks", () => {
    expect(() => parseDiscoveryResponse(null)).toThrow(
      expect.objectContaining({ code: "upstream_unavailable" }),
    );
    expect(() => parseDiscoveryResponse("nope")).toThrow(
      expect.objectContaining({ code: "upstream_unavailable" }),
    );
    expect(() => parseDiscoveryResponse({})).toThrow(
      expect.objectContaining({ code: "upstream_unavailable" }),
    );
    expect(() => parseDiscoveryResponse({ tracks: [{ id: "x" }] })).toThrow(
      expect.objectContaining({ code: "upstream_unavailable" }),
    );
    expect(() => parseDiscoveryResponse({ tracks: [trackA, { nope: true }] })).toThrow(
      expect.objectContaining({ code: "upstream_unavailable" }),
    );
  });

  it("parses a successful response body through fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ tracks: [trackB], diagnostics: { kind: "genre" } })),
    );

    const feed = await fetchDiscoveryFeed({ kind: "genre", languages: ["es"] });
    expect(feed.tracks.map((track) => track.id)).toEqual([trackB.id]);
    expect(feed.diagnostics.kind).toBe("genre");
  });
});

describe("discovery error codes", () => {
  it("maps a 400 structured error onto invalid_request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(400, "invalid_request")),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { name: "DiscoveryError", code: "invalid_request" },
    );
  });

  it("maps a 503 structured error onto upstream_unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(503, "upstream_unavailable")),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { name: "DiscoveryError", code: "upstream_unavailable" },
    );
  });

  it("falls back to the status for non-JSON and unknown-code bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => brokenErrorResponse(400)),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { code: "invalid_request" },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(400, "mystery")),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { code: "invalid_request" },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(499, "mystery")),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { code: "upstream_unavailable" },
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(500, "mystery")),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { code: "upstream_unavailable" },
    );
  });

  it("reads the code from a flat error body too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => flatErrorResponse(500, "upstream_unavailable")),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { code: "upstream_unavailable" },
    );

    // A body code outranks the status when the two disagree.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => flatErrorResponse(500, "invalid_input")),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { code: "invalid_request" },
    );
  });

  it("maps a fetch rejection onto network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { name: "DiscoveryError", code: "network" },
    );
  });

  it("maps a malformed success body onto upstream_unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse({ tracks: "nope" })),
    );
    await expect(fetchDiscoveryFeed({ kind: "trending", languages: ["en"] })).rejects.toMatchObject(
      { name: "DiscoveryError", code: "upstream_unavailable" },
    );
  });

  it("rethrows an abort instead of reporting a network failure", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("Aborted", "AbortError");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw abortError;
      }),
    );

    await expect(
      fetchDiscoveryFeed({ kind: "trending", languages: ["en"], signal: controller.signal }),
    ).rejects.toBe(abortError);
  });
});

describe("DiscoveryError", () => {
  it("names itself and defaults its message from the code", () => {
    const error = new DiscoveryError("network");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("DiscoveryError");
    expect(error.message).toContain("network");
    expect(new DiscoveryError("invalid_request", "custom").message).toBe("custom");
  });
});

describe("discovery request privacy (local-only inputs)", () => {
  it("sends only kind, languages, seeds, and limit", () => {
    const params = query({ kind: "for-you", languages: ["hi", "en"], seeds: ["arijit singh"] });
    expect([...params.keys()].sort()).toEqual(["kind", "languages", "limit", "seeds"]);
    // A track snapshot, id, or history field has no place in the query string.
    expect(buildDiscoveryQuery({ kind: "for-you", languages: ["en"], seeds: ["a"] })).not.toContain(
      trackA.id,
    );
  });
});

describe("discovery kind contract: client and server cannot drift", () => {
  it("declares the same feed kinds, in the same order, on both sides of the route", () => {
    // The client list validates what a caller may request; the server list
    // decides what the endpoint serves. They are the *same* contract, and two
    // independent lists only stay a contract while something compares them — so
    // the comparison lives here, where a kind added on one side and forgotten on
    // the other fails instead of shipping.
    expect([...DISCOVERY_KINDS]).toEqual([...SERVER_DISCOVERY_KINDS]);
    expect([...DISCOVERY_KINDS]).toEqual([...EXPECTED_DISCOVERY_KINDS]);
  });

  it("keeps both sides in step with the kind guard the query builder uses", () => {
    // Not vacuous: the same expected set is what the client accepts...
    for (const kind of EXPECTED_DISCOVERY_KINDS) expect(isDiscoveryKind(kind)).toBe(true);
    // ...and what the server advertises, so no kind is accepted-but-absent.
    expect([...SERVER_DISCOVERY_KINDS].sort()).toEqual([...EXPECTED_DISCOVERY_KINDS].sort());
    expect(DISCOVERY_KINDS).toHaveLength(EXPECTED_DISCOVERY_KINDS.length);
  });
});

describe("track parsing stays canonical", () => {
  it("passes through the canonical fields the shelves render", () => {
    const typed: Track[] = parseDiscoveryResponse({ tracks: [trackA] }).tracks;
    expect(typed[0]).toMatchObject({
      id: "youtube:aaa",
      source: "youtube",
      providerId: "aaa",
      category: "music",
    });
  });
});
