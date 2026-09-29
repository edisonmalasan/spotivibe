import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/data/repositories";
import { MoreLikeThisShelf } from "@/features/related/MoreLikeThisShelf";
import { SIMILAR_ENDPOINT } from "@/features/related/similarApi";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M9 task 5.2 (spec: `catalog` — "Related content for the current track";
 * design decision 8): the More Like This shelf for the current track.
 *
 * The cases pin the four properties the requirement names — it resolves for the
 * playing track, it never offers the current track back, it re-resolves (and
 * cancels) when the track changes, and it never autoplays — plus the standard
 * shelf states and the one thing the spec makes load-bearing about the request
 * itself: it carries the track's public metadata and nothing else, so related
 * content needs no account and no stored user identity.
 */

const current = makeTrack({
  id: "youtube:aaa",
  providerId: "aaa",
  title: "Alpha",
  artists: [{ name: "Aurora" }, { name: "Beacon" }],
  artwork: [{ url: "https://example.test/alpha.jpg" }],
});

const suggestion = makeTrack({
  id: "youtube:bbb",
  providerId: "bbb",
  title: "Beta",
  artists: [{ name: "Aurora" }],
  language: "en",
});

const secondSuggestion = makeTrack({
  id: "youtube:ccc",
  providerId: "ccc",
  title: "Gamma",
  artists: [{ name: "Cobalt" }],
  language: "en",
});

const nextTrack = makeTrack({
  id: "youtube:zzz",
  providerId: "zzz",
  title: "Zulu",
  artists: [{ name: "Cobalt" }],
});

type Reply = { tracks: Track[] } | { fail: number; code: string } | { hang: true };

interface Recorded {
  url: URL;
  signal: AbortSignal | undefined;
}

/** A `/api/similar` stub: the nth call's answer, with `hang` staying open. */
function stubSimilar(reply: (call: number) => Reply = () => ({ tracks: [suggestion] })) {
  const calls: Recorded[] = [];
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const outcome = reply(calls.length);
    calls.push({
      url: new URL(String(input), "http://localhost"),
      signal: init?.signal ?? undefined,
    });
    if ("hang" in outcome) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    if ("fail" in outcome) {
      return Promise.resolve({
        ok: false,
        status: outcome.fail,
        json: async () => ({ error: { code: outcome.code, message: outcome.code } }),
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ tracks: outcome.tracks, diagnostics: {} }),
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

beforeEach(() => {
  resetPlayerStore();
  resetQueueStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Render the shelf with a track playing and playback paused. */
function renderShelf(track: Track = current) {
  usePlayerStore.getState().playTrack(track, [track]);
  usePlayerStore.getState().pause();
  return render(<MoreLikeThisShelf />);
}

describe("MoreLikeThisShelf: resolving for the current track", () => {
  it("renders skeletons while the resolution is in flight", () => {
    stubSimilar(() => ({ hang: true }));
    renderShelf();

    expect(screen.getByTestId("more-like-this")).toBeInTheDocument();
    expect(screen.getAllByTestId("shelf-skeleton").length).toBeGreaterThan(0);
    // Nothing is suggested while the answer is unknown.
    expect(screen.queryByTestId("shelf-track-card")).not.toBeInTheDocument();
  });

  it("suggests the resolved tracks once they arrive", async () => {
    stubSimilar(() => ({ tracks: [suggestion, secondSuggestion] }));
    renderShelf();

    const shelf = await screen.findByTestId("more-like-this");
    await waitFor(() => expect(within(shelf).getAllByTestId("shelf-track-card")).toHaveLength(2));
    expect(within(shelf).getByText("Beta")).toBeInTheDocument();
    expect(within(shelf).getByText("Gamma")).toBeInTheDocument();
  });

  it("issues exactly one request carrying only the track's public metadata", async () => {
    const { calls } = stubSimilar();
    renderShelf();

    await screen.findByText("Beta");

    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe(SIMILAR_ENDPOINT);
    const params = calls[0].url.searchParams;
    // The primary credit is the narrowing a provider can match on.
    expect(params.get("title")).toBe("Alpha");
    expect(params.get("artist")).toBe("Aurora");
    expect(params.get("exclude")).toBe("youtube:aaa");
    // No user, history, library, or session parameter exists in this surface.
    expect([...params.keys()].sort()).toEqual(["artist", "exclude", "title"]);
  });

  it("sends no artist parameter for a track with no credited artist", async () => {
    const { calls } = stubSimilar();
    renderShelf(
      makeTrack({ id: "youtube:nnn", providerId: "nnn", title: "No Credit", artists: [] }),
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    const params = calls[0].url.searchParams;
    expect(params.get("title")).toBe("No Credit");
    expect(params.has("artist")).toBe(false);
  });

  it("plays a suggestion with the shelf as its context, on activation only", async () => {
    stubSimilar(() => ({ tracks: [suggestion, secondSuggestion] }));
    renderShelf();

    const shelf = await screen.findByTestId("more-like-this");
    const cards = await waitFor(() => within(shelf).getAllByTestId("shelf-track-card"));
    fireEvent.click(cards[0]);

    expect(usePlayerStore.getState().currentTrack?.id).toBe(suggestion.id);
    // The whole shelf is the playback context, recorded as a browse activation.
    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual([
      suggestion.id,
      secondSuggestion.id,
    ]);
    expect(useQueueStore.getState().source).toBe("browse");
  });
});

describe("MoreLikeThisShelf: the current track is never suggested", () => {
  it("drops the current track even when the provider returns it", async () => {
    // The route excludes the source track server-side; a stale HTTP cache or a
    // differently-keyed candidate must still not put it on the rail.
    stubSimilar(() => ({ tracks: [suggestion, current, secondSuggestion] }));
    renderShelf();

    const shelf = await screen.findByTestId("more-like-this");
    await waitFor(() => expect(within(shelf).getAllByTestId("shelf-track-card")).toHaveLength(2));
    const ids = within(shelf)
      .getAllByTestId("shelf-track-card")
      .map((card) => card.getAttribute("data-track-id"));
    expect(ids).toEqual([suggestion.id, secondSuggestion.id]);
    expect(ids).not.toContain(current.id);
  });

  it("explains an empty shelf when the only candidate was the current track", async () => {
    stubSimilar(() => ({ tracks: [current] }));
    renderShelf();

    expect(
      await screen.findByRole("heading", { name: "Nothing similar found" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("shelf-track-card")).not.toBeInTheDocument();
  });
});

describe("MoreLikeThisShelf: the shelf follows the current track", () => {
  it("re-resolves for a new track and discards the previous suggestions", async () => {
    const { calls } = stubSimilar((call) => ({
      tracks: call === 0 ? [suggestion] : [secondSuggestion],
    }));
    const { rerender } = renderShelf();

    const shelf = await screen.findByText("Beta");
    expect(shelf).toBeInTheDocument();

    // Playback advances to a different track while the shelf stays mounted.
    usePlayerStore.getState().playTrack(nextTrack, [nextTrack]);
    rerender(<MoreLikeThisShelf />);

    await waitFor(() => expect(screen.getByText("Gamma")).toBeInTheDocument());
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[1].url.searchParams.get("title")).toBe("Zulu");
    expect(calls[1].url.searchParams.get("exclude")).toBe(nextTrack.id);
  });

  it("aborts the in-flight request for the track it superseded", async () => {
    const { calls } = stubSimilar(() => ({ hang: true }));
    const { rerender } = renderShelf();

    await waitFor(() => expect(calls).toHaveLength(1));
    const firstSignal = calls[0].signal;
    expect(firstSignal?.aborted).toBe(false);

    usePlayerStore.getState().playTrack(nextTrack, [nextTrack]);
    rerender(<MoreLikeThisShelf />);

    await waitFor(() => expect(calls).toHaveLength(2));
    // The first request was cancelled rather than left running to completion.
    expect(firstSignal?.aborted).toBe(true);
    expect(calls[1].signal?.aborted).toBe(false);
  });

  it("issues no request and renders nothing when no track is playing", () => {
    const { mock } = stubSimilar();
    render(<MoreLikeThisShelf />);

    expect(screen.queryByTestId("more-like-this")).not.toBeInTheDocument();
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("MoreLikeThisShelf: the standard shelf states", () => {
  it("explains an empty resolution", async () => {
    stubSimilar(() => ({ tracks: [] }));
    renderShelf();

    expect(
      await screen.findByRole("heading", { name: "Nothing similar found" }),
    ).toBeInTheDocument();
  });

  it("treats an unresolvable source as empty, not as a failure", async () => {
    // The route's 404 is its answer for "nothing similar resolved" — there is
    // nothing to retry, so it must not render a retryable error.
    stubSimilar(() => ({ fail: 404, code: "unresolvable" }));
    renderShelf();

    expect(
      await screen.findByRole("heading", { name: "Nothing similar found" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("renders a retryable error for an upstream failure and recovers on retry", async () => {
    stubSimilar((call) =>
      call === 0 ? { fail: 503, code: "upstream_unavailable" } : { tracks: [suggestion] },
    );
    renderShelf();

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByRole("heading", { name: "This shelf didn't load" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Beta")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts its request on unmount", async () => {
    const { calls } = stubSimilar(() => ({ hang: true }));
    const { unmount } = renderShelf();

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].signal?.aborted).toBe(false);

    unmount();

    expect(calls[0].signal?.aborted).toBe(true);
  });
});

describe("MoreLikeThisShelf: it never autoplays", () => {
  it("starts no playback when it loads or re-resolves", async () => {
    const { calls } = stubSimilar((call) => ({
      tracks: call === 0 ? [suggestion] : [secondSuggestion],
    }));
    const { rerender } = renderShelf();

    // The user's own track is still the one playing, and the queue it was
    // started with is untouched.
    await screen.findByText("Beta");
    expect(usePlayerStore.getState().currentTrack?.id).toBe(current.id);
    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual([current.id]);

    usePlayerStore.getState().playTrack(nextTrack, [nextTrack]);
    rerender(<MoreLikeThisShelf />);
    await screen.findByText("Gamma");

    // Re-resolving is not playback either: the still-current track is the one
    // the user chose.
    expect(usePlayerStore.getState().currentTrack?.id).toBe(nextTrack.id);
    expect(useQueueStore.getState().queue.map((track) => track.id)).toEqual([nextTrack.id]);
    expect(calls).toHaveLength(2);
  });
});
