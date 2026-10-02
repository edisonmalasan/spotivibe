"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { IconButton } from "@/components/design-system/IconButton";
import { X } from "lucide-react";

/**
 * The modal dialog primitive (M18 design decision 4; motion in M19).
 *
 * **There was no focus-trapping dialog in this repository before it.** Five
 * components hand-rolled the same pattern — `DeletePlaylistDialog`,
 * `PlaylistFormDialog`, `ImportPlaylistDialog`, `PlaylistPicker`,
 * `LanguageOnboarding` — and not one of them trapped focus: pressing `Tab` in any
 * of them walked straight out into the page behind, which is the specific failure
 * that makes a modal unusable with a keyboard or a screen reader. Converting those
 * five is deliberately *not* part of this change (design §4, and the Risks table):
 * the primitive exists because the new help surface needs one, and converting five
 * unrelated surfaces is its own change with its own regression risk. They keep
 * calling `stopPropagation()` on `Escape`, which the global shortcut listener's
 * bubble phase already relies on.
 *
 * What this owns, and what it is asserted to own:
 *
 * - `role="dialog"` + `aria-modal="true"` + an accessible name that cannot drift
 *   from the visible title, because the title *is* the name: it is rendered here
 *   and referenced by `aria-labelledby`, rather than passed twice and trusted.
 * - Focus moved inside on open, onto the panel itself — the convention all five
 *   existing dialogs already follow, and the one that makes restore-on-close
 *   well defined.
 * - `Tab` and `Shift+Tab` cycled inside the panel. Repeatedly, from either end,
 *   which is the part that is actually wrong in a hand-rolled dialog.
 * - Focus restored to whatever had it before, on close.
 * - Dismissed by `Escape`, by the close control, and by activating the backdrop —
 *   **exactly once each**. The `dismissed` ref is what makes "exactly once"
 *   structural rather than incidental: a backdrop press that also lands on the
 *   panel's own press handler cannot produce two `onClose` calls, and a dialog
 *   that is somehow re-entered cannot either.
 *
 * **Motion (M19, task 3.3): the enter and the exit, both CSS.**
 *
 * M18 shipped this primitive with no motion and said so on the record. The exit is
 * the honest test of whether a library is needed, so it is expressed with what CSS
 * actually gained: `@starting-style` supplies the "from" state for the arrival, and
 * `transition-behavior: allow-discrete` keeps a leaving element transitionable while
 * its `display` flips. Both are Baseline since 2024, so a 41 kB dependency is not
 * needed to animate this dialog.
 *
 * What that costs is one extra render pass, and it is deliberately the cheapest one
 * available: when `open` goes false the primitive re-renders as `closing` — the
 * dialog is still in the DOM, still painted, and no longer interactive — and the
 * browser tears it down when the transition ends. **Nothing waits on it.** The
 * caller's state has already changed, `onClose` has already run exactly once, focus
 * has already been restored, and the leaving backdrop is `pointer-events: none` from
 * its first frame, so a motion can never sit between a listener and a click. The
 * `setTimeout` below is a *safety net* for a browser with no `allow-discrete` support,
 * which would never fire `transitionend`; it is not the mechanism, and it can never
 * make an action wait for it.
 */

/**
 * Focusable descendants, in DOM order.
 *
 * Deliberately *not* filtered by layout (`offsetParent`, `checkVisibility`): both
 * answer "is this painted", and a DOM with no layout answers no for everything,
 * so a trap built on either would find nothing to cycle between under test — and a
 * trap that finds nothing is exactly the trap that fails silently. What
 * is filtered is declaration: an element the markup marks as not exposed.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isExposed(element: HTMLElement): boolean {
  if (element.hidden) return false;
  if (element.closest("[hidden]")) return false;
  // M19: a dialog on its way out is `inert`, and an inert subtree is exactly as
  // unreachable as a hidden one. Without this, `Tab` could still cycle through the
  // panel's own controls while it faded out.
  if (element.closest("[inert]")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  return true;
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isExposed);
}

/**
 * The dialog's own lifecycle, which is now three states rather than two.
 *
 * `closed` renders nothing at all, which is the M18 contract. `closing` exists only
 * so that a dismissed dialog has something left to transition — and it is derived
 * during render from the caller's `open`, so no effect, timer, or caller
 * cooperation is involved in starting it.
 */
type DialogPhase = "closed" | "open" | "closing";

/**
 * How long to wait before tearing the panel down if the browser never reports the
 * end of its leave transition.
 *
 * **Read from the element's own computed `transition-duration`, not written here**,
 * so this safety net cannot drift from the vocabulary: a browser that supports
 * `allow-discrete` reports the real figure and the real `transitionend` normally
 * wins, and a browser without the support reports `0s` and is torn down at once —
 * which is the right answer there, because there is no transition to wait for. This
 * is the one place the primitive reads a duration, and it reads the same one the
 * stylesheet declared.
 */
function leaveSafetyMs(node: HTMLElement): number {
  const declared = Number.parseFloat(getComputedStyle(node).transitionDuration);
  return Number.isFinite(declared) && declared > 0 ? declared * 1000 : 0;
}

interface DialogProps {
  /** Whether the dialog is open. Closed renders nothing at all. */
  open: boolean;
  /** Dismissal — every path routes here, once. */
  onClose(): void;
  /** The visible title, which is also the dialog's accessible name. */
  title: string;
  /** Extra classes for the panel. */
  className?: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, className = "", children }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const dismissedRef = useRef(false);
  const [phase, setPhase] = useState<DialogPhase>(open ? "open" : "closed");

  // Adjusting state during render when a prop changes — React's documented pattern,
  // and the cheapest of the alternatives here. An effect would let the browser paint
  // a frame with the dialog still open after the caller had already dismissed it; a
  // timer would make the dismissal wait. This way `open` and the phase never
  // disagree for a rendered frame.
  if (open && phase !== "open") setPhase("open");
  else if (!open && phase === "open") setPhase("closing");

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onClose();
  }, [onClose]);

  // Open: remember the invoker, re-arm the once-only guard, move focus inside.
  // Close (or unmount): the cleanup is what restores focus, so it happens on the
  // way out rather than in a second effect that could run in the wrong order.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dismissedRef.current = false;
    panelRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open]);

  // Leaving: watch for the transition's own end, and fall back to the computed
  // duration if the browser never reports one.
  useEffect(() => {
    if (phase !== "closing") return;
    const node = backdropRef.current;
    if (!node) {
      setPhase("closed");
      return;
    }
    const teardown = () => setPhase("closed");
    // `event.target === node` because `transitionend` bubbles: a transition on any
    // descendant must not end the dialog's own leave early. `opacity` because it is
    // the last of the backdrop's own properties to finish, and because it is the one
    // the leave actually animates — a browser without `allow-discrete` simply never
    // gets here, which is what the fallback below is for.
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== node) return;
      if (event.propertyName !== "opacity") return;
      teardown();
    };
    node.addEventListener("transitionend", onEnd);
    node.addEventListener("transitioncancel", onEnd);
    const safety = setTimeout(teardown, leaveSafetyMs(node));
    return () => {
      node.removeEventListener("transitionend", onEnd);
      node.removeEventListener("transitioncancel", onEnd);
      clearTimeout(safety);
    };
  }, [phase]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      // Stopped, not merely handled: the global shortcut listener is a bubble-phase
      // document listener, and this dialog owns its dismissal (design decision 2).
      // Two paths closing the same surface is the "closes twice" defect.
      event.stopPropagation();
      dismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (!panel) return;
    const items = focusableWithin(panel);
    if (items.length === 0) {
      // Nothing to move to. Hold focus on the panel rather than letting the browser
      // cycle into the page behind, which is the whole point of the trap.
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    // Where focus sits among the panel's own focusables. `-1` is the case that
    // matters more than it looks: focus on the panel itself — which is where open
    // puts it, and where anything that moves focus on its own leaves it — is not
    // "in the cycle", so the first `Tab` has to enter it rather than fall through
    // to the browser and out into the page.
    const index = items.indexOf(document.activeElement as HTMLElement);

    if (event.shiftKey) {
      if (index <= 0) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (index === -1 || index === items.length - 1) {
      event.preventDefault();
      first.focus();
    }
  };

  if (phase === "closed") return null;

  const closing = phase === "closing";

  return (
    <div
      ref={backdropRef}
      data-testid="dialog-backdrop"
      // M19: the state is in the DOM, not only in a class, so the leave transition
      // has an unambiguous target and a test has something to read.
      data-motion-state={phase}
      // Out of the accessibility tree and out of the tab order from the first frame
      // of the leave — a dismissed dialog is gone the moment it is dismissed, and
      // only its pixels are still travelling.
      aria-hidden={closing || undefined}
      inert={closing || undefined}
      className="motion-surface fixed inset-0 z-40 items-center justify-center bg-void-black/70 p-4"
      onMouseDown={(event) => {
        // The backdrop only: a press that began on the panel bubbles here, and
        // dismissing on that would close a dialog the listener is using.
        if (event.target !== backdropRef.current) return;
        dismiss();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="dialog-panel"
        className={`w-full max-w-md rounded-cards bg-carbon p-5 outline-none ${className}`}
        onKeyDown={handleKeyDown}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-link font-bold text-pure-white">
            {title}
          </h2>
          <IconButton label="Close" onClick={dismiss}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}
