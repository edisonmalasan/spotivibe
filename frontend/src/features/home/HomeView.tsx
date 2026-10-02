"use client";

import { Disc3 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import { Shelf, type ShelfState } from "@/components/recommendations/Shelf";
import type { Track } from "@/data/repositories";
import { artistHref, isProviderEntityId } from "@/features/artist/artistKeys";
import { genreHref, GENRE_CATALOG } from "@/features/home/genreCatalog";
import { HomeFilterBar } from "@/features/home/HomeFilterBar";
import {
  sectionsForFilter,
  type HomeFilter,
  type HomeFilterValue,
} from "@/features/home/homeFilter";
import {
  assertShelfRhythm,
  HOME_SECTIONS,
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
import { MixCards } from "@/features/home/mixes/MixCards";
import { QuickPicksShelf } from "@/features/home/QuickPicksShelf";
import { ShelfTrackCard } from "@/features/home/ShelfTrackCard";
import { TimeShelf } from "@/features/home/TimeShelf";
import { systemClock, type Clock } from "@/features/home/timeBands";
import { useDiscoveryShelf, type DiscoveryShelf } from "@/features/home/useDiscoveryShelf";
import { MixList } from "@/features/mixes/MixList";
import { LanguageOnboarding } from "@/features/preferences/LanguageOnboarding";
import { groupArtistsByIdentity } from "@/features/recommendations/artists";
import { useHistoryStore } from "@/stores/historyStore";
import { useLibraryStore } from "@/stores/libraryStore";
import { useMixStore } from "@/stores/mixStore";
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
 * - **M17's three new surfaces add nothing to the request count.** The filter is a
 *   selection over `HOME_SECTIONS`, not a second model; the mix cards and the
 *   Quick Picks are links and activations over local data; and the time-aware
 *   shelf is a lens over the store slices the feed already holds. Only the mix
 *   cards and the time shelf's own activation can reach a provider, and only on
 *   activation — which is why the shelf is handed the listener's language codes:
 *   the discovery contract rejects a request with none, so a shelf that composed
 *   without them could only ever fail.
 * - **One clock read per mount.** The band is derived from an instant supplied
 *   here, so the filter, the cards, and the shelf cannot disagree about what time
 *   it is because they each asked separately.
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
      // M11: the mixes the listener actually has, by name. No generation action
      // and no autoplay here — opening Home must not spend provider work or start
      // audio; building a mix is an explicit act on its own surface.
      //
      // The section header contract is kept (title plus the authored description),
      // but a mix is a *collection* rather than a single track, so its list is a
      // named list rather than a horizontal card shelf — see the amended
      // `discovery` delta in the M11 change.
      return (
        <section className="flex flex-col gap-4" data-testid={testId}>
          <header className="flex flex-col gap-1">
            <h2 className="text-title-lg font-bold text-pure-white">{section.title}</h2>
            <p className="text-body-lg text-mist">{section.description}</p>
          </header>
          <MixList title="" showGenerate={false} />
        </section>
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
              // M9 (task 6.1): the card opens the artist page. The entry id is
              // the provider's artist id when the shelf had one and the
              // normalized name otherwise, and the artist route resolves either
              // shape — so an id-less entry is a text-key link, not a dead card.
              href={artistHref(isProviderEntityId(artist.id) ? artist.id : artist.name)}
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
 *
 * `clock` is injectable (M17) so the whole surface — the mix cards' profile and
 * the time-aware shelf's band — reads **one** instant per mount instead of asking
 * separately and disagreeing at a band boundary. The default is the shared system
 * clock, so no production caller passes anything.
 */
export function HomeView({ clock = systemClock }: { clock?: Clock }) {
  const languages = usePreferencesStore((state) => state.languages);
  const preferencesHydrated = usePreferencesStore((state) => state.hydrated);
  const onboardingComplete = usePreferencesStore((state) => state.onboardingComplete);
  const hydratePreferences = usePreferencesStore((state) => state.hydrate);
  const events = useHistoryStore((state) => state.events);
  const hydrateHistory = useHistoryStore((state) => state.hydrate);
  const likedTracks = useLibraryStore((state) => state.likedTracks);
  const hydrateLibrary = useLibraryStore((state) => state.hydrate);
  // M11: the Smart Mixes section lists generated mixes, so the feed needs to
  // know whether the listener has one before it decides to render the section.
  const mixes = useMixStore((state) => state.mixes);
  const hydrateMixes = useMixStore((state) => state.hydrate);
  // Onboarding is offered until it is confirmed *or* dismissed for this visit.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // M17: the presented filter, for this visit only. No store, no preference, no
  // URL — a lens on the feed is not a piece of state the device keeps.
  const [filter, setFilter] = useState<HomeFilterValue>("all");
  // The one clock read this surface makes per mount, handed to both surfaces that
  // need an instant.
  const [now] = useState(() => clock());

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
    void hydrateMixes().catch((error: unknown) => {
      console.warn("[home] smart mixes unavailable:", error);
    });
  }, [hydrateHistory, hydrateLibrary, hydrateMixes, hydratePreferences]);

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
    hasMixes: mixes.length > 0,
  };
  // Two selections over the one model: the local-signal gate the feed has always
  // applied, and the presented filter. Neither can add a section, so the
  // geometry rhythm is checked on the list that is actually rendered — and an
  // unrecognised filter value presents everything, never nothing.
  const enabled = selectHomeSections(signals, HOME_SECTIONS);
  const sections = sectionsForFilter(enabled, filter);
  assertShelfRhythm(sections);

  const feed: Feed = {
    trending: useDiscoveryShelf({ kind: "trending", languages }),
    forYou: useDiscoveryShelf({
      kind: "for-you",
      languages,
      seeds,
      enabled: signals.hasLocalArtists,
    }),
    // M11: no `mix` discovery shelf any more. The mix *feed* is still what builds
    // a mix (see features/mixes/generateMix) — it is just no longer previewed on
    // Home, where a listener with no mix has nothing to open there.
    // The long-form preference is a presentation choice over the same result —
    // it never changes which feed is requested.
    podcasts: withLongFormPreference(useDiscoveryShelf({ kind: "podcast", languages })),
    collections: useDiscoveryShelf({ kind: "collection", languages }),
    recent: recentlyPlayedTracks(events, RECENT_LIMIT),
  };

  const showOnboarding = preferencesHydrated && !onboardingComplete && !onboardingDismissed;

  return (
    <div className="flex flex-col gap-8" data-testid="home-view">
      <HomeFilterBar
        value={filter}
        onChange={(chosen: HomeFilter) => {
          setFilter(chosen);
        }}
      />

      {/*
        The three M17 surfaces sit above the shelves, in their own rows rather than
        inside the section flow: they are *not* `HOME_SECTIONS` entries, so folding
        them in would mean either growing the one section list (which the rhythm
        check then guards as if they were shelves) or keeping a second list of what
        Home presents — the drift design decision 4 exists to prevent. Each one
        reads the same presented filter the sections do, so they appear and
        disappear together.
      */}
      <MixCards
        likedTracks={likedTracks}
        events={events}
        languages={languages}
        now={now}
        clock={clock}
        filter={filter}
      />
      <TimeShelf
        likedTracks={likedTracks}
        events={events}
        now={now}
        languages={languages}
        clock={clock}
        filter={filter}
      />
      <QuickPicksShelf
        likedTracks={likedTracks}
        events={events}
        languages={languages}
        filter={filter}
      />

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
