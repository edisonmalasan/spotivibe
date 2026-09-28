import type { Track } from "@/data/repositories";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";
import { SEARCH_DEBOUNCE_MS, useSearchController } from "@/features/search/useSearchController";
import { resetSearchStore, useSearchStore } from "@/stores/searchStore";
import { makeTrack } from "./helpers/music-fixtures";

const nav = vi.hoisted(() => ({
  q: "",
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(nav.q === "" ? {} : { q: nav.q }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Only the debounce timers are faked so promise/microtask work stays native.
const FAKED_TIMERS = ["setTimeout", "clearTimeout"] as const;

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Karma Police" });
const trackB = makeTrack({ id: "youtube:bbb", providerId: "bbb", title: "Weird Fishes" });

function okResponse(tracks: Track[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ tracks, diagnostics: {} }),
  } as unknown as Response;
}

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** An auto-resolving success stub that returns `tracks`. */
function stubSuccessfulFetch(tracks: Track[]) {
  return stubFetch(async () => okResponse(tracks));
}

interface DeferredCall {
  url: string;
  signal: AbortSignal;
  resolve(tracks: Track[]): void;
  reject(error: unknown): void;
}

/**
 * A fetch stub that never settles on its own — each call is settled by the
 * test, so abort races and late responses can be exercised deterministically.
 */
function stubDeferredFetch({ rejectOnAbort = false } = {}) {
  const calls: DeferredCall[] = [];
  const mock = stubFetch(
    (input, init) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        calls.push({
          url: String(input),
          signal,
          resolve: (tracks) => resolve(okResponse(tracks)),
          reject,
        });
        if (rejectOnAbort) {
          signal.addEventListener("abort", () => reject(new TypeError("fetch aborted")));
        }
      }),
  );
  return { mock, calls };
}

/** Drain the fetch/response promise chain and flush React work. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

async function passDebounce(): Promise<void> {
  await advance(SEARCH_DEBOUNCE_MS);
  await flush();
}

let online = true;

function setOnline(value: boolean): void {
  online = value;
}

Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });

beforeEach(() => {
  resetSearchStore();
  nav.q = "";
  nav.replace.mockClear();
  setOnline(true);
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountController() {
  return renderHook(() => useSearchController(useSearchStore((state) => state.query)));
}

describe("search request orchestration (task 2.1)", () => {
  it("debounces a query change into exactly one request for the settled query", async () => {
    const fetchMock = stubSuccessfulFetch([trackA]);
    const { result } = mountController();

    expect(result.current.surface.status).toBe("browse");

    act(() => useSearchStore.getState().setQuery("radio"));
    expect(result.current.surface.status).toBe("loading");
    expect(fetchMock).not.toHaveBeenCalled();

    await advance(SEARCH_DEBOUNCE_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();

    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Only q and limit leave the client (local data never reaches the request).
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/search?q=radio&limit=20");

    await flush();
    expect(result.current.surface).toEqual({ status: "results", tracks: [trackA] });

    await advance(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the in-flight request as soon as the query changes", async () => {
    const { mock, calls } = stubDeferredFetch({ rejectOnAbort: true });
    const { result } = mountController();

    act(() => useSearchStore.getState().setQuery("first"));
    await advance(SEARCH_DEBOUNCE_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.aborted).toBe(false);

    act(() => useSearchStore.getState().setQuery("second"));
    expect(calls[0].signal.aborted).toBe(true); // superseded request aborted
    expect(result.current.surface.status).toBe("loading");

    // Its rejection must not surface as an error state.
    await flush();
    expect(result.current.surface.status).toBe("loading");

    await advance(SEARCH_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);
    expect(mock).toHaveBeenCalledTimes(2);

    await act(async () => {
      calls[1].resolve([trackB]);
    });
    await flush();
    expect(result.current.surface).toEqual({ status: "results", tracks: [trackB] });
  });

  it("discards a late response that resolves for a superseded query", async () => {
    const { calls } = stubDeferredFetch();
    const { result } = mountController();

    act(() => useSearchStore.getState().setQuery("old"));
    await advance(SEARCH_DEBOUNCE_MS);
    act(() => useSearchStore.getState().setQuery("new"));
    await advance(SEARCH_DEBOUNCE_MS);
    expect(calls).toHaveLength(2);

    await act(async () => {
      calls[0].resolve([trackA]); // stale response settles after supersession
    });
    await flush();
    expect(result.current.surface.status).toBe("loading"); // discarded, not rendered

    await act(async () => {
      calls[1].resolve([trackB]);
    });
    await flush();
    expect(result.current.surface).toEqual({ status: "results", tracks: [trackB] });
  });

  it("collapses rapid typing into one request carrying only the final query", async () => {
    const fetchMock = stubSuccessfulFetch([trackB]);
    const { result } = mountController();

    for (const value of ["r", "ra", "radio"]) {
      act(() => useSearchStore.getState().setQuery(value));
      await advance(SEARCH_DEBOUNCE_MS / 3); // still inside the debounce window
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.surface.status).toBe("loading");

    await passDebounce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/search?q=radio&limit=20");
    expect(result.current.surface).toEqual({ status: "results", tracks: [trackB] });
  });

  it("returns to browse when the query clears, discarding the in-flight request", async () => {
    const { calls } = stubDeferredFetch();
    const { result } = mountController();

    act(() => useSearchStore.getState().setQuery("vanish"));
    await advance(SEARCH_DEBOUNCE_MS);
    expect(calls).toHaveLength(1);

    act(() => useSearchStore.getState().setQuery(""));
    expect(calls[0].signal.aborted).toBe(true);
    expect(result.current.surface.status).toBe("browse");

    await act(async () => {
      calls[0].resolve([trackA]); // late response for the cleared query
    });
    await flush();
    expect(result.current.surface.status).toBe("browse"); // no stale results
  });
});

describe("search surface rendering (tasks 2.2 and 3.3)", () => {
  it("shows result-shaped skeletons while pending and the results once resolved", async () => {
    stubSuccessfulFetch([trackA]);
    nav.q = "radiohead";
    render(<SearchPage />);

    // Pending: skeletons shaped like rows instead of a blank or stale region.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();

    await passDebounce();

    expect(screen.queryAllByTestId("skeleton")).toHaveLength(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByTestId("search-results")).toBeInTheDocument();
    expect(screen.getByText("Karma Police")).toBeInTheDocument();
    // Artist text inside the song row (the derived Artists section repeats the
    // name as its own heading, so scope this to the row list).
    expect(screen.getByTestId("search-results")).toHaveTextContent("Daft Punk");
    expect(screen.getByText("4:09")).toBeInTheDocument();
  });

  it("shows an empty state naming the query when the search returns nothing", async () => {
    stubSuccessfulFetch([]);
    nav.q = "nothing";
    render(<SearchPage />);

    await passDebounce();

    expect(screen.getByText('No results for "nothing"')).toBeInTheDocument();
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("skeleton")).toHaveLength(0);
  });

  it("shows a retryable error state whose retry re-searches immediately", async () => {
    let attempt = 0;
    const fetchMock = stubFetch(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("boom");
      return okResponse([trackA]);
    });
    nav.q = "flaky";
    render(<SearchPage />);

    await passDebounce();

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Search failed")).toBeInTheDocument();
    expect(screen.getByText(/Check your connection and try again/)).toBeInTheDocument();
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchMock).toHaveBeenCalledTimes(2); // immediate — no debounce wait

    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("search-results")).toBeInTheDocument();
  });
});

describe("offline search behavior (task 2.3)", () => {
  it("issues no remote request offline, shows the offline state, and re-runs on reconnect", async () => {
    setOnline(false);
    const fetchMock = stubSuccessfulFetch([trackA]);
    nav.q = "flight mode";
    render(<SearchPage />);

    await passDebounce();

    expect(fetchMock).not.toHaveBeenCalled(); // no remote request at all
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
    expect(screen.getByText('No local results for "flight mode"')).toBeInTheDocument();

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await flush();
    expect(screen.getByTestId("search-results")).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  });
});
