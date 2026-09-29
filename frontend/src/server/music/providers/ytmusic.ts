import { fetchJson } from "@/server/http/fetchJson";
import { ProviderError } from "../errors";
import { parseDurationText } from "../normalize";
import {
  PLAYLIST_ENTRY_CAP,
  type ArtworkCandidate,
  type MusicProvider,
  type PlaylistEntry,
  type PlaylistRequest,
  type PlaylistResolution,
  type PlaylistResolver,
  type ProviderCandidate,
} from "../types";
import {
  ATTEMPT_TIMEOUT_MS,
  collectNodes,
  collectPlaylistEntries,
  JSON_HEADERS,
  wrapFailure,
  type PlaylistEntryPage,
} from "./support";

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

interface MusicFixedColumn {
  musicResponsiveListItemFixedColumnRenderer?: { text?: { runs?: MusicRun[] } };
}

interface MusicResponsiveListItem {
  flexColumns?: MusicFlexColumn[];
  fixedColumns?: MusicFixedColumn[];
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

/* ------------------------------------------------------------------ *
 * Playlist import (ROADMAP M7, design decision 9).
 * ------------------------------------------------------------------ */

const MUSIC_BROWSE_URL = "https://music.youtube.com/youtubei/v1/browse";

/** Channel-ish page types a playlist row's artist run may carry. */
const ARTIST_PAGE_TYPES = new Set([
  "MUSIC_PAGE_TYPE_ARTIST",
  "MUSIC_PAGE_TYPE_CHANNEL",
  "MUSIC_PAGE_TYPE_USER_CHANNEL",
]);

interface MusicText {
  runs?: MusicRun[];
}

interface MusicHeader {
  title?: MusicText;
  description?: { musicDescriptionShelfRenderer?: { description?: MusicText } };
}

interface ContinuationNode {
  continuationEndpoint?: { continuationCommand?: { token?: string } };
}

interface MicroformatLike {
  microformatDataRenderer?: { title?: unknown };
}

function joinTextRuns(text: MusicText | undefined): string {
  return (text?.runs ?? []).map((run) => run.text ?? "").join("");
}

/**
 * Convert one playlist row into a playlist entry. Rows whose video cannot be
 * resolved (deleted/private entries render without a video id) become `null`
 * so they are skipped and counted, never silently dropped (design decision 9).
 */
function playlistRowToEntry(item: MusicResponsiveListItem): PlaylistEntry {
  const columns = item.flexColumns ?? [];

  // Playlist rows carry the id on playlistItemData; the title run's
  // watchEndpoint is the fallback (both were observed across fixtures).
  let videoId = item.playlistItemData?.videoId ?? "";
  let title = "";
  for (const run of runsOf(columns[0])) {
    const id = run.navigationEndpoint?.watchEndpoint?.videoId;
    if (id && !videoId) videoId = id;
    if (run.text) title += run.text;
  }
  if (!videoId || !title) return null;

  // Column 1: artist — structured runs by page type when the tier marked
  // them (ARTIST/CHANNEL), plain text otherwise (playlist rows use
  // USER_CHANNEL, which search's page-type extraction never matches).
  const metaRuns = runsOf(columns[1]);
  let artistText: string | undefined;
  let artistId: string | undefined;
  const artistRuns = metaRuns.filter((run) => {
    const pageType =
      run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType;
    return pageType !== undefined && ARTIST_PAGE_TYPES.has(pageType);
  });
  if (artistRuns.length > 0) {
    const joined = artistRuns
      .map((run) => run.text ?? "")
      .filter((text) => text.length > 0)
      .join(", ");
    artistText = joined.length > 0 ? joined : undefined;
    artistId = artistRuns[0]?.navigationEndpoint?.browseEndpoint?.browseId;
  } else {
    const plain = metaRuns
      .map((run) => run.text ?? "")
      .join("")
      .trim();
    artistText = plain.length > 0 ? plain : undefined;
  }

  // Duration lives in the fixed column ("2:03" / "3:12:22").
  let durationSeconds: number | undefined;
  const fixedRuns =
    item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs ?? [];
  for (const run of fixedRuns) {
    const text = run.text ?? "";
    if (DURATION_TEXT.test(text)) {
      durationSeconds = parseDurationText(text);
      break;
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

  return {
    videoId,
    title: title.trim(),
    artistText,
    artistId,
    artwork,
    durationSeconds,
    tier: "ytmusic",
  };
}

/** One parsed playlist page (first page or continuation). */
export interface YtmusicPlaylistPage extends PlaylistEntryPage {
  title?: string;
  description?: string;
}

/**
 * Parse a YouTube Music Innertube playlist response (pure — fixture-tested,
 * no network). Handles first pages (header + shelf + continuation item) and
 * continuation responses (`onResponseReceivedActions` rows).
 *
 * Definitive classification (design decision 9): a contents-less response
 * whose microformat carries no title is YouTube's missing/private answer →
 * kind `unavailable`. A contents-less response that still carries a
 * microformat title is an existing-but-unrendered playlist → empty success.
 *
 * @throws {ProviderError} kind `parse` when the body is not an object or
 * carries nothing recognizable (no rows, no continuation, no title).
 */
export function parseYtmusicPlaylistPage(body: unknown): YtmusicPlaylistPage {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ProviderError("ytmusic", "parse", "ytmusic: playlist response body is not an object");
  }
  const record = body as Record<string, unknown>;
  const microformat = (record.microformat as MicroformatLike | undefined)?.microformatDataRenderer;

  const items = collectNodes(
    body,
    "musicResponsiveListItemRenderer",
    PLAYLIST_ENTRY_CAP,
  ) as unknown as MusicResponsiveListItem[];
  const entries = items.map(playlistRowToEntry);

  const header = collectNodes(body, "musicResponsiveHeaderRenderer", 1)[0] as unknown as
    MusicHeader | undefined;
  let title = joinTextRuns(header?.title).trim();
  let description: string | undefined;
  const descriptionRuns = header?.description?.musicDescriptionShelfRenderer?.description;
  if (descriptionRuns) {
    const text = joinTextRuns(descriptionRuns).trim();
    if (text.length > 0) description = text;
  }
  if (title.length === 0 && typeof microformat?.title === "string") {
    title = microformat.title;
  }

  const continuationNode = collectNodes(body, "continuationItemRenderer", 1)[0] as unknown as
    ContinuationNode | undefined;
  const continuation = continuationNode?.continuationEndpoint?.continuationCommand?.token;

  if (entries.length === 0 && continuation === undefined && title.length === 0) {
    if (microformat !== undefined && typeof microformat.title !== "string") {
      throw new ProviderError("ytmusic", "unavailable", "ytmusic: playlist is missing or private");
    }
    throw new ProviderError(
      "ytmusic",
      "parse",
      "ytmusic: playlist response carried no playlist content",
    );
  }

  return {
    title: title.length > 0 ? title : undefined,
    ...(description !== undefined ? { description } : {}),
    entries,
    ...(continuation !== undefined ? { continuation } : {}),
  };
}

/** Playlist resolution tier — see {@link parseYtmusicPlaylistPage}. */
export const ytmusicPlaylistResolver: PlaylistResolver = {
  id: "ytmusic",
  async resolvePlaylist(request: PlaylistRequest): Promise<PlaylistResolution> {
    try {
      const meta: { title?: string; description?: string } = {};
      const { entries, truncated } = await collectPlaylistEntries(async (continuation) => {
        const body = await fetchJson<unknown>(MUSIC_BROWSE_URL, {
          method: "POST",
          headers: {
            ...JSON_HEADERS,
            Origin: "https://music.youtube.com",
            Referer: "https://music.youtube.com/",
          },
          body: JSON.stringify(
            continuation === undefined
              ? { context: WEB_REMIX_CONTEXT, browseId: `VL${request.playlistId}` }
              : { context: WEB_REMIX_CONTEXT, continuation },
          ),
          signal: request.signal,
          timeoutMs: request.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
        });
        const page = parseYtmusicPlaylistPage(body);
        if (continuation === undefined) {
          if (page.title === undefined) {
            throw new ProviderError(
              "ytmusic",
              "parse",
              "ytmusic: playlist response carried no title",
            );
          }
          meta.title = page.title;
          meta.description = page.description;
        }
        return page;
      });
      if (meta.title === undefined) {
        throw new ProviderError("ytmusic", "parse", "ytmusic: playlist response carried no title");
      }
      return {
        title: meta.title,
        ...(meta.description !== undefined ? { description: meta.description } : {}),
        entries,
        truncated,
      };
    } catch (error) {
      throw wrapFailure("ytmusic", error);
    }
  },
};
