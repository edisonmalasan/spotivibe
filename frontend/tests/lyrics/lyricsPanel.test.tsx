import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LyricsPanel } from "@/features/lyrics/LyricsPanel";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "../helpers/music-fixtures";

/**
 * Panel behaviour (spec `lyrics` — "The lyrics panel shows the active line and follows playback").
 *
 * The panel is driven through the *real* `fetchLyrics`, so these tests exercise the client contract
 * and the four designed states together rather than asserting on a hand-fed state object. The only
 * substitution is the transport.
 */

/** A resolver for a video id, per-test. */
type Resolver = (videoId: string) => Promise<{ syncedLyrics?: string; plainLyrics?: string }>;

let resolver: Resolver;
let requested: string[];

beforeEach(() => {
  resetPlayerStore();
  requested = [];
  resolver = async () => ({ syncedLyrics: "[00:00]one\n[00:10]two\n[00:20]three" });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    const videoId = url.searchParams.get("videoId") ?? "";
    requested.push(videoId);
    const body = await resolver(videoId);
    return new Response(JSON.stringify({ status: "ok", plainLyrics: null, ...body }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

/**
 * Give jsdom real geometry, and record the scroll the panel asks for.
 *
 * jsdom reports a zero rect for every element and does not implement `scrollBy` at all, which makes
 * any rule expressed in terms of positions untestable. A first draft of these tests worked around
 * that by tolerating *either* outcome — worse than no test, because it reads as coverage while
 * asserting nothing. Stubbing both makes the live-band rule and the reduced-motion behaviour
 * genuinely observable:
 *
 * - the scroller is 400px tall and the live band is its middle half, so a line 20px from the top is
 *   outside it and a centred line is inside; and
 * - every `scrollBy` is recorded, so "SHALL NOT use smooth scrolling" is asserted on the actual
 *   `behavior` value rather than on a `data-` attribute a component could set without ever
 *   scrolling.
 */
const SCROLLER_HEIGHT = 400;
const LINE_HEIGHT = 20;

interface ScrollCall {
  top: number;
  behavior: ScrollBehavior | undefined;
}

/** Scrolls the panel asked for since the last reset. */
let scrollCalls: ScrollCall[] = [];

function rect(top: number, height = LINE_HEIGHT): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 300,
    width: 300,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** The active line sits in the middle of the panel — where the panel's own scroll leaves it. */
const ACTIVE_LINE_CENTRED = { top: SCROLLER_HEIGHT / 2 - LINE_HEIGHT / 2 };
/** The active line has been scrolled to the top of the panel — away from the live band. */
const ACTIVE_LINE_ABOVE_THE_BAND = { top: 4 };
/** The active line sits below the band, so centring it scrolls forward. */
const BELOW_LINE = { top: 340 };
const ACTIVE_LINE_BELOW_CENTRE = BELOW_LINE;

/**
 * The pristine prototypes, captured **once at module load**.
 *
 * The first version captured them inside `layout()`, so a test that called `layout()` twice saved
 * the *first stub* as its "original" and overwrote `layoutRestore`. `afterEach` then restored the
 * stub instead of the real method, leaving it installed for the rest of the file — proved by
 * experiment, not by reading. Harmless at the time only because every later geometry-dependent test
 * re-stubbed; a new test that forgot to would have run against another test's geometry.
 */
const PRISTINE = {
  rect: Element.prototype.getBoundingClientRect,
  clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight"),
  scrollBy: Element.prototype.scrollBy,
  matchMedia: window.matchMedia,
} as const;

/**
 * Install the geometry stubs, positioning the *active* line at `activeLine.top`.
 *
 * `scrollBy` is replaced as well as the rects: once the rects are real the panel's effect computes
 * a non-zero centring delta and calls it, and an unimplemented `scrollBy` throws and takes every
 * later test in the file with it.
 */
function layout(activeLine: { top: number }) {
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    const element = this as HTMLElement;
    // The scroller's own height matters, not just its position: the live band is the middle half of
    // the *scroller*, so a stub that gave it the line's height would collapse the band to a few
    // pixels and invert every judgement made against it.
    if (element.dataset.testid === "lyrics-scroller") return rect(0, SCROLLER_HEIGHT);
    if (element.dataset.testid === "lyrics-line" && element.dataset.active === "true") {
      return rect(activeLine.top);
    }
    if (element.dataset.testid === "lyrics-line") return rect(activeLine.top + 2000);
    return rect(0, SCROLLER_HEIGHT);
  };
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      const element = this as HTMLElement;
      return element.dataset.testid === "lyrics-scroller" ? SCROLLER_HEIGHT : LINE_HEIGHT;
    },
  });
  Element.prototype.scrollBy = function (options?: ScrollToOptions) {
    scrollCalls.push({ top: options?.top ?? 0, behavior: options?.behavior });
  } as Element["scrollBy"];

  // Clear the recorder when the geometry is installed, not only in `afterEach`. A scroll issued by a
  // previous test's component can land after that test's teardown, so relying on the reset alone left
  // the array holding a call from a test with different configuration — which failed a later
  // assertion roughly one run in six. Clearing here plus slicing per-assertion below makes every
  // reading describe only its own effect.
  scrollCalls = [];
}

afterEach(() => {
  // Restore the pristine prototypes from `PRISTINE`, unconditionally — including when `layout()`
  // was never called, which is why this is not keyed off anything. The prototypes are captured at
  // module load rather than per `layout()` call, so a test that installs the geometry twice still
  // restores the real methods rather than its own first stub.
  Element.prototype.getBoundingClientRect = PRISTINE.rect;
  if (PRISTINE.clientHeight) {
    Object.defineProperty(Element.prototype, "clientHeight", PRISTINE.clientHeight);
  }
  Element.prototype.scrollBy = PRISTINE.scrollBy;
  scrollCalls = [];
  // `window.matchMedia` is redefined wholesale rather than spied on, so `vi.restoreAllMocks()` does
  // not put it back: every test after the first one that set a reduced-motion preference ran under
  // the previous test's answer. Restoring the original here closes that.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: PRISTINE.matchMedia,
  });
  vi.restoreAllMocks();
});

/**
 * Arrange the store directly rather than driving `playTrack`.
 *
 * The panel reads `currentTrack` and `positionSeconds` and nothing else, and the bridge-backed
 * `playTrack` would need a playback bridge this test has no reason to build. Setting the two fields
 * keeps the arrangement minimal and states plainly what the component depends on.
 */
function play(positionSeconds: number, providerId = "aaaaaaaaaaa") {
  act(() => {
    usePlayerStore.setState({
      currentTrack: makeTrack({ providerId, title: "A Song" }),
      status: "playing",
      positionSeconds,
    });
  });
}

const lines = () => screen.queryAllByTestId("lyrics-line");

/**
 * The rendered text of the unavailable state's message.
 *
 * Each capture renders in its own view and unmounts it, so the two states are never on screen at
 * once. The comparison they feed is the point: two *containers* differing says nothing about whether
 * the messages a listener reads differ, and setting one state's copy to the other's left every test
 * green until this existed.
 */
async function captureUnavailableMessage(): Promise<string> {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify({ status: "unavailable" }), { status: 200 }),
  );
  const view = render(<LyricsPanel />);
  await screen.findByTestId("lyrics-unavailable");
  const text = screen.getByTestId("lyrics-unavailable").textContent ?? "";
  view.unmount();
  return text;
}

/** The rendered text of the error state's whole surface, title and description together. */
async function captureErrorMessage(): Promise<string> {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: { code: "upstream_unavailable" } }), { status: 503 }),
  );
  const view = render(<LyricsPanel />);
  await screen.findByTestId("lyrics-error");
  const text = screen.getByTestId("lyrics-error").textContent ?? "";
  view.unmount();
  return text;
}

describe("LyricsPanel — the four designed states", () => {
  it("renders nothing at all with no current track", () => {
    // "no track" is a state, and the honest rendering of it is absence: an empty Now Playing has
    // no lyrics to be loading, unavailable, or broken about.
    const { container } = render(<LyricsPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a loading state while the request is in flight", async () => {
    // The request is held open deliberately. A fetch that resolves in a microtask would be answered
    // before any assertion could observe the loading state, so a test written the obvious way
    // would pass against a panel that never rendered one.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Promise<Response>(() => undefined),
    );
    play(0);
    render(<LyricsPanel />);
    expect(await screen.findByTestId("lyrics-loading")).toBeInTheDocument();
    expect(screen.getByTestId("lyrics-panel")).toHaveAttribute("data-lyrics-state", "loading");
  });

  it("shows the timed lines once they arrive", async () => {
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    expect(lines().map((node) => node.textContent)).toEqual(["one", "two", "three"]);
  });

  it("shows an unavailable message that is distinct from the error message", async () => {
    // The two facts a listener can act on differently. Asserting only that "something" is shown is
    // how a panel ends up saying "couldn't reach the service" for every track that simply has no
    // lyrics, which is most of the catalogue.
    //
    // The route answers this as a **200 with \`status: "unavailable"\`**, not a 404 and not a 5xx,
    // so the transport returns exactly that. A first draft drove the case by swapping the
    // transport mid-test and switching to a second track, which made one assertion cover two tracks
    // while reading as a single case.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ status: "unavailable" }), { status: 200 }),
    );

    play(0);
    render(<LyricsPanel />);

    const panel = await screen.findByTestId("lyrics-panel");
    await waitFor(() => expect(panel).toHaveAttribute("data-lyrics-state", "unavailable"));
    expect(screen.getByTestId("lyrics-unavailable")).toHaveTextContent(/no lyrics available/i);
    expect(screen.queryByTestId("lyrics-error")).toBeNull();
    // Nothing is marked or scrolled, because there is nothing to follow.
    expect(lines()).toHaveLength(0);
  });

  it("shows a retryable error when the provider cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: "upstream_unavailable" } }), { status: 503 }),
    );
    play(0);
    render(<LyricsPanel />);

    const error = await screen.findByTestId("lyrics-error");
    expect(error).toBeInTheDocument();
    // The unavailable message must be absent. A 503 is a failure to reach the provider, and saying
    // "no lyrics for this track" there would be a claim about the track that is not true.
    expect(screen.queryByTestId("lyrics-unavailable")).toBeNull();

    // **The words, not just the container.** A previous version of this test asserted the two states
    // were different *elements* and never their text, so setting the error copy to the unavailable
    // string — making the two messages identical, which is precisely what the spec forbids — left
    // all 2495 tests green. Separate containers cannot fail this; only these assertions can.
    expect(error).toHaveTextContent(/couldn't be loaded/i);
    expect(error).toHaveTextContent(/playback is unaffected/i);
    expect(error).not.toHaveTextContent(/no lyrics available/i);
  });

  it("uses two genuinely different messages for the two different facts", async () => {
    // The same guarantee stated as the spec states it: "two distinguishable messages, not one".
    // Both are captured from a render of each state, then compared. `play()` is called before each
    // capture because the store is reset per test, and the panel renders nothing without a track.
    play(0);
    const unavailableCopy = await captureUnavailableMessage();
    play(0);
    const errorCopy = await captureErrorMessage();

    expect(unavailableCopy).toMatch(/no lyrics available/i);
    expect(errorCopy.length).toBeGreaterThan(0);
    expect(errorCopy.toLowerCase()).not.toBe(unavailableCopy.toLowerCase());
    // And neither borrows the other's wording, which is what "distinguishable" has to mean when a
    // listener is reading rather than a machine matching testids.
    expect(errorCopy.toLowerCase()).not.toContain("no lyrics available");
    expect(unavailableCopy.toLowerCase()).not.toContain("couldn't be loaded");
  });

  it("re-requests when the error state is retried", async () => {
    // A local counter, not the shared `requested` array: the shared recorder belongs to the
    // `beforeEach` transport, and this test replaces that transport, so counting there would read
    // zero and the assertion would be vacuous.
    let calls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: { code: "upstream_unavailable" } }), {
        status: 503,
      });
    });
    play(0);
    render(<LyricsPanel />);
    await screen.findByTestId("lyrics-error");
    expect(calls).toBe(1);

    act(() => {
      screen.getByRole("button", { name: /try lyrics again/i }).click();
    });
    await waitFor(() => expect(calls).toBe(2));
  });

  it("renders untimed lyrics as plain text with no active line", async () => {
    resolver = async () => ({ plainLyrics: "first line\nsecond line" });
    play(30);
    render(<LyricsPanel />);

    const plain = await screen.findByTestId("lyrics-plain");
    expect(plain.textContent).toContain("first line");
    // No following view at all: nothing to mark current, nothing to scroll.
    expect(lines()).toHaveLength(0);
    expect(screen.queryByTestId("lyrics-scroller")).toBeNull();
  });

  it("prefers timed lines when the provider supplies both", async () => {
    resolver = async () => ({ syncedLyrics: "[00:00]timed", plainLyrics: "plain" });
    play(0);
    render(<LyricsPanel />);

    await waitFor(() => expect(lines()).toHaveLength(1));
    expect(lines()[0].textContent).toBe("timed");
    expect(screen.queryByTestId("lyrics-plain")).toBeNull();
  });
});

describe("LyricsPanel — the active line", () => {
  it("marks no line as current before the first timestamp", async () => {
    resolver = async () => ({ syncedLyrics: "[00:20]late" });
    play(5);
    render(<LyricsPanel />);

    await waitFor(() => expect(lines()).toHaveLength(1));
    expect(lines()[0]).toHaveAttribute("data-active", "false");
    expect(lines()[0]).not.toHaveAttribute("aria-current");
  });

  it("marks the line whose time the position has reached", async () => {
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    expect(lines()[0]).toHaveAttribute("aria-current", "true");

    act(() => usePlayerStore.setState({ positionSeconds: 12 }));
    expect(lines()[1]).toHaveAttribute("data-active", "true");
    expect(lines()[0]).toHaveAttribute("data-active", "false");

    act(() => usePlayerStore.setState({ positionSeconds: 25 }));
    expect(lines()[2]).toHaveAttribute("data-active", "true");
  });

  it("uses aria-current, and no live region at all", async () => {
    // Position advances about once a second. An `aria-live` region would announce a new line every
    // second, which is noise rather than information.
    const { container } = render(<LyricsPanel />);
    play(0);
    await waitFor(() => expect(lines()).toHaveLength(3));

    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(lines().filter((node) => node.getAttribute("aria-current") === "true")).toHaveLength(1);
  });
});

describe("LyricsPanel — following yields to the listener", () => {
  it("scrolls the active line into view while following", async () => {
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    // Below the band, so centring the line requires scrolling forward — a positive delta. Asserting
    // a positive value rather than a negative one is not cosmetic: it pins that the panel scrolls
    // *toward* the line, not that it moved at all.
    layout(ACTIVE_LINE_BELOW_CENTRE);
    const before = scrollCalls.length;

    act(() => usePlayerStore.setState({ positionSeconds: 25 }));

    // The exact centring delta, so the assertion is about centring rather than "a scroll happened".
    const expected = BELOW_LINE.top - (SCROLLER_HEIGHT - LINE_HEIGHT) / 2;
    expect(scrollCalls.slice(before)).toEqual([{ top: expected, behavior: "smooth" }]);
  });

  it("does not scroll when following has been suspended", async () => {
    // The counterpart to the test above: without this, a panel that never scrolled would pass both.
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));

    layout(ACTIVE_LINE_ABOVE_THE_BAND);
    act(() => {
      screen.getByTestId("lyrics-scroller").dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(screen.getByTestId("lyrics-scroller")).toHaveAttribute("data-following", "false");

    const before = scrollCalls.length;
    act(() => usePlayerStore.setState({ positionSeconds: 25 }));
    expect(scrollCalls.slice(before)).toHaveLength(0);
  });

  it("keeps following when the panel is scrolled but the active line stays in the live band", async () => {
    // The panel's *own* centring scroll fires a `scroll` event for every animation frame. If
    // following were decided by "a scroll happened", this event would switch following off moments
    // after enabling it — the exact defect the position-based rule exists to avoid.
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    layout(ACTIVE_LINE_CENTRED);

    act(() => {
      screen.getByTestId("lyrics-scroller").dispatchEvent(new Event("scroll", { bubbles: false }));
    });

    expect(screen.getByTestId("lyrics-scroller")).toHaveAttribute("data-following", "true");
    expect(screen.queryByTestId("lyrics-back-to-live")).toBeNull();
  });

  it("suspends following when the listener scrolls the active line out of the live band", async () => {
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    layout(ACTIVE_LINE_ABOVE_THE_BAND);

    act(() => {
      screen.getByTestId("lyrics-scroller").dispatchEvent(new Event("scroll", { bubbles: false }));
    });

    expect(screen.getByTestId("lyrics-scroller")).toHaveAttribute("data-following", "false");
    expect(screen.getByTestId("lyrics-back-to-live")).toBeInTheDocument();
  });

  it("resumes following when the listener scrolls back to the live position", async () => {
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));

    layout(ACTIVE_LINE_ABOVE_THE_BAND);
    act(() => {
      screen.getByTestId("lyrics-scroller").dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    expect(screen.getByTestId("lyrics-back-to-live")).toBeInTheDocument();

    // Scrolling back to the live position is itself the way back; no button press required.
    layout(ACTIVE_LINE_CENTRED);
    act(() => {
      screen.getByTestId("lyrics-scroller").dispatchEvent(new Event("scroll", { bubbles: false }));
    });

    expect(screen.getByTestId("lyrics-scroller")).toHaveAttribute("data-following", "true");
    expect(screen.queryByTestId("lyrics-back-to-live")).toBeNull();
  });

  it("returns to the live position when the affordance is activated", async () => {
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    layout(ACTIVE_LINE_ABOVE_THE_BAND);
    act(() => {
      screen.getByTestId("lyrics-scroller").dispatchEvent(new Event("scroll", { bubbles: false }));
    });

    layout(ACTIVE_LINE_CENTRED);
    act(() => {
      screen.getByRole("button", { name: "Back to live" }).click();
    });

    expect(screen.getByTestId("lyrics-scroller")).toHaveAttribute("data-following", "true");
  });

  it("never shows the back-to-live control while following", async () => {
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    expect(screen.queryByTestId("lyrics-back-to-live")).toBeNull();
  });
});

describe("LyricsPanel — reduced motion", () => {
  it("scrolls without smoothing under a reduced-motion preference", async () => {
    // Asserted on the `behavior` actually handed to `scrollBy`, not on a `data-` attribute: an
    // attribute proves the component *knows* the preference, not that it changed anything. This is
    // the requirement the spec words as "SHALL NOT use smooth scrolling".
    //
    // Only the calls recorded **after** the position change are examined. `scrollCalls` is a
    // module-level array shared by the file, and asserting on all of it made this test fail roughly
    // one run in six: a scroll issued by an earlier test's component could land in the array after
    // that test's `afterEach` had reset it, and a `smooth` call from a test with no reduced-motion
    // preference then failed this assertion. The contamination was real, it was in this file, and
    // the fix is to measure the effect under test rather than the file's history.
    setReducedMotion(true);
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    layout(ACTIVE_LINE_ABOVE_THE_BAND);

    const before = scrollCalls.length;
    act(() => usePlayerStore.setState({ positionSeconds: 15 }));
    const issued = scrollCalls.slice(before);

    expect(issued.length).toBeGreaterThan(0);
    expect(issued.every((call) => call.behavior === "auto")).toBe(true);
  });

  it("smooth-scrolls when no reduced-motion preference is set", async () => {
    // The counterpart, so the assertion above cannot pass by the component never scrolling at all.
    setReducedMotion(false);
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    layout(ACTIVE_LINE_ABOVE_THE_BAND);

    const before = scrollCalls.length;
    act(() => usePlayerStore.setState({ positionSeconds: 15 }));
    const issued = scrollCalls.slice(before);

    expect(issued.length).toBeGreaterThan(0);
    expect(issued.some((call) => call.behavior === "smooth")).toBe(true);
  });

  it("reports the preference on the scroller for diagnosis", async () => {
    setReducedMotion(true);
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));
    expect(screen.getByTestId("lyrics-scroller")).toHaveAttribute("data-reduced-motion", "true");
  });

  it("transitions the line colour on both branches, so a change is animated and then neutralisable", async () => {
    // The claim task 4.4 makes is that reduced motion neutralises a *transition*. That only holds if a
    // transition exists, and for two passes nothing checked: removing `transition-colors` entirely
    // left all 2494 tests green. A transition class applied only on the inactive branch also produces
    // none, because the element never carries the property before the colour changes — so this
    // asserts both branches carry it, and that the two branches differ in colour.
    setReducedMotion(false);
    play(0);
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));

    const active = lines()[0];
    const inactive = lines()[1];

    expect(active.className).toContain("transition-colors");
    expect(inactive.className).toContain("transition-colors");
    // And the transition has something to act on: the active and inactive styling must differ.
    expect(active.className).not.toBe(inactive.className);
  });

  it("has the global CSS rule the line-colour transition depends on", () => {
    // The line colour change is a **CSS transition**, not a JavaScript animation, so there is no
    // imperative call to switch off under reduced motion — the global rule in `globals.css` is what
    // neutralises it. That makes the stylesheet part of this requirement, and the rule can disappear
    // in a refactor of that file without any other test noticing. So it is asserted here, by name.
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "app", "globals.css"),
      "utf8",
    );
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block, "the global reduced-motion block must exist").toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(block).toContain("transition-duration: 0.01ms !important");
    expect(block).toContain("scroll-behavior: auto !important");
  });
});

describe("LyricsPanel — track changes", () => {
  it("discards the previous track's lyrics entirely", async () => {
    play(0, "aaaaaaaaaaa");
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));

    resolver = async () => ({ syncedLyrics: "[00:00]different song\n[00:05]second line" });
    act(() => {
      usePlayerStore.setState({ currentTrack: makeTrack({ providerId: "bbbbbbbbbbb" }) });
    });

    await waitFor(() => expect(lines()).toHaveLength(2));
    // Nothing of the previous track survives — not its text, not its length.
    expect(lines().map((node) => node.textContent)).toEqual(["different song", "second line"]);
    expect(screen.getByTestId("lyrics-panel")).not.toHaveTextContent("three");
  });

  it("resets the active line, so the new track does not inherit the old cursor", async () => {
    resolver = async () => ({ syncedLyrics: "[00:00]one\n[00:10]two" });
    play(15, "aaaaaaaaaaa");
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()[1]).toHaveAttribute("data-active", "true"));

    // The new track's lines start at 0 and 30, and the store position is still 15 — so the correct
    // active line is now index 0. An inherited cursor would leave index 1 marked, so this asserts
    // a *change* of index rather than merely that some line is active.
    resolver = async () => ({ syncedLyrics: "[00:00]alpha\n[00:30]beta" });
    act(() => {
      usePlayerStore.setState({ currentTrack: makeTrack({ providerId: "bbbbbbbbbbb" }) });
    });

    await waitFor(() => expect(lines()[0]).toHaveTextContent("alpha"));
    expect(lines()[0]).toHaveAttribute("data-active", "true");
    expect(lines()[1]).toHaveAttribute("data-active", "false");
  });

  it("ignores a slow response for a track that is no longer playing", async () => {
    // The race the generation counter exists for: without it, a slow response for the previous
    // track lands under the new track's title.
    let release: (() => void) | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "http://localhost");
      if (url.searchParams.get("videoId") === "aaaaaaaaaaa") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return new Response(
          JSON.stringify({ status: "ok", syncedLyrics: "[00:00]STALE", plainLyrics: null }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ status: "ok", syncedLyrics: "[00:00]FRESH", plainLyrics: null }),
        { status: 200 },
      );
    });

    play(0, "aaaaaaaaaaa");
    render(<LyricsPanel />);
    act(() => {
      usePlayerStore.setState({ currentTrack: makeTrack({ providerId: "bbbbbbbbbbb" }) });
    });

    await waitFor(() => expect(screen.getByTestId("lyrics-line")).toHaveTextContent("FRESH"));
    act(() => {
      release?.();
    });

    // The stale response arrives late and must change nothing.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("lyrics-line")).toHaveTextContent("FRESH");
    expect(screen.queryByText("STALE")).toBeNull();
  });

  it("requests once per track, not once per render", async () => {
    play(0, "aaaaaaaaaaa");
    render(<LyricsPanel />);
    await waitFor(() => expect(lines()).toHaveLength(3));

    act(() => usePlayerStore.setState({ positionSeconds: 5 }));
    act(() => usePlayerStore.setState({ positionSeconds: 10 }));

    expect(requested).toEqual(["aaaaaaaaaaa"]);
  });
});

/** Replace `matchMedia` with a query that reports `matches` for everything. */
function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
