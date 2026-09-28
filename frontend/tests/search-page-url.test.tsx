import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";
import { resetSearchStore, useSearchStore } from "@/stores/searchStore";

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

// Only the debounce timers are faked so promise/microtask work stays native.
const FAKED_TIMERS = ["setTimeout", "clearTimeout"] as const;

function query(): string {
  return useSearchStore.getState().query;
}

beforeEach(() => {
  resetSearchStore();
  nav.q = "";
  nav.replace.mockClear();
  vi.useFakeTimers({ toFake: [...FAKED_TIMERS] });
  // This file owns URL sync; requests are left pending on purpose so the
  // surface stays deterministic (no real network call is ever made).
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {})),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("search page URL sync (task 1.3)", () => {
  it("seeds the store from ?q= on mount and writes nothing back", () => {
    nav.q = "bohemian rhapsody";
    render(<SearchPage />);

    expect(query()).toBe("bohemian rhapsody");
    expect(screen.getByTestId("search-loading")).toBeInTheDocument();
    vi.advanceTimersByTime(300);
    expect(nav.replace).not.toHaveBeenCalled(); // param adopted, no echo
  });

  it("adopts the previous query when back/forward changes the param", () => {
    nav.q = "first";
    const { rerender } = render(<SearchPage />);
    expect(query()).toBe("first");

    // The store leads while typing: a debounced replace follows the edit.
    act(() => useSearchStore.getState().setQuery("second"));
    expect(nav.replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/search?q=second");

    // The router applies the replace, then back returns to the earlier entry:
    // the param changes again and the store adopts it. The adoption must not
    // echo a replace back (no sync loop).
    nav.q = "second";
    rerender(<SearchPage />);
    expect(query()).toBe("second");

    nav.q = "first";
    rerender(<SearchPage />);
    expect(query()).toBe("first");

    vi.advanceTimersByTime(300);
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("clears to the no-q browse route when the query empties", () => {
    nav.q = "something";
    render(<SearchPage />);
    expect(query()).toBe("something");

    act(() => useSearchStore.getState().setQuery(""));
    expect(nav.replace).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/search");
  });

  it("stays silent when the store and the param already agree", () => {
    render(<SearchPage />);

    vi.advanceTimersByTime(300);

    expect(query()).toBe("");
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.getByText("Search for music")).toBeInTheDocument(); // browse
  });
});
