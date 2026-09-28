import { afterEach, describe, expect, it, vi } from "vitest";
import { createInflightDedup, createTtlCache } from "@/server/music/cache";
import { ProviderError } from "@/server/music/errors";
import { outboundLimiter, type Semaphore } from "@/server/music/limiter";
import { ATTEMPT_TIMEOUT_MS } from "@/server/music/providers/support";
import {
  DEFAULT_PLAYLIST_RESOLVERS,
  playlistCacheKey,
  resolvePlaylist,
  runResolvePlaylist,
  PLAYLIST_CACHE_TTL_MS,
  type PlaylistDeps,
} from "@/server/music/playlist";
import { PLAYLIST_ENTRY_CAP } from "@/server/music/types";
import type {
  PlaylistRequest,
  PlaylistResolution,
  PlaylistResolver,
  PlaylistSuccess,
} from "@/server/music/types";
import { makeCandidate } from "./helpers/music-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fake tier with call/request counters. */
function fakeResolver(
  id: PlaylistResolver["id"],
  impl: (request: PlaylistRequest) => Promise<PlaylistResolution>,
): PlaylistResolver & { calls: number; requests: PlaylistRequest[] } {
  const resolver = {
    id,
    calls: 0,
    requests: [] as PlaylistRequest[],
    async resolvePlaylist(request: PlaylistRequest): Promise<PlaylistResolution> {
      resolver.calls += 1;
      resolver.requests.push(request);
      return impl(request);
    },
  };
  return resolver;
}

function ok(title: string, entries: PlaylistResolution["entries"]): PlaylistResolution {
  return { title, entries, truncated: false };
}

function rejectWith(kind: ProviderError["kind"]) {
  return () => Promise.reject(new ProviderError("ytmusic", kind, `${kind} failure`));
}

/** Fresh service state per test (the module keeps one process-wide copy). */
function freshDeps(chainOptions?: Parameters<typeof resolvePlaylist>[1]): PlaylistDeps {
  return {
    cache: createTtlCache<PlaylistSuccess>({
      ttlMs: PLAYLIST_CACHE_TTL_MS,
      maxEntries: 20,
    }),
    inflight: createInflightDedup(),
    ...(chainOptions ? { chainOptions } : {}),
  };
}

describe("resolvePlaylist — tier order and stopping", () => {
  it("stops at the first tier that answers", async () => {
    const primary = fakeResolver("ytmusic", async () =>
      ok("Primary playlist", [makeCandidate({ videoId: "vidA" })]),
    );
    const fallback = fakeResolver("ytweb", async () => ok("Fallback", [makeCandidate()]));
    const unused = fakeResolver("invidious", async () => ok("Unused", [makeCandidate()]));

    const result = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [primary, fallback, unused] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playlist.title).toBe("Primary playlist");
      expect(result.playlist.tracks.map((track) => track.providerId)).toEqual(["vidA"]);
      expect(result.playlist.skipped).toBe(0);
      expect(result.playlist.truncated).toBeUndefined();
      expect(result.diagnostics.tiers).toEqual([{ tier: "ytmusic", outcome: "ok" }]);
    }
    expect(primary.calls).toBe(1);
    expect(fallback.calls).toBe(0);
    expect(unused.calls).toBe(0);
  });

  it("falls through a transport failure to the next tier with structured diagnostics", async () => {
    const primary = fakeResolver("ytmusic", rejectWith("network"));
    const fallback = fakeResolver("ytweb", async () => ok("Fallback", [makeCandidate()]));

    const result = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [primary, fallback] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.tiers).toEqual([
        { tier: "ytmusic", outcome: "network" },
        { tier: "ytweb", outcome: "ok" },
      ]);
    }
  });

  it("does not retry lower tiers after a definitive unavailable answer", async () => {
    const primary = fakeResolver("ytmusic", rejectWith("unavailable"));
    const fallback = fakeResolver("ytweb", async () => ok("Fallback", [makeCandidate()]));

    const result = await resolvePlaylist(
      { playlistId: "PLprivateeeeeeee" },
      { resolvers: [primary, fallback] },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "unavailable",
      tiers: [{ tier: "ytmusic", outcome: "unavailable" }],
    });
    expect(fallback.calls).toBe(0);
  });

  it("surfaces an upstream error when every tier fails", async () => {
    const kinds: ProviderError["kind"][] = ["network", "timeout", "http", "parse"];
    const ids = ["ytmusic", "ytweb", "invidious", "piped"] as const;
    const resolvers = ids.map((id, index) =>
      fakeResolver(id, () =>
        Promise.reject(new ProviderError(id, kinds[index] as ProviderError["kind"], "boom")),
      ),
    );

    const result = await resolvePlaylist({ playlistId: "PLaaaaaaaaaaaa" }, { resolvers });

    expect(result).toMatchObject({
      ok: false,
      reason: "upstream",
      tiers: [
        { tier: "ytmusic", outcome: "network" },
        { tier: "ytweb", outcome: "timeout" },
        { tier: "invidious", outcome: "http" },
        { tier: "piped", outcome: "parse" },
      ],
    });
  });

  it("treats a non-ProviderError resolver bug as a parse failure and keeps walking", async () => {
    const broken = fakeResolver("ytmusic", () => Promise.reject(new TypeError("bug in tier")));
    const fallback = fakeResolver("ytweb", async () => ok("Fallback", [makeCandidate()]));

    const result = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [broken, fallback] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.diagnostics.tiers[0]).toEqual({ tier: "ytmusic", outcome: "parse" });
    }
  });

  it("accepts an empty-but-answered listing (the tier reached YouTube)", async () => {
    const primary = fakeResolver("ytmusic", async () => ok("Empty playlist", []));

    const result = await resolvePlaylist(
      { playlistId: "PLemptyyyyyyyy" },
      { resolvers: [primary] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playlist.title).toBe("Empty playlist");
      expect(result.playlist.tracks).toEqual([]);
      expect(result.playlist.skipped).toBe(0);
    }
  });

  it("uses the fixed four-tier order by default", () => {
    expect(DEFAULT_PLAYLIST_RESOLVERS.map((resolver) => resolver.id)).toEqual([
      "ytmusic",
      "ytweb",
      "invidious",
      "piped",
    ]);
  });

  it("holds a concurrency-gate slot around every tier attempt and releases it", async () => {
    const releases: ReturnType<typeof vi.fn>[] = [];
    const acquire = vi.fn(async () => {
      const release = vi.fn();
      releases.push(release);
      return release;
    });
    const limiter = { acquire, activeCount: 0, pendingCount: 0 };

    const failing = fakeResolver("ytmusic", rejectWith("network"));
    const fallback = fakeResolver("ytweb", async () => ok("Fallback", [makeCandidate()]));

    const result = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [failing, fallback], limiter: limiter as unknown as Semaphore },
    );

    expect(result.ok).toBe(true);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(releases).toHaveLength(2);
    for (const release of releases) expect(release).toHaveBeenCalledTimes(1);
  });

  it("defaults to the shared outbound limiter the route relies on", async () => {
    const acquireSpy = vi.spyOn(outboundLimiter, "acquire");
    try {
      const primary = fakeResolver("ytmusic", async () => ok("Fine", [makeCandidate()]));

      const result = await resolvePlaylist(
        { playlistId: "PLaaaaaaaaaaaa" },
        { resolvers: [primary] },
      );

      expect(result.ok).toBe(true);
      expect(acquireSpy).toHaveBeenCalledTimes(1);
      expect(primary.requests[0]?.timeoutMs).toBe(ATTEMPT_TIMEOUT_MS);
    } finally {
      acquireSpy.mockRestore();
    }
  });
});

describe("resolvePlaylist — entry handling (design decision 9)", () => {
  it("keeps source order and applies no quality filtering or scoring", async () => {
    const entries = [
      makeCandidate({ videoId: "vidShort", title: "ad", durationSeconds: 15 }),
      makeCandidate({ videoId: "vidTalk", title: "Artist Interview" }),
      makeCandidate({ videoId: "vidSong", title: "Get Lucky", durationSeconds: 249 }),
    ];
    const primary = fakeResolver("ytmusic", async () => ok("Source order", entries));

    const result = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [primary] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playlist.tracks.map((track) => track.providerId)).toEqual([
        "vidShort",
        "vidTalk",
        "vidSong",
      ]);
      expect(result.playlist.tracks).toHaveLength(3);
      for (const track of result.playlist.tracks) {
        expect(track).not.toHaveProperty("qualityScore");
      }
    }
  });

  it("passes unresolvable entries through as a skipped count", async () => {
    const primary = fakeResolver("ytmusic", async () =>
      ok("With gaps", [makeCandidate({ videoId: "vidA" }), null, null]),
    );

    const result = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [primary] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playlist.tracks).toHaveLength(1);
      expect(result.playlist.skipped).toBe(2);
    }
  });

  it("marks truncation when the resolver reports more entries existed", async () => {
    const primary = fakeResolver("ytmusic", async () => ({
      title: "Long playlist",
      entries: [makeCandidate({ videoId: "vidA" })],
      truncated: true,
    }));

    const result = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [primary] },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.playlist.truncated).toBe(true);
  });

  it("defensively caps a resolver that overshoots the documented entry cap", async () => {
    const entries = Array.from({ length: PLAYLIST_ENTRY_CAP + 25 }, (_value, index) =>
      makeCandidate({ videoId: `vid${index}`, title: `Song ${index}` }),
    );
    const sloppy = fakeResolver("ytmusic", async () => ok("Overshooting", entries));

    const result = await resolvePlaylist({ playlistId: "PLaaaaaaaaaaaa" }, { resolvers: [sloppy] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playlist.tracks).toHaveLength(PLAYLIST_ENTRY_CAP);
      expect(result.playlist.truncated).toBe(true);
      expect(result.playlist.tracks[0]?.providerId).toBe("vid0");
      expect(result.playlist.tracks.at(-1)?.providerId).toBe(`vid${PLAYLIST_ENTRY_CAP - 1}`);
    }
  });

  it("preserves the description and omits it when the tier reported none", async () => {
    const withDescription = fakeResolver("ytmusic", async () => ({
      ...ok("Described", [makeCandidate()]),
      description: "A real description",
    }));
    const withoutDescription = fakeResolver("ytmusic", async () =>
      ok("Undescribed", [makeCandidate()]),
    );

    const described = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [withDescription] },
    );
    const undescribed = await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa" },
      { resolvers: [withoutDescription] },
    );

    expect(described.ok && described.playlist.description).toBe("A real description");
    expect(undescribed.ok && undescribed.playlist.description).toBeUndefined();
  });
});

describe("resolvePlaylist — cancellation and per-attempt options", () => {
  it("passes the caller signal and the configured attempt timeout to each tier", async () => {
    const controller = new AbortController();
    const primary = fakeResolver("ytmusic", async () => ok("Fine", [makeCandidate()]));

    await resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa", signal: controller.signal },
      { resolvers: [primary], attemptTimeoutMs: 1234 },
    );

    expect(primary.requests[0]?.signal).toBe(controller.signal);
    expect(primary.requests[0]?.timeoutMs).toBe(1234);
  });

  it("propagates caller cancellation instead of recording a tier outcome", async () => {
    const controller = new AbortController();
    const hanging = fakeResolver("ytmusic", (request) => {
      return new Promise<PlaylistResolution>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });

    const pending = resolvePlaylist(
      { playlistId: "PLaaaaaaaaaaaa", signal: controller.signal },
      { resolvers: [hanging] },
    );
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        (error as { name?: unknown }).name === "AbortError",
    );
    expect(hanging.calls).toBe(1);
  });
});

describe("runResolvePlaylist — cache and dedup", () => {
  it("caches successes within the TTL without re-running the chain", async () => {
    const primary = fakeResolver("ytmusic", async () => ok("Cached", [makeCandidate()]));
    const deps = freshDeps({ resolvers: [primary] });

    const first = await runResolvePlaylist({ playlistId: "PLcacheaaaaaaa" }, deps);
    const second = await runResolvePlaylist({ playlistId: "PLcacheaaaaaaa" }, deps);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(primary.calls).toBe(1);
    expect(second.ok && second.playlist.title).toBe("Cached");
    expect(playlistCacheKey("PLcacheaaaaaaa")).toBe("playlist:PLcacheaaaaaaa");
  });

  it("never caches failures — the next request retries upstream", async () => {
    const failing = fakeResolver("ytmusic", rejectWith("network"));
    const fallback = fakeResolver("ytweb", rejectWith("timeout"));
    const deps = freshDeps({ resolvers: [failing, fallback] });

    const first = await runResolvePlaylist({ playlistId: "PLflakyaaaaaaa" }, deps);
    const second = await runResolvePlaylist({ playlistId: "PLflakyaaaaaaa" }, deps);

    expect(first).toMatchObject({ ok: false, reason: "upstream" });
    expect(second).toMatchObject({ ok: false, reason: "upstream" });
    expect(failing.calls).toBe(2);
    expect(fallback.calls).toBe(2);
    expect(deps.cache.size).toBe(0);
  });

  it("does not cache a definitive unavailable answer either", async () => {
    const primary = fakeResolver("ytmusic", rejectWith("unavailable"));
    const deps = freshDeps({ resolvers: [primary] });

    const first = await runResolvePlaylist({ playlistId: "PLprivateeeeeeee" }, deps);
    const second = await runResolvePlaylist({ playlistId: "PLprivateeeeeeee" }, deps);

    expect(first).toMatchObject({ ok: false, reason: "unavailable" });
    expect(second).toMatchObject({ ok: false, reason: "unavailable" });
    expect(primary.calls).toBe(2);
  });

  it("shares one in-flight resolution between identical concurrent requests", async () => {
    let release: (() => void) | undefined;
    const primary = fakeResolver(
      "ytmusic",
      () =>
        new Promise<PlaylistResolution>((resolve) => {
          release = () => resolve(ok("Shared", [makeCandidate()]));
        }),
    );
    const deps = freshDeps({ resolvers: [primary] });

    const first = runResolvePlaylist({ playlistId: "PLsharedaaaaaaa" }, deps);
    const second = runResolvePlaylist({ playlistId: "PLsharedaaaaaaa" }, deps);
    await vi.waitFor(() => expect(primary.calls).toBe(1));
    release?.();

    const [a, b] = await Promise.all([first, second]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(primary.calls).toBe(1);
  });

  it("keeps different playlist ids independent", async () => {
    const primary = fakeResolver("ytmusic", async () => ok("One", [makeCandidate()]));
    const deps = freshDeps({ resolvers: [primary] });

    await runResolvePlaylist({ playlistId: "PLfirstaaaaaaa" }, deps);
    await runResolvePlaylist({ playlistId: "PLsecondaaaaaa" }, deps);

    expect(primary.calls).toBe(2);
    expect(deps.cache.size).toBe(2);
  });
});
