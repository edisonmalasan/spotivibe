import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NowPlayingPage from "@/app/now-playing/page";
import { AlbumCard } from "@/components/design-system/AlbumCard";
import { ArtistCard } from "@/components/design-system/ArtistCard";
import { Button } from "@/components/design-system/Button";
import { Dialog } from "@/components/design-system/Dialog";
import { MiniPlayer } from "@/components/layout/MiniPlayer";
import { PlayerBar } from "@/components/layout/PlayerBar";
import { Shelf } from "@/components/recommendations/Shelf";
import type { Track } from "@/data/repositories";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { HomeView } from "@/features/home/HomeView";
import { ShelfTrackCard } from "@/features/home/ShelfTrackCard";
import { TopResultCard } from "@/features/search/TopResultCard";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetMixStore, useMixStore } from "@/stores/mixStore";
import { clearPlaybackBridge, resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { resetQueueStore } from "@/stores/queueStore";
import { resetVideoModeStore } from "@/stores/videoModeStore";
import { MOTION_CLASS } from "@/styles/motionTokens";
import { makeTrack } from "./helpers/music-fixtures";

// Keep the literal in a variable — Vite rewrites an inline `new URL("<literal>", import.meta.url)`
// into a non-`file:` URL under the jsdom environment, and `fileURLToPath` rejects it.
const motionCssRel = "../src/styles/motion.css";
const vocabularyCss = readFileSync(fileURLToPath(new URL(motionCssRel, import.meta.url)), "utf8");

/**
 * M19 tasks 2.3 and 3.1–3.5: the motion the milestone adds, asserted where it lands.
 *
 * `motion-vocabulary.test.ts` proves the *rules*; this file proves the *effects*. Every
 * check here renders the real component, because the claims are about surfaces: a card
 * carries the transition, a dialog carries both halves of its enter and leave, Home's
 * presented content changes without a blank frame, and every affected control still works.
 *
 * **A harness would prove nothing here.** An earlier draft of this file rendered local
 * stand-ins shaped like `PlayerBar` and `HomeView`; every assertion passed while the real
 * components could have lost their motion entirely, which is the specific failure the
 * M16–M18 detectors exist to prevent. So `PlayerBar`, `MiniPlayer`, and `HomeView` are
 * rendered directly, and their stores are seeded rather than their markup re-created.
 *
 * **What this cannot see, and says so rather than implying otherwise.** jsdom resolves no
 * cascade, so nothing here observes a computed duration, a painted frame, or a media query
 * resolving. Every assertion is about what a surface declares and renders. Whether a
 * transition looks right at either viewport needs a browser, and this repository has none.
 */

// Cold renders plus awaited shelves exceed the 1s default (the M8 precedent).
configure({ asyncUtilTimeout: 5000 });

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
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

/** One credited track, built by the shared fixture rather than by hand. */
function track(overrides: Partial<Track> & { id: string }): Track {
  return makeTrack({
    providerId: overrides.id.replace("youtube:", ""),
    artists: [{ name: "Aurora" }],
    ...overrides,
  });
}

const TRACK = track({ id: "youtube:aaa", title: "Alpha" });

/** Every motion class the vocabulary owns. */
const CLASSES = Object.values(MOTION_CLASS);

/** Assert that an element carries a vocabulary motion class. */
function carriesMotion(element: Element, expected: string, context: string): void {
  const className = typeof element.className === "string" ? element.className : "";
  const held = CLASSES.filter((name) => className.includes(name));
  expect(held, `${context} must carry ${expected}`).toContain(expected);
}

/** The classes on an element, as a list, for a failure that has to name them. */
function classesOf(element: Element): string {
  return typeof element.className === "string" ? element.className : "<svg>";
}

describe("shelf and card entrances (task 3.1)", () => {
  it("puts the entrance on the shelf rail and on every kind of card", () => {
    // The two things the roadmap names as entering. The rail is the shelf's own root; the
    // cards are the primitives a shelf's content is made of, so the entrance cannot depend
    // on which one a particular surface happens to use.
    render(
      <Shelf title="Trending" shape="square" state="ready" data-testid="shelf">
        <ShelfTrackCard track={TRACK} context={[TRACK]} />
      </Shelf>,
    );
    carriesMotion(screen.getByTestId("shelf-rail"), MOTION_CLASS.reveal, "the shelf rail");

    const card = screen.getByTestId("shelf-track-card");
    carriesMotion(card, MOTION_CLASS.reveal, "a shelf track card");
    carriesMotion(card, MOTION_CLASS.feedback, "a shelf track card");

    render(<AlbumCard title="Nightdrive" artist="Aurora" />);
    const album = screen.getByRole("article");
    carriesMotion(album, MOTION_CLASS.reveal, "the album card");
    carriesMotion(album, MOTION_CLASS.feedback, "the album card");
    cleanup();

    render(<ArtistCard name="Aurora" />);
    const artist = screen.getByRole("article");
    carriesMotion(artist, MOTION_CLASS.reveal, "the artist card");
    carriesMotion(artist, MOTION_CLASS.feedback, "the artist card");
  });

  it("presents every shelf state with its own content and operable controls", () => {
    // Task 2.3: a motion is never load-bearing. jsdom cannot remove a motion, so what is
    // asserted is the stronger property that makes the removal harmless — each state
    // presents its own content, the region is announced by its own title whatever the
    // state, and the retry control works.
    for (const [state, content] of [
      [null, null],
      ["empty", "Nothing here yet"],
      ["error", "It did not load"],
    ] as const) {
      const view = render(
        <Shelf
          title="Trending"
          shape="square"
          state={state === null ? "loading" : state}
          error={{ title: "It did not load" }}
          onRetry={() => {}}
          data-testid="shelf"
        />,
      );
      if (state === null) {
        // A loading shelf's placeholders are decorative and hidden from assistive tech, so
        // what is asserted is that they exist and that the shelf says what it is.
        expect(screen.getAllByTestId("shelf-skeleton").length).toBeGreaterThan(0);
      } else {
        // The region's own copy is how a listener learns *why* a shelf is not showing
        // anything — never the transition itself.
        expect(screen.getByText(content as string), state).toBeInTheDocument();
      }
      expect(screen.getByRole("region", { name: "Trending" }), String(state)).toBeInTheDocument();
      if (state === "error") {
        expect(screen.getByRole("button", { name: "Retry" }), state).not.toBeDisabled();
        expect(screen.getByRole("alert"), state).toBeInTheDocument();
      }
      view.unmount();
    }
  });

  it("swaps skeletons for content in one commit, so a resolving shelf is never empty", () => {
    // The entrance is a rendering event (`@starting-style`), so the shelf resolving is the
    // moment it happens. What is asserted is the half that is checkable without a browser:
    // there is no frame in which the shelf presents neither.
    const { rerender } = render(
      <Shelf title="Trending" shape="square" state="loading" data-testid="shelf">
        <ShelfTrackCard track={TRACK} context={[TRACK]} />
      </Shelf>,
    );
    expect(screen.getAllByTestId("shelf-skeleton").length).toBeGreaterThan(0);

    rerender(
      <Shelf title="Trending" shape="square" state="ready" data-testid="shelf">
        <ShelfTrackCard track={TRACK} context={[TRACK]} />
      </Shelf>,
    );
    expect(screen.queryByTestId("shelf-skeleton")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});

describe("hover and tap feedback (task 3.2)", () => {
  it("scopes the feedback to the pointer and leaves the focus ring alone", () => {
    // Two claims in one. The feedback is the vocabulary's hover/active response — never a
    // focus-driven effect — and it changes no focus styling, so the globally visible
    // `:focus-visible` outline still applies to every control it decorates.
    render(
      <Shelf title="Trending" shape="square" state="ready" data-testid="shelf">
        <ShelfTrackCard track={TRACK} context={[TRACK]} />
      </Shelf>,
    );
    const card = screen.getByTestId("shelf-track-card");
    carriesMotion(card, MOTION_CLASS.feedback, "a card");
    // A focus ring is not this milestone's to give: no component may suppress it, because
    // it is the one affordance motion cannot provide.
    expect(classesOf(card), "a card must not suppress the global focus ring").not.toMatch(
      /outline-none|ring-0/,
    );

    render(<Button>Play</Button>);
    const control = screen.getByRole("button", { name: "Play" });
    carriesMotion(control, MOTION_CLASS.feedback, "the pill button");
    expect(classesOf(control)).not.toMatch(/outline-none|ring-0/);
  });

  it("lifts the two controls that used to scale, and records that as a behaviour change", () => {
    // **This is a behaviour change, not a spelling one, and it was unrecorded.**
    // `Button`'s pill button and the search top-result play control both carried
    // `transition hover:scale-105` before M19; replacing that with `motion-feedback` made
    // them `translateY(-2px)` on hover instead of `scale(1.05)`. The change documents call
    // this normalisation and read as though the scale survived — it did not. The reasoning
    // that decided to keep it is in `docs/MOTION.md` §4; this is the pin, so the two cannot
    // drift back apart unnoticed in either direction.
    //
    // The scale is pinned **per control, not application-wide**, and deliberately so:
    // `IconButton` still carries `hover:scale-105` on its accent and light tones. That is
    // not a conflict — Tailwind v4 emits it as the standalone `scale:` property inside
    // `@layer utilities`, which composes with `.motion-feedback:hover`'s `transform` in
    // `@layer components` — so "remove every `hover:scale-`" would be the wrong rule, and
    // this one leaves that control alone.
    render(<Button>Play</Button>);
    const pill = screen.getByRole("button", { name: "Play" });
    carriesMotion(pill, MOTION_CLASS.feedback, "the pill button");
    expect(classesOf(pill), "the pill button lifts instead of scaling").not.toMatch(/hover:scale-/);

    render(
      <TopResultCard top={{ kind: "track", track: TRACK }} onSelect={() => {}} onPlay={() => {}} />,
    );
    const play = screen.getByRole("button", { name: "Play Alpha" });
    carriesMotion(play, MOTION_CLASS.feedback, "the search play control");
    expect(classesOf(play), "the search play control lifts instead of scaling").not.toMatch(
      /hover:scale-/,
    );
  });

  it("keeps every control a motion decorates reachable by keyboard and by tap", () => {
    // Hover feedback is never the only affordance: every control it decorates is a real
    // focusable element, and adding a motion class does not make it inert or untappable.
    const { container } = render(
      <Shelf title="Trending" shape="square" state="ready" data-testid="shelf">
        <ShelfTrackCard track={TRACK} context={[TRACK]} />
      </Shelf>,
    );
    const card = screen.getByTestId("shelf-track-card");
    card.focus();
    expect(document.activeElement).toBe(card);

    const interactive = [...container.querySelectorAll("button, a[href], [tabindex]")];
    expect(interactive.length, "a card must still expose its controls").toBeGreaterThan(0);
    for (const element of interactive) {
      expect(element.className, element.getAttribute("aria-label") ?? "control").not.toContain(
        "pointer-events-none",
      );
      expect(
        element.hasAttribute("disabled"),
        element.getAttribute("aria-label") ?? "control",
      ).toBe(false);
    }
  });
});

describe("dialog and sheet transitions, including the exit (task 3.3)", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts">
          <button type="button">First</button>
        </Dialog>
      </>
    );
  }

  it("carries the surface class and the open state the entrance reads", () => {
    render(<Harness />);
    expect(screen.queryByTestId("dialog-backdrop")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    const backdrop = screen.getByTestId("dialog-backdrop");
    carriesMotion(backdrop, MOTION_CLASS.surface, "the dialog backdrop");
    // The state is in the DOM, not only implied by a class: `motion-surface` opens on
    // `[data-motion-state="open"]`, so a test has something to read and a refactor cannot
    // quietly change which state is which.
    expect(backdrop.getAttribute("data-motion-state")).toBe("open");
    expect(backdrop.className).not.toContain("pointer-events-none");
  });

  it("carries the leave, and does not delay the dismissal by it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // **Nothing waits.** On this very first frame the dialog is out of the accessibility
    // tree and out of the tab order, and only its pixels are still travelling.
    const leaving = screen.getByTestId("dialog-backdrop");
    expect(leaving.getAttribute("data-motion-state")).toBe("closing");
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving).toHaveAttribute("inert");
    // A motion must never sit between a listener and a click, so the leaving backdrop
    // stops taking input immediately rather than when its fade ends. The renderable half is
    // `inert`; the visual half is the rule the vocabulary states, asserted here so a
    // deletion of that rule cannot leave a fading overlay eating clicks.
    expect(leaving).toHaveAttribute("inert");
    expect(vocabularyCss).toMatch(
      /\.motion-surface\[data-motion-state="closing"\][^{]*\{[^}]*pointer-events:\s*none/,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    // And the browser tears it down when the transition ends.
    fireEvent.transitionEnd(leaving, { propertyName: "opacity" });
    expect(screen.queryByTestId("dialog-backdrop")).toBeNull();
  });

  it("never lets a child's transition end the backdrop's leave early", () => {
    // `transitionend` bubbles. A transition on the panel, or on any control inside it,
    // must not finish the backdrop's leave while the backdrop is still fading — which is
    // the difference between a dialog that fades out and one that blinks off.
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    const panel = screen.getByTestId("dialog-panel");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.transitionEnd(panel, { propertyName: "opacity" });
    expect(
      screen.getByTestId("dialog-backdrop").getAttribute("data-motion-state"),
      "a child's transition must not end the leave" as string,
    ).toBe("closing");

    // A different property on the backdrop itself does not end it either.
    fireEvent.transitionEnd(screen.getByTestId("dialog-backdrop"), { propertyName: "display" });
    expect(screen.getByTestId("dialog-backdrop").getAttribute("data-motion-state")).toBe("closing");
  });

  it("keeps the dialog operable throughout its enter and its leave", () => {
    // Task 2.3 again, on the surface with the most moving parts: every control is present,
    // named, and focusable while open; and once dismissed the surface is gone from the
    // keyboard rather than lingering as a trap.
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open it" });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "First" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
    expect(document.activeElement).toBe(screen.getByTestId("dialog-panel"));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("player and Now Playing transitions (task 3.4)", () => {
  // The Now Playing case below renders the real route, which reaches three things the
  // docked player does not: the library store's own hydration, the lyrics panel's request,
  // and the related shelf's. The same arrangement `nowplaying-presentation.test.tsx` uses,
  // so neither file invents its own setup for the same surface.
  let repositories: RepositorySet;

  beforeEach(async () => {
    resetPlayerStore();
    resetQueueStore();
    resetLibraryStore();
    resetVideoModeStore();
    localStorage.clear();
    clearPlaybackBridge();
    repositories = await getLocalData();
    await repositories.resetAll();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ tracks: [], diagnostics: {} }),
          }) as unknown as Response,
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-keys both player clusters on the track, so an entrance can happen at all", () => {
    // `@starting-style` fires on *rendering*. A player that re-renders with new text would
    // animate nothing, so both clusters are keyed on the track. That the key is the
    // mechanism is the point: an entrance class on an element React never replaces is a
    // class that never plays.
    usePlayerStore.setState({ currentTrack: TRACK, status: "idle", errorMessage: null });
    const first = render(
      <>
        <PlayerBar />
        <MiniPlayer />
      </>,
    );
    const clusters = screen.getAllByRole("link", { name: "Open Now Playing" });
    expect(clusters).toHaveLength(2);
    for (const cluster of clusters) {
      carriesMotion(cluster, MOTION_CLASS.reveal, "a player's track cluster");
    }
    const barCluster = first.container.querySelector(
      '[data-testid="player-bar"] a[href="/now-playing"]',
    );
    const miniCluster = first.container.querySelector(
      '[data-testid="mini-player"] a[href="/now-playing"]',
    );
    expect(barCluster).not.toBeNull();
    expect(miniCluster).not.toBeNull();

    usePlayerStore.setState({ currentTrack: track({ id: "youtube:bbb", title: "Beta" }) });
    first.rerender(
      <>
        <PlayerBar />
        <MiniPlayer />
      </>,
    );
    // New elements, with the title that belongs to them: a new track produced a new node,
    // which is what an entrance is a response to.
    const after = [
      first.container.querySelector('[data-testid="player-bar"] a[href="/now-playing"]'),
      first.container.querySelector('[data-testid="mini-player"] a[href="/now-playing"]'),
    ];
    for (const [index, cluster] of after.entries()) {
      expect(cluster, "each cluster must be a new element after a track change").not.toBe(
        [barCluster, miniCluster][index],
      );
      expect(cluster?.textContent).toContain("Beta");
    }
  });

  it("presents the player's information and controls in both of its states", () => {
    // Task 2.3 on the player: a listener who never sees the motion still knows what is
    // playing and can act on it — and an idle player says so rather than showing nothing.
    usePlayerStore.setState({ currentTrack: null, status: "idle", errorMessage: null });
    const idle = render(<PlayerBar />);
    expect(screen.getByText("Nothing playing")).toBeInTheDocument();
    expect(screen.getByText("Choose something to start")).toBeInTheDocument();
    for (const name of ["Previous track", "Next track"]) {
      expect(screen.getByRole("button", { name }), name).toBeDisabled();
    }
    idle.unmount();

    usePlayerStore.setState({ currentTrack: TRACK, status: "idle", errorMessage: null });
    render(
      <>
        <PlayerBar />
        <MiniPlayer />
      </>,
    );
    expect(screen.getAllByText("Alpha")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Play" }).length).toBeGreaterThan(0);
    for (const name of ["Previous track", "Next track"]) {
      expect(screen.getAllByRole("button", { name })[0], name).not.toBeDisabled();
    }
    expect(screen.getAllByRole("link", { name: "Open Now Playing" })).toHaveLength(2);
  });

  it("gives Now Playing its entrance and its feedback, keyed per track like the docked player", () => {
    // Task 3.4 names *three* surfaces — "player and Now Playing transitions" — and this is
    // the third. It was asserted at source level only: `app/now-playing/page.tsx` appeared in
    // `MOTION_ALLOWED` and in one source-marker check, so deleting `motion-reveal` from the
    // route would have left every *rendered* assertion in this file green. So the route is
    // rendered here, exactly as `PlayerBar` and `MiniPlayer` are above — no stand-in.
    //
    // It renders in jsdom with no accommodation that needed recording: the title-overflow
    // measurement (`scrollWidth > clientWidth`) answers `false` under jsdom's zero layout,
    // which is the *static* branch, so the decorative marquee is not applied and does not
    // need stubbing to get a deterministic render.
    usePlayerStore.setState({ currentTrack: null, status: "idle", errorMessage: null });
    const view = render(<NowPlayingPage />);

    // Idle still presents the surface, and still carries its entrance: a motion is never
    // load-bearing, so there is nothing here that only exists while something is playing.
    const idleTile = screen.getByTestId("now-playing-artwork");
    carriesMotion(idleTile, MOTION_CLASS.reveal, "Now Playing's idle artwork tile");
    carriesMotion(
      screen.getByRole("link", { name: "Close Now Playing" }),
      MOTION_CLASS.feedback,
      "Now Playing's close control",
    );

    // A track, and a new tile: the key is the mechanism, so the assertion is its effect.
    usePlayerStore.setState({ currentTrack: TRACK, status: "idle", errorMessage: null });
    view.rerender(<NowPlayingPage />);
    const playingTile = screen.getByTestId("now-playing-artwork");
    expect(playingTile, "a new track must produce a new tile for the entrance to fire").not.toBe(
      idleTile,
    );
    carriesMotion(playingTile, MOTION_CLASS.reveal, "Now Playing's artwork tile");
    expect(screen.getByTestId("now-playing-title")).toHaveTextContent("Alpha");

    // And the feedback half: the transport control answers a pointer. `IconButton` carries
    // `motion-feedback` from the primitive, so this asserts the route actually renders that
    // control rather than re-implementing it.
    carriesMotion(
      screen.getByRole("button", { name: "Next track" }),
      MOTION_CLASS.feedback,
      "Now Playing's next-track control",
    );
  });
});

describe("Home's content change (task 3.5)", () => {
  beforeEach(() => {
    resetHistoryStore();
    resetLibraryStore();
    resetMixStore();
    resetPreferencesStore();
    useHistoryStore.setState({ events: [], hydrated: true, hydrate: () => Promise.resolve() });
    useLibraryStore.setState({ likedTracks: [], hydrated: true, hydrate: () => Promise.resolve() });
    useMixStore.setState({ mixes: [], hydrate: () => Promise.resolve() });
    usePreferencesStore.setState({
      languages: ["en"],
      onboardingComplete: true,
      hydrated: true,
      hydrate: () => Promise.resolve(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ tracks: [], diagnostics: {} }),
          }) as unknown as Response,
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("re-keys the presented stack on the filter, so a change is a transition", async () => {
    render(<HomeView />);
    await waitFor(() => expect(screen.queryAllByTestId("shelf-skeleton")).toHaveLength(0));

    // The stack is the one element the milestone gave a key, so this asserts the key's
    // *effect* rather than the attribute: after a filter change the presented content is
    // in a new element.
    const before = screen.getByTestId("home-section-trending");
    expect(before).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-filter-music"));

    // A fresh node, carrying the newly presented section.
    const after = screen.getByTestId("home-section-trending");
    expect(after).not.toBe(before);
    expect(after).toBeInTheDocument();
  });

  it("keeps content present throughout a content change, and the control operable", async () => {
    // The requirement that matters, and the one no frame measurement can be needed for:
    // no listener ever loses content to a motion. So the newly presented content is in the
    // DOM in the *same commit* as the click — there is no frame and no "wait for the
    // animation" step between choosing a filter and seeing the feed.
    render(<HomeView />);
    await waitFor(() => expect(screen.queryAllByTestId("shelf-skeleton")).toHaveLength(0));
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("home-filter-music"));

    // Content is present, and the filter that caused the change is still operable: a motion
    // never blocks input.
    expect(screen.getByTestId("home-filter-music")).toHaveAttribute("aria-pressed", "true");
    const section = screen.getByTestId("home-section-trending");
    expect(section, "the feed is never empty").not.toBeEmptyDOMElement();
    // The section is announced as its own landmark, so the content is reachable and
    // identifiable whether or not anything animated.
    expect(section.getAttribute("aria-label"), "a shelf is its own named landmark").toBeTruthy();
    expect(section.tagName.toLowerCase()).toBe("section");

    fireEvent.click(screen.getByTestId("home-filter-all"));
    expect(screen.getByTestId("home-filter-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("home-section-trending")).toBeInTheDocument();
  });
});
