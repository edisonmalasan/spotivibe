"use client";

import { useCallback, useEffect, useState } from "react";
import type { Track } from "@/data/repositories";
import { acquireShelfSlot, type ShelfSlot } from "@/features/home/discoveryShelfQueue";
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
 * Independence is not the same as "all at once", though. A page of shelves —
 * Discover renders ten genre shelves, Home several catalog feeds — would
 * otherwise put every request on the wire together and the server's bounded
 * outbound limiter would queue most of them until their budgets ran out. So a
 * shelf first takes one of the page-wide slots in
 * `discoveryShelfQueue` (bounded by `MAX_CONCURRENT_SHELF_REQUESTS`); the
 * shelves beyond the cap wait their turn, still reporting `"loading"`, and a
 * shelf that unmounts while queued leaves the queue without ever issuing a
 * request.
 *
 * The result is presentation-ready: for the discovery feed,
 * `interleaveByLanguage` runs client-side over the tracks before they are
 * exposed (design §4), so a multi-language selection renders mixed rather than
 * grouped. A shelf that brings its own {@link ShelfTrackFetcher} owns its own
 * ordering instead, because language mixing is a rule about the *discovery*
 * catalog rather than about this state machine.
 *
 * Local-first contract: the only things a request carries are the feed kind, the
 * selected language codes, and the caller's short seed terms. No liked-track,
 * playlist, or history payload exists in the arguments at all.
 *
 * ## One state machine, many sources (design decision 8)
 *
 * The status vocabulary, `retry()`, the per-instance abort, and the shared
 * in-flight cap are properties of the *shelf*, not of the discovery endpoint. So
 * a shelf whose tracks come from somewhere else entirely — M9's "More Like This"
 * shelf, which resolves `/api/similar` for the playing track — passes a
 * {@link ShelfTrackFetcher} instead of a feed `kind`, and gets exactly the same
 * lifecycle, cancellation, and queue bound. A second hook for that feed would
 * have forked this contract into two, which is exactly what the repository rules
 * forbid. The discovery path itself is untouched: with no `fetchTracks`, the
 * options are and behave as they always were.
 */

/** The settled outcome of one shelf request. */
export type DiscoveryShelfStatus = "idle" | "loading" | "ready" | "empty" | "error";

/** Everything one shelf's track source receives for a single attempt. */
export interface ShelfTrackRequest {
  /** Requested track count; the source's own default when omitted. */
  limit?: number;
  /**
   * Caller-owned abort — this shelf's own `AbortController`, aborted on unmount
   * and whenever a newer request supersedes this one. A source must pass it to
   * its transport so a superseded shelf really cancels, not merely ignores.
   */
  signal: AbortSignal;
}

/**
 * A shelf's track source. Resolves the tracks for one attempt, or rejects; the
 * hook owns everything around it (slot, cancellation, status, retry).
 */
export type ShelfTrackFetcher = (request: ShelfTrackRequest) => Promise<Track[]>;

/** Options every shelf shares, whichever source feeds it. */
interface SharedShelfOptions {
  /** Requested track count; the source's own default when omitted. */
  limit?: number;
  /**
   * Whether this shelf may issue a request at all. A disabled shelf issues no
   * request and stays `"idle"` — that is how the locally gated shelves stay
   * hidden and how Discover stays silent while the device is offline.
   */
  enabled?: boolean;
}

/** A shelf composed from one of the server's curated discovery feeds. */
interface DiscoveryShelfOptions extends SharedShelfOptions {
  /** Which curated feed to compose. */
  kind: DiscoveryKind;
  /** Selected catalog language codes (1..8, always non-empty). */
  languages: readonly string[];
  /** Short caller-supplied taste terms; omitted for catalog feeds. */
  seeds?: readonly string[];
  /** A shelf with a `kind` never names its own source. */
  fetchTracks?: undefined;
  /** Nor does it need a request identity of its own. */
  scope?: undefined;
}

/**
 * A shelf fed by a source of its own (design decision 8) — "More Like This",
 * which resolves the playing track's suggestions through `/api/similar`.
 *
 * It names no `kind` and no languages because it composes no discovery feed: the
 * only thing a provider-side request here may carry is the caller's own request
 * identity, and `fetchTracks` decides what the request actually is.
 */
interface RelatedShelfOptions extends SharedShelfOptions {
  /**
   * Content-based identity of this shelf's request. A change re-runs the request;
   * an equal value does not, so an inline expression from the caller never
   * restarts a request on a re-render.
   *
   * The source must close over exactly the inputs this string encodes — for the
   * related shelf, the track's id, title, and artist — because the token, not the
   * function identity, is what decides whether a request is re-issued.
   */
  scope: string;
  /** Where this shelf's tracks come from, in place of a discovery feed. */
  fetchTracks: ShelfTrackFetcher;
  /** Mutually exclusive with the discovery half. */
  kind?: undefined;
  languages?: undefined;
  seeds?: undefined;
}

/**
 * Either a curated discovery feed (the original option set, unchanged) or a
 * caller-supplied track source. Exactly one half is populated.
 */
export type UseDiscoveryShelfOptions = DiscoveryShelfOptions | RelatedShelfOptions;

/** One shelf's state, its tracks, and its recovery entry point. */
export interface DiscoveryShelf {
  status: DiscoveryShelfStatus;
  /** The source's tracks; empty unless `status === "ready"`. */
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
 * The failure a shelf reports, read from whichever typed error the request threw.
 *
 * The discovery path is unchanged: a {@link DiscoveryError} reports its own code
 * and anything else is a transport failure. A caller-supplied source may throw
 * its own typed error, so a `code` naming one of the codes a shelf already knows
 * how to speak is honoured too — that is what lets "More Like This" report a 503
 * as `upstream_unavailable` rather than as an undifferentiated `network`.
 *
 * Deliberately not a general property read: only these three codes are accepted,
 * so an unrelated object thrown by a source still degrades to `network` exactly
 * as any unexpected throw did before.
 */
function shelfErrorCode(error: unknown): DiscoveryErrorCode {
  if (error instanceof DiscoveryError) return error.code;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === "invalid_request" || code === "upstream_unavailable") return code;
  return "network";
}

/**
 * Content-based request identity. Two renders that carry equal values produce
 * the same token, so an inline array literal from the caller does not restart
 * the request on every render; a changed value does, which is the point.
 *
 * The two option halves contribute different identities — the discovery feed's
 * own inputs, or a source shelf's `scope` — and the *shape* differs too, so a
 * discovery token can never collide with a related one.
 */
function requestToken(options: UseDiscoveryShelfOptions, attempt: number): string {
  const { limit, enabled = true } = options;
  if (options.fetchTracks !== undefined) {
    return JSON.stringify(["source", options.scope, limit ?? null, enabled, attempt]);
  }
  const { kind, languages, seeds } = options;
  return JSON.stringify([kind, languages, seeds ?? null, limit ?? null, enabled, attempt]);
}

/** A short, loggable name for the request a shelf is about to make. */
function shelfRequestScope(options: UseDiscoveryShelfOptions): string {
  return options.fetchTracks !== undefined ? options.scope : options.kind;
}

/**
 * Run one attempt for whichever source this shelf names, and return its tracks
 * ready to render.
 *
 * A discovery shelf keeps its original path: compose the feed, then mix the
 * languages client-side. A shelf with its own {@link ShelfTrackFetcher} receives
 * the same abort signal and limit and owns its own ordering — the source
 * decides what "presentation-ready" means for a feed it composed itself.
 */
async function loadShelfTracks(
  options: UseDiscoveryShelfOptions,
  signal: AbortSignal,
): Promise<Track[]> {
  const { limit } = options;
  if (options.fetchTracks !== undefined) {
    return options.fetchTracks({ limit, signal });
  }
  const feed = await fetchDiscoveryFeed({
    kind: options.kind,
    languages: options.languages,
    seeds: options.seeds,
    limit,
    signal,
  });
  return interleaveByLanguage(feed.tracks, options.languages);
}

/**
 * Fetch one shelf and expose its lifecycle.
 *
 * - `"idle"` — disabled by the caller: no request is issued.
 * - `"loading"` — this shelf is in flight for the current token, or is queued
 *   behind the page's other shelves waiting for a request slot (the cap is
 *   deliberately invisible in the status vocabulary).
 * - `"ready"` — tracks are ready and presentation-ready.
 * - `"empty"` — the source resolved with nothing to show.
 * - `"error"` — this shelf's request failed; `code` names the reason and
 *   `retry()` re-runs it.
 *
 * `upstream_unavailable` and `network` are the ordinary retryable failures.
 * `invalid_request` is *not*: the client validated the request and the server
 * rejected it anyway, which is a bug in this codebase — so it still renders a
 * retryable error state, and additionally warns the code so the cause is
 * debuggable instead of silently swallowed.
 *
 * Unmounting (or a superseded token) aborts the in-flight request — or the queue
 * wait that has not issued one yet — and a response that arrives after that is
 * discarded rather than written to state.
 */
export function useDiscoveryShelf(options: UseDiscoveryShelfOptions): DiscoveryShelf {
  const { limit, enabled = true } = options;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);
  const token = requestToken(options, attempt);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    // Disabled shelves (no local seeds, offline Discover) issue no request.
    if (!enabled) return;
    // One controller per instance, aborted on unmount or supersession. It also
    // carries the queue wait, so a shelf that leaves while queued is released
    // from the gate without ever reaching the network.
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      let slot: ShelfSlot | undefined;
      try {
        // One of the page-wide slots; the shelves beyond the cap wait here and
        // keep reporting "loading".
        slot = await acquireShelfSlot(controller.signal);
        if (cancelled) return;
        const tracks = await loadShelfTracks(options, controller.signal);
        if (cancelled) return;
        setSettled({
          token,
          status: tracks.length > 0 ? "ready" : "empty",
          tracks,
        });
      } catch (error: unknown) {
        // A wait or a request cancelled by unmount/supersession is not a
        // failure to report — the next token's effect owns what happens next.
        if (cancelled) return;
        const code = shelfErrorCode(error);
        if (code === "invalid_request") {
          // A programming error, not a provider failure: surface the retryable
          // error state and make the cause debuggable.
          console.warn(
            "[shelf] this shelf's request was rejected as invalid — this is a client bug:",
            { scope: shelfRequestScope(options), limit, code },
          );
        }
        setSettled({ token, status: "error", tracks: [], code });
      } finally {
        // The slot is returned on every path — success, failure, or an abort
        // that happened before the request was even issued.
        slot?.release();
      }
    })();

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
