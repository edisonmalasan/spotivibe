"use client";

import { Ellipsis } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { IconButton } from "@/components/design-system/IconButton";

/**
 * The overflow menu shell (M20; design decision 8).
 *
 * This is the behaviour `features/search/ResultMenu.tsx` already had — an `IconButton` trigger with
 * `aria-haspopup="menu"` / `aria-expanded`, `role="menu"` rows in DOM order as plain buttons so Tab
 * reaches each, focus moving to the first item on open, Escape and outside-click closing, focus
 * returning to the trigger on Escape — lifted into its own component.
 *
 * ## Why it exists now
 *
 * ROADMAP §21.5 puts a download action on "the PlayerBar/MiniPlayer overflow". **Neither component
 * has an overflow menu.** The roadmap described a surface as though it existed; it did not. Creating
 * the smallest surface that carries the approved action is the only reading that delivers §21.5
 * rather than quietly dropping half of it.
 *
 * `ResultMenu` named the behaviour feature-local and said so — "no shared menu primitive until
 * another feature needs one" (design §8). Another feature now needs one, so the behaviour moves here
 * and `ResultMenu` keeps its own items.
 */

/** A row the menu renders from props. */
export interface OverflowMenuItem {
  /** The item's text, and its accessible name. Imperative: "Download", "Add to queue". */
  label: string;
  /** Runs after the menu has closed. */
  onSelect(): void;
  /** Disabled rows stay rendered and are announced as disabled. */
  disabled?: boolean;
  /** Extra content inside the row — an icon, rendered before the label. */
  leading?: ReactNode;
}

/**
 * A row the menu renders as given.
 *
 * For a row whose label and disabled state come from a store subscription rather than from this
 * component's props — the download row, whose label is one of four states. It is an entry in `items`
 * rather than `children` so that **ordering stays the caller's decision**: a caller can put a
 * store-backed row between two declarative ones, which is what `ResultMenu` needs to keep the radio
 * item last.
 */
export interface OverflowMenuCustomItem {
  element: ReactNode;
}

export type OverflowMenuEntry = OverflowMenuItem | OverflowMenuCustomItem;

export interface OverflowMenuProps {
  /** Accessible name for the trigger, e.g. "More options for Blue Monday". */
  label: string;
  /**
   * The declarative rows.
   *
   * Optional, because a caller whose only row is store-backed passes it as `children`
   * instead — and both may be used together, in which case the order is: `items` in
   * order, then `children`. `ResultMenu` uses `items` because its download row has to sit
   * between two of them; the two player bars use `children` because Download is their only
   * row.
   */
  items?: readonly OverflowMenuEntry[];
  children?: ReactNode;
  /** Renders the trigger's icon. Defaults to the ellipsis every surface already uses. */
  icon?: ReactNode;
  /**
   * Accessible name for the menu itself. Defaults to {@link OverflowMenuProps.label}.
   *
   * The override exists because `ResultMenu` has always named its menu "Actions for &lt;track&gt;"
   * while naming its trigger "More options for &lt;track&gt;", and M5's suite asserts both. Sharing
   * the shell must not quietly rename a landmark a screen-reader user already navigates by, and
   * forcing the two surfaces to share one string would have changed either the trigger or the menu
   * to suit the new component rather than to preserve what existed.
   */
  menuLabel?: string;
}

function isCustom(entry: OverflowMenuEntry): entry is OverflowMenuCustomItem {
  return "element" in entry;
}

const itemClassName =
  "motion-feedback flex w-full items-center gap-2 rounded-buttons px-3 py-2 text-left text-body-lg text-pure-white hover:bg-graphite";

export function OverflowMenu({ label, items = [], children, icon, menuLabel }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  /** Focus the trigger button (the IconButton does not forward a ref). */
  const focusTrigger = useCallback(() => {
    triggerRef.current?.querySelector("button")?.focus();
  }, []);

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) focusTrigger();
    },
    [focusTrigger],
  );

  /**
   * Close on any row activation, wherever the row came from.
   *
   * Delegated to the menu container rather than attached per row, so a custom row gets the same
   * dismiss behaviour as a declarative one without being handed a close function.
   * `event.detail === 0` is the reliable discriminator between a keyboard activation and a pointer
   * one — Enter and Space on a button produce a click with no pointer involved — so keyboard users
   * get focus returned to the trigger and pointer users get focus left where they put it, which is
   * what `ResultMenu` did by hand.
   */
  function onMenuClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target as Element | null;
    if (target?.closest('[role="menuitem"]') === null) return;
    close(event.detail === 0);
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false); // pointer press: focus follows the pointer, not the trigger
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  // Opening moves focus to the first row so Escape/Tab start from the menu.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  return (
    <div className="relative">
      <span ref={triggerRef} className="inline-flex">
        <IconButton
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {icon ?? <Ellipsis className="size-5" aria-hidden="true" />}
        </IconButton>
      </span>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={menuLabel ?? label}
          onClick={onMenuClick}
          className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-col gap-0.5 rounded-cards bg-carbon p-1 shadow-lg"
        >
          {items.map((entry, index) =>
            isCustom(entry) ? (
              <Fragment key={`custom-${index}`}>{entry.element}</Fragment>
            ) : (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                className={itemClassName}
                disabled={entry.disabled === true}
                aria-disabled={entry.disabled === true}
                onClick={() => {
                  if (entry.disabled === true) return;
                  entry.onSelect();
                }}
              >
                {entry.leading}
                <span className="truncate">{entry.label}</span>
              </button>
            ),
          )}
          {children}
        </div>
      )}
    </div>
  );
}
