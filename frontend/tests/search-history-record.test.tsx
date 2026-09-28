import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import {
  SEARCH_DEBOUNCE_MS,
  SETTLE_RECORD_MS,
  useSearchController,
} from "@/features/search/useSearchController";
import { resetSearchStore, useSearchStore } from "@/stores/searchStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Task 6.2 (design §7): a result set that the remote answered with settles
 * for 1.5 s and is then recorded through the search-history repository;
 * changing the query first cancels the window, and error/offline surfaces
 * never record.
 */

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
}));

// The controller reaches the repository through the local-data accessor; the
// repository itself is covered by repositories.test.ts.
vi.mock("@/data/localData", () => ({
  getLocalData: async () => ({
    searchHistory: { record: mocks.record },
  }),
}));

// Only the debounce/settle timers are faked so promise/microtask work stays native.
const FAKED_TIMERS = ["setTimeout", "clearTimeout"] as const;

const trackA = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Karma Police" });

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

Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });

beforeEach(() => {
  resetSearchStore();
  online = true;
  mocks.record.mockClear();
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountController() {
  return renderHook(() => useSearchController(useSearchStore((state) => state.query)));
}

describe("settle recording (task 6.2)", () => {
  it("records a settled result set once the settle window elapses", async () => {
    stubFetch(async () => okResponse([trackA]));
    mountController();

    act(() => useSearchStore.getState().setQuery("radio"));
    await passDebounce();
    expect(mocks.record).not.toHaveBeenCalled(); // window still open

    await advance(SETTLE_RECORD_MS - 1);
    expect(mocks.record).not.toHaveBeenCalled();

    await advance(1);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith("radio");

    await advance(10_000);
    expect(mocks.record).toHaveBeenCalledTimes(1); // exactly once per settle
  });

  it("records a settled empty result set (the remote answered with nothing)", async () => {
    stubFetch(async () => okResponse([]));
    mountController();

    act(() => useSearchStore.getState().setQuery("nothing"));
    await passDebounce();
    await advance(SETTLE_RECORD_MS);

    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith("nothing");
  });

  it("cancels the pending record when the query changes first", async () => {
    stubFetch(async () => okResponse([trackA]));
    mountController();

    act(() => useSearchStore.getState().setQuery("alpha"));
    await passDebounce(); // alpha settles, window starts

    act(() => useSearchStore.getState().setQuery("beta"));
    await advance(SETTLE_RECORD_MS);
    expect(mocks.record).not.toHaveBeenCalled(); // alpha abandoned before recording

    await passDebounce(); // beta settles
    await advance(SETTLE_RECORD_MS);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledWith("beta");
  });

  it("never records a failed search", async () => {
    stubFetch(async () => {
      throw new Error("boom");
    });
    mountController();

    act(() => useSearchStore.getState().setQuery("flaky"));
    await passDebounce();
    await advance(10_000);

    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("never records an offline search (no remote response settled)", async () => {
    online = false;
    const fetchMock = stubFetch(async () => okResponse([trackA]));
    mountController();

    act(() => useSearchStore.getState().setQuery("flight mode"));
    await passDebounce();
    await advance(10_000);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("records again when the same query is searched later (repository refresh, not a duplicate)", async () => {
    stubFetch(async () => okResponse([trackA]));
    mountController();

    act(() => useSearchStore.getState().setQuery("radio"));
    await passDebounce();
    await advance(SETTLE_RECORD_MS);
    expect(mocks.record).toHaveBeenCalledTimes(1);

    act(() => useSearchStore.getState().setQuery(""));
    await advance(SEARCH_DEBOUNCE_MS);

    act(() => useSearchStore.getState().setQuery("radio"));
    await passDebounce();
    await advance(SETTLE_RECORD_MS);

    expect(mocks.record).toHaveBeenCalledTimes(2);
    expect(mocks.record).toHaveBeenNthCalledWith(1, "radio");
    expect(mocks.record).toHaveBeenNthCalledWith(2, "radio");
  });
});
