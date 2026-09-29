import "fake-indexeddb/auto";
import { Suspense, type ReactNode } from "react";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AlbumPage from "@/app/album/[key]/page";
import ArtistPage from "@/app/artist/[key]/page";
import DiscoverPage from "@/app/discover/page";
import HomePage from "@/app/page";
import LibraryPage from "@/app/library/page";
import NowPlayingPage from "@/app/now-playing/page";
import QueuePage from "@/app/queue/page";
import SearchPage from "@/app/search/page";
import type { Track } from "@/data/repositories";
import { CIRCULAR_WINDOW } from "@/features/home/homeSections";
import { resetHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetPreferencesStore } from "@/stores/preferencesStore";
import { resetQueueStore } from "@/stores/queueStore";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Route-shell contracts. M8 replaces the M1 Home placeholder with the discovery
 * feed and adds the `/discover` route, so the Home cases below assert the feed
 * the route now mounts (ordered sections, the geometry rhythm, first-run
 * language onboarding) rather than the placeholder's skeletons and empty copy.
 *
 * M9 adds the `/artist/[key]` and `/album/[key]` routes and a presentation layer
 * on `/now-playing`. Those two dynamic routes are thin by design, so what is
 * pinned here is the *route* contract each one owns: the document's single
 * visually hidden `h1`, the client view mounted behind it, and the key handed
 * through verbatim. The Now Playing case pins the whole expanded-surface
 * contract after the M9 presentation work, so a later change to the artwork
 * backdrop, the title treatment, or the related-content shelf cannot quietly
 * drop a control or the watch attribution. Each of those surfaces keeps its own
 * functional coverage (`artist-view.test.tsx`, `album-view.test.tsx`,
 * `nowplaying.test.tsx`, `nowplaying-presentation.test.tsx`,
 * `more-like-this.test.tsx`); what is asserted here is the contract each is
 * mounted behind.
 *
 * The cases are deliberately *shell* level: which heading, which regions, which
 * affordances a route exposes before any user data exists. `/library` (M7),
 * `/search` (M5), and the Home/Discover surfaces (M8) are functional routes with
 * their own coverage (`library-surface.test.tsx`, `search-*.test.tsx`,
 * `home-view.test.tsx`, `discover-view.test.tsx`); what is asserted here is the
 * route contract each one is mounted behind.
 */

// Cold route renders plus several awaited shelves can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

// A stable `push` so a route's navigation target can be asserted; the rest of
// the router stays inert.
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The search route mounts the client SearchView, which reads the router;
// `/discover` mounts DiscoverView, which reads the search params; `/now-playing`
// navigates to the queue from its transport row.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    forward: vi.fn(),
    push,
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(""),
}));

/** The one credited track the discovery stub resolves every requested kind with. */
const FEED_TRACK: Track = makeTrack({
  id: "youtube:vid000001",
  providerId: "vid000001",
  title: "Alpha",
  artists: [{ name: "Aurora" }],
});

/** The track the Now Playing route case makes current; distinct from `FEED_TRACK`. */
const NOW_PLAYING_TRACK: Track = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Midnight",
  artists: [{ name: "Cobalt" }],
  artwork: [{ url: "https://example.test/now-playing.jpg" }],
});

/**
 * Answer the discovery endpoint. The routes must render their own structure
 * without reaching a provider, so the transport is stubbed per case: an empty
 * feed exercises the explanatory empty states, a track exercises the rails.
 */
function stubDiscovery(tracks: Track[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ tracks, diagnostics: {} }),
      } as unknown as Response),
    ),
  );
}

/**
 * The success body one catalog endpoint answers with. Each M9 endpoint has its
 * own envelope, and `/api/discover` and `/api/similar` share the
 * `{ tracks, diagnostics }` one, so a single stub can answer all four.
 */
function catalogBody(url: string, tracks: Track[]): unknown {
  if (url.startsWith("/api/artist")) {
    return {
      artist: { id: "UCqxfqu95j", name: "Aurora", artworkUrl: "https://example.test/artist.jpg" },
      tracks,
      related: [{ id: "UCnebosewq", name: "Cobalt", trackCount: tracks.length }],
      releases: [
        {
          id: "MPREb000001",
          title: "Night Signals",
          artistName: "Aurora",
          trackCount: tracks.length,
        },
      ],
      diagnostics: {},
    };
  }
  if (url.startsWith("/api/album")) {
    return {
      album: { id: "MPREb000001", title: "Night Signals", artistName: "Aurora", year: 2024 },
      tracks,
      metadataIncomplete: false,
      diagnostics: {},
    };
  }
  return { tracks, diagnostics: {} };
}

/**
 * Answer the M9 catalog endpoints. The route shells must render their own
 * structure without reaching a provider, so the transport is stubbed per case;
 * one entity keeps the artist and album resolutions from answering
 * `unresolvable`, and a *different* track is offered to `/api/similar` so the
 * Now Playing shelf has a candidate the current track is not.
 */
function stubCatalogApi(tracks: Track[] = [FEED_TRACK]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => catalogBody(String(input), tracks),
      } as unknown as Response),
    ),
  );
}

beforeEach(() => {
  // Every case starts from a fresh device: no likes, no playlists, no listening
  // history, onboarding not yet confirmed — the states a first run really has.
  // The transport store is reset too: the Now Playing surface and the catalog
  // pages both read it, so a current track must never leak between cases.
  resetLibraryStore();
  resetQueueStore();
  resetPlayerStore();
  clearPlaybackBridge();
  resetHistoryStore();
  resetPreferencesStore();
  push.mockClear();
  stubDiscovery();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("route shells", () => {
  it("renders home as the discovery feed with the fresh-user baseline shelves (M8)", async () => {
    render(<HomePage />);

    // The route's single h1 stays visually hidden; the feed owns the page.
    const heading = screen.getByRole("heading", { level: 1, name: "Home" });
    expect(heading).toHaveClass("sr-only");
    expect(await screen.findByTestId("home-view")).toBeInTheDocument();

    for (const id of ["trending", "popular-artists", "genres", "podcasts", "collections"]) {
      await waitFor(() => expect(screen.getByTestId(`home-section-${id}`)).toBeInTheDocument());
    }
    // No likes and no history yet, so no local-only section renders at all.
    expect(screen.queryByTestId("home-section-recently-played")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-section-made-for-you")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-section-smart-mixes")).not.toBeInTheDocument();

    // A shelf that resolved with nothing explains itself instead of leaving a gap.
    const trending = screen.getByTestId("home-section-trending");
    await waitFor(() =>
      expect(
        within(trending).getByRole("heading", { name: "Nothing here yet" }),
      ).toBeInTheDocument(),
    );

    // The M1 placeholder copy is gone from the route.
    expect(screen.queryByRole("heading", { name: "Trending songs" })).not.toBeInTheDocument();
    expect(
      screen.queryByText("Recommendations will appear here as you explore Spotivibe."),
    ).not.toBeInTheDocument();
  });

  it("keeps the circular Popular Artists shelf inside the first four rendered sections", async () => {
    const { container } = render(<HomePage />);
    await screen.findByTestId("home-view");

    // Document order of the rendered sections — the rhythm rule is about what
    // the user sees, not about the authored list.
    const rendered = [...container.querySelectorAll("[data-testid^='home-section-']")].map(
      (section) => section.getAttribute("data-testid") ?? "",
    );
    const circularIndex = rendered.indexOf("home-section-popular-artists");

    expect(rendered.length).toBeGreaterThan(CIRCULAR_WINDOW);
    expect(circularIndex).toBeGreaterThanOrEqual(0);
    // The spec's number, spelled once: four rendered sections.
    expect(CIRCULAR_WINDOW).toBe(4);
    expect(circularIndex).toBeLessThan(CIRCULAR_WINDOW);
  });

  it("mounts the first-run language onboarding while preferences are incomplete", async () => {
    render(<HomePage />);

    // Nothing local exists yet, so the dialog is the route's only guidance.
    const dialog = await screen.findByRole("dialog", { name: "Choose your languages" });
    expect(within(dialog).getByRole("searchbox", { name: "Filter languages" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save languages" })).toBeInTheDocument();
    // No account, sign-in, or email step is ever part of this choice.
    expect(dialog.textContent).not.toMatch(/sign in|log in|account|email/i);
  });

  it("exposes the designed shell affordances — focusable shelf rails and the language picker", async () => {
    stubDiscovery([FEED_TRACK]);
    render(<HomePage />);

    // The genre shelf's header carries the route into Discover.
    const seeAll = await screen.findByRole("link", { name: "See all" });
    expect(seeAll).toHaveAttribute("href", "/discover");
    // The reusable language picker is mounted with the onboarding dialog.
    expect(await screen.findByRole("searchbox", { name: "Filter languages" })).toBeInTheDocument();

    // Every rendered card rail is a focusable, named scroll region, so a keyboard
    // user can pan the shelf (DESIGN.md horizontal rail).
    const rails = await screen.findAllByTestId("shelf-rail");
    expect(rails.length).toBeGreaterThan(0);
    for (const rail of rails) {
      expect(rail).toHaveAttribute("tabindex", "0");
      expect(rail).toHaveAttribute("role", "group");
      expect(rail.getAttribute("aria-label")).toMatch(/ shelf$/);
    }
  });

  it("renders discover as the Suspense-wrapped discovery surface (M8)", async () => {
    render(<DiscoverPage />);

    const heading = screen.getByRole("heading", { level: 1, name: "Discover" });
    expect(heading).toHaveClass("sr-only");
    // The boundary resolved into DiscoverView rather than staying on its fallback.
    expect(await screen.findByTestId("discover-view")).toBeInTheDocument();
    expect(screen.queryByText("Loading Discover…")).not.toBeInTheDocument();
    // The wrapped view is the real surface: it summarizes the selected languages.
    expect(screen.getByTestId("discover-language-summary")).toHaveTextContent(
      "Selected languages: English",
    );
  });

  it("renders search in its browse state with no result surface", () => {
    render(<SearchPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Search" })).toBeInTheDocument();
    expect(screen.getByText("Search for music")).toBeInTheDocument();
    expect(screen.getByText("Find songs, artists, albums, and more to play.")).toBeInTheDocument();
    expect(screen.queryAllByTestId("skeleton")).toHaveLength(0);
    expect(screen.queryAllByRole("list")).toHaveLength(0);
    // The browse state stays inert until the user asks for something: no query
    // field, no playback control, no invented results.
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("renders library with its surface chrome and an empty state (M7)", async () => {
    render(<LibraryPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Your Library" })).toBeInTheDocument();
    // The M7 surface hydrates from IndexedDB before choosing its state.
    expect(await screen.findByText("Your library is empty")).toBeInTheDocument();
    expect(
      screen.getByText("Songs, albums, and playlists you save will appear here."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create playlist" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import playlist" })).toBeInTheDocument();
  });

  it("renders the queue route with its empty state", () => {
    render(<QueuePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Queue" })).toBeInTheDocument();
    expect(screen.getByText("Nothing queued yet")).toBeInTheDocument();
    expect(screen.queryAllByRole("region")).toHaveLength(0);
  });
});

/**
 * `use(params)` suspends on the first render even for an already-resolved
 * promise, so the dynamic M9 routes are mounted behind a boundary here — the
 * app root provides one. Nothing about the page's own markup changes.
 */
async function renderWithKey(route: (key: string) => ReactNode, key: string): Promise<void> {
  await act(async () => {
    render(<Suspense fallback={<p>loading</p>}>{route(key)}</Suspense>);
  });
}

describe("route shells: the M9 catalog routes", () => {
  it("mounts the artist view behind the route's single hidden heading (M9)", async () => {
    stubCatalogApi();
    await renderWithKey((key) => <ArtistPage params={Promise.resolve({ key })} />, "Aurora");

    // The artist is only known after the client resolution, so the route's own
    // `h1` is the visually hidden route name; the view owns the visible one.
    const heading = screen.getByRole("heading", { level: 1, name: "Artist" });
    expect(heading).toHaveClass("sr-only");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    // The client view mounted behind the route, resolved for the route's key.
    expect(await screen.findByTestId("artist-view")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Aurora" })).toBeInTheDocument();
    expect(screen.getByTestId("artist-tracks")).toBeInTheDocument();
  });

  it("mounts the album view behind the route's single hidden heading (M9)", async () => {
    stubCatalogApi();
    await renderWithKey(
      (key) => <AlbumPage params={Promise.resolve({ key })} />,
      "Dawn Chorus - Aurora",
    );

    // Same contract on the release route: one hidden route `h1`, visible title
    // owned by the view once the resolution lands.
    const heading = screen.getByRole("heading", { level: 1, name: "Album" });
    expect(heading).toHaveClass("sr-only");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);

    expect(await screen.findByTestId("album-view")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Night Signals" })).toBeInTheDocument();
    expect(screen.getByTestId("album-tracks")).toBeInTheDocument();
    // The release's own playback entry points are mounted by the route's view.
    expect(screen.getByTestId("album-play")).toBeEnabled();
    expect(screen.getByTestId("album-shuffle")).toBeEnabled();
  });
});

describe("route shells: Now Playing after the M9 presentation layer", () => {
  it("keeps the whole expanded-surface contract for the current track (M9)", async () => {
    stubCatalogApi();
    usePlayerStore.getState().playTrack(NOW_PLAYING_TRACK, [NOW_PLAYING_TRACK]);
    usePlayerStore.getState().pause();
    render(<NowPlayingPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Now Playing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close Now Playing" })).toHaveAttribute("href", "/");

    // The M9 presentation layer: the artwork-derived backdrop and the title.
    expect(screen.getByTestId("now-playing-background")).toHaveAttribute(
      "src",
      "https://example.test/now-playing.jpg",
    );
    expect(screen.getByTestId("now-playing-title")).toHaveTextContent("Midnight");
    expect(screen.getByText("Cobalt")).toBeInTheDocument();

    // Unchanged since M1/M4: like, progress, transport, toggles, and volume.
    expect(screen.getByRole("button", { name: "Save to Liked Songs" })).toBeEnabled();
    expect(screen.getByRole("slider", { name: "Track progress" })).toHaveAttribute(
      "aria-valuemax",
      "249",
    );
    expect(screen.getByRole("button", { name: "Previous track" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repeat: Off" })).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();

    // The queue affordance is navigation, and it still lands on the queue route.
    const queue = screen.getByRole("button", { name: "Queue" });
    expect(queue).toBeEnabled();
    fireEvent.click(queue);
    expect(push).toHaveBeenCalledWith("/queue");

    // The compliant watch attribution: no referrer suppression, still required.
    const watch = screen.getByTestId("now-playing-attribution");
    expect(watch).toHaveTextContent("Watch on YouTube");
    expect(watch).toHaveAttribute("href", "https://www.youtube.com/watch?v=aaa");
    expect(watch).toHaveAttribute("target", "_blank");
    expect(watch).toHaveAttribute("rel", "noopener");
    expect(watch).not.toHaveAttribute("referrerPolicy");

    // M9's related-content addition, mounted by this same route for the
    // playing track.
    expect(await screen.findByRole("heading", { name: "More Like This" })).toBeInTheDocument();
    expect(screen.getByTestId("more-like-this")).toBeInTheDocument();
  });
});
