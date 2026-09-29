import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import * as browsePlayback from "@/features/home/browsePlayback";
import { HomeView, preferLongFormTracks, LONG_FORM_MIN_SECONDS } from "@/features/home/HomeView";
import { GENRE_CATALOG } from "@/features/home/genreCatalog";
import { countLocalArtists, deriveSeedTerms } from "@/features/home/localSeeds";
import { makeTrack } from "./helpers/music-fixtures";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";

/**
 * M8 tasks 6.1–6.4 (spec: `discovery` — "Home discovery feed", "Curated
 * query-driven discovery shelves", "Local-only personalization inputs",
 * "Recently played and local listening signals", "Popular artists shelf").
 *
 * The feed is exercised through its stores rather than IndexedDB: the stores are
 * the surface's only local input, and seeding them directly is what makes the
 * "fresh user" and "returning user" scenarios a one-line difference. The
 * discovery endpoint is stubbed per feed kind, so one shelf's failure can be
 * observed in isolation from its siblings.
 */

// Cold renders plus several awaited shelves can exceed the 1s default.
configure({ asyncUtilTimeout: 5000 });

// Genre tiles and artist entries navigate through next/link.
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
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));

/** Seed terms, tracks, or failure for one discovery feed kind. */
type Reply = { tracks: Track[] } | { fail: number; code: string } | { hang: true };

const DEFAULT_REPLY: Reply = { tracks: [] };

function track(overrides: Partial<Track> & { id: string }): Track {
  return makeTrack({ providerId: overrides.id.replace("youtube:", ""), ...overrides });
}

/** A credited track: `artist` is its single artist, `minutes` its duration. */
function credited(
  id: string,
  title: string,
  artist: string,
  overrides: Partial<Track> = {},
): Track {
  return track({ id, title, artists: [{ name: artist }], ...overrides });
}

/**
 * A track by an artist the local data *counts* but cannot *name*: a provider
 * artist id with a blank display name. `countLocalArtists` credits the id, while
 * `deriveSeedTerms` has no term to send — the exact disagreement the seeded
 * shelves' gate has to resolve.
 */
function unnamedArtist(id: string): Track {
  return track({ id, title: `Track ${id}`, artists: [{ id: `artist-${id}`, name: "   " }] });
}

interface Recorded {
  kind: string | null;
  params: URLSearchParams;
}

/** Stub the discovery endpoint per `kind`; `hang` never settles (abort cases). */
function stubDiscovery(reply: (kind: string | null) => Reply = () => DEFAULT_REPLY) {
  const calls: Recorded[] = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const kind = url.searchParams.get("kind");
    calls.push({ kind, params: url.searchParams });
    const outcome = reply(kind);
    if ("hang" in outcome) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
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

/** Kinds requested at least once, in first-request order. */
function requestedKinds(calls: Recorded[]): string[] {
  return [...new Set(calls.map((call) => call.kind ?? "?"))];
}

/** A listening event as the history store holds it. */
function event(id: string, title: string, artist: string, playedAt: number): ListeningEventRecord {
  const entry = credited(id, title, artist);
  return {
    id: `event-${id}-${playedAt}`,
    trackId: id,
    track: entry,
    playedAt,
    secondsPlayed: 0,
    context: "home",
  };
}

/** Replace the three local stores' reads with seeded, already-hydrated state. */
function seedStores({
  events = [] as ListeningEventRecord[],
  likedTracks = [] as Track[],
  languages = ["en"] as string[],
  onboardingComplete = true,
}: {
  events?: ListeningEventRecord[];
  likedTracks?: Track[];
  languages?: string[];
  onboardingComplete?: boolean;
} = {}): void {
  // The stores hydrate through repositories; the feed only reads their slices, so
  // the tests inject the slices and stub the read instead of opening IndexedDB.
  useHistoryStore.setState({
    events,
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  useLibraryStore.setState({
    likedTracks,
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  usePreferencesStore.setState({
    languages,
    onboardingComplete,
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
}

/** Wait until every requested shelf has settled, then return. */
async function settleFeed(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryAllByTestId("shelf-skeleton")).toHaveLength(0);
  });
}

beforeEach(() => {
  resetHistoryStore();
  resetLibraryStore();
  resetPlayerStore();
  resetPreferencesStore();
  resetQueueStore();
  seedStores();
  stubDiscovery();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HomeView: a fresh user", () => {
  it("renders the non-personalized shelves and no local-only section", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomeView />);

    for (const id of ["trending", "popular-artists", "genres", "podcasts", "collections"]) {
      await waitFor(() => expect(screen.getByTestId(`home-section-${id}`)).toBeInTheDocument());
    }

    // No likes, no playlists, no listening history → no local-only section.
    expect(screen.queryByTestId("home-section-recently-played")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-section-made-for-you")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-section-smart-mixes")).not.toBeInTheDocument();
  });

  it("requests only the catalog feeds — no caller-seeded request at all", async () => {
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    await settleFeed();

    expect(requestedKinds(calls).sort()).toEqual(["collection", "podcast", "trending"]);
    for (const call of calls) expect(call.params.get("seeds")).toBeNull();
  });

  it("shows skeletons while a shelf is in flight and content once it resolves", async () => {
    stubDiscovery((kind) =>
      kind === "trending"
        ? { hang: true }
        : { tracks: [credited("a", "Alpha", "Aurora", { id: `youtube:${kind}-a` })] },
    );
    render(<HomeView />);

    // The trending shelf is the one in flight: skeletons, not an empty region.
    await waitFor(() =>
      expect(
        within(screen.getByTestId("home-section-trending")).getAllByTestId("shelf-skeleton"),
      ).not.toHaveLength(0),
    );
    // Its siblings already resolved and are interactive.
    expect(
      await within(screen.getByTestId("home-section-collections")).findByText("Alpha"),
    ).toBeInTheDocument();
  });

  it("never starts playback on its own", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomeView />);
    await settleFeed();

    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().status).toBe("idle");
    expect(useQueueStore.getState().queue).toHaveLength(0);
    expect(useQueueStore.getState().source).not.toBe("browse");
  });

  it("makes no chart or editorial claim anywhere in the feed", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    const { container } = render(<HomeView />);
    await settleFeed();

    expect(container.textContent).not.toMatch(
      /chart|ranking|most listened|top of the|editor|spotify|youtube/i,
    );
  });
});

describe("HomeView: a returning user", () => {
  it("adds Recently Played and the locally informed shelves", async () => {
    seedStores({
      events: [event("youtube:r1", "Played", "Aurora", 300)],
      likedTracks: [credited("l1", "Liked", "Aurora"), credited("l2", "Liked 2", "Beacon")],
    });
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomeView />);

    expect(await screen.findByTestId("home-section-recently-played")).toBeInTheDocument();
    expect(screen.getByTestId("home-section-made-for-you")).toBeInTheDocument();
    // Two local artists is below the three-artist Smart Mixes gate.
    expect(screen.queryByTestId("home-section-smart-mixes")).not.toBeInTheDocument();
    // The non-personalized shelves still render.
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();
    expect(screen.getByTestId("home-section-collections")).toBeInTheDocument();
  });

  it("unlocks Smart Mixes at three distinct local artists", async () => {
    seedStores({
      likedTracks: [
        credited("l1", "Liked", "Aurora"),
        credited("l2", "Liked 2", "Beacon"),
        credited("l3", "Liked 3", "Cobalt"),
      ],
    });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    await waitFor(() => expect(screen.getByTestId("home-section-smart-mixes")).toBeInTheDocument());
    await settleFeed();
  });

  it("carries only short artist-name seeds — never local data", async () => {
    seedStores({
      likedTracks: [credited("l1", "Liked Song", "Aurora")],
      events: [event("youtube:r1", "Played", "Aurora", 300)],
    });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);
    await settleFeed();

    const forYou = calls.find((call) => call.kind === "for-you");
    expect(forYou).toBeDefined();
    expect(forYou?.params.get("seeds")).toBe("Aurora");
    expect(forYou?.params.get("languages")).toBe("en");

    // The whole request URL carries no id, title, or dataset field.
    const serialized = JSON.stringify([...calls.map((call) => [...call.params])]);
    expect(serialized).not.toContain("youtube:");
    expect(serialized).not.toContain("Liked Song");
    expect(serialized).not.toContain("Played");
  });

  it("ranks the seeds by local signal, strongest artist first", async () => {
    seedStores({
      likedTracks: [credited("l1", "One", "Weak"), credited("l2", "Two", "Strong")],
      events: [
        event("youtube:r1", "Three", "Strong", 300),
        event("youtube:r2", "Four", "Strong", 200),
      ],
    });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);
    await settleFeed();

    expect(calls.find((call) => call.kind === "for-you")?.params.get("seeds")).toBe("Strong,Weak");
  });

  it("drops the recently played section when history is cleared", async () => {
    seedStores({ events: [event("youtube:r1", "Played", "Aurora", 300)] });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);
    await screen.findByTestId("home-section-recently-played");

    act(() => {
      useHistoryStore.setState({ events: [] });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("home-section-recently-played")).not.toBeInTheDocument(),
    );
  });
});

describe("HomeView: recently played", () => {
  it("renders newest-first, deduped by track, and caps the shelf", async () => {
    const events = [
      event("youtube:c", "Third", "Cobalt", 300),
      event("youtube:a", "First", "Aurora", 200),
      event("youtube:b", "Second", "Beacon", 100),
      // A repeat play of an already-listed track must not add a second card.
      event("youtube:c", "Third", "Cobalt", 50),
    ];
    seedStores({ events });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-recently-played");
    const cards = within(shelf).getAllByTestId("shelf-track-card");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Play Third by Cobalt",
      "Play First by Aurora",
      "Play Second by Beacon",
    ]);
  });

  it("caps the section at ten cards", async () => {
    const events = Array.from({ length: 14 }, (_v, index) =>
      event(`youtube:t${index}`, `Track ${index}`, "Aurora", 1_000 - index),
    );
    seedStores({ events });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-recently-played");
    expect(within(shelf).getAllByTestId("shelf-track-card")).toHaveLength(10);
  });
});

describe("HomeView: activating a card", () => {
  it("plays the card with its shelf as context, recorded as the browse source", async () => {
    const tracks = [
      credited("a", "Alpha", "Aurora"),
      credited("b", "Beta", "Beacon"),
      credited("c", "Gamma", "Cobalt"),
    ];
    stubDiscovery((kind) => (kind === "trending" ? { tracks } : { tracks: [] }));
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-trending");
    fireEvent.click(await within(shelf).findByRole("button", { name: "Play Beta by Beacon" }));

    expect(usePlayerStore.getState().currentTrack?.id).toBe("b");
    expect(useQueueStore.getState().source).toBe("browse");
    // The whole shelf is the continuation context, so a shelf plays through.
    expect(useQueueStore.getState().queue.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(useQueueStore.getState().queueIndex).toBe(1);
    // Plain shelf play never turns shuffle on.
    expect(useQueueStore.getState().shuffle).toBe(false);
  });

  it("names the card for assistive tech and keeps it keyboard operable", async () => {
    stubDiscovery(() => ({
      tracks: [credited("a", "Alpha", "Aurora"), credited("b", "Beta", "Aurora, Beacon")],
    }));
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-trending");
    const cards = within(shelf).getAllByRole("button");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Play Alpha by Aurora",
      "Play Beta by Aurora, Beacon",
    ]);

    const first = cards[0] as HTMLButtonElement;
    expect(first.tagName).toBe("BUTTON");
    // The design system keeps a global `:focus-visible` outline.
    expect(first.className).not.toMatch(/outline-none/);
    first.focus();
    expect(first).toHaveFocus();
  });

  it("plays a recently played card with the browse source too", async () => {
    seedStores({ events: [event("youtube:r1", "Played", "Aurora", 300)] });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-recently-played");
    fireEvent.click(within(shelf).getByRole("button", { name: "Play Played by Aurora" }));

    expect(useQueueStore.getState().source).toBe("browse");
    expect(usePlayerStore.getState().currentTrack?.id).toBe("youtube:r1");
  });

  it("renders the DESIGN.md square-card geometry", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    const { container } = render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-trending");
    const card = within(shelf).getByTestId("shelf-track-card");
    expect(card.className).toContain("rounded-cards"); // 6px card radius
    expect(card.className).toContain("p-3"); // 12px card padding
    expect(card.className).toContain("bg-carbon"); // #121212 canvas
    expect(card.className).toContain("hover:bg-graphite"); // #1f1f1f hover
    // A 1:1 cover at the 6px image radius, with a lazy, sized image.
    const cover = card.firstElementChild as HTMLElement;
    expect(cover.tagName).toBe("SPAN");
    expect(cover.className).toContain("aspect-square");
    expect(cover.className).toContain("rounded-cards");
    const image = container.querySelector('[data-testid="home-section-trending"] img');
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("width", "300");
    expect(image).toHaveAttribute("height", "300");
  });

  it("falls back to the monochrome placeholder when a track has no artwork", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora", { artwork: [] })] }));
    const { container } = render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-trending");
    await within(shelf).findByRole("button", { name: "Play Alpha by Aurora" });
    expect(container.querySelector('[data-testid="home-section-trending"] img')).toBeNull();
  });
});

describe("HomeView: one failing shelf", () => {
  it("shows a retryable error on that shelf alone and renders the rest", async () => {
    stubDiscovery((kind) =>
      kind === "trending"
        ? { fail: 503, code: "upstream_unavailable" }
        : { tracks: [credited("a", "Alpha", "Aurora", { id: `youtube:${kind}-a` })] },
    );
    render(<HomeView />);

    const trending = await screen.findByTestId("home-section-trending");
    await within(trending).findByRole("alert");
    expect(
      within(trending).getByRole("heading", { name: "This shelf didn't load" }),
    ).toBeInTheDocument();

    // Every other shelf still resolved, including the one derived from trending.
    const collections = screen.getByTestId("home-section-collections");
    expect(await within(collections).findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByTestId("home-section-podcasts")).toBeInTheDocument();
  });

  it("retries only the failed shelf", async () => {
    let trendingFails = true;
    stubDiscovery((kind) => {
      if (kind === "trending") {
        return trendingFails
          ? { fail: 503, code: "upstream_unavailable" }
          : { tracks: [credited("a", "Alpha", "Aurora")] };
      }
      return { tracks: [] };
    });
    render(<HomeView />);

    const trending = await screen.findByTestId("home-section-trending");
    await within(trending).findByRole("alert");
    trendingFails = false;

    fireEvent.click(within(trending).getByRole("button", { name: "Retry" }));

    expect(await within(trending).findByText("Alpha")).toBeInTheDocument();
    expect(within(trending).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains an empty shelf instead of rendering a blank region", async () => {
    stubDiscovery((kind) => (kind === "collection" ? { tracks: [] } : { tracks: [] }));
    render(<HomeView />);
    await settleFeed();

    const collections = screen.getByTestId("home-section-collections");
    expect(
      within(collections).getByRole("heading", { name: "Nothing here yet" }),
    ).toBeInTheDocument();
    expect(within(collections).queryByTestId("shelf-rail")).not.toBeInTheDocument();
  });

  it("propagates the trending failure onto the derived artist shelf", async () => {
    stubDiscovery((kind) =>
      kind === "trending" ? { fail: 503, code: "upstream_unavailable" } : { tracks: [] },
    );
    render(<HomeView />);

    await within(await screen.findByTestId("home-section-trending")).findByRole("alert");
    const artists = screen.getByTestId("home-section-popular-artists");
    await waitFor(() => expect(within(artists).getByRole("alert")).toBeInTheDocument());
    expect(within(artists).queryByTestId("shelf-rail")).not.toBeInTheDocument();
  });
});

describe("HomeView: the seeded shelves gate on the terms they will send", () => {
  it("counts a blank-named artist locally but derives no term from it", () => {
    // The two derivations genuinely disagree, which is why the gate may not use
    // the count: the count says "there is an artist", the seeds say "there is
    // nothing to send".
    const taste = { likedTracks: [unnamedArtist("l1"), unnamedArtist("l2")], events: [] };
    expect(countLocalArtists(taste)).toBe(2);
    expect(deriveSeedTerms(taste)).toEqual([]);
  });

  it("renders no seeded shelf and issues no seeded request when the terms are empty", async () => {
    // Three locally known artists clears the Smart Mixes *count* gate, yet
    // `for-you` and `mix` are caller-seeded kinds the endpoint answers with 400
    // when the seed list is empty. The gate is the derived term list, so neither
    // shelf renders and neither request goes out.
    seedStores({ likedTracks: [unnamedArtist("l1"), unnamedArtist("l2"), unnamedArtist("l3")] });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);
    await settleFeed();

    expect(screen.queryByTestId("home-section-made-for-you")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-section-smart-mixes")).not.toBeInTheDocument();
    expect(requestedKinds(calls)).not.toContain("for-you");
    expect(requestedKinds(calls)).not.toContain("mix");
    // No request went out carrying an empty `seeds` parameter.
    for (const call of calls) expect(call.params.get("seeds")).toBeNull();
  });

  it("still opens the seeded shelves as soon as one term is derivable", async () => {
    seedStores({
      likedTracks: [unnamedArtist("l1"), credited("l2", "Liked 2", "Aurora")],
    });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    expect(await screen.findByTestId("home-section-made-for-you")).toBeInTheDocument();
    await settleFeed();
    expect(requestedKinds(calls)).toContain("for-you");
    expect(calls.find((call) => call.kind === "for-you")?.params.get("seeds")).toBe("Aurora");
  });
});

describe("browsePlayback: shelf activation surface", () => {
  it("offers exactly one entry point and no shelf shuffle", () => {
    // No Home/Discover surface offers a shelf shuffle and no spec requires one,
    // so the export is gone rather than kept "in case" — an unused playback
    // helper silently widens what a card activation can do.
    expect("shuffleFromShelf" in browsePlayback).toBe(false);
    expect(Object.keys(browsePlayback).sort()).toEqual(["BROWSE_QUEUE_SOURCE", "playFromShelf"]);
    expect(typeof browsePlayback.playFromShelf).toBe("function");
    expect(browsePlayback.BROWSE_QUEUE_SOURCE).toBe("browse");
  });
});

describe("HomeView: popular artists", () => {
  it("groups the trending result into one circular card per artist", async () => {
    stubDiscovery((kind) =>
      kind === "trending"
        ? {
            tracks: [
              credited("a", "Alpha", "Aurora", { id: "a" }),
              credited("b", "Alpha 2", "Aurora", { id: "b" }),
              credited("c", "Beta", "Beacon", { id: "c" }),
            ],
          }
        : { tracks: [] },
    );
    const { container } = render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-popular-artists");
    const cards = await within(shelf).findAllByTestId("home-artist-card");

    // One entry per artist, not one per track.
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Aurora"),
      expect.stringContaining("Beacon"),
    ]);
    // Circular geometry, and the design system's 'Artist' label.
    const circle = container.querySelector(
      '[data-testid="home-section-popular-artists"] .rounded-avatars',
    );
    expect(circle).not.toBeNull();
    expect(within(shelf).getAllByText("Artist")).toHaveLength(2);
  });

  it("refines search when an artist entry is activated", async () => {
    stubDiscovery((kind) =>
      kind === "trending" ? { tracks: [credited("a", "Alpha", "Aurora Sky")] } : { tracks: [] },
    );
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-popular-artists");
    const entry = await within(shelf).findByTestId("home-artist-card");
    expect(entry.tagName).toBe("A");
    expect(entry.getAttribute("href")).toBe("/search?q=Aurora%20Sky");

    // M9 owns artist pages, so the entry navigates and is not a play control.
    expect(within(shelf).queryAllByTestId("shelf-track-card")).toHaveLength(0);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("shows the artist's best artwork when the entry has one", async () => {
    stubDiscovery((kind) =>
      kind === "trending"
        ? {
            tracks: [
              credited("a", "Alpha", "Aurora", {
                id: "a",
                artwork: [{ url: "https://example.test/small.jpg", width: 120 }],
              }),
              credited("b", "Alpha 2", "Aurora", {
                id: "b",
                artwork: [{ url: "https://example.test/large.jpg", width: 640 }],
              }),
            ],
          }
        : { tracks: [] },
    );
    const { container } = render(<HomeView />);

    await within(screen.getByTestId("home-section-popular-artists")).findByText("Aurora");
    const image = container.querySelector('[data-testid="home-section-popular-artists"] img');
    expect(image).toHaveAttribute("src", "https://example.test/large.jpg");
  });

  it("explains the empty state when no artist entries can be derived", async () => {
    stubDiscovery((kind) =>
      kind === "trending" ? { tracks: [track({ id: "a", artists: [] })] } : { tracks: [] },
    );
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-popular-artists");
    expect(
      await within(shelf).findByRole("heading", { name: "No artists found yet" }),
    ).toBeInTheDocument();
  });

  it("issues no request of its own — it derives from the trending result", async () => {
    const { calls } = stubDiscovery((kind) =>
      kind === "trending" ? { tracks: [credited("a", "Alpha", "Aurora")] } : { tracks: [] },
    );
    render(<HomeView />);
    await settleFeed();

    expect(requestedKinds(calls).sort()).toEqual(["collection", "podcast", "trending"]);
  });
});

describe("HomeView: podcasts prefer long-form", () => {
  it("keeps long-form results when enough of them survive", () => {
    const tracks = [
      credited("s", "Short", "Aurora", { id: "s", durationSeconds: 200 }),
      credited("l1", "Long 1", "Aurora", { id: "l1", durationSeconds: 1_800 }),
      credited("l2", "Long 2", "Beacon", { id: "l2", durationSeconds: 2_400 }),
      credited("l3", "Long 3", "Cobalt", { id: "l3", durationSeconds: 3_000 }),
      credited("l4", "Long 4", "Delta", { id: "l4", durationSeconds: 3_600 }),
    ];

    expect(LONG_FORM_MIN_SECONDS).toBe(600);
    expect(preferLongFormTracks(tracks).map((entry) => entry.id)).toEqual(["l1", "l2", "l3", "l4"]);
  });

  it("falls back to the full set when too few long-form results survive", () => {
    const tracks = [
      credited("s", "Short", "Aurora", { id: "s", durationSeconds: 200 }),
      credited("u", "Unknown", "Beacon", { id: "u" }),
      credited("l1", "Long 1", "Cobalt", { id: "l1", durationSeconds: 1_800 }),
    ];

    expect(preferLongFormTracks(tracks).map((entry) => entry.id)).toEqual(["s", "u", "l1"]);
  });

  it("returns an empty set unchanged", () => {
    expect(preferLongFormTracks([])).toEqual([]);
  });

  it("renders only the long-form results in the podcast shelf", async () => {
    stubDiscovery((kind) =>
      kind === "podcast"
        ? {
            tracks: [
              credited("s", "Short Ep", "Aurora", { id: "s", durationSeconds: 240 }),
              credited("l1", "Long Ep 1", "Aurora", { id: "l1", durationSeconds: 1_800 }),
              credited("l2", "Long Ep 2", "Beacon", { id: "l2", durationSeconds: 1_800 }),
              credited("l3", "Long Ep 3", "Cobalt", { id: "l3", durationSeconds: 1_800 }),
              credited("l4", "Long Ep 4", "Delta", { id: "l4", durationSeconds: 1_800 }),
            ],
          }
        : { tracks: [] },
    );
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-podcasts");
    const labels = await within(shelf)
      .findAllByTestId("shelf-track-card")
      .then((cards) => cards.map((card) => card.getAttribute("aria-label")));

    expect(labels).toHaveLength(4);
    expect(labels.some((label) => label?.includes("Short Ep"))).toBe(false);
    // Presented as podcasts, with no claim about how they were chosen.
    expect(within(shelf).getByRole("heading", { name: "Podcasts" })).toBeInTheDocument();
    expect(shelf.textContent).not.toMatch(/chart|rank|best|official/i);
  });
});

describe("HomeView: genre tiles", () => {
  it("links every catalog genre into the Discover surface", async () => {
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-section-genres");
    for (const genre of GENRE_CATALOG) {
      const tile = within(shelf).getByTestId(`home-genre-${genre.id}`);
      expect(tile.getAttribute("href")).toBe(`/discover?genre=${genre.id}`);
      expect(tile.textContent).toContain(genre.name);
    }
  });

  it("issues no request for the genre section", async () => {
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);
    await settleFeed();

    expect(requestedKinds(calls).some((kind) => kind === "genre")).toBe(false);
  });
});

describe("HomeView: first-run language onboarding", () => {
  it("offers the language picker until it is confirmed or dismissed", async () => {
    seedStores({ onboardingComplete: false });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    const dialog = await screen.findByRole("dialog", { name: "Choose your languages" });
    expect(dialog).toBeInTheDocument();

    // Dismissal for this visit; the repository is untouched, so it is offered again.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Choose your languages" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("never offers onboarding once it is complete", async () => {
    seedStores({ onboardingComplete: true });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);
    await settleFeed();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("HomePage route", () => {
  it("keeps the page's single hidden Home heading above the feed", async () => {
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(await screen.findByTestId("home-view")).toBeInTheDocument();
  });
});
