import { fetchJson } from "@/server/http/fetchJson";
import { ProviderError } from "../errors";
import { parseDurationText } from "../normalize";
import type { ArtworkCandidate, MusicProvider, ProviderCandidate } from "../types";
import { ATTEMPT_TIMEOUT_MS, collectNodes, JSON_HEADERS, wrapFailure } from "./support";

/**
 * Tier 1 — YouTube Music Innertube (primary discovery provider,
 * ROADMAP §7.2 / §6.1 KEEP-REFACTOR).
 *
 * Request shape verified against the live service on 2026-09-27 (see
 * `tests/fixtures/providers/README.md`): a keyless POST with the WEB_REMIX
 * client context and the "Songs" search filter param (reference: Lyrix
 * `innertubeService.ts`, `EgWKAQIIAQ%3D%3D`).
 *
 * Parsing is improved over the reference: the second flex column carries
 * `artists • album • 4:09`, so duration and album are extracted instead of
 * Lyrix's hard-coded `duration: 240`.
 */

const MUSIC_SEARCH_URL = "https://music.youtube.com/youtubei/v1/search";
/** "Songs" search filter param (Lyrix-derived). */
const SONGS_FILTER_PARAMS = "EgWKAQIIAQ%3D%3D";
const WEB_REMIX_CONTEXT = {
  client: { clientName: "WEB_REMIX", clientVersion: "1.20241202.01.00", hl: "en", gl: "US" },
};

interface MusicRun {
  text?: string;
  navigationEndpoint?: {
    watchEndpoint?: { videoId?: string };
    browseEndpoint?: {
      browseId?: string;
      browseEndpointContextSupportedConfigs?: {
        browseEndpointContextMusicConfig?: { pageType?: string };
      };
    };
  };
}

interface MusicFlexColumn {
  musicResponsiveListItemFlexColumnRenderer?: { text?: { runs?: MusicRun[] } };
}

interface MusicResponsiveListItem {
  flexColumns?: MusicFlexColumn[];
  playlistItemData?: { videoId?: string };
  thumbnail?: {
    musicThumbnailRenderer?: {
      thumbnail?: {
        thumbnails?: { url?: string; width?: number; height?: number }[];
      };
    };
  };
}

const DURATION_TEXT = /^\d{1,3}:\d{2}(?::\d{2})?$/;

function runsOf(column: MusicFlexColumn | undefined): MusicRun[] {
  return column?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
}

/**
 * Parse a YouTube Music Innertube search response into candidates (pure —
 * fixture-tested, no network).
 *
 * @throws {ProviderError} kind `parse` when the body is not an object.
 */
export function parseYtmusicSearch(body: unknown): ProviderCandidate[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ProviderError("ytmusic", "parse", "ytmusic: response body is not an object");
  }

  const items = collectNodes(
    body,
    "musicResponsiveListItemRenderer",
  ) as unknown as MusicResponsiveListItem[];
  const candidates: ProviderCandidate[] = [];

  for (const item of items) {
    const columns = item.flexColumns ?? [];
    if (columns.length < 2) continue;

    // Column 0: title (optionally multi-run) with the watch endpoint video id.
    let videoId = "";
    let title = "";
    for (const run of runsOf(columns[0])) {
      const id = run.navigationEndpoint?.watchEndpoint?.videoId;
      if (id) videoId = id;
      if (run.text) title += run.text;
    }
    if (!videoId && item.playlistItemData?.videoId) videoId = item.playlistItemData.videoId;
    if (!videoId || !title) continue;

    // Column 1: `artists • album • 4:09` as browse-endpoint runs.
    const metaRuns = runsOf(columns[1]);
    const artists: string[] = [];
    let albumTitle: string | undefined;
    let albumId: string | undefined;
    let durationSeconds: number | undefined;

    // The duration is the last run shaped like a clock time.
    for (let index = metaRuns.length - 1; index >= 0; index -= 1) {
      const text = metaRuns[index]?.text ?? "";
      if (DURATION_TEXT.test(text)) {
        durationSeconds = parseDurationText(text);
        break;
      }
    }
    for (const run of metaRuns) {
      const endpoint = run.navigationEndpoint?.browseEndpoint;
      const pageType =
        endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
      const text = run.text ?? "";
      if (!text) continue;
      if (pageType === "MUSIC_PAGE_TYPE_ARTIST") artists.push(text);
      if (pageType === "MUSIC_PAGE_TYPE_ALBUM" && albumTitle === undefined) {
        albumTitle = text;
        albumId = endpoint?.browseId;
      }
    }

    const thumbnails = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? [];
    const artwork: ArtworkCandidate[] = thumbnails
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
      title: title.trim(),
      artistText: artists.length > 0 ? artists.join(", ") : undefined,
      albumTitle,
      albumId,
      artwork,
      durationSeconds,
      tier: "ytmusic",
    });
  }

  return candidates;
}

/** Tier implementation — see {@link parseYtmusicSearch} for parse behavior. */
export const ytmusicProvider: MusicProvider = {
  id: "ytmusic",
  async search(request) {
    try {
      const body = await fetchJson<unknown>(MUSIC_SEARCH_URL, {
        method: "POST",
        headers: {
          ...JSON_HEADERS,
          Origin: "https://music.youtube.com",
          Referer: "https://music.youtube.com/",
        },
        body: JSON.stringify({
          context: WEB_REMIX_CONTEXT,
          query: request.query,
          params: SONGS_FILTER_PARAMS,
        }),
        signal: request.signal,
        timeoutMs: request.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
      });
      return parseYtmusicSearch(body);
    } catch (error) {
      throw wrapFailure("ytmusic", error);
    }
  },
};
