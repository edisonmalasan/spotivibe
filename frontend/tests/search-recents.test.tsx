import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { RecentSearches } from "@/features/search/RecentSearches";

/**
 * Task 6.3 (spec "Local-first search history"): the browse surface lists
 * recent searches newest-first with per-entry remove and clear-all, falls
 * back to the browse empty state, and everything survives a reload because
 * the state lives in the repository, not the component.
 */

// Cold fake-indexeddb start can exceed the 1s default (settings-ui precedent).
configure({ asyncUtilTimeout: 5000 });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let repositories: RepositorySet;

beforeEach(async () => {
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Record queries oldest-first with distinct timestamps so order is stable. */
async function seed(...queries: string[]): Promise<void> {
  for (const query of queries) {
    await repositories.searchHistory.record(query);
    await sleep(3);
  }
}

function entryRows(): HTMLElement[] {
  return screen.getAllByRole("listitem");
}

describe("recent searches browse surface (task 6.3)", () => {
  it("shows the browse empty state when there is no history", () => {
    render(<RecentSearches onSelect={vi.fn()} />);
    expect(screen.getByText("Search for music")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent searches" })).not.toBeInTheDocument();
  });

  it("lists recents newest-first, re-runs a selected query, and removes one entry", async () => {
    await seed("alpha", "beta", "gamma");
    const onSelect = vi.fn();
    const { unmount } = render(<RecentSearches onSelect={onSelect} />);

    await screen.findByRole("heading", { name: "Recent searches" });
    expect(entryRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("gamma"),
      expect.stringContaining("beta"),
      expect.stringContaining("alpha"),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    expect(onSelect).toHaveBeenCalledWith("alpha");

    // Remove one entry: exactly that one goes, the rest keep their order.
    fireEvent.click(screen.getByRole("button", { name: "Remove gamma" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "gamma" })).not.toBeInTheDocument();
    });
    expect(entryRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("beta"),
      expect.stringContaining("alpha"),
    ]);
    expect((await repositories.searchHistory.list()).map((entry) => entry.normalizedQuery)).toEqual(
      ["beta", "alpha"],
    );

    // Simulated reload: a fresh repository read reproduces the same list.
    unmount();
    render(<RecentSearches onSelect={onSelect} />);
    await screen.findByRole("heading", { name: "Recent searches" });
    expect(entryRows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("beta"),
      expect.stringContaining("alpha"),
    ]);
  });

  it("clears every entry, stays empty in the UI, and survives a reload", async () => {
    await seed("alpha", "beta");
    const { unmount } = render(<RecentSearches onSelect={vi.fn()} />);

    await screen.findByRole("heading", { name: "Recent searches" });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    await screen.findByText("Search for music");
    expect(await repositories.searchHistory.list()).toEqual([]);

    unmount();
    render(<RecentSearches onSelect={vi.fn()} />);
    expect(await screen.findByText("Search for music")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent searches" })).not.toBeInTheDocument();
  });

  it("never carries list, remove, or clear over the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await seed("alpha", "beta");

    const onSelect = vi.fn();
    render(<RecentSearches onSelect={onSelect} />);
    await screen.findByRole("heading", { name: "Recent searches" });
    expect(entryRows()).toHaveLength(2); // list read

    fireEvent.click(screen.getByRole("button", { name: "Remove beta" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "beta" })).not.toBeInTheDocument();
    });
    expect((await repositories.searchHistory.list()).map((entry) => entry.normalizedQuery)).toEqual(
      ["alpha"],
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    await screen.findByText("Search for music");
    expect(await repositories.searchHistory.list()).toEqual([]);

    // Search history must never leave the device (spec "Local-first search
    // history"). Selection is deliberately not exercised here: activating a
    // recent search legitimately issues a search request.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
