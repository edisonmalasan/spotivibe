import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { downloadHeaders, resolveTrackDownload } from "@/server/download/service";
import { ExtractionError, type AudioSource, type ResolvedAudio } from "@/server/download/sources";
import { describeAudioFormat } from "@/server/download/container";
import { DOWNLOAD_BUDGET_BYTES } from "@/server/download/selectFormat";

/**
 * Assembly, the byte ceiling, and the headers (M20; spec `download` — "Media is streamed to the
 * response and never buffered in server memory", "A download is bounded, abortable, and fails in a
 * form the caller can act on"; design decisions 4, 5).
 *
 * The three claims worth testing here are all things that would be invisible in production until
 * somebody downloaded a long track:
 *
 * 1. **Nothing is buffered.** The stream the payload carries is the one the extractor handed over,
 *    wrapped rather than read.
 * 2. **The ceiling cancels rather than truncates.** A stream that runs past the ceiling must have its
 *    upstream cancelled, so the provider stops sending into a function that is no longer listening.
 *    Truncating and calling it a success is the worst outcome available.
 * 3. **`Content-Length` is never sent.** A wrong length makes a browser stop early and write a
 *    truncated file that reports itself complete.
 */

const never = new AbortController().signal;

function description(mimeType = 'audio/webm; codecs="opus"') {
  const mapping = describeAudioFormat({ mimeType });
  if (!mapping.known) throw new Error("the fixture container must be known");
  return mapping.format;
}

/** A stream that emits the given chunks and then closes. */
function streamOf(...chunks: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
}

/** A stream that never closes, so the ceiling is the only thing that can end it. */
function endlessStream(onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() {
      onCancel();
    },
  });
}

function source(overrides: Partial<ResolvedAudio> = {}): AudioSource {
  const resolved: ResolvedAudio = {
    source: "ytdl",
    description: description(),
    audioBitrate: 128_000,
    estimatedBytes: 2_000_000,
    estimateSource: "bitrate-duration",
    budgetExceeded: false,
    open: async () => streamOf(1000),
    ...overrides,
  };
  return {
    name: resolved.source === "invidious" ? "invidious" : "ytdl",
    resolve: async () => resolved,
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
  }
  return total;
}

describe("downloadHeaders", () => {
  it("names the file for what it contains, in both Content-Disposition forms", () => {
    const headers = downloadHeaders({
      resolved: { ...sourceResolved(), description: description('audio/webm; codecs="opus"') },
      title: "Bohemian Rhapsody",
    });
    expect(headers["Content-Type"]).toBe("audio/webm");
    const disposition = headers["Content-Disposition"] ?? "";
    expect(disposition).toContain('filename="Bohemian-Rhapsody.webm"');
    // The RFC 5987 form is what a non-ASCII title survives in. Without it a browser that prefers
    // the second form shows the percent-encoded name in the save dialog.
    expect(disposition).toContain("filename*=UTF-8''Bohemian-Rhapsody.webm");
  });

  it("never sends a Content-Length", () => {
    // The size is an estimate, and a wrong one is worse than none: a browser that trusts a short
    // length stops reading and writes a truncated file that reports itself complete.
    for (const estimatedBytes of [0, 1, 2_000_000, null]) {
      const headers = downloadHeaders({
        resolved: { ...sourceResolved(), estimatedBytes },
        title: "track",
      });
      const keys = Object.keys(headers).map((key) => key.toLowerCase());
      expect(keys, `estimatedBytes ${String(estimatedBytes)}`).not.toContain("content-length");
    }
  });

  it("is never cacheable", () => {
    // Per-track media at a URL a caller could re-request forever; a cached copy is a second copy of
    // the file nobody asked to keep.
    expect(downloadHeaders({ resolved: sourceResolved(), title: "t" })["Cache-Control"]).toBe(
      "no-store",
    );
  });

  it("states the two surprising outcomes in headers a human can read", () => {
    const headers = downloadHeaders({
      resolved: {
        ...sourceResolved(),
        budgetExceeded: true,
        estimatedBytes: 4_321,
        estimateSource: "content-length",
      },
      title: "t",
    });
    expect(headers["X-Spotivibe-Download-Source"]).toBe("ytdl");
    expect(headers["X-Spotivibe-Download-Container"]).toBe("webm");
    expect(headers["X-Spotivibe-Download-Codec"]).toBe("opus");
    expect(headers["X-Spotivibe-Download-Budget-Exceeded"]).toBe("true");
    expect(headers["X-Spotivibe-Download-Estimated-Bytes"]).toBe("4321");
    expect(headers["X-Spotivibe-Download-Estimate-Source"]).toBe("content-length");
  });

  it("omits the size headers rather than sending zero or null", () => {
    // `0` would read as "an empty file" and `null` as a bug; both are claims the route cannot make.
    const headers = downloadHeaders({
      resolved: { ...sourceResolved(), estimatedBytes: null, estimateSource: "none" },
      title: "t",
    });
    expect(headers).not.toHaveProperty("X-Spotivibe-Download-Estimated-Bytes");
    expect(headers).not.toHaveProperty("X-Spotivibe-Download-Estimate-Source");
  });

  it("cannot be made to inject a header through the title", () => {
    const headers = downloadHeaders({
      resolved: sourceResolved(),
      title: 'a"\r\nX-Injected: 1',
    });
    for (const value of Object.values(headers)) {
      expect(value, `header value ${value}`).not.toMatch(/[\r\n]/);
    }
  });
});

function sourceResolved(): ResolvedAudio {
  return {
    source: "ytdl",
    description: description(),
    audioBitrate: 128_000,
    estimatedBytes: 2_000_000,
    estimateSource: "bitrate-duration",
    budgetExceeded: false,
    open: async () => streamOf(1000),
  };
}

describe("resolveTrackDownload", () => {
  it("returns the extractor's stream without reading it", async () => {
    // The distinction the whole deployment design rests on: the body is handed to the response, not
    // materialised in the function's heap. A test that read the stream to check it would defeat the
    // thing it is checking.
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "track", never, {
      sources: [source()],
    });
    expect(payload.stream).toBeInstanceOf(ReadableStream);
    expect(payload.source).toBe("ytdl");
    expect(payload.headers["Content-Type"]).toBe("audio/webm");
    expect(await readAll(payload.stream)).toBe(1000);
  });

  it("passes the bytes through unchanged when they fit", async () => {
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "t", never, {
      sources: [source({ open: async () => streamOf(10, 20, 30) })],
    });
    expect(await readAll(payload.stream)).toBe(60);
  });

  it("cancels the upstream when the client goes away", async () => {
    // Propagating the cancel is what makes "abort on client disconnect" true for the body phase, the
    // way `request.signal` is for the resolve phase.
    let cancelled = false;
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "t", never, {
      sources: [source({ open: async () => endlessStream(() => (cancelled = true)) })],
    });
    await payload.stream.cancel("client left");
    expect(cancelled, "an abandoned download must stop the upstream, not keep it sending").toBe(
      true,
    );
  });

  it("cancels the upstream and errors the body when the byte ceiling is passed", async () => {
    // The requirement is a *ceiling*, not a truncation. Erroring the client while letting the
    // provider keep sending into a function nobody is listening to is the failure mode this avoids.
    let cancelled = false;
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "t", never, {
      sources: [source({ open: async () => endlessStream(() => (cancelled = true)) })],
      budgetBytes: 4096,
    });
    await expect(readAll(payload.stream)).rejects.toThrow(/ceiling/);
    expect(cancelled, "the ceiling must cancel upstream").toBe(true);
  });

  it("uses the same number for selection and the ceiling", async () => {
    // Two numbers would be two chances to disagree: a selection that promised 8 MB and a ceiling that
    // allowed 20 MB would let a lying upstream stream 20.
    let seen = 0;
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "t", never, {
      sources: [source({ open: async () => streamOf(seen++ === 0 ? 1 : DOWNLOAD_BUDGET_BYTES) })],
    });
    expect(payload.headers["X-Spotivibe-Download-Estimate-Source"]).toBe("bitrate-duration");
    // The default ceiling is the exported one, so a caller reading the header and the code agree.
    expect(payload.headers["X-Spotivibe-Download-Estimated-Bytes"]).toBe("2000000");
  });

  it("tries the next extractor when one fails, and reports the last failure", async () => {
    // The *final* reason is the useful one: the first extractor failing and the fallback failing are
    // different diagnoses.
    const failing: AudioSource = {
      name: "ytdl",
      resolve: async () => {
        throw new ExtractionError("unavailable", "primary is down", { source: "ytdl" });
      },
    };
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "t", never, {
      sources: [failing, source({ source: "invidious" })],
    });
    expect(payload.source).toBe("invidious");

    const alsoFailing: AudioSource = {
      name: "invidious",
      resolve: async () => {
        throw new ExtractionError("no_suitable_format", "nothing to name honestly", {
          source: "invidious",
        });
      },
    };
    await expect(
      resolveTrackDownload("dQw4w9WgXcQ", "t", never, { sources: [failing, alsoFailing] }),
    ).rejects.toMatchObject({ code: "no_suitable_format" });
  });

  it("moves on when an extractor resolves but cannot open the stream", async () => {
    // Better a second extractor than a 200 whose body errors halfway down.
    const cannotOpen: AudioSource = {
      name: "ytdl",
      resolve: async () => ({
        ...sourceResolved(),
        async open() {
          throw new ExtractionError("unavailable", "the stream refused to open", {
            source: "ytdl",
          });
        },
      }),
    };
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "t", never, {
      sources: [cannotOpen, source({ source: "invidious" })],
    });
    expect(payload.source).toBe("invidious");
    expect(await readAll(payload.stream)).toBe(1000);
  });

  it("stops the chain when the caller has already gone", async () => {
    // A disconnect is not an upstream failure and must not be retried against the fallback.
    const controller = new AbortController();
    controller.abort();
    let secondCalled = false;
    const second: AudioSource = {
      name: "invidious",
      resolve: async () => {
        secondCalled = true;
        return sourceResolved();
      },
    };
    await expect(
      resolveTrackDownload("dQw4w9WgXcQ", "t", controller.signal, {
        sources: [
          {
            name: "ytdl",
            resolve: async () => {
              throw new ExtractionError("unavailable", "primary is down");
            },
          },
          second,
        ],
      }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(secondCalled).toBe(false);
  });

  it("reports a caller who disconnected mid-resolution as an abort", async () => {
    const controller = new AbortController();
    const source2: AudioSource = {
      name: "ytdl",
      resolve: async () => {
        controller.abort();
        throw new ExtractionError("unavailable", "upstream said no");
      },
    };
    await expect(
      resolveTrackDownload("dQw4w9WgXcQ", "t", controller.signal, { sources: [source2] }),
    ).rejects.toMatchObject({ code: "aborted" });
  });

  it("reports an unknown failure as an extraction failure rather than leaking it", async () => {
    const exploding: AudioSource = {
      name: "ytdl",
      resolve: async () => {
        throw new TypeError("cannot read properties of undefined");
      },
    };
    await expect(
      resolveTrackDownload("dQw4w9WgXcQ", "t", never, { sources: [exploding] }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses rather than delivering when no extractor is configured", async () => {
    await expect(
      resolveTrackDownload("dQw4w9WgXcQ", "t", never, { sources: [] }),
    ).rejects.toBeInstanceOf(ExtractionError);
  });

  it("does not buffer: a stream larger than the ceiling is cut, not accumulated", async () => {
    // The measurable form of the memory claim. `endlessStream` would produce gigabytes; the ceiling
    // stops it after the first chunk that crosses the line.
    let cancelled = false;
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "t", never, {
      sources: [source({ open: async () => endlessStream(() => (cancelled = true)) })],
      budgetBytes: 1500,
    });
    await expect(readAll(payload.stream)).rejects.toThrow();
    expect(cancelled).toBe(true);
  });

  it("wraps a Node Readable the same way, so the ytdl path is covered too", async () => {
    const payload = await resolveTrackDownload("dQw4w9WgXcQ", "t", never, {
      sources: [
        source({
          open: async () =>
            Readable.toWeb(Readable.from([Buffer.alloc(7)])) as ReadableStream<Uint8Array>,
        }),
      ],
    });
    expect(await readAll(payload.stream)).toBe(7);
  });
});
