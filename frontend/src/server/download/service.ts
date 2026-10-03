/**
 * Assembling one download (M20; spec `download` — "Media is streamed to the response and never
 * buffered in server memory" and "A download is bounded, abortable, and fails in a form the caller
 * can act on"; design decisions 4, 5, 6).
 *
 * The route is thin on purpose. Everything that can be decided without a network is decided here or
 * in the two pure modules underneath, so the only thing left in `route.ts` is: guard, validate, call,
 * translate a failure into a status.
 *
 * ## What "streaming" means here, precisely
 *
 * The upstream body is handed to the response **without ever being read**. ytdl's Node `Readable` is
 * converted with `Readable.toWeb`; Invidious' `fetch` body is passed through. Nothing calls
 * `.arrayBuffer()`, `.blob()`, or `.text()` on a media body, because one such call materialises the
 * whole track in the function's heap — which is both the memory problem in §21.5's deployment table
 * and, on a Hobby plan, the thing that turns a 5 MB track into a 413.
 *
 * The client *does* hold the finished file in a Blob before the save dialog, because §21.5
 * prescribes exactly that and because a browser cannot offer a save dialog for a body it has not
 * read. Those are different problems and the requirement says so; see the spec text.
 *
 * ## The byte ceiling is the same number the format selection used
 *
 * `DOWNLOAD_BUDGET_BYTES` bounds what selection promises *and* what the stream will deliver. Two
 * numbers would be two chances to disagree, and a provider that sent more than it advertised would
 * be caught by the second one. Cancelling mid-stream is deliberate: a transfer cut off by the
 * platform's 120 s proxy timeout and then served as a completed 200 is a truncated file that looks
 * whole, which is the worst outcome available.
 */

import { downloadFilename } from "./container";
import { DOWNLOAD_BUDGET_BYTES } from "./selectFormat";
import {
  createAudioSourceChain,
  ExtractionError,
  type AudioSource,
  type ResolvedAudio,
} from "./sources";

/** What a successful download looks like, before the route wraps it in a `Response`. */
export interface DownloadPayload {
  /** The stream. Already bounded and already linked to the caller's abort. */
  readonly stream: ReadableStream<Uint8Array>;
  /** Headers the route must send with it. No `Content-Length` — see {@link downloadHeaders}. */
  readonly headers: Readonly<Record<string, string>>;
  /** Which extractor produced it, for the evidence trail and for diagnosing a failure. */
  readonly source: ResolvedAudio["source"];
}

export interface DownloadDeps {
  /** The extractor chain to try, in order. */
  readonly sources: readonly AudioSource[];
  /** The byte ceiling. Defaults to {@link DOWNLOAD_BUDGET_BYTES}. */
  readonly budgetBytes?: number;
}

/**
 * The headers a download is served with.
 *
 * **`Content-Length` is deliberately absent.** The size is an estimate, not a measurement, and a
 * wrong length is worse than none: a browser that trusts a short one stops reading early and writes a
 * truncated file that reports itself complete.
 *
 * The four `X-Spotivibe-Download-*` headers exist because the two most surprising outcomes of this
 * feature are otherwise invisible: a file smaller than the track's best format (the budget bitrate
 * ladder walked down) and an Opus-in-WebM file named `.webm` rather than the `.mp3` a listener may
 * expect. Both are stated in headers a human can read in devtools.
 */
/**
 * Hold a resource until the **body** settles, not until the handler returns.
 *
 * This exists because of a real defect it fixed. The download limiter's whole point is bounding
 * *transfers*: its per-address rule allows one concurrent download, and its per-instance rule allows
 * four. Releasing the permit in the route's `finally` released it the instant the `Response` object
 * was constructed — which is *before the first byte has been read from the upstream*. What the
 * limiter bounded was therefore concurrent **resolutions** (the metadata lookups), while the actual
 * multi-megabyte bodies streamed unbounded afterwards. The number in the file's own documentation
 * was describing behaviour it did not have.
 *
 * `onSettled` runs exactly once, on whichever happens first: the source closing normally, the source
 * erroring, or the consumer cancelling (a listener who navigates away). It is safe to pass an
 * idempotent release, and it is safe to pass one that throws only on the second call, because the
 * guard below is in this function rather than relying on the caller's.
 *
 * @param source the stream to pass through unchanged, in content and order
 * @param onSettled called once, after the last chunk, the first error, or the cancellation
 */
export function holdUntilSettled(
  source: ReadableStream<Uint8Array>,
  onSettled: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onSettled();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          settle();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        settle();
        controller.error(error);
      }
    },
    async cancel(reason) {
      settle();
      await reader.cancel(reason);
    },
  });
}

export function downloadHeaders(payload: {
  resolved: ResolvedAudio;
  title: string;
}): Readonly<Record<string, string>> {
  const { resolved, title } = payload;
  const filename = downloadFilename(title, resolved.description.extension);
  const headers: Record<string, string> = {
    "Content-Type": resolved.description.mime,
    // Both forms: the ASCII one for a browser that will not look at the second, and the RFC 5987
    // one so a non-ASCII title survives. The ASCII form is already sanitised to letters, numbers
    // and dashes by `downloadFilename`.
    "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    // Never cacheable. This is per-track media at a URL a caller could re-request forever; a cached
    // copy is a second copy of the file nobody asked to keep.
    "Cache-Control": "no-store",
    "X-Spotivibe-Download-Source": resolved.source,
    "X-Spotivibe-Download-Container": resolved.description.container,
    "X-Spotivibe-Download-Codec": resolved.description.codec,
    "X-Spotivibe-Download-Budget-Exceeded": String(resolved.budgetExceeded),
  };
  if (resolved.estimatedBytes !== null) {
    headers["X-Spotivibe-Download-Estimated-Bytes"] = String(resolved.estimatedBytes);
  }
  if (resolved.estimateSource !== "none") {
    headers["X-Spotivibe-Download-Estimate-Source"] = resolved.estimateSource;
  }
  return headers;
}

/**
 * Wrap a stream so it is cancelled if it runs past the ceiling.
 *
 * The reader is cancelled before the controller errors, because cancelling upstream is what stops the
 * bytes still arriving; erroring the controller alone would stop the *client* while the provider kept
 * sending into a function that is no longer listening.
 */
function withByteCeiling(
  upstream: ReadableStream<Uint8Array>,
  ceiling: number,
): ReadableStream<Uint8Array> {
  const reader = upstream.getReader();
  let delivered = 0;
  let closed = false;

  const release = async (reason: unknown): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await reader.cancel(reason);
    } catch {
      // An upstream that refuses to be cancelled is already gone as far as this route is concerned.
      // Swallowing here is the point: a cancellation failure must not become an unhandled rejection
      // on a request the caller has already abandoned.
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        closed = true;
        controller.error(error);
        return;
      }
      if (chunk.done) {
        closed = true;
        controller.close();
        return;
      }
      delivered += chunk.value.byteLength;
      if (delivered > ceiling) {
        await release(new Error(`download exceeded ${ceiling} bytes`));
        controller.error(new Error("download exceeded its size ceiling"));
        return;
      }
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      // The client went away. Propagating here is what makes "abort on client disconnect" true for
      // the body phase, the way `request.signal` is for the resolve phase.
      await release(reason);
    },
  });
}

/**
 * Resolve one track and return its stream, or throw a structured failure.
 *
 * Extractors are tried in order. A failure from one is remembered and the next is tried; only when
 * every extractor has failed is the last failure thrown, so the caller reports the *final* reason
 * rather than the first.
 *
 * @throws {ExtractionError} `aborted` when the caller went away, `no_suitable_format` when a track
 * has no format this application will name honestly, `unavailable` when every extractor failed.
 */
export async function resolveTrackDownload(
  videoId: string,
  title: string,
  signal: AbortSignal,
  deps: DownloadDeps = { sources: createAudioSourceChain() },
): Promise<DownloadPayload> {
  const budgetBytes = deps.budgetBytes ?? DOWNLOAD_BUDGET_BYTES;
  let lastFailure: unknown;

  for (const source of deps.sources) {
    if (signal.aborted) {
      throw new ExtractionError("aborted", "the request was cancelled", { cause: signal.reason });
    }
    let resolved: ResolvedAudio;
    try {
      resolved = await source.resolve(videoId, signal);
    } catch (error) {
      // A caller who disconnected stops the whole chain, not just this extractor.
      if (signal.aborted) {
        throw new ExtractionError("aborted", "the request was cancelled", { cause: signal.reason });
      }
      lastFailure = error;
      continue;
    }

    // The stream is opened *before* the headers are built, so an upstream that refuses to open is a
    // failure the caller sees rather than a 200 whose body errors halfway down.
    let upstream: ReadableStream<Uint8Array>;
    try {
      upstream = await resolved.open(signal);
    } catch (error) {
      lastFailure = error;
      continue;
    }

    return {
      stream: withByteCeiling(upstream, budgetBytes),
      headers: downloadHeaders({ resolved, title }),
      source: resolved.source,
    };
  }

  if (lastFailure instanceof ExtractionError) throw lastFailure;
  throw new ExtractionError("unavailable", "this track could not be downloaded", {
    cause: lastFailure,
  });
}
