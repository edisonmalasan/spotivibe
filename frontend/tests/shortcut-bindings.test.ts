import "fake-indexeddb/auto";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  SEEK_STEP_SECONDS,
  SHORTCUT_BINDINGS,
  VOLUME_STEP,
  bindingFor,
  dispatchShortcut,
  type ShortcutContext,
} from "@/features/shortcuts/bindings";
import { getLocalData, type RepositorySet } from "@/data/localData";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import {
  clearPlaybackBridge,
  resetPlayerStore,
  setPlaybackBridge,
  usePlayerStore,
  type PlaybackBridge,
} from "@/stores/playerStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * The global binding set as data (M18 tasks 2.2–2.5, spec `keyboard-shortcuts`).
 *
 * Two properties are load-bearing and are asserted rather than described:
 *
 * 1. **Every binding goes through the store's own action.** That is proven through
 *    a fake {@link PlaybackBridge} — the store's only channel to the player. A
 *    shortcut that wrote state directly would change `positionSeconds` without the
 *    engine ever being told, and every assertion below would still pass; these
 *    would not.
 * 2. **Every binding is gated by the local-meaning guard.** Asserted as the whole
 *    table crossed with every guarded surface type, so a binding added next year
 *    cannot reach `run` without passing the guard first.
 */

/**
 * The store's only channel to the player, recorded. Every binding assertion about
 * "routed through the store's own action" is really an assertion about this object
 * being told: a shortcut that wrote state directly would move `positionSeconds`
 * while the engine heard nothing at all.
 */
type Recorder = PlaybackBridge & {
  play: Mock<() => void>;
  pause: Mock<() => void>;
  seekTo: Mock<(seconds: number) => void>;
  setVolume: Mock<(volume: number) => void>;
  setMuted: Mock<(muted: boolean) => void>;
};

let bridge: Recorder;
let context: ShortcutContext;
let setHelpOpen: Mock<(open: boolean) => void>;
let isHelpOpen: Mock<() => boolean>;
let repositories: RepositorySet;

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

/** Dispatch a real keydown at `target`, then hand the same event to the dispatcher. */
function press(
  target: Element,
  key: string,
  init: KeyboardEventInit = {},
): { ran: boolean; event: KeyboardEvent } {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return { ran: dispatchShortcut(event, context), event };
}

beforeEach(async () => {
  resetPlayerStore();
  resetLibraryStore();
  bridge = {
    play: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    seekTo: vi.fn<(seconds: number) => void>(),
    setVolume: vi.fn<(volume: number) => void>(),
    setMuted: vi.fn<(muted: boolean) => void>(),
  };
  setPlaybackBridge(bridge);
  setHelpOpen = vi.fn<(open: boolean) => void>();
  isHelpOpen = vi.fn<() => boolean>(() => false);
  context = { setHelpOpen, isHelpOpen };
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  document.body.innerHTML = "";
  clearPlaybackBridge();
  resetPlayerStore();
  resetLibraryStore();
});

describe("the binding table", () => {
  it("gives every binding a stable, unique id, so help cannot overwrite a row", () => {
    const ids = SHORTCUT_BINDINGS.map((binding) => binding.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it("answers to every key it lists, and to nothing else", () => {
    // The `keys` field is doubled as help copy. If a listed key were not a value
    // the matcher recognises, the help dialog would document a key nobody has.
    for (const binding of SHORTCUT_BINDINGS) {
      expect(binding.keys.length, `${binding.id} must name a key`).toBeGreaterThan(0);
      for (const key of binding.keys) {
        const owner = bindingFor(new KeyboardEvent("keydown", { key }));
        expect(owner?.id, `${binding.id} must claim ${key}`).toBe(binding.id);
      }
    }
    // And the platform's own spelling of the space bar is honoured, not only the
    // legacy one the table lists.
    expect(bindingFor(new KeyboardEvent("keydown", { key: " " }))?.id).toBe("play-pause");
  });

  it("binds each key to exactly one binding, so dispatch is unambiguous", () => {
    const seen = new Map<string, string>();
    for (const binding of SHORTCUT_BINDINGS) {
      for (const key of binding.keys) {
        expect(seen.has(key), `${key} is claimed twice`).toBe(false);
        seen.set(key, binding.id);
      }
    }
  });

  it("declares every binding the milestone's behaviour table requires", () => {
    // The set is fixed (custom bindings are an explicit non-goal), so it is
    // asserted rather than described: a milestone that quietly dropped seeking or
    // added a sixth playback key would otherwise read as complete.
    expect(SHORTCUT_BINDINGS.map((binding) => binding.id)).toEqual([
      "play-pause",
      "seek-back",
      "seek-forward",
      "volume-up",
      "volume-down",
      "mute",
      "like",
      "help",
      "help-dismiss",
    ]);
  });

  it("documents its steps in the copy the help surface shows", () => {
    const seek = SHORTCUT_BINDINGS.find((binding) => binding.id === "seek-forward");
    const volume = SHORTCUT_BINDINGS.find((binding) => binding.id === "volume-up");
    // "by the documented step" — the step has to be a number the listener can read
    // off the help dialog, not one they have to guess.
    expect(seek?.label).toContain(String(SEEK_STEP_SECONDS));
    expect(volume?.label).toContain(String(VOLUME_STEP));
  });
});

describe("play and pause", () => {
  it("toggles between playing and paused, through the store's actions", () => {
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({ currentTrack: makeTrack(), status: "playing" });

    expect(press(query(host), " ").ran).toBe(true);
    expect(usePlayerStore.getState().status).toBe("paused");
    expect(bridge.pause).toHaveBeenCalledTimes(1);

    expect(press(query(host), " ").ran).toBe(true);
    expect(usePlayerStore.getState().status).toBe("buffering");
    expect(bridge.play).toHaveBeenCalledTimes(1);
  });

  it("does nothing with no track loaded", () => {
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({ currentTrack: null, status: "idle" });

    press(query(host), " ");
    expect(usePlayerStore.getState().status).toBe("idle");
    expect(bridge.play).not.toHaveBeenCalled();
  });
});

describe("seeking", () => {
  it("moves by the documented step and tells the engine", () => {
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({
      currentTrack: makeTrack(),
      positionSeconds: 100,
      durationSeconds: 249,
    });

    expect(press(query(host), "ArrowRight").ran).toBe(true);
    expect(usePlayerStore.getState().positionSeconds).toBe(100 + SEEK_STEP_SECONDS);
    expect(bridge.seekTo).toHaveBeenLastCalledWith(100 + SEEK_STEP_SECONDS);

    press(query(host), "ArrowLeft");
    expect(usePlayerStore.getState().positionSeconds).toBe(100);
  });

  it("clamps to the track's own bounds rather than running past either end", () => {
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({
      currentTrack: makeTrack(),
      positionSeconds: 5,
      durationSeconds: 249,
    });

    press(query(host), "ArrowLeft");
    expect(usePlayerStore.getState().positionSeconds).toBe(0);
    expect(bridge.seekTo).toHaveBeenLastCalledWith(0);

    usePlayerStore.setState({ positionSeconds: 245, durationSeconds: 249 });
    press(query(host), "ArrowRight");
    expect(usePlayerStore.getState().positionSeconds).toBe(249);
    expect(bridge.seekTo).toHaveBeenLastCalledWith(249);
  });
});

describe("volume", () => {
  it("adjusts by the documented step, clamped to its own bounds", () => {
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({ volume: 50 });

    press(query(host), "ArrowUp");
    expect(usePlayerStore.getState().volume).toBe(55);
    expect(bridge.setVolume).toHaveBeenLastCalledWith(55);

    press(query(host), "ArrowDown");
    expect(usePlayerStore.getState().volume).toBe(50);

    usePlayerStore.setState({ volume: 98 });
    press(query(host), "ArrowUp");
    expect(usePlayerStore.getState().volume).toBe(100);

    usePlayerStore.setState({ volume: 2 });
    press(query(host), "ArrowDown");
    expect(usePlayerStore.getState().volume).toBe(0);
  });

  it("unmutes as well as getting louder, so the keypress is audible", () => {
    // `setVolume` does not clear `muted` — the store keeps the two independent —
    // so without this the key would change a number the listener cannot hear.
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({ volume: 40, muted: true });

    expect(press(query(host), "ArrowUp").ran).toBe(true);
    expect(usePlayerStore.getState().volume).toBe(45);
    expect(usePlayerStore.getState().muted).toBe(false);
    expect(bridge.setMuted).toHaveBeenLastCalledWith(false);
  });

  it("leaves mute alone when the volume is lowered", () => {
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({ volume: 40, muted: true });

    press(query(host), "ArrowDown");
    expect(usePlayerStore.getState().volume).toBe(35);
    expect(usePlayerStore.getState().muted).toBe(true);
  });
});

describe("mute", () => {
  it("toggles the player's real muted state and leaves the volume untouched", () => {
    // Lyrix's shortcut faked this by writing volume 0 and restoring a hardcoded
    // 70 on the next press. This asserts the two properties that fake destroyed:
    // the real flag flips, and the listener's own volume does not move.
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({ volume: 37, muted: false });

    expect(press(query(host), "M").ran).toBe(true);
    expect(usePlayerStore.getState().muted).toBe(true);
    expect(usePlayerStore.getState().volume).toBe(37);
    expect(bridge.setMuted).toHaveBeenLastCalledWith(true);

    press(query(host), "m"); // case-insensitive: a listener may not hold Shift
    expect(usePlayerStore.getState().muted).toBe(false);
    expect(usePlayerStore.getState().volume).toBe(37);
    expect(bridge.setMuted).toHaveBeenLastCalledWith(false);
  });
});

describe("like", () => {
  it("toggles the liked state of the now-playing track", async () => {
    const host = mount(`<div id="page">Home</div>`);
    const track = makeTrack();
    usePlayerStore.setState({ currentTrack: track });
    await useLibraryStore.getState().hydrate();

    expect(press(query(host), "L").ran).toBe(true);
    await waitFor(() => {
      expect(useLibraryStore.getState().likedIds.has(track.id)).toBe(true);
    });
    // The full record is re-read, not just the id set: `toggleLike` refreshes both,
    // and a shortcut that only poked the set would leave Liked Songs empty.
    expect(useLibraryStore.getState().likedTracks.map((entry) => entry.id)).toEqual([track.id]);

    press(query(host), "L");
    await waitFor(() => {
      expect(useLibraryStore.getState().likedIds.has(track.id)).toBe(false);
    });
  });

  it("does nothing with no track playing", async () => {
    const host = mount(`<div id="page">Home</div>`);
    usePlayerStore.setState({ currentTrack: null });
    await useLibraryStore.getState().hydrate();

    // `getLocalData()` memoises one connection, so this is the very object
    // `libraryStore` writes through — which makes the observation synchronous at the
    // point the decision is taken, rather than a race against the write.
    const like = vi.spyOn(repositories.likedTracks, "like");
    const unlike = vi.spyOn(repositories.likedTracks, "unlike");

    // The keypress is still *handled* — it is a real binding — but there is no
    // track for it to act on, so nothing is liked or unliked.
    expect(press(query(host), "L").ran).toBe(true);

    // **The window is deliberate, and the first version of this test did not have
    // one.** `toggleLike` is asynchronous, so a like written a tick later leaves the
    // library empty *at the moment it is asserted* — and a "nothing happened"
    // assertion made too early passes for the wrong reason. Polling with
    // `waitFor` does not help either: the first poll succeeds, so it never polls
    // again. The write has to be given a window an in-memory IndexedDB transaction
    // cannot need, and then it has to be asserted absent.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(like).not.toHaveBeenCalled();
    expect(unlike).not.toHaveBeenCalled();
    expect(await repositories.likedTracks.list()).toEqual([]);
    expect(useLibraryStore.getState().likedTracks).toEqual([]);

    like.mockRestore();
    unlike.mockRestore();
  });
});

describe("help", () => {
  it("opens the help surface from the keyboard", () => {
    const host = mount(`<div id="page">Home</div>`);
    expect(press(query(host), "?").ran).toBe(true);
    expect(setHelpOpen).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("closes the help surface with Escape, and only that", () => {
    const host = mount(`<div id="page">Home</div>`);
    isHelpOpen.mockReturnValue(true);

    expect(press(query(host), "Escape").ran).toBe(true);
    expect(setHelpOpen).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("leaves Escape alone when help is already closed", () => {
    // Design decision 2: the global handler does not own `Escape` dismissal. A
    // fallback here would act a second time on a menu that closed itself, or on a
    // keypress a surface had already handled.
    const host = mount(`<div id="page">Home</div>`);
    isHelpOpen.mockReturnValue(false);

    expect(press(query(host), "Escape").ran).toBe(true);
    expect(setHelpOpen).not.toHaveBeenCalled();
  });
});

describe("platform chords", () => {
  /** The modifiers that belong to the browser or the OS, never to us. */
  const CHORD_MODIFIERS = ["ctrlKey", "metaKey", "altKey"] as const;

  it("answers nothing while Ctrl, Cmd, or Alt is held, for every binding in the table", () => {
    // `Cmd+M` minimises and `Ctrl+L` focuses the address bar on real platforms.
    //
    // The sweep is over the WHOLE table rather than over `M` and `L`. An earlier
    // version of this test named two bindings, and an independent review found the
    // rest untested — which is the shape of the defect this milestone exists to
    // prevent, appearing inside its own evidence. A binding added later is exactly
    // the one nobody thinks to check by hand.
    for (const binding of SHORTCUT_BINDINGS) {
      for (const key of binding.keys) {
        for (const modifier of CHORD_MODIFIERS) {
          expect(
            bindingFor(new KeyboardEvent("keydown", { key, [modifier]: true })),
            `${binding.id} must answer nothing for ${key} with ${modifier}`,
          ).toBeNull();
        }
      }
    }
  });

  it("still answers every binding while Shift is held", () => {
    // Shift is deliberately NOT a chord, and both reasons are load-bearing.
    //
    // The help key is `Shift+/`: `?` arrives as `key: "?"` with `shiftKey` true on
    // every current engine. Treating shift as a chord would therefore make `?`
    // unreachable — and `?` is the only way to discover that the other bindings
    // exist, so the mistake would remove the feature's own documentation rather
    // than merely break a key.
    //
    // Separately, a capitalised letter arrives with `shiftKey` true, so excluding
    // shift would break `M` and `L` for anyone holding shift or with caps lock on.
    for (const binding of SHORTCUT_BINDINGS) {
      for (const key of binding.keys) {
        expect(
          bindingFor(new KeyboardEvent("keydown", { key, shiftKey: true })),
          `${binding.id} must still answer ${key} with shift held`,
        ).toBe(binding);
      }
    }
  });

  it("opens help with the key the way a keyboard actually delivers it", () => {
    // Asserted through the dispatcher as well as the matcher, because the scenario
    // is about the key reaching the help *surface* and not merely about a lookup
    // succeeding. A matcher-only assertion would pass while the dispatcher dropped it.
    const host = mount(`<div id="page">Home</div>`);

    expect(press(query(host), "?", { shiftKey: true }).ran).toBe(true);
    expect(setHelpOpen).toHaveBeenCalledWith(true);
  });

  it("fires nothing in the real dispatcher while a chord is held", () => {
    const host = mount(`<div id="page">Home</div>`);

    expect(press(query(host), "M", { ctrlKey: true }).ran).toBe(false);
    expect(press(query(host), "ArrowRight", { metaKey: true }).ran).toBe(false);
    expect(usePlayerStore.getState().muted).toBe(false);
    expect(setHelpOpen).not.toHaveBeenCalled();
  });
});

describe("the guard is consulted before every binding", () => {
  /** One surface per guarded type, aimed at the element a keypress would reach. */
  const GUARDED_SURFACES: Array<{ name: string; html: string; selector: string }> = [
    { name: "input", html: `<input />`, selector: "input" },
    { name: "textarea", html: `<textarea></textarea>`, selector: "textarea" },
    { name: "select", html: `<select><option>a</option></select>`, selector: "select" },
    {
      name: "contenteditable",
      html: `<div contenteditable="true"><span>x</span></div>`,
      selector: "span",
    },
    {
      name: "slider",
      html: `<div role="slider" tabindex="0"><span>x</span></div>`,
      selector: "span",
    },
    {
      name: "spinbutton",
      html: `<div role="spinbutton" tabindex="0"></div>`,
      selector: "[role='spinbutton']",
    },
    {
      name: "dialog",
      html: `<div role="dialog" aria-modal="true"><button>x</button></div>`,
      selector: "button",
    },
    {
      name: "menu",
      html: `<div role="menu"><button role="menuitem">x</button></div>`,
      selector: "button",
    },
  ];

  it("declares every surface the spec names, so the sweep below cannot be partial", () => {
    expect(GUARDED_SURFACES.map((surface) => surface.name)).toEqual([
      "input",
      "textarea",
      "select",
      "contenteditable",
      "slider",
      "spinbutton",
      "dialog",
      "menu",
    ]);
  });

  it("fires no binding of the whole table under any guarded surface", () => {
    const track = makeTrack();
    for (const surface of GUARDED_SURFACES) {
      const host = mount(surface.html);
      const target = host.querySelector(surface.selector);
      if (!target) throw new Error(`fixture ${surface.name} is missing ${surface.selector}`);

      for (const binding of SHORTCUT_BINDINGS) {
        for (const key of binding.keys) {
          // The player is fully live — track loaded, playing, volume off-default,
          // mid-queue — so a binding that did fire would be visible in state.
          usePlayerStore.setState({
            currentTrack: track,
            status: "playing",
            positionSeconds: 42,
            durationSeconds: 249,
            volume: 63,
            muted: false,
          });
          isHelpOpen.mockReturnValue(true);
          const before = { ...usePlayerStore.getState() };

          const { ran, event } = press(target, key);

          expect(ran, `${binding.id} (${key}) must not fire inside ${surface.name}`).toBe(false);
          expect(
            usePlayerStore.getState().positionSeconds,
            `${binding.id} (${key}) must not seek inside ${surface.name}`,
          ).toBe(before.positionSeconds);
          expect(
            usePlayerStore.getState().volume,
            `${binding.id} (${key}) must not change volume inside ${surface.name}`,
          ).toBe(before.volume);
          expect(
            usePlayerStore.getState().muted,
            `${binding.id} (${key}) must not mute inside ${surface.name}`,
          ).toBe(false);
          expect(
            setHelpOpen,
            `${binding.id} (${key}) must not touch help inside ${surface.name}`,
          ).not.toHaveBeenCalled();
          // The key was not swallowed either: a guarded keypress belongs to the
          // surface that owns it, and swallowing it would be its own defect.
          expect(event.defaultPrevented).toBe(false);
          setHelpOpen.mockClear();
        }
      }

      host.remove();
    }

    expect(bridge.play).not.toHaveBeenCalled();
    expect(bridge.pause).not.toHaveBeenCalled();
    expect(bridge.seekTo).not.toHaveBeenCalled();
    expect(bridge.setVolume).not.toHaveBeenCalled();
    expect(bridge.setMuted).not.toHaveBeenCalled();
  });

  it("fires the same binding when the same key arrives at an unguarded element", () => {
    // The mirror of the sweep above, and the guard on the guard: a dispatcher that
    // returned `false` for everything would satisfy it perfectly.
    const host = mount(`<div id="page">Home</div>`);
    expect(press(query(host), "?").ran).toBe(true);
    expect(setHelpOpen).toHaveBeenCalledWith(true);
    expect(press(query(host), "Shift").ran).toBe(false);
  });

  it("takes over the scrolling keys it binds, and only those", () => {
    const host = mount(`<div id="page">Home</div>`);

    // `Space` and the arrows scroll by default; a shortcut that also scrolled the
    // page would read as broken.
    for (const key of [" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(press(query(host), key).event.defaultPrevented, key).toBe(true);
    }
    // Escape's default action is leaving fullscreen, which belongs to the listener
    // even when the binding declines to act.
    expect(press(query(host), "Escape").event.defaultPrevented).toBe(false);
    expect(press(query(host), "M").event.defaultPrevented).toBe(false);
  });
});

function query(host: HTMLElement): Element {
  const found = host.querySelector("#page") ?? host.firstElementChild;
  if (!found) throw new Error("fixture is missing its target");
  return found;
}
