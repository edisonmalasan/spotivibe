import "fake-indexeddb/auto";
import { configure, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { SHORTCUT_BINDINGS } from "@/features/shortcuts/bindings";
import { ResultMenu } from "@/features/search/ResultMenu";
import { DeletePlaylistDialog } from "@/features/playlists/DeletePlaylistDialog";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetPlayerStore, setPlaybackBridge, usePlayerStore } from "@/stores/playerStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * The global listener mounted by the shell, and the help surface it opens
 * (M18 tasks 2.1 and 3.2–3.3, spec `keyboard-shortcuts`).
 *
 * The bindings themselves are proven in `shortcut-bindings.test.ts`; what is proven
 * here is the part only the mounted listener can show:
 *
 * - it is attached **once**, in the bubble phase on `document`;
 * - the seven pre-existing per-component key handlers keep precedence over it,
 *   which is the whole justification for the bubble phase (design decision 2);
 * - the help dialog's contents are the binding table, not a transcription of it.
 */

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
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
}));

configure({ asyncUtilTimeout: 5000 });

const HELP_TITLE = "Keyboard shortcuts";

function helpDialog(): HTMLElement {
  return screen.getByRole("dialog", { name: HELP_TITLE });
}

/** Every listed binding, in render order. */
function listedBindings(): HTMLElement[] {
  return Array.from(helpDialog().querySelectorAll<HTMLElement>("[data-shortcut-id]"));
}

beforeEach(() => {
  resetPlayerStore();
  resetLibraryStore();
  setPlaybackBridge({
    play: vi.fn(),
    pause: vi.fn(),
    seekTo: vi.fn(),
    setVolume: vi.fn(),
    setMuted: vi.fn(),
  });
});

afterEach(() => {
  resetPlayerStore();
  resetLibraryStore();
});

describe("the listener mounted by the shell", () => {
  it("attaches a single keydown listener, so one keypress is one action", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    try {
      render(<AppShell>page</AppShell>);

      const keydownAdds = add.mock.calls.filter(([type]) => type === "keydown");
      expect(keydownAdds.length).toBe(1);

      const bridge = {
        play: vi.fn(),
        pause: vi.fn(),
        seekTo: vi.fn(),
        setVolume: vi.fn(),
        setMuted: vi.fn(),
      };
      setPlaybackBridge(bridge);
      usePlayerStore.setState({ currentTrack: makeTrack(), status: "playing" });
      fireEvent.keyDown(document.body, { key: " " });

      // Twice would mean the store was told to pause and a second handler ran on
      // the same press — the symptom of an effect that re-attached on every render.
      expect(bridge.pause).toHaveBeenCalledTimes(1);

      const keydownRemoves = remove.mock.calls.filter(([type]) => type === "keydown");
      expect(keydownRemoves.length).toBeLessThanOrEqual(keydownAdds.length);
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it("drives playback from an ordinary element", () => {
    render(<AppShell>page</AppShell>);
    usePlayerStore.setState({
      currentTrack: makeTrack(),
      status: "playing",
      positionSeconds: 30,
      durationSeconds: 249,
    });

    fireEvent.keyDown(document.body, { key: " " });
    expect(usePlayerStore.getState().status).toBe("paused");

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(usePlayerStore.getState().positionSeconds).toBe(40);
  });
});

describe("the help surface", () => {
  it("opens from the keyboard and lists every binding in the table", () => {
    render(<AppShell>page</AppShell>);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(document.body, { key: "?" });
    const dialog = helpDialog();
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // Length, keys, and identities are all compared, because each fails differently:
    // a length mismatch means a row was dropped, a key mismatch means the row is
    // wrong, and an identity mismatch means two rows are fighting over one key.
    const listed = listedBindings();
    expect(listed).toHaveLength(SHORTCUT_BINDINGS.length);
    expect(listed.map((row) => row.getAttribute("data-shortcut-id"))).toEqual(
      SHORTCUT_BINDINGS.map((binding) => binding.id),
    );
    expect(listed.map((row) => row.getAttribute("data-shortcut-keys"))).toEqual(
      SHORTCUT_BINDINGS.map((binding) => binding.keys.join(" ")),
    );
  });

  it("shows the key a binding answers to, as text a listener can read", () => {
    render(<AppShell>page</AppShell>);
    fireEvent.keyDown(document.body, { key: "?" });

    const rows = listedBindings();
    expect(rows[0].querySelector("kbd")?.textContent).toBe("Space");
    const seekForward = SHORTCUT_BINDINGS.find((binding) => binding.id === "seek-forward");
    const row = rows.find((entry) => entry.getAttribute("data-shortcut-id") === "seek-forward");
    expect(row?.textContent).toContain(seekForward?.label ?? "");
  });

  it("gives every listed binding a unique identity, so no row overwrites another", () => {
    render(<AppShell>page</AppShell>);
    fireEvent.keyDown(document.body, { key: "?" });

    const ids = listedBindings().map((row) => row.getAttribute("data-shortcut-id"));
    // React reuses a duplicate key silently apart from a development warning, which
    // is exactly the "silently overwritten" the stable key exists to prevent.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is reachable by pointer as well as by key", () => {
    render(<AppShell>page</AppShell>);

    fireEvent.click(screen.getByRole("button", { name: HELP_TITLE }));
    expect(helpDialog()).toBeInTheDocument();

    // The same dialog, not a second one.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(listedBindings()).toHaveLength(SHORTCUT_BINDINGS.length);
  });

  it("restores focus to the control that opened it", () => {
    render(<AppShell>page</AppShell>);

    const trigger = screen.getByRole("button", { name: HELP_TITLE });
    trigger.focus();
    fireEvent.click(trigger);
    expect(helpDialog().contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses by key, by its close control, and by the backdrop — once each", () => {
    const paths: Array<[string, () => void]> = [
      [
        "key",
        () =>
          fireEvent.keyDown(
            document.querySelector("[data-testid='dialog-panel']") ?? document.body,
            { key: "Escape" },
          ),
      ],
      ["close control", () => fireEvent.click(screen.getByRole("button", { name: "Close" }))],
      ["backdrop", () => fireEvent.mouseDown(screen.getByTestId("dialog-backdrop"))],
    ];

    for (const [name, dismiss] of paths) {
      const { unmount } = render(<AppShell>page</AppShell>);
      fireEvent.keyDown(document.body, { key: "?" });
      expect(helpDialog(), name).toBeInTheDocument();

      dismiss();
      expect(screen.queryByRole("dialog"), name).toBeNull();
      unmount();
    }
  });

  it("keeps focus inside while it is open", () => {
    render(<AppShell>page</AppShell>);
    fireEvent.keyDown(document.body, { key: "?" });

    const close = within(helpDialog()).getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(close, { key: "Tab" });

    // Whatever the cycle chose, it is inside the dialog rather than out on the
    // page behind it — the defect every one of the five hand-rolled dialogs has.
    expect(helpDialog().contains(document.activeElement)).toBe(true);
  });
});

describe("pre-existing key handlers keep precedence", () => {
  it("lets the progress slider keep its own arrow keys", () => {
    // Set before rendering: the slider reads the store through a subscription, so a
    // store set after the render would leave the handler holding a stale "no track".
    usePlayerStore.setState({
      currentTrack: makeTrack(),
      positionSeconds: 30,
      durationSeconds: 249,
    });
    render(<AppShell>page</AppShell>);

    const slider = screen.getByTestId("progress-slider");
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });

    // The slider's own step is 5 s; the global seek binding is 10 s. If the global
    // handler had also fired, the position would have moved 15 s.
    expect(usePlayerStore.getState().positionSeconds).toBe(35);
  });

  it("lets an open dialog keep its own dismissal", () => {
    const onClose = vi.fn();
    usePlayerStore.setState({
      currentTrack: makeTrack(),
      positionSeconds: 30,
      durationSeconds: 249,
    });
    render(
      <AppShell>
        <DeletePlaylistDialog name="Road trip" onConfirm={async () => {}} onClose={onClose} />
      </AppShell>,
    );

    const cancel = screen.getByRole("button", { name: "Cancel" });

    // `DeletePlaylistDialog` calls `stopPropagation()` on Escape, so a bubble-phase
    // listener on `document` never sees the keypress at all. That is the design: "no
    // shortcuts while a modal owns the keyboard" comes from code that already existed
    // and was already tested, not from precedence re-implemented in the listener.
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    // And a key the dialog does *not* handle is still not answered globally, because
    // the target is inside its `[role="dialog"]` subtree.
    fireEvent.keyDown(cancel, { key: "ArrowLeft" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: HELP_TITLE })).toBeNull();
    expect(usePlayerStore.getState().positionSeconds).toBe(30);
  });

  it("lets an open menu close itself exactly once, and does nothing else", () => {
    render(
      <AppShell>
        <ResultMenu track={makeTrack()} isLiked={false} onPlay={vi.fn()} onToggleLike={vi.fn()} />
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More options for Get Lucky" }));
    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();

    // `ResultMenu` does *not* stop propagation, so the global listener really does
    // see this `Escape`. Declining it is the guard's work, not the event's order.
    const item = within(menu).getByRole("menuitem", { name: "Play" });
    item.focus();
    fireEvent.keyDown(item, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    // Neither help opened (the `?` binding) nor help closed, nor any transport ran.
    expect(screen.queryByRole("dialog", { name: HELP_TITLE })).toBeNull();
    expect(usePlayerStore.getState().positionSeconds).toBe(0);
  });

  it("does not answer a search field's keystrokes", () => {
    render(<AppShell>page</AppShell>);
    usePlayerStore.setState({
      currentTrack: makeTrack(),
      status: "playing",
      positionSeconds: 30,
      durationSeconds: 249,
    });

    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();

    fireEvent.keyDown(field, { key: " " });
    fireEvent.keyDown(field, { key: "ArrowRight" });
    fireEvent.keyDown(field, { key: "?" });

    expect(usePlayerStore.getState().status).toBe("playing");
    expect(usePlayerStore.getState().positionSeconds).toBe(30);
    expect(screen.queryByRole("dialog")).toBeNull();
    field.remove();
  });
});
