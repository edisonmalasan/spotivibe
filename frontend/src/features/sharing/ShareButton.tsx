"use client";

import { IconButton } from "@/components/design-system/IconButton";
import { SHARE_STATUS_TEXT, useShare } from "@/features/sharing/useShare";
import { Share2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A surface's share action and its outcome (M18 tasks 5.2 and 5.5).
 *
 * **The name is the surface's own.** `Share <what it shares>` rather than a bare
 * "Share", because the action is an icon in a row of icons: a result list, a hero
 * toolbar, or a playlist toolbar all end up with several of them, and a list of
 * identically-named buttons is distinguishable only by position and icon. That is
 * the requirement "the action has an accessible name identifying what it shares",
 * and it is also why `name` is a required prop — a share control that could not
 * say what it shares has no correct default.
 *
 * **The outcome is a `role="status"` region, not a toast and not an alert.** This
 * is the repository's established pattern for reporting something that happened
 * on a surface (`ConnectionBanner`, `StorageNotice`, `SearchView`'s loading
 * region), and no toast system is invented for it. And it is a status rather than
 * an alert because a dismissed share sheet is not a failure.
 *
 * **The region is mounted with its message, not before it.** The usual advice is
 * to keep a live region permanently mounted so a change to it is announced, and
 * that is not possible here: `tests/search-controller.test.tsx` asserts that the
 * settled search results view contains **no** `role="status"` region at all, so a
 * share control sitting in a result row cannot leave one mounted while idle. The
 * trade is accepted knowingly and recorded rather than papered over — the
 * consequence is that the *first* announcement of an outcome depends on the
 * reader's handling of a live region that appears already populated, which is
 * why the outcome is also visible text and not only an announcement. Pressing
 * share again always re-announces.
 *
 * **Placed where the surface already has a slot.** A `SongRow`'s `trailing`, or
 * the hero toolbar beside Play and Shuffle. No surface grows a menu or a
 * disclosure for this.
 */
export interface ShareButtonProps {
  /** What is being shared — becomes the action's accessible name. */
  name: string;
  /** The Spotivibe URL for `name`, from that surface's own href builder. */
  url: string;
  /** The title a platform share sheet shows beside the link. */
  title: string;
  size?: "sm" | "md";
}

export function ShareButton({ name, url, title, size = "sm" }: ShareButtonProps): ReactNode {
  const { share, status, busy } = useShare({ url, title });

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <IconButton label={`Share ${name}`} size={size} disabled={busy} onClick={share}>
        <Share2 className="size-4" aria-hidden="true" />
      </IconButton>
      {status !== "idle" && (
        <span role="status" className="whitespace-nowrap text-label text-mist">
          {SHARE_STATUS_TEXT[status]}
        </span>
      )}
    </div>
  );
}
