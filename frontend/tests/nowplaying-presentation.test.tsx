import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NowPlayingPage from "@/app/now-playing/page";
import type { Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetVideoModeStore, useVideoModeStore } from "@/stores/videoModeStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M9 task 5.3 (spec: `catalog` — "Now Playing presentation of the current
 * track"; design decisions 6 and 7).
 *
 * Three things are load-bearing here and each is pinned in both directions: the
 * artwork background appears with artwork and leaves *no* empty image box
 * without it; the long-title treatment animates only on overflow, is disabled
 * under `prefers-reduced-motion`, and always keeps the full title available; and
 * the surface keeps representing exactly the store state the player region does.
 *
 * jsdom performs no layout, so `scrollWidth`/`clientWidth` are stubbed per case
 * to make "the title overflows" a controlled input rather than an accident of
 * the environment. That is what lets the same suite assert the static and the
 * animated form deterministically.
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

const SHORT_TITLE = "Alpha";

const LONG_TITLE =
  "A Really Very Extremely Long Track Title That Cannot Possibly Fit Inside The Title Area";

/**
 * Read a real source file. The path is held in a variable so Vite's
 * `new URL("<literal>", …)` rewrite does not try to resolve it as an asset.
 */
function readStylesheet(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/** A track with artwork (the default fixture) and one without. */
const withArtwork = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: SHORT_TITLE,
  artists: [{ name: "Daft Punk" }],
  artwork: [{ url: "https://example.test/art.jpg" }],
});

const withoutArtwork = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: SHORT_TITLE,
  artists: [{ name: "Daft Punk" }],
  artwork: [],
});

/**
 * Make the title box report a given intrinsic text width against a given box
 * width, so the component's one measurement decides the branch deterministically.
 * `null` restores jsdom's zero-everything default.
 */
function stubTitleMeasurement(textWidth: number | null, boxWidth = 200): void {
  if (textWidth === null) {
    delete (Element.prototype as unknown as Record<string, unknown>).clientWidth;
    delete (Element.prototype as unknown as Record<string, unknown>).scrollWidth;
    return;
  }
  // The `<p>` is the box (`clientWidth`); the inner text span carries the
  // intrinsic width of one title copy (`scrollWidth`). Tag name disambiguates
  // the two, and the numbers are what decide the overflow branch.
  Object.defineProperty(Element.prototype, "clientWidth", {
    configurable: true,
    get(): number {
      return this.tagName === "P" ? boxWidth : 0;
    },
  });
  Object.defineProperty(Element.prototype, "scrollWidth", {
    configurable: true,
    get(): number {
      return this.tagName === "P" ? boxWidth : textWidth;
    },
  });
}

/** Report a `prefers-reduced-motion` preference for the whole test. */
function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

/** A `/api/similar` stub so the mounted shelf never reaches the network. */
function stubSimilar(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tracks: [], diagnostics: {} }),
    })),
  );
}

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
  stubSimilar();
});

afterEach(() => {
  stubTitleMeasurement(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Render the surface with `track` current and playback paused. */
function renderWith(track: Track = withArtwork) {
  usePlayerStore.getState().playTrack(track, [track]);
  usePlayerStore.getState().pause();
  return render(<NowPlayingPage />);
}

describe("Now Playing: the artwork-derived background", () => {
  it("renders a blurred backdrop behind the content when the track has artwork", () => {
    stubTitleMeasurement(null);
    renderWith();

    const background = screen.getByTestId("now-playing-background");
    expect(background.tagName).toBe("IMG");
    expect(background).toHaveAttribute("src", "https://example.test/art.jpg");
    // Decorative: never announced, never clickable, never a focusable stop.
    expect(background).toHaveAttribute("aria-hidden", "true");
    expect(background).toHaveAttribute("alt", "");
    expect(background.className).toContain("pointer-events-none");
    expect(background.className).toContain("blur-2xl");
    // Oversized and low-opacity, and behind everything else in the surface.
    expect(background.className).toContain("scale-110");
    expect(background.className).toContain("opacity-30");
    expect(background.className).toContain("-z-10");
  });

  it("changes when the track changes", () => {
    stubTitleMeasurement(null);
    const { rerender } = renderWith();
    expect(screen.getByTestId("now-playing-background")).toHaveAttribute(
      "src",
      "https://example.test/art.jpg",
    );

    const other = makeTrack({
      id: "youtube:ccc",
      providerId: "ccc",
      title: "Gamma",
      artists: [{ name: "Cobalt" }],
      artwork: [{ url: "https://example.test/other.jpg" }],
    });
    usePlayerStore.getState().playTrack(other, [other]);
    rerender(<NowPlayingPage />);

    expect(screen.getByTestId("now-playing-background")).toHaveAttribute(
      "src",
      "https://example.test/other.jpg",
    );
  });

  it("leaves the plain surface with no empty image box when the track has no artwork", () => {
    stubTitleMeasurement(null);
    const { container } = renderWith(withoutArtwork);

    expect(screen.queryByTestId("now-playing-background")).not.toBeInTheDocument();
    // No `<img>` anywhere — not a blank box, not a broken-image placeholder.
    expect(container.querySelectorAll("img")).toHaveLength(0);
    // The artwork tile keeps its monochrome placeholder.
    expect(container.querySelector('[class*="rounded-images"] svg')).not.toBeNull();
  });

  it("renders no background when nothing is playing", () => {
    stubTitleMeasurement(null);
    render(<NowPlayingPage />);

    expect(screen.queryByTestId("now-playing-background")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
  });
});

describe("Now Playing: the long-title treatment", () => {
  it("leaves a title that fits static, with the full string on the element", () => {
    stubTitleMeasurement(120);
    renderWith();

    const title = screen.getByTestId("now-playing-title");
    expect(title).toHaveTextContent(SHORT_TITLE);
    // Not animating, and no duplicated copy of the title.
    expect(title.querySelector(".now-playing-marquee")).toBeNull();
    expect(title.textContent).toBe(SHORT_TITLE);
    // The full string stays available however the box is styled.
    expect(title).toHaveAttribute("title", SHORT_TITLE);
    expect(title).toHaveAttribute("aria-label", SHORT_TITLE);
  });

  it("scrolls a duplicated title only once the title overflows", () => {
    stubTitleMeasurement(600);
    renderWith(
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: LONG_TITLE,
        artists: [{ name: "Daft Punk" }],
        artwork: [{ url: "https://example.test/art.jpg" }],
      }),
    );

    const title = screen.getByTestId("now-playing-title");
    const marquee = title.querySelector(".now-playing-marquee");
    expect(marquee).not.toBeNull();
    // Two copies of the title inside one track is what makes the loop seamless.
    expect(title.textContent).toBe(`${LONG_TITLE}${LONG_TITLE}`);
    // The duplicate is hidden from assistive tech, so the name stays one title.
    expect(marquee).toHaveAttribute("aria-hidden", "true");
    // The full string is still the element's accessible text and tooltip.
    expect(title).toHaveAttribute("title", LONG_TITLE);
    expect(title).toHaveAttribute("aria-label", LONG_TITLE);
  });

  it("re-measures on the next title and drops the animation when the new one fits", () => {
    stubTitleMeasurement(600);
    const { rerender } = renderWith(
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: LONG_TITLE,
        artists: [{ name: "Daft Punk" }],
        artwork: [{ url: "https://example.test/art.jpg" }],
      }),
    );
    expect(
      screen.getByTestId("now-playing-title").querySelector(".now-playing-marquee"),
    ).not.toBeNull();

    // A different track whose title fits: the measurement runs again, because
    // it is keyed on the title, and the scroll is dropped.
    stubTitleMeasurement(120);
    usePlayerStore.getState().playTrack(withArtwork, [withArtwork]);
    rerender(<NowPlayingPage />);

    const title = screen.getByTestId("now-playing-title");
    expect(title.querySelector(".now-playing-marquee")).toBeNull();
    expect(title).toHaveTextContent(SHORT_TITLE);
  });

  it("keeps the full title available when nothing is playing", () => {
    stubTitleMeasurement(120);
    render(<NowPlayingPage />);

    const title = screen.getByTestId("now-playing-title");
    expect(title).toHaveTextContent("Nothing playing");
    expect(title).toHaveAttribute("title", "Nothing playing");
    expect(title.querySelector(".now-playing-marquee")).toBeNull();
  });

  it("leaves the motion decision to the stylesheet, and keeps the title readable", async () => {
    // The motion preference is honoured in CSS (the global reduced-motion block
    // cancels `.now-playing-marquee`), so the *markup* is unchanged here: what
    // must hold is that the animated class is never paired with an inline
    // animation style the stylesheet cannot suppress, and that the full title is
    // always readable. jsdom applies no stylesheet, so the stylesheet half is
    // pinned against the real `globals.css` below.
    stubReducedMotion(true);
    stubTitleMeasurement(600);
    renderWith(
      makeTrack({
        id: "youtube:aaa",
        providerId: "aaa",
        title: LONG_TITLE,
        artists: [{ name: "Daft Punk" }],
        artwork: [{ url: "https://example.test/art.jpg" }],
      }),
    );

    const title = screen.getByTestId("now-playing-title");
    // No inline `animation` anywhere, so the stylesheet owns the motion
    // decision and the reduced-motion block can turn it off completely.
    expect(title.querySelector("[style*='animation']")).toBeNull();
    // Whatever the motion preference, the full title remains available as text.
    expect(title).toHaveAttribute("title", LONG_TITLE);
    expect(title).toHaveAttribute("aria-label", LONG_TITLE);
    expect(title.textContent).toContain(LONG_TITLE);
  });

  it("declares the marquee's motion — and cancels it under reduced motion", () => {
    // The stylesheet half of design decision 7, asserted against the real file
    // because jsdom resolves no cascade: the animation is a single named
    // keyframe rule, and the project's existing reduced-motion block switches it
    // off rather than merely shortening it.
    const globalsCss = readStylesheet("../src/app/globals.css");

    expect(globalsCss).toMatch(/@keyframes\s+spotivibe-marquee\s*\{/);
    expect(globalsCss).toMatch(/animation:\s*spotivibe-marquee\s/);
    // One copy's width per cycle: the seamless -50% over a two-copy track.
    expect(globalsCss).toMatch(/translateX\(-50%\)/);

    // Everything after the media query is inside it — it is the last block in
    // the file, so the slice is the reduced-motion rule set verbatim.
    const reducedMotion = globalsCss.slice(
      globalsCss.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reducedMotion).toMatch(/\.now-playing-marquee\s*\{[^}]*animation:\s*none\s*!important/);
  });
});

describe("Now Playing: the More Like This shelf", () => {
  it("mounts the shelf below the transport area for the current track", async () => {
    stubTitleMeasurement(120);
    renderWith();

    const shelf = await screen.findByTestId("more-like-this");
    expect(shelf).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "More Like This" })).toBeInTheDocument();
  });

  it("renders the shelf inside the surface's own bottom padding", () => {
    stubTitleMeasurement(null);
    const { container } = renderWith();

    const root = container.firstElementChild as HTMLElement;
    // The same padding that keeps content clear of the persistent player region,
    // so the shelf clears it too. The values shrank when the docked video surface
    // was removed: the player bar is 72px and the compact stack 120px, and there
    // is no longer a floating video above them to reserve room for.
    expect(root.className).toContain("pb-[132px]");
    expect(root.className).toContain("lg:pb-[104px]");
    // Explicitly not the old docked-surface padding: a value that happens to
    // still pass is worse than one that cannot.
    expect(root.className).not.toContain("pb-[320px]");
    expect(root.className).not.toContain("lg:pb-56");
    expect(root.querySelector('[data-testid="more-like-this"]')).not.toBeNull();
  });

  it("renders no shelf when no track is playing", () => {
    stubTitleMeasurement(null);
    render(<NowPlayingPage />);

    expect(screen.queryByTestId("more-like-this")).not.toBeInTheDocument();
  });
});

describe("Now Playing: the existing surface contract is unchanged", () => {
  it("keeps every control, its accessible name, and the YouTube attribution", () => {
    stubTitleMeasurement(120);
    renderWith();

    expect(screen.getByRole("heading", { level: 1, name: "Now Playing" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close Now Playing" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Daft Punk")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Save to Liked Songs" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Previous track" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Queue" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Shuffle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Repeat: Off" })).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Track progress" })).toHaveAttribute(
      "aria-valuemax",
      "249",
    );

    // The video-mode control is the new entry point; the watch link is shown
    // beside it only while the video is actually visible.
    const videoMode = screen.getByTestId("now-playing-video-mode");
    expect(videoMode).toBeEnabled();
    expect(screen.queryByTestId("now-playing-attribution")).toBeNull();

    act(() => useVideoModeStore.getState().setVisible(true));

    // The compliant watch link: no referrer suppression, still required.
    const link = screen.getByTestId("now-playing-attribution");
    expect(link).toHaveTextContent("Watch on YouTube");
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=aaa");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    expect(link).not.toHaveAttribute("referrerPolicy");
  });

  it("still shows the idle placeholders with disabled controls", () => {
    stubTitleMeasurement(120);
    render(<NowPlayingPage />);

    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
    expect(screen.getByText("Choose something to start")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next track" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save to Liked Songs" })).toBeDisabled();
    expect(screen.queryByTestId("now-playing-attribution")).not.toBeInTheDocument();
    // Nothing to show, so the video control is omitted rather than disabled —
    // offering an action the surface cannot perform is worse than not offering it.
    expect(screen.queryByTestId("now-playing-video-mode")).not.toBeInTheDocument();
  });

  it("reflects a track change anywhere in the app without a remount", async () => {
    stubTitleMeasurement(120);
    const { rerender } = renderWith();

    const other = makeTrack({
      id: "youtube:ddd",
      providerId: "ddd",
      title: "Delta",
      artists: [{ name: "Cobalt" }],
      artwork: [{ url: "https://example.test/delta.jpg" }],
    });
    // The queue advances playback; the surface is never re-created.
    await act(async () => {
      usePlayerStore.getState().playTrack(other, [other]);
    });
    rerender(<NowPlayingPage />);

    expect(screen.getByTestId("now-playing-title")).toHaveTextContent("Delta");
    expect(screen.getByText("Cobalt")).toBeInTheDocument();
    // The watch link follows the track change, so it is asserted in video mode —
    // the state in which the surface renders it at all.
    act(() => useVideoModeStore.getState().setVisible(true));
    expect(screen.getByTestId("now-playing-attribution")).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=ddd",
    );
  });

  it("reflects a like written by another surface without a remount", async () => {
    stubTitleMeasurement(120);
    renderWith();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save to Liked Songs" })).toBeEnabled(),
    );
    await act(async () => {
      await useLibraryStore.getState().toggleLike(withArtwork);
    });

    const remove = await screen.findByRole("button", { name: "Remove from Liked Songs" });
    expect(remove.querySelector("svg")?.getAttribute("class")).toContain("fill-current");
    expect(await repositories.likedTracks.isLiked(withArtwork.id)).toBe(true);
  });
});
