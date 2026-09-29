"use client";

import { Heart, Music2, Radio, User } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import { Button, pillButtonClassName } from "@/components/design-system/Button";
import { EmptyState } from "@/components/design-system/EmptyState";
import { ErrorState } from "@/components/design-system/ErrorState";
import { IconButton } from "@/components/design-system/IconButton";
import { SectionHeader } from "@/components/design-system/SectionHeader";
import { Skeleton } from "@/components/design-system/Skeleton";
import { Shelf } from "@/components/recommendations/Shelf";
import { SongRow } from "@/components/track/SongRow";
import type { Track } from "@/data/repositories";
import {
  ArtistApiError,
  fetchArtist,
  isRetryableArtistError,
  type ArtistApiErrorCode,
  type ArtistDetail,
  type ArtistRelease,
} from "@/features/artist/artistApi";
import { albumHrefFromRelease } from "@/features/album/albumKeys";
import { artistHref, artistRequestKey } from "@/features/artist/artistKeys";
import { likedTracksByArtist } from "@/features/artist/likedByArtist";
import { playFromShelf } from "@/features/home/browsePlayback";
import { useLibraryReady } from "@/features/library/useLibraryReady";
import { songCountLabel } from "@/lib/playlistPresentation";
import { useLibraryStore } from "@/stores/libraryStore";

/**
 * `ArtistView` (M9 tasks 3.3–3.4; spec: `catalog` — "Artist page" / "Local
 * catalog signals"; design §1/§2/§4/§5): the client surface behind
 * `/artist/[key]`.
 *
 * Structure and the rules it exists to hold:
 *
 * - **One resolution, four sections.** Identity, popular tracks, releases, and
 *   related artists all come from a *single* `/api/artist` response (design
 *   §1) — a page must never fan out more concurrent provider work than the
 *   shared outbound budget can serve, so there is exactly one request in flight
 *   and no section re-resolves.
 * - **Four designed states, none of them blank.** Loading renders skeletons
 *   shaped like the content they replace; a retryable failure renders
 *   `ErrorState` with a retry; an `unresolvable` key renders a recoverable
 *   not-found state carrying *both* a retry and a way back; and a ready page
 *   renders every section it resolved.
 * - **Activation only.** Nothing here starts playback. A row plays, the radio
 *   action seeds, a release or related artist navigates, and a row's heart
 *   writes through `libraryStore.toggleLike` so like state matches every other
 *   surface without a remount.
 * - **Local signal, no request.** "Liked tracks by this artist" is a pure
 *   filter over `libraryStore.likedTracks` (design §4), rendered *only* when it
 *   is non-empty — an empty section is a hole in the page, not information.
 * - **No account, no authority.** No sign-in copy, and no chart, ranking, or
 *   "fans also like" claim: related artists are described as being drawn from
 *   the tracks above, which is literally what they are.
 */

/** How many rows the loading placeholder shows for a track list. */
const LOADING_ROW_COUNT = 5;

/** Intrinsic image size for the hero and card artwork (declares the 1:1 ratio). */
const ARTWORK_SIZE = 300;

/** Shared retryable failure copy — no chart claim, no blame on any service. */
const RESOLUTION_ERROR = {
  title: "This artist didn't load",
  description: "We couldn't reach the music provider. Check your connection and try again.",
};

/**
 * `invalid_request` is a bug in this codebase, not a provider hiccup, so the
 * copy must not send the user off to check a connection that was never the
 * problem. The retry is still offered — the same key can resolve on a newer
 * deploy — but the message is honest about what failed.
 */
const INVALID_REQUEST_ERROR = {
  title: "This artist didn't load",
  description: "This request could not be built correctly. Go back and try another artist.",
};

/** The not-found copy: what happened, and the two ways out. */
const NOT_FOUND = {
  title: "Artist not found",
  description:
    "We couldn't match that artist on the music service. Check the name, or try searching for them.",
};

/** Copy for a section the provider resolved nothing for. */
const NO_RELEASES = {
  title: "No releases found",
  description: "These results carried no release information.",
};

const NO_RELATED = {
  title: "No related artists",
  description: "These results credited no other artists.",
};

/** How the resolution settled. */
type ArtistStatus = "loading" | "ready" | "not-found" | "error";

/** A settled resolution, tagged with the request it belongs to. */
interface Settled {
  token: string;
  status: ArtistStatus;
  detail?: ArtistDetail;
  code?: ArtistApiErrorCode;
}

interface ArtistRequestState {
  status: ArtistStatus;
  detail?: ArtistDetail;
  code?: ArtistApiErrorCode;
  retry: () => void;
}

/**
 * One artist resolution's lifecycle.
 *
 * The request is identified by the route key plus the attempt, so navigating to
 * a different artist re-runs it and a `retry()` re-runs the same one — while an
 * unrelated re-render cannot. Each run owns its own `AbortController`, so
 * unmounting (or navigating away) cancels the in-flight request and a late
 * response is discarded rather than written to state, exactly as
 * `useDiscoveryShelf` does per shelf.
 *
 * A blank key never reaches the network: it is a missing route parameter, and
 * the page's honest answer for it is the not-found state.
 */
function useArtistRequest(key: string): ArtistRequestState {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  // Content-based request identity, so a retry and a key change are the only
  // things that restart the request.
  const token = JSON.stringify([key, attempt]);
  const requestKey = artistRequestKey(key);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const detail = await fetchArtist({ key, signal: controller.signal });
        if (cancelled) return;
        setSettled({ token, status: "ready", detail });
      } catch (error: unknown) {
        // An abort caused by unmount or supersession is not a failure to
        // report; the next token's effect owns what happens next.
        if (cancelled) return;
        const code = error instanceof ArtistApiError ? error.code : "network";
        if (code === "invalid_request") {
          // The client validated the key and the server rejected it anyway,
          // which is a bug in this codebase — surface the error state and make
          // the cause debuggable instead of silently swallowed.
          console.warn(
            "[artist] the artist request was rejected as invalid — this is a client bug:",
            {
              key,
              code,
            },
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

  if (requestKey === null) return { status: "not-found", retry };
  if (settled !== null && settled.token === token) {
    return { status: settled.status, detail: settled.detail, code: settled.code, retry };
  }
  return { status: "loading", retry };
}

/**
 * A titled section over a vertical body — DESIGN.md "Section Header" (24px/700
 * white title) with a plain list below. The `Shelf` primitive owns the
 * horizontally scrollable *card rail*, so the two row-list sections use this
 * instead of bending a rail around rows.
 */
function ArtistSection({
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
 * The artist hero's circular image. DESIGN.md "Circular Artist Card" /
 * "Imagery": artist photos are circular crops and the circle *is* the visual, so
 * no card fill sits behind it — and with no artwork the surface keeps the
 * monochrome placeholder rather than an empty circle.
 */
function ArtistPortrait({ artworkUrl }: { artworkUrl?: string }) {
  return (
    <div
      data-testid="artist-portrait"
      className="grid size-32 shrink-0 place-items-center overflow-hidden rounded-avatars bg-graphite sm:size-44 lg:size-56"
    >
      {artworkUrl === undefined ? (
        <User className="size-14 text-fog sm:size-20" aria-hidden="true" />
      ) : (
        // Provider artist imagery: dynamic remote URLs, no optimizer allowlist
        // yet (M9 owns asset handling). The name is the adjacent heading, so the
        // image itself is decorative.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkUrl}
          alt=""
          width={ARTWORK_SIZE}
          height={ARTWORK_SIZE}
          loading="lazy"
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

/**
 * A release tile (DESIGN.md "Square Album Card": 6px radius cover, 12px card
 * padding on the #121212 canvas lifting to #1f1f1f, white 14px/600 title, mist
 * 14px/400 artist line). It is a **navigation** tile, not a play control — the
 * whole card is one link, so click, Enter, and Space are the same activation and
 * the global focus ring is never clipped.
 */
function ReleaseCard({ release }: { release: ArtistRelease }) {
  return (
    <Link
      href={albumHrefFromRelease(release)}
      data-testid="artist-release"
      className="flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 text-left transition-colors hover:bg-graphite"
    >
      <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-cards bg-graphite">
        {release.artworkUrl === undefined ? (
          <Music2 className="size-8 text-fog" aria-hidden="true" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={release.artworkUrl}
            alt=""
            width={ARTWORK_SIZE}
            height={ARTWORK_SIZE}
            loading="lazy"
            className="size-full rounded-cards object-cover"
          />
        )}
      </span>
      <span className="flex flex-col gap-1">
        <span className="truncate text-body-lg font-semibold text-pure-white">{release.title}</span>
        <span className="truncate text-body-lg font-regular text-mist">
          {release.artistName ?? "Album"}
        </span>
        <span className="truncate text-label font-regular text-mist">
          {songCountLabel(release.trackCount)}
        </span>
      </span>
    </Link>
  );
}

export interface ArtistViewProps {
  /** The `/artist/[key]` route parameter, verbatim. */
  artistKey: string;
}

/**
 * The artist page body. The route (`app/artist/[key]/page.tsx`) owns the
 * document's single visually hidden `h1`; the resolved name is this surface's
 * visible heading, so it is an `h2` directly under it.
 */
export function ArtistView({ artistKey }: ArtistViewProps) {
  const { status, detail, code, retry } = useArtistRequest(artistKey);
  const likedTracks = useLibraryStore((state) => state.likedTracks);
  // The library read is idempotent and shell-global, so this surface only has
  // to ask for it. It is the *only* local input to the liked section, and it
  // issues no network request of its own.
  useLibraryReady();

  const tracks = useMemo(() => detail?.tracks ?? [], [detail]);
  // The local signal (design §4): a pure filter over the liked dataset, so the
  // section appears and disappears as the local data changes, with no request.
  const liked = useMemo(
    () => (detail === undefined ? [] : likedTracksByArtist(likedTracks, detail.artist)),
    [detail, likedTracks],
  );

  /** Like/unlike through the repository-first store; a failure keeps the UI as-is. */
  function toggleLike(track: Track): void {
    void useLibraryStore
      .getState()
      .toggleLike(track)
      .catch((error: unknown) => {
        console.warn("[artist] like toggle failed:", error);
      });
  }

  /**
   * "Start artist radio" (design §5): seed playback from the *whole* resolved
   * feed through the existing `browse` path, so the queue labels the context
   * "From browse" and the artist page plays through. Radio *behaviour* (refill,
   * dedupe, a `radio` queue source) is M10's acceptance criteria; this seeds it
   * honestly rather than pretending to a continuous station.
   */
  function startArtistRadio(): void {
    const first = tracks[0];
    if (first === undefined) return;
    playFromShelf(first, tracks);
  }

  /** One playable, likeable row; play and like are separate real controls. */
  function trackRows(list: readonly Track[]) {
    return list.map((track) => {
      const likedAlready = useLibraryStore.getState().likedIds.has(track.id);
      return (
        <SongRow
          key={track.id}
          track={track}
          onPlay={() => playFromShelf(track, tracks)}
          trailing={
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
          }
        />
      );
    });
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-8" data-testid="artist-view">
        <div className="flex flex-wrap items-end gap-6" data-testid="artist-loading">
          <Skeleton variant="circle" className="size-32 shrink-0 sm:size-44 lg:size-56" />
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton variant="text" className="h-8 w-56" />
            <Skeleton variant="text" className="w-32" />
          </div>
        </div>
        <ArtistSection title="Popular" testId="artist-tracks">
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
        </ArtistSection>
      </div>
    );
  }

  // Recoverable not-found (design §2), which is also the honest answer to a
  // blank key — that case never issued a request at all. The `status` is the
  // only thing that decides this: a *failed* resolution also has no `detail`, so
  // testing `detail` here would swallow the error state above.
  if (status === "not-found") {
    return (
      <div className="flex flex-col gap-8" data-testid="artist-view">
        <div className="flex flex-col items-center gap-4 px-6 py-6" data-testid="artist-not-found">
          <EmptyState title={NOT_FOUND.title} description={NOT_FOUND.description} />
          {/* Both ways out: a retry, because the resolution may have failed for a
              transient reason upstream, and a way back, because this is a dead
              route rather than a broken app. */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="ghost" onClick={retry} data-testid="artist-not-found-retry">
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
      <div className="flex flex-col gap-8" data-testid="artist-view">
        <div data-testid="artist-error">
          <ErrorState
            title={
              code !== undefined && !isRetryableArtistError(code)
                ? INVALID_REQUEST_ERROR.title
                : RESOLUTION_ERROR.title
            }
            description={
              code !== undefined && !isRetryableArtistError(code)
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

  const { artist, releases, related } = detail;

  return (
    <div className="flex flex-col gap-8" data-testid="artist-view">
      <div className="flex flex-wrap items-end gap-6">
        <ArtistPortrait artworkUrl={artist.artworkUrl} />
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-heading font-bold text-pure-white">{artist.name}</h2>
          <p className="text-body-lg font-regular text-mist">
            {["Artist", songCountLabel(tracks.length)].join(" • ")}
          </p>
          <div className="mt-2">
            <Button
              onClick={startArtistRadio}
              disabled={tracks.length === 0}
              data-testid="artist-radio"
            >
              <Radio className="size-4" aria-hidden="true" />
              Start artist radio
            </Button>
          </div>
        </div>
      </div>

      <ArtistSection title="Popular" testId="artist-tracks">
        <ul className="flex flex-col gap-2">{trackRows(tracks)}</ul>
      </ArtistSection>

      {/* Omitted rather than rendered empty (spec: "The section is omitted when
          nothing matches"). */}
      {liked.length > 0 && (
        <ArtistSection title="Liked tracks by this artist" testId="artist-liked">
          <ul className="flex flex-col gap-2">{trackRows(liked)}</ul>
        </ArtistSection>
      )}

      <Shelf
        title="Releases"
        description="Grouped from the tracks above."
        shape="square"
        state={releases.length > 0 ? "ready" : "empty"}
        empty={NO_RELEASES}
        data-testid="artist-releases"
      >
        {releases.map((release) => (
          <ReleaseCard key={release.id ?? release.title} release={release} />
        ))}
      </Shelf>

      <Shelf
        title="Related artists"
        description="Other artists credited on the tracks above."
        shape="circular"
        state={related.length > 0 ? "ready" : "empty"}
        empty={NO_RELATED}
        data-testid="artist-related"
      >
        {related.map((entry) => (
          <Link
            key={entry.id ?? entry.name}
            href={artistHref(entry.id ?? entry.name)}
            data-testid="artist-related-card"
            aria-label={`${entry.name}, ${songCountLabel(entry.trackCount)}`}
            className="block w-full"
          >
            <ArtistCard name={entry.name} artworkUrl={entry.artworkUrl} />
          </Link>
        ))}
      </Shelf>
    </div>
  );
}
