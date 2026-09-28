import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchPage from "@/app/search/page";
import type { Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetPlayerStore } from "@/stores/playerStore";
import { resetSearchStore } from "@/stores/searchStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Task 7.2 (design §6, spec "Local library fallback"): a failed remote search
 * falls back to local-library matches with a notice and a retry, stays on the
 * retryable error state when the local library has nothing, and an offline
 * search never issues a request at all. The failure request is inspected to
 * prove it carried only `q`/`limit` — local content never leaves the device.
 */

// Rendering + IndexedDB round-trips can exceed the 1s default on a cold
// jsdom worker (same reason as search-menu.test.tsx).
configure({ asyncUtilTimeout: 5000 });

const nav = vi.hoisted(() => ({
  q: "",
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => new URLSearchParams(nav.q === "" ? {} : { q: nav.q }),
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

const localTrack = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Karma Police",
  artists: [{ name: "Radiohead" }],
});
const remoteTrack = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Weird Fishes",
  artists: [{ name: "Radiohead" }],
});

function okResponse(tracks: Track[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ tracks, diagnostics: {} }),
  } as unknown as Response;
}

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

let repositories: RepositorySet;
let online = true;

Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });

beforeEach(async () => {
  resetSearchStore();
  resetPlayerStore();
  nav.q = "";
  online = true;
  repositories = await getLocalData();
  await repositories.resetAll();
  await repositories.likedTracks.like(localTrack); // the one local match for "karma"
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("local fallback after a remote failure (task 7.2)", () => {
  it("shows local matches with a notice, retries, and never sent library data", async () => {
    const fetchMock = stubFetch(async () => {
      throw new Error("boom");
    });
    nav.q = "karma";
    render(<SearchPage />);

    // Fallback rendering: notice + playable local matches, not an error page.
    const notice = await screen.findByTestId("fallback-notice");
    expect(notice).toHaveTextContent("Search is unavailable — showing matches from your library.");
    expect(screen.getByTestId("search-results")).toHaveTextContent("Karma Police");

    // Only q and limit left the client — no liked/library identifiers.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/search?q=karma&limit=20");

    // Retry re-searches remotely and, on success, replaces the fallback.
    fetchMock.mockImplementation(async () => okResponse([remoteTrack]));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetchMock).toHaveBeenCalledTimes(2); // immediate, no debounce wait

    await waitFor(() => {
      expect(screen.queryByTestId("fallback-notice")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("search-results")).toHaveTextContent("Weird Fishes");
  });

  it("keeps the retryable error state when the local library has no matches", async () => {
    const fetchMock = stubFetch(async () => {
      throw new Error("boom");
    });
    nav.q = "zzzz-nothing"; // matches neither title nor artist locally
    render(<SearchPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Search failed");
    expect(screen.queryByTestId("fallback-notice")).not.toBeInTheDocument();
    expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/search?q=zzzz-nothing&limit=20");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});

describe("offline search stays local (task 7.2)", () => {
  it("issues no request and shows local matches behind the offline notice", async () => {
    online = false;
    const fetchMock = stubFetch(async () => okResponse([remoteTrack]));
    nav.q = "karma";
    render(<SearchPage />);

    const notice = await screen.findByTestId("fallback-notice");
    expect(notice).toHaveTextContent("Offline — showing matches from your library.");
    expect(screen.getByTestId("search-results")).toHaveTextContent("Karma Police");
    expect(fetchMock).not.toHaveBeenCalled(); // no remote request at all

    // Offline notices carry no retry — reconnecting re-runs the query.
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
