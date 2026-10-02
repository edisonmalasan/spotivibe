"use client";

import { IconButton } from "@/components/design-system/IconButton";
import { ShortcutHelpDialog } from "@/features/shortcuts/ShortcutHelpDialog";
import { dispatchShortcut, type ShortcutContext } from "@/features/shortcuts/bindings";
import { Keyboard } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The global shortcut listener and the help surface's trigger (M18 task 2.1).
 *
 * Mounted once, by `AppShell` — the shell is already the single mount point for
 * the cross-cutting non-visual agents (`useListeningRecorder`,
 * `attachServiceWorker`, `RefillAgent`, `RadioStartedTracker`, `PlayerHost`), and
 * there is no provider tree here: Zustand is read directly, so nothing needs
 * threading a context through the app to reach a shortcut's target.
 *
 * **One listener, in the bubble phase, on `document`.** Both halves of that are
 * deliberate (design decision 2):
 *
 * - Bubble, not capture. `DeletePlaylistDialog`, `PlaylistFormDialog`,
 *   `ImportPlaylistDialog`, `PlaylistPicker`, and `LanguageOnboarding` each call
 *   `event.stopPropagation()` on `Escape`, so a bubble-phase listener on
 *   `document` never sees that keypress while they are open. "No shortcuts while a
 *   modal owns the keyboard" therefore arrives as a property of code that already
 *   exists and is already tested, instead of as precedence re-implemented here. A
 *   capture listener would invert all five of them and would have to re-derive the
 *   ordering by hand.
 * - Bubble also means `ResultMenu`, which does *not* stop propagation, closes
 *   itself first — and the guard declines the event anyway, because its target is
 *   inside a `[role="menu"]` subtree.
 *
 * The `Escape` binding exists to close help and nothing else, so no keypress is
 * ever handled twice.
 */
export function GlobalShortcuts() {
  const [helpOpen, setHelpOpenState] = useState(false);
  // The listener is attached once, so it cannot read `helpOpen` from a closure.
  // A ref is what makes a single attachment honest instead of a shortcut that
  // stops working the moment its state changes.
  const helpOpenRef = useRef(false);
  const setHelpOpen = useCallback((open: boolean) => {
    helpOpenRef.current = open;
    setHelpOpenState(open);
  }, []);

  useEffect(() => {
    const context: ShortcutContext = {
      setHelpOpen,
      isHelpOpen: () => helpOpenRef.current,
    };
    const onKeyDown = (event: KeyboardEvent) => {
      dispatchShortcut(event, context);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [setHelpOpen]);

  return (
    <>
      {/* Pointer-reachable, so the list can be found without knowing `?` exists.
          Fixed bottom-right above the player region in both shell variants — the
          128px offset clears the compact shell's mini player plus bottom nav and
          the desktop bar's 72px, so it never covers a transport control. */}
      <div className="fixed bottom-32 right-4 z-40">
        <IconButton label="Keyboard shortcuts" onClick={() => setHelpOpen(true)}>
          <Keyboard className="size-5" aria-hidden="true" />
        </IconButton>
      </div>
      <ShortcutHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}
