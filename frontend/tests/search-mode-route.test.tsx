import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";
import { useSearchStore } from "@/stores/searchStore";

/**
 * M12 task 4.1/4.2: the mode control on the real route.
 *
 * The controller suite covers the request state machine and the surface suite
 * covers presentation; what only a route-level render can show is that the mode
 * is read from the URL, that switching it preserves the query, that it re-runs
 * the search, and that the top-bar input the M5 spec protects is not remounted by
 * a mode switch.
 */

configure({ asyncUtilTimeout: 5000 });

const nav = vi.hoisted(() => ({
  q: "",
  mode: "" as string,
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () =>
    new URLSearchParams(
      Object.fromEntries(
        [nav.q === "" ? null : ["q", nav.q], nav.mode === "" ? null : ["mode", nav.mode]].filter(
          (entry): entry is [string, string] => entry !== null,
        ),
      ),
    ),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const episode = {
  id: "youtube:ep1",
  source: "youtube" as const,
  providerId: "ep1",
  title: "Interview: The Fall of Rome",
  artists: [{ name: "History Hour" }],
  // Artwork is part of the presentation contract, so the fixture carries a real
  // URL rather than an empty list the row could satisfy with a placeholder.
  artwork: [{ url: "https://example.test/ep1.jpg", width: 120, height: 120 }],
  durationSeconds: 3600,
  category: "podcast" as const,
  capabilities: { stream: true, offlineDownload: false },
};

const song = {
  id: "youtube:s1",
  source: "youtube" as const,
  providerId: "s1",
  title: "Get Lucky",
  artists: [{ name: "Daft Punk" }],
  artwork: [],
  durationSeconds: 249,
  category: "music" as const,
  capabilities: { stream: true, offlineDownload: false },
};

let fetchMock: ReturnType<typeof vi.fn>;

/** Answer according to the request's own `category` parameter. */
function stubSearch(empty = false) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const podcast = url.searchParams.get("category") === "podcast";
    const tracks = empty ? [] : podcast ? [episode] : [song];
    return {
      ok: true,
      status: 200,
      json: async () => ({ tracks }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  nav.q = "";
  nav.mode = "";
  nav.replace.mockClear();
  stubSearch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The requested URLs, as query strings. */
function requestUrls(): URLSearchParams[] {
  return fetchMock.mock.calls.map(
    (call) => new URL(String(call[0]), "http://localhost").searchParams,
  );
}

describe("the mode control on the search route", () => {
  it("announces music mode by default and shows both options", async () => {
    nav.q = "rome";
    render(<SearchPage />);

    const group = await screen.findByTestId("search-mode-switch");
    expect(group).toHaveAttribute("role", "radiogroup");
    expect(group).toHaveAttribute("aria-label", "Search mode");
    expect(screen.getByTestId("search-mode-music")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("search-mode-podcast")).toHaveAttribute("aria-checked", "false");
  });

  it("reads podcast mode from the URL and asks that question", async () => {
    nav.q = "rome";
    nav.mode = "podcast";
    render(<SearchPage />);

    expect(await screen.findByTestId("search-mode-podcast")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await waitFor(() =>
      expect(requestUrls().some((params) => params.get("category") === "podcast")).toBe(true),
    );
    // The result is presented as an episode, which is the whole point.
    expect(await screen.findByText("Episodes")).toBeInTheDocument();
  });

  it("falls back to music mode for an unrecognized URL value", async () => {
    nav.q = "rome";
    nav.mode = "audiobooks";
    render(<SearchPage />);

    expect(await screen.findByTestId("search-mode-music")).toHaveAttribute("aria-checked", "true");
    // A working search beats an error page: music mode is the documented default.
    await waitFor(() =>
      expect(requestUrls().some((params) => params.get("q") === "rome")).toBe(true),
    );
  });

  it("sends no category parameter at all in music mode", async () => {
    nav.q = "daft";
    render(<SearchPage />);

    await waitFor(() => expect(requestUrls().length).toBeGreaterThan(0));
    expect(requestUrls().every((params) => params.get("category") === null)).toBe(true);
  });

  it("preserves the query when the mode is switched", async () => {
    nav.q = "rome";
    render(<SearchPage />);
    await waitFor(() =>
      expect(requestUrls().some((params) => params.get("q") === "rome")).toBe(true),
    );

    fireEvent.click(screen.getByTestId("search-mode-podcast"));

    // The write carries the query *and* the new mode, and it is a replace so the
    // back button does not have to walk through a mode switch.
    expect(nav.replace).toHaveBeenCalledWith("/search?q=rome&mode=podcast");
  });

  it("never writes the search store, so the top-bar input keeps its value", async () => {
    nav.q = "rome";
    render(<SearchPage />);
    await waitFor(() => expect(useSearchStore.getState().query).toBe("rome"));

    fireEvent.click(screen.getByTestId("search-mode-podcast"));

    // The top-bar input's value mirrors the search store, and a mode switch is a
    // URL write only — it never edits the query, so the input cannot lose what the
    // listener typed and the M5 URL-synchronization contract cannot echo.
    expect(useSearchStore.getState().query).toBe("rome");
    // Exactly one write, and it is the mode write: no query echo beside it.
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/search?q=rome&mode=podcast");
  });

  it("re-runs the search in the new mode once the URL carries it", async () => {
    nav.q = "rome";
    const { rerender } = render(<SearchPage />);
    await waitFor(() =>
      expect(requestUrls().some((params) => params.get("q") === "rome")).toBe(true),
    );

    fireEvent.click(screen.getByTestId("search-mode-podcast"));
    // Stand in for the navigation that replace causes: the URL now carries the mode.
    nav.mode = "podcast";
    rerender(<SearchPage />);

    await waitFor(() =>
      expect(requestUrls().some((params) => params.get("category") === "podcast")).toBe(true),
    );
    expect(await screen.findByText("Episodes")).toBeInTheDocument();
  });
  it("explains an empty podcast search in podcast terms, and an empty music search in music terms", async () => {
    // The two empty states are the *same* surface reading different mode-specific
    // copy. A single stubbed empty response for both requests is the only way to
    // reach them, because the server reports "nothing usable" as a 503 — which is
    // the error state, a third thing (asserted separately below).
    stubSearch(true);
    nav.q = "nothing at all";
    const { rerender } = render(<SearchPage />);

    expect(await screen.findByText(/^No results for "nothing at all"$/)).toBeInTheDocument();
    // Music mode does not claim a long-form floor it is not applying.
    expect(screen.queryByText(/at least 10 minutes/i)).not.toBeInTheDocument();

    // The mode switch is a URL write, so the mocked router has to apply it: the
    // click asks for the change, and the navigation carrying it is what the
    // component reads back. `nav` is the mock's URL state and `rerender` re-reads it.
    fireEvent.click(screen.getByTestId("search-mode-podcast"));
    nav.mode = "podcast";
    rerender(<SearchPage />);

    const podcastEmpty = await screen.findByText(/^No podcasts found for "nothing at all"$/);
    expect(podcastEmpty).toBeInTheDocument();
    // The mode is named and the floor that caused it is stated, so an empty result
    // does not read as "no podcasts exist".
    expect(screen.getByText(/at least 10 minutes/i)).toBeInTheDocument();
    // And the music wording is gone: the two states are distinct, not stacked.
    expect(screen.queryByText(/^No results for /)).not.toBeInTheDocument();
    // An empty result set shows no episodes and no retry affordance — it is not a failure.
    expect(document.querySelector('[data-testid="search-results"]')).toBeNull();
  });

  it("renders an episode with its artwork from the canonical track", async () => {
    nav.q = "rome";
    nav.mode = "podcast";
    render(<SearchPage />);

    await screen.findByText("Episodes");
    const rows = within(screen.getByTestId("search-results")).getAllByRole("listitem");
    const image = rows[0]?.querySelector("img");
    // The artwork URL is the canonical track's own, so the row renders what the
    // server sent rather than a placeholder of its own.
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(episode.artwork[0]?.url);
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("never autoplays a podcast result (M12 long-form requirement)", async () => {
    nav.q = "rome";
    nav.mode = "podcast";
    render(<SearchPage />);

    await screen.findByText("Episodes");
    expect(document.querySelector('[data-testid="player-bar"]')).toBeNull();
  });
});
