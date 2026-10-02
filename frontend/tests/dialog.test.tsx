import { configure, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/design-system/Dialog";

/**
 * The modal dialog primitive (M18 task 3.1, spec `keyboard-shortcuts`).
 *
 * No focus-trapping dialog existed in this repository before it: five components
 * hand-rolled `role="dialog"` + `aria-modal` + focus-on-mount, and none of them
 * trapped, so `Tab` walked out into the page behind in all five. These assertions
 * are the ones that a hand-rolled dialog fails.
 *
 * **The focus assertions assert the cycle, not merely containment.** jsdom does
 * not move focus on `Tab` at all, so "focus never left the panel" would pass on a
 * dialog with no trap whatsoever — the check would be vacuous, and vacuous is what
 * a green suite means nothing looks like. What is asserted is that focus *moves*
 * from the last focusable to the first and back, repeatedly, and that each end is
 * inside the panel.
 */

configure({ asyncUtilTimeout: 5000 });

/** Two focusable children plus the primitive's own close control. */
function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      <Dialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Keyboard shortcuts"
      >
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>
    </>
  );
}

function panel(): HTMLElement {
  return screen.getByTestId("dialog-panel");
}

/** Press a key on whatever currently holds focus, which is what a keypress is. */
function pressOnActive(key: string, shiftKey = false): void {
  const active = document.activeElement ?? document.body;
  fireEvent.keyDown(active, { key, shiftKey });
}

describe("Dialog: identity", () => {
  it("renders nothing at all while closed", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog whose accessible name is its visible title", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The name is `aria-labelledby` pointing at the rendered heading, so the two
    // cannot drift apart the way a separately-passed `aria-label` can.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe("Keyboard shortcuts");
  });

  it("moves focus inside on open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    expect(panel().contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(panel());
  });
});

describe("Dialog: focus is trapped", () => {
  it("cycles forward from the last focusable back to the first", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    // jsdom performs no native focus movement on `Tab`, so the boundary is where
    // the trap is observable: at the end of the list, forward `Tab` must wrap
    // rather than fall through to the browser and out into the page.
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    expect(document.activeElement).toBe(last);

    pressOnActive("Tab");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("cycles backward from the first focusable back to the last", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    // The close control is first in DOM order, so this is the backward boundary.
    screen.getByRole("button", { name: "Close" }).focus();
    pressOnActive("Tab", true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
  });

  it("keeps focus inside under repeated cycling in both directions", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    const first = screen.getByRole("button", { name: "Close" });
    const last = screen.getByRole("button", { name: "Last" });

    // Sixteen wraps — far more than the three focusables need to demonstrate that
    // the cycle has closed rather than merely been entered.
    for (let step = 0; step < 8; step += 1) {
      last.focus();
      pressOnActive("Tab");
      expect(document.activeElement).toBe(first);
      expect(panel().contains(document.activeElement)).toBe(true);

      pressOnActive("Tab", true);
      expect(document.activeElement).toBe(last);
      expect(panel().contains(document.activeElement)).toBe(true);
    }
  });

  it("pulls focus into the cycle from the panel itself", () => {
    // Open puts focus on the panel, which is not one of its focusables. `Tab`
    // must enter the cycle rather than fall through.
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    panel().focus();

    pressOnActive("Tab");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    expect(panel().contains(document.activeElement)).toBe(true);

    pressOnActive("Tab", true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
  });

  it("leaves keys it does not own alone", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    const first = screen.getByRole("button", { name: "First" });
    first.focus();
    pressOnActive("ArrowRight");
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});

describe("Dialog: dismissal", () => {
  it("closes by key, exactly once", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    pressOnActive("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stops Escape reaching a document-level listener", () => {
    // The global shortcut listener is a bubble-phase listener on `document`, and
    // the design has it declining rather than double-acting. `stopPropagation` is
    // what makes that structural instead of dependent on the guard.
    const onDocumentKeyDown = vi.fn();
    document.addEventListener("keydown", onDocumentKeyDown);
    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole("button", { name: "Open it" }));
      pressOnActive("Escape");
      expect(onDocumentKeyDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", onDocumentKeyDown);
    }
  });

  it("closes by its close control, exactly once", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes by activating the backdrop, exactly once", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    fireEvent.mouseDown(screen.getByTestId("dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not close when the press began inside the panel", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    fireEvent.mouseDown(screen.getByRole("button", { name: "First" }));
    fireEvent.mouseDown(panel());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });

  it("reports one dismissal even when a release follows the backdrop press", () => {
    // A press on the backdrop is followed by a click on whatever is now on top.
    // Both reaching `onClose` is the "closes twice" defect, and it is what the
    // once-only guard exists for.
    const onClose = vi.fn();
    render(
      <Harness
        onClose={() => {
          onClose();
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));

    const backdrop = screen.getByTestId("dialog-backdrop");
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Dialog: focus is restored on close", () => {
  it("returns focus to the element that opened it", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open it" });
    opener.focus();
    fireEvent.click(opener);
    expect(panel().contains(document.activeElement)).toBe(true);

    pressOnActive("Escape");
    expect(document.activeElement).toBe(opener);
  });

  it("returns focus after a pointer dismissal too", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open it" });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.activeElement).toBe(opener);
  });

  it("re-arms for a second open", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Open it" });

    fireEvent.click(opener);
    pressOnActive("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    pressOnActive("Escape");
    // A guard that never re-armed would make the second dismissal a no-op, which
    // reads as a dialog that cannot be closed twice in one session.
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
