import type { SearchEntryRecord } from "@/data/repositories";

/**
 * What the search field offers as the listener types (M18 task 4.1; spec
 * `search` — "Suggestions come from the query and local history only").
 *
 * **Two inputs, and no others.** The typed query and this device's own
 * `searchHistory`. There is no third source, deliberately: every other source
 * would be a provider request, and a suggestion list is the one surface that
 * fires on *every keystroke* — a lane that spent a request per character would
 * turn typing into provider traffic and would make the popup's usefulness
 * depend on network latency. The requirement is therefore not "suggestions come
 * from the query and local history" as a preference but as the only possibility,
 * and `deriveSuggestions` is a pure function of its two arguments precisely so a
 * test can spy the transport layer and prove nothing else is consulted.
 *
 * **What the two inputs produce.** A non-empty query *narrows this device's
 * history*: an entry the query is a prefix of is a completion of it, and an
 * entry that merely contains it is a related search. An empty query has nothing
 * to narrow, so the recents are offered whole. That is the whole model — the
 * query never invents a refinement the listener did not already search for,
 * because inventing one would be a guess presented as a suggestion.
 *
 * Pure: no repository, no network, no framework import.
 */

/** How many suggestions the popup offers at most, including the empty-query case. */
export const MAX_SUGGESTIONS = 6;

/** One offered suggestion, and why it is on offer. */
export interface SearchSuggestion {
  /**
   * Stable identity for this suggestion: the option's React key, and the base of
   * the id `aria-activedescendant` points at.
   */
  id: string;
  /** The text a commit puts into the field. */
  value: string;
  /**
   * Why this suggestion is here, which is also what its row icon says.
   *
   * - `refinement` — a search this device made that the typed query narrows
   *   (a prefix completion, or a related entry it appears inside).
   * - `recent` — a search this device made, offered because the field is empty.
   */
  kind: "refinement" | "recent";
}

/**
 * The suggestions `query` implies, given this device's search history.
 *
 * Ordering is derived from `searchedAt` rather than inherited from `history`, so
 * a caller cannot get the list wrong by handing it a differently-ordered array:
 * the newest search this device made is the one most likely to be the one meant.
 *
 * Prefix matches come before substring matches rather than being interleaved by
 * recency. Both are "this device has searched this", but an entry the typed text
 * is a *prefix* of is what the listener is most likely in the middle of typing,
 * so it is the more likely intent however recently the other one was searched.
 */
export function deriveSuggestions(
  query: string,
  history: readonly SearchEntryRecord[],
): SearchSuggestion[] {
  const needle = query.trim().toLowerCase();
  const prefix: SearchEntryRecord[] = [];
  const contains: SearchEntryRecord[] = [];

  // Newest first, stable, so two entries sharing a timestamp keep their given
  // order rather than being reordered arbitrarily.
  const newestFirst = [...history].sort((a, b) => b.searchedAt - a.searchedAt);

  for (const entry of newestFirst) {
    if (needle === "") {
      prefix.push(entry);
      continue;
    }
    if (entry.normalizedQuery.startsWith(needle)) prefix.push(entry);
    else if (entry.normalizedQuery.includes(needle)) contains.push(entry);
  }

  return (
    [...prefix, ...contains]
      // `searchHistory` keys on the normalized query, so one entry per normalized
      // value is all this device can hold; the de-duplication is here because a
      // hand-built history (an import, a merge) can carry more than one row for it,
      // and a listbox must not offer the same value twice.
      .filter(
        (entry, index, all) =>
          all.findIndex((other) => other.normalizedQuery === entry.normalizedQuery) === index,
      )
      .slice(0, MAX_SUGGESTIONS)
      .map((entry) => ({
        id: `suggestion:${entry.normalizedQuery}`,
        // The query as it was typed, not the normalized form: a suggestion that
        // lower-cased what the listener typed would commit a different search.
        value: entry.query,
        kind: needle === "" ? "recent" : "refinement",
      }))
  );
}
