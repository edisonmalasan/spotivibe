import "fake-indexeddb/auto";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NowPlayingPage from "@/app/now-playing/page";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetLibraryStore } from "@/stores/libraryStore";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetVideoModeStore } from "@/stores/videoModeStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * Lyrics inside the Now Playing surface (spec `app-shell` — "Lyrics never displace or delay the rest
 * of the surface"; spec `lyrics`).
 *
 * This is the scenario that a lyrics panel can pass every dedicated test and still fail: a panel
 * that pushes the transport off-screen, or that gates the transport behind its own loading state,
 * satisfies every lyrics requirement and still breaks the surface. So the transport, the artwork,
 * the title, and the queue access are asserted present **in each lyrics state**, not once.
 */

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: vi.fn(), forward: vi.fn(), push, replace: vi.fn() }),
}));

let repositories: RepositorySet;

beforeEach(async () => {
  resetPlayerStore();
  resetLibraryStore();
  resetVideoModeStore();
  localStorage.clear();
  clearPlaybackBridge();
  push.mockClear();
  repositories = await getLocalData();
  await repositories.resetAll();
});

/** Answer every lyrics request with `body` and the given status. */
function answerLyrics(body: unknown, status = 200) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/lyrics") {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ tracks: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

/** Hold the lyrics request open, so the panel is observably in its loading state. */
function stallLyrics() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    new URL(String(input), "http://localhost").pathname === "/api/lyrics"
      ? new Promise<Response>(() => undefined)
      : Promise.resolve(
          new Response(JSON.stringify({ tracks: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
  );
}

/**
 * Everything on the surface that must survive whatever the lyrics are doing.
 *
 * The transport button is matched by `/Play|Pause/` rather than by one name, because the control is
 * a toggle and the test arranges a *playing* track. Asserting the literal "Play" here would fail for
 * a reason that has nothing to do with lyrics, which is how a genuine regression gets dismissed as a
 * test bug.
 *
 * **Enabled, not merely present.** A lyrics panel that rendered over the surface, or that disabled
 * the transport while its own request was in flight, would satisfy a presence-only assertion — and
 * the second is a plausible thing for someone to build, since "don't let lyrics interfere with
 * playback" invites a guard that is too broad.
 */
function expectSurfaceIntact() {
  expect(screen.getByRole("heading", { level: 1, name: "Now Playing" })).toBeInTheDocument();
  expect(screen.getByTestId("now-playing-title")).toBeInTheDocument();
  const transport = screen.getByRole("button", { name: /^(Play|Pause)$/ });
  expect(transport).toBeInTheDocument();
  expect(transport).toBeEnabled();
  for (const name of ["Previous track", "Next track", "Queue"]) {
    expect(screen.getByRole("button", { name })).toBeEnabled();
  }
  // Progress and volume are both sliders; asserting one exists rather than which, because their
  // order is not a promise this milestone makes.
  expect(screen.getAllByRole("slider").length).toBeGreaterThanOrEqual(1);
  expect(screen.getByRole("link", { name: "Close Now Playing" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "More Like This" })).toBeInTheDocument();
}

function playTrack(providerId = "aaaaaaaaaaa") {
  act(() => {
    usePlayerStore.setState({
      currentTrack: makeTrack({ providerId, title: "A Song" }),
      status: "playing",
      positionSeconds: 0,
    });
  });
}

describe("Now Playing with lyrics", () => {
  it("renders no lyrics panel at all with no current track", () => {
    render(<NowPlayingPage />);
    expect(screen.queryByTestId("lyrics-panel")).toBeNull();
    // The surface is unchanged from before this milestone.
    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
  });

  it("keeps the whole surface intact while lyrics are loading", async () => {
    stallLyrics();
    playTrack();
    render(<NowPlayingPage />);

    await screen.findByTestId("lyrics-loading");
    expectSurfaceIntact();
  });

  it("keeps the whole surface intact when lyrics are unavailable", async () => {
    answerLyrics({ status: "unavailable" });
    playTrack();
    render(<NowPlayingPage />);

    await screen.findByTestId("lyrics-unavailable");
    expectSurfaceIntact();
  });

  it("keeps the whole surface intact when lyrics fail", async () => {
    answerLyrics({ error: { code: "upstream_unavailable" } }, 503);
    playTrack();
    render(<NowPlayingPage />);

    await screen.findByTestId("lyrics-error");
    expectSurfaceIntact();
  });

  it("keeps the whole surface intact when lyrics are populated", async () => {
    answerLyrics({ status: "ok", syncedLyrics: "[00:00]one\n[00:10]two", plainLyrics: null });
    playTrack();
    render(<NowPlayingPage />);

    await waitFor(() => expect(screen.getAllByTestId("lyrics-line")).toHaveLength(2));
    expectSurfaceIntact();
  });

  it("still offers the radio and video controls once lyrics are present", async () => {
    // Both are omitted when there is no track, and both were asserted as present in the pre-lyrics
    // surface. A lyrics panel that rendered over the surface would leave them unreachable.
    answerLyrics({ status: "ok", syncedLyrics: "[00:00]one", plainLyrics: null });
    playTrack();
    render(<NowPlayingPage />);

    await waitFor(() => expect(screen.getAllByTestId("lyrics-line")).toHaveLength(1));
    expect(screen.getByTestId("now-playing-radio")).toBeInTheDocument();
    expect(screen.getByTestId("now-playing-video-mode")).toBeInTheDocument();
  });

  it("does not overlay the player region: the lyrics panel is a sibling, not a fixed layer", () => {
    answerLyrics({ status: "ok", syncedLyrics: "[00:00]one", plainLyrics: null });
    playTrack();
    render(<NowPlayingPage />);

    // Asserted on the **wrapper**, not on the inner panel. Position comes from the element the page
    // places, so a `fixed` wrapper added in `page.tsx` would sail past an assertion that only reads
    // `LyricsPanel`'s own className — which is what the first version of this test did, and the
    // induced violation confirmed it: the violation changed the panel's class and the test caught it,
    // so nothing covered the more likely place for the bug.
    const slot = screen.getByTestId("now-playing-lyrics-slot");
    expect(slot.className).not.toContain("fixed");
    expect(slot.className).not.toContain("absolute");
    expect(screen.getByTestId("lyrics-panel").className).not.toContain("fixed");
  });

  it("bounds the lyrics slot's height, so a long track cannot push the shelf off screen", () => {
    // A track with eighty lyric lines in an auto-height column pushes More Like This out of view,
    // which is the failure the `app-shell` requirement exists to prevent. `40vh` is the cap.
    answerLyrics({ status: "ok", syncedLyrics: "[00:00]one", plainLyrics: null });
    playTrack();
    render(<NowPlayingPage />);

    expect(screen.getByTestId("now-playing-lyrics-slot").className).toContain("max-h-[40vh]");
  });

  it("renders the lyrics panel for the track that is actually playing", async () => {
    answerLyrics({ status: "ok", syncedLyrics: "[00:00]one", plainLyrics: null });
    playTrack("aaaaaaaaaaa");
    render(<NowPlayingPage />);
    await waitFor(() => expect(screen.getAllByTestId("lyrics-line")).toHaveLength(1));

    answerLyrics({ status: "ok", syncedLyrics: "[00:00]a\n[00:05]b", plainLyrics: null });
    act(() => {
      usePlayerStore.setState({ currentTrack: makeTrack({ providerId: "bbbbbbbbbbb" }) });
    });

    await waitFor(() => expect(screen.getAllByTestId("lyrics-line")).toHaveLength(2));
  });
});
