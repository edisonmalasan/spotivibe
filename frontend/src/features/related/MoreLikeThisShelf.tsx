"use client";

import { useCallback } from "react";
import { Shelf, type ShelfState } from "@/components/recommendations/Shelf";
import type { Track } from "@/data/repositories";
import { ShelfTrackCard } from "@/features/home/ShelfTrackCard";
import { useDiscoveryShelf, type ShelfTrackRequest } from "@/features/home/useDiscoveryShelf";
import { fetchSimilarTracks, SimilarApiError } from "@/features/related/similarApi";
import { usePlayerStore } from "@/stores/playerStore";

/**
 * `MoreLikeThisShelf` (M9 task 5.2; spec: `catalog` — "Related content for the
 * current track"; design §8): the related-content shelf on the Now Playing
 * surface.
 *
 * The rules it exists to hold:
 *
 * - **Scoped to the playing track.** The current track comes from
 *   `playerStore` — the same state the transport renders from, so a change
 *   anywhere (shelf card, queue, search result) re-resolves this shelf with no
 *   second state source and no reload.
 * - **The current track is never suggested.** The server already drops the
 *   source candidate, and {@link withoutCurrentTrack} drops it again on the way
 *   to the rail: a shelf that offered the track you are already listening to is
 *   the one failure a user would read as the app being broken, so the check
 *   exists on both sides of the wire.
 * - **No user data leaves the device.** The request carries the track's public
 *   title, its primary artist credit, and its id as the exclusion — nothing else.
 *   Related content needs no cloud profile, no liked-track payload, and no
 *   history, which is why this surface is available to an accountless app.
 * - **Reuses the shared shelf machinery (design §8).** Loading, empty, error,
 *   retry, the abort on track change, and the page-wide request cap all come
 *   from `useDiscoveryShelf`; the shelf primitive and the square track cards are
 *   the same ones Home and Discover render. There is no second lifecycle here to
 *   keep in step.
 * - **Never autoplays.** Resolving, re-resolving, and rendering suggestions start
 *   nothing: `ShelfTrackCard` plays only on an explicit activation, and this
 *   component never calls into the transport store.
 */

/**
 * How many resolved suggestions the rail shows.
 *
 * A client-side presentation cap, like Home's long-form preference: the endpoint
 * answers with its own default candidate count and the rail scrolls sideways
 * either way, so a bounded rail keeps the expanded surface from turning into a
 * strip dozens of cards long. The candidates shown are still the provider's
 * order — this never reorders or re-ranks anything.
 */
const MORE_LIKE_THIS_LIMIT = 10;

/**
 * The provider-backed framing of the section. It says what the shelf is without
 * claiming a ranking, a popularity measure, or a listener count — providers
 * expose none of those, and the design records that there is no related-content
 * endpoint behind this at all.
 */
const DESCRIPTION = "Suggestions based on the track that's playing.";

/** Copy for a source track the provider had nothing similar for. */
const EMPTY = {
  title: "Nothing similar found",
  description: "The music provider had no other tracks to suggest for this one.",
};

/** Shared retryable failure copy — no chart claim, no blame on any service. */
const ERROR = {
  title: "This shelf didn't load",
  description: "We couldn't reach the music provider. Check your connection and try again.",
};

/** Map a shelf status onto the `Shelf` primitive's state vocabulary. */
function toShelfState(status: string): ShelfState {
  // `idle` only reaches a rendered shelf when a local gate and the shelf's own
  // `enabled` predicate disagree; skeletons are the honest rendering.
  return status === "ready" || status === "empty" || status === "error" ? status : "loading";
}

/**
 * Drop the playing track from a resolved candidate list.
 *
 * Matches on both `id` and `providerId`, exactly as the server does after its
 * merge, so neither the canonical `youtube:<id>` id nor a bare video id can put
 * the current track back on its own rail.
 */
function withoutCurrentTrack(tracks: readonly Track[], current: Track | null): Track[] {
  if (current === null) return [...tracks];
  return tracks.filter(
    (track) => track.id !== current.id && track.providerId !== current.providerId,
  );
}

/**
 * The More Like This shelf for whatever is playing.
 *
 * Renders nothing at all when no track is current: there is no playing track to
 * scope the section to, and an empty shelf under "Nothing playing" would
 * describe a request that was never made.
 */
export function MoreLikeThisShelf() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const track = currentTrack;

  // The primary credit is the narrowing a provider can actually match on; the
  // rest of the credit is left off because a comma-joined list is not a query
  // any tier parses, and the title alone already resolves the track itself.
  const title = track?.title ?? "";
  const artist = track?.artists[0]?.name.trim() ?? "";
  const exclude = track?.id;

  /**
   * Content-based request identity (design §8). It encodes exactly what
   * `fetchSimilarTracks` closes over below, so a different track re-resolves and
   * a re-render with the same track does not.
   */
  const scope = JSON.stringify([exclude ?? null, title, artist]);

  const fetchTracks = useCallback(
    async ({ signal }: ShelfTrackRequest): Promise<Track[]> => {
      try {
        const { tracks } = await fetchSimilarTracks({
          title,
          ...(artist !== "" ? { artist } : {}),
          ...(exclude !== undefined ? { exclude } : {}),
          signal,
        });
        return tracks;
      } catch (error: unknown) {
        // "Nothing similar resolved" is an answer, not a failure: the route's
        // 404 becomes this shelf's ordinary explained-empty state, and only a
        // real failure reaches the error state with its retry.
        if (error instanceof SimilarApiError && error.code === "unresolvable") return [];
        throw error;
      }
    },
    [title, artist, exclude],
  );

  const shelf = useDiscoveryShelf({
    scope,
    fetchTracks,
    enabled: track !== null,
  });

  if (track === null) return null;

  const candidates = withoutCurrentTrack(shelf.tracks, track).slice(0, MORE_LIKE_THIS_LIMIT);
  // A source whose every candidate was the current track is empty, not ready:
  // the rail must never render "ready" with nothing in it.
  const state =
    shelf.status === "ready" && candidates.length === 0 ? "empty" : toShelfState(shelf.status);

  return (
    <Shelf
      title="More Like This"
      description={DESCRIPTION}
      shape="square"
      state={state}
      onRetry={shelf.retry}
      empty={EMPTY}
      error={ERROR}
      data-testid="more-like-this"
    >
      {candidates.map((candidate) => (
        <ShelfTrackCard key={candidate.id} track={candidate} context={candidates} />
      ))}
    </Shelf>
  );
}
