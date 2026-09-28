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
 * Tier 3 — Invidious (best-effort fallback, ROADMAP §7.2 / §6.1
 * KEEP-REFACTOR; "must tolerate public-instance instability").
 *
 * Built-in defaults are the instances that answered during fixture capture
 * (2026-09-27, see `tests/fixtures/providers/README.md`) and are overridable
 * through `SPOTIVIBE_INVIDIOUS_INSTANCES`. At most {@link MAX_INSTANCE_ATTEMPTS}
 * instances are tried per request, each with its own bounded timeout.
 */

const DEFAULT_INSTANCES = ["https://yewtu.be", "https://invidious.f5.si"];

interface InvidiousVideo {
  type?: string;
  title?: string;
  videoId?: string;
  author?: string;
  authorId?: string;
  lengthSeconds?: number;
  videoThumbnails?: { url?: string; width?: number; height?: number }[];
}

/**
 * Parse an Invidious `/api/v1/search` response into candidates (pure —
 * fixture-tested, no network).
 *
 * @throws {ProviderError} kind `parse` when the body is not an array.
 */
export function parseInvidiousSearch(body: unknown): ProviderCandidate[] {
  if (!Array.isArray(body)) {
    throw new ProviderError("invidious", "parse", "invidious: response body is not an array");
  }

  const candidates: ProviderCandidate[] = [];
  for (const item of body as InvidiousVideo[]) {
    if (item.type !== "video") continue;
    const videoId = item.videoId;
    const title = item.title?.trim();
    if (!videoId || !title) continue;

    const artwork: ArtworkCandidate[] = (item.videoThumbnails ?? [])
      .filter(
        (thumbnail): thumbnail is { url: string; width?: number; height?: number } =>
          typeof thumbnail.url === "string" && thumbnail.url.length > 0,
      )
      .map((thumbnail) => ({
        url: thumbnail.url,
        width: thumbnail.width,
        height: thumbnail.height,
      }));

    candidates.push({
      videoId,
      title,
      artistText: item.author?.trim() || undefined,
      artistId: item.authorId,
      artwork,
      // Present-but-invalid values (e.g. live entries) are left for the
      // filter stage; absent values stay undefined.
      durationSeconds: typeof item.lengthSeconds === "number" ? item.lengthSeconds : undefined,
      tier: "invidious",
    });
  }

  return candidates;
}

/** Tier implementation — rotates through up to two instances on failure. */
export const invidiousProvider: MusicProvider = {
  id: "invidious",
  async search(request) {
    const instances = parseInstanceList(
      getServerEnv().SPOTIVIBE_INVIDIOUS_INSTANCES,
      DEFAULT_INSTANCES,
    ).slice(0, MAX_INSTANCE_ATTEMPTS);

    let lastFailure: unknown;
    for (const instance of instances) {
      try {
        const url = `${instance}/api/v1/search?q=${encodeURIComponent(request.query)}&type=video`;
        const body = await fetchJson<unknown>(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": BROWSER_USER_AGENT,
          },
          signal: request.signal,
          timeoutMs: request.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
        });
        return parseInvidiousSearch(body);
      } catch (error) {
        const wrapped = wrapFailure("invidious", error);
        // Caller/budget aborts stop rotation immediately — not tier failures.
        if (wrapped instanceof DOMException) throw wrapped;
        lastFailure = wrapped;
      }
    }
    throw lastFailure ?? new ProviderError("invidious", "network", "invidious: no instances");
  },
};

/* ------------------------------------------------------------------ *
 * Playlist import (ROADMAP M7, design decision 9).
 * ------------------------------------------------------------------ */

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function invidiousPlaylistEntry(item: unknown): PlaylistEntry {
  if (item === null || typeof item !== "object") return null;
  const video = item as InvidiousVideo;
  const videoId = nonEmptyString(video.videoId) ?? "";
  const title = nonEmptyString(video.title)?.trim() ?? "";
  if (!videoId || !title) return null; // unavailable row → skipped + counted

  const artwork: ArtworkCandidate[] = (video.videoThumbnails ?? [])
    .filter(
      (thumbnail): thumbnail is { url: string; width?: number; height?: number } =>
        typeof thumbnail.url === "string" && thumbnail.url.length > 0,
    )
    .map((thumbnail) => ({
      url: thumbnail.url,
      width: thumbnail.width,
      height: thumbnail.height,
    }));

  return {
    videoId,
    title,
    artistText: video.author?.trim() || undefined,
    artistId: video.authorId,
    artwork,
    durationSeconds: typeof video.lengthSeconds === "number" ? video.lengthSeconds : undefined,
    tier: "invidious",
  };
}

export interface InvidiousPlaylistPage {
  title?: string;
  description?: string;
  /** Instance-reported total; drives paging. Absent means "single page". */
  videoCount?: number;
  entries: PlaylistEntry[];
}

/**
 * Parse an Invidious `/api/v1/playlists/<id>` response (pure —
 * fixture-tested, no network).
 *
 * @throws {ProviderError} kind `parse` when the body is not an object or has
 * no `videos` array.
 */
export function parseInvidiousPlaylist(body: unknown): InvidiousPlaylistPage {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ProviderError(
      "invidious",
      "parse",
      "invidious: playlist response body is not an object",
    );
  }
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.videos)) {
    throw new ProviderError(
      "invidious",
      "parse",
      "invidious: playlist response has no videos array",
    );
  }

  const title = nonEmptyString(record.title);
  const description = nonEmptyString(record.description);
  const videoCount = typeof record.videoCount === "number" ? record.videoCount : undefined;

  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(videoCount !== undefined ? { videoCount } : {}),
    entries: (record.videos as unknown[]).map(invidiousPlaylistEntry),
  };
}

/**
 * Playlist resolution tier — pages `GET /api/v1/playlists/<id>` (with
 * `?page=N`) while the instance reports more entries, up to the cap.
 *
 * Failure classification (design decision 9): HTTP 404 is the instance's
 * definitive missing-playlist answer → kind `unavailable` (stops rotation
 * and the chain); a metadata-only answer (`videoCount > 0` but no entries)
 * is a degraded instance → kind `empty` (falls through).
 */
export const invidiousPlaylistResolver: PlaylistResolver = {
  id: "invidious",
  async resolvePlaylist(request: PlaylistRequest): Promise<PlaylistResolution> {
    const instances = parseInstanceList(
      getServerEnv().SPOTIVIBE_INVIDIOUS_INSTANCES,
      DEFAULT_INSTANCES,
    ).slice(0, MAX_INSTANCE_ATTEMPTS);

    let lastFailure: unknown;
    for (const instance of instances) {
      try {
        const meta: { title?: string; description?: string } = {};
        let fetched = 0;
        const { entries, truncated } = await collectPlaylistEntries(async (token) => {
          const page = token === undefined ? 1 : Number(token);
          const url =
            page === 1
              ? `${instance}/api/v1/playlists/${request.playlistId}`
              : `${instance}/api/v1/playlists/${request.playlistId}?page=${page}`;
          const body = await fetchJson<unknown>(url, {
            headers: {
              Accept: "application/json",
              "User-Agent": BROWSER_USER_AGENT,
            },
            signal: request.signal,
            timeoutMs: request.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
          });
          const parsed = parseInvidiousPlaylist(body);
          if (token === undefined) {
            if (parsed.title === undefined) {
              throw new ProviderError(
                "invidious",
                "parse",
                "invidious: playlist response carried no title",
              );
            }
            meta.title = parsed.title;
            meta.description = parsed.description;
          }
          fetched += parsed.entries.length;
          const remaining = typeof parsed.videoCount === "number" && fetched < parsed.videoCount;
          if (parsed.entries.length === 0 && remaining) {
            // The instance reported more entries but served none — degraded,
            // not an empty playlist (the chain falls through).
            throw new ProviderError(
              "invidious",
              "empty",
              "invidious: playlist page carried no entries while videoCount reports more",
            );
          }
          return {
            entries: parsed.entries,
            ...(remaining && parsed.entries.length > 0 ? { continuation: String(page + 1) } : {}),
          };
        });
        if (meta.title === undefined) {
          throw new ProviderError(
            "invidious",
            "parse",
            "invidious: playlist response carried no title",
          );
        }
        return {
          title: meta.title,
          ...(meta.description !== undefined ? { description: meta.description } : {}),
          entries,
          truncated,
        };
      } catch (error) {
        // Definitive missing playlist — one instance's 404 is YouTube's
        // answer; rotation cannot change it (design decision 9).
        if (error instanceof HttpFetchError && error.status === 404) {
          throw new ProviderError("invidious", "unavailable", "invidious: playlist not found", {
            cause: error,
          });
        }
        const wrapped = wrapFailure("invidious", error);
        // Caller/budget aborts stop rotation immediately — not tier failures.
        if (wrapped instanceof DOMException) throw wrapped;
        lastFailure = wrapped;
      }
    }
    throw lastFailure ?? new ProviderError("invidious", "network", "invidious: no instances");
  },
};
