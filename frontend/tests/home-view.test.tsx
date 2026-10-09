import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
// The mix cards compose through `generateMix`, which reads and writes the mix
// repository — so a Home-level activation case needs a real (in-memory) IndexedDB
// rather than a store slice. Nothing else in this file touches it: the feed is
// exercised through the store slices, and the only repository read this adds is
// the mix card's own.
import "fake-indexeddb/auto";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { getLocalData } from "@/data/localData";
import type { ListeningEventRecord, MixRecord, Track } from "@/data/repositories";
import * as browsePlayback from "@/features/home/browsePlayback";
import { HomeView, preferLongFormTracks, LONG_FORM_MIN_SECONDS } from "@/features/home/HomeView";
import { GENRE_CATALOG } from "@/features/home/genreCatalog";
import { HOME_SECTIONS } from "@/features/home/homeSections";
import { countLocalArtists, deriveSeedTerms } from "@/features/home/localSeeds";
import { TIME_BAND_TERMS } from "@/features/home/timeBands";
import { TIME_SHELF_ACTION_ID, TIME_SHELF_STATUS_ID } from "@/features/home/TimeShelf";
import { makeTrack } from "./helpers/music-fixtures";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { resetMixStore, useMixStore } from "@/stores/mixStore";
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
  mixes = [] as MixRecord[],
  languages = ["en"] as string[],
  onboardingComplete = true,
}: {
  events?: ListeningEventRecord[];
  likedTracks?: Track[];
  mixes?: MixRecord[];
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
  // M11: the Smart Mixes section is gated on generated mixes, so a case that
  // wants the section injects the dataset the section actually lists.
  useMixStore.setState({
    mixes,
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
  resetMixStore();
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

    for (const id of ["trending", "genres", "podcasts", "collections"]) {
      await waitFor(() => expect(screen.getByTestId(`home-section-${id}`)).toBeInTheDocument());
    }

    // M23: `popular-artists` no longer renders as a section of its own. It was
    // measured on production to be a strict prefix of the Quick Picks rail, and the
    // spec permits one circular artist section — so its content moved there rather
    // than being deleted.
    expect(screen.queryByTestId("home-section-popular-artists")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-quick-picks")).toBeInTheDocument();

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

  it("completes Quick Picks from the feed it already fetched, with no extra request", async () => {
    // M22 task 3.4, retained and re-pointed by M23. `deriveQuickPicks` can be fully
    // correct as a pure function while `HomeView` silently forgets to pass the
    // provider source down, so the wiring is asserted here rather than assumed from
    // the derivation's tests.
    //
    // Fresh user: no likes, no plays. Trending resolves with one credited track
    // carrying an album; every other feed comes back empty.
    const { calls } = stubDiscovery((kind) =>
      kind === "trending"
        ? { tracks: [credited("t1", "Trending Song", "Nova", { album: { title: "Signal Fire" } })] }
        : { tracks: [] },
    );
    render(<HomeView />);
    await settleFeed();

    const cards = screen.getAllByTestId("quick-pick");
    // M23: artist entries only. The album card this test used to expect alongside
    // the artist is gone — the rail is one kind, so a provider album on a track is
    // not a card. Asserted explicitly rather than left implicit in the length.
    expect(cards.map((card) => card.getAttribute("data-quick-pick-kind"))).toEqual(["artist"]);
    expect(cards[0]?.getAttribute("href")).toBe("/artist/Nova");
    expect(screen.queryByText("Signal Fire")).not.toBeInTheDocument();

    // The whole point of reading the feed rather than fetching: no kind the
    // Quick Picks stand-in could have asked for appears in the request log.
    expect(requestedKinds(calls).sort()).toEqual(["collection", "podcast", "trending"]);
    for (const call of calls) expect(call.params.get("kind")).not.toBe("quick-picks");
  });

  it("shows no card and a retryable error when no feed resolved", async () => {
    // The degradation path, and it is a different path from M22's.
    //
    // M22 kept one language search entry standing in for an empty rail so the shelf
    // could never look unfinished. M23 removed that entry, so nothing renders — and
    // because the provider failed, the rail reports the failure and offers a retry
    // rather than claiming there is simply nothing here.
    //
    // The regression guarded here is specifically M22's behaviour returning: any card
    // whose kind is not `artist`, in particular the language search entry.
    stubDiscovery(() => ({ fail: 500, code: "upstream" }));
    render(<HomeView />);
    await settleFeed();

    expect(screen.queryAllByTestId("quick-pick")).toEqual([]);
    expect(screen.queryByTestId("home-section-popular-artists")).not.toBeInTheDocument();

    const rail = screen.getByTestId("home-quick-picks");
    expect(within(rail).getByRole("alert")).toBeInTheDocument();
    // `ErrorState`'s own retry hook, so this asserts the recovery affordance the
    // `discovery` spec requires rather than only that some button exists.
    // `Shelf` overrides the label to "Retry" for every shelf error.
    expect(within(rail).getByTestId("error-retry")).toHaveTextContent("Retry");
    expect(within(rail).queryByTestId("shelf-rail")).not.toBeInTheDocument();
  });

  it("shows its empty state when the feed resolves with no artist at all", async () => {
    // Distinct from the failure above, and the pair matters: a resolved-but-empty feed
    // is not an error, so it must not offer a retry for a request that already
    // succeeded.
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);
    await settleFeed();

    const rail = screen.getByTestId("home-quick-picks");
    expect(within(rail).getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument();
    expect(within(rail).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(rail).queryAllByTestId("quick-pick")).toEqual([]);
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

  it("lists Smart Mixes by name once a mix exists, and issues no feed request for it", async () => {
    // M11: the section lists generated mixes rather than previewing the `mix`
    // discovery feed, so it renders from local data alone — the discovery stub is
    // called only for the other shelves.
    seedStores({
      likedTracks: [credited("l1", "Liked", "Aurora")],
      mixes: [
        {
          id: "mix:2026-09-30:aurora",
          name: "Aurora",
          generatedAt: 1_700_000_000_000,
          period: "2026-09-30",
          seeds: ["Aurora"],
          tracks: [makeTrack({ id: "youtube:m1", providerId: "m1", title: "Mix Song" })],
          updatedAt: 1_700_000_000_000,
        },
      ],
    });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    const section = await screen.findByTestId("home-section-smart-mixes");
    expect(within(section).getByText("Aurora")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Play Aurora" })).toBeInTheDocument();
    // A mix is opened explicitly: the Home feed must not start playback.
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    // The `mix` feed kind is no longer requested by Home at all.
    expect(calls.some((call) => call.kind === "mix")).toBe(false);
    await settleFeed();
  });

  it("omits Smart Mixes when local signal exists but no mix was generated", async () => {
    // The M8 preview gate rendered the shelf on three artists; M11 removes it, so
    // a listener with signal and no mix sees no empty section.
    seedStores({
      likedTracks: [
        credited("l1", "Liked", "Aurora"),
        credited("l2", "Liked 2", "Beacon"),
        credited("l3", "Liked 3", "Cobalt"),
      ],
    });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    await settleFeed();
    expect(screen.queryByTestId("home-section-smart-mixes")).not.toBeInTheDocument();
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
    // M23: the derived artist shelf is the Quick Picks rail, not a section of its own.
    // A trending failure still reaches it, so the listener sees the reason rather than
    // a silently empty rail — the resilience the removed section used to provide.
    const artists = screen.getByTestId("home-quick-picks");
    await waitFor(() => expect(within(artists).getByRole("alert")).toBeInTheDocument());
    expect(within(artists).queryByTestId("shelf-rail")).not.toBeInTheDocument();
  });

  it("keeps the artist rail populated when the provider fails but local taste exists", async () => {
    // The other half of the same rule, and the one that makes the propagation above
    // honest rather than a regression: a provider failure must not hide artists the
    // device already knows. Local taste fills the rail, so the rail renders content
    // and shows no error — while its *sibling* section still reports its own failure.
    seedStores({
      events: [event("youtube:r1", "Played", "Aurora", 300)],
      likedTracks: [credited("l1", "Liked", "Aurora"), credited("l2", "Liked 2", "Beacon")],
    });
    stubDiscovery((kind) =>
      kind === "trending" ? { fail: 503, code: "upstream_unavailable" } : { tracks: [] },
    );
    render(<HomeView />);

    const artists = await screen.findByTestId("home-quick-picks");
    await waitFor(() =>
      expect(within(artists).getAllByTestId("quick-pick").length).toBeGreaterThan(0),
    );
    expect(within(artists).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(artists).getAllByTestId("home-artist-card")).not.toHaveLength(0);
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

/**
 * M9 task 6.1's circular artist section, now the Quick Picks rail (M23).
 *
 * Retargeted rather than deleted: the section id changed, but every claim here — one
 * card per artist, circular geometry, the `Artist` label, navigation by id and by
 * text key, best artwork, an explained empty state, and no request of its own — is
 * still live and still belongs to the feed's single circular rail.
 */
describe("HomeView: the circular artist rail (M9 section, M23 Quick Picks)", () => {
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

    const shelf = await screen.findByTestId("home-quick-picks");
    const cards = await within(shelf).findAllByTestId("home-artist-card");

    // One entry per artist, not one per track.
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Aurora"),
      expect.stringContaining("Beacon"),
    ]);
    // Circular geometry, and the design system's 'Artist' label.
    const circle = container.querySelector('[data-testid="home-quick-picks"] .rounded-avatars');
    expect(circle).not.toBeNull();
    expect(within(shelf).getAllByText("Artist")).toHaveLength(2);
  });

  it("navigates to the artist route when an artist entry is activated", async () => {
    stubDiscovery((kind) =>
      kind === "trending" ? { tracks: [credited("a", "Alpha", "Aurora Sky")] } : { tracks: [] },
    );
    render(<HomeView />);
    const shelf = await screen.findByTestId("home-quick-picks");
    // M23: the anchor carries `quick-pick` and wraps the circular card, which keeps
    // the `home-artist-card` id for the card element itself.
    const entry = await within(shelf).findByTestId("quick-pick");
    expect(entry.tagName).toBe("A");
    // M9 owns the artist route: the card links the entity, by text key when the
    // shelf had no provider id for it.
    expect(entry.getAttribute("href")).toBe("/artist/Aurora%20Sky");

    // It is a navigation card, not a play control.
    expect(within(shelf).queryAllByTestId("shelf-track-card")).toHaveLength(0);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("links an identified artist by its provider id", async () => {
    stubDiscovery((kind) =>
      kind === "trending"
        ? {
            tracks: [
              credited("a", "Alpha", "Aurora", {
                artists: [{ id: "UCaurorachannel00000000", name: "Aurora" }],
              }),
            ],
          }
        : { tracks: [] },
    );
    render(<HomeView />);

    const shelf = await screen.findByTestId("home-quick-picks");
    const entry = await within(shelf).findByTestId("quick-pick");
    expect(entry.getAttribute("href")).toBe("/artist/UCaurorachannel00000000");
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

    const shelf = screen.getByTestId("home-quick-picks");
    await within(shelf).findByText("Aurora");
    const image = container.querySelector('[data-testid="home-quick-picks"] img');
    expect(image).toHaveAttribute("src", "https://example.test/large.jpg");
  });

  it("explains the empty state when no artist entries can be derived", async () => {
    stubDiscovery((kind) =>
      kind === "trending" ? { tracks: [track({ id: "a", artists: [] })] } : { tracks: [] },
    );
    render(<HomeView />);

    // M23: this used to be the section's own "No artists found yet" copy. The rail now
    // has one empty state, `Shelf`'s, so the assertion names that — asserting the old
    // string would pin copy that no longer exists rather than the behaviour.
    const shelf = await screen.findByTestId("home-quick-picks");
    expect(
      await within(shelf).findByRole("heading", { name: "Nothing here yet" }),
    ).toBeInTheDocument();
    expect(within(shelf).queryByTestId("shelf-rail")).not.toBeInTheDocument();
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

/**
 * M17 tasks 5.1, 5.2, 6.1, 6.2, and 6.3 (spec: `discovery` — "Home discovery
 * feed", scenarios "The time-aware shelf is seeded by the current band", "Mix
 * cards start playback rather than navigating away", "One failing shelf does not
 * break the feed", "Home stays compact-viewport usable", "Cards are not composed
 * on render"; `home-mixes` — "A time-aware shelf is offered", "The shelf names
 * its band"; design decisions 3, 4, and 6).
 *
 * The load-bearing claim is that M17 **did not make Home heavier**: three new
 * surfaces appear, and the number of provider requests Home makes does not change.
 * Every request-count case below states its baseline explicitly rather than
 * comparing against a captured value, so a future milestone that quietly adds a
 * shelf fails here instead of being compared with its own output.
 */

/** A fixed local hour as an instant, so no case reads the wall clock. */
function instantAtLocalHour(hour: number, minute = 0): number {
  return new Date(2026, 9, 2, hour, minute, 0, 0).getTime();
}

/** A generated instant for an injected mix record. */
const NOW_MIX = 1_700_000_000_000;

/** A track whose own public text carries a mood the shared lexicon recognises. */
function mood(title: string, artist: string, id: string): Track {
  return credited(`youtube:${id}`, title, artist);
}

/** Titles chosen so two different bands can each select a different track. */
function moodTaste() {
  return [
    mood("Modern Soul", "Aurora", "soul"),
    mood("Deep Funk", "Beacon", "funk"),
    mood("Ambient Drift", "Cobalt", "ambient"),
  ];
}

describe("HomeView: M17 adds surfaces without adding requests", () => {
  it("issues the pre-M17 request set for a fresh user", async () => {
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    // Baseline: trending, podcast, collection. The three M17 surfaces issue none.
    expect(requestedKinds(calls).sort()).toEqual(["collection", "podcast", "trending"]);
  });

  it("issues the pre-M17 request set for a returning user, and one per shelf", async () => {
    seedStores({
      likedTracks: moodTaste(),
      events: [event("youtube:r1", "Played", "Aurora", 300)],
    });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    // Baseline: the same four feeds, one request each. A mix card per identity
    // would show up here as extra requests, which is exactly what must not happen.
    expect(requestedKinds(calls).sort()).toEqual(["collection", "for-you", "podcast", "trending"]);
    expect(calls).toHaveLength(4);
  });

  it("renders the three M17 surfaces without composing or fetching anything", async () => {
    seedStores({
      likedTracks: moodTaste(),
      events: [event("youtube:r1", "Played", "Aurora", 300)],
    });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    expect(await screen.findByTestId("home-mix-cards")).toBeInTheDocument();
    expect(screen.getByTestId("home-time-shelf")).toBeInTheDocument();
    expect(screen.getByTestId("home-quick-picks")).toBeInTheDocument();
    // The row exists, the cards exist, and nothing was composed for any of them.
    expect(screen.getAllByTestId("mix-card").length).toBeGreaterThan(0);
    expect(useMixStore.getState().mixes).toEqual([]);
    expect(await (await getLocalData()).mixes.list()).toEqual([]);
    expect(calls.every((call) => call.kind !== "mix")).toBe(true);
  });

  it("renders the artist rail above the mix cards it used to sit below", async () => {
    /*
     * **This is the case `tests/routes.test.tsx` cannot reach.**
     *
     * That file's Home fixture is a deliberate fresh device — no likes, no history — and the
     * mix-card row is gated on `profile.hasSignal`. So its ordering assertion saw `home-time-shelf`
     * above the rail and never saw `home-mix-cards`, because that row was not in the document at
     * all. The row the listener actually complained about sat outside the test that claims to
     * guard the order.
     *
     * `moodTaste()` plus an event is the same signal the test above uses, which renders all three
     * M17 surfaces. So the mix-card row is genuinely present here, and the assertion has something
     * real to fail on.
     *
     * Asserted in document order via `compareDocumentPosition` rather than by index: `indexOf`
     * over a `querySelectorAll` list is a proxy for order that depends on the query, while this
     * asks the DOM directly which node comes first.
     */
    seedStores({
      likedTracks: moodTaste(),
      events: [event("youtube:r1", "Played", "Aurora", 300)],
    });
    stubDiscovery(() => ({ tracks: [] }));
    const { container } = render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    // Precondition, and the reason this test exists: the mix cards really do render.
    const mixCards = await screen.findByTestId("home-mix-cards");
    expect(screen.getAllByTestId("mix-card").length).toBeGreaterThan(0);

    const rail = screen.getByTestId("home-quick-picks");
    const first = mixCards.compareDocumentPosition(rail);

    // `Node.DOCUMENT_POSITION_FOLLOWING` — the rail is after the cards.
    expect(
      first & Node.DOCUMENT_POSITION_FOLLOWING,
      "the artist rail must precede the mix cards",
    ).toBe(0);

    // And it is first of every rendered row, not merely ahead of this one.
    const rows = [
      ...container.querySelectorAll(
        "[data-testid^='home-section-'], [data-testid^='home-mix-cards'], [data-testid^='home-time-shelf'], [data-testid^='home-quick-picks']",
      ),
    ];
    expect(rows[0]?.getAttribute("data-testid")).toBe("home-quick-picks");
    // Three M17 surfaces are present, so "first" is a real claim about a non-empty set.
    expect(
      rows.filter((row) => row.getAttribute("data-testid") === "home-quick-picks"),
    ).toHaveLength(1);
  });

  it("keeps the section list itself the same size", () => {
    // The M17 surfaces are *not* `HOME_SECTIONS` entries, so the one section model
    // did not grow — which is what keeps `assertShelfRhythm` guarding the real feed
    // rather than a list with three look-alikes in it.
    //
    // M23: the count is 7, not 8, because `popular-artists` was removed rather than
    // consolidated into the list. This test's *point* is that the M17 surfaces never
    // joined the list, so it is pinned against the current list rather than a number
    // that would let a section be added unnoticed.
    expect(HOME_SECTIONS).toHaveLength(7);
    for (const id of ["home-mix-cards", "home-quick-picks", "home-time-shelf"]) {
      expect(HOME_SECTIONS.map((section) => section.id)).not.toContain(id);
    }
    // And the count matches the list that is actually declared — so this cannot pass
    // on a stale constant while the list drifted.
    expect(HOME_SECTIONS.map((section) => section.id)).toEqual([
      "recently-played",
      "trending",
      "made-for-you",
      "smart-mixes",
      "genres",
      "podcasts",
      "collections",
    ]);
  });
});

describe("HomeView: the time-aware shelf follows the current band", () => {
  it("seeds its content and its label from the band at two different hours", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });

    const afternoon = render(<HomeView clock={() => instantAtLocalHour(14)} />);
    await settleFeed();
    const afternoonShelf = screen.getByTestId("home-time-shelf");
    expect(within(afternoonShelf).getByRole("heading", { name: "Afternoon" })).toBeInTheDocument();
    expect(within(afternoonShelf).getByText("Deep Funk")).toBeInTheDocument();
    expect(within(afternoonShelf).queryByText("Modern Soul")).not.toBeInTheDocument();
    afternoon.unmount();

    const evening = render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();
    const eveningShelf = screen.getByTestId("home-time-shelf");
    expect(within(eveningShelf).getByRole("heading", { name: "Evening" })).toBeInTheDocument();
    expect(within(eveningShelf).getByText("Modern Soul")).toBeInTheDocument();
    expect(within(eveningShelf).queryByText("Deep Funk")).not.toBeInTheDocument();
    evening.unmount();

    const lateNight = render(<HomeView clock={() => instantAtLocalHour(2)} />);
    await settleFeed();
    const nightShelf = screen.getByTestId("home-time-shelf");
    expect(within(nightShelf).getByRole("heading", { name: "Late night" })).toBeInTheDocument();
    expect(within(nightShelf).getByText("Ambient Drift")).toBeInTheDocument();
    lateNight.unmount();
  });

  it("issues no request of its own for the time-aware shelf", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    // The shelf selects from what the device already holds and what Home already
    // loaded, so it never appears in the request list at all.
    expect(screen.getByTestId("home-time-shelf")).toBeInTheDocument();
    expect(requestedKinds(calls)).not.toContain("ambient");
    expect(calls.every((call) => call.kind !== "time")).toBe(true);
  });

  it("labels the shelf with the band, never with a clock reading", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });

    // Two instants forty minutes apart in the same band: the label cannot be a
    // formatted clock reading, because the readings differ and the label does not.
    const first = render(<HomeView clock={() => instantAtLocalHour(20, 5)} />);
    await settleFeed();
    const firstLabel = within(screen.getByTestId("home-time-shelf")).getByRole(
      "heading",
    ).textContent;
    const firstText = screen.getByTestId("home-time-shelf").textContent ?? "";
    first.unmount();

    const second = render(<HomeView clock={() => instantAtLocalHour(20, 45)} />);
    await settleFeed();
    const secondLabel = within(screen.getByTestId("home-time-shelf")).getByRole(
      "heading",
    ).textContent;
    second.unmount();

    expect(firstLabel).toBe("Evening");
    expect(secondLabel).toBe(firstLabel);
    // No clock vocabulary anywhere in the shelf, and no band leaves in a request.
    expect(firstText).not.toMatch(/\d{1,2}:\d{2}|\b(am|pm)\b/i);
  });

  it("explains an empty band rather than substituting unrelated tracks", async () => {
    // Only a funk track locally: the evening band has nothing to select, and the
    // honest rendering is the explanation.
    seedStores({ likedTracks: [mood("Deep Funk", "Beacon", "funk")], events: [] });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    const shelf = screen.getByTestId("home-time-shelf");
    expect(
      await within(shelf).findByRole("heading", {
        name: "Nothing in this mood on this device yet",
      }),
    ).toBeInTheDocument();
    expect(within(shelf).queryByTestId("shelf-rail")).not.toBeInTheDocument();
  });

  it("exposes the band it rendered, so band verification has a hook to read", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    stubDiscovery(() => ({ tracks: [] }));

    // The attribute used to be passed to `Shelf` and silently dropped, because
    // TypeScript does not check hyphenated JSX attribute names and the primitive
    // rendered a fixed attribute set with no spread.
    for (const [hour, band] of [
      [8, "morning"],
      [14, "afternoon"],
      [20, "evening"],
      [2, "late-night"],
    ] as const) {
      const rendered = render(<HomeView clock={() => instantAtLocalHour(hour)} />);
      await settleFeed();
      expect(screen.getByTestId("home-time-shelf")).toHaveAttribute("data-band", band);
      rendered.unmount();
    }
  });
});

/**
 * M17 task 6.1, as extended: the time-aware shelf reaches a real query — but only
 * when a listener presses.
 *
 * The approved scope says local time selects "a seed set and query construction
 * only", and the `discovery` scenario "The time band is not sent and not stored" has
 * a WHEN clause of "a time-aware shelf issues a request **or composes a mix**". So
 * both halves are asserted here at Home level: the render still issues exactly the
 * pre-M17 request set, and the activation issues a `mix` request carrying the band's
 * terms and nothing about the band itself.
 */
describe("HomeView: the time-aware shelf's mix is composed on activation only", () => {
  it("offers the action, and renders without composing or fetching anything", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    expect(screen.getByTestId(TIME_SHELF_ACTION_ID)).toBeInTheDocument();
    // The render's own request set is unchanged — the pre-M17 baseline for a
    // listener with local taste — so the action exists and nothing has been composed
    // or requested on its behalf.
    expect(requestedKinds(calls).sort()).toEqual(["collection", "for-you", "podcast", "trending"]);
    expect(useMixStore.getState().mixes).toEqual([]);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("adds one mix request on activation, seeded by the band, and plays it", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    const { calls } = stubDiscovery((kind) =>
      kind === "mix"
        ? {
            tracks: [
              credited("m1", "Mix One", "Aurora"),
              credited("m2", "Mix Two", "Beacon"),
              credited("m3", "Mix Three", "Cobalt"),
            ],
          }
        : { tracks: [] },
    );
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    const requestsBefore = calls.length;
    await act(async () => {
      fireEvent.click(screen.getByTestId(TIME_SHELF_ACTION_ID));
    });

    await waitFor(() => expect(useMixStore.getState().mixes).toHaveLength(1));
    expect(usePlayerStore.getState().currentTrack).not.toBeNull();
    expect(useQueueStore.getState().source).toBe("browse");
    const mixCalls = calls.filter((call) => call.kind === "mix");
    expect(mixCalls.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(requestsBefore);

    // The request carries the band's mood and the listener's language, and nothing
    // that names the band, the label, or the hour it was pressed at.
    expect(mixCalls[0]?.params.get("seeds") ?? "").toContain(TIME_BAND_TERMS.evening);
    expect(mixCalls[0]?.params.get("languages")).toBe("en");
    expect(JSON.stringify([...mixCalls.map((call) => [...call.params])])).not.toMatch(
      /band|hour|clock|morning|afternoon|evening|night/i,
    );
    for (const call of mixCalls) {
      for (const key of call.params.keys()) {
        expect(key, key).not.toMatch(/band|time|hour|clock|mood/i);
      }
    }
  });

  it("keeps the band out of every store after the composition", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    stubDiscovery(() => ({ tracks: [credited("m1", "Mix One", "Aurora")] }));
    render(<HomeView clock={() => instantAtLocalHour(2)} />);
    await settleFeed();

    await act(async () => {
      fireEvent.click(screen.getByTestId(TIME_SHELF_ACTION_ID));
    });
    await waitFor(() => expect(useMixStore.getState().mixes).toHaveLength(1));

    const stored = JSON.stringify(useMixStore.getState().mixes[0] ?? {});
    expect(stored).toContain(TIME_BAND_TERMS["late-night"]);
    expect(stored).not.toMatch(/late-night|Late night|"hour"|"band"/);
  });

  it("offers no action on a device with nothing to build from", async () => {
    // The shelf still renders its own explained-empty state, but a control that could
    // only ever answer "no signal" is not offered at all.
    seedStores();
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    expect(screen.queryByTestId(TIME_SHELF_ACTION_ID)).not.toBeInTheDocument();
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();
  });

  it("explains an activation that could not compose, and leaves the feed intact", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    // Every feed fails, so the composition cannot succeed either.
    stubDiscovery(() => ({ fail: 503, code: "upstream_unavailable" }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    await act(async () => {
      fireEvent.click(screen.getByTestId(TIME_SHELF_ACTION_ID));
    });

    await waitFor(() => expect(screen.getByTestId(TIME_SHELF_STATUS_ID)).toBeInTheDocument());
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    // One failing surface does not take Home down, and the shelf's own lens survives.
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();
    expect(screen.getByTestId("home-time-shelf")).toHaveAttribute("data-band", "evening");
    expect(screen.getAllByTestId("shelf-track-card").length).toBeGreaterThan(0);
  });
});

describe("HomeView: the filter presents a subset and nothing else", () => {
  it("presents every shelf under All and no music shelf under Podcasts", async () => {
    // A mix is injected so every one of the eight sections is enabled: the claim
    // under test is about the *filter*, and a section dropped by its local gate
    // would otherwise look like a section dropped by the filter.
    seedStores({
      likedTracks: moodTaste(),
      events: [event("youtube:r1", "Played", "Aurora", 300)],
      mixes: [
        {
          id: "mix:2026-10-02:aurora",
          name: "Aurora",
          generatedAt: NOW_MIX,
          period: "2026-10-02",
          seeds: ["Aurora"],
          tracks: [makeTrack({ id: "youtube:mix1", providerId: "mix1", title: "Mix Song" })],
          updatedAt: NOW_MIX,
        },
      ],
    });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    for (const section of HOME_SECTIONS) {
      const shelf = screen.getByTestId(`home-section-${section.id}`);
      expect(shelf, `All must present ${section.id}`).toBeInTheDocument();
    }
    expect(screen.getByTestId("home-mix-cards")).toBeInTheDocument();
    expect(screen.getByTestId("home-quick-picks")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-filter-podcasts"));

    await waitFor(() =>
      expect(screen.queryByTestId("home-section-trending")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("home-section-podcasts")).toBeInTheDocument();
    // The M17 surfaces follow the same filter, so they go with their siblings.
    expect(screen.queryByTestId("home-mix-cards")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-quick-picks")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-time-shelf")).not.toBeInTheDocument();
    // And nothing was invented to fill the gap.
    for (const section of HOME_SECTIONS) {
      if (section.id === "podcasts") continue;
      expect(screen.queryByTestId(`home-section-${section.id}`)).not.toBeInTheDocument();
    }
  });

  it("presents the music shelves under Music and no podcast shelf", async () => {
    seedStores({
      likedTracks: moodTaste(),
      events: [event("youtube:r1", "Played", "Aurora", 300)],
    });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    fireEvent.click(screen.getByTestId("home-filter-music"));

    await waitFor(() =>
      expect(screen.queryByTestId("home-section-podcasts")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();
    expect(screen.getByTestId("home-mix-cards")).toBeInTheDocument();
  });

  it("states which filter is on, and changes no request", async () => {
    const { calls } = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();
    const before = calls.length;

    expect(screen.getByTestId("home-filter-all")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("home-filter-music"));

    await waitFor(() =>
      expect(screen.getByTestId("home-filter-music")).toHaveAttribute("aria-pressed", "true"),
    );
    expect(screen.getByTestId("home-filter-all")).toHaveAttribute("aria-pressed", "false");
    // A filter is a lens on what is already loaded: it re-presents, never re-fetches.
    expect(calls).toHaveLength(before);
  });
});

describe("HomeView: a mix card starts playback without leaving the page", () => {
  it("plays the composed mix and leaves every other shelf intact", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    const { calls } = stubDiscovery(() => ({
      tracks: [
        credited("m1", "Mix One", "Aurora"),
        credited("m2", "Mix Two", "Beacon"),
        credited("m3", "Mix Three", "Cobalt"),
      ],
    }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    const requestsBefore = calls.length;
    const shelf = await screen.findByTestId("home-mix-cards");
    const card = within(shelf)
      .getAllByTestId("mix-card")
      .find((entry) => entry.getAttribute("data-mix-id") === "top");
    if (card === undefined) throw new Error("the top card is missing");
    fireEvent.click(card);

    await waitFor(() => expect(usePlayerStore.getState().currentTrack).not.toBeNull());
    expect(useQueueStore.getState().source).toBe("browse");
    // Still on Home, and every other shelf still rendered.
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();
    expect(screen.getByTestId("home-time-shelf")).toBeInTheDocument();
    // The mix was composed through the one generator — a `mix` feed request — and
    // only then, on activation.
    expect(calls.length).toBeGreaterThan(requestsBefore);
    expect(calls.some((call) => call.kind === "mix")).toBe(true);
  });

  it("explains a card that cannot compose, and leaves the rest of Home intact", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    // Every feed fails, so the card's composition cannot succeed either.
    stubDiscovery(() => ({ fail: 503, code: "upstream_unavailable" }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);

    const shelf = await screen.findByTestId("home-mix-cards");
    const card = within(shelf)
      .getAllByTestId("mix-card")
      .find((entry) => entry.getAttribute("data-mix-id") === "top");
    if (card === undefined) throw new Error("the top card is missing");
    await act(async () => {
      fireEvent.click(card);
    });

    await waitFor(() => expect(screen.getByTestId("mix-card-notice")).toBeInTheDocument());
    // Nothing started, and the feed is still there: one failing surface does not
    // take Home down.
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();
    expect(screen.getByTestId("home-time-shelf")).toBeInTheDocument();
  });
});

describe("HomeView: M17 leaves the shell's geometry alone", () => {
  it("introduces no positioned element that could cover the player region", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    stubDiscovery(() => ({ tracks: [] }));
    const { container } = render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    // The persistent player lives outside Home in a fixed region of the shell, so
    // anything Home renders that is positioned out of flow could overlap it at a
    // compact viewport. The onboarding dialog is the one exception and it is not
    // part of this assertion — it is a dialog, it is dismissible, and it is
    // filtered out below like every other element.
    const positioned = [...container.querySelectorAll("*")].filter((element) =>
      /\b(fixed|absolute|sticky)\b/.test(element.className),
    );
    expect(positioned.map((element) => element.getAttribute("data-testid"))).toEqual([]);
  });

  it("keeps every new surface inside a horizontal scroll region", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    // Nothing new is wider than the column: each M17 surface's cards live in the
    // shell rail's own scroll container, so a compact viewport scrolls sideways
    // rather than clipping a card.
    for (const id of ["home-mix-cards", "home-quick-picks", "home-time-shelf"]) {
      const rail = within(screen.getByTestId(id)).getByTestId("shelf-rail");
      expect(rail.className, id).toContain("overflow-x-auto");
      // The rail is focusable, so a keyboard user can pan it.
      expect(rail.getAttribute("tabindex"), id).toBe("0");
    }
  });

  it("keeps the whole feed a single scrolling column", async () => {
    seedStores({ likedTracks: moodTaste(), events: [] });
    stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView clock={() => instantAtLocalHour(20)} />);
    await settleFeed();

    const view = screen.getByTestId("home-view");
    expect(view.className).toContain("flex-col");
    // Sections remain reachable by scrolling: the feed is a column of rails, and
    // nothing inside it hides overflow from the shell's own scroll region.
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();
    expect(screen.getByTestId("home-section-collections")).toBeInTheDocument();
  });
});
