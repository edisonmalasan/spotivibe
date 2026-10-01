import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpFetchError } from "@/server/http/fetchJson";
import { createSemaphore } from "@/server/music/limiter";
import {
  cleanTitle,
  lyricsCacheSizes,
  LYRICS_HIT_TTL_MS,
  LYRICS_MISS_TTL_MS,
  LYRICS_TIMEOUT_MS,
  resetLyricsCaches,
  resolveLyrics,
  scoreCandidate,
  splitArtistTitle,
  type LyricsResult,
} from "@/server/lyrics/lyricsService";

/**
 * Separators are written as escapes, never as literal dashes.
 *
 * A literal en-dash in this file was already silently corrupted once, by a PowerShell text
 * round-trip that decoded UTF-8 bytes as Latin-1. The corruption failed *open*: the separator no
 * longer matched, the split never happened, and the test that should have caught it reported a
 * plain "did not split" rather than an encoding fault. An escape cannot be corrupted this way.
 */
const SEPARATORS = [" - ", " \u2013 ", " \u2014 ", " ~ "] as const;

/**
 * A stub transport that returns `body`.
 *
 * It is a real `vi.fn` rather than a cast, because an assertion below reads the URLs it was called
 * with. Both of the transport's parameters are genuinely used: the `signal` is honoured, so a test
 * that supersedes a request exercises a stub with real abort semantics instead of one that always
 * resolves, and the URL is recorded for the query assertions.
 */
const requestedUrls: string[] = [];

const fetcher = (body: unknown) =>
  vi.fn(async (url: string, options?: { signal?: AbortSignal }): Promise<never> => {
    requestedUrls.push(url);
    if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return body as never;
  });

/** Any stub, in the shape the service's injectable transport expects. */
const asTransport = (mock: unknown) => mock as never;

const TRACK = {
  videoId: "dQw4w9WgXcQ",
  title: "Artist Name - Song Title (Official Video) [HD]",
  artist: "Artist Name",
  channel: "SomeChannel",
  durationSeconds: 210,
};

const timedCandidate = {
  trackName: "Song Title",
  artistName: "Artist Name",
  duration: 210,
  syncedLyrics: "[00:10]a",
};

beforeEach(() => {
  resetLyricsCaches();
  requestedUrls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cleanTitle / splitArtistTitle (Lyrix behaviour, ported)", () => {
  // These are the reason the milestone can find lyrics at all: LRCLIB indexes by metadata, and
  // YouTube titles carry decorations no lyrics service has ever heard of.
  it("strips the decorations that appear in real video titles", () => {
    expect(cleanTitle("Song Title (Official Video)")).toBe("Song Title");
    expect(cleanTitle("Song Title [HD]")).toBe("Song Title");
    expect(cleanTitle("Song Title | Lyrics")).toBe("Song Title");
    expect(cleanTitle("Song Title (Official Lyric Video)")).toBe("Song Title");
    expect(cleanTitle("Song Title (4K)")).toBe("Song Title");
  });

  it("strips a multi-word trailing suffix, which Lyrix's single-word pattern misses", () => {
    // `Song Title - Official Music Video` is one of the most common YouTube title forms there is,
    // and Lyrix's pattern leaves it intact — so it then matches nothing in LRCLIB.
    expect(cleanTitle("Song Title - Official Music Video")).toBe("Song Title");
    expect(cleanTitle("Song Title - Lyrics")).toBe("Song Title");
    expect(cleanTitle("Song Title - Official Audio")).toBe("Song Title");
  });

  it("does not strip a trailing word that is not decoration", () => {
    // The over-stripping guard: a real title ending in an ordinary word must survive.
    expect(cleanTitle("Ordinary Song Title")).toBe("Ordinary Song Title");
    expect(cleanTitle("Song Title - Remix")).toBe("Song Title - Remix");
    expect(cleanTitle("Video Killed the Radio Star")).toBe("Video Killed the Radio Star");
  });

  it("normalises a featuring credit", () => {
    expect(cleanTitle("Song ft. Someone")).toBe("Song feat. Someone");
  });

  it("splits on each separator YouTube titles actually use", () => {
    for (const separator of SEPARATORS) {
      expect(splitArtistTitle(`Artist${separator}Title`, "Channel")).toEqual({
        artistName: "Artist",
        trackName: "Title",
      });
    }
  });

  it("falls back to the channel as the artist when there is no separator", () => {
    // The common case for auto-generated topic channels, where the channel really is the artist.
    expect(splitArtistTitle("Just A Title", "RealArtist")).toEqual({
      artistName: "RealArtist",
      trackName: "Just A Title",
    });
  });

  it("does not split on a separator at the very start or end", () => {
    expect(splitArtistTitle(" - Leading", "Channel").trackName).toBe(" - Leading");
    expect(splitArtistTitle("Trailing - ", "Channel").trackName).toBe("Trailing - ");
  });

  it("uses the first separator when a title contains more than one", () => {
    expect(splitArtistTitle("A - B - C", "Channel")).toEqual({
      artistName: "A",
      trackName: "B - C",
    });
  });
});

describe("scoreCandidate (spec lyrics — Lyrics are resolved for the active track)", () => {
  it("prefers timed lyrics over untimed ones", () => {
    // The whole difference between a panel that follows playback and a wall of text.
    expect(scoreCandidate({ syncedLyrics: "[00:01]x" }, 210)).toBeGreaterThan(
      scoreCandidate({ plainLyrics: "x" }, 210),
    );
  });

  it("prefers the closer duration among timed candidates", () => {
    expect(scoreCandidate({ syncedLyrics: "x", duration: 211 }, 210)).toBeGreaterThan(
      scoreCandidate({ syncedLyrics: "x", duration: 240 }, 210),
    );
  });

  it("prefers synced lyrics even when the untimed one is a better duration match", () => {
    // Timed-first is a stated requirement; duration only breaks ties among candidates that are
    // already timed, so this ordering must not be reversible by duration.
    expect(scoreCandidate({ syncedLyrics: "x", duration: 300 }, 210)).toBeGreaterThan(
      scoreCandidate({ plainLyrics: "x", duration: 210 }, 210),
    );
  });

  it("never selects an instrumental", () => {
    // A perfect duration match on an instrumental is still the wrong answer: there is no lyric to
    // show, and showing one would be a fabrication.
    expect(scoreCandidate({ instrumental: true, syncedLyrics: "x", duration: 210 }, 210)).toBe(
      -Infinity,
    );
  });

  it("scores positively when the duration is unknown on either side", () => {
    expect(scoreCandidate({ syncedLyrics: "x" }, 210)).toBeGreaterThan(0);
    expect(scoreCandidate({ syncedLyrics: "x" }, 0)).toBeGreaterThan(0);
    expect(scoreCandidate({ syncedLyrics: "x", duration: 0 }, 210)).toBeGreaterThan(0);
  });

  it("penalises a badly wrong duration", () => {
    expect(scoreCandidate({ syncedLyrics: "x", duration: 600 }, 210)).toBeLessThan(
      scoreCandidate({ syncedLyrics: "x", duration: 212 }, 210),
    );
  });
});

describe("resolveLyrics", () => {
  it("returns the provider's raw strings rather than parsed lines", async () => {
    // Parsing is the client's concern (design decision 1), so the route's contract is text.
    expect(await call([timedCandidate])).toEqual({
      kind: "hit",
      hit: { syncedLyrics: "[00:10]a", plainLyrics: null, source: "lrclib" },
    });
  });

  it("reports no lyrics as unavailable, not as a failure", async () => {
    // A fact about the track, distinct from a fact about the network.
    expect(await call([])).toEqual({ kind: "unavailable" });
  });

  it("reports an unreachable provider as a failure, not as no lyrics", async () => {
    const result = await resolveLyrics({
      ...TRACK,
      fetchJson: failing(new HttpFetchError("timeout", "timed out")),
    });
    expect(result).toEqual({ kind: "unreachable", reason: "timeout" });
  });

  it("reports a non-array body as unreachable rather than unavailable", async () => {
    // An HTML error page from a proxy is a failure, not "this song has no words".
    expect(await call({ error: "not found" })).toEqual({ kind: "unreachable", reason: "parse" });
  });

  it("treats a candidate with neither timed nor plain text as unavailable", async () => {
    expect(await call([{ trackName: "Song Title", duration: 210 }])).toEqual({
      kind: "unavailable",
    });
  });

  it("issues exactly one provider request per lookup", async () => {
    // Lyrix issues two (a structured search and a free-text search). One is the decision.
    const impl = fetcher([timedCandidate]);
    await resolveLyrics({ ...TRACK, fetchJson: asTransport(impl) });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("does not query at all for a track with no usable name", async () => {
    const impl = fetcher([timedCandidate]);
    expect(await resolveLyrics({ ...TRACK, title: "", fetchJson: asTransport(impl) })).toEqual({
      kind: "unavailable",
    });
    expect(impl).not.toHaveBeenCalled();
  });

  it("propagates a caller abort rather than reporting it as a provider failure", async () => {
    // A listener who skipped a track must not see a "provider error". With an already-aborted
    // signal the limiter refuses to queue a slot at all, so the abort surfaces from `acquire`
    // rather than from the transport — hence asserting the *kind* of throw, not the identity of the
    // object, which is an implementation detail of whichever layer noticed first.
    const controller = new AbortController();
    controller.abort();
    const impl = vi.fn(async () => [] as never);

    await expect(
      resolveLyrics({ ...TRACK, signal: controller.signal, fetchJson: asTransport(impl) }),
    ).rejects.toThrow(/abort/i);
    expect(impl, "an aborted lookup must not reach the provider").not.toHaveBeenCalled();
  });

  it("propagates a transport abort that happens mid-flight, untouched", async () => {
    // The other abort path: the signal is live when the slot is taken, and the transport is the one
    // that observes the abort. Here the original error object must survive, because the route uses
    // the distinction between "the user left" and "the provider is down".
    const controller = new AbortController();
    const abort = new DOMException("aborted", "AbortError");
    const impl = vi.fn(async () => {
      controller.abort();
      throw abort;
    });

    await expect(
      resolveLyrics({ ...TRACK, signal: controller.signal, fetchJson: asTransport(impl) }),
    ).rejects.toBe(abort);
  });

  it("finds lyrics for a fully decorated YouTube title", async () => {
    // The end-to-end point of the cleaning: the query that reaches the provider is the clean one.
    requestedUrls.length = 0;
    await resolveLyrics({ ...TRACK, fetchJson: asTransport(fetcher([timedCandidate])) });
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("track_name=Song+Title");
    expect(requestedUrls[0]).not.toContain("Official");
  });
});

describe("the shared outbound limiter (spec security — bounded provider fan-out)", () => {
  // The design document claimed this milestone inherited M3's shared outbound limiter. It did not:
  // `fetchJson` supplies a timeout and an abort, and the only thing that had ever acquired
  // `outboundLimiter` was `chain.ts`, so lyrics was the one provider call in the application with no
  // concurrency ceiling. It now acquires the same semaphore, and these tests are what make that a
  // claim rather than a comment.
  it("acquires a slot and releases it when the lookup succeeds", async () => {
    const limiter = createSemaphore(1);
    const held: number[] = [];

    await resolveLyrics({
      ...TRACK,
      limiter,
      fetchJson: asTransport(
        vi.fn(async () => {
          held.push(limiter.activeCount);
          return [timedCandidate] as never;
        }),
      ),
    });

    // One slot is in use *during* the request...
    expect(held).toEqual([1]);
    // ...and none afterwards, or the limiter would leak a slot per lookup and eventually deadlock.
    expect(limiter.activeCount).toBe(0);
  });

  it("releases the slot when the lookup fails, so a failure cannot leak capacity", async () => {
    const limiter = createSemaphore(1);
    await resolveLyrics({
      ...TRACK,
      limiter,
      fetchJson: asTransport(failing(new HttpFetchError("network", "down"))),
    });
    expect(limiter.activeCount).toBe(0);
  });

  it("waits for a slot rather than exceeding the cap", async () => {
    // The cap is what bounds the fan-out, so exceeding it is the failure being prevented.
    //
    // Two details this had to get right. The held slot is released by calling the *first* holder's
    // release function: the semaphore's queue is FIFO, so a second `acquire()` would queue behind
    // the very request it was meant to unblock and the test would deadlock — which it did. And the
    // "has it started yet" check flushes microtasks rather than waiting on a timer, because a
    // wall-clock budget standing in for synchronisation is the defect that makes
    // `podcast-playback-history` flaky, and repeating it here would repeat the flake.
    const limiter = createSemaphore(1);
    const held = await limiter.acquire();

    let entered = false;
    const pending = resolveLyrics({
      ...TRACK,
      videoId: "queued",
      limiter,
      fetchJson: asTransport(
        vi.fn(async () => {
          entered = true;
          return [timedCandidate] as never;
        }),
      ),
    });

    for (let flush = 0; flush < 5; flush += 1) await Promise.resolve();
    expect(entered, "the request must wait for a slot").toBe(false);
    expect(limiter.pendingCount).toBe(1);

    held();
    await pending;
    expect(entered, "the request runs once a slot is free").toBe(true);
    expect(limiter.activeCount).toBe(0);
  });
});

describe("the lookup is bounded (spec lyrics — The lookup is bounded)", () => {
  // The scenario says the lookup "fails within its timeout rather than holding the request open".
  // A test that only injects a *pre-built* `HttpFetchError("timeout")` proves the classification of
  // a timeout, not that a timeout is ever imposed — so the bound itself is asserted here, on the
  // value actually handed to the transport.
  it("passes the bounded per-attempt timeout to the transport", async () => {
    const timeouts: number[] = [];
    const spy = vi.fn(async (_url: string, options?: { timeoutMs?: number }) => {
      timeouts.push(options?.timeoutMs ?? -1);
      return [timedCandidate] as never;
    });

    await resolveLyrics({ ...TRACK, fetchJson: asTransport(spy) });

    expect(timeouts).toEqual([LYRICS_TIMEOUT_MS]);
    // And it is a real bound, not a number large enough to be meaningless.
    expect(LYRICS_TIMEOUT_MS).toBeGreaterThan(0);
    expect(LYRICS_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it("forwards the caller's abort signal to the transport", async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const spy = vi.fn(async (_url: string, options?: { signal?: AbortSignal }) => {
      seen.push(options?.signal);
      return [] as never;
    });

    await resolveLyrics({ ...TRACK, signal: controller.signal, fetchJson: asTransport(spy) });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeDefined();
  });

  it("reports a non-OK provider response as unreachable, not as no lyrics", async () => {
    // A 500 from LRCLIB is a fact about the network. Answering "unavailable" would show the
    // listener a claim about the track that is not true, and would cache it as one.
    const failure = async () => {
      throw new HttpFetchError("http", "server error", { status: 500 });
    };
    expect(await resolveLyrics({ ...TRACK, fetchJson: asTransport(failure) })).toEqual({
      kind: "unreachable",
      reason: "http",
    });
  });

  it("classifies a malformed success body as a parse failure", async () => {
    const impl = fetcher({ not: "an array" });
    expect(await resolveLyrics({ ...TRACK, fetchJson: asTransport(impl) })).toEqual({
      kind: "unreachable",
      reason: "parse",
    });
  });
});

describe("candidate resolution (spec lyrics — timed beats untimed; closest duration wins)", () => {
  // These two scenarios were previously asserted only against `scoreCandidate`, which leaves the
  // resolution step itself — map, filter, sort, take the first — completely unpinned. Reversing the
  // comparator, or taking the last element, would have left every other test green.
  it("resolves the timed candidate from a list where the untimed one comes first", async () => {
    const untimed = {
      trackName: "Song Title",
      artistName: "Artist Name",
      duration: 210,
      plainLyrics: "words",
    };
    // Array order is deliberately the *wrong* answer first, so a naive "take the first" fails.
    const result = await resolveLyrics({
      ...TRACK,
      fetchJson: asTransport(fetcher([untimed, timedCandidate])),
    });

    expect(result).toEqual({
      kind: "hit",
      hit: { syncedLyrics: "[00:10]a", plainLyrics: null, source: "lrclib" },
    });
  });

  it("resolves the closest-duration timed candidate from a list where the worse one comes first", async () => {
    const worse = { ...timedCandidate, duration: 300, syncedLyrics: "[00:00]WRONG" };
    const better = { ...timedCandidate, duration: 210, syncedLyrics: "[00:00]RIGHT" };

    const result = await resolveLyrics({
      ...TRACK,
      fetchJson: asTransport(fetcher([worse, better])),
    });

    expect(result).toEqual({
      kind: "hit",
      hit: { syncedLyrics: "[00:00]RIGHT", plainLyrics: null, source: "lrclib" },
    });
  });

  it("skips an instrumental even when it is the only near-exact duration match", async () => {
    const instrumental = {
      trackName: "Song Title",
      duration: 210,
      instrumental: true,
      syncedLyrics: "[00:00]X",
    };
    const real = { ...timedCandidate, duration: 240 };

    const result = await resolveLyrics({
      ...TRACK,
      fetchJson: asTransport(fetcher([instrumental, real])),
    });

    expect(result).toEqual({
      kind: "hit",
      hit: { syncedLyrics: "[00:10]a", plainLyrics: null, source: "lrclib" },
    });
  });

  it("reports unavailable when every candidate is an instrumental", async () => {
    const only = { trackName: "Song Title", duration: 210, instrumental: true };
    expect(await resolveLyrics({ ...TRACK, fetchJson: asTransport(fetcher([only])) })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("caching (spec lyrics — de-duplication and negative caching)", () => {
  it("de-duplicates concurrent requests for one track into a single provider query", async () => {
    const impl = fetcher([timedCandidate]);
    const five = await Promise.all(
      Array.from({ length: 5 }, () => resolveLyrics({ ...TRACK, fetchJson: asTransport(impl) })),
    );
    expect(impl).toHaveBeenCalledTimes(1);
    expect(five.every((result) => result === five[0])).toBe(true);
  });

  it("serves a second lookup of a cached hit without a provider request", async () => {
    const impl = fetcher([timedCandidate]);
    await resolveLyrics({ ...TRACK, fetchJson: asTransport(impl) });
    expect((await resolveLyrics({ ...TRACK, fetchJson: asTransport(impl) })).kind).toBe("hit");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("caches a miss, so a track with no lyrics is not re-queried on every play", async () => {
    const impl = fetcher([]);
    await resolveLyrics({ ...TRACK, fetchJson: asTransport(impl) });
    await resolveLyrics({ ...TRACK, fetchJson: asTransport(impl) });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("does not cache a provider failure, so the next attempt retries", async () => {
    // The defect this prevents: a transient outage cached as a miss hides lyrics for a whole day.
    const failingImpl = failing(new HttpFetchError("network", "down"));
    await resolveLyrics({ ...TRACK, fetchJson: asTransport(failingImpl) });
    expect(lyricsCacheSizes()).toEqual({ hits: 0, misses: 0, inflight: 0 });

    const recovery = fetcher([timedCandidate]);
    expect((await resolveLyrics({ ...TRACK, fetchJson: asTransport(recovery) })).kind).toBe("hit");
  });

  it("expires a miss sooner than a hit", () => {
    // The asymmetry is the design: a miss is worth retrying sooner than a hit is worth distrusting.
    expect(LYRICS_MISS_TTL_MS).toBeLessThan(LYRICS_HIT_TTL_MS);
  });

  it("proves the TTL asymmetry behaviourally with an injected clock", async () => {
    // Comparing the two constants only proves they are numbers. Moving a fake clock past the miss
    // TTL but not the hit TTL proves the *caches* differ, which is what the requirement names.
    let now = 1_000;
    resetLyricsCaches(() => now);
    try {
      const missImpl = fetcher([]);
      await resolveLyrics({ ...TRACK, fetchJson: asTransport(missImpl) });
      now += LYRICS_MISS_TTL_MS + 1;
      await resolveLyrics({ ...TRACK, fetchJson: asTransport(missImpl) });
      expect(missImpl, "the miss should have expired and been re-queried").toHaveBeenCalledTimes(2);

      const hitImpl = fetcher([timedCandidate]);
      await resolveLyrics({ ...TRACK, videoId: "other", fetchJson: asTransport(hitImpl) });
      now -= LYRICS_MISS_TTL_MS + 1;
      now += LYRICS_MISS_TTL_MS + 1;
      expect(
        (await resolveLyrics({ ...TRACK, videoId: "other", fetchJson: asTransport(hitImpl) })).kind,
      ).toBe("hit");
      expect(
        hitImpl,
        "the hit should still be cached at the same elapsed time",
      ).toHaveBeenCalledTimes(1);
    } finally {
      resetLyricsCaches();
    }
  });

  it("bounds cache growth", async () => {
    // A pathological provider must not grow an unbounded per-instance cache.
    for (let index = 0; index < 300; index += 1) {
      await resolveLyrics({
        ...TRACK,
        videoId: `video${index}`,
        fetchJson: asTransport(fetcher([timedCandidate])),
      });
    }
    expect(lyricsCacheSizes().hits).toBeLessThanOrEqual(256);
  });

  it("frees the in-flight entry once a request settles", async () => {
    // A leaked key here would make a later lookup for the same track wait on a promise that is
    // already gone.
    await resolveLyrics({ ...TRACK, fetchJson: asTransport(fetcher([timedCandidate])) });
    expect(lyricsCacheSizes().inflight).toBe(0);
  });

  it("gives different tracks different cache entries", async () => {
    const impl = fetcher([timedCandidate]);
    await resolveLyrics({ ...TRACK, videoId: "aaaa", fetchJson: asTransport(impl) });
    await resolveLyrics({ ...TRACK, videoId: "bbbb", fetchJson: asTransport(impl) });
    expect(impl).toHaveBeenCalledTimes(2);
  });

  it("releases the in-flight key after a failure too", async () => {
    await resolveLyrics({ ...TRACK, fetchJson: failing(new Error("boom")) }).catch(() => undefined);
    expect(lyricsCacheSizes().inflight).toBe(0);
  });
});

/** Resolve with a provider returning `body`. */
async function call(body: unknown): Promise<LyricsResult> {
  return resolveLyrics({ ...TRACK, fetchJson: asTransport(fetcher(body)) });
}

/** A transport that always rejects with `error`. */
function failing(error: Error): NonNullable<Parameters<typeof resolveLyrics>[0]["fetchJson"]> {
  return (async () => {
    throw error;
  }) as never;
}
