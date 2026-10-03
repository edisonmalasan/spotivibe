import { z } from "zod";
import { guardRequest } from "@/server/http/guard";
import { requestToAddress } from "@/server/http/requestAddress";
import { beginDownload } from "@/server/download/limiter";
import { holdUntilSettled, resolveTrackDownload } from "@/server/download/service";
import { ExtractionError } from "@/server/download/sources";

/**
 * The download route (ROADMAP §21.5; spec `download`).
 *
 * `GET /api/download/[videoId]?title=`
 *
 * Thin by design. Everything that can be decided without a network is decided in
 * `server/download/`, so this file is: guard, validate, call, translate a failure into a status.
 *
 * ## The one boundary that matters here
 *
 * The **only** input that reaches an extractor is the provider id in the path. There is no `url`
 * parameter, no body, and no header that names a media location, and the release exclusion that
 * forbids caller-supplied URL proxying is extended to assert it. That boundary is the difference
 * between "download the track the listener is looking at" and "fetch anything this caller names",
 * and §21.5's non-goals forbid the second.
 *
 * `?title=` is not that. A title is listener-visible text used only as the filename stem, it is
 * sanitised in `downloadFilename`, and it cannot influence where the bytes come from.
 *
 * ## `maxDuration` is stated, not inherited
 *
 * §21.5 requires it explicitly. 300 s is Vercel's Hobby maximum with Fluid compute, which is
 * comfortably above what a bounded single-track transfer needs; the real ceiling is the platform's
 * 120 s proxied request timeout, and the bitrate ladder in `selectFormat` exists to stay inside it.
 * **None of those three numbers is observed behaviour in this repository** — both the production and
 * every Preview origin sit behind Vercel Deployment Protection, so they are documented constraints
 * this route is designed against, not measurements. See `frontend/docs/DOWNLOADING.md`.
 */

/**
 * The maximum function duration, in seconds.
 *
 * Stated rather than left to the platform default so that a change to the plan, a change to the
 * default, or a misconfigured project cannot silently move a constraint this route is designed
 * around.
 */
export const maxDuration = 300;

/** YouTube video ids are exactly 11 URL-safe base64 characters. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * Bounded so a hostile caller cannot use the filename as a header-injection vehicle or make the
 * download dialog show a megabyte of text. 300 characters is far more than any real title needs.
 */
const MAX_TITLE_LENGTH = 300;

const downloadParamsSchema = z.object({
  videoId: z.string().regex(VIDEO_ID_PATTERN, "videoId must be an 11-character YouTube video id"),
  title: z
    .string()
    .trim()
    .max(MAX_TITLE_LENGTH, `title must be at most ${MAX_TITLE_LENGTH} characters`)
    .default(""),
});

const NO_STORE = "no-store";

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(
    { error: { code, message, ...extra } },
    { status, headers: { "Cache-Control": NO_STORE } },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ videoId: string }> },
): Promise<Response> {
  // Throttled before anything else, exactly as the other provider-mediated routes do: a refused
  // request must not have already cost an extractor call.
  const throttled = guardRequest(request);
  if (throttled) return throttled;

  // …and a caller who has already disconnected is answered before the limiters, because the
  // download limiter *also* refuses an aborted request (it must not queue a slot for somebody who
  // is no longer there). Without this check that refusal would reach the caller as a 429 — telling
  // someone they were rate-limited when they had simply closed the tab, and recording a window
  // entry against their address for a download they did not make.
  if (request.signal.aborted) {
    return new Response(null, { status: 499, headers: { "Cache-Control": NO_STORE } });
  }

  // Set once the permit has been handed to the response body, so the `finally` below knows not to
  // release a slot whose transfer is still running. Declared before any early return so every path
  // through this function is covered by one rule rather than by remembering to opt out.
  let handedOff = false;

  const { videoId: rawVideoId } = await context.params;
  const title = new URL(request.url).searchParams.get("title") ?? "";
  const parsed = downloadParamsSchema.safeParse({ videoId: rawVideoId, title });

  // Invalid input never reaches an extractor.
  if (!parsed.success) {
    return errorResponse(
      400,
      "invalid_request",
      parsed.error.issues[0]?.message ?? "Invalid request.",
    );
  }
  const { videoId, title: safeTitle } = parsed.data;

  // A second, download-specific limit behind the shared one: see `server/download/limiter.ts` for
  // why a 60-per-minute *request* budget is the wrong ceiling for multi-megabyte transfers.
  const permit = await beginDownload(requestToAddress(request), request.signal);
  if (!permit.allowed) {
    return Response.json(
      {
        error: {
          code: permit.refusal,
          message:
            permit.refusal === "already_downloading"
              ? "A download is already in progress for this client. Please wait for it to finish."
              : "Too many downloads. Please try again shortly.",
        },
        limit: permit.limit,
        retryAfterSeconds: permit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Cache-Control": NO_STORE,
          "Retry-After": String(permit.retryAfterSeconds),
        },
      },
    );
  }

  try {
    const payload = await resolveTrackDownload(videoId, safeTitle, request.signal);
    // The permit is handed to the stream rather than released here. A `Response` is constructed
    // *before* its body is read, so a `finally { permit.release() }` released the slot while the
    // upstream transfer had barely started — which made the limiter bound concurrent *metadata
    // lookups* while the multi-megabyte bodies streamed unbounded afterwards, the opposite of what
    // `server/download/limiter.ts` documents. `holdUntilSettled` releases on close, on error, and on
    // a client that walks away, exactly once.
    handedOff = true;
    return new Response(holdUntilSettled(payload.stream, permit.release), {
      status: 200,
      headers: payload.headers,
    });
  } catch (error) {
    if (request.signal.aborted) {
      // Caller disconnected mid-flight — nothing left to deliver.
      return new Response(null, { status: 499, headers: { "Cache-Control": NO_STORE } });
    }
    if (error instanceof ExtractionError) {
      if (error.code === "no_suitable_format") {
        return errorResponse(
          502,
          "no_suitable_format",
          "This track has no downloadable audio format.",
          {
            reason: error.source === undefined ? "" : String(error.source),
          },
        );
      }
      if (error.code === "aborted") {
        return new Response(null, { status: 499, headers: { "Cache-Control": NO_STORE } });
      }
      return errorResponse(
        502,
        "upstream_unavailable",
        "This track could not be downloaded right now. Please try again shortly.",
        { extractor: error.source === undefined ? "unknown" : error.source },
      );
    }
    // Not an `ExtractionError`, therefore not something `resolveTrackDownload` anticipated: it
    // wraps every other failure it sees, so reaching here means a bug in this route or in the
    // mapping above it. Rethrowing lets the platform report it as a 500 and lets the error surface
    // in logs, instead of disguising a defect as an upstream outage a listener would be told to
    // retry. A generic 500 body leaks no more of the message than a 502 would.
    throw error;
  } finally {
    // Every path *except* the success one released its own permit here. The success path handed
    // ownership to the stream, so releasing in this `finally` would have released it at the moment
    // the `Response` was constructed rather than when the transfer ended.
    if (!handedOff) permit.release();
  }
}
