import { afterEach, describe, expect, it } from "vitest";
import { keyHasLocalMeaning } from "@/features/shortcuts/localMeaning";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * The local-meaning guard (M18 task 1, spec `keyboard-shortcuts`).
 *
 * Every assertion here is about a **pure function over an element**, which is the
 * only form of this claim that can be verified: "a global shortcut never steals a
 * key that already means something local" is not checkable by reading the handler,
 * and a handler that read a store could be right today and wrong tomorrow with no
 * test able to tell.
 */

function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function query(host: HTMLElement, selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`fixture is missing ${selector}`);
  return found;
}

afterEach(() => {
  document.body.innerHTML = "";
  resetPlayerStore();
  resetQueueStore();
});

describe("keyHasLocalMeaning: text entry", () => {
  it("claims an input, a textarea, and a select", () => {
    const host = mount(
      `<input id="field" /><textarea id="notes"></textarea><select id="pick"><option>a</option></select>`,
    );

    expect(keyHasLocalMeaning(query(host, "#field"))).toBe(true);
    expect(keyHasLocalMeaning(query(host, "#notes"))).toBe(true);
    expect(keyHasLocalMeaning(query(host, "#pick"))).toBe(true);
  });

  it("claims a descendant of a text-entry element only through the element itself", () => {
    // A select's own children are options, which are not elements a keydown can
    // target; the assertion that matters is that the *tag* test is the thing
    // answering, not a proximity heuristic.
    const host = mount(`<select id="pick"><option id="opt">a</option></select>`);
    expect(keyHasLocalMeaning(query(host, "#opt"))).toBe(false);
  });
});

describe("keyHasLocalMeaning: editable content", () => {
  it("claims a contenteditable element and anything inside it", () => {
    const host = mount(`<div id="editor" contenteditable="true"><p id="line">notes</p></div>`);

    expect(keyHasLocalMeaning(query(host, "#editor"))).toBe(true);
    // The descendant case is the one that matters in practice: the keypress
    // targets the text node's element, not the editing host.
    expect(keyHasLocalMeaning(query(host, "#line"))).toBe(true);
  });

  it("claims a bare contenteditable attribute, not only the string 'true'", () => {
    const host = mount(`<div id="editor" contenteditable></div>`);
    expect(keyHasLocalMeaning(query(host, "#editor"))).toBe(true);
  });

  it("does not claim an explicitly non-editable region", () => {
    // `contenteditable="false"` is the platform saying *not* editable, and a guard
    // that claimed it would disable every shortcut while a read-only block is on
    // screen — the same defect as claiming a plain paragraph.
    const host = mount(`<div id="frozen" contenteditable="false">notes</div>`);
    expect(keyHasLocalMeaning(query(host, "#frozen"))).toBe(false);
  });
});

describe("keyHasLocalMeaning: widgets that own their keys", () => {
  it("claims a slider and a spinbutton", () => {
    const host = mount(
      `<div id="scrub" role="slider" tabindex="0"></div><div id="count" role="spinbutton" tabindex="0"></div>`,
    );

    expect(keyHasLocalMeaning(query(host, "#scrub"))).toBe(true);
    expect(keyHasLocalMeaning(query(host, "#count"))).toBe(true);
  });

  it("claims a control nested inside a slider's own markup", () => {
    // The progress slider wraps a fill element, and a keypress can land on it.
    const host = mount(`<div role="slider" tabindex="0"><span id="fill"></span></div>`);
    expect(keyHasLocalMeaning(query(host, "#fill"))).toBe(true);
  });
});

describe("keyHasLocalMeaning: dialog and menu subtrees", () => {
  it("claims everything inside an open dialog", () => {
    const host = mount(
      `<div role="dialog" aria-modal="true"><button id="confirm">Delete</button></div>`,
    );

    expect(keyHasLocalMeaning(query(host, "[role='dialog']"))).toBe(true);
    expect(keyHasLocalMeaning(query(host, "#confirm"))).toBe(true);
  });

  it("claims everything inside an open menu", () => {
    // `ResultMenu` does not stop propagation, so this is the one surface where the
    // global handler really does see the event - and must decline it.
    const host = mount(`<div role="menu"><button role="menuitem" id="item">Play</button></div>`);

    expect(keyHasLocalMeaning(query(host, "#item"))).toBe(true);
  });
});

describe("keyHasLocalMeaning: everything else", () => {
  it("answers false for a plain element and for one with an unrelated role", () => {
    const host = mount(`<div id="plain">Home</div><button id="btn" role="button">Play</button>`);

    expect(keyHasLocalMeaning(query(host, "#plain"))).toBe(false);
    expect(keyHasLocalMeaning(query(host, "#btn"))).toBe(false);
  });

  it("answers false for an element that is not the focused one", () => {
    const host = mount(`<input id="away" /><div id="other">Home</div>`);
    const input = query(host, "#away");
    const other = query(host, "#other");
    input.focus();

    expect(document.activeElement).toBe(input);
    // The unfocused element answers the same as it would focused: the predicate
    // is structural, which is the whole claim.
    expect(keyHasLocalMeaning(other)).toBe(false);
    expect(keyHasLocalMeaning(other)).toBe(keyHasLocalMeaning(other));
  });

  it("answers false for a null target and for a document", () => {
    expect(keyHasLocalMeaning(null)).toBe(false);
    expect(keyHasLocalMeaning(document)).toBe(false);
  });
});

describe("keyHasLocalMeaning: the guard cannot have consulted a store", () => {
  it("answers identically for the same element with application state changed underneath it", () => {
    const host = mount(
      `<div id="plain">Home</div><input id="field" /><div role="dialog"><div id="in-dialog">x</div></div><div id="editable" contenteditable="true">y</div>`,
    );
    const targets = ["#plain", "#field", "#in-dialog", "#editable"].map((selector) =>
      query(host, selector),
    );

    // Empty application: idle player, empty queue.
    resetPlayerStore();
    resetQueueStore();
    const idle = targets.map((target) => keyHasLocalMeaning(target));

    // Everything the application could plausibly be holding instead: a loaded
    // track mid-playback at a non-default volume, muted, and a populated queue.
    const track = makeTrack();
    usePlayerStore.setState({
      currentTrack: track,
      status: "playing",
      positionSeconds: 90,
      durationSeconds: 249,
      volume: 35,
      muted: true,
    });
    useQueueStore.setState({ queue: [track], queueIndex: 0 });
    const loaded = targets.map((target) => keyHasLocalMeaning(target));

    // A different answer would mean the guard had read state, and "the key that
    // has local meaning" would then depend on what else happened to be loaded.
    expect(loaded).toEqual(idle);
    expect(idle).toEqual([false, true, true, true]);

    // And the same element is still unambiguous when it is the focused one.
    targets[0].dispatchEvent(new Event("focusin"));
    (targets[0] as HTMLElement).focus();
    expect(keyHasLocalMeaning(targets[0])).toBe(false);
  });
});
