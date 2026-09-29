import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import { DISCOVERY_KINDS, type DiscoveryErrorCode } from "@/features/home/discoveryApi";
import { useDiscoveryShelf } from "@/features/home/useDiscoveryShelf";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M8 task 6.2 (design §2/§4): one hook instance per shelf, each owning its own
 * request, abort controller, and lifecycle. These cases pin the four properties
 * the acceptance criteria rest on — per-shelf failure isolation, skeleton →
 * content, an empty state that is explained rather than blank, and an abort on
 * unmount — plus the language interleaving that runs before tracks are exposed.
 */

/** A track attributed to a language, so interleaving is observable. */
function langTrack(language: string, index: number): Track {
  return makeTrack({
    id: `youtube:${language}-${index}`,
    providerId: `${language}-${index}`,
    title: `${language} ${index}`,
    artists: [{ name: `${language} artist` }],
    language,
  });
}

/** A success body the client parser accepts. */
function okBody(tracks: Track[]): { ok: true; status: number; body: unknown } {
  return { ok: true, status: 200, body: { tracks, diagnostics: {} } };
}

/** A structured error body the client maps onto a designed code. */
function errorBody(code: string, status = 503): { ok: false; status: number; body: unknown } {
  return { ok: false, status, body: { error: { code, message: code } } };
}

type Reply =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; body: unknown }
  | { pending: true };

interface Recorded {
  url: URL;
  signal: AbortSignal | undefined;
}

/**
 * A fetch stub driven by the request's `kind` (and optional `seeds`), so a test
 * can fail one feed while others answer. `pending` calls never settle, which is
 * how abort races are exercised deterministically.
 */
function stubDiscoveryFetch(reply: (url: URL) => Reply): {
  mock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), "http://localhost");
    calls.push({ url, signal: init?.signal ?? undefined });
    const outcome = reply(url);
    if ("pending" in outcome) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    return Promise.resolve({
      ok: outcome.ok,
      status: outcome.status,
      json: async () => outcome.body,
    } as unknown as Response);
  };
  const mock = vi.fn(impl);
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

/** Every request parameter a shelf sent, flattened for assertions. */
function paramsOf(call: Recorded): URLSearchParams {
  return call.url.searchParams;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useDiscoveryShelf: the happy path", () => {
  it("moves from loading to ready and exposes the resolved tracks", async () => {
    const tracks = [langTrack("en", 1)];
    stubDiscoveryFetch(() => okBody(tracks));

    const { result } = renderHook(() => useDiscoveryShelf({ kind: "trending", languages: ["en"] }));

    expect(result.current.status).toBe("loading");
    expect(result.current.tracks).toEqual([]);

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.tracks.map((track) => track.id)).toEqual([tracks[0].id]);
  });

  it("sends only the feed kind, the selected languages, and any seeds", async () => {
    const { calls } = stubDiscoveryFetch(() => okBody([langTrack("en", 1)]));

    renderHook(() =>
      useDiscoveryShelf({
        kind: "for-you",
        languages: ["en", "ja"],
        seeds: ["Alpha", "Beta"],
        limit: 12,
      }),
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    const params = paramsOf(calls[0]);
    expect(params.get("kind")).toBe("for-you");
    expect(params.get("languages")).toBe("en,ja");
    expect(params.get("seeds")).toBe("Alpha,Beta");
    expect(params.get("limit")).toBe("12");
    expect([...params.keys()].sort()).toEqual(["kind", "languages", "limit", "seeds"]);
  });

  it("applies language interleaving before exposing the tracks", async () => {
    // English dominates the raw result; the exposed order must alternate.
    const tracks = [
      langTrack("en", 1),
      langTrack("en", 2),
      langTrack("en", 3),
      langTrack("ja", 1),
      langTrack("ja", 2),
    ];
    stubDiscoveryFetch(() => okBody(tracks));

    const { result } = renderHook(() =>
      useDiscoveryShelf({ kind: "trending", languages: ["en", "ja"] }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.tracks.map((track) => track.language)).toEqual([
      "en",
      "ja",
      "en",
      "ja",
      "en",
    ]);
    // Lossless: every input track still appears exactly once.
    expect(result.current.tracks).toHaveLength(tracks.length);
    expect(new Set(result.current.tracks.map((track) => track.id)).size).toBe(tracks.length);
  });

  it("keeps a single selected language's provider order", async () => {
    const tracks = [langTrack("en", 1), langTrack("en", 2), langTrack("en", 3)];
    stubDiscoveryFetch(() => okBody(tracks));

    const { result } = renderHook(() => useDiscoveryShelf({ kind: "trending", languages: ["en"] }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.tracks.map((track) => track.id)).toEqual(tracks.map((t) => t.id));
  });
});

describe("useDiscoveryShelf: empty and error", () => {
  it("reports an explained empty state rather than a ready shelf with nothing", async () => {
    stubDiscoveryFetch(() => okBody([]));

    const { result } = renderHook(() => useDiscoveryShelf({ kind: "podcast", languages: ["en"] }));

    await waitFor(() => expect(result.current.status).toBe("empty"));
    expect(result.current.tracks).toEqual([]);
  });

  it.each([
    ["upstream_unavailable", 503],
    ["network", 503],
  ] as Array<[DiscoveryErrorCode, number]>)(
    "maps a %s failure onto a retryable error state",
    async (code, status) => {
      stubDiscoveryFetch(() =>
        code === "upstream_unavailable"
          ? errorBody("upstream_unavailable", status)
          : ({ pending: false, ok: false, status: 500, body: {} } as const),
      );
      // A transport failure has no body at all.
      if (code === "network") {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new TypeError("fetch failed");
          }),
        );
      }

      const { result } = renderHook(() =>
        useDiscoveryShelf({ kind: "trending", languages: ["en"] }),
      );

      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current.code).toBe(code);
    },
  );

  it("surfaces an invalid_request as an error state and warns the code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubDiscoveryFetch(() => errorBody("invalid_request", 400));

    const { result } = renderHook(() => useDiscoveryShelf({ kind: "for-you", languages: ["en"] }));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.code).toBe("invalid_request");
    // Debuggable rather than silently swallowed: the code is logged once.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/invalid/);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ code: "invalid_request" });
    warn.mockRestore();
  });
});

describe("useDiscoveryShelf: retry and abort", () => {
  it("re-runs the request on retry and recovers", async () => {
    let attempt = 0;
    const { calls } = stubDiscoveryFetch(() => {
      attempt += 1;
      return attempt === 1 ? errorBody("upstream_unavailable", 503) : okBody([langTrack("en", 1)]);
    });

    const { result } = renderHook(() => useDiscoveryShelf({ kind: "trending", languages: ["en"] }));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(calls).toHaveLength(1);

    act(() => {
      result.current.retry();
    });

    // Retry shows loading again before the second answer lands.
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(calls).toHaveLength(2);
  });

  it("aborts its in-flight request on unmount and discards the response", async () => {
    const { calls } = stubDiscoveryFetch(() => ({ pending: true }));
    const { unmount } = renderHook(() =>
      useDiscoveryShelf({ kind: "trending", languages: ["en"] }),
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].signal?.aborted).toBe(false);

    unmount();

    expect(calls[0].signal?.aborted).toBe(true);
  });

  it("does not restart the request for a re-render with equal values", async () => {
    const { calls } = stubDiscoveryFetch(() => okBody([langTrack("en", 1)]));

    const { rerender } = renderHook(
      // A fresh array literal each render, as an inline caller would produce.
      ({ languages }: { languages: string[] }) =>
        useDiscoveryShelf({ kind: "trending", languages }),
      { initialProps: { languages: ["en"] } },
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ languages: ["en"] });
    rerender({ languages: ["en"] });

    expect(calls).toHaveLength(1);
  });

  it("re-runs the request when the selected languages change", async () => {
    const { calls } = stubDiscoveryFetch(() => okBody([langTrack("en", 1)]));

    const { rerender } = renderHook(
      ({ languages }: { languages: string[] }) =>
        useDiscoveryShelf({ kind: "trending", languages }),
      { initialProps: { languages: ["en"] } },
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ languages: ["ja"] });

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(paramsOf(calls[1]).get("languages")).toBe("ja");
  });
});

describe("useDiscoveryShelf: one failing shelf leaves its siblings alone", () => {
  it("keeps a healthy shelf rendering while another one errors", async () => {
    const healthy = [langTrack("en", 1), langTrack("en", 2)];

    function TwoShelves() {
      const trending = useDiscoveryShelf({ kind: "trending", languages: ["en"] });
      const podcast = useDiscoveryShelf({ kind: "podcast", languages: ["en"] });
      return (
        <ul>
          <li data-testid="trending">
            {trending.status} · {trending.tracks.map((track) => track.title).join("|")}
          </li>
          <li data-testid="podcast">
            {podcast.status} · {podcast.tracks.map((track) => track.title).join("|")}
          </li>
        </ul>
      );
    }

    stubDiscoveryFetch((url) =>
      url.searchParams.get("kind") === "podcast"
        ? errorBody("upstream_unavailable", 503)
        : okBody(healthy),
    );

    render(<TwoShelves />);

    await waitFor(() => expect(screen.getByTestId("trending")).toHaveTextContent("ready"));
    await waitFor(() => expect(screen.getByTestId("podcast")).toHaveTextContent("error"));
    // The failure is confined to its own shelf: the sibling kept its content.
    expect(screen.getByTestId("trending")).toHaveTextContent("en 1|en 2");
    expect(screen.getByTestId("podcast")).not.toHaveTextContent("en 1");
  });

  it("gives every shelf its own controller, unaffected by a sibling's failure", async () => {
    const signals: AbortSignal[] = [];
    const healthy = stubDiscoveryFetch(() => okBody([langTrack("en", 1)]));
    // Route the healthy half of the pair through the success stub while
    // recording every signal the two shelves hand to `fetch`.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const signal = init?.signal;
      if (signal) signals.push(signal);
      if (url.searchParams.get("kind") === "podcast") {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ error: { code: "upstream_unavailable" } }),
        } as unknown as Response);
      }
      return healthy.mock(input, init);
    });

    function TwoShelves() {
      const trending = useDiscoveryShelf({ kind: "trending", languages: ["en"] });
      const podcast = useDiscoveryShelf({ kind: "podcast", languages: ["en"] });
      return (
        <ul>
          <li data-testid="trending">{trending.status}</li>
          <li data-testid="podcast">{podcast.status}</li>
        </ul>
      );
    }

    render(<TwoShelves />);

    await waitFor(() => expect(screen.getByTestId("trending")).toHaveTextContent("ready"));
    await waitFor(() => expect(screen.getByTestId("podcast")).toHaveTextContent("error"));

    // Two independent controllers, and the failing shelf's own abort did not
    // touch the healthy shelf's signal.
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });
});

describe("useDiscoveryShelf: a disabled shelf is silent", () => {
  it("issues no request and stays idle while disabled", async () => {
    const { mock } = stubDiscoveryFetch(() => okBody([langTrack("en", 1)]));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useDiscoveryShelf({ kind: "for-you", languages: ["en"], enabled }),
      { initialProps: { enabled: false } },
    );

    expect(result.current.status).toBe("idle");
    expect(mock).not.toHaveBeenCalled();

    // Re-enabling starts the request, and the shelf leaves `idle`.
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("drops an in-flight result when the shelf is disabled before it settles", async () => {
    const { calls } = stubDiscoveryFetch(() => ({ pending: true }));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useDiscoveryShelf({ kind: "trending", languages: ["en"], enabled }),
      { initialProps: { enabled: true } },
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ enabled: false });

    expect(result.current.status).toBe("idle");
    expect(result.current.tracks).toEqual([]);
  });
});

describe("useDiscoveryShelf: the contract every kind shares", () => {
  it.each(DISCOVERY_KINDS)("issues exactly one bounded request for kind %s", async (kind) => {
    const { calls } = stubDiscoveryFetch(() => okBody([langTrack("en", 1)]));

    renderHook(() =>
      useDiscoveryShelf({
        kind,
        languages: ["en"],
        seeds: kind === "genre" ? ["jazz"] : ["Alpha"],
      }),
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    const params = paramsOf(calls[0]);
    expect(params.get("kind")).toBe(kind);
    expect(params.get("languages")).toBe("en");
    // The endpoint rejects a seed term beyond its own 80-character bound.
    for (const seed of (params.get("seeds") ?? "").split(",")) {
      expect(seed.length).toBeLessThanOrEqual(80);
    }
  });
});
