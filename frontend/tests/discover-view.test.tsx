import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DiscoverPage from "@/app/discover/page";
import type { Track } from "@/data/repositories";
import { BottomNav } from "@/components/layout/BottomNav";
import { DiscoverView } from "@/features/discover/DiscoverView";
import {
  DISCOVER_GENRE_PARAM,
  GENRE_CATALOG,
  genreHref,
  findGenre,
} from "@/features/home/genreCatalog";
import { makeTrack } from "./helpers/music-fixtures";
import { resetNetworkStore, useNetworkStore } from "@/stores/networkStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";

/**
 * M8 tasks 7.1/7.2 (spec: `discovery` — "Discover surface for genres and
 * languages"): genre entries resolve their own shelves, the selected languages
 * are summarized with an affordance to change them, one failing genre is
 * isolated behind its own retry, and the surface explains itself — issuing no
 * request at all — while the device is offline.
 */

// Several awaited shelves per render can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

const nav = vi.hoisted(() => ({ search: "" as string, pathname: "/" as string }));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

/** How one genre's shelf answers: results, a structured failure, or never. */
type GenreReply = { tracks: Track[] } | { fail: number; code: string } | { hang: true };

function credited(
  id: string,
  title: string,
  artist: string,
  overrides: Partial<Track> = {},
): Track {
  return makeTrack({
    providerId: id.replace("youtube:", ""),
    id,
    title,
    artists: [{ name: artist }],
    ...overrides,
  });
}

interface Recorded {
  seeds: string | null;
  params: URLSearchParams;
}

/** Stub the genre feed per seed term; every genre is independent by construction. */
function stubGenres(reply: (seeds: string) => GenreReply = () => ({ tracks: [] })) {
  const calls: Recorded[] = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const seeds = url.searchParams.get("seeds");
    calls.push({ seeds, params: url.searchParams });
    const outcome = reply(seeds ?? "");
    if ("hang" in outcome) {
      return new Promise<Response>((_resolve, reject) => {
        (init as RequestInit | undefined)?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    if ("fail" in outcome) {
      return Promise.resolve({
        ok: false,
        status: outcome.fail,
        json: async () => ({ error: { code: outcome.code } }),
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ tracks: outcome.tracks, diagnostics: {} }),
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

/** Seeded, already-hydrated preferences — the surface's only local input. */
function seedPreferences(languages: string[] = ["en"]): void {
  usePreferencesStore.setState({
    languages,
    onboardingComplete: true,
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
}

/** Wait until every genre shelf has settled. */
async function settleSurface(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryAllByTestId("shelf-skeleton")).toHaveLength(0);
  });
}

beforeEach(() => {
  resetNetworkStore();
  resetPlayerStore();
  resetPreferencesStore();
  resetQueueStore();
  nav.search = "";
  nav.pathname = "/";
  seedPreferences();
  stubGenres();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DiscoverView: the surface", () => {
  it("renders one shelf per catalog genre, each with its own test id", async () => {
    render(<DiscoverView />);
    await settleSurface();

    expect(screen.getByTestId("discover-view")).toBeInTheDocument();
    for (const genre of GENRE_CATALOG) {
      expect(screen.getByTestId(`discover-genre-${genre.id}`)).toBeInTheDocument();
      expect(
        within(screen.getByTestId(`discover-genre-${genre.id}`)).getByRole("heading", {
          name: genre.name,
        }),
      ).toBeInTheDocument();
    }
  });

  it("queries the genre feed with the genre's own term for the selected languages", async () => {
    const { calls } = stubGenres(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<DiscoverView />);
    await settleSurface();

    expect(calls).toHaveLength(GENRE_CATALOG.length);
    for (const call of calls) {
      expect(call.params.get("kind")).toBe("genre");
      expect(call.params.get("languages")).toBe("en");
      // The `genre` feed requires a seed, and it is the genre's own query text.
      expect(call.params.get("seeds")).toBeTruthy();
      // No local taste reaches this surface at all.
      expect(call.params.get("seeds")).not.toMatch(/youtube:/);
    }
    const jazz = GENRE_CATALOG.find((genre) => genre.id === "jazz");
    expect(calls.some((call) => call.seeds === jazz?.query)).toBe(true);
  });

  it("shows skeletons while one genre shelf is in flight and the rest are usable", async () => {
    const jazz = GENRE_CATALOG.find((genre) => genre.id === "jazz");
    stubGenres((seeds) => (seeds === jazz?.query ? { hang: true } : { tracks: [] }));
    render(<DiscoverView />);

    // The in-flight genre shows shaped placeholders, not a blank region.
    const jazzShelf = screen.getByTestId("discover-genre-jazz");
    await waitFor(() =>
      expect(within(jazzShelf).getAllByTestId("shelf-skeleton")).not.toHaveLength(0),
    );
    // Every other genre already resolved with its own explained empty state.
    //
    // The wait above is for the **jazz** skeleton, which is present on first render — so it says
    // nothing about the other genres, whose fetches have not resolved yet at that instant. The
    // original version asserted their empty state immediately afterwards, which is a negative
    // assertion racing a resolution: on a loaded machine the other shelves were still showing their
    // skeletons and the run failed intermittently, for a reason that had nothing to do with what the
    // test is about.
    //
    // So the condition being asserted is awaited rather than assumed. Once the empty state is on
    // screen a shelf cannot also be showing a skeleton — they are alternative renderings — so the
    // negative assertion that follows is a consequence of the wait instead of a race against it.
    for (const genre of GENRE_CATALOG.filter((entry) => entry.id !== "jazz")) {
      const shelf = screen.getByTestId(`discover-genre-${genre.id}`);
      await waitFor(() =>
        expect(
          within(shelf).getByRole("heading", { name: "Nothing here yet" }),
          `${genre.id} must have resolved before its skeleton count means anything`,
        ).toBeInTheDocument(),
      );
      expect(within(shelf).queryAllByTestId("shelf-skeleton")).toHaveLength(0);
    }
    // And the genre that never resolved is still the only one waiting, which is the claim the test
    // exists to make. Asserted last so it cannot be satisfied by the loop above.
    expect(
      within(screen.getByTestId("discover-genre-jazz")).getAllByTestId("shelf-skeleton"),
    ).not.toHaveLength(0);
    // The language summary is never part of a shelf's loading state.
    expect(screen.getByTestId("discover-language-summary")).toBeInTheDocument();
  });

  it("aborts an in-flight genre request when the surface unmounts", async () => {
    const jazz = GENRE_CATALOG.find((genre) => genre.id === "jazz");
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (init?.signal) signals.push(init.signal);
        if (url.searchParams.get("seeds") === jazz?.query) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ tracks: [], diagnostics: {} }),
        } as unknown as Response);
      }),
    );

    const { unmount } = render(<DiscoverView />);
    await waitFor(() => expect(signals).toHaveLength(GENRE_CATALOG.length));

    unmount();

    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("explains a genre that yielded nothing", async () => {
    stubGenres(() => ({ tracks: [] }));
    render(<DiscoverView />);
    await settleSurface();

    const jazzShelf = screen.getByTestId("discover-genre-jazz");
    expect(
      within(jazzShelf).getByRole("heading", { name: "Nothing here yet" }),
    ).toBeInTheDocument();
    expect(within(jazzShelf).getByText(/No results for this genre/)).toBeInTheDocument();
    expect(within(jazzShelf).queryByTestId("shelf-rail")).not.toBeInTheDocument();
  });
});

describe("DiscoverView: one failing genre is isolated", () => {
  it("confines the failure to its own shelf and keeps the rest usable", async () => {
    const jazz = GENRE_CATALOG.find((genre) => genre.id === "jazz");
    stubGenres((seeds) =>
      seeds === jazz?.query
        ? { fail: 503, code: "upstream_unavailable" }
        : { tracks: [credited("a", "Alpha", "Aurora")] },
    );
    render(<DiscoverView />);

    const failing = await screen.findByTestId("discover-genre-jazz");
    await within(failing).findByRole("alert");
    expect(
      within(failing).getByRole("heading", { name: "This genre didn't load" }),
    ).toBeInTheDocument();

    // A sibling genre rendered its own results and offers no retry.
    const rock = screen.getByTestId("discover-genre-rock");
    expect(within(rock).getByText("Alpha")).toBeInTheDocument();
    expect(within(rock).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    // The rest of the catalog is unaffected.
    for (const genre of GENRE_CATALOG.filter((entry) => entry.id !== "jazz")) {
      expect(
        within(screen.getByTestId(`discover-genre-${genre.id}`)).queryByRole("alert"),
      ).toBeNull();
    }
  });

  it("retries only the failing genre", async () => {
    const jazz = GENRE_CATALOG.find((genre) => genre.id === "jazz");
    let failing = true;
    stubGenres((seeds) => {
      if (seeds !== jazz?.query) return { tracks: [] };
      return failing
        ? { fail: 503, code: "upstream_unavailable" }
        : { tracks: [credited("a", "Blue Note", "Aurora")] };
    });
    render(<DiscoverView />);

    const shelf = await screen.findByTestId("discover-genre-jazz");
    await within(shelf).findByRole("alert");
    failing = false;

    fireEvent.click(within(shelf).getByRole("button", { name: "Retry" }));

    expect(await within(shelf).findByText("Blue Note")).toBeInTheDocument();
    expect(within(shelf).queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("DiscoverView: the selected-language summary", () => {
  it("names the selected languages and offers a way to change them", async () => {
    seedPreferences(["en", "ja", "hi"]);
    render(<DiscoverView />);

    const summary = screen.getByTestId("discover-language-summary");
    expect(summary).toHaveTextContent("English, Japanese, Hindi");

    const change = screen.getByRole("link", { name: "Change languages" });
    expect(change).toHaveAttribute("href", "/settings");
  });

  it("follows a language change without a reload", async () => {
    render(<DiscoverView />);
    expect(screen.getByTestId("discover-language-summary")).toHaveTextContent("English");

    usePreferencesStore.setState({ languages: ["ko"] });

    await waitFor(() =>
      expect(screen.getByTestId("discover-language-summary")).toHaveTextContent("Korean"),
    );
  });

  it("renders the summary before any shelf, with the change affordance beside it", async () => {
    const { container } = render(<DiscoverView />);
    await settleSurface();

    const summary = screen.getByTestId("discover-language-summary");
    const change = screen.getByRole("link", { name: "Change languages" });
    expect(summary.compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toMatch(/account|sign in|email/i);
  });
});

describe("DiscoverView: a requested genre", () => {
  it("marks the genre named by ?genre= and keeps the whole catalog", async () => {
    nav.search = `${DISCOVER_GENRE_PARAM}=jazz`;
    const { container } = render(<DiscoverView />);
    await settleSurface();

    // Named and first among the genre shelves, because Home's tile links here.
    const shelves = [...container.querySelectorAll('[data-testid^="discover-genre-"]')];
    expect(shelves[0]).toHaveAttribute("data-testid", "discover-genre-jazz");
    expect(within(shelves[0] as HTMLElement).getByText("Selected from Home.")).toBeInTheDocument();
    for (const genre of GENRE_CATALOG) {
      expect(screen.getByTestId(`discover-genre-${genre.id}`)).toBeInTheDocument();
    }
    // The other shelves are not marked as selected.
    expect(
      within(screen.getByTestId("discover-genre-rock")).queryByText("Selected from Home."),
    ).toBeNull();
  });

  it("ignores an unknown genre and marks nothing", async () => {
    nav.search = `${DISCOVER_GENRE_PARAM}=polka`;
    render(<DiscoverView />);
    await settleSurface();

    expect(screen.queryByText("Selected from Home.")).not.toBeInTheDocument();
    expect(screen.getByTestId("discover-genre-pop")).toBeInTheDocument();
  });

  it("round-trips a Home genre tile href through the lookup", () => {
    for (const genre of GENRE_CATALOG) {
      const href = genreHref(genre.id);
      const id = new URL(href, "http://localhost").searchParams.get(DISCOVER_GENRE_PARAM);
      expect(findGenre(id)).toEqual(genre);
    }
  });
});

describe("DiscoverView: offline", () => {
  it("explains that discovery needs a connection and issues no request", async () => {
    useNetworkStore.setState({ connection: "offline" });
    const { mock } = stubGenres(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<DiscoverView />);

    const notice = await screen.findByTestId("discover-offline");
    expect(notice).toHaveTextContent(/offline/i);
    expect(notice).toHaveTextContent(/needs a connection/i);
    expect(notice).toHaveAttribute("role", "status");

    // No remote discovery is attempted at all, and no region is blank.
    expect(mock).not.toHaveBeenCalled();
    for (const genre of GENRE_CATALOG) {
      const shelf = screen.getByTestId(`discover-genre-${genre.id}`);
      expect(within(shelf).getByRole("heading", { name: "Offline" })).toBeInTheDocument();
      expect(within(shelf).queryByTestId("shelf-rail")).not.toBeInTheDocument();
    }
    // The language summary stays available, so the surface remains usable.
    expect(screen.getByTestId("discover-language-summary")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change languages" })).toBeInTheDocument();
  });

  it("resumes requesting once the device is back online", async () => {
    useNetworkStore.setState({ connection: "offline" });
    const { mock } = stubGenres(() => ({ tracks: [] }));
    render(<DiscoverView />);
    await screen.findByTestId("discover-offline");
    expect(mock).not.toHaveBeenCalled();

    useNetworkStore.setState({ connection: "online" });

    await waitFor(() => expect(mock).toHaveBeenCalledTimes(GENRE_CATALOG.length));
    await waitFor(() => expect(screen.queryByTestId("discover-offline")).not.toBeInTheDocument());
  });

  it("still issues requests under a merely degraded connection", async () => {
    useNetworkStore.setState({ connection: "degraded" });
    const { mock } = stubGenres(() => ({ tracks: [] }));
    render(<DiscoverView />);

    await waitFor(() => expect(mock).toHaveBeenCalledTimes(GENRE_CATALOG.length));
    expect(screen.queryByTestId("discover-offline")).not.toBeInTheDocument();
  });
});

describe("DiscoverView: playback and copy", () => {
  it("plays a genre track with the browse source and the genre shelf as context", async () => {
    const jazz = GENRE_CATALOG.find((genre) => genre.id === "jazz");
    const tracks = [
      credited("a", "So What", "Miles Davis", { language: "en" }),
      credited("b", "Blue in Green", "Miles Davis", { language: "en" }),
    ];
    stubGenres((seeds) => (seeds === jazz?.query ? { tracks } : { tracks: [] }));
    render(<DiscoverView />);
    await settleSurface();

    const shelf = screen.getByTestId("discover-genre-jazz");
    fireEvent.click(within(shelf).getByRole("button", { name: "Play So What by Miles Davis" }));

    expect(useQueueStore.getState().source).toBe("browse");
    expect(useQueueStore.getState().queue.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(usePlayerStore.getState().currentTrack?.id).toBe("a");
  });

  it("never starts playback by itself", async () => {
    stubGenres((seeds) => ({
      tracks: [credited("a", "Alpha", "Aurora", { id: `youtube:${seeds}` })],
    }));
    render(<DiscoverView />);
    await settleSurface();

    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().status).toBe("idle");
    expect(useQueueStore.getState().queue).toHaveLength(0);
  });

  it("makes no official-chart claim anywhere on the surface", async () => {
    const { container } = render(<DiscoverView />);
    await settleSurface();

    expect(container.textContent).not.toMatch(
      /chart|ranking|most listened|top of the|editor|spotify|youtube|official/i,
    );
  });
});

describe("the /discover route", () => {
  it("renders the page heading and the client surface behind a Suspense boundary", async () => {
    render(<DiscoverPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Discover" })).toBeInTheDocument();
    expect(await screen.findByTestId("discover-view")).toBeInTheDocument();
  });
});

describe("BottomNav: Discover is reachable from the compact shell", () => {
  it("links Discover alongside the other primary destinations", () => {
    render(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });

    const discover = within(nav).getByRole("link", { name: "Discover" });
    expect(discover).toHaveAttribute("href", "/discover");
    expect(discover.className).toContain("text-fog");
    // Home stays the active destination on `/`.
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  });

  it("marks Discover as the current page when the route is active", () => {
    nav.pathname = "/discover";
    render(<BottomNav />);
    const bar = screen.getByRole("navigation", { name: "Primary" });

    expect(within(bar).getByRole("link", { name: "Discover" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(bar).getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });
});
