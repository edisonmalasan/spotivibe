"use client";

import { useCallback, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { IconButton } from "@/components/design-system/IconButton";
import { X } from "lucide-react";

/**
 * The modal dialog primitive (M18 design decision 4).
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
 * **No motion.** M19 owns one transition vocabulary, and this milestone adds
 * none: the panel appears, it is not animated.
 */

/**
 * Focusable descendants, in DOM order.
 *
 * Deliberately *not* filtered by layout (`offsetParent`, `checkVisibility`): both
 * answer "is this painted", and a DOM with no layout answers no for everything,
 * so a trap built on either would find nothing to cycle between under test — and a
 * trap that finds nothing is exactly the trap that fails silently. What is
 * filtered is declaration: an element the markup marks as not exposed.
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
  return element.getAttribute("aria-hidden") !== "true";
}

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isExposed);
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

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      data-testid="dialog-backdrop"
      className="fixed inset-0 z-40 flex items-center justify-center bg-void-black/70 p-4"
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
