import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  artwork: [],
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
function stubSearch() {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const podcast = url.searchParams.get("category") === "podcast";
    return {
      ok: true,
      status: 200,
      json: async () => ({ tracks: podcast ? [episode] : [song] }),
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
  it("never autoplays a podcast result (M12 long-form requirement)", async () => {
    nav.q = "rome";
    nav.mode = "podcast";
    render(<SearchPage />);

    await screen.findByText("Episodes");
    expect(document.querySelector('[data-testid="player-bar"]')).toBeNull();
  });
});
