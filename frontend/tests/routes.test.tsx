import "fake-indexeddb/auto";
import type { ReactNode } from "react";
import { configure, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverPage from "@/app/discover/page";
import HomePage from "@/app/page";
import LibraryPage from "@/app/library/page";
import QueuePage from "@/app/queue/page";
import SearchPage from "@/app/search/page";
import type { Track } from "@/data/repositories";
import { CIRCULAR_WINDOW } from "@/features/home/homeSections";
import { resetHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetPreferencesStore } from "@/stores/preferencesStore";
import { resetQueueStore } from "@/stores/queueStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Route-shell contracts. M8 replaces the M1 Home placeholder with the discovery
 * feed and adds the `/discover` route, so the Home cases below assert the feed
 * the route now mounts (ordered sections, the geometry rhythm, first-run
 * language onboarding) rather than the placeholder's skeletons and empty copy.
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
// `/discover` mounts DiscoverView, which reads the search params.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    back: vi.fn(),
    forward: vi.fn(),
    push: vi.fn(),
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

beforeEach(() => {
  // Every case starts from a fresh device: no likes, no playlists, no listening
  // history, onboarding not yet confirmed — the states a first run really has.
  resetLibraryStore();
  resetQueueStore();
  resetHistoryStore();
  resetPreferencesStore();
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
