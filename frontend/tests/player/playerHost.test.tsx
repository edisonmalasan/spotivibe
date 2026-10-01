import "fake-indexeddb/auto";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerHost } from "@/components/player/PlayerHost";
import { getLocalData } from "@/data/localData";
import { isNetworkMonitorActive, resetNetworkStore, useNetworkStore } from "@/stores/networkStore";
import {
  clearPlaybackBridge,
  isNetworkRecoveryActive,
  resetPlayerStore,
  usePlayerStore,
} from "@/stores/playerStore";
import { resetVideoModeStore, useVideoModeStore } from "@/stores/videoModeStore";
import { makeTrack } from "../helpers/music-fixtures";

const { attach, suspend } = vi.hoisted(() => ({
  attach: vi.fn(),
  suspend: vi.fn(),
}));

vi.mock("@/player/engine", () => ({
  getPlaybackEngine: () => ({ attach, suspend }),
}));

const track = makeTrack({ id: "youtube:aaa", providerId: "aaa", title: "Alpha" });

/**
 * Everything that can hold a sequential focus stop.
 *
 * The first version listed `a,button,input,select,textarea,[tabindex]` and asserted the parked
 * host contained none — which passed with a real `<iframe>` present. An iframe is a focus
 * navigation target in its own right, so the element the rule most needed to see was the one
 * it could not name. `contenteditable`, `summary`, `object`, `embed`, `audio`, and `video` are
 * in the same class.
 */
const TABBABLE =
  "a[href], button, input, select, textarea, iframe, audio, video, summary, object, embed, [tabindex], [contenteditable]";

/** The route `usePathname` reports; the host watches it to know when Now Playing is left. */
let currentPath = "/";
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    usePathname: () => currentPath,
  };
});

function state() {
  return usePlayerStore.getState();
}

async function seedSession() {
  const data = await getLocalData();
  await data.session.set({
    queue: [track],
    queueIndex: 0,
    positionSeconds: 42,
    repeatMode: "off",
    shuffle: false,
    volume: 0.55,
  });
}

beforeEach(() => {
  resetPlayerStore();
  resetNetworkStore();
  resetVideoModeStore();
  // The host watches the route, and the route mock reads this. Default to the route video mode
  // is reached from, so a test only has to change it when that is the point.
  currentPath = "/now-playing";
  localStorage.clear();
  clearPlaybackBridge();
  attach.mockClear();
  suspend.mockClear();
});

describe("PlayerHost boot and the parked host", () => {
  it("stays hostless while idle and never attaches the engine", () => {
    const { container } = render(<PlayerHost />);

    expect(container.querySelector('[data-testid="player-host"]')).toBeNull();
    expect(attach).not.toHaveBeenCalled();
  });

  it("restores a saved session cued-paused and parks the host", async () => {
    await seedSession();
    render(<PlayerHost />);

    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));

    // Restore: track, position, paused — never autoplay (spec).
    expect(state().currentTrack).toEqual(track);
    expect(state().status).toBe("paused");
    expect(state().positionSeconds).toBe(42);

    // The host owns the engine's container node.
    const host = screen.getByTestId("player-host");
    const target = host.firstElementChild?.firstElementChild as HTMLElement;
    expect(target).not.toBeNull();
    expect(attach).toHaveBeenCalledWith(target);
  });

  /**
   * The dock and its app-owned "Watch on YouTube" caption are gone for good, so
   * this asserts their absence rather than the absence of one particular id. A
   * caption pointing at a parked, invisible video was the duplication the change
   * set out to remove.
   */
  it("renders no floating video panel and no app-owned watch caption", async () => {
    await seedSession();
    const { container } = render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalled());

    expect(container.querySelector('[data-testid="player-dock"]')).toBeNull();
    expect(screen.queryByTestId("watch-on-youtube")).toBeNull();
    expect(container.textContent).not.toContain("Watch on YouTube");
  });

  it("applies the volume/mute boot preference at cold boot", async () => {
    localStorage.setItem("spotivibe.volume", JSON.stringify({ volume: 77, muted: true }));

    render(<PlayerHost />);
    await waitFor(() => expect(state().volume).toBe(77));
    expect(state().muted).toBe(true);
  });

  it("keeps exactly one host target across remounts", async () => {
    await seedSession();
    const first = render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));

    first.unmount();
    expect(suspend).toHaveBeenCalled();

    render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2));

    const host = screen.getByTestId("player-host");
    const surface = host.firstElementChild as HTMLElement;
    expect(surface.children).toHaveLength(1); // no second container accumulates
    expect(attach).toHaveBeenLastCalledWith(surface.firstElementChild);
  });

  /**
   * The parked state, asserted property by property rather than by one class.
   * Each of these is load-bearing: a 1x1 box that is not transparent still shows
   * a thumbnail, a transparent box that still takes pointer events still eats
   * clicks in the corner, and either one that reaches `display: none` risks an
   * unreliable player.
   */
  it("parks the player: 1x1, transparent, non-interactive, behind the app", async () => {
    await seedSession();
    render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalled());

    const host = screen.getByTestId("player-host");
    expect(host.dataset.videoMode).toBe("parked");
    // `h-px w-px` is 1x1; `fixed` keeps it out of the document flow so it never
    // reserves space; `z-0` puts it behind the shell's own layers.
    expect(host.className).toContain("h-px");
    expect(host.className).toContain("w-px");
    expect(host.className).toContain("fixed");
    expect(host.className).toContain("opacity-0");
    expect(host.className).toContain("pointer-events-none");
    expect(host.className).toContain("z-0");
    // Never display-hidden or destroyed: a display-none iframe is not rendered at
    // all and its internal state handling is unreliable across browsers. Matched
    // as whole Tailwind tokens, because `overflow-hidden` is a substring of neither
    // of the forbidden utilities but *is* a substring of the class string — a
    // naive `not.toContain("hidden")` fails on correct code, which is the same
    // defect a check written loosely would hide in the other direction.
    const parkedClasses = new Set(host.className.split(/\s+/));
    expect(parkedClasses.has("hidden")).toBe(false);
    expect(parkedClasses.has("invisible")).toBe(false);
    // Clipping is fine and wanted: the 1x1 box must not show a sliver of video.
    expect(parkedClasses.has("overflow-hidden")).toBe(true);
    // Hidden from assistive traversal, and no tab stop inside it.
    expect(host).toHaveAttribute("aria-hidden", "true");
    // The selector includes `iframe`, `contenteditable`, `summary`, and `object` because the
    // first version omitted them and the assertion passed with a real iframe present — and an
    // iframe *is* a sequential focus navigation target, so `pointer-events: none` and
    // `aria-hidden` do not remove it from the tab order. It was measurably the last tab stop
    // of the document while parked. `TABBABLE` is module-scoped so this assertion and the
    // iframe test below share one definition of "can hold focus".
    expect(
      host.querySelectorAll(TABBABLE),
      "the parked host must contain no tab stop",
    ).toHaveLength(0);
    // The selector is itself proven able to name an iframe, so it cannot silently stop
    // matching the element this assertion exists to exclude.
    const probe = document.createElement("div");
    probe.innerHTML = "<iframe title='p'></iframe><span tabindex='0'></span>";
    expect(probe.querySelectorAll(TABBABLE)).toHaveLength(2);
  });

  /**
   * The engine's own node is an iframe, and the test above cannot see one because the engine
   * is mocked here. So this is the check that actually covers the real DOM: with a genuine
   * iframe inside the host, the app must still take it out of the tab order.
   */

  it("removes the player's iframe from the tab order when the video is shown", async () => {
    await seedSession();
    render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));

    // Stand in for what `YT.Player` does to the engine's container: replace its contents
    // with an iframe, which is what lands in the document in production.
    const target = screen.getByTestId("player-host").firstElementChild
      ?.firstElementChild as HTMLElement;
    const iframe = document.createElement("iframe");
    iframe.title = "YouTube player";
    target.appendChild(iframe);

    // The default is a tab stop, which is the whole problem: `pointer-events: none` and
    // `aria-hidden` on the *host* do nothing for a descendant iframe's focusability. Measured
    // in a real browser, this node was the last tab stop of the entire document.
    expect(iframe.tabIndex, "an iframe is a tab stop by default, as in a real browser").toBe(0);

    act(() => useVideoModeStore.getState().setVisible(true));

    // The observer must find the node `YT.Player` added *after* construction, with no
    // re-render in between — which is the production order.
    await waitFor(() => expect(iframe.tabIndex).toBe(-1));
    expect(
      screen.getByTestId("player-host").querySelector("iframe")?.tabIndex,
      "the iframe itself must leave the tab order; tabIndex on the host is not enough",
    ).toBe(-1);
  });

  /**
   * Revealing the video must not create anything. Re-parenting an iframe reloads
   * it, which is what would restart playback — so the assertion is on the node
   * *identity* of the engine's container, not merely on the absence of a second
   * visible element.
   */
  it("reveals the same player instance for video mode without recreating it", async () => {
    await seedSession();
    render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1));

    const host = screen.getByTestId("player-host");
    const surface = host.firstElementChild as HTMLElement;
    const targetBefore = surface.firstElementChild;
    const attachesBefore = attach.mock.calls.length;

    act(() => useVideoModeStore.getState().setVisible(true));

    // Same host, same surface, same engine target — only the presentation moved.
    expect(screen.getByTestId("player-host")).toBe(host);
    expect(host.firstElementChild).toBe(surface);
    expect(surface.firstElementChild).toBe(targetBefore);
    expect(attach).toHaveBeenCalledTimes(attachesBefore);
    expect(host.dataset.videoMode).toBe("visible");
    expect(host.className).not.toContain("opacity-0");
    expect(host.className).not.toContain("pointer-events-none");
    expect(host.className).toContain("aspect-video");
    // Visible means interactive and not aria-hidden, and it clears the app's
    // chrome so nothing renders in front of the player.
    expect(host).not.toHaveAttribute("aria-hidden");

    act(() => useVideoModeStore.getState().setVisible(false));
    expect(host.dataset.videoMode).toBe("parked");
    expect(host.firstElementChild?.firstElementChild).toBe(targetBefore);
    expect(attach).toHaveBeenCalledTimes(attachesBefore);
  });

  /**
   * The navigation half, which was missing entirely.
   *
   * "Off when idle" is not the same as "off when you leave": the host lives in the shell, so
   * navigating from Now Playing to Home unmounts nothing. Verified in a real browser before this
   * test existed — a branded 640x360 panel followed the user onto `/`, and the only escape was
   * playback stopping completely.
   */
  it("re-parks when the user navigates away from Now Playing", async () => {
    currentPath = "/now-playing";
    await seedSession();
    render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalled());

    act(() => useVideoModeStore.getState().setVisible(true));
    expect(screen.getByTestId("player-host").dataset.videoMode).toBe("visible");

    // A client-side navigation: the same shell, the same host node, a different route.
    currentPath = "/";
    act(() => {
      usePlayerStore.setState({ currentTrack: { ...track } });
    });

    expect(useVideoModeStore.getState().visible, "leaving Now Playing must clear video mode").toBe(
      false,
    );
    const host = screen.getByTestId("player-host");
    expect(host.dataset.videoMode, "the host must return to the parked state").toBe("parked");
    expect(host.className, "and to the 1x1 transparent presentation").toContain("opacity-0");
    // Same node throughout: re-parking is presentation, not a remount.
    expect(attach).toHaveBeenCalledTimes(1);
  });

  it("clears video mode when the app goes idle, so a later visit never opens visible", async () => {
    await seedSession();
    render(<PlayerHost />);
    await waitFor(() => expect(attach).toHaveBeenCalled());

    act(() => useVideoModeStore.getState().setVisible(true));
    expect(useVideoModeStore.getState().visible).toBe(true);

    act(() => {
      usePlayerStore.setState({ currentTrack: null });
    });

    expect(useVideoModeStore.getState().visible).toBe(false);
  });

  it("skips restore when playback already started while it loaded", async () => {
    await seedSession();
    // Start playback before the async restore resolves.
    state().playTrack(track, [track]);

    render(<PlayerHost />);
    // Give the restore path time to resolve, then confirm it did not clobber.
    await waitFor(() => expect(attach).toHaveBeenCalled());
    expect(state().status).not.toBe("paused"); // user's loading state intact
    expect(state().currentTrack).toEqual(track); // same track, not reset
  });
});

describe("PlayerHost network wiring (task 8.5)", () => {
  function setOnLine(value: boolean): void {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
  }

  it("initializes the monitor and recovery once and detaches them on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    const { unmount } = render(<PlayerHost />);

    // Both cross-cutting inits run once on mount (design §9).
    expect(isNetworkMonitorActive()).toBe(true);
    expect(isNetworkRecoveryActive()).toBe(true);
    expect(addSpy.mock.calls.filter(([type]) => type === "online")).toHaveLength(1);
    expect(addSpy.mock.calls.filter(([type]) => type === "offline")).toHaveLength(1);
    addSpy.mockRestore();

    unmount();
    expect(isNetworkMonitorActive()).toBe(false);
    expect(isNetworkRecoveryActive()).toBe(false);

    // Detached: connectivity events no longer write the store.
    const before = useNetworkStore.getState().connection;
    setOnLine(false);
    window.dispatchEvent(new Event("offline"));
    expect(useNetworkStore.getState().connection).toBe(before);
    setOnLine(true);
  });

  it("recovers playback on reconnect while mounted and stops after unmount", () => {
    const { unmount } = render(<PlayerHost />);
    usePlayerStore.setState({
      currentTrack: track,
      status: "error",
      errorMessage: "Playback failed: 150",
      positionSeconds: 42,
      loadRequest: null,
    });

    useNetworkStore.getState().setConnection("offline");
    useNetworkStore.getState().setConnection("online");

    const retry = state().loadRequest;
    expect(retry).toMatchObject({ videoId: "aaa", startSeconds: 42, mode: "load" });
    expect(state().status).toBe("loading");
    expect(state().errorMessage).toBeNull();
    expect(retry!.token).toBeGreaterThan(0);

    unmount();
    useNetworkStore.getState().setConnection("offline");
    useNetworkStore.getState().setConnection("online");
    expect(state().loadRequest?.token).toBe(retry!.token); // no further retries
  });
});
