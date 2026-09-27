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
