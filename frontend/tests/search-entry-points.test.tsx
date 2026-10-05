import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import { albumRequestKey } from "@/features/album/albumKeys";
import { HomeView } from "@/features/home/HomeView";
import { ArtistTile } from "@/features/search/ArtistTile";
import { AlbumTile } from "@/features/search/AlbumTile";
import { deriveResults, type DerivedAlbum, type DerivedArtist } from "@/features/search/derive";
import { ResultMenu } from "@/features/search/ResultMenu";
import { artistRequestKey } from "@/features/artist/artistKeys";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore } from "@/stores/playerStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M9 task 6.1 — every artist/album reference a user can activate reaches the
 * real surface (spec: `catalog` — "Catalog entity keys and resolution
 * requests").
 *
 * The suite covers the three surfaces that used to reach an entity by refining
 * the search query: the M5 derived tiles, the result menu's go-to items, and
 * the M8 Popular Artists cards. Each is asserted twice — once for metadata that
 * carries a provider id and once for metadata that carries none — because the
 * text-key half of the route is what keeps an id-less entry activatable rather
 * than dead. It also pins that a minted key round-trips: decoding it once
 * returns exactly the text it was built from, never a double-encoded string.
 */

configure({ asyncUtilTimeout: 5000 });

/** A YouTube channel id — the one id shape a provider hands us today. */
const CHANNEL_ID = "UCaurorachannel00000000";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));

// The tiles and the Home artist cards navigate as links.
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

function artistFor(track: Track): DerivedArtist {
  const entry = deriveResults([track], "x").artists[0];
  if (entry === undefined) throw new Error("track resolved no artist");
  return entry;
}

function albumFor(track: Track): DerivedAlbum {
  const entry = deriveResults([track], "x").albums[0];
  if (entry === undefined) throw new Error("track resolved no album");
  return entry;
}

/** Open the per-result menu and activate one of its items by name. */
function activateMenuItem(menuItem: string): void {
  fireEvent.click(screen.getByRole("button", { name: "More options for Karma Police" }));
  fireEvent.click(screen.getByRole("menuitem", { name: menuItem }));
}

beforeEach(() => {
  resetHistoryStore();
  resetLibraryStore();
  resetPlayerStore();
  resetPreferencesStore();
  nav.push.mockClear();
  nav.replace.mockClear();
  // The feed only reads these stores' slices; their repository reads are stubbed
  // so the suite never opens IndexedDB.
  useHistoryStore.setState({ events: [], hydrated: true, hydrate: () => Promise.resolve() });
  useLibraryStore.setState({ likedTracks: [], hydrated: true, hydrate: () => Promise.resolve() });
  usePreferencesStore.setState({
    languages: ["en"],
    onboardingComplete: true,
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("search artist tiles (M9 task 6.1)", () => {
  it("links an artist the provider identified to its artist route", () => {
    const artist = artistFor(
      makeTrack({ title: "Run Away", artists: [{ id: CHANNEL_ID, name: "Aurora" }] }),
    );

    render(<ArtistTile artist={artist} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/artist/${CHANNEL_ID}`);
    expect(link).toHaveTextContent("Aurora"); // DESIGN.md circular card composition
    expect(link).toHaveTextContent("Artist");
  });

  it("links an artist with no provider id by its name, percent-encoded once", () => {
    const artist = artistFor(makeTrack({ title: "Jóga", artists: [{ name: "Björk" }] }));

    render(<ArtistTile artist={artist} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/artist/Bj%C3%B6rk");
    // Round-trip: one decode returns the name the card shows.
    const key = link.getAttribute("href")?.replace("/artist/", "") ?? "";
    expect(decodeURIComponent(key)).toBe("Björk");
    expect(key).not.toContain("%25"); // encoded exactly once
    expect(artistRequestKey(key)).toEqual({ name: "Björk" });
  });

  it("treats a blank provider id as no id, and links by name (M12)", () => {
    // The Invidious tier returns podcast shows whose channel id is present and
    // empty. `??` alone would take that empty string as the id and produce
    // `/artist/` — a link to the route with no key, which renders not-found and
    // prefetches a 404. The name is the usable key there, so the tile must use it.
    const artist = artistFor(
      makeTrack({
        title: "Best Friend Buried Alive",
        artists: [{ id: "", name: "SRF Dokus" }],
        category: "podcast",
      }),
    );

    render(<ArtistTile artist={artist} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/artist/SRF%20Dokus");
    expect(link.getAttribute("href")).not.toBe("/artist/");
    expect(artistRequestKey("SRF Dokus")).toEqual({ name: "SRF Dokus" });
  });

  it("uses the credited artist's id, not another credit on the same track", () => {
    // The derived entry is keyed by name, so the id has to come from the credit
    // the entry was built from — a feat. track must not borrow a co-artist's id.
    const artist = artistFor(
      makeTrack({
        title: "Sicko Mode",
        artists: [
          { id: CHANNEL_ID, name: "Travis Scott" },
          { id: "UCsomeoneelse0000000", name: "Playboi Carti" },
        ],
      }),
    );

    render(<ArtistTile artist={artist} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", `/artist/${CHANNEL_ID}`);
  });
});

describe("search album tiles (M9 task 6.1)", () => {
  it("links a release the provider identified to its album route", () => {
    const album = albumFor(
      makeTrack({
        title: "Dawn Chorus",
        artists: [{ name: "Aurora" }],
        album: { id: "MPREb1234567890abcdefghij", title: "Dawn Chorus" },
      }),
    );

    render(<AlbumTile album={album} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/album/MPREb1234567890abcdefghij");
    expect(link).toHaveTextContent("Dawn Chorus"); // DESIGN.md square card composition
  });

  it("composes `<title> - <artist>` for a release with no provider id", () => {
    const album = albumFor(
      makeTrack({
        title: "Dawn Chorus",
        artists: [{ name: "Aurora" }],
        album: { title: "Dawn Chorus" },
      }),
    );

    render(<AlbumTile album={album} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/album/Dawn%20Chorus%20-%20Aurora");
    // And the minted key classifies back into the identifiers it came from.
    const key = link.getAttribute("href")?.replace("/album/", "") ?? "";
    expect(decodeURIComponent(key)).toBe("Dawn Chorus - Aurora");
    expect(albumRequestKey(key)).toEqual({ title: "Dawn Chorus", artist: "Aurora" });
  });
});

describe("result menu go-to items (M9 task 6.1)", () => {
  const karmaPolice = makeTrack({
    id: "youtube:aaa",
    providerId: "aaa",
    title: "Karma Police",
    artists: [{ name: "Radiohead" }],
    album: { title: "OK Computer" },
  });

  function renderMenu(track: Track): void {
    render(<ResultMenu track={track} isLiked={false} onPlay={vi.fn()} onToggleLike={vi.fn()} />);
  }

  it("opens the artist route instead of refining the query", () => {
    renderMenu(karmaPolice);

    activateMenuItem("Go to artist");

    expect(nav.push).toHaveBeenCalledWith("/artist/Radiohead");
    // Refined search stays available elsewhere, but this action is not it.
    expect(nav.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument(); // menu closes on activation
  });

  it("keeps the provider id when the result carries one", () => {
    renderMenu(
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: "Karma Police",
        artists: [{ id: CHANNEL_ID, name: "Radiohead" }],
        album: { id: "MPREb1234567890abcdefghij", title: "OK Computer" },
      }),
    );

    activateMenuItem("Go to artist");
    expect(nav.push).toHaveBeenLastCalledWith(`/artist/${CHANNEL_ID}`);
  });

  it("opens the album route instead of refining the query", () => {
    renderMenu(karmaPolice);

    activateMenuItem("Go to album");

    expect(nav.push).toHaveBeenCalledWith("/album/OK%20Computer%20-%20Radiohead");
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("keeps the provider release id when the result carries one", () => {
    renderMenu(
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: "Karma Police",
        artists: [{ name: "Radiohead" }],
        album: { id: "MPREb1234567890abcdefghij", title: "OK Computer" },
      }),
    );

    activateMenuItem("Go to album");
    expect(nav.push).toHaveBeenLastCalledWith("/album/MPREb1234567890abcdefghij");
  });

  it("omits only the item whose metadata did not resolve", () => {
    // No album summary on the track: the album route has nothing to mint, so the
    // item is absent rather than a link to a route that cannot resolve.
    renderMenu(
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: "Karma Police",
        artists: [{ name: "Radiohead" }],
        album: undefined,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "More options for Karma Police" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Go to artist" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Go to album" })).not.toBeInTheDocument();
  });

  it("treats a blank name or title as no metadata, not as an entity called empty", () => {
    renderMenu(
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: "Karma Police",
        artists: [{ name: "   " }],
        album: { title: "   " },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "More options for Karma Police" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Go to artist" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Go to album" })).not.toBeInTheDocument();
  });

  it("navigates by the id even when the credited name is blank", () => {
    // A tier can attach an id to a credit whose display name never resolved; the
    // id is still the entity's own identity, so the item is not dropped.
    renderMenu(
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: "Karma Police",
        artists: [{ id: CHANNEL_ID, name: "   " }],
      }),
    );

    activateMenuItem("Go to artist");
    expect(nav.push).toHaveBeenCalledWith(`/artist/${CHANNEL_ID}`);
  });
});

/**
 * M9 task 6.1's entry-point clauses — a rendered artist card is a navigation
 * target, not a play control, and its href resolves to the artist route — retargeted
 * onto the Quick Picks rail in M23.
 *
 * Retargeted, not deleted. The assertions are about *rendered* Home cards: that the
 * card is an `<a>` rather than a button, and that the href carries an identity the
 * artist route can resolve. M23 removed the `popular-artists` section because it was
 * measured on production to be a strict prefix of this rail, so those exact claims
 * now live on the one surface that carries them. Deleting them with the section would
 * have left M9's requirement unasserted while looking like a clean migration.
 */
describe("Home artist cards resolve to the artist route (M9 task 6.1, M23 rail)", () => {
  /** Stub the discovery feed: trending carries the shelf the cards derive from. */
  function stubTrending(tracks: Track[]): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        const kind = url.searchParams.get("kind");
        return {
          ok: true,
          status: 200,
          json: async () => ({ tracks: kind === "trending" ? tracks : [], diagnostics: {} }),
        } as unknown as Response;
      }),
    );
  }

  /**
   * One render of the rail, returning both the anchors and the cards.
   *
   * M23 note on which element is which. The anchor carries
   * `data-testid="quick-pick"`; the circular artist card *inside* it carries
   * `data-testid="home-artist-card"`, retained from the consolidated Popular Artists
   * section. This file's original helper returned `home-artist-card` and asserted the
   * returned element was an `<a>` with an href — true when the card *was* the link, and
   * no longer true now that the link wraps the card. The navigation assertions read the
   * anchor; the card is read by the retained id.
   *
   * Both are returned from a single render on purpose. Querying them with two helpers
   * would mean two `render()` calls in one test, and the second Home would answer the
   * same test ids — the assertion would then be measuring a tree with duplicates in it,
   * which is a weaker claim than it looks.
   */
  async function rail(tracks: Track[]): Promise<{ links: HTMLElement[]; cards: HTMLElement[] }> {
    stubTrending(tracks);
    render(<HomeView />);
    // M23: the circular artist rail is Quick Picks. It is not a `home-section-*`
    // row, so the query names the surface id the shelf actually renders.
    const shelf = await screen.findByTestId("home-quick-picks");
    await waitFor(() => {
      expect(within(shelf).queryAllByTestId("quick-pick")).not.toHaveLength(0);
      expect(within(shelf).queryAllByTestId("home-artist-card")).not.toHaveLength(0);
    });
    return {
      links: within(shelf).getAllByTestId("quick-pick"),
      cards: within(shelf).getAllByTestId("home-artist-card"),
    };
  }

  const ONE_IDENTIFIED_ARTIST = [
    makeTrack({
      id: "youtube:aaa",
      providerId: "aaa",
      title: "Run Away",
      artists: [{ id: CHANNEL_ID, name: "Aurora" }],
    }),
  ];

  it("links an identified artist to its artist route", async () => {
    const { links, cards } = await rail(ONE_IDENTIFIED_ARTIST);

    expect(links).toHaveLength(1);
    expect(cards).toHaveLength(1);
    expect(links[0].tagName).toBe("A"); // a navigation card, never a play control
    expect(links[0]).toHaveAttribute("href", `/artist/${CHANNEL_ID}`);
    expect(links[0]).toHaveTextContent("Aurora");
    expect(links[0]).toHaveTextContent("Artist"); // DESIGN.md circular card composition
  });

  it("wraps the circular artist card in the artist link", async () => {
    // The retained `home-artist-card` id is what other assertions address, so the
    // relationship it now has to the anchor is asserted rather than assumed: the card
    // is inside a link, and the card is not itself one.
    const { links, cards } = await rail(ONE_IDENTIFIED_ARTIST);

    expect(cards[0].tagName).toBe("ARTICLE");
    expect(links[0]).toContainElement(cards[0]);
  });

  it("links an artist with no provider id by a resolvable text key", async () => {
    // `groupArtistsByIdentity` keys an id-less artist by its *normalized* name,
    // which is a derived identity rather than a display name (it is lowercased).
    // The card therefore prefers the artist's real name for the route key, so a
    // shared link keeps its capitalization, and only falls back to the derived
    // id when that is a genuine provider id.
    const { links } = await rail([
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: "Run Away",
        artists: [{ name: "Aurora Sky" }],
      }),
    ]);

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/artist/Aurora%20Sky");
    const key = links[0].getAttribute("href")?.replace("/artist/", "") ?? "";
    expect(decodeURIComponent(key)).toBe("Aurora Sky");
    expect(artistRequestKey(key)).toEqual({ name: "Aurora Sky" });
  });
});
