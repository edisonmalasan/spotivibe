"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Shelf, type ShelfState } from "@/components/recommendations/Shelf";
import type { Track } from "@/data/repositories";
import {
  DISCOVER_GENRE_PARAM,
  findGenre,
  GENRE_CATALOG,
  type GenreEntry,
} from "@/features/home/genreCatalog";
import { ShelfTrackCard } from "@/features/home/ShelfTrackCard";
import { useDiscoveryShelf } from "@/features/home/useDiscoveryShelf";
import { languageName } from "@/lib/languages";
import { useNetworkStore } from "@/stores/networkStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * `DiscoverView` (ROADMAP M8; spec: `discovery` — "Discover surface for genres
 * and languages"; design §2): the `/discover` surface — the selected-language
 * summary with a change affordance, and one independent shelf per genre.
 *
 * Each genre is its own component with its own `useDiscoveryShelf` instance, so
 * one genre's failure shows a retryable error on *that* shelf alone and the rest
 * of the surface stays usable. Nothing here starts playback on its own, and no
 * copy claims official chart status.
 *
 * `?genre=<id>` preselects a genre (Home's genre tiles link here) by marking that
 * shelf and rendering its entry first; the whole catalog is always present, so a
 * deep link never hides the rest of the surface.
 *
 * While the device is offline, remote discovery cannot run at all, so every
 * genre shelf is disabled — no request is issued — and the surface says why
 * instead of rendering blank regions.
 */

/** Copy for a genre shelf whose feed resolved with nothing. */
const GENRE_EMPTY = {
  title: "Nothing here yet",
  description: "No results for this genre in your languages. Try another genre.",
};

/** Copy for a genre shelf whose own request failed. */
const GENRE_ERROR = {
  title: "This genre didn't load",
  description: "We couldn't reach the music provider. Check your connection and try again.",
};

/** The offline explanation — the surface stays usable, nothing is requested. */
const OFFLINE_NOTICE =
  "You're offline. Genre discovery needs a connection, so no shelf is loading right now.";

/** Rendered above the shelves when preferences have not been read yet. */
const LANGUAGE_SUMMARY_LABEL = "Selected languages";

/** Map a shelf status onto the `Shelf` primitive's state vocabulary. */
function toShelfState(status: string): ShelfState {
  return status === "ready" || status === "empty" || status === "error" ? status : "loading";
}

/**
 * One genre's shelf. A component (not an inline hook call in a loop) so every
 * genre owns an independent request, controller, and state.
 */
function GenreShelf({
  genre,
  languages,
  remote,
  selected,
}: {
  genre: GenreEntry;
  languages: readonly string[];
  /** False while offline: the hook issues no request at all. */
  remote: boolean;
  selected: boolean;
}) {
  const shelf = useDiscoveryShelf({
    kind: "genre",
    languages,
    seeds: [genre.query],
    // The `genre` feed requires at least one seed, and the term is the genre's
    // own query text — no local taste is involved in this surface.
    enabled: remote,
  });

  const state = !remote ? "empty" : toShelfState(shelf.status);
  const tracks: Track[] = shelf.tracks;

  return (
    <Shelf
      title={genre.name}
      description={selected ? "Selected from Home." : undefined}
      shape="square"
      state={state}
      onRetry={shelf.retry}
      empty={
        remote ? GENRE_EMPTY : { ...GENRE_EMPTY, title: "Offline", description: OFFLINE_NOTICE }
      }
      error={GENRE_ERROR}
      data-testid={`discover-genre-${genre.id}`}
    >
      {tracks.map((track) => (
        <ShelfTrackCard key={track.id} track={track} context={tracks} />
      ))}
    </Shelf>
  );
}

/**
 * The Discover surface. Reads `?genre=` (so the route wraps it in Suspense) and
 * the local preferences/network stores, never IndexedDB directly.
 */
export function DiscoverView() {
  const searchParams = useSearchParams();
  const languages = usePreferencesStore((state) => state.languages);
  const hydratePreferences = usePreferencesStore((state) => state.hydrate);
  const connection = useNetworkStore((state) => state.connection);
  const requestedGenre = searchParams.get(DISCOVER_GENRE_PARAM);
  const selected = findGenre(requestedGenre);
  const offline = connection === "offline";

  useEffect(() => {
    void hydratePreferences().catch((error: unknown) => {
      console.warn("[discover] languages unavailable:", error);
    });
  }, [hydratePreferences]);

  // A requested genre leads the surface; the rest of the catalog follows in
  // catalog order, so a deep link never hides anything.
  const ordered = selected
    ? [selected, ...GENRE_CATALOG.filter((genre) => genre.id !== selected.id)]
    : [...GENRE_CATALOG];

  return (
    <div className="flex flex-col gap-8" data-testid="discover-view">
      <section aria-label="Discover languages" className="mb-8">
        <p data-testid="discover-language-summary" className="text-body-lg font-regular text-mist">
          {LANGUAGE_SUMMARY_LABEL}: {languages.map((code) => languageName(code)).join(", ")}
        </p>
        <Link
          href="/settings"
          className="mt-2 inline-block text-label font-bold text-mist transition hover:text-pure-white"
        >
          Change languages
        </Link>
      </section>

      {offline && (
        <p
          role="status"
          data-testid="discover-offline"
          className="rounded-cards bg-graphite px-4 py-3 text-body-lg font-regular text-mist"
        >
          {OFFLINE_NOTICE}
        </p>
      )}

      {ordered.map((genre) => (
        <GenreShelf
          key={genre.id}
          genre={genre}
          languages={languages}
          remote={!offline}
          selected={genre.id === selected?.id}
        />
      ))}
    </div>
  );
}
