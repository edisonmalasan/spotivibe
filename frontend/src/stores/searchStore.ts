import { create } from "zustand";

/**
 * `searchStore` (ROADMAP M5): the search query text shared by the top-bar
 * `SearchInput` (AppShell) and the `/search` page.
 *
 * Deliberately tiny (design decision §2): results, status, debounce timers,
 * request sequences, and recents live in the page-local search controller, so
 * this store never becomes a second state machine to reconcile when the
 * Search route remounts.
 */
export interface SearchState {
  /** Raw text as typed — trimming happens when requests/records are built. */
  query: string;
  setQuery(query: string): void;
}

export const initialSearchState = { query: "" };

/** Reset the query — test isolation and hot-reload hygiene. */
export function resetSearchStore(): void {
  useSearchStore.setState({ ...initialSearchState });
}

export const useSearchStore = create<SearchState>()((set) => ({
  ...initialSearchState,
  setQuery(query) {
    set({ query });
  },
}));
