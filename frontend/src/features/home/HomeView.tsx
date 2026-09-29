"use client";

import { Disc3 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import { Shelf, type ShelfState } from "@/components/recommendations/Shelf";
import type { Track } from "@/data/repositories";
import { genreHref, GENRE_CATALOG } from "@/features/home/genreCatalog";
import {
  assertShelfRhythm,
  HOME_SECTIONS,
  MIN_LOCAL_ARTISTS_FOR_MIXES,
  selectHomeSections,
  type HomeSection,
  type HomeSectionSignals,
} from "@/features/home/homeSections";
import {
  countLocalArtists,
  deriveSeedTerms,
  recentlyPlayedTracks,
  RECENT_LIMIT,
} from "@/features/home/localSeeds";
import { ShelfTrackCard } from "@/features/home/ShelfTrackCard";
import { useDiscoveryShelf, type DiscoveryShelf } from "@/features/home/useDiscoveryShelf";
import { LanguageOnboarding } from "@/features/preferences/LanguageOnboarding";
import { groupArtistsByIdentity } from "@/features/recommendations/artists";
import { buildSearchUrl } from "@/lib/searchUrl";
import { useHistoryStore } from "@/stores/historyStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

/**
 * `HomeView` (ROADMAP M8; spec: `discovery` — "Home discovery feed"; design
 * §2/§7/§8/§9): the client feed behind the `/` route.
 *
 * Structure:
 *
 * - **Ordered, data-driven sections.** `HOME_SECTIONS` is the order, and
 *   `assertShelfRhythm` guards the *rendered* list on every render, so the
 *   circular Popular Artists shelf can never be pushed past the first four
 *   sections or land next to another circular one — not even as local-only
 *   sections drop out for a fresh user.
 * - **One request per shelf.** Every feed shelf owns a `useDiscoveryShelf`
 *   instance with its own `AbortController`, so one failing provider call shows
 *   a retryable error on that shelf alone and the rest of the feed still
 *   renders.
 * - **Locally informed, still local.** Made For You and Smart Mixes are seeded
 *   from artist *names* derived on-device from likes and plays; the request
 *   carries nothing but those short terms plus the selected languages. Both are
 *   gated on the derived terms being non-empty, so a shelf can never render and
 *   then send a seedless (400) request.
 * - **No autoplay.** Nothing here starts playback; a card activation is the only
 *   path in, and it records the `browse` queue source.
 */

/** A resolved duration of at least this many seconds counts as long-form. */
export const LONG_FORM_MIN_SECONDS = 600;

/**
 * How many long-form results the podcast shelf needs before the preference is
 * honored — below this it falls back to the full result set rather than
 * presenting a nearly empty shelf as if long-form content did not exist.
 */
export const LONG_FORM_PREFERENCE_MINIMUM = 4;

/**
 * Podcast presentation preference (design §8): prefer results whose *known*
 * duration indicates long-form, and fall back to the full set when too few
 * survive. This is a local presentation choice only — the shared provider filter
 * pipeline is untouched, and a track with no known duration is not evidence of
 * shortness. Pure and lossless in the fallback case.
 */
export function preferLongFormTracks(tracks: readonly Track[]): Track[] {
  const longForm = tracks.filter(
    (track) =>
      typeof track.durationSeconds === "number" && track.durationSeconds >= LONG_FORM_MIN_SECONDS,
  );
  return longForm.length >= LONG_FORM_PREFERENCE_MINIMUM ? longForm : [...tracks];
}

/** Shared retryable failure copy — no chart claim, no blame on any service. */
const SHELF_ERROR = {
  title: "This shelf didn't load",
  description: "We couldn't reach the music provider. Check your connection and try again.",
};

/** Map a shelf status onto the `Shelf` primitive's state vocabulary. */
function toShelfState(status: string): ShelfState {
  // `idle` only reaches a rendered shelf when a local gate and the section's own
  // `enabled` predicate disagree; skeletons are the honest rendering.
  return status === "ready" || status === "empty" || status === "error" ? status : "loading";
}

/** A shelf with its resolved tracks replaced by the long-form preference. */
function withLongFormPreference(shelf: DiscoveryShelf): DiscoveryShelf {
  if (shelf.status !== "ready") return shelf;
  const tracks = preferLongFormTracks(shelf.tracks);
  return { ...shelf, tracks, status: tracks.length > 0 ? "ready" : "empty" };
}

/** A genre navigation tile — a link, not a play affordance. */
function GenreTile({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={genreHref(id)}
      data-testid={`home-genre-${id}`}
      className="flex w-full flex-col gap-2 rounded-cards bg-carbon p-3 transition-colors hover:bg-graphite"
    >
      <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-cards bg-graphite">
        <Disc3 className="size-8 text-fog" aria-hidden="true" />
      </span>
      <span className="flex flex-col gap-1">
        <span className="truncate text-body-lg font-semibold text-pure-white">{name}</span>
        <span className="text-body-lg font-regular text-mist">Genre</span>
      </span>
    </Link>
  );
}

/** Everything a section renderer needs, resolved once by the feed. */
interface Feed {
  trending: ReturnType<typeof useDiscoveryShelf>;
  forYou: ReturnType<typeof useDiscoveryShelf>;
  mixes: ReturnType<typeof useDiscoveryShelf>;
  podcasts: ReturnType<typeof useDiscoveryShelf>;
  collections: ReturnType<typeof useDiscoveryShelf>;
  recent: Track[];
}

/** The cards of a track shelf, each playing the whole shelf as its context. */
function trackCards(tracks: Track[]) {
  return tracks.map((track) => <ShelfTrackCard key={track.id} track={track} context={tracks} />);
}

/**
 * Render one section of the feed. The order comes from `HOME_SECTIONS`; this
 * switch only decides what a section's body is.
 */
function HomeSectionView({ section, feed }: { section: HomeSection; feed: Feed }) {
  const testId = `home-section-${section.id}`;

  switch (section.id) {
    case "recently-played":
      return (
        <Shelf
          title={section.title}
          description={section.description}
          shape={section.shape}
          state={feed.recent.length > 0 ? "ready" : "empty"}
          data-testid={testId}
        >
          {trackCards(feed.recent)}
        </Shelf>
      );

    case "trending":
      return (
        <Shelf
          title={section.title}
          description={section.description}
          shape={section.shape}
          state={toShelfState(feed.trending.status)}
          onRetry={feed.trending.retry}
          error={SHELF_ERROR}
          data-testid={testId}
        >
          {trackCards(feed.trending.tracks)}
        </Shelf>
      );

    case "made-for-you":
      return (
        <Shelf
          title={section.title}
          description={section.description}
          shape={section.shape}
          state={toShelfState(feed.forYou.status)}
          onRetry={feed.forYou.retry}
          error={SHELF_ERROR}
          data-testid={testId}
        >
          {trackCards(feed.forYou.tracks)}
        </Shelf>
      );

    case "smart-mixes":
      return (
        <Shelf
          title={section.title}
          description={section.description}
          shape={section.shape}
          state={toShelfState(feed.mixes.status)}
          onRetry={feed.mixes.retry}
          error={SHELF_ERROR}
          data-testid={testId}
        >
          {trackCards(feed.mixes.tracks)}
        </Shelf>
      );

    case "podcasts":
      return (
        <Shelf
          title={section.title}
          description={section.description}
          shape={section.shape}
          state={toShelfState(feed.podcasts.status)}
          onRetry={feed.podcasts.retry}
          error={SHELF_ERROR}
          data-testid={testId}
        >
          {trackCards(feed.podcasts.tracks)}
        </Shelf>
      );

    case "collections":
      return (
        <Shelf
          title={section.title}
          description={section.description}
          shape={section.shape}
          state={toShelfState(feed.collections.status)}
          onRetry={feed.collections.retry}
          error={SHELF_ERROR}
          data-testid={testId}
        >
          {trackCards(feed.collections.tracks)}
        </Shelf>
      );

    case "genres":
      return (
        <Shelf
          title={section.title}
          description={section.description}
          shape={section.shape}
          state="ready"
          action={{ label: "See all", href: "/discover" }}
          data-testid={testId}
        >
          {GENRE_CATALOG.map((genre) => (
            <GenreTile key={genre.id} id={genre.id} name={genre.name} />
          ))}
        </Shelf>
      );

    case "popular-artists": {
      // Derived from the Trending result: no extra request, and its loading and
      // error states are the trending shelf's.
      const trending = feed.trending;
      if (toShelfState(trending.status) !== "ready") {
        return (
          <Shelf
            title={section.title}
            description={section.description}
            shape={section.shape}
            state={toShelfState(trending.status)}
            onRetry={trending.retry}
            error={SHELF_ERROR}
            data-testid={testId}
          />
        );
      }
      const artists = groupArtistsByIdentity(trending.tracks);
      return (
        <Shelf
          title={section.title}
          description={section.description}
          shape={section.shape}
          state={artists.length > 0 ? "ready" : "empty"}
          empty={{
            title: "No artists found yet",
            description: "Artist entries appear once the trending shelf resolves with credits.",
          }}
          data-testid={testId}
        >
          {artists.map((artist) => (
            <Link
              key={artist.id}
              href={buildSearchUrl(artist.name)}
              data-testid="home-artist-card"
              className="block w-full"
            >
              <ArtistCard name={artist.name} artworkUrl={artist.artworkUrl} />
            </Link>
          ))}
        </Shelf>
      );
    }
  }
}

/**
 * The `/` feed. Reads the three local stores it depends on, hydrates each on
 * mount (the stores are idempotent and shell-global), and renders only the
 * sections the local signals enable.
 */
export function HomeView() {
  const languages = usePreferencesStore((state) => state.languages);
  const preferencesHydrated = usePreferencesStore((state) => state.hydrated);
  const onboardingComplete = usePreferencesStore((state) => state.onboardingComplete);
  const hydratePreferences = usePreferencesStore((state) => state.hydrate);
  const events = useHistoryStore((state) => state.events);
  const hydrateHistory = useHistoryStore((state) => state.hydrate);
  const likedTracks = useLibraryStore((state) => state.likedTracks);
  const hydrateLibrary = useLibraryStore((state) => state.hydrate);
  // Onboarding is offered until it is confirmed *or* dismissed for this visit.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);

  useEffect(() => {
    // Storage failures are reported by the stores' own surfaces; the feed must
    // still render its non-personalized shelves, so a failed read only warns.
    void hydratePreferences().catch((error: unknown) => {
      console.warn("[home] languages unavailable:", error);
    });
    void hydrateHistory().catch((error: unknown) => {
      console.warn("[home] listening history unavailable:", error);
    });
    void hydrateLibrary().catch((error: unknown) => {
      console.warn("[home] liked tracks unavailable:", error);
    });
  }, [hydrateHistory, hydrateLibrary, hydratePreferences]);

  // Local signals drive which sections render at all, and — through the seeds —
  // which locally informed shelves may issue a request.
  //
  // The gate is the *derived seed list itself*, never the artist count. The two
  // are not the same question: `countLocalArtists` credits an artist by provider
  // id, while `deriveSeedTerms` can only send a term it has a non-blank *name*
  // for. A local artist with a blank name therefore counts as one artist and
  // yields no term — and `for-you`/`mix` are caller-seeded kinds the endpoint
  // answers with 400 when the seed list is empty. Gating on the count would
  // render the shelf and then issue a request guaranteed to be rejected; gating
  // on the terms it will actually send makes "the shelf appears" and "the
  // request is valid" the same condition.
  const localArtistCount = countLocalArtists({ likedTracks, events });
  const seeds = deriveSeedTerms({ likedTracks, events });
  const signals: HomeSectionSignals = {
    hasHistory: events.length > 0,
    hasLocalArtists: seeds.length > 0,
    localArtistCount,
  };
  const sections = selectHomeSections(signals, HOME_SECTIONS);
  assertShelfRhythm(sections);

  const feed: Feed = {
    trending: useDiscoveryShelf({ kind: "trending", languages }),
    forYou: useDiscoveryShelf({
      kind: "for-you",
      languages,
      seeds,
      enabled: signals.hasLocalArtists,
    }),
    mixes: useDiscoveryShelf({
      kind: "mix",
      languages,
      seeds,
      enabled: signals.hasLocalArtists && signals.localArtistCount >= MIN_LOCAL_ARTISTS_FOR_MIXES,
    }),
    // The long-form preference is a presentation choice over the same result —
    // it never changes which feed is requested.
    podcasts: withLongFormPreference(useDiscoveryShelf({ kind: "podcast", languages })),
    collections: useDiscoveryShelf({ kind: "collection", languages }),
    recent: recentlyPlayedTracks(events, RECENT_LIMIT),
  };

  const showOnboarding = preferencesHydrated && !onboardingComplete && !onboardingDismissed;

  return (
    <div className="flex flex-col gap-8" data-testid="home-view">
      {sections.map((section) => (
        <HomeSectionView key={section.id} section={section} feed={feed} />
      ))}

      {showOnboarding && (
        <LanguageOnboarding
          onClose={() => {
            setOnboardingDismissed(true);
          }}
        />
      )}
    </div>
  );
}
