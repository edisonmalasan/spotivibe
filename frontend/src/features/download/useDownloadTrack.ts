"use client";

import { useCallback } from "react";
import { useDownloadStore, type DownloadStatus } from "@/stores/downloadStore";
import { downloadUrl, saveResponseAsFile } from "./saveFile";

/**
 * Running one download, once per track (M20; spec `download` — "A download is offered where a track
 * is, and only one runs at a time"; design decision 7).
 *
 * ## Single-flight, and why it is a Map of promises rather than a boolean
 *
 * A "downloading" flag cannot express "a second activation joins the first transfer" — it can only
 * say "not now". Joining is the better answer for two reasons: two affordances for the same track on
 * one screen become two *views* of one download instead of two downloads, and the second caller
 * learns the outcome (it awaits the same promise) rather than being told nothing. So an in-flight
 * `fetch` is keyed by track id, a second activation **returns that promise**, and the entry is
 * deleted when it settles.
 *
 * The map is module-level on purpose. Two `ResultMenu` instances on a page for the same track would
 * otherwise each fetch the whole file. It is bounded by "downloads currently in flight" — at most a
 * handful — which is the same deliberate, documented, cross-cutting module state
 * `server/http/throttle.ts` already keeps.
 *
 * ## What this module does not import
 *
 * Nothing from `@/data/repositories`, and nothing from any playback store. That is the whole of
 * "download-to-device only, playback untouched": the claim is true of the import graph, so there is
 * no code path by which a download could write to IndexedDB or move the play pointer.
 */

/**
 * The only three facts this feature needs from a track.
 *
 * Narrower than the canonical `Track` on purpose. Importing the full domain model would drag the
 * data layer into the feature's import graph for two strings, and the narrowing is the more honest
 * statement of the dependency: the downloader needs an identity and a provider id, not a track.
 */
export interface DownloadableTrack {
  /** Stable identity, used to key status and single-flight. */
  readonly id: string;
  /** The YouTube video id the route takes. */
  readonly providerId: string;
  /** Used only as the filename stem; sanitised server-side. */
  readonly title: string;
}

/**
 * How long the client will wait before giving up.
 *
 * Longer than the route's own bounds on purpose: the client timeout is a backstop against a function
 * that hangs without answering, not the primary limit, and cutting a legitimate large transfer short
 * would be worse than waiting. 180 s sits above the platform's documented 120 s proxied request
 * timeout plus the resolve phase, and well under its 300 s maximum duration.
 */
const DOWNLOAD_TIMEOUT_MS = 180_000;

/** In-flight transfers, keyed by track id. Bounded by the number of concurrent downloads. */
const inFlight = new Map<string, Promise<void>>();

/** How many transfers are currently in flight — observation, and a test assertion. */
export function inFlightDownloadCount(): number {
  return inFlight.size;
}

export interface DownloadView {
  /** This track's status. `idle` when it has never been asked for. */
  status: DownloadStatus;
  /** The last failure message, or `null`. */
  error: string | null;
  /**
   * Start (or join) the download. Resolves when the file has been handed to the device.
   *
   * Takes no argument: the track comes from the hook's own argument. An earlier signature accepted
   * one and ignored it, which would have let a caller believe it could download a track the hook
   * was not bound to — and would have silently downloaded the wrong one.
   */
  download(): Promise<void>;
}

/**
 * The download action for one track.
 *
 * Subscribes to exactly the two slices it renders, so a surface re-renders on its own track's
 * transitions and never on another track's.
 */
export function useDownloadTrack(track: DownloadableTrack): DownloadView {
  const status = useDownloadStore((state) => state.statuses[track.id] ?? "idle");
  const error = useDownloadStore((state) => state.errors[track.id] ?? null);

  const download = useCallback(async (): Promise<void> => {
    const existing = inFlight.get(track.id);
    if (existing !== undefined) return existing;

    const store = useDownloadStore.getState();
    store.markBusy(track.id);

    const work = (async () => {
      try {
        const response = await fetch(downloadUrl(track.providerId, track.title), {
          // Never cached. This is per-track media at a URL a caller could re-request forever; a
          // cached copy is a second copy of the file nobody asked to keep.
          cache: "no-store",
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
        await saveResponseAsFile(response);
        useDownloadStore.getState().markDone(track.id);
      } catch (cause) {
        useDownloadStore.getState().markFailed(track.id, describeFailure(cause));
      } finally {
        inFlight.delete(track.id);
      }
    })();

    inFlight.set(track.id, work);
    return work;
  }, [track.id, track.providerId, track.title]);

  return { status, error, download };
}

/** A message a person can read, from whatever went wrong. */
function describeFailure(cause: unknown): string {
  if (cause instanceof Error && cause.message !== "") return cause.message;
  return "The download could not be completed.";
}

/** Reset single-flight state. Test isolation only. */
export function resetDownloads(): void {
  inFlight.clear();
}
