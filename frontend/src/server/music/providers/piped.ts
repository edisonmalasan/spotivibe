import { fetchJson } from "@/server/http/fetchJson";
import { getServerEnv } from "@/server/env";
import { ProviderError } from "../errors";
import type { ArtworkCandidate, MusicProvider, ProviderCandidate } from "../types";
import {
  ATTEMPT_TIMEOUT_MS,
  BROWSER_USER_AGENT,
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
          timeoutMs: ATTEMPT_TIMEOUT_MS,
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
