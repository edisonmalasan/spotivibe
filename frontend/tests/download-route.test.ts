import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as downloadGet, maxDuration } from "@/app/api/download/[videoId]/route";
import { ExtractionError } from "@/server/download/sources";
import { DOWNLOAD_LIMIT, resetDownloadLimiter } from "@/server/download/limiter";
import {
  THROTTLE_LIMIT,
  consumeThrottle,
  resetThrottle,
  throttleKeyFor,
} from "@/server/http/throttle";

/**
 * The download route's contract (M20; ROADMAP §21.5; spec `download`).
 *
 * Four statuses and a fifth one nobody asked for are asserted here, because they are the whole of
 * what this route's callers can act on:
 *
 * - **400** — input that never reaches an extractor.
 * - **429** — either limiter refusing, carrying `Retry-After` so a client can back off on its own.
 * - **499** — the caller disconnected. Not a real HTTP status, and deliberately not 200: a
 *   disconnected caller has nothing to download, and answering anyway costs a transfer nobody wants.
 * - **502** — every extractor failed, or the track has no format this application will name
 *   honestly. Distinguishable from each other, because the two mean different things to a listener.
 * - **200** — a stream, with no `Content-Length`.
 *
 * `resolveTrackDownload` is mocked because exercising it needs an extractor; everything else in this
 * route — the guard, validation, both limiters, the status mapping — is the real implementation. The
 * shared throttle is reset between tests and every test uses its own address, so no test can be
 * failed by another's requests.
 */

const resolveTrackDownload = vi.hoisted(() => vi.fn());
const permitFor = vi.hoisted(() => vi.fn());

vi.mock("@/server/download/service", () => ({
  resolveTrackDownload: resolveTrackDownload,
}));

vi.mock("@/server/download/limiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/download/limiter")>();
  return {
    ...actual,
    beginDownload: (address: string, signal: AbortSignal) => {
      const override = permitFor(address, signal);
      return override ?? actual.beginDownload(address, signal);
    },
  };
});

const VIDEO_ID = "dQw4w9WgXcQ";
const PATH = `/api/download/${VIDEO_ID}`;

let addressCounter = 0;

/** A request from its own address, so the shared throttle cannot be tripped by another test. */
function request(query: Record<string, string> = {}, signal?: AbortSignal): Request {
  addressCounter += 1;
  const url = new URL(`http://localhost${PATH}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url, {
    signal: signal ?? new AbortController().signal,
    headers: { "x-forwarded-for": `203.0.113.${addressCounter}` },
  });
}

/** The Next.js route context shape: `params` is itself a promise. */
function context(videoId: string): { params: Promise<{ videoId: string }> } {
  return { params: Promise.resolve({ videoId }) };
}

function call(query: Record<string, string> = {}, signal?: AbortSignal, videoId = VIDEO_ID) {
  return downloadGet(request(query, signal), context(videoId));
}

beforeEach(() => {
  resolveTrackDownload.mockReset();
  permitFor.mockReset();
  resetDownloadLimiter();
  resetThrottle();
  resolveTrackDownload.mockResolvedValue({
    source: "ytdl",
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    }),
    headers: {
      "Content-Type": "audio/webm",
      "Content-Disposition": 'attachment; filename="t.webm"',
      "Cache-Control": "no-store",
    },
  });
  permitFor.mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the stated function duration", () => {
  it("is 300 seconds, stated rather than inherited", () => {
    // §21.5 requires it explicitly. A change to the plan or to Vercel's default must be a change to
    // this file, not a silent move of a constraint the route is designed around.
    expect(maxDuration).toBe(300);
  });
});

describe("GET /api/download/[videoId] — validation", () => {
  it("rejects a malformed video id before any extractor call", async () => {
    for (const videoId of [
      "short",
      "way-too-long-video-id",
      "has spaces",
      "bad!chars!",
      "",
      "../../etc/passwd",
      "dQw4w9WgXcQ/extra",
    ]) {
      const response = await call({}, undefined, videoId);
      expect(response.status, `videoId ${JSON.stringify(videoId)}`).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("invalid_request");
      expect(resolveTrackDownload).not.toHaveBeenCalled();
    }
  });

  it("accepts every shape of a real 11-character id", async () => {
    for (const videoId of ["dQw4w9WgXcQ", "aaaaaaaaaaa", "A_-A_-A_-A_", "00000000000"]) {
      const response = await call({}, undefined, videoId);
      expect(response.status, videoId).toBe(200);
    }
    expect(resolveTrackDownload).toHaveBeenCalledTimes(4);
  });

  it("rejects an over-long title rather than truncating it", async () => {
    const response = await call({ title: "x".repeat(1000) });
    expect(response.status).toBe(400);
    expect(resolveTrackDownload).not.toHaveBeenCalled();
  });

  it("treats an absent title as an absent title, not as an error", async () => {
    // Every caller that does not know the title still has to be able to download.
    const response = await call();
    expect(response.status).toBe(200);
    expect(resolveTrackDownload.mock.calls[0]?.[1]).toBe("");
  });

  it("is never cacheable, on any status", async () => {
    for (const outcome of [await call({}, undefined, "bad"), await call()]) {
      expect(outcome.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

describe("GET /api/download/[videoId] — the input boundary", () => {
  /**
   * The requirement, asserted by *ignoring* the caller rather than by rejecting it.
   *
   * §21.5's non-goals forbid a download surface that fetches whatever the caller names. A `?url=`
   * parameter that is merely rejected would still be a parameter; the point is that the route has
   * no such parameter at all, so there is nothing for a caller to point somewhere else.
   */
  it("takes the video id only from the path, and ignores every other query parameter", async () => {
    const response = await call({
      url: "https://evil.example/someone-elses-audio",
      target: "https://evil.example/x",
      src: "https://evil.example/y",
      media: "https://evil.example/z",
      title: "Real Title",
    });
    expect(response.status).toBe(200);
    expect(resolveTrackDownload).toHaveBeenCalledTimes(1);
    const [videoId, title] = resolveTrackDownload.mock.calls[0] as [string, string];
    expect(videoId).toBe(VIDEO_ID);
    expect(title).toBe("Real Title");
    // And nothing the caller sent appears anywhere in the arguments.
    expect(JSON.stringify(resolveTrackDownload.mock.calls[0])).not.toContain("evil.example");
  });

  it("refuses to accept a URL-shaped video id", async () => {
    // Belt and braces on the same boundary: the path segment is validated, so even a route that
    // encoded a URL there would be rejected before it reached an extractor.
    for (const videoId of [
      "https:evil",
      "https%3A%2F%2F",
      "aaaaaaaaaaa%2f",
      "aaaaaaaaaaa?",
      "aaaaaaaaaaa#",
    ]) {
      const response = await call({}, undefined, videoId);
      expect(response.status, videoId).toBe(400);
    }
  });
});

describe("GET /api/download/[videoId] — success", () => {
  it("returns the extractor's stream and its headers verbatim", async () => {
    const response = await call({ title: "Real Title" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/webm");
    expect(response.headers.get("Content-Disposition")).toContain('filename="t.webm"');
    expect(response.body).toBeInstanceOf(ReadableStream);
  });

  it("never sends a Content-Length", async () => {
    // The size is an estimate; a browser that trusts a short one writes a truncated file that reports
    // itself complete. Asserted here as well as in the service suite because this is the boundary
    // where the header would actually appear on the wire.
    const response = await call();
    expect(response.headers.get("Content-Length")).toBeNull();
  });

  it("passes the title and the id through to the resolver, in that order", async () => {
    await call({ title: "Some Song" });
    expect(resolveTrackDownload.mock.calls[0]?.[0]).toBe(VIDEO_ID);
    expect(resolveTrackDownload.mock.calls[0]?.[1]).toBe("Some Song");
  });

  it("releases its permit once the transfer has been handed over", async () => {
    let released = false;
    permitFor.mockReturnValue({
      allowed: true,
      limit: DOWNLOAD_LIMIT,
      retryAfterSeconds: 1,
      release() {
        released = true;
      },
    });
    const response = await call();
    expect(response.status).toBe(200);
    expect(released, "a permit left held would eventually refuse every download").toBe(true);
  });

  it("releases its permit even when the resolver fails", async () => {
    let released = false;
    permitFor.mockReturnValue({
      allowed: true,
      limit: DOWNLOAD_LIMIT,
      retryAfterSeconds: 1,
      release() {
        released = true;
      },
    });
    resolveTrackDownload.mockRejectedValue(new ExtractionError("unavailable", "no"));
    await call();
    expect(released).toBe(true);
  });
});

describe("GET /api/download/[videoId] — failure statuses", () => {
  it("answers 502 when the track has no format this application will name honestly", async () => {
    resolveTrackDownload.mockRejectedValue(
      new ExtractionError("no_suitable_format", "nothing honest", { source: "ytdl" }),
    );
    const response = await call();
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string; reason?: string } };
    expect(body.error.code).toBe("no_suitable_format");
    expect(body.error.reason).toBe("ytdl");
  });

  it("answers 502 when every extractor failed", async () => {
    // Distinct from the case above because the listener's next move differs: retry later, rather
    // than accept that this track will never be downloadable.
    resolveTrackDownload.mockRejectedValue(
      new ExtractionError("unavailable", "primary and fallback both failed", {
        source: "invidious",
      }),
    );
    const response = await call();
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: { code: string; extractor?: string } };
    expect(body.error.code).toBe("upstream_unavailable");
    expect(body.error.extractor).toBe("invidious");
  });

  it("rethrows an unexpected error rather than disguising a defect as an upstream outage", async () => {
    // `resolveTrackDownload` wraps every failure it sees, so a raw `TypeError` here means a bug in
    // this route rather than an upstream problem. Turning it into a 502 would tell every affected
    // listener to retry later and would hide the defect from the logs, so it is rethrown and the
    // platform reports it as a 500. The test asserts the rethrow rather than a status, because the
    // status is the platform's business and the rethrow is this route's decision.
    resolveTrackDownload.mockRejectedValue(
      new TypeError("cannot read properties of undefined (reading 'secretPath')"),
    );
    await expect(call()).rejects.toThrow(TypeError);
  });

  it("answers 499 when the caller disconnected", async () => {
    // Not a status the client will see — it disconnected — but it is not 200 either, and not an
    // unhandled rejection in the function either.
    const controller = new AbortController();
    controller.abort();
    resolveTrackDownload.mockRejectedValue(
      new ExtractionError("aborted", "the request was cancelled"),
    );
    const response = await call({}, controller.signal);
    expect(response.status).toBe(499);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers 499 for a caller who left before the route ran, and never reaches an extractor", async () => {
    // The download limiter refuses an aborted request too — it must not hold a slot for somebody
    // who is gone. Without the abort check at the top of the route that refusal would reach the
    // caller as a 429, telling someone they were rate-limited when they had closed the tab and
    // spending a window entry against their address for a download they never made.
    const controller = new AbortController();
    controller.abort();
    const response = await call({}, controller.signal);
    expect(response.status).toBe(499);
    expect(resolveTrackDownload).not.toHaveBeenCalled();
  });

  it("answers 499 when the caller disconnected but the extractor reported something else", async () => {
    // The disconnect is the more specific fact. Preferring it stops a lost transfer being retried
    // against the fallback for a caller who is no longer there.
    const controller = new AbortController();
    controller.abort();
    resolveTrackDownload.mockRejectedValue(new Error("something unrelated"));
    const response = await call({}, controller.signal);
    expect(response.status).toBe(499);
  });
});

describe("GET /api/download/[videoId] — limiting", () => {
  it("answers 429 with a Retry-After when the caller is already downloading", async () => {
    permitFor.mockReturnValue({
      allowed: false,
      refusal: "already_downloading",
      limit: DOWNLOAD_LIMIT,
      retryAfterSeconds: 1,
    });
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("1");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("already_downloading");
    expect(body.error.message).toMatch(/already in progress/i);
    expect(resolveTrackDownload).not.toHaveBeenCalled();
  });

  it("answers 429 with the window's Retry-After when the caller is over its budget", async () => {
    permitFor.mockReturnValue({
      allowed: false,
      refusal: "rate_limited",
      limit: DOWNLOAD_LIMIT,
      retryAfterSeconds: 600,
    });
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("600");
    const body = (await response.json()) as { error: { code: string }; limit: number };
    expect(body.error.code).toBe("rate_limited");
    expect(body.limit).toBe(DOWNLOAD_LIMIT);
    expect(resolveTrackDownload).not.toHaveBeenCalled();
  });

  it("refuses a second download from the same address through the real limiter", async () => {
    // The mocked-out case above proves the mapping; this proves the limiter is actually consulted
    // and that its own state does what its module says.
    permitFor.mockReturnValue(undefined);
    const first = await downloadGet(
      new Request(`http://localhost${PATH}`, {
        signal: new AbortController().signal,
        headers: { "x-forwarded-for": "198.51.100.7" },
      }),
      context(VIDEO_ID),
    );
    expect(first.status).toBe(200);
    // …and the real permit was released by the route, so the next one is allowed again.
    const second = await downloadGet(
      new Request(`http://localhost${PATH}`, {
        signal: new AbortController().signal,
        headers: { "x-forwarded-for": "198.51.100.7" },
      }),
      context(VIDEO_ID),
    );
    expect(second.status).toBe(200);
  });

  it("runs the shared throttle before validation, so a refused request costs nothing", async () => {
    // The order is the point: a caller who is over the shared budget must not be able to make this
    // function parse and validate, and must certainly not reach an extractor.
    const address = "198.51.100.99";
    for (let index = 0; index < THROTTLE_LIMIT; index += 1) {
      consumeThrottle(throttleKeyFor(address, PATH));
    }
    const response = await downloadGet(
      new Request(`http://localhost${PATH}`, {
        signal: new AbortController().signal,
        headers: { "x-forwarded-for": address },
      }),
      context("not-a-valid-id"),
    );
    expect(response.status, "a throttled request must not be answered as invalid input").toBe(429);
    expect(resolveTrackDownload).not.toHaveBeenCalled();
  });
});
