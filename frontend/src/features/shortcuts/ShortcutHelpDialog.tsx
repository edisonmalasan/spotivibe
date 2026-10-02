"use client";

import { Dialog } from "@/components/design-system/Dialog";
import { SHORTCUT_BINDINGS } from "@/features/shortcuts/bindings";

/**
 * The discoverable shortcut list (M18 tasks 3.2–3.3).
 *
 * **The list is derived, never transcribed.** It maps {@link SHORTCUT_BINDINGS} —
 * the same table the listener reads — so a binding that is not listed cannot
 * happen without the table and the dialog disagreeing, which is what a test
 * compares. Each row is keyed by its binding's stable `id` and carries it as
 * `data-shortcut-id`, so a duplicated id is visible in the DOM rather than being
 * React's silently-reused key.
 *
 * **Reachable by pointer as well as by key**: the trigger is an ordinary button in
 * the shell, not a keybinding-only affordance, so the list can be found without
 * knowing that `?` exists.
 */
export function ShortcutHelpDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" className="max-w-xl">
      <p className="text-body-lg font-regular text-mist">
        Shortcuts are ignored while you are typing, while a menu is open, and inside a dialog.
      </p>
      <dl className="mt-4 flex flex-col gap-3">
        {SHORTCUT_BINDINGS.map((binding) => (
          <div
            key={binding.id}
            data-shortcut-id={binding.id}
            data-shortcut-keys={binding.keys.join(" ")}
            className="flex items-start gap-4"
          >
            <dt className="flex w-32 shrink-0 flex-wrap gap-1">
              {binding.keys.map((key, index) => (
                <kbd
                  key={`${binding.id}-${index}`}
                  className="rounded-small bg-smoke px-2 py-0.5 text-label font-semibold text-pure-white"
                >
                  {key}
                </kbd>
              ))}
            </dt>
            <dd className="min-w-0">
              <span className="block text-body-lg font-semibold text-pure-white">
                {binding.label}
              </span>
              <span className="block text-caption font-regular text-mist">
                {binding.description}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
