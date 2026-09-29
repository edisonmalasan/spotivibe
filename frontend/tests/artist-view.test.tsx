import "fake-indexeddb/auto";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArtistPage from "@/app/artist/[key]/page";
import { getLocalData, type RepositorySet } from "@/data/localData";
import type { Track } from "@/data/repositories";
import { ArtistView } from "@/features/artist/ArtistView";
import { ARTIST_ENDPOINT } from "@/features/artist/artistApi";
import { likedTracksByArtist } from "@/features/artist/likedByArtist";
import { makeTrack } from "./helpers/music-fixtures";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";

/**
 * M9 tasks 3.3–3.4 (spec: `catalog` — "Artist page" / "Catalog entity keys and
 * resolution requests" / "Local catalog signals"; design §2/§4/§5).
 *
 * The four designed states, the playback context a row and "Start artist radio"
 * adopt, per-row like persistence through the real repository, the
 * navigation targets a release and a related artist produce, and the local
 * liked-by-artist signal — asserted in both directions (it appears without a
 * request, and it disappears when the local data changes) — plus the two
 * negatives the spec makes load-bearing: nothing autoplays on open, and nothing
 * on the page claims a chart, a ranking, or an account.
 */

// Cold fake-indexeddb hydration plus a resolution round trip can exceed 1s.
configure({ asyncUtilTimeout: 5000 });

// SectionHeader, the release cards, and the related-artist cards all navigate
// through next/link.
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

const CHANNEL_ID = "UCaurorachannel00000000";

const alpha = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Alpha",
  artists: [{ name: "Aurora" }],
  album: { title: "Dawn Chorus" },
  artwork: [{ url: "https://example.test/alpha.jpg", width: 640 }],
});
const beta = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Beta",
  artists: [{ name: "Aurora" }, { name: "Beacon" }],
  album: { title: "Night Radio" },
});
/**
 * A liked collaboration whose second credit is the artist under a different
 * case and with trailing punctuation — the shape `splitArtists` actually
 * produces for an id-less artist, and the one the name fold has to absorb.
 */
const likedCollab = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "Collab",
  artists: [{ name: "Cobalt" }, { name: "  aurora!  " }],
});

/** The four sections of the fixture resolution, overridable per test. */
interface Resolution {
  artist?: Record<string, unknown>;
  tracks?: Track[];
  related?: Array<Record<string, unknown>>;
  releases?: Array<Record<string, unknown>>;
}

const DEFAULT_RESOLUTION: Required<Resolution> = {
  artist: { id: CHANNEL_ID, name: "Aurora", artworkUrl: "https://example.test/aurora.jpg" },
  tracks: [alpha, beta],
  related: [{ id: "UCbeaconchannel000000000", name: "Beacon", trackCount: 1 }],
  releases: [
    { id: "UCdawnrelease0000000000", title: "Dawn Chorus", artistName: "Aurora", trackCount: 1 },
    { title: "Night Radio", trackCount: 1 },
  ],
};

type Reply = { resolve: Required<Resolution> } | { fail: number; code: string } | { hang: true };

interface Recorded {
  url: URL;
}

function stubArtist(reply: (call: number) => Reply = () => ({ resolve: DEFAULT_RESOLUTION })) {
  const calls: Recorded[] = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(input), "http://localhost") });
    const outcome = reply(calls.length - 1);
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
    const { artist, tracks, related, releases } = outcome.resolve;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ artist, tracks, related, releases, diagnostics: {} }),
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

let repositories: RepositorySet;

beforeEach(async () => {
  resetLibraryStore();
  resetPlayerStore();
  resetQueueStore();
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function queueIds(): string[] {
  return useQueueStore.getState().queue.map((track) => track.id);
}

describe("ArtistView: the loading state", () => {
  it("renders skeletons rather than a blank region while the resolution is in flight", async () => {
    stubArtist(() => ({ hang: true }));
    render(<ArtistView artistKey="Aurora" />);

    expect(screen.getByTestId("artist-view")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("artist-loading")).toBeInTheDocument());
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    // The track section is announced but holds placeholders, not results.
    expect(screen.getByTestId("artist-tracks")).toBeInTheDocument();
    expect(screen.queryByTestId("artist-releases")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artist-related")).not.toBeInTheDocument();
  });

  it("issues one request, carrying only the identifier", async () => {
    const { calls } = stubArtist();
    render(<ArtistView artistKey="Aurora Sky" />);
    await screen.findByText("Alpha");

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe(ARTIST_ENDPOINT);
    expect([...calls[0].url.searchParams.keys()]).toEqual(["name"]);
    expect(calls[0].url.searchParams.get("name")).toBe("Aurora Sky");
  });
});

describe("ArtistView: the ready state", () => {
  it("renders identity, artwork, tracks, releases, and related artists from one resolution", async () => {
    const { calls } = stubArtist();
    render(<ArtistView artistKey="Aurora" />);

    const view = screen.getByTestId("artist-view");
    expect(await within(view).findByRole("heading", { name: "Aurora" })).toBeInTheDocument();
    expect(screen.getByText("Artist • 2 songs")).toBeInTheDocument();
    expect(screen.getByTestId("artist-portrait").querySelector("img")).toHaveAttribute(
      "src",
      "https://example.test/aurora.jpg",
    );

    // Popular tracks.
    const tracks = screen.getByTestId("artist-tracks");
    expect(within(tracks).getByRole("button", { name: "Play Alpha" })).toBeInTheDocument();
    expect(within(tracks).getByRole("button", { name: "Play Beta" })).toBeInTheDocument();

    // Releases, addressed by the release id when the provider gave one and by
    // the title when it did not.
    const releases = screen.getByTestId("artist-releases");
    const tiles = within(releases).getAllByTestId("artist-release");
    expect(tiles.map((tile) => tile.getAttribute("href"))).toEqual([
      "/album/UCdawnrelease0000000000",
      "/album/Night%20Radio",
    ]);
    expect(tiles[0]).toHaveTextContent("Dawn Chorus");
    expect(tiles[0]).toHaveTextContent("1 song");

    // Related artists, addressed the same way an artist route is.
    const related = screen.getByTestId("artist-related");
    const entry = within(related).getByTestId("artist-related-card");
    expect(entry.getAttribute("href")).toBe("/artist/UCbeaconchannel000000000");
    expect(entry).toHaveTextContent("Beacon");

    // Every section came from the same single request.
    expect(calls).toHaveLength(1);
  });

  it("falls back to a circular placeholder when the artist has no artwork", async () => {
    stubArtist(() => ({
      resolve: { ...DEFAULT_RESOLUTION, artist: { name: "Aurora" } },
    }));
    render(<ArtistView artistKey="Aurora" />);

    await screen.findByText("Alpha");
    const portrait = screen.getByTestId("artist-portrait");
    expect(portrait.querySelector("img")).toBeNull();
    // The circle is the visual (DESIGN.md "Circular Artist Card"), so it stays a
    // circle rather than falling back to a square.
    expect(portrait.className).toContain("rounded-avatars");
  });

  it("addresses a related artist with no id by its name", async () => {
    stubArtist(() => ({
      resolve: { ...DEFAULT_RESOLUTION, related: [{ name: "Beacon Sky", trackCount: 2 }] },
    }));
    render(<ArtistView artistKey="Aurora" />);

    const related = await screen.findByTestId("artist-related");
    const entry = within(related).getByTestId("artist-related-card");
    expect(entry.getAttribute("href")).toBe("/artist/Beacon%20Sky");
    expect(entry).toHaveAttribute("aria-label", "Beacon Sky, 2 songs");
  });

  it("explains an empty derived section instead of rendering a blank rail", async () => {
    stubArtist(() => ({
      resolve: { ...DEFAULT_RESOLUTION, related: [], releases: [] },
    }));
    render(<ArtistView artistKey="Aurora" />);

    const related = await screen.findByTestId("artist-related");
    expect(
      await within(related).findByRole("heading", { name: "No related artists" }),
    ).toBeInTheDocument();
    expect(within(related).queryByTestId("shelf-rail")).not.toBeInTheDocument();

    const releases = screen.getByTestId("artist-releases");
    expect(
      within(releases).getByRole("heading", { name: "No releases found" }),
    ).toBeInTheDocument();
  });

  it("uses the DESIGN.md circular and square card geometry", async () => {
    stubArtist();
    const { container } = render(<ArtistView artistKey="Aurora" />);
    await screen.findByText("Alpha");

    expect(
      container.querySelector('[data-testid="artist-releases"] .rounded-cards'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="artist-related"] .rounded-avatars'),
    ).not.toBeNull();
  });

  it("never autoplays on open", async () => {
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);
    await screen.findByText("Alpha");

    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().status).toBe("idle");
    expect(usePlayerStore.getState().loadRequest).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
    expect(useQueueStore.getState().source).not.toBe("browse");
  });

  it("makes no account, chart, or editorial claim anywhere on the page", async () => {
    stubArtist();
    const { container } = render(<ArtistView artistKey="Aurora" />);
    await screen.findByText("Alpha");

    expect(container.textContent).not.toMatch(
      /chart|ranking|most listened|top of the|editor|official|fans also like|spotify|youtube|sign in|log in/i,
    );
  });

  it("keeps every control keyboard operable with an accessible name", async () => {
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);
    await screen.findByText("Alpha");

    const controls = screen.getAllByRole("button").concat(screen.getAllByRole("link"));
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      // A real interactive element with a real name, and no focus-ring removal:
      // the design system relies on the global `:focus-visible` outline.
      expect(["BUTTON", "A"], control.tagName).toContain(control.tagName);
      expect(control.getAttribute("aria-label") ?? control.textContent ?? "").not.toBe("");
      expect(control.className).not.toMatch(/outline-none/);
    }
    expect(screen.getByRole("button", { name: "Start artist radio" })).toBeInTheDocument();
  });
});

describe("ArtistView: playing and liking a track", () => {
  it("plays a row with the whole artist feed as its context, recorded as browse", async () => {
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);

    const tracks = await screen.findByTestId("artist-tracks");
    fireEvent.click(await within(tracks).findByRole("button", { name: "Play Beta" }));

    expect(usePlayerStore.getState().currentTrack?.id).toBe("youtube:bbb");
    expect(useQueueStore.getState().source).toBe("browse");
    expect(queueIds()).toEqual([alpha.id, beta.id]);
    expect(useQueueStore.getState().queueIndex).toBe(1);
    // Plain row play never turns shuffle on.
    expect(useQueueStore.getState().shuffle).toBe(false);
  });

  it("persists a per-row like through the library and flips the row's state", async () => {
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);

    const tracks = await screen.findByTestId("artist-tracks");
    const like = await within(tracks).findByRole("button", { name: "Save Alpha to Liked Songs" });
    expect(like).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(like);

    // Repository first, state second — the write lands before the row updates.
    await waitFor(() => expect(repositories.likedTracks.isLiked(alpha.id)).resolves.toBe(true));
    const unlike = await within(tracks).findByRole("button", {
      name: "Remove Alpha from Liked Songs",
    });
    expect(unlike).toHaveAttribute("aria-pressed", "true");
    // Shared like state, so search and Now Playing agree without a remount.
    expect(useLibraryStore.getState().likedIds.has(alpha.id)).toBe(true);

    fireEvent.click(unlike);
    await waitFor(() => expect(repositories.likedTracks.isLiked(alpha.id)).resolves.toBe(false));
  });

  it("keeps liking independent of playback", async () => {
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);

    const tracks = await screen.findByTestId("artist-tracks");
    fireEvent.click(
      await within(tracks).findByRole("button", { name: "Save Beta to Liked Songs" }),
    );

    await waitFor(() => expect(repositories.likedTracks.isLiked(beta.id)).resolves.toBe(true));
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
  });
});

describe("ArtistView: Start artist radio", () => {
  it("seeds playback from the first track with the artist feed as the context", async () => {
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);

    fireEvent.click(await screen.findByRole("button", { name: "Start artist radio" }));

    expect(usePlayerStore.getState().currentTrack?.id).toBe(alpha.id);
    expect(useQueueStore.getState().source).toBe("browse");
    // The whole feed is the context, so the artist plays through.
    expect(queueIds()).toEqual([alpha.id, beta.id]);
    expect(useQueueStore.getState().queueIndex).toBe(0);
  });
});

describe("ArtistView: the local liked-by-artist signal", () => {
  it("lists liked tracks by the artist without issuing a request for the signal", async () => {
    await repositories.likedTracks.like(likedCollab, 1_000);
    const { mock, calls } = stubArtist();
    render(<ArtistView artistKey="Aurora" />);

    const liked = await screen.findByTestId("artist-liked");
    expect(within(liked).getByRole("button", { name: "Play Collab" })).toBeInTheDocument();

    // The signal is local: exactly the one resolution request, no more.
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe(ARTIST_ENDPOINT);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("omits the section entirely when no liked track belongs to the artist", async () => {
    await repositories.likedTracks.like(
      makeTrack({
        id: "youtube:zzz",
        providerId: "zzz",
        title: "Other",
        artists: [{ name: "Cobalt" }],
      }),
      1_000,
    );
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);

    await screen.findByText("Alpha");
    // An empty section is a hole in the page, not information.
    expect(screen.queryByTestId("artist-liked")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Liked tracks by this artist" })).toBeNull();
  });

  it("disappears when the local liked data changes", async () => {
    await repositories.likedTracks.like(likedCollab, 1_000);
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);
    await screen.findByTestId("artist-liked");

    await repositories.likedTracks.clear();
    await act(async () => {
      await useLibraryStore.getState().hydrate();
    });

    await waitFor(() => expect(screen.queryByTestId("artist-liked")).not.toBeInTheDocument());
  });

  it("appears again when a matching like is added after the page loaded", async () => {
    stubArtist();
    render(<ArtistView artistKey="Aurora" />);
    await screen.findByText("Alpha");
    expect(screen.queryByTestId("artist-liked")).not.toBeInTheDocument();

    await repositories.likedTracks.like(likedCollab, 1_000);
    await act(async () => {
      await useLibraryStore.getState().hydrate();
    });

    expect(await screen.findByTestId("artist-liked")).toBeInTheDocument();
  });
});

describe("likedTracksByArtist: the pure filter behind that section", () => {
  const byAurora = makeTrack({
    id: "youtube:a1",
    providerId: "a1",
    title: "By Aurora",
    artists: [{ name: "Aurora" }],
  });
  const byAuroraId = makeTrack({
    id: "youtube:a2",
    providerId: "a2",
    title: "By the channel",
    artists: [{ id: CHANNEL_ID, name: "A Different Spelling" }],
  });
  const collabTrack = makeTrack({
    id: "youtube:a3",
    providerId: "a3",
    title: "Collab",
    artists: [{ name: "Cobalt" }, { name: "Aurora" }],
  });
  const byOther = makeTrack({
    id: "youtube:b1",
    providerId: "b1",
    title: "Other",
    artists: [{ name: "Beacon" }],
  });
  const anonymous = makeTrack({ id: "youtube:b2", providerId: "b2", title: "No credits" });

  it("matches a name case-, punctuation-, and whitespace-insensitively", () => {
    expect(likedTracksByArtist([byAurora, byOther], { name: "aurora" })).toEqual([byAurora]);
    expect(likedTracksByArtist([byAurora], { name: "  AURORA  " })).toEqual([byAurora]);
    expect(likedTracksByArtist([byOther], { name: "Aurora" })).toEqual([]);
  });

  it("matches on the id when both sides carry one, and only then", () => {
    // Ids agree even though the names do not: this is the exact path, and it is
    // what lets an id-resolved page find a locally liked track at all.
    expect(likedTracksByArtist([byAuroraId], { id: CHANNEL_ID, name: "Aurora" })).toEqual([
      byAuroraId,
    ]);
    // Two same-named channels must not merge: when both sides carry an id, the
    // name is never consulted, so a different channel is not this artist.
    expect(
      likedTracksByArtist([byAuroraId], {
        id: "UCsomeotherchannel0000",
        name: "A Different Spelling",
      }),
    ).toEqual([]);
    // One side without an id falls back to the name.
    expect(likedTracksByArtist([byAurora], { id: CHANNEL_ID, name: "aurora" })).toEqual([byAurora]);
  });

  it("counts a collaboration and keeps the input order", () => {
    expect(likedTracksByArtist([byOther, collabTrack, byAurora], { name: "Aurora" })).toEqual([
      collabTrack,
      byAurora,
    ]);
  });

  it("matches nothing for an unidentified artist or an empty library", () => {
    expect(likedTracksByArtist([byAurora], { name: "   " })).toEqual([]);
    expect(likedTracksByArtist([], { name: "Aurora" })).toEqual([]);
    expect(likedTracksByArtist([anonymous], { name: "Aurora" })).toEqual([]);
  });
});

describe("ArtistView: a failing resolution", () => {
  it("shows a retryable error for an unavailable upstream and recovers on retry", async () => {
    stubArtist((call) =>
      call === 0 ? { fail: 503, code: "upstream_unavailable" } : { resolve: DEFAULT_RESOLUTION },
    );
    render(<ArtistView artistKey="Aurora" />);

    const failure = await screen.findByTestId("artist-error");
    const alert = await within(failure).findByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "This artist didn't load" }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent("Check your connection and try again.");
    // A failure renders the error, never an empty artist page.
    expect(screen.queryByTestId("artist-tracks")).not.toBeInTheDocument();

    fireEvent.click(within(failure).getByRole("button", { name: "Retry" }));

    expect(await screen.findByTestId("artist-tracks")).toBeInTheDocument();
    expect(screen.queryByTestId("artist-error")).not.toBeInTheDocument();
  });

  it("shows a retryable error for a transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    render(<ArtistView artistKey="Aurora" />);

    const failure = await screen.findByTestId("artist-error");
    expect(within(failure).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });
});

describe("ArtistView: an unresolvable artist key", () => {
  it("shows a recoverable not-found state with a way back, not an error", async () => {
    stubArtist(() => ({ fail: 404, code: "unresolvable" }));
    render(<ArtistView artistKey="Nobody At All" />);

    const notFound = await screen.findByTestId("artist-not-found");
    expect(within(notFound).getByRole("heading", { name: "Artist not found" })).toBeInTheDocument();
    // A way back, and a retry, because the resolution may have failed
    // transiently upstream.
    expect(within(notFound).getByRole("link", { name: "Back to Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(notFound).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a 200 body that resolved nothing as the same not-found state", async () => {
    // The API contract already answers `unresolvable` here; the page's job is to
    // render one honest state for "no artist here", not a resolved identity with
    // three empty sections.
    stubArtist(() => ({ resolve: { ...DEFAULT_RESOLUTION, tracks: [] } }));
    render(<ArtistView artistKey="Nobody At All" />);

    expect(await screen.findByTestId("artist-not-found")).toBeInTheDocument();
    expect(screen.queryByTestId("artist-error")).not.toBeInTheDocument();
  });

  it("recovers from the not-found state on retry", async () => {
    stubArtist((call) =>
      call === 0 ? { fail: 404, code: "unresolvable" } : { resolve: DEFAULT_RESOLUTION },
    );
    render(<ArtistView artistKey="Aurora" />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("artist-tracks")).toBeInTheDocument();
  });

  it("never requests a blank key and shows the same recoverable state", async () => {
    const { mock, calls } = stubArtist();
    render(<ArtistView artistKey="   " />);

    // A missing route parameter is not a request, it is a not-found page.
    expect(await screen.findByTestId("artist-not-found")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("ArtistPage route", () => {
  /**
   * `use(params)` suspends on the first render even for an already-resolved
   * promise, so the route is mounted behind a boundary here — the app root
   * provides one. Nothing about the page's own markup changes.
   */
  async function renderRoute(key: string) {
    const params = Promise.resolve({ key });
    await act(async () => {
      render(
        <Suspense fallback={<p>loading</p>}>
          <ArtistPage params={params} />
        </Suspense>,
      );
    });
  }

  it("keeps a single hidden heading above the view and passes the key through", async () => {
    stubArtist();
    await renderRoute("Aurora Sky");

    const heading = await screen.findByRole("heading", { level: 1, name: "Artist" });
    expect(heading).toHaveClass("sr-only");
    // The visible heading belongs to the view, once the name resolves.
    expect(await screen.findByRole("heading", { name: "Aurora" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // The route passes the segment through verbatim; the view classifies it.
    expect(screen.getByText("Artist • 2 songs")).toBeInTheDocument();
  });

  it("renders the not-found state for a blank key without a request", async () => {
    const { mock } = stubArtist();
    await renderRoute("");

    expect(await screen.findByTestId("artist-not-found")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });
});
