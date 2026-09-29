"use client";

import { CircleAlert, Heart, Music2, Play, Plus, Shuffle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, pillButtonClassName } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import { ErrorState } from "@/components/design-system/ErrorState";
import { IconButton } from "@/components/design-system/IconButton";
import { SectionHeader } from "@/components/design-system/SectionHeader";
import { Skeleton } from "@/components/design-system/Skeleton";
import { SongRow } from "@/components/track/SongRow";
import type { Track } from "@/data/repositories";
import {
  AlbumApiError,
  fetchAlbum,
  isRetryableAlbumError,
  type AlbumApiErrorCode,
  type AlbumDetail,
} from "@/features/album/albumApi";
import { artistHref } from "@/features/artist/artistKeys";
import { playFromShelf } from "@/features/home/browsePlayback";
import { useLibraryReady } from "@/features/library/useLibraryReady";
import { PlaylistPicker } from "@/features/search/PlaylistPicker";
import { songCountLabel } from "@/lib/playlistPresentation";
import { useLibraryStore } from "@/stores/libraryStore";
import { useQueueStore } from "@/stores/queueStore";

/**
 * `AlbumView` (M9 task 4.2; spec: `catalog` — "Album page"; design §1/§2/§3):
 * the client surface behind `/album/[key]`.
 *
 * Structure and the rules it exists to hold:
 *
 * - **One resolution, one list.** The hero, the release metadata, and the
 *   tracks all come from a *single* `/api/album` response (design §1) — a page
 *   must never fan out more concurrent provider work than the shared outbound
 *   budget can serve, so there is exactly one request in flight.
 * - **Resolved order, never re-sorted.** A search-derived release is an
 *   approximation; the server states whether it could *confirm* the release
 *   (`metadataIncomplete`, design §3) and this surface shows the tracks exactly
 *   as they came back. Re-ordering them here would claim a tracklist authority
 *   the resolution never had — the same fabricated authority the M8 spec
 *   forbids for charts.
 * - **Four designed states, none of them blank.** Loading renders skeletons
 *   shaped like the content they replace; a retryable failure renders
 *   `ErrorState` with a retry; an `unresolvable` key renders a recoverable
 *   not-found state carrying *both* a retry and a way back; and a ready page
 *   renders the release and its tracks.
 * - **Activation only.** Nothing here starts playback on mount. Play adopts the
 *   album as the playback context, Shuffle does the same with shuffle *ensured
 *   on*, a row's heart writes through `libraryStore.toggleLike`, and the
 *   playlist action opens the **existing** picker — the M7 duplicate rule lives
 *   inside `libraryStore.addTrackToPlaylist` and a second picker here would
 *   fork it.
 * - **Optional metadata is shown, never demanded.** Artwork, year, and artist
 *   are all legitimately absent from a search-derived resolution, so the hero
 *   falls back to the design's placeholder cover and the meta line simply
 *   omits what is unknown instead of rendering placeholders as if they were
 *   facts.
 */

/** How many rows the loading placeholder shows for a track list. */
const LOADING_ROW_COUNT = 5;

/** Intrinsic image size for the hero cover (declares the 1:1 ratio). */
const ARTWORK_SIZE = 300;

/** Shared retryable failure copy — no release claim, no blame on any service. */
const RESOLUTION_ERROR = {
  title: "This release didn't load",
  description: "We couldn't reach the music provider. Check your connection and try again.",
};

/**
 * `invalid_request` is a bug in this codebase, not a provider hiccup, so the
 * copy must not send the user off to check a connection that was never the
 * problem. The retry is still offered — the same key can resolve on a newer
 * deploy — but the message is honest about what failed.
 */
const INVALID_REQUEST_ERROR = {
  title: "This release didn't load",
  description: "This request could not be built correctly. Go back and try another release.",
};

/** The not-found copy: what happened, and the two ways out. */
const NOT_FOUND = {
  title: "Release not found",
  description:
    "We couldn't match that release on the music service. Check the title, or try searching for it.",
};

/**
 * Design §3: the resolution could not confirm that the returned tracks belong
 * to the requested release. The copy says exactly that — the list is shown, but
 * it is explicitly not a confirmed tracklist.
 */
const METADATA_INCOMPLETE = {
  title: "Track list not confirmed",
  description:
    "The music service didn't confirm that these songs belong to this release, so the list below may be incomplete or approximate.",
};

/** How the resolution settled. */
type AlbumStatus = "loading" | "ready" | "not-found" | "error";

/** A settled resolution, tagged with the request it belongs to. */
interface Settled {
  token: string;
  status: AlbumStatus;
  detail?: AlbumDetail;
  code?: AlbumApiErrorCode;
}

interface AlbumRequestState {
  status: AlbumStatus;
  detail?: AlbumDetail;
  code?: AlbumApiErrorCode;
  retry: () => void;
}

/**
 * One album resolution's lifecycle.
 *
 * The request is identified by the route key plus the attempt, so navigating to
 * a different release re-runs it and a `retry()` re-runs the same one — while an
 * unrelated re-render cannot. Each run owns its own `AbortController`, so
 * unmounting (or navigating away) cancels the in-flight request and a late
 * response is discarded rather than written to state, exactly as the artist page
 * and `useDiscoveryShelf` do per shelf.
 *
 * A blank key never reaches the network: it is a missing route parameter, and
 * the page's honest answer for it is the not-found state.
 */
function useAlbumRequest(key: string): AlbumRequestState {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  // Content-based request identity, so a retry and a key change are the only
  // things that restart the request.
  const token = JSON.stringify([key, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    // A blank key is a missing route parameter, not a request: the view answers
    // it with the not-found state below, with no network call.
    if (key.trim() === "") return;
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const detail = await fetchAlbum({ key, signal: controller.signal });
        if (cancelled) return;
        setSettled({ token, status: "ready", detail });
      } catch (error: unknown) {
        // An abort caused by unmount or supersession is not a failure to
        // report; the next token's effect owns what happens next.
        if (cancelled) return;
        const code = error instanceof AlbumApiError ? error.code : "network";
        if (code === "invalid_request") {
          // The client validated the key and the server rejected it anyway,
          // which is a bug in this codebase — surface the error state and make
          // the cause debuggable instead of silently swallowed.
          console.warn(
            "[album] the album request was rejected as invalid — this is a client bug:",
            { key, code },
          );
        }
        setSettled({ token, status: code === "unresolvable" ? "not-found" : "error", code });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `token` already encodes every request input; the values are read from the
    // render that produced it, so a changed value always re-runs the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (key.trim() === "") return { status: "not-found", retry };
  if (settled !== null && settled.token === token) {
    return { status: settled.status, detail: settled.detail, code: settled.code, retry };
  }
  return { status: "loading", retry };
}

/**
 * A titled section over a vertical body — DESIGN.md "Section Header" (24px/700
 * white title) with a plain list below. The `Shelf` primitive owns the
 * horizontally scrollable *card rail*, so the track list uses this instead of
 * bending a rail around rows.
 */
function AlbumSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="mb-8" data-testid={testId}>
      <SectionHeader title={title} />
      {children}
    </section>
  );
}

/**
 * The release hero's square cover. DESIGN.md "Square Album Card" / "Imagery":
 * a cover is a tight 1:1 crop at the 6px content radius, and with no artwork
 * the surface keeps the monochrome placeholder rather than an empty box.
 *
 * Decorative (`aria-hidden`): the release title is the adjacent heading, so the
 * cover adds no information a screen reader needs.
 */
function ReleaseCover({ artworkUrl }: { artworkUrl?: string }) {
  return (
    <div
      data-testid="album-cover"
      aria-hidden="true"
      className="grid size-40 shrink-0 place-items-center overflow-hidden rounded-cards bg-graphite sm:size-48 lg:size-58"
    >
      {artworkUrl === undefined ? (
        <Music2 className="size-12 text-fog" />
      ) : (
        // Provider release artwork: dynamic remote URLs, no optimizer allowlist
        // yet (M9 owns asset handling).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkUrl}
          alt=""
          width={ARTWORK_SIZE}
          height={ARTWORK_SIZE}
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

/**
 * The design §3 notice: the resolution resolved *something* but could not
 * confirm it is this release's track list. Announced as a status (not an
 * alert — nothing failed), styled in the monochrome palette, and placed directly
 * above the list it qualifies so the two cannot be read apart.
 */
function MetadataIncompleteNotice() {
  return (
    <div
      role="status"
      data-testid="album-metadata-incomplete"
      className="flex items-start gap-3 rounded-cards bg-carbon p-4"
    >
      <span className="text-fog" aria-hidden="true">
        <CircleAlert className="size-5 shrink-0" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-lg font-bold text-pure-white">{METADATA_INCOMPLETE.title}</p>
        <p className="text-body text-mist">{METADATA_INCOMPLETE.description}</p>
      </div>
    </div>
  );
}

export interface AlbumViewProps {
  /** The `/album/[key]` route parameter, verbatim. */
  albumKey: string;
}

/**
 * The album page body. The route (`app/album/[key]/page.tsx`) owns the
 * document's single visually hidden `h1`; the resolved release title is this
 * surface's visible heading, so it is an `h2` directly under it.
 */
export function AlbumView({ albumKey }: AlbumViewProps) {
  const { status, detail, code, retry } = useAlbumRequest(albumKey);
  // Subscribing to the liked ids is what makes a row's heart re-render when its
  // like lands: the store is the single authority for like state, and reading it
  // through a subscription is how every other surface stays in step with search
  // and Now Playing without a remount.
  const likedIds = useLibraryStore((state) => state.likedIds);
  // The library read is idempotent and shell-global, so this surface only has to
  // ask for it; the per-row heart and the playlist picker both write through
  // the same store.
  useLibraryReady();

  /** The track the picker is open for; `null` keeps the dialog closed. */
  const [pickerTrackId, setPickerTrackId] = useState<string | null>(null);

  // Resolved order, carried through untouched (design §3) — the array identity
  // the server sent is the array the page renders.
  const tracks = useMemo(() => detail?.tracks ?? [], [detail]);

  /** Like/unlike through the repository-first store; a failure keeps the UI as-is. */
  function toggleLike(track: Track): void {
    void useLibraryStore
      .getState()
      .toggleLike(track)
      .catch((error: unknown) => {
        console.warn("[album] like toggle failed:", error);
      });
  }

  /**
   * Play: the whole album becomes the playback context, starting at its first
   * track, through the same `browse` entry point the artist radio uses. Plain
   * play never turns shuffle on — that is the shuffle action's job.
   */
  function playAlbum(): void {
    const first = tracks[0];
    if (first === undefined) return;
    playFromShelf(first, tracks);
  }

  /**
   * Shuffle: the same context and the same starting track, with shuffle
   * *ensured on* — set directly, never toggled, so plain play's shuffle-off
   * state stays off and an already-on state isn't flipped off. `setContext`
   * rebuilds the traversal order from the flag synchronously.
   */
  function shuffleAlbum(): void {
    const first = tracks[0];
    if (first === undefined) return;
    useQueueStore.setState({ shuffle: true });
    playFromShelf(first, tracks);
  }

  /** One playable, likeable, addable row; each action is a separate real control. */
  function trackRows(list: readonly Track[]) {
    return list.map((track) => {
      const likedAlready = likedIds.has(track.id);
      return (
        <SongRow
          key={track.id}
          track={track}
          onPlay={() => playFromShelf(track, tracks)}
          trailing={
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                label={
                  likedAlready
                    ? `Remove ${track.title} from Liked Songs`
                    : `Save ${track.title} to Liked Songs`
                }
                aria-pressed={likedAlready}
                onClick={() => toggleLike(track)}
              >
                <Heart
                  className={`size-4 ${likedAlready ? "fill-current text-spotify-green" : "text-mist"}`}
                  aria-hidden="true"
                />
              </IconButton>
              {/* The existing M7 picker, opened for exactly one track: a second
                  picker here would fork the duplicate rule that lives inside
                  `libraryStore.addTrackToPlaylist`. */}
              <IconButton
                label={`Add ${track.title} to a playlist`}
                onClick={() => setPickerTrackId(track.id)}
              >
                <Plus className="size-4" aria-hidden="true" />
              </IconButton>
            </div>
          }
        />
      );
    });
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-8" data-testid="album-view">
        <div className="flex flex-wrap items-end gap-6" data-testid="album-loading">
          <Skeleton className="size-40 shrink-0 sm:size-48 lg:size-58" />
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton variant="text" className="h-8 w-56" />
            <Skeleton variant="text" className="w-32" />
          </div>
        </div>
        <AlbumSection title="Tracks" testId="album-tracks">
          <ul className="flex flex-col gap-2">
            {Array.from({ length: LOADING_ROW_COUNT }, (_, index) => (
              <li
                key={index}
                className="flex items-center gap-3 rounded-cards bg-smoke px-3 py-2"
                aria-hidden="true"
              >
                <Skeleton className="size-10 shrink-0 rounded-images" />
                <Skeleton variant="text" className="flex-1" />
              </li>
            ))}
          </ul>
        </AlbumSection>
      </div>
    );
  }

  // Recoverable not-found (design §2), which is also the honest answer to a
  // blank key — that case never issued a request at all. The `status` is the
  // only thing that decides this: a *failed* resolution also has no `detail`, so
  // testing `detail` here would swallow the error state above.
  if (status === "not-found") {
    return (
      <div className="flex flex-col gap-8" data-testid="album-view">
        <div className="flex flex-col items-center gap-4 px-6 py-6" data-testid="album-not-found">
          <EmptyState title={NOT_FOUND.title} description={NOT_FOUND.description} />
          {/* Both ways out: a retry, because the resolution may have failed for a
              transient reason upstream, and a way back, because this is a dead
              route rather than a broken app. */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="ghost" onClick={retry} data-testid="album-not-found-retry">
              Try again
            </Button>
            <Link href="/" className={pillButtonClassName}>
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col gap-8" data-testid="album-view">
        <div data-testid="album-error">
          <ErrorState
            title={
              code !== undefined && !isRetryableAlbumError(code)
                ? INVALID_REQUEST_ERROR.title
                : RESOLUTION_ERROR.title
            }
            description={
              code !== undefined && !isRetryableAlbumError(code)
                ? INVALID_REQUEST_ERROR.description
                : RESOLUTION_ERROR.description
            }
            onRetry={retry}
            retryLabel="Retry"
          />
        </div>
      </div>
    );
  }

  // The three states above are exhaustive, so a ready page always has a payload.
  // The assertion is here rather than spread over the JSX because TypeScript
  // narrows the *status* discriminant, not the optional sibling field.
  if (detail === undefined) return null;

  const { album, metadataIncomplete } = detail;
  const empty = tracks.length === 0;
  // Only the release metadata that actually resolved is claimed; a search-derived
  // resolution frequently carries no year and no cover, and inventing a label for
  // a missing field would be presenting a gap as information.
  const metaLine = ["Album", songCountLabel(tracks.length), album.year?.toString()]
    .filter((part): part is string => part !== undefined)
    .join(" • ");
  const pickerTrack = tracks.find((track) => track.id === pickerTrackId);

  return (
    <div className="flex flex-col gap-8" data-testid="album-view">
      <div className="flex flex-wrap items-end gap-6">
        <ReleaseCover artworkUrl={album.artworkUrl} />
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-heading font-bold text-pure-white">{album.title}</h2>
          {album.artistName !== undefined && (
            <Link
              href={artistHref(album.artistName)}
              data-testid="album-artist-link"
              className="text-body-lg font-bold text-mist transition hover:text-pure-white"
            >
              {album.artistName}
            </Link>
          )}
          <p className="text-body font-regular text-mist">{metaLine}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button onClick={playAlbum} disabled={empty} data-testid="album-play">
              <Play className="size-4 fill-current" aria-hidden="true" />
              Play
            </Button>
            <Button
              variant="ghost"
              onClick={shuffleAlbum}
              disabled={empty}
              data-testid="album-shuffle"
            >
              <Shuffle className="size-4" aria-hidden="true" />
              Shuffle
            </Button>
          </div>
        </div>
      </div>

      {metadataIncomplete && <MetadataIncompleteNotice />}

      <AlbumSection title="Tracks" testId="album-tracks">
        {empty ? (
          // A ready resolution always has tracks (an empty one is reported
          // unresolvable), so this is the defensive explanation, not a live path.
          <EmptyState
            title="No tracks found"
            description="This resolution carried no playable songs."
          />
        ) : (
          <ul className="flex flex-col gap-2">{trackRows(tracks)}</ul>
        )}
      </AlbumSection>

      {pickerTrack !== undefined && (
        <PlaylistPicker track={pickerTrack} onClose={() => setPickerTrackId(null)} />
      )}
    </div>
  );
}
