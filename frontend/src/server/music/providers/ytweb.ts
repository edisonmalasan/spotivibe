import { fetchJson } from "@/server/http/fetchJson";
import { ProviderError } from "../errors";
import { parseDurationText } from "../normalize";
import {
  type ArtworkCandidate,
  type MusicProvider,
  type PlaylistEntry,
  type PlaylistRequest,
  type PlaylistResolution,
  type PlaylistResolver,
  type ProviderCandidate,
  type SearchCategory,
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
 * Tier 2 — YouTube Web Innertube (secondary discovery provider,
 * ROADMAP §7.2 / §6.1 KEEP-REFACTOR).
 *
 * The web search appends ` song` to the query when not in podcast-only mode,
 * matching the reference behavior (Lyrix `innertubeService.ts`:
 * `query: options?.webOnly ? query : query + " song"`); podcast-only mode is
 * out of scope for M3 (M12).
 *
 * Parsing is improved over the reference: results are candidates only —
 * duration/title/channel filtering and scoring are centralized (§6.1
 * KEEP/IMPROVE), so this tier's results receive identical filtering to every
 * other tier.
 */

const WEB_SEARCH_URL = "https://www.youtube.com/youtubei/v1/search";
const WEB_CONTEXT = {
  client: { clientName: "WEB", clientVersion: "2.20241202.00.00", hl: "en", gl: "US" },
};

/**
 * YouTube's search-filter parameter for podcasts (M12). Documented as an upstream
 * hint the app does not control: it narrows the result set, and the filter stage
 * plus the request's own category still apply if it is ignored.
 */
const PODCAST_TYPE_PARAMS = "EgIQAw%3D%3D";

interface TextRun {
  text?: string;
  navigationEndpoint?: { browseEndpoint?: { browseId?: string } };
}

interface SimpleText {
  simpleText?: string;
}

interface VideoRenderer {
  videoId?: string;
  title?: { runs?: TextRun[] };
  ownerText?: { runs?: TextRun[] };
  shortBylineText?: { runs?: TextRun[] };
  lengthText?: SimpleText;
  thumbnail?: { thumbnails?: { url?: string; width?: number; height?: number }[] };
}

function joinRuns(runs: TextRun[] | undefined): string {
  return (runs ?? []).map((run) => run.text ?? "").join("");
}

function channelOf(renderer: VideoRenderer): { name: string; id?: string } {
  const runs = renderer.ownerText?.runs ?? renderer.shortBylineText?.runs ?? [];
  const name = joinRuns(runs);
  const id = runs[0]?.navigationEndpoint?.browseEndpoint?.browseId;
  return { name, id };
}

/**
 * Parse a YouTube Web Innertube search response into candidates (pure —
 * fixture-tested, no network). Traverses `videoRenderer` and
 * `compactVideoRenderer` nodes anywhere in the body (Lyrix-derived).
 *
 * @throws {ProviderError} kind `parse` when the body is not an object.
 */
export function parseYtwebSearch(body: unknown): ProviderCandidate[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ProviderError("ytweb", "parse", "ytweb: response body is not an object");
  }

  const renderers = [
    ...collectNodes(body, "videoRenderer"),
    ...collectNodes(body, "compactVideoRenderer"),
  ] as unknown as VideoRenderer[];

  const candidates: ProviderCandidate[] = [];
  for (const renderer of renderers) {
    const videoId = renderer.videoId;
    const title = joinRuns(renderer.title?.runs).trim();
    if (!videoId || !title) continue;

    const { name, id } = channelOf(renderer);
    const durationText = renderer.lengthText?.simpleText;
    const artwork: ArtworkCandidate[] = (renderer.thumbnail?.thumbnails ?? [])
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
      artistText: name || undefined,
      artistId: id,
      artwork,
      // Present-but-invalid duration text parses to 0 (filter rejects it);
      // an absent lengthText stays `undefined` (survives with a penalty).
      durationSeconds: durationText !== undefined ? parseDurationText(durationText) : undefined,
      tier: "ytweb",
    });
  }

  return candidates;
}

/**
 * M12: the query text and type hint this tier sends, per category.
 *
 * Music mode is byte-identical to the pre-M12 request — same `" song"` suffix,
 * same body — so no existing music result can change. Podcast mode drops the
 * music suffix and adds YouTube's podcast type filter, which is the one upstream
 * signal that distinguishes episodes from songs; if a provider ignores it, the
 * result degrades to unfiltered results labelled by the mode (a disclosed
 * limitation, not a silent one).
 */
export function ytwebSearchBody(
  query: string,
  category: SearchCategory = "music",
): { context: unknown; query: string; params?: string } {
  if (category === "podcast") {
    return { context: WEB_CONTEXT, query, params: PODCAST_TYPE_PARAMS };
  }
  return { context: WEB_CONTEXT, query: `${query} song` };
}

/** Tier implementation — see {@link parseYtwebSearch} for parse behavior. */
export const ytwebProvider: MusicProvider = {
  id: "ytweb",
  async search(request) {
    try {
      const body = await fetchJson<unknown>(WEB_SEARCH_URL, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(ytwebSearchBody(request.query, request.category)),
        signal: request.signal,
        timeoutMs: request.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
      });
      return parseYtwebSearch(body);
    } catch (error) {
      throw wrapFailure("ytweb", error);
    }
  },
};

/* ------------------------------------------------------------------ *
 * Playlist import (ROADMAP M7, design decision 9).
 * ------------------------------------------------------------------ */

const WEB_BROWSE_URL = "https://www.youtube.com/youtubei/v1/browse";

/** ERROR alerts carrying this pattern are YouTube's definitive missing/private answer. */
const UNAVAILABLE_ALERT_PATTERN = /does not exist|private|not available|unavailable|deleted/i;

const DURATION_TEXT = /^\d{1,3}:\d{2}(?::\d{2})?$/;

interface ThumbnailSource {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

interface MetadataPart {
  text?: { content?: unknown };
  commandRuns?: Array<{
    onTap?: { innertubeCommand?: { browseEndpoint?: { browseId?: unknown } } };
  }>;
  navigationEndpoint?: { browseEndpoint?: { browseId?: unknown } };
}

interface LockupLike {
  contentId?: unknown;
  contentType?: unknown;
  metadata?: {
    lockupMetadataViewModel?: {
      title?: { content?: unknown };
      metadata?: {
        contentMetadataViewModel?: { metadataRows?: Array<{ metadataParts?: MetadataPart[] }> };
      };
    };
  };
  contentImage?: {
    thumbnailViewModel?: {
      image?: { sources?: ThumbnailSource[] };
      overlays?: Array<{
        thumbnailBottomOverlayViewModel?: {
          badges?: Array<{ thumbnailBadgeViewModel?: { text?: unknown } }>;
        };
      }>;
    };
  };
}

interface AlertLike {
  type?: unknown;
  text?: { runs?: Array<{ text?: unknown }> };
}

interface PlaylistMetadataLike {
  playlistMetadataRenderer?: { title?: unknown; description?: unknown };
}

interface MicroformatPlaylistLike {
  microformatDataRenderer?: { title?: unknown; description?: unknown };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Collect playlist rows and the continuation token from one response.
 * First pages store rows under `sectionListRenderer` (wrapped in an item
 * section); continuations append them via `appendContinuationItemsAction`.
 * Only these in-scope item arrays are walked — sidebar/header lockups are
 * never playlist rows and are not visited.
 */
function collectYtwebPlaylistItems(body: unknown): {
  lockups: LockupLike[];
  continuation?: string;
} {
  const lockups: LockupLike[] = [];
  let continuation: string | undefined;

  const visit = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      if (raw === null || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (item.lockupViewModel !== null && typeof item.lockupViewModel === "object") {
        const lockup = item.lockupViewModel as LockupLike;
        // Non-video lockups (channel/playlist) are not playlist rows.
        const contentType = typeof lockup.contentType === "string" ? lockup.contentType : undefined;
        if (contentType === undefined || contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
          lockups.push(lockup);
        }
        continue;
      }
      if (item.itemSectionRenderer !== null && typeof item.itemSectionRenderer === "object") {
        visit((item.itemSectionRenderer as Record<string, unknown>).contents);
        continue;
      }
      if (
        continuation === undefined &&
        item.continuationItemRenderer !== null &&
        typeof item.continuationItemRenderer === "object"
      ) {
        const node = item.continuationItemRenderer as {
          continuationEndpoint?: { continuationCommand?: { token?: unknown } };
        };
        const token = node.continuationEndpoint?.continuationCommand?.token;
        if (typeof token === "string") continuation = token;
      }
    }
  };

  for (const section of collectNodes(body, "sectionListRenderer", 4)) visit(section.contents);
  for (const action of collectNodes(body, "appendContinuationItemsAction", 4)) {
    visit(action.continuationItems);
  }

  return { lockups, ...(continuation !== undefined ? { continuation } : {}) };
}

/**
 * Convert one `lockupViewModel` row into a playlist entry; rows without a
 * resolvable video become `null` (skipped + counted, design decision 9).
 */
function lockupToEntry(lockup: LockupLike): PlaylistEntry {
  const videoId = optionalString(lockup.contentId) ?? "";
  const model = lockup.metadata?.lockupMetadataViewModel;
  const title = optionalString(model?.title?.content) ?? "";
  if (!videoId || !title) return null;

  let artistText: string | undefined;
  let artistId: string | undefined;
  const part = model?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0];
  const text = optionalString(part?.text?.content);
  if (text !== undefined) {
    artistText = text;
    artistId =
      optionalString(part?.commandRuns?.[0]?.onTap?.innertubeCommand?.browseEndpoint?.browseId) ??
      optionalString(part?.navigationEndpoint?.browseEndpoint?.browseId);
  }

  // Duration is the thumbnail's bottom-overlay badge ("3:12:22").
  let durationSeconds: number | undefined;
  for (const overlay of lockup.contentImage?.thumbnailViewModel?.overlays ?? []) {
    for (const badge of overlay.thumbnailBottomOverlayViewModel?.badges ?? []) {
      const badgeText = badge.thumbnailBadgeViewModel?.text;
      if (typeof badgeText === "string" && DURATION_TEXT.test(badgeText)) {
        durationSeconds = parseDurationText(badgeText);
        break;
      }
    }
    if (durationSeconds !== undefined) break;
  }

  const artwork: ArtworkCandidate[] = (
    lockup.contentImage?.thumbnailViewModel?.image?.sources ?? []
  )
    .filter(
      (source): source is { url: string; width?: number; height?: number } =>
        typeof source.url === "string" && source.url.length > 0,
    )
    .map((source) => ({
      url: source.url,
      width: typeof source.width === "number" ? source.width : undefined,
      height: typeof source.height === "number" ? source.height : undefined,
    }));

  return {
    videoId,
    title,
    artistText,
    artistId,
    artwork,
    durationSeconds,
    tier: "ytweb",
  };
}

/** One parsed playlist page (first page or continuation). */
export interface YtwebPlaylistPage extends PlaylistEntryPage {
  title?: string;
  description?: string;
}

/**
 * Parse a YouTube Web Innertube playlist response (pure — fixture-tested,
 * no network). Handles first pages (`sectionListRenderer`) and continuation
 * responses (`appendContinuationItemsAction`).
 *
 * Definitive classification (design decision 9): an ERROR alert matching
 * {@link UNAVAILABLE_ALERT_PATTERN}, or a contents-less response whose
 * microformat carries no title, is YouTube's missing/private answer → kind
 * `unavailable`.
 *
 * @throws {ProviderError} kind `parse` when the body is not an object or
 * carries nothing recognizable.
 */
export function parseYtwebPlaylistPage(body: unknown): YtwebPlaylistPage {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ProviderError("ytweb", "parse", "ytweb: playlist response body is not an object");
  }
  const record = body as Record<string, unknown>;

  const alerts = collectNodes(body, "alertRenderer", 5) as unknown as AlertLike[];
  for (const alert of alerts) {
    if (alert.type !== "ERROR") continue;
    const text = (alert.text?.runs ?? []).map((run) => run.text ?? "").join("");
    if (UNAVAILABLE_ALERT_PATTERN.test(text)) {
      throw new ProviderError("ytweb", "unavailable", `ytweb: playlist unavailable: ${text}`);
    }
  }

  const { lockups, continuation } = collectYtwebPlaylistItems(body);
  const entries = lockups.map(lockupToEntry);

  const metadata = (record.metadata as PlaylistMetadataLike | undefined)?.playlistMetadataRenderer;
  const microformat = (record.microformat as MicroformatPlaylistLike | undefined)
    ?.microformatDataRenderer;
  const title = optionalString(metadata?.title) ?? optionalString(microformat?.title);
  const description =
    optionalString(metadata?.description) ?? optionalString(microformat?.description);

  if (entries.length === 0 && continuation === undefined && title === undefined) {
    if (microformat !== undefined && microformat.title === undefined) {
      throw new ProviderError("ytweb", "unavailable", "ytweb: playlist is missing or private");
    }
    throw new ProviderError(
      "ytweb",
      "parse",
      "ytweb: playlist response carried no playlist content",
    );
  }

  return {
    ...(title !== undefined ? { title } : {}),
    ...(description !== undefined ? { description } : {}),
    entries,
    ...(continuation !== undefined ? { continuation } : {}),
  };
}

/** Playlist resolution tier — see {@link parseYtwebPlaylistPage}. */
export const ytwebPlaylistResolver: PlaylistResolver = {
  id: "ytweb",
  async resolvePlaylist(request: PlaylistRequest): Promise<PlaylistResolution> {
    try {
      const meta: { title?: string; description?: string } = {};
      const { entries, truncated } = await collectPlaylistEntries(async (continuation) => {
        const body = await fetchJson<unknown>(WEB_BROWSE_URL, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(
            continuation === undefined
              ? { context: WEB_CONTEXT, browseId: `VL${request.playlistId}` }
              : { context: WEB_CONTEXT, continuation },
          ),
          signal: request.signal,
          timeoutMs: request.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
        });
        const page = parseYtwebPlaylistPage(body);
        if (continuation === undefined) {
          if (page.title === undefined) {
            throw new ProviderError("ytweb", "parse", "ytweb: playlist response carried no title");
          }
          meta.title = page.title;
          meta.description = page.description;
        }
        return page;
      });
      if (meta.title === undefined) {
        throw new ProviderError("ytweb", "parse", "ytweb: playlist response carried no title");
      }
      return {
        title: meta.title,
        ...(meta.description !== undefined ? { description: meta.description } : {}),
        entries,
        truncated,
      };
    } catch (error) {
      throw wrapFailure("ytweb", error);
    }
  },
};
