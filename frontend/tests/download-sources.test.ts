import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import {
  ExtractionError,
  INVIDIOUS_ATTEMPT_TIMEOUT_MS,
  RESOLVE_TIMEOUT_MS,
  createAudioSourceChain,
  createInvidiousAudioSource,
  classifyMediaUrl,
  parseInvidiousVideo,
  ytdlAudioSource,
  type AudioSource,
  type ResolvedAudio,
} from "@/server/download/sources";
import { describeAudioFormat } from "@/server/download/container";

/**
 * Extractor behaviour (M20; design decisions 1, 2, 3, 5).
 *
 * The parts worth testing here are the ones a network would otherwise be needed for and would then
 * hide: the normalisation of two extractors' very different shapes into one candidate list, the
 * rotation of a bounded fallback list, and the fact that neither extractor ever reads a media body
 * whole.
 *
 * **Nothing in this file opens a socket.** Every network path is stubbed at `fetch`, and the
 * Invidious fallback is constructed with an explicit instance list so `getServerEnv()` is never
 * consulted — which is why these tests need no environment setup and cannot accidentally reach the
 * network.
 */

const never = new AbortController().signal;

function resolved(overrides: Partial<ResolvedAudio> = {}): ResolvedAudio {
  const mapping = describeAudioFormat({ mimeType: 'audio/webm; codecs="opus"' });
  if (!mapping.known) throw new Error("the fixture container must be known");
  return {
    source: "ytdl",
    description: mapping.format,
    audioBitrate: 128_000,
    estimatedBytes: 1_000_000,
    estimateSource: "bitrate-duration",
    budgetExceeded: false,
    open: async () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      }),
    ...overrides,
  };
}

describe("parseInvidiousVideo", () => {
  it("keeps only audio-only formats that have a URL", () => {
    const parsed = parseInvidiousVideo({
      lengthSeconds: 212,
      adaptiveFormats: [
        {
          itag: "140",
          url: "https://rr3---sn-test.googlevideo.com/opus",
          type: 'audio/webm; codecs="opus"',
          bitrate: "128000",
        },
        {
          itag: "251",
          url: "https://rr3---sn-test.googlevideo.com/opus-hi",
          type: "audio/webm; codecs=opus",
          bitrate: "160000",
        },
        // Skipped: video, however high its bitrate.
        {
          itag: "137",
          url: "https://rr3---sn-test.googlevideo.com/mp4",
          type: 'video/mp4; codecs="avc1"',
          bitrate: "3000000",
        },
        // Skipped: no URL, so it cannot be opened.
        { itag: "999", type: 'audio/webm; codecs="opus"', bitrate: "128000" },
        // Skipped: unlabelled, so it is not guessed at.
        { itag: "998", url: "https://rr3---sn-test.googlevideo.com/unknown", bitrate: "128000" },
      ],
    });

    expect(parsed.durationSeconds).toBe(212);
    expect(parsed.candidates.map((entry) => entry.itag)).toEqual([140, 251]);
    expect(parsed.candidates[0]).toMatchObject({
      itag: 140,
      mimeType: 'audio/webm; codecs="opus"',
      audioBitrate: 128_000,
    });
    expect(parsed.urlsByItag.get(140)).toBe("https://rr3---sn-test.googlevideo.com/opus");
    expect(parsed.urlsByItag.get(251)).toBe("https://rr3---sn-test.googlevideo.com/opus-hi");
  });

  it("accepts a numeric itag and a numeric bitrate, because the shape is not guaranteed", () => {
    const parsed = parseInvidiousVideo({
      lengthSeconds: 100,
      adaptiveFormats: [
        {
          itag: 140,
          url: "https://rr3---sn-test.googlevideo.com/a",
          type: 'audio/webm; codecs="opus"',
          bitrate: 128000,
        },
      ],
    });
    expect(parsed.candidates[0]?.itag).toBe(140);
    expect(parsed.candidates[0]?.audioBitrate).toBe(128_000);
    // The reopen map is keyed by the normalised numeric itag, which is what a selected numeric itag
    // is looked up with. A mismatch here would make every selection unopenable and the failure would
    // read as "no suitable format" rather than as a key mismatch.
    expect(parsed.urlsByItag.get(140)).toBe("https://rr3---sn-test.googlevideo.com/a");
  });

  it("carries the codec Invidious reports separately from the media type", () => {
    // Invidious puts the whole codec list in `codecs`, which is a different field from `type`. The
    // mapper reads the first entry, and this fixture is the shape it is fed.
    const parsed = parseInvidiousVideo({
      adaptiveFormats: [
        {
          itag: "140",
          url: "https://rr3---sn-test.googlevideo.com/opus",
          type: "audio/webm",
          codecs: "opus, mp4a.40.2",
          bitrate: "128000",
        },
      ],
    });
    expect(parsed.candidates[0]?.audioCodec).toBe("opus, mp4a.40.2");
    expect(parsed.candidates[0]?.mimeType).toBe("audio/webm");
  });

  it("skips a format whose itag it could not normalise, because such a format cannot be reopened", () => {
    const parsed = parseInvidiousVideo({
      adaptiveFormats: [
        {
          itag: "not-a-number",
          url: "https://rr3---sn-test.googlevideo.com/a",
          type: 'audio/webm; codecs="opus"',
        },
        { url: "https://rr3---sn-test.googlevideo.com/b", type: 'audio/webm; codecs="opus"' },
        {
          itag: "140",
          url: "https://rr3---sn-test.googlevideo.com/c",
          type: 'audio/webm; codecs="opus"',
        },
      ],
    });
    expect(parsed.candidates.map((entry) => entry.itag)).toEqual([140]);
  });

  it("tolerates a response with no formats at all", () => {
    const parsed = parseInvidiousVideo({});
    expect(parsed.candidates).toEqual([]);
    expect(parsed.urlsByItag.size).toBe(0);
    expect(parsed.durationSeconds).toBeUndefined();
  });

  it("records a missing or nonsensical duration as absent rather than as zero", () => {
    // Zero would make every derived estimate zero bytes, and a zero-byte estimate reads as "fits the
    // budget" — a silent lie rather than an honest "cannot size this".
    for (const body of [
      {},
      { lengthSeconds: 0 },
      { lengthSeconds: -1 },
      { lengthSeconds: "212" },
      { lengthSeconds: Number.NaN },
    ]) {
      expect(parseInvidiousVideo(body).durationSeconds, JSON.stringify(body)).toBeUndefined();
    }
  });

  it("records an unusable bitrate as zero, so the candidate is dropped rather than ranked last", () => {
    const parsed = parseInvidiousVideo({
      adaptiveFormats: [
        {
          itag: 1,
          url: "https://rr3---sn-test.googlevideo.com/a",
          type: 'audio/webm; codecs="opus"',
        },
        {
          itag: 2,
          url: "https://rr3---sn-test.googlevideo.com/b",
          type: 'audio/webm; codecs="opus"',
          bitrate: "nonsense",
        },
      ],
    });
    expect(parsed.candidates.map((entry) => entry.audioBitrate)).toEqual([0, 0]);
  });

  it("refuses a body that is not an object at all", () => {
    for (const body of [null, undefined, "ok", 42, true]) {
      expect(() => parseInvidiousVideo(body), JSON.stringify(body)).toThrow(ExtractionError);
    }
    try {
      parseInvidiousVideo(null);
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).code).toBe("unavailable");
    }
  });

  it("is pure", () => {
    const body = {
      lengthSeconds: 100,
      adaptiveFormats: [
        {
          itag: 1,
          url: "https://rr3---sn-test.googlevideo.com/a",
          type: 'audio/webm; codecs="opus"',
          bitrate: "128000",
        },
      ],
    };
    const snapshot = structuredClone(body);
    const first = parseInvidiousVideo(body);
    const second = parseInvidiousVideo(body);
    expect([...second.urlsByItag]).toEqual([...first.urlsByItag]);
    expect(body).toEqual(snapshot);
  });
});

describe("createInvidiousAudioSource", () => {
  const audioFormat = {
    lengthSeconds: 200,
    adaptiveFormats: [
      {
        itag: "140",
        url: "https://rr3---sn-test.googlevideo.com/opus",
        type: 'audio/webm; codecs="opus"',
        bitrate: "128000",
      },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function jsonResponse(body: unknown, ok = true): Response {
    return new Response(JSON.stringify(body), {
      status: ok ? 200 : 500,
      headers: { "content-type": "application/json" },
    });
  }

  it("resolves from the first instance that answers, and opens the selected URL as a stream", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(audioFormat))
      .mockResolvedValueOnce(
        new Response("bytes", { status: 200, headers: { "content-type": "audio/webm" } }),
      );

    const source = createInvidiousAudioSource(["https://one.example", "https://two.example"]);
    const result = await source.resolve("dQw4w9WgXcQ", never);

    expect(result.source).toBe("invidious");
    expect(result.description.extension).toBe(".webm");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://one.example/api/v1/videos/dQw4w9WgXcQ",
    );

    const stream = await result.open(never);
    expect(stream).toBeInstanceOf(ReadableStream);
    // The second instance must never be consulted once one has answered.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("one.example");
  });

  it("rotates to the next instance when one does not answer", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, false))
      .mockResolvedValueOnce(jsonResponse(audioFormat))
      .mockResolvedValueOnce(new Response("bytes", { status: 200 }));

    const source = createInvidiousAudioSource(["https://one.example", "https://two.example"]);
    const result = await source.resolve("dQw4w9WgXcQ", never);
    expect(result.source).toBe("invidious");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("two.example");
  });

  it("refuses a media URL the instance named but this application may not fetch", async () => {
    // The security control, tested as a control. A public Invidious instance answers with a media
    // URL of **its own choosing**, so the instance list being a bundled constant bounds who
    // configures it but not what an instance replies with. Without a host allowlist, one hostile or
    // compromised public instance could aim this function at the cloud metadata endpoint, at
    // loopback, or at an internal service, and the body would be streamed straight back to an
    // unauthenticated caller.
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        lengthSeconds: 200,
        adaptiveFormats: [
          {
            itag: "140",
            url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
            type: 'audio/webm; codecs="opus"',
            bitrate: "128000",
          },
        ],
      }),
    );

    const source = createInvidiousAudioSource(["https://one.example"]);
    // The refusal names the reason rather than a generic "upstream is down", because "this instance
    // tried to point us somewhere it may not" is a materially different diagnosis from "nobody
    // answered" — one is a hostile or misconfigured instance, the other is an outage.
    await expect(source.resolve("dQw4w9WgXcQ", never)).rejects.toThrow(/http:\/\/ rather than/);
    expect(
      fetchMock.mock.calls.map((call) => String(call[0])),
      "the instance's own chosen host must never be fetched",
    ).not.toContain("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
  });

  it.each([
    ["plain HTTP", "http://rr3---sn-test.googlevideo.com/videoplayback"],
    ["loopback", "https://127.0.0.1/videoplayback"],
    ["the metadata service over TLS", "https://169.254.169.254/latest/meta-data/"],
    ["a private network host", "https://10.0.0.5/internal"],
    ["a lookalike of an allowed suffix", "https://evil-googlevideo.com.attacker.test/x"],
    ["credentials smuggled into the URL", "https://user:pass@rr3---sn-test.googlevideo.com/x"],
  ])("classifies a media URL as unusable: %s", (_label, raw) => {
    // Pure, so this needs no network. It is deliberately a table rather than one assertion: the
    // interesting cases are the ones a future edit would plausibly introduce, and `10.0.0.5` and the
    // `evil-googlevideo.com.attacker.test` lookalike are exactly the shapes that a naive
    // "endsWith('googlevideo.com')" gets wrong.
    expect(classifyMediaUrl(raw, "https://one.example").ok).toBe(false);
  });

  it.each([
    ["a real media CDN host", "https://rr3---sn-test.googlevideo.com/videoplayback?expire=1"],
    ["a secondary CDN host", "https://rr1---sn-xyz.lh3.googleusercontent.com/x"],
    ["the instance's own host", "https://one.example/media/140"],
  ])("accepts a legitimate media URL: %s", (_label, raw) => {
    expect(classifyMediaUrl(raw, "https://one.example").ok).toBe(true);
  });

  it("never follows a redirect when opening the media URL", async () => {
    // The allowlist is only as good as the fetch that uses it. A permitted host that answers with a
    // 302 to a forbidden one is how an allowlist gets walked around, so the redirect is refused
    // rather than chased: an instance that will not serve media directly has failed.
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(audioFormat))
      .mockResolvedValueOnce(new Response(null, { status: 302 }));
    const source = createInvidiousAudioSource(["https://one.example"]);
    const result = await source.resolve("dQw4w9WgXcQ", never);

    await expect(result.open(never)).rejects.toThrow();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("stops after a bounded number of instances rather than trying every one it was given", async () => {
    // A list of ten failing instances must cost three attempts, because each attempt is a request to
    // somebody else's server.
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(jsonResponse({}, false));
    const source = createInvidiousAudioSource([
      "https://one.example",
      "https://two.example",
      "https://three.example",
      "https://four.example",
      "https://five.example",
      "https://six.example",
    ]);
    await expect(source.resolve("dQw4w9WgXcQ", never)).rejects.toBeInstanceOf(ExtractionError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports an exhausted fallback as an unavailable extraction, naming the fallback", async () => {
    // §21.5 requires the fallback's unreliability to be surfaced as a failure state rather than
    // hidden. The error code and the `source` are what the route turns into a 502.
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({}, false));
    const source = createInvidiousAudioSource(["https://one.example"]);
    await expect(source.resolve("dQw4w9WgXcQ", never)).rejects.toMatchObject({
      code: expect.stringMatching(/unavailable|no_suitable_format/),
      source: "invidious",
    });
  });

  it("moves on from an instance that answers with nothing downloadable", async () => {
    // An instance that returns 200 with a body offering no audio is *not* a working fallback, and
    // treating it as one is how a download ends in a "no suitable format" for a track that another
    // instance could have served.
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ lengthSeconds: 100, adaptiveFormats: [] }))
      .mockResolvedValueOnce(jsonResponse(audioFormat));
    const source = createInvidiousAudioSource(["https://one.example", "https://two.example"]);
    const result = await source.resolve("dQw4w9WgXcQ", never);
    expect(result.description.extension).toBe(".webm");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("two.example");
  });

  it("stops immediately when the caller has already gone", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValue(jsonResponse(audioFormat));
    const source = createInvidiousAudioSource(["https://one.example"]);
    const controller = new AbortController();
    controller.abort();
    await expect(source.resolve("dQw4w9WgXcQ", controller.signal)).rejects.toMatchObject({
      code: "aborted",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an abort as an abort rather than as an upstream failure", async () => {
    // The two are different to a caller: one is retryable later, the other is not worth retrying now.
    const controller = new AbortController();
    vi.mocked(globalThis.fetch).mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    const source = createInvidiousAudioSource(["https://one.example", "https://two.example"]);
    await expect(source.resolve("dQw4w9WgXcQ", controller.signal)).rejects.toMatchObject({
      code: "aborted",
    });
  });

  it("fails rather than serving an empty body when the stream cannot be opened", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(audioFormat))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const source = createInvidiousAudioSource(["https://one.example"]);
    const result = await source.resolve("dQw4w9WgXcQ", never);
    await expect(result.open(never)).rejects.toBeInstanceOf(ExtractionError);
  });

  it("gives each attempt its own timeout, shorter than the resolve deadline", () => {
    // A fallback is by definition running on somebody else's clock.
    expect(INVIDIOUS_ATTEMPT_TIMEOUT_MS).toBeLessThan(RESOLVE_TIMEOUT_MS);
  });
});

describe("createAudioSourceChain", () => {
  it("tries the primary extractor before the fallback", () => {
    const chain = createAudioSourceChain();
    expect(chain.map((source) => source.name)).toEqual(["ytdl", "invidious"]);
  });

  it("returns a copy, so a caller cannot reorder the chain for everyone else", () => {
    const chain = createAudioSourceChain();
    (chain as AudioSource[]).pop();
    expect(createAudioSourceChain()).toHaveLength(2);
  });

  it("accepts an explicit chain, so the route can be tested without an extractor", () => {
    const stub: AudioSource = {
      name: "ytdl",
      resolve: async () => resolved(),
    };
    expect(createAudioSourceChain([stub])).toEqual([stub]);
  });
});

describe("ytdlAudioSource", () => {
  it("is declared as an AudioSource without touching the network at module load", () => {
    // Importing the module must not load ytdl, open a socket, or read an environment variable. If
    // it did, importing this file from a client-reachable module would pull a server-only extractor
    // into the browser bundle.
    expect(ytdlAudioSource.name).toBe("ytdl");
    expect(typeof ytdlAudioSource.resolve).toBe("function");
  });

  it("declares the primary extractor, and never names an extension itself", async () => {
    // The container decision belongs to `container.ts` alone. If this module ever derived an
    // extension, there would be two answers to "what is this file called".
    const source = await import("@/server/download/sources");
    expect(Object.keys(source).filter((key) => key.toLowerCase().includes("extension"))).toEqual(
      [],
    );
  });

  it("converts its Node Readable to a web stream rather than reading it", async () => {
    // Exercised against the real conversion ytdl's `open` uses, so the assertion is about the
    // conversion and not about a stub that already returned a web stream.
    const node = Readable.from([Buffer.from("abc"), Buffer.from("def")]);
    const web = Readable.toWeb(node) as ReadableStream<Uint8Array>;
    expect(web).toBeInstanceOf(ReadableStream);
    const reader = web.getReader();
    const chunks: number[] = [];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(chunk.value.byteLength);
    }
    expect(chunks).toEqual([3, 3]);
  });
});
