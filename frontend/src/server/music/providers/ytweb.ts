import { fetchJson } from "@/server/http/fetchJson";
import { ProviderError } from "../errors";
import { parseDurationText } from "../normalize";
import type { ArtworkCandidate, MusicProvider, ProviderCandidate } from "../types";
import { ATTEMPT_TIMEOUT_MS, collectNodes, JSON_HEADERS, wrapFailure } from "./support";

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

/** Tier implementation — see {@link parseYtwebSearch} for parse behavior. */
export const ytwebProvider: MusicProvider = {
  id: "ytweb",
  async search(request) {
    try {
      const body = await fetchJson<unknown>(WEB_SEARCH_URL, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          context: WEB_CONTEXT,
          query: `${request.query} song`,
        }),
        signal: request.signal,
        timeoutMs: ATTEMPT_TIMEOUT_MS,
      });
      return parseYtwebSearch(body);
    } catch (error) {
      throw wrapFailure("ytweb", error);
    }
  },
};
