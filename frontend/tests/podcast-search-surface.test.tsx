import { configure, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import { SearchResults } from "@/features/search/SearchResults";
import { PodcastCategoryList } from "@/features/search/PodcastCategoryList";
import {
  PODCAST_CATEGORIES,
  podcastCategoryQueries,
  podcastCategoryById,
} from "@/features/search/podcastCategories";
import { SEARCH_MODE_OPTIONS } from "@/features/search/SearchView";
import { isSearchMode, searchModeFromParam, SEARCH_MODE_PARAM } from "@/features/search/searchApi";
import { buildSearchUrl } from "@/lib/searchUrl";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";

/**
 * M12 tasks 4.2-4.4 and 5.1-5.2: the podcast mode on the search surface.
 *
 * The properties under test are the ones a listener can see: the mode is stated,
 * switching it preserves the query, podcast results are presented as episodes
 * with no Albums section, the empty state names the mode, and a category is a
 * shareable podcast-mode URL rather than a one-off fetch.
 */

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

// The derived tiles and the result menu navigate through the app router, so the
// surface needs one mounted even though no navigation is asserted here.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/search",
  useSearchParams: () => new URLSearchParams(),
}));

const episode = (id: string, title: string, channel: string): Track => ({
  id: `youtube:${id}`,
  source: "youtube",
  providerId: id,
  title,
  artists: [{ name: channel }],
  artwork: [],
  durationSeconds: 3600,
  category: "podcast",
  capabilities: { stream: true, offlineDownload: false },
});

const song = (id: string, title: string, artist: string): Track => ({
  id: `youtube:${id}`,
  source: "youtube",
  providerId: id,
  title,
  artists: [{ name: artist }],
  album: { id: `alb-${id}`, title: `Album ${id}` },
  artwork: [],
  durationSeconds: 240,
  category: "music",
  capabilities: { stream: true, offlineDownload: false },
});

beforeEach(() => {
  resetPreferencesStore();
  usePreferencesStore.setState({
    languages: ["en"],
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the mode in the URL", () => {
  it("defaults to music for an absent or unrecognized value", () => {
    expect(searchModeFromParam(null)).toBe("music");
    expect(searchModeFromParam("")).toBe("music");
    expect(searchModeFromParam("audiobooks")).toBe("music");
    expect(isSearchMode("podcast")).toBe(true);
    expect(isSearchMode("audiobooks")).toBe(false);
  });

  it("keeps a music URL byte-identical to the pre-M12 shape", () => {
    // A shared music link must not change because podcasts exist.
    expect(buildSearchUrl("lo-fi")).toBe("/search?q=lo-fi");
    expect(buildSearchUrl("lo-fi", "music")).toBe("/search?q=lo-fi");
    expect(buildSearchUrl("")).toBe("/search");
  });

  it("carries a podcast mode alongside the query", () => {
    expect(buildSearchUrl("true crime", "podcast")).toBe(
      `/search?q=true%20crime&${SEARCH_MODE_PARAM}=podcast`,
    );
    // And a podcast-mode browse state is still a linkable URL.
    expect(buildSearchUrl("", "podcast")).toBe(`/search?${SEARCH_MODE_PARAM}=podcast`);
  });

  it("round-trips through the param it writes", () => {
    const url = new URL(buildSearchUrl("history", "podcast"), "http://localhost");
    expect(searchModeFromParam(url.searchParams.get(SEARCH_MODE_PARAM))).toBe("podcast");
  });
});

describe("the mode control", () => {
  it("offers both modes with accessible state", () => {
    // The control's own markup is asserted in the SearchView suite; here the
    // options are the contract: exactly two, both labelled, podcast last.
    expect(SEARCH_MODE_OPTIONS.map((option) => option.mode)).toEqual(["music", "podcast"]);
    for (const option of SEARCH_MODE_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});

describe("podcast results are presented as episodes", () => {
  const episodes = [
    episode("ep1", "Interview: The Fall of Rome", "History Hour"),
    episode("ep2", "The Remix nobody asked for", "Late Night Talk"),
  ];

  it("names the sections Episodes and Shows and omits Albums", () => {
    render(
      <SearchResults
        tracks={episodes}
        query="rome"
        mode="podcast"
        onRefine={() => {}}
        onPlay={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Episodes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shows" })).toBeInTheDocument();
    // A podcast's metadata resolves no album identity, so the section is omitted
    // rather than rendered empty.
    expect(screen.queryByRole("heading", { name: "Albums" })).not.toBeInTheDocument();
  });

  it("shows each episode's show/channel and duration from the canonical track", () => {
    render(
      <SearchResults
        tracks={episodes}
        query="rome"
        mode="podcast"
        onRefine={() => {}}
        onPlay={() => {}}
      />,
    );

    const rows = within(screen.getByTestId("search-results")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Interview: The Fall of Rome");
    expect(rows[0]).toHaveTextContent("History Hour");
    expect(rows[0]).toHaveTextContent("1:00:00");
  });

  it("keeps the music presentation unchanged, Albums section included", () => {
    render(
      <SearchResults
        tracks={[song("s1", "Get Lucky", "Daft Punk"), song("s2", "One More Time", "Daft Punk")]}
        query="daft punk"
        mode="music"
        onRefine={() => {}}
        onPlay={() => {}}
      />,
    );

    expect(screen.getByRole("heading", { name: "Songs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Artists" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Albums" })).toBeInTheDocument();
  });

  it("defaults to the music presentation with no mode", () => {
    render(
      <SearchResults
        tracks={[song("s1", "Get Lucky", "Daft Punk")]}
        query="daft"
        onRefine={() => {}}
        onPlay={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Songs" })).toBeInTheDocument();
  });
});

describe("curated podcast categories", () => {
  it("resolves a language's own query text", () => {
    const news = podcastCategoryById("news");
    expect(news).toBeDefined();
    expect(podcastCategoryQueries(news!, ["en"])).toEqual(["news podcasts", "daily news podcast"]);
    expect(podcastCategoryQueries(news!, ["es"])).toEqual(["podcasts de noticias"]);
  });

  it("falls back to the neutral entry for a language it does not cover", () => {
    const news = podcastCategoryById("news");
    // A language with no entry must still produce a usable query, in the order the
    // selected languages are given, and then the neutral text.
    expect(podcastCategoryQueries(news!, ["zz"])).toEqual(news!.queries.neutral);
    expect(podcastCategoryQueries(news!, ["zz", "fr"])).toEqual(news!.queries.fr);
    expect(podcastCategoryQueries(news!, [])).toEqual(news!.queries.neutral);
  });

  it("gives every category a neutral fallback, so no selection can fall through", () => {
    for (const category of PODCAST_CATEGORIES) {
      const neutral = category.queries.neutral;
      expect(neutral, category.id).toBeDefined();
      expect(neutral!.length, category.id).toBeGreaterThan(0);
      // And no query is empty anywhere in the catalog.
      for (const [language, queries] of Object.entries(category.queries)) {
        expect(queries.length, `${category.id}:${language}`).toBeGreaterThan(0);
      }
    }
  });

  it("renders one entry per category, each a podcast-mode search URL", () => {
    render(<PodcastCategoryList />);

    expect(screen.getAllByRole("link")).toHaveLength(PODCAST_CATEGORIES.length);
    const link = screen.getByTestId("podcast-category-news");
    expect(link).toHaveAttribute("href", "/search?q=news%20podcasts&mode=podcast");
    // The resolved query is visible before the results arrive.
    expect(within(link).getByText("news podcasts")).toBeInTheDocument();
  });

  it("follows the selected languages, not the catalog's English", async () => {
    usePreferencesStore.setState({
      languages: ["es"],
      hydrated: true,
      hydrate: () => Promise.resolve(),
    });
    render(<PodcastCategoryList />);

    await waitFor(() =>
      expect(screen.getByTestId("podcast-category-news")).toHaveAttribute(
        "href",
        "/search?q=podcasts%20de%20noticias&mode=podcast",
      ),
    );
  });

  it("claims no ranking for a category", () => {
    render(<PodcastCategoryList />);
    const text = screen.getByTestId("podcast-categories").textContent ?? "";
    for (const claim of [/best/i, /top /i, /#1\b/i, /chart/i, /editor/i]) {
      expect(text, claim.source).not.toMatch(claim);
    }
  });
});
