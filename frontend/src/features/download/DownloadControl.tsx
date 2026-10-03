"use client";

import { Check, Download, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/design-system/IconButton";
import { useDownloadTrack, type DownloadableTrack } from "./useDownloadTrack";
import type { DownloadStatus } from "@/stores/downloadStore";

/**
 * The download affordance, in the two shapes the four surfaces need (M20; spec `download` — "A
 * download is offered where a track is, and only one runs at a time").
 *
 * One component owns the **wording** of all four states, so "Downloading…" cannot read one way in the
 * player bar and another in the context menu. The surfaces differ only in what they wrap it in: an
 * `IconButton` on Now Playing, a row in an {@link import("@/components/player/OverflowMenu").OverflowMenu}
 * on the two player bars and in the track context menu.
 *
 * ## Failure is reported in place, never in a dialog
 *
 * A download is a background action the listener started, and interrupting whatever they were doing
 * with a modal would be the wrong shape for a failure they can simply try again. So a failure becomes
 * the label plus a polite live region, and everything else on the surface stays operable.
 *
 * ## No percentage
 *
 * There is deliberately no progress figure. ROADMAP §21.5 lists percentage progress as a non-goal, and
 * the reason it can be refused honestly is the route's own headers: the size is an estimate, not a
 * measurement, so a percentage computed from it would be a confident-looking number derived from a
 * guess. The states are "working on it" and "done", which are both true.
 */

/** The accessible label for a status. One function, so the four surfaces cannot drift. */
export function downloadLabel(status: DownloadStatus): string {
  switch (status) {
    case "busy":
      return "Downloading…";
    case "done":
      return "Downloaded";
    case "failed":
      return "Retry download";
    default:
      return "Download";
  }
}

function statusIcon(status: DownloadStatus): ReactNode {
  if (status === "busy") return <Loader2 className="size-5 animate-spin" aria-hidden="true" />;
  if (status === "done") return <Check className="size-5" aria-hidden="true" />;
  return <Download className="size-5" aria-hidden="true" />;
}

/** The shared state, without the markup. Used by the menu-item shape. */
export function useDownloadAffordance(track: DownloadableTrack | null): {
  status: DownloadStatus;
  error: string | null;
  label: string;
  run(): void;
  disabled: boolean;
} {
  // `useDownloadTrack` needs a track, and hooks cannot be conditional — so an absent track is
  // represented as a value that can never be downloaded rather than by skipping the hook.
  const target = track ?? MISSING_TRACK;
  const view = useDownloadTrack(target);
  return {
    status: view.status,
    error: view.error,
    label: downloadLabel(view.status),
    run: () => {
      if (track === null) return;
      void view.download();
    },
    disabled: track === null,
  };
}

const MISSING_TRACK: DownloadableTrack = { id: "", providerId: "", title: "" };

/**
 * A download control for the Now Playing transport row.
 *
 * Omitted entirely when there is no track, matching how the radio and video controls on that surface
 * behave: a disabled control for an action with nothing to act on is noise.
 */
export function DownloadIconButton({ track }: { track: DownloadableTrack | null }) {
  const { status, error, label, run, disabled } = useDownloadAffordance(track);
  if (track === null) return null;
  return (
    <span className="inline-flex flex-col items-center">
      <IconButton
        label={label}
        data-testid="now-playing-download"
        disabled={disabled}
        aria-busy={status === "busy"}
        onClick={run}
      >
        {statusIcon(status)}
      </IconButton>
      {/*
        The failure is announced rather than shown as a banner, and it is a **bare** polite live
        region rather than `role="status"`.

        Two reasons, one accessibility and one concrete. `role="status"` is a page-level role: it
        says "this region reports the state of the surface". On Now Playing the radio failure alert
        already owns that role, so adding a second one here made `getByRole("status")` ambiguous for
        any test and, more importantly, told assistive technology there were two status regions when
        there is one surface-level state and one control-level message. A polite live region on the
        element itself announces the same text with the same politeness.

        It is polite because a download failing is information, not an error the listener must act on
        immediately, and the label has already changed to "Retry download" for the visual channel.
      */}
      <span aria-live="polite" className="sr-only">
        {error ?? ""}
      </span>
    </span>
  );
}

/**
 * A download row for an overflow menu.
 *
 * A component rather than a function returning an item, because the status lives in a store and a
 * plain helper could not subscribe to it.
 */
export function DownloadOverflowRow({ track }: { track: DownloadableTrack | null }) {
  const { label, run, disabled, status } = useDownloadAffordance(track);
  return (
    <button
      type="button"
      role="menuitem"
      data-testid="download-menu-item"
      className="motion-feedback flex w-full items-center gap-2 rounded-buttons px-3 py-2 text-left text-body-lg text-pure-white hover:bg-graphite"
      disabled={disabled}
      aria-disabled={disabled}
      aria-busy={status === "busy"}
      onClick={run}
    >
      {statusIcon(status)}
      <span className="truncate">{label}</span>
    </button>
  );
}
