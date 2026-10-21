"use client";

import { useCallback, useEffect, useMemo } from "react";
import type { ShelfState } from "@/components/recommendations/Shelf";
import type { Track } from "@/data/repositories";
import { deriveQuickPicks, type QuickPick } from "@/features/home/quickPicks";
import type { DiscoveryShelfStatus } from "@/features/home/useDiscoveryShelf";
import { useHistoryStore } from "@/stores/historyStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useQuickPickPicksStore } from "@/stores/quickPickPicksStore";

/**
 * The one derivation of the Quick Picks rail (design decisions D1 and D2).
 *
 * `deriveQuickPicks` is a pure function over `{ languages, taste, providerTracks,
 * picks }`, and it was called in exactly one place — the rail — which reported
 * its *entries* upward and threw the rest away. The information that
 * distinguishes "not known yet" from "nothing to offer" lived in the rail's own
 * `state` and was never handed over, so a consumer could not tell an empty rail
 * that had settled from one that had not.
 *
 * This hook is the shared thing, made shared:
 *
 * - **One derivation.** The rail, the first-run surface, and the Settings
 *   re-entry all read *this* hook, so "the same artists" is true by
 *   construction rather than by two call sites agreeing.
 * - **The settled state travels.** The result carries `settled` — true only
 *   when the provider has settled *and* the local stores have hydrated — so a
 *   surface can distinguish a rail that has decided to hold nothing from a rail
 *   that has not decided yet.
 * - **No request of its own.** The provider results are an *argument* (D1.1).
 *   Home's feed already fetches the trending and collection shelves; issuing
 *   them again here would double the network cost of every Home visit. A
 *   caller with no provider results passes nothing and the rail is derived from
 *   local material alone.
 *
 * The stores are read here rather than passed in, because the hydration flags
 * live in the stores and `settled` depends on them: a rail that settled
 * against un-hydrated stores would report "no artists" for a device that has
 * liked tracks it has not read yet. The same defect one level down, and the
 * same guard.
 */

/** The rail's lifecycle, in the shelf vocabulary the rail already renders. */
export type QuickPickArtistState = ShelfState;

/** What a consumer of the rail is told about it. */
export interface QuickPickArtists {
  /** The derived rail: artists only, in the rail's own order. */
  readonly artists: readonly QuickPick[];
  /**
   * Whether the rail has finished deciding what it holds (D2.1).
   *
   * True when the provider has settled (resolved, failed, or been disabled)
   * **and** every local store this derivation reads has hydrated. False while
   * either is outstanding — and "not settled yet" is not the same answer as
   * "settled with nothing", which is the whole point of carrying it.
   */
  readonly settled: boolean;
  /**
   * The rail's own lifecycle.
   *
   * `"loading"` while it has not settled; `"ready"` once it holds an artist;
   * `"empty"` when it settled and derived nothing; `"error"` when the provider
   * failed and the rail has nothing to show for it.
   */
  readonly state: QuickPickArtistState;
  /** The provider feed's retry handler, or a no-op when the caller supplied none. */
  retry(): void;
}

/**
 * What the rail reports upward.
 *
 * Both halves, deliberately: the entries *and* whether the rail has settled.
 * The first-run surface needs the second to know whether "there are no
 * artists" is a statement it may make at all.
 */
export interface QuickPickRailReport {
  readonly artists: readonly QuickPick[];
  readonly settled: boolean;
}

/** The rail's lifecycle, derived from what the rail holds and what has settled. */
function railState(
  artistCount: number,
  settled: boolean,
  providerState: ShelfState,
): QuickPickArtistState {
  if (artistCount > 0) return "ready";
  if (!settled) return "loading";
  return providerState === "error" ? "error" : "empty";
}

/**
 * Map a discovery shelf's status onto the rail's own state vocabulary.
 *
 * One definition, because the difference between "has not settled" and "has
 * settled" is exactly what the rail's `settled` signal is made of, and two
 * mappings would be two chances to disagree about it.
 */
export function toProviderShelfState(status: DiscoveryShelfStatus): ShelfState {
  return status === "ready" || status === "empty" || status === "error" ? status : "loading";
}

export interface UseQuickPickArtistsOptions {
  /**
   * Provider results the caller already holds.
   *
   * Optional because most callers cannot answer the question it answers: only a
   * surface that has fetched a discovery feed knows what its own feed fetched.
   * Omitting it is the honest default and yields exactly the pre-provider
   * behaviour.
   */
  readonly providerTracks?: readonly Track[];
  /**
   * The provider feed's own state.
   *
   * `"loading"` means the feed has not settled. `"ready"`, `"empty"`, and
   * `"error"` mean it has, and the rail may then say what it holds. Passed in
   * rather than fetched, so the hook still issues no request.
   */
  readonly providerState?: ShelfState;
  /** The provider feed's retry handler, forwarded verbatim. */
  readonly onRetry?: () => void;
}

/**
 * The Quick Picks rail, derived once.
 *
 * Hydrates the four stores the derivation reads — preferences, liked tracks,
 * listening history, and the first-run picks — because a consumer of this hook
 * should not have to know which stores the derivation happens to need. The
 * hydration is idempotent (the stores share one in-flight read), so a host that
 * already hydrates them pays nothing for the second call.
 */
export function useQuickPickArtists({
  providerTracks,
  providerState = "ready",
  onRetry,
}: UseQuickPickArtistsOptions = {}): QuickPickArtists {
  const languages = usePreferencesStore((state) => state.languages);
  const preferencesHydrated = usePreferencesStore((state) => state.hydrated);
  const hydratePreferences = usePreferencesStore((state) => state.hydrate);

  const likedTracks = useLibraryStore((state) => state.likedTracks);
  const libraryHydrated = useLibraryStore((state) => state.hydrated);
  const hydrateLibrary = useLibraryStore((state) => state.hydrate);

  const events = useHistoryStore((state) => state.events);
  const historyHydrated = useHistoryStore((state) => state.hydrated);
  const hydrateHistory = useHistoryStore((state) => state.hydrate);

  const storedPicks = useQuickPickPicksStore((state) => state.picks);
  const picksHydrated = useQuickPickPicksStore((state) => state.hydrated);
  const hydratePicks = useQuickPickPicksStore((state) => state.load);

  /*
   * The stores are hydrated here, by the one place that reads them.
   *
   * `settled` depends on those hydration flags, so a hook that did not read
   * them would have to be told when they had happened — which is the same
   * knowledge spread over two places, and the reason the "settled" signal was
   * lost in the first place.
   */
  useEffect(() => {
    void hydratePreferences().catch((error: unknown) => {
      console.warn("[quick-picks] languages unavailable:", error);
    });
    void hydrateLibrary().catch((error: unknown) => {
      console.warn("[quick-picks] liked tracks unavailable:", error);
    });
    void hydrateHistory().catch((error: unknown) => {
      console.warn("[quick-picks] listening history unavailable:", error);
    });
    void hydratePicks().catch((error: unknown) => {
      console.warn("[quick-picks] first-run artist picks unavailable:", error);
    });
  }, [hydrateHistory, hydrateLibrary, hydratePicks, hydratePreferences]);

  /*
   * The derivation itself, unchanged.
   *
   * `deriveQuickPicks` stays a pure function with the behaviour it has always
   * had; this hook is plumbing, not a second opinion about what a Quick Pick
   * is.
   */
  const artists = useMemo(
    () =>
      deriveQuickPicks({
        languages,
        taste: { likedTracks, events },
        providerTracks,
        picks: storedPicks,
      }),
    [events, languages, likedTracks, providerTracks, storedPicks],
  );

  /*
   * `settled` is the conjunction of the two halves, and the local half is not
   * the lesser one: `storedPicks` is empty until `hydratePicks()` resolves,
   * and `likedTracks` and `events` are empty until *their* hydrations resolve.
   * A rail that settled against empty stores would settle on the wrong answer.
   */
  const storesHydrated = preferencesHydrated && libraryHydrated && historyHydrated && picksHydrated;
  const providerSettled = providerState !== "loading";
  const settled = providerSettled && storesHydrated;

  const retry = useCallback(() => {
    onRetry?.();
  }, [onRetry]);

  return {
    artists,
    settled,
    state: railState(artists.length, settled, providerState),
    retry,
  };
}
