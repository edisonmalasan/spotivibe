/**
 * The extractors, behind one interface (M20; ROADMAP §21.5; design decisions 1, 2, 3, 5).
 *
 * Two implementations — `@distube/ytdl-core` primary, a bounded Invidious instance list as the
 * fallback — and one interface, so every decision that matters (which format, what the file is
 * called, whether it is streamed) is made once, in `container.ts` and `selectFormat.ts`, and neither
 * extractor can drift from the other on any of them.
 *
 * ## Why the interface hands back an `open` thunk
 *
 * `resolve` cannot return a URL and expect `open` to be given nothing else. ytdl has already spent
 * the expensive part of its work — the manifest fetch and the decipher — by the time a format is
 * chosen, and re-deriving it from a URL would throw that work away. So `resolve` returns a resolved
 * audio *and the means to stream it*, bound to whatever the extractor needed while resolving. The
 * consequence for tests is better than it looks: a stub source hands back its own stub stream, and
 * the route, the headers, the byte ceiling, and the abort path are all exercised with no network.
 *
 * ## Nothing here buffers
 *
 * `open` returns a `ReadableStream`. ytdl's Node `Readable` is converted with `Readable.toWeb`
 * rather than read; Invidious' `fetch` response body is passed through as-is. No branch anywhere in
 * this file reads a media body whole, because doing so once is enough to defeat the 4.5 MB
 * deployment limit that §21.5's streaming requirement exists to avoid.
 *
 * ## The fallback is best-effort, and says so
 *
 * §21.5's own table records that public Invidious instances are "frequently rate-limited or down"
 * and that this "must be surfaced as a failure state, not hidden". So an exhausted instance list is
 * a distinct {@link ExtractionError} code the route turns into a 502 naming the fallback as the
 * reason — never an empty or truncated success.
 */

import { Readable } from "node:stream";
import { fetchJson } from "@/server/http/fetchJson";
import { getServerEnv } from "@/server/env";
import { BROWSER_USER_AGENT, parseInstanceList } from "@/server/music/providers/support";
import type { AudioFormatDescription } from "./container";
import {
  selectAudioFormat,
  toCandidates,
  type EstimateSource,
  type RawAudioFormat,
} from "./selectFormat";

/** Which extractor produced a stream. Reported in a response header so a failure is diagnosable. */
export type AudioSourceName = "ytdl" | "invidious";

/**
 * Why extraction could not produce a stream.
 *
 * A code rather than a message, because the caller turns it into an HTTP status and a client
 * branches on it. `aborted` is separate from `unavailable` so a disconnect is never reported as an
 * upstream failure.
 */
export type ExtractionFailureCode = "unavailable" | "no_suitable_format" | "aborted" | "unknown";

export class ExtractionError extends Error {
  readonly code: ExtractionFailureCode;
  /** The extractor that produced this failure, when one of them did. */
  readonly source: AudioSourceName | undefined;

  constructor(
    code: ExtractionFailureCode,
    message: string,
    options: { source?: AudioSourceName; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ExtractionError";
    this.code = code;
    this.source = options.source;
  }
}

/** A track resolved to a specific format, and the means to stream it. */
export interface ResolvedAudio {
  readonly source: AudioSourceName;
  /** The honest file description of the selected format. Never re-derived downstream. */
  readonly description: AudioFormatDescription;
  /** Audio bitrate of the selected format, in bits per second. */
  readonly audioBitrate: number;
  /** Estimated size in bytes, or `null` when the extractor could not size the format. */
  readonly estimatedBytes: number | null;
  /** Which branch produced the estimate. */
  readonly estimateSource: EstimateSource;
  /** Whether the budget was exceeded and a lower format was chosen to fit it. */
  readonly budgetExceeded: boolean;
  /** Opens the stream for this selection. Bound to whatever the extractor needed while resolving. */
  open(signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

/**
 * One extractor.
 *
 * `resolve` is where the network happens and where every "can this be downloaded" decision is made;
 * `open` is where the bytes start moving. Keeping them separate is what lets the route enforce its
 * byte ceiling and its abort path without either extractor owning either responsibility.
 */
export interface AudioSource {
  readonly name: AudioSourceName;
  /** @throws {ExtractionError} */
  resolve(videoId: string, signal: AbortSignal): Promise<ResolvedAudio>;
}

/* ------------------------------------------------------------------ *
 * Timeouts
 * ------------------------------------------------------------------ */

/**
 * How long the manifest phase may take.
 *
 * The manifest fetch is two or three requests plus a decipher; eight seconds is generous for that and
 * short enough that a stuck extractor does not eat the route's `maxDuration`. The *stream* phase is
 * not bounded here — it is bounded by the byte ceiling, which is the constraint that actually applies
 * to a body.
 */
export const RESOLVE_TIMEOUT_MS = 8_000;

/**
 * How long one Invidious instance may take to answer.
 *
 * Shorter than {@link RESOLVE_TIMEOUT_MS} because a fallback is by definition running on someone
 * else's clock: an instance that has not answered in four seconds is not going to, and the next one
 * might.
 */
export const INVIDIOUS_ATTEMPT_TIMEOUT_MS = 4_000;

/** The instance list the fallback rotates through. Narrower and faster than the catalogue tier. */
const DEFAULT_FALLBACK_INSTANCES = ["https://yewtu.be", "https://invidious.f5.si"];

/** How many fallback instances are tried before the fallback is declared exhausted. */
const MAX_FALLBACK_ATTEMPTS = 3;

/* ------------------------------------------------------------------ *
 * Primary extractor
 * ------------------------------------------------------------------ */

/** The subset of ytdl's `videoFormat` this module reads. Structural, so the typings stay optional. */
interface YtdlFormatLike {
  itag?: number;
  url?: string;
  mimeType?: string;
  codecs?: string;
  audioCodec?: string;
  audioBitrate?: number;
  contentLength?: string | number;
}

/** The subset of ytdl's `videoInfo` this module reads. */
interface YtdlInfoLike {
  formats?: YtdlFormatLike[];
  videoDetails?: { lengthSeconds?: string };
}

interface YtdlModule {
  getInfo(
    id: string,
    options?: { requestOptions?: { signal?: AbortSignal } },
  ): Promise<YtdlInfoLike>;
  filterFormats(formats: YtdlFormatLike[], filter: "audioonly"): YtdlFormatLike[];
  downloadFromInfo(
    info: YtdlInfoLike,
    options: { format: YtdlFormatLike; requestOptions?: { signal?: AbortSignal } },
  ): Readable;
}

/**
 * Load the primary extractor.
 *
 * A dynamic `import()` for two reasons that both matter: the package is server-only and must never
 * enter a client module graph, and a deployment where it fails to load should still reach the
 * Invidious fallback rather than fail to start the function at all.
 *
 * @throws {ExtractionError} when the module cannot be loaded.
 */
async function loadYtdl(): Promise<YtdlModule> {
  try {
    const loaded = (await import("@distube/ytdl-core")) as unknown as { default: YtdlModule };
    return loaded.default;
  } catch (error) {
    throw new ExtractionError("unavailable", "the primary extractor could not be loaded", {
      source: "ytdl",
      cause: error,
    });
  }
}

/**
 * Normalise one ytdl format.
 *
 * ytdl types `contentLength` as a **string** and reports the codec in two places depending on version
 * (`audioCodec`, or a dotted `codecs` list). Both are handled here rather than in the selector,
 * because "ytdl says this" and "Invidious says this" should not be two different shapes reaching one
 * decision.
 */
function fromYtdlFormat(format: YtdlFormatLike): RawAudioFormat {
  const length =
    typeof format.contentLength === "string" ? Number(format.contentLength) : format.contentLength;
  return {
    itag: format.itag,
    mimeType: format.mimeType,
    audioCodec: format.audioCodec ?? format.codecs,
    audioBitrate: format.audioBitrate ?? 0,
    contentLength:
      typeof length === "number" && Number.isFinite(length) && length > 0 ? length : undefined,
  };
}

/**
 * Run `work` with a deadline, aborting it when the deadline passes.
 *
 * The abort is the point. A timeout that only stops *waiting* leaves the upstream request running and
 * still holding a socket, which on a serverless instance is the difference between "the user waited
 * too long" and "the function kept costing money after the user left". The caller's signal is linked
 * in, so a disconnect aborts through the same controller.
 */
async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  caller: AbortSignal,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  const onCallerAbort = (): void => controller.abort(caller.reason);
  if (caller.aborted) controller.abort(caller.reason);
  else caller.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("The operation timed out.", "TimeoutError"));
  }, ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
    caller.removeEventListener("abort", onCallerAbort);
  }
}

/**
 * The primary extractor.
 *
 * `getInfo()` first, then ytdl's own `audioonly` filter, then **this** application's container
 * mapping and bitrate ladder. The order matters: ytdl's filter answers "is there audio here", and
 * only what survives it can be given an honest file name.
 */
export const ytdlAudioSource: AudioSource = {
  name: "ytdl",
  async resolve(videoId, signal) {
    const ytdl = await loadYtdl();

    let info: YtdlInfoLike;
    try {
      info = await withDeadline(
        (inner) => ytdl.getInfo(videoId, { requestOptions: { signal: inner } }),
        signal,
        RESOLVE_TIMEOUT_MS,
      );
    } catch (error) {
      if (signal.aborted) {
        throw new ExtractionError("aborted", "the request was cancelled", {
          source: "ytdl",
          cause: error,
        });
      }
      throw new ExtractionError("unavailable", "the primary extractor could not read this track", {
        source: "ytdl",
        cause: error,
      });
    }

    const durationSeconds = Number(info.videoDetails?.lengthSeconds ?? Number.NaN);
    const audioOnly = ytdl.filterFormats(info.formats ?? [], "audioonly");
    const candidates = toCandidates(
      audioOnly.map(fromYtdlFormat),
      Number.isFinite(durationSeconds) ? durationSeconds : undefined,
    );
    const outcome = selectAudioFormat(candidates);
    if (!outcome.selected) {
      throw new ExtractionError("no_suitable_format", outcome.reason, { source: "ytdl" });
    }

    const { selection } = outcome;
    // Re-find the provider format the selection names. The selector works on reduced candidates, so
    // this is the join back to the object ytdl's downloader needs — and it is the join that fails
    // loudly rather than silently streaming the wrong bytes if the two ever disagreed.
    const chosen = audioOnly.find(
      (format) => format.itag === selection.format.itag && format.url !== undefined,
    );
    if (chosen === undefined) {
      throw new ExtractionError("no_suitable_format", "the selected format could not be reopened", {
        source: "ytdl",
      });
    }

    return {
      source: "ytdl",
      description: selection.description,
      audioBitrate: selection.format.audioBitrate,
      estimatedBytes: selection.estimatedBytes,
      estimateSource: selection.estimateSource,
      budgetExceeded: selection.budgetExceeded,
      async open(openSignal) {
        // `Readable.toWeb` rather than reading into memory: the whole point of this route is that
        // the body is never materialised whole on the server.
        const stream = ytdl.downloadFromInfo(info, {
          format: chosen,
          requestOptions: { signal: openSignal },
        });
        return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
      },
    };
  },
};

/* ------------------------------------------------------------------ *
 * Fallback extractor
 * ------------------------------------------------------------------ */

/** The subset of an Invidious video response this module reads. */
export interface InvidiousVideoResponse {
  lengthSeconds?: number;
  adaptiveFormats?: Array<{
    itag?: string | number;
    url?: string;
    type?: string;
    codecs?: string;
    bitrate?: string | number;
    container?: string;
  }>;
}

export interface ParsedInvidiousVideo {
  candidates: RawAudioFormat[];
  /** Media URL by itag, so the selected candidate can be reopened without re-parsing. */
  urlsByItag: Map<number, string>;
  durationSeconds: number | undefined;
}

/**
 * Parse an Invidious video response into candidates (pure, fixture-tested, no network).
 *
 * Kept pure and exported for exactly the reason `parseInvidiousSearch` is: the fallback's parsing is
 * the part that must not be trusted to "look right", and it is the part most likely to be quietly
 * wrong when an instance changes its shape.
 *
 * @throws {ExtractionError} when the body is not an object at all.
 */
export function parseInvidiousVideo(body: unknown): ParsedInvidiousVideo {
  if (body === null || typeof body !== "object") {
    throw new ExtractionError(
      "unavailable",
      "the fallback instance returned a body that is not an object",
    );
  }
  const record = body as InvidiousVideoResponse;
  const urlsByItag = new Map<number, string>();
  const formats: RawAudioFormat[] = [];

  for (const format of record.adaptiveFormats ?? []) {
    const url = typeof format.url === "string" ? format.url : undefined;
    // Only audio-only formats. `type` is the discriminator Invidious reports, and it is tested
    // against `audio/` rather than for "not video" so an unlabelled format is skipped rather than
    // guessed at.
    const isAudio =
      typeof format.type === "string" && format.type.trim().toLowerCase().startsWith("audio/");
    if (url === undefined || !isAudio) continue;

    // Invidious reports itags as **strings** (`"140"`), while ytdl reports them as numbers. The
    // selection is reopened by joining back on itag, so a string itag that was kept as a string
    // would never join — and the failure would read as "no suitable format" for a track the
    // instance could plainly serve. Normalising here is what makes the two extractors interchangeable.
    const numeric = typeof format.itag === "number" ? format.itag : Number(format.itag);
    const itag = Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
    // A format this source cannot reopen must not be offered. Keeping it would mean the selector
    // could choose something whose URL is not reachable, turning a join failure into a dead format
    // that outranks every usable one.
    if (itag === undefined) continue;

    const bitrate = typeof format.bitrate === "string" ? Number(format.bitrate) : format.bitrate;
    urlsByItag.set(itag, url);
    formats.push({
      itag,
      mimeType: format.type,
      // Invidious puts the whole codec list in `codecs`; the mapper reads the first entry.
      audioCodec: format.codecs,
      audioBitrate: typeof bitrate === "number" && Number.isFinite(bitrate) ? bitrate : 0,
    });
  }

  // `> 0`, not merely finite: a zero duration derives a zero-byte estimate, and a zero-byte estimate
  // reads as "comfortably inside the budget". An absent duration is the honest answer and produces
  // "cannot size this", which the selector then declines to claim fits.
  const durationSeconds =
    typeof record.lengthSeconds === "number" &&
    Number.isFinite(record.lengthSeconds) &&
    record.lengthSeconds > 0
      ? record.lengthSeconds
      : undefined;

  return { candidates: formats, urlsByItag, durationSeconds };
}

/** The configured fallback instances, or the built-in pair. */
function resolveFallbackInstances(): readonly string[] {
  const configured = parseInstanceList(
    getServerEnv().SPOTIVIBE_INVIDIOUS_INSTANCES,
    DEFAULT_FALLBACK_INSTANCES,
  );
  return configured.length > 0 ? configured : DEFAULT_FALLBACK_INSTANCES;
}

/**
 * The fallback extractor.
 *
 * Rotates a bounded instance list, each with its own timeout, and stops the moment one answers.
 * Every instance failing is an {@link ExtractionError} naming the fallback, which is what the route
 * turns into a 502.
 */
export function createInvidiousAudioSource(
  instances: readonly string[] = resolveFallbackInstances(),
): AudioSource {
  return {
    name: "invidious",
    async resolve(videoId, signal) {
      const list = instances.slice(0, MAX_FALLBACK_ATTEMPTS);
      let lastFailure: unknown;

      for (const instance of list) {
        if (signal.aborted) {
          throw new ExtractionError("aborted", "the request was cancelled", {
            source: "invidious",
          });
        }

        let parsed: ParsedInvidiousVideo;
        try {
          const body = await fetchJson<unknown>(
            `${instance}/api/v1/videos/${encodeURIComponent(videoId)}`,
            {
              headers: { Accept: "application/json", "User-Agent": BROWSER_USER_AGENT },
              signal,
              timeoutMs: INVIDIOUS_ATTEMPT_TIMEOUT_MS,
            },
          );
          parsed = parseInvidiousVideo(body);
        } catch (error) {
          if (signal.aborted) {
            throw new ExtractionError("aborted", "the request was cancelled", {
              source: "invidious",
              cause: error,
            });
          }
          // Either the instance did not answer or it answered unusably. Both are one more attempt.
          lastFailure = error;
          continue;
        }

        const candidates = toCandidates(parsed.candidates, parsed.durationSeconds);
        const outcome = selectAudioFormat(candidates);
        if (!outcome.selected) {
          lastFailure = new ExtractionError("no_suitable_format", outcome.reason, {
            source: "invidious",
          });
          continue;
        }

        const { selection } = outcome;
        const itag = selection.format.itag;
        const url = itag === undefined ? undefined : parsed.urlsByItag.get(itag);
        if (url === undefined) {
          lastFailure = new ExtractionError(
            "no_suitable_format",
            "the selected format could not be reopened",
            { source: "invidious" },
          );
          continue;
        }

        return {
          source: "invidious",
          description: selection.description,
          audioBitrate: selection.format.audioBitrate,
          estimatedBytes: selection.estimatedBytes,
          estimateSource: selection.estimateSource,
          budgetExceeded: selection.budgetExceeded,
          async open(openSignal) {
            // `response.body` is passed straight through. It is already a stream, and reading it
            // would defeat the only constraint this route exists to respect.
            const upstream = await fetch(url, { signal: openSignal, redirect: "follow" });
            if (!upstream.ok || upstream.body === null) {
              throw new ExtractionError("unavailable", "the fallback stream could not be opened", {
                source: "invidious",
              });
            }
            return upstream.body as ReadableStream<Uint8Array>;
          },
        };
      }

      if (lastFailure instanceof ExtractionError) throw lastFailure;
      throw new ExtractionError(
        "unavailable",
        "every fallback instance failed, so this track could not be downloaded",
        { source: "invidious", cause: lastFailure },
      );
    },
  };
}

/* ------------------------------------------------------------------ *
 * The chain
 * ------------------------------------------------------------------ */

/**
 * The extractor chain, in order: primary first, fallback second.
 *
 * A plain array rather than the catalogue's `chain.ts` machinery, because this needs something
 * narrower and faster — and reusing a ranking-and-caching policy tuned for *metadata* would be the
 * wrong tool for picking one audio format.
 */
export function createAudioSourceChain(
  sources: readonly AudioSource[] = [ytdlAudioSource, createInvidiousAudioSource()],
): readonly AudioSource[] {
  return [...sources];
}
