"use client";

import { useCallback, useState } from "react";

/**
 * Sharing over the platform's own transports (M18 task 5.1; design decision 7;
 * spec `sharing`).
 *
 * **Two transports, one outcome vocabulary, and no error path.** The Web Share
 * API is used where the platform has one and the clipboard is used where it does
 * not. A *rejected* share — including a listener who dismissed the OS share
 * sheet — takes the same clipboard fallback a missing API takes, because
 * cancelling is not failing: the listener changed their mind, and an application
 * that answers that with an error is telling them they did something wrong.
 * There is consequently no `error` in {@link ShareStatus}, and no surface has to
 * decide what to do with one.
 *
 * **Nothing is persisted.** A share is an act, not a record: there is no share
 * history, no counter, and no entry in any dataset. {@link runShare} touches
 * nothing but the two transports, which is why "sharing persists nothing" is a
 * property of the function rather than a promise about it.
 */

/** What is being shared: the Spotivibe URL and the title a platform sheet shows. */
export interface SharePayload {
  url: string;
  title: string;
}

/**
 * Every way a share can end. There is deliberately no `error`.
 *
 * - `idle` — no attempt yet.
 * - `shared` — the platform sheet was invoked and accepted the share.
 * - `copied` — there was no sheet, so the link was copied instead.
 * - `dismissed` — the sheet was invoked and the listener cancelled it. The link
 *   was copied by the fallback, and the outcome is reported as the cancellation
 *   it was rather than as a success.
 * - `unavailable` — neither transport existed or worked. The only honest report
 *   in that case, and it is reported as a status rather than raised as a fault.
 */
export type ShareStatus = "idle" | "shared" | "copied" | "dismissed" | "unavailable";

/**
 * The announced wording for each outcome.
 *
 * Kept beside the status rather than in each surface so "copied" cannot be
 * reported as "shared" on one surface and as "saved" on another, and so the
 * dismissal wording is the same everywhere — which is the requirement that a
 * cancellation must never read as a failure.
 */
export const SHARE_STATUS_TEXT: Record<ShareStatus, string> = {
  idle: "",
  shared: "Shared",
  copied: "Link copied",
  dismissed: "Sharing cancelled",
  unavailable: "Sharing unavailable",
};

/**
 * Run one share attempt and report how it ended.
 *
 * Never rejects and never throws: the caller's only job is to render the returned
 * status, so a transport that fails synchronously is as reportable as one that
 * rejects. The clipboard is annotated as possibly absent because that is exactly
 * the case the fallback exists for — a platform with no clipboard (and no Web
 * Share API) is a real configuration, not a type error.
 */
export async function runShare({ url, title }: SharePayload): Promise<ShareStatus> {
  const platformShare =
    typeof navigator.share === "function" ? navigator.share.bind(navigator) : undefined;

  // Whether the sheet was opened and then taken back. Tracked so the outcome can
  // be reported as the cancellation it was, while still taking the fallback.
  let dismissed = false;
  if (platformShare !== undefined) {
    try {
      await platformShare({ title, url });
      return "shared";
    } catch {
      dismissed = true;
    }
  }

  try {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) return dismissed ? "dismissed" : "unavailable";
    await clipboard.writeText(url);
    return dismissed ? "dismissed" : "copied";
  } catch {
    return dismissed ? "dismissed" : "unavailable";
  }
}

export interface ShareController {
  /** Perform one share attempt. Safe to call repeatedly; a busy attempt ignores it. */
  share(): void;
  status: ShareStatus;
  /** True while an attempt is in flight, so a slow sheet cannot be double-invoked. */
  busy: boolean;
}

/** One surface's share state: the action, the outcome, and whether it is in flight. */
export function useShare({ url, title }: SharePayload): ShareController {
  const [status, setStatus] = useState<ShareStatus>("idle");
  const [busy, setBusy] = useState(false);

  const share = useCallback(() => {
    if (busy) return;
    setBusy(true);
    void runShare({ url, title })
      .then(setStatus)
      // `runShare` reports every outcome as a status and does not reject. This is
      // the belt to its braces: without it a status that never arrives would
      // leave the button permanently disabled with nothing said about why.
      .catch((error: unknown) => {
        console.warn("[share] the attempt ended without an outcome:", error);
        setStatus("unavailable");
      })
      .finally(() => setBusy(false));
  }, [busy, title, url]);

  return { share, status, busy };
}
