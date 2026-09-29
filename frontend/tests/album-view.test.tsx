import "fake-indexeddb/auto";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AlbumPage from "@/app/album/[key]/page";
import { getLocalData, type RepositorySet } from "@/data/localData";
import type { Track } from "@/data/repositories";
import { AlbumView } from "@/features/album/AlbumView";
import { ALBUM_ENDPOINT } from "@/features/album/albumApi";
import { makeTrack } from "./helpers/music-fixtures";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";

/**
 * M9 task 4.2 (spec: `catalog` — "Album page"; design §1/§2/§3).
 *
 * The four designed states, the release hero and its optional metadata, the
 * **resolved** track order, the playback context play and shuffle adopt, per-row
 * like through the real repository, the add-to-playlist path through the
 * existing M7 picker (including its duplicate rule), the `metadataIncomplete`
 * notice in both directions, the artist link target, and the two negatives the
 * spec makes load-bearing: nothing autoplays on open, and an unconfirmed list is
 * never presented as a tracklist.
 */

// Cold fake-indexeddb hydration plus a resolution round trip can exceed 1s.
configure({ asyncUtilTimeout: 5000 });

// The artist link, the not-found way back, and the picker all navigate or focus
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

/**
 * Deliberately *not* in alphabetical or quality order: the page renders the
 * server's resolved order, so a re-sort anywhere in the chain would show up here.
 */
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
  artists: [{ name: "Aurora" }],
  album: { title: "Dawn Chorus" },
});
const gamma = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "Gamma",
  artists: [{ name: "Aurora" }],
  album: { title: "Dawn Chorus" },
});

const RELEASE_ID = "UCdawnrelease0000000000";

/** The resolved release, overridable per test. */
interface Resolution {
  album?: Record<string, unknown>;
  tracks?: Track[];
  metadataIncomplete?: boolean;
}

const DEFAULT_RESOLUTION: Required<Resolution> = {
  album: {
    id: RELEASE_ID,
    title: "Dawn Chorus",
    artistName: "Aurora",
    artworkUrl: "https://example.test/dawn.jpg",
  },
  // Resolved order, not a re-sorted one.
  tracks: [gamma, alpha, beta],
  metadataIncomplete: false,
};

type Reply = { resolve: Required<Resolution> } | { fail: number; code: string } | { hang: true };

interface Recorded {
  url: URL;
}

function stubAlbum(reply: (call: number) => Reply = () => ({ resolve: DEFAULT_RESOLUTION })) {
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
    const { album, tracks, metadataIncomplete } = outcome.resolve;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ album, tracks, metadataIncomplete, diagnostics: {} }),
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

/** The titles rendered in the track list, in DOM order. */
function renderedTitles(): string[] {
  return within(screen.getByTestId("album-tracks"))
    .getAllByRole("button", { name: /^Play / })
    .map((button) => button.getAttribute("aria-label")?.replace("Play ", "") ?? "");
}

/**
 * The **ready** track section. The loading state renders a section with the same
 * test id, so waiting for a resolved track title first is what makes this the
 * element that will still hold the rows once the retry/replace has settled.
 */
async function readyTracks(): Promise<HTMLElement> {
  await screen.findByText("Alpha");
  return screen.getByTestId("album-tracks");
}

describe("AlbumView: the loading state", () => {
  it("renders skeletons rather than a blank region while the resolution is in flight", async () => {
    stubAlbum(() => ({ hang: true }));
    render(<AlbumView albumKey="Dawn Chorus" />);

    expect(screen.getByTestId("album-view")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("album-loading")).toBeInTheDocument());
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
    // The track section is announced but holds placeholders, not results.
    expect(screen.getByTestId("album-tracks")).toBeInTheDocument();
    expect(screen.queryByTestId("album-metadata-incomplete")).not.toBeInTheDocument();
  });

  it("issues one request, carrying only the identifier", async () => {
    const { calls } = stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus - Aurora" />);
    await screen.findByText("Alpha");

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe(ALBUM_ENDPOINT);
    // No liked-track, playlist, or history parameter — the release is the whole
    // request (spec: "Requests carry only the identifier").
    expect([...calls[0].url.searchParams.keys()].sort()).toEqual(["artist", "title"]);
    expect(calls[0].url.searchParams.get("title")).toBe("Dawn Chorus");
    expect(calls[0].url.searchParams.get("artist")).toBe("Aurora");
  });

  it("requests a provider id as `id`", async () => {
    const { calls } = stubAlbum();
    render(<AlbumView albumKey={RELEASE_ID} />);
    await screen.findByText("Alpha");

    expect([...calls[0].url.searchParams.keys()]).toEqual(["id"]);
  });
});

describe("AlbumView: the ready state", () => {
  it("renders the release hero, the artist link, and the available metadata", async () => {
    stubAlbum();
    const { container } = render(<AlbumView albumKey="Dawn Chorus - Aurora" />);

    const view = screen.getByTestId("album-view");
    expect(await within(view).findByRole("heading", { name: "Dawn Chorus" })).toBeInTheDocument();
    expect(screen.getByText("Album • 3 songs")).toBeInTheDocument();
    // DESIGN.md "Square Album Card": a 1:1 cover at the 6px content radius.
    const cover = screen.getByTestId("album-cover");
    expect(cover.querySelector("img")).toHaveAttribute("src", "https://example.test/dawn.jpg");
    expect(cover.className).toContain("rounded-cards");

    // The artist is the release's other identity and is reachable from here.
    const artist = screen.getByTestId("album-artist-link");
    expect(artist).toHaveTextContent("Aurora");
    expect(artist).toHaveAttribute("href", "/artist/Aurora");

    // One release, one resolution.
    expect(container.querySelectorAll("[data-testid='album-view']")).toHaveLength(1);
  });

  it("renders the tracks in the order the API returned them, never re-sorted", async () => {
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    await screen.findByText("Alpha");
    expect(renderedTitles()).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it("omits metadata the resolution did not carry instead of inventing it", async () => {
    // The id-only shape: no cover, no artist, no year, always incomplete.
    stubAlbum(() => ({
      resolve: { album: { title: "Dawn Chorus" }, tracks: [alpha], metadataIncomplete: true },
    }));
    const { container } = render(<AlbumView albumKey={RELEASE_ID} />);

    expect(await screen.findByRole("heading", { name: "Dawn Chorus" })).toBeInTheDocument();
    // The placeholder cover replaces the image, so no empty/broken box renders.
    const cover = screen.getByTestId("album-cover");
    expect(cover.querySelector("img")).toBeNull();
    expect(cover.querySelector("svg")).not.toBeNull();
    // No artist to link to, and the meta line claims only what resolved.
    expect(screen.queryByTestId("album-artist-link")).not.toBeInTheDocument();
    expect(screen.getByText("Album • 1 song")).toBeInTheDocument();
    expect(container.textContent).not.toContain("undefined");
  });

  it("shows a release year when the resolution carried one", async () => {
    stubAlbum(() => ({
      resolve: {
        ...DEFAULT_RESOLUTION,
        album: { ...DEFAULT_RESOLUTION.album, year: 2019 },
      },
    }));
    render(<AlbumView albumKey="Dawn Chorus" />);

    expect(await screen.findByText("Album • 3 songs • 2019")).toBeInTheDocument();
  });

  it("uses the DESIGN.md square-cover geometry and never autoplays on open", async () => {
    stubAlbum();
    const { container } = render(<AlbumView albumKey="Dawn Chorus" />);
    await screen.findByText("Alpha");

    expect(container.querySelector("[data-testid='album-cover']")).not.toBeNull();

    // Opening a release never starts playback (spec: activation only).
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(usePlayerStore.getState().status).toBe("idle");
    expect(usePlayerStore.getState().loadRequest).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
    expect(useQueueStore.getState().source).not.toBe("browse");
  });

  it("keeps every control keyboard operable with an accessible name", async () => {
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);
    await screen.findByText("Alpha");

    const controls = screen.getAllByRole("button").concat(screen.getAllByRole("link"));
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      // A real interactive element with a real name, and no focus-ring removal:
      // the design system relies on the global `:focus-visible` outline.
      expect(["BUTTON", "A"]).toContain(control.tagName);
      expect(control.getAttribute("aria-label") ?? control.textContent ?? "").not.toBe("");
      expect(control.className).not.toMatch(/outline-none/);
    }
  });
});

describe("AlbumView: the metadataIncomplete notice (design §3)", () => {
  it("says the track list could not be confirmed and still shows the tracks", async () => {
    stubAlbum(() => ({
      resolve: { ...DEFAULT_RESOLUTION, metadataIncomplete: true },
    }));
    render(<AlbumView albumKey="Dawn Chorus" />);

    const notice = await screen.findByTestId("album-metadata-incomplete");
    expect(notice).toHaveTextContent("Track list not confirmed");
    expect(notice).toHaveTextContent("may be incomplete or approximate");
    // The tracks are still there — the notice qualifies them, it does not hide
    // them.
    expect(renderedTitles()).toEqual(["Gamma", "Alpha", "Beta"]);
    // It is a status, not a failure: the page did not error.
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("makes no completeness claim when the release metadata was confirmed", async () => {
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    await screen.findByText("Alpha");
    expect(screen.queryByTestId("album-metadata-incomplete")).not.toBeInTheDocument();
    expect(screen.getByTestId("album-tracks")).toHaveTextContent("Alpha");
  });

  it("commits the completeness flag so the notice and the flag can be checked against each other", async () => {
    // The flag is also an evidence affordance: the browser run asserts that the
    // committed attribute and the rendered notice agree, instead of inferring one
    // from the other.
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);
    await screen.findByText("Alpha");
    expect(screen.getByTestId("album-view")).toHaveAttribute("data-metadata-incomplete", "false");

    cleanup();
    stubAlbum(() => ({
      resolve: { ...DEFAULT_RESOLUTION, metadataIncomplete: true },
    }));
    render(<AlbumView albumKey="Dawn Chorus" />);
    await screen.findByText("Alpha");
    expect(screen.getByTestId("album-view")).toHaveAttribute("data-metadata-incomplete", "true");
    expect(screen.getByTestId("album-metadata-incomplete")).toBeInTheDocument();
  });

  it("never shows a provider release id as the release title", async () => {
    // C1: a search album tile whose release carries a provider id mints
    // `/album/<id>`, the resolution cannot confirm that id, and the old code
    // echoed the id back as the title — so the page's heading read
    // `MPREb_eEpQf8QskKl`. An unconfirmed release now shows neutral copy and the
    // unconfirmed-tracklist notice instead.
    stubAlbum(() => ({
      resolve: {
        ...DEFAULT_RESOLUTION,
        album: { id: "MPREb_eEpQf8QskKl", artistName: "Aurora" },
        metadataIncomplete: true,
      },
    }));
    render(<AlbumView albumKey="MPREb_eEpQf8QskKl" />);

    await screen.findByText("Alpha");
    const view = screen.getByTestId("album-view");
    expect(view).not.toHaveTextContent("MPREb_eEpQf8QskKl");
    expect(within(view).getByRole("heading", { name: "Unconfirmed release" })).toBeInTheDocument();
    // The resolved tracks are still offered, behind the honest notice.
    expect(screen.getByTestId("album-metadata-incomplete")).toBeInTheDocument();
    expect(screen.getByTestId("album-tracks")).toHaveTextContent("Alpha");
  });
});

describe("AlbumView: playing the album", () => {
  it("plays the first track with the whole album as its context", async () => {
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    fireEvent.click(await screen.findByTestId("album-play"));

    expect(usePlayerStore.getState().currentTrack?.id).toBe(gamma.id);
    // The whole album is the context, so the release plays through.
    expect(queueIds()).toEqual([gamma.id, alpha.id, beta.id]);
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(useQueueStore.getState().source).toBe("browse");
    // Plain play never turns shuffle on.
    expect(useQueueStore.getState().shuffle).toBe(false);
  });

  it("shuffles with the whole album as the context and the same first track", async () => {
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    fireEvent.click(await screen.findByTestId("album-shuffle"));

    expect(useQueueStore.getState().shuffle).toBe(true);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(gamma.id);
    expect(queueIds()).toEqual([gamma.id, alpha.id, beta.id]);
    expect(useQueueStore.getState().queueIndex).toBe(0);
    expect(useQueueStore.getState().source).toBe("browse");
    // Shuffle is *ensured on*, not toggled: the context still lists the album in
    // resolved order and only the traversal is permuted.
    expect(useQueueStore.getState().playOrder[0]).toBe(0);
  });

  it("plays a row with the whole album as its context", async () => {
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    const tracks = await readyTracks();
    fireEvent.click(await within(tracks).findByRole("button", { name: "Play Beta" }));

    expect(usePlayerStore.getState().currentTrack?.id).toBe(beta.id);
    expect(queueIds()).toEqual([gamma.id, alpha.id, beta.id]);
    expect(useQueueStore.getState().queueIndex).toBe(2);
  });
});

describe("AlbumView: liking a track", () => {
  it("persists a per-row like through the library and flips the row's state", async () => {
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    const tracks = await readyTracks();
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
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    const tracks = await readyTracks();
    fireEvent.click(
      await within(tracks).findByRole("button", { name: "Save Beta to Liked Songs" }),
    );

    await waitFor(() => expect(repositories.likedTracks.isLiked(beta.id)).resolves.toBe(true));
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
  });
});

describe("AlbumView: adding a track to a local playlist", () => {
  it("opens the existing picker and appends the track through the store", async () => {
    const playlist = await repositories.playlists.create({ name: "Road Trip" });
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    const tracks = await readyTracks();
    fireEvent.click(await within(tracks).findByRole("button", { name: "Add Beta to a playlist" }));

    // The M7 picker, not a second one: same dialog, same accessible name.
    const picker = await screen.findByRole("dialog", { name: "Add to playlist" });
    // The picker hydrates the library itself, so the list arrives a tick later.
    fireEvent.click(await within(picker).findByRole("button", { name: "Road Trip" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const stored = await repositories.playlists.get(playlist.id);
    expect(stored?.tracks.map((entry) => entry.track.id)).toEqual([beta.id]);
  });

  it("keeps the M7 duplicate rule unchanged: an existing member is reported, not added", async () => {
    const playlist = await repositories.playlists.create({ name: "Road Trip" });
    await repositories.playlists.addTrack(playlist.id, beta);
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    const tracks = await readyTracks();
    fireEvent.click(await within(tracks).findByRole("button", { name: "Add Beta to a playlist" }));

    const picker = await screen.findByRole("dialog", { name: "Add to playlist" });
    fireEvent.click(await within(picker).findByRole("button", { name: "Road Trip" }));

    // The picker reports it and stays open; membership is unchanged.
    expect(await within(picker).findByRole("status")).toHaveTextContent("Already in playlist");
    const stored = await repositories.playlists.get(playlist.id);
    expect(stored?.tracks).toHaveLength(1);
  });

  it("adds to a playlist created inline, and closes on dismissal", async () => {
    stubAlbum();
    render(<AlbumView albumKey="Dawn Chorus" />);

    const tracks = await readyTracks();
    fireEvent.click(await within(tracks).findByRole("button", { name: "Add Alpha to a playlist" }));

    const picker = await screen.findByRole("dialog", { name: "Add to playlist" });
    fireEvent.change(screen.getByLabelText("New playlist"), {
      target: { value: "Late Night" },
    });
    fireEvent.click(within(picker).getByRole("button", { name: "Create and add" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await act(async () => {
      await useLibraryStore.getState().hydrate();
    });
    const created = useLibraryStore
      .getState()
      .playlists.find((entry) => entry.name === "Late Night");
    expect(created?.tracks.map((entry) => entry.track.id)).toEqual([alpha.id]);
  });
});

describe("AlbumView: a failing resolution", () => {
  it("shows a retryable error for an unavailable upstream and recovers on retry", async () => {
    stubAlbum((call) =>
      call === 0 ? { fail: 503, code: "upstream_unavailable" } : { resolve: DEFAULT_RESOLUTION },
    );
    render(<AlbumView albumKey="Dawn Chorus" />);

    const failure = await screen.findByTestId("album-error");
    const alert = await within(failure).findByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "This release didn't load" }),
    ).toBeInTheDocument();
    expect(alert).toHaveTextContent("Check your connection and try again.");
    // A failure renders the error, never an empty release page.
    expect(screen.queryByTestId("album-tracks")).not.toBeInTheDocument();

    fireEvent.click(within(failure).getByRole("button", { name: "Retry" }));

    // Waited on resolved *content*, not on the section's test id: the loading
    // placeholder carries the same id and is replaced once the retry settles.
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByTestId("album-tracks")).toBeInTheDocument();
    expect(screen.queryByTestId("album-error")).not.toBeInTheDocument();
  });

  it("shows a retryable error for a transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    render(<AlbumView albumKey="Dawn Chorus" />);

    const failure = await screen.findByTestId("album-error");
    expect(within(failure).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("does not send the user to check a connection when the key itself was rejected", async () => {
    // The invalid-request copy used to be unreachable: the code was classified as
    // retryable, so a rejected key showed "check your connection" — advice about a
    // connection that was never the problem.
    stubAlbum(() => ({ fail: 400, code: "invalid_request" }));
    render(<AlbumView albumKey="Dawn Chorus" />);

    const failure = await screen.findByTestId("album-error");
    const text = failure.textContent ?? "";
    expect(text).toMatch(/try another release/i);
    expect(text).not.toMatch(/connection/i);
  });
});

describe("AlbumView: an unresolvable release key", () => {
  it("shows a recoverable not-found state with a way back, not an error", async () => {
    stubAlbum(() => ({ fail: 404, code: "unresolvable" }));
    render(<AlbumView albumKey="Nobody At All" />);

    const notFound = await screen.findByTestId("album-not-found");
    expect(
      within(notFound).getByRole("heading", { name: "Release not found" }),
    ).toBeInTheDocument();
    // A way back, and a retry, because the resolution may have failed
    // transiently upstream.
    expect(within(notFound).getByRole("link", { name: "Back to Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(within(notFound).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a 200 body with no tracks as the same not-found state", async () => {
    // The API contract already answers `unresolvable` here; the page's job is to
    // render one honest state for "no release here", not a hero over nothing.
    stubAlbum(() => ({ resolve: { ...DEFAULT_RESOLUTION, tracks: [] } }));
    render(<AlbumView albumKey="Nobody At All" />);

    expect(await screen.findByTestId("album-not-found")).toBeInTheDocument();
    expect(screen.queryByTestId("album-error")).not.toBeInTheDocument();
  });

  it("recovers from the not-found state on retry", async () => {
    stubAlbum((call) =>
      call === 0 ? { fail: 404, code: "unresolvable" } : { resolve: DEFAULT_RESOLUTION },
    );
    render(<AlbumView albumKey="Dawn Chorus" />);

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    expect(screen.getByTestId("album-tracks")).toBeInTheDocument();
    expect(screen.queryByTestId("album-not-found")).not.toBeInTheDocument();
  });

  it("never requests a blank key and shows the same recoverable state", async () => {
    const { mock, calls } = stubAlbum();
    render(<AlbumView albumKey="   " />);

    // A missing route parameter is not a request, it is a not-found page.
    expect(await screen.findByTestId("album-not-found")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("AlbumPage route", () => {
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
          <AlbumPage params={params} />
        </Suspense>,
      );
    });
  }

  it("keeps a single hidden heading above the view and passes the key through", async () => {
    const { calls } = stubAlbum();
    await renderRoute("Dawn Chorus - Aurora");

    const heading = await screen.findByRole("heading", { level: 1, name: "Album" });
    expect(heading).toHaveClass("sr-only");
    // The visible heading belongs to the view, once the title resolves.
    expect(await screen.findByRole("heading", { name: "Dawn Chorus" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    // The route passes the segment through verbatim; the view classifies it.
    expect(calls[0].url.searchParams.get("title")).toBe("Dawn Chorus");
    expect(calls[0].url.searchParams.get("artist")).toBe("Aurora");
  });

  it("renders the not-found state for a blank key without a request", async () => {
    const { mock } = stubAlbum();
    await renderRoute("");

    expect(await screen.findByTestId("album-not-found")).toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });
});
