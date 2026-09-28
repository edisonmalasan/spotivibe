import { HttpFetchError, fetchJson } from "@/server/http/fetchJson";
import { getServerEnv } from "@/server/env";
import { ProviderError } from "../errors";
import type {
  ArtworkCandidate,
  MusicProvider,
  PlaylistEntry,
  PlaylistRequest,
  PlaylistResolution,
  PlaylistResolver,
  ProviderCandidate,
} from "../types";
import {
  ATTEMPT_TIMEOUT_MS,
  BROWSER_USER_AGENT,
  collectPlaylistEntries,
  MAX_INSTANCE_ATTEMPTS,
  parseInstanceList,
  wrapFailure,
} from "./support";

/**
 * Tier 4 — Piped (best-effort fallback, ROADMAP M3 / §7.2; the reference
 * implementation has no Piped tier — this one is new).
 *
 * Built-in defaults answered during fixture capture (2026-09-27, see
 * `tests/fixtures/providers/README.md`) and are overridable through
 * `SPOTIVIBE_PIPED_INSTANCES`. At most {@link MAX_INSTANCE_ATTEMPTS} instances
 * are tried per request.
 */

const DEFAULT_INSTANCES = ["https://pipedapi.ducks.party", "https://api.piped.private.coffee"];
const VIDEO_ID_PATTERN = /[?&]v=([^&]+)/;

interface PipedItem {
  type?: string;
  url?: string;
  title?: string;
  uploaderName?: string | null;
  uploaderUrl?: string | null;
  duration?: number;
  thumbnail?: string | null;
}

function channelIdFrom(uploaderUrl: string | null | undefined): string | undefined {
  if (!uploaderUrl) return undefined;
  const match = /\/channel\/([^/?#]+)/.exec(uploaderUrl);
  return match?.[1];
}

/**
 * Parse a Piped `/search` response into candidates (pure — fixture-tested,
 * no network). Non-stream items (channels, playlists) are skipped.
 *
 * @throws {ProviderError} kind `parse` when `items` is missing or not an array.
 */
export function parsePipedSearch(body: unknown): ProviderCandidate[] {
  const items =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as { items?: unknown }).items
      : undefined;
  if (!Array.isArray(items)) {
    throw new ProviderError("piped", "parse", "piped: response has no items array");
  }

  const candidates: ProviderCandidate[] = [];
  for (const raw of items as PipedItem[]) {
    if (raw.type !== "stream") continue;
    const videoId = raw.url ? (VIDEO_ID_PATTERN.exec(raw.url)?.[1] ?? "") : "";
    const title = raw.title?.trim();
    if (!videoId || !title) continue;

    const artwork: ArtworkCandidate[] =
      typeof raw.thumbnail === "string" && raw.thumbnail.length > 0 ? [{ url: raw.thumbnail }] : [];

    candidates.push({
      videoId,
      title,
      artistText: raw.uploaderName?.trim() || undefined,
      artistId: channelIdFrom(raw.uploaderUrl),
      artwork,
      durationSeconds:
        typeof raw.duration === "number" && Number.isFinite(raw.duration)
          ? raw.duration
          : undefined,
      tier: "piped",
    });
  }

  return candidates;
}

/** Tier implementation — rotates through up to two instances on failure. */
export const pipedProvider: MusicProvider = {
  id: "piped",
  async search(request) {
    const instances = parseInstanceList(
      getServerEnv().SPOTIVIBE_PIPED_INSTANCES,
      DEFAULT_INSTANCES,
    ).slice(0, MAX_INSTANCE_ATTEMPTS);

    let lastFailure: unknown;
    for (const instance of instances) {
      try {
        const url = `${instance}/search?q=${encodeURIComponent(request.query)}&filter=music_songs`;
        const body = await fetchJson<unknown>(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": BROWSER_USER_AGENT,
          },
          signal: request.signal,
          timeoutMs: request.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
        });
        return parsePipedSearch(body);
      } catch (error) {
        const wrapped = wrapFailure("piped", error);
        // Caller/budget aborts stop rotation immediately — not tier failures.
        if (wrapped instanceof DOMException) throw wrapped;
        lastFailure = wrapped;
      }
    }
    throw lastFailure ?? new ProviderError("piped", "network", "piped: no instances");
  },
};

/* ------------------------------------------------------------------ *
 * Playlist import (ROADMAP M7, design decision 9).
 * ------------------------------------------------------------------ */

/** Piped's definitive missing/private answer (observed in captured error bodies). */
const UNAVAILABLE_ERROR_PATTERN =
  /ContentNotAvailableException|does not exist|private|not available|unavailable|deleted/i;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Fetch one Piped playlist response with a bounded timeout and caller-abort
 * propagation, **retaining the body of non-2xx responses**: Piped reports a
 * missing playlist as HTTP 500 + a `ContentNotAvailableException` envelope,
 * which `fetchJson` would discard — and without that body the definitive
 * answer would be indistinguishable from a gateway failure (design
 * decision 9).
 *
 * @returns the parsed JSON body.
 * @throws {ProviderError} kind `unavailable` for a definitive error envelope,
 * {HttpFetchError} for transport failures, raw abort for caller cancellation.
 */
async function fetchPipedPlaylistBody(url: string, request: PlaylistRequest): Promise<unknown> {
  const timeoutMs = request.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;

  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": BROWSER_USER_AGENT },
      signal,
    });
    text = await response.text();
  } catch (cause) {
    // Caller cancellation is not an upstream failure — propagate as-is.
    if (request.signal?.aborted) throw cause;
    if (timeoutSignal.aborted) {
      throw new HttpFetchError("timeout", `Request to ${url} timed out after ${timeoutMs}ms`, {
        cause,
      });
    }
    const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
    throw new HttpFetchError("network", `Request to ${url} failed: ${message}`, { cause });
  }

  if (!response.ok) {
    if (UNAVAILABLE_ERROR_PATTERN.test(text)) {
      throw new ProviderError(
        "piped",
        "unavailable",
        `piped: playlist unavailable (${response.status})`,
      );
    }
    throw new HttpFetchError("http", `Request to ${url} responded with ${response.status}`, {
      status: response.status,
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    throw new HttpFetchError("parse", `Response from ${url} was not valid JSON`, { cause });
  }
  // Some instances answer with an error envelope regardless of status.
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && UNAVAILABLE_ERROR_PATTERN.test(error)) {
      throw new ProviderError("piped", "unavailable", "piped: playlist unavailable");
    }
  }
  return body;
}

function pipedPlaylistEntry(item: unknown): PlaylistEntry {
  if (item === null || typeof item !== "object") return null;
  const stream = item as PipedItem;
  if (stream.type !== undefined && stream.type !== "stream") return null;

  const videoId = stream.url ? (VIDEO_ID_PATTERN.exec(stream.url)?.[1] ?? "") : "";
  const title = nonEmptyString(stream.title)?.trim() ?? "";
  if (!videoId || !title) return null; // unavailable row → skipped + counted

  const artwork: ArtworkCandidate[] =
    typeof stream.thumbnail === "string" && stream.thumbnail.length > 0
      ? [{ url: stream.thumbnail }]
      : [];

  return {
    videoId,
    title,
    artistText: stream.uploaderName?.trim() || undefined,
    artistId: channelIdFrom(stream.uploaderUrl),
    artwork,
    durationSeconds:
      typeof stream.duration === "number" && Number.isFinite(stream.duration)
        ? stream.duration
        : undefined,
    tier: "piped",
  };
}

export interface PipedPlaylistPage {
  title?: string;
  description?: string;
  /** Instance-reported total videos; the degraded-tier signal. */
  videoCount?: number;
  nextpage?: string;
  entries: PlaylistEntry[];
}

/**
 * Parse a Piped `/playlists/<id>` response (pure — fixture-tested, no
 * network). The captured success shape is constructed (see the fixtures
 * README): no live instance returned `relatedStreams` entries on 2026-09-29.
 *
 * @throws {ProviderError} kind `parse` when the body is not an object or has
 * no `relatedStreams` array.
 */
export function parsePipedPlaylist(body: unknown): PipedPlaylistPage {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ProviderError("piped", "parse", "piped: playlist response body is not an object");
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.relatedStreams)) {
    throw new ProviderError(
      "piped",
      "parse",
      "piped: playlist response has no relatedStreams array",
    );
  }

  const title = nonEmptyString(record.name);
  const description = nonEmptyString(record.description);
  const videoCount = typeof record.videos === "number" ? record.videos : undefined;
  const nextpage = nonEmptyString(record.nextpage);

  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(videoCount !== undefined ? { videoCount } : {}),
    ...(nextpage !== undefined ? { nextpage } : {}),
    entries: (record.relatedStreams as unknown[]).map(pipedPlaylistEntry),
  };
}

/**
 * Playlist resolution tier — `GET /playlists/<id>`, following `nextpage`
 * when the instance provides one, up to the cap.
 *
 * Failure classification (design decision 9): a definitive error envelope
 * (status-independent) → kind `unavailable` (stops rotation and the chain);
 * metadata without entries (`videos > 0`, `relatedStreams` empty) → kind
 * `empty` (falls through — this is how every probed public instance answers
 * playlists, see the fixtures README).
 */
export const pipedPlaylistResolver: PlaylistResolver = {
  id: "piped",
  async resolvePlaylist(request: PlaylistRequest): Promise<PlaylistResolution> {
    const instances = parseInstanceList(
      getServerEnv().SPOTIVIBE_PIPED_INSTANCES,
      DEFAULT_INSTANCES,
    ).slice(0, MAX_INSTANCE_ATTEMPTS);

    let lastFailure: unknown;
    for (const instance of instances) {
      try {
        const meta: { title?: string; description?: string } = {};
        const { entries, truncated } = await collectPlaylistEntries(async (token) => {
          const base = `${instance}/playlists/${request.playlistId}`;
          const url = token === undefined ? base : `${base}?nextpage=${encodeURIComponent(token)}`;
          const body = await fetchPipedPlaylistBody(url, request);
          const parsed = parsePipedPlaylist(body);
          if (token === undefined) {
            if (parsed.title === undefined) {
              throw new ProviderError(
                "piped",
                "parse",
                "piped: playlist response carried no title",
              );
            }
            meta.title = parsed.title;
            meta.description = parsed.description;
            if (
              typeof parsed.videoCount === "number" &&
              parsed.videoCount > 0 &&
              parsed.entries.length === 0
            ) {
              // Metadata answered but no entries — degraded instance, not an
              // empty playlist (the chain falls through).
              throw new ProviderError(
                "piped",
                "empty",
                "piped: playlist carried no entries while videos reports more",
              );
            }
          }
          return {
            entries: parsed.entries,
            ...(parsed.nextpage !== undefined ? { continuation: parsed.nextpage } : {}),
          };
        });
        if (meta.title === undefined) {
          throw new ProviderError("piped", "parse", "piped: playlist response carried no title");
        }
        return {
          title: meta.title,
          ...(meta.description !== undefined ? { description: meta.description } : {}),
          entries,
          truncated,
        };
      } catch (error) {
        const wrapped = wrapFailure("piped", error);
        // Caller/budget aborts stop rotation immediately — not tier failures.
        if (wrapped instanceof DOMException) throw wrapped;
        // A definitive missing/private answer — rotation cannot change it.
        if (wrapped instanceof ProviderError && wrapped.kind === "unavailable") throw wrapped;
        lastFailure = wrapped;
      }
    }
    throw lastFailure ?? new ProviderError("piped", "network", "piped: no instances");
  },
};
