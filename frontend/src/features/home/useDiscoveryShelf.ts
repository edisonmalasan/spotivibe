"use client";

import { useCallback, useEffect, useState } from "react";
import type { Track } from "@/data/repositories";
import {
  DiscoveryError,
  fetchDiscoveryFeed,
  type DiscoveryErrorCode,
  type DiscoveryKind,
} from "@/features/home/discoveryApi";
import { interleaveByLanguage } from "@/features/recommendations/interleave";

/**
 * One shelf's request lifecycle (design §2: the client fetches one shelf at a
 * time; spec: `discovery` — "Home discovery feed").
 *
 * Every rendered shelf owns its own hook instance, so it owns its **own**
 * `AbortController`: one shelf's failure, retry, or unmount can never settle,
 * cancel, or overwrite a sibling's state. That isolation is exactly what the
 * acceptance criteria ask for, so it is structural here rather than something
 * the feed has to remember.
 *
 * The result is presentation-ready: `interleaveByLanguage` runs client-side over
 * the tracks before they are exposed (design §4), so a multi-language selection
 * renders mixed rather than grouped.
 *
 * Local-first contract: the only things a request carries are the feed kind, the
 * selected language codes, and the caller's short seed terms. No liked-track,
 * playlist, or history payload exists in the arguments at all.
 */

/** The settled outcome of one shelf request. */
export type DiscoveryShelfStatus = "idle" | "loading" | "ready" | "empty" | "error";

/** Everything one shelf needs to fetch and retry a feed. */
export interface UseDiscoveryShelfOptions {
  /** Which curated feed to compose. */
  kind: DiscoveryKind;
  /** Selected catalog language codes (1..8, always non-empty). */
  languages: readonly string[];
  /** Short caller-supplied taste terms; omitted for catalog feeds. */
  seeds?: readonly string[];
  /** Requested track count; the endpoint's own default when omitted. */
  limit?: number;
  /**
   * Whether this shelf may issue a request at all. A disabled shelf issues no
   * request and stays `"idle"` — that is how the locally gated shelves stay
   * hidden and how Discover stays silent while the device is offline.
   */
  enabled?: boolean;
}

/** One shelf's state, its tracks, and its recovery entry point. */
export interface DiscoveryShelf {
  status: DiscoveryShelfStatus;
  /** Interleaved tracks; empty unless `status === "ready"`. */
  tracks: Track[];
  /** The designed failure code; present only when `status === "error"`. */
  code?: DiscoveryErrorCode;
  /** Re-run the request immediately, skipping nothing. */
  retry(): void;
}

/** A settled result, tagged with the request it belongs to. */
interface Settled {
  token: string;
  status: "ready" | "empty" | "error";
  tracks: Track[];
  code?: DiscoveryErrorCode;
}

/** The state a request that has not settled (or must not run) reports. */
function pendingStatus(enabled: boolean): DiscoveryShelfStatus {
  return enabled ? "loading" : "idle";
}

/**
 * Content-based request identity. Two renders that carry equal values produce
 * the same token, so an inline array literal from the caller does not restart
 * the request on every render; a changed value does, which is the point.
 */
function requestToken(options: UseDiscoveryShelfOptions, attempt: number): string {
  const { kind, languages, seeds, limit, enabled = true } = options;
  return JSON.stringify([kind, languages, seeds ?? null, limit ?? null, enabled, attempt]);
}

/**
 * Fetch one discovery shelf and expose its lifecycle.
 *
 * - `"idle"` — disabled by the caller: no request is issued.
 * - `"loading"` — one request is in flight for the current token.
 * - `"ready"` — tracks are ready and already language-interleaved.
 * - `"empty"` — the feed resolved with nothing to show.
 * - `"error"` — this shelf's request failed; `code` names the reason and
 *   `retry()` re-runs it.
 *
 * `upstream_unavailable` and `network` are the ordinary retryable failures.
 * `invalid_request` is *not*: the client validated the request and the server
 * rejected it anyway, which is a bug in this codebase — so it still renders a
 * retryable error state, and additionally warns the code so the cause is
 * debuggable instead of silently swallowed.
 *
 * Unmounting (or a superseded token) aborts the in-flight request, and a
 * response that arrives after that is discarded rather than written to state.
 */
export function useDiscoveryShelf(options: UseDiscoveryShelfOptions): DiscoveryShelf {
  const { kind, languages, seeds, limit, enabled = true } = options;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const token = requestToken(options, attempt);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    // Disabled shelves (no local seeds, offline Discover) issue no request.
    if (!enabled) return;
    // One controller per instance, aborted on unmount or supersession.
    const controller = new AbortController();
    let cancelled = false;

    void fetchDiscoveryFeed({ kind, languages, seeds, limit, signal: controller.signal })
      .then((feed) => {
        if (cancelled) return;
        const tracks = interleaveByLanguage(feed.tracks, languages);
        setSettled({
          token,
          status: tracks.length > 0 ? "ready" : "empty",
          tracks,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = error instanceof DiscoveryError ? error.code : "network";
        if (code === "invalid_request") {
          // A programming error, not a provider failure: surface the retryable
          // error state and make the cause debuggable.
          console.warn(
            "[discovery] the discovery request was rejected as invalid — this is a client bug:",
            { kind, languages, seeds, limit, code },
          );
        }
        setSettled({ token, status: "error", tracks: [], code });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `token` already encodes every request input; the values are read from the
    // render that produced it, so a changed value always re-runs the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // A result only counts for the request that is still current; anything else
  // (a new token, a disabled shelf) is reported as its pending state.
  if (!enabled) return { status: "idle", tracks: [], retry };
  if (settled !== null && settled.token === token) {
    return { status: settled.status, tracks: settled.tracks, code: settled.code, retry };
  }
  return { status: pendingStatus(enabled), tracks: [], retry };
}
