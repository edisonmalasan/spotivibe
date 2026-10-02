import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData } from "@/data/localData";
import type { Track } from "@/data/repositories";
import {
  bandTasteProfile,
  MAX_BAND_QUERY_SEEDS,
  seedTermsForBand,
  TIME_BAND_LABELS,
  TIME_BAND_TERMS,
  type TimeBand,
} from "@/features/home/timeBands";
import {
  TIME_SHELF_ACTION_BUSY_LABEL,
  TIME_SHELF_ACTION_ID,
  TIME_SHELF_ACTION_LABEL,
  TIME_SHELF_EMPTY,
  TIME_SHELF_STATUS_ID,
  TimeShelf,
} from "@/features/home/TimeShelf";
import { generateMix } from "@/features/mixes/generateMix";
import { isHonestMixName } from "@/features/mixes/mixNaming";
import { makeTrack } from "./helpers/music-fixtures";
import { resetHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetMixStore, useMixStore } from "@/stores/mixStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";

/**
 * M17, the time-aware shelf's *action*: the band's seed set has to reach a real
 * query (ROADMAP M17 — "local time selects a seed set and query construction
 * only"; spec `discovery` — "The time band is not sent and not stored", whose WHEN
 * clause is "a time-aware shelf issues a request **or composes a mix**").
 *
 * The generator is **spied rather than replaced**, exactly as `home-mix-cards`
 * does it, so every assertion here is also an assertion about the real composition
 * path: a shelf that composed through a private composer would pass a test that
 * stubbed the shared one, and would fail these.
 *
 * The clock is injected twice over — `now` dates the band and the profile, `clock`
 * dates the mix — so nothing in this file reads the wall clock.
 */

// Only the generator is wrapped; the rest of the module is the real one.
vi.mock("@/features/mixes/generateMix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/mixes/generateMix")>();
  return { ...actual, generateMix: vi.fn(actual.generateMix) };
});

const NOW = new Date(2026, 9, 2, 20, 0, 0, 0).getTime();
const CLOCK = (): number => NOW;
const LANGUAGES = ["en"];

/** One representative local hour per band, in the order the bands run. */
const BAND_HOURS = [
  ["morning", 8],
  ["afternoon", 14],
  ["evening", 20],
  ["late-night", 2],
] as const satisfies readonly (readonly [TimeBand, number])[];

/** A fixed local hour as an instant, so no case reads the wall clock. */
function instantAtLocalHour(hour: number): number {
  return new Date(2026, 9, 2, hour, 0, 0, 0).getTime();
}

// Keep the literal in a variable — Vite rewrites an inline `new URL("<literal>")`.
const srcRel = "..";
const frontendDir = fileURLToPath(new URL(srcRel, import.meta.url));

/** A track whose own public text carries a mood the shared lexicon recognises. */
function mood(id: string, title: string, artist: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title,
    artists: [{ name: artist }],
    artwork: [{ url: `https://example.test/${id}.jpg` }],
  });
}

/** Local material spanning all four bands' mood words. */
function moodTaste(): Track[] {
  return [
    mood("soul", "Modern Soul", "Aurora"),
    mood("funk", "Deep Funk", "Beacon"),
    mood("ambient", "Ambient Drift", "Cobalt"),
  ];
}

/** The band's own terms for this fixture's taste, at the generator's own bound. */
function expectedSeeds(band: TimeBand): string[] {
  return seedTermsForBand(band, { likedTracks: moodTaste(), events: [] }).slice(
    0,
    MAX_BAND_QUERY_SEEDS,
  );
}

/** Four distinct feed tracks, so a composed mix has real contents. */
const FEED_TRACKS = Array.from({ length: 4 }, (_unused, index) =>
  makeTrack({
    id: `youtube:fed${index}`,
    providerId: `fed${index}`,
    title: `Feed Song ${index}`,
    artists: [{ name: `Feed Artist ${index}` }],
  }),
);

/** Stub the discovery endpoint; `fail` answers every feed with a 503. */
function stubDiscovery(tracks: Track[] = FEED_TRACKS, fail = false) {
  const calls: URL[] = [];
  const mock = vi.fn((input: RequestInfo | URL) => {
    calls.push(new URL(String(input), "http://localhost"));
    return Promise.resolve(
      fail
        ? ({
            ok: false,
            status: 503,
            json: async () => ({ error: { code: "upstream_unavailable" } }),
          } as unknown as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({ tracks, diagnostics: {} }),
          } as unknown as Response),
    );
  });
  vi.stubGlobal("fetch", mock);
  return { mock, calls };
}

/** The generator spy, typed. */
const generator = generateMix as unknown as ReturnType<typeof vi.fn>;

function renderShelf({
  likedTracks = moodTaste(),
  now = NOW,
}: { likedTracks?: Track[]; now?: number } = {}) {
  return render(
    <TimeShelf
      likedTracks={likedTracks}
      events={[]}
      now={now}
      languages={LANGUAGES}
      clock={CLOCK}
    />,
  );
}

function press(): void {
  fireEvent.click(screen.getByTestId(TIME_SHELF_ACTION_ID));
}

/** The seed terms the generator's nth call was handed. */
function seedsOfCall(index: number): string[] {
  return generator.mock.calls[index][0].profile.seedTerms as string[];
}

/**
 * Wait until a composition has run to completion, and report how many mixes are
 * now stored.
 *
 * The generator's `upsert` and the `playFromShelf` that follows it sit in the same
 * continuation, so observing the mix in the store is what proves the whole
 * activation has drained. Without that, a composition still in flight when its test
 * ends lands in the *next* test and shows up there as playback nobody asked for.
 */
async function awaitStoredMixes(previous: number): Promise<number> {
  await waitFor(() => expect(useMixStore.getState().mixes.length).toBeGreaterThan(previous));
  return useMixStore.getState().mixes.length;
}

/** Activate, settle, and return the seeds the composition asked for. */
async function composeAndReadSeeds(now: number): Promise<string[]> {
  generator.mockClear();
  const rendered = renderShelf({ now });
  const before = useMixStore.getState().mixes.length;
  await act(async () => {
    press();
  });
  await waitFor(() => expect(generator).toHaveBeenCalledTimes(1));
  const seeds = seedsOfCall(0);
  await awaitStoredMixes(before);
  rendered.unmount();
  return seeds;
}

beforeEach(async () => {
  resetHistoryStore();
  resetLibraryStore();
  resetMixStore();
  resetPlayerStore();
  resetQueueStore();
  generator.mockClear();
  const data = await getLocalData();
  await data.mixes.clear();
  await data.listeningHistory.clear();
  stubDiscovery();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TimeShelf: nothing is composed while rendering", () => {
  it("spends no provider work and calls no generator until the action is pressed", () => {
    const { calls } = stubDiscovery();
    renderShelf();

    // The shelf, the band label, the local tracks, and the action are all there…
    expect(screen.getByTestId("home-time-shelf")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: TIME_BAND_LABELS.evening })).toBeInTheDocument();
    expect(screen.getAllByTestId("shelf-track-card").length).toBeGreaterThan(0);
    expect(screen.getByTestId(TIME_SHELF_ACTION_ID)).toBeInTheDocument();
    // …and rendering spent nothing: no request, no generator call, no stored mix,
    // and no playback.
    expect(calls).toEqual([]);
    expect(generator).not.toHaveBeenCalled();
    expect(useMixStore.getState().mixes).toEqual([]);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("composes exactly once per activation, through the shared generator", async () => {
    const { calls } = stubDiscovery();
    renderShelf();
    expect(generator).not.toHaveBeenCalled();

    await act(async () => {
      press();
    });

    await waitFor(() => expect(generator).toHaveBeenCalledTimes(1));
    // The call went out with the shared generator's own input shape.
    const request = generator.mock.calls[0][0];
    expect(request.languages).toEqual(LANGUAGES);
    expect(request.now).toBe(NOW);
    expect(request.profile.hasSignal).toBe(true);

    // And the mix really was built and stored, not merely returned.
    await awaitStoredMixes(0);
    expect(await (await getLocalData()).mixes.list()).toHaveLength(1);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((url) => url.searchParams.get("kind") === "mix")).toBe(true);
  });

  it("starts the composed mix with the browse source and names it honestly", async () => {
    renderShelf();

    await act(async () => {
      press();
    });

    await waitFor(() => expect(usePlayerStore.getState().currentTrack).not.toBeNull());
    const queue = useQueueStore.getState().queue;
    expect(queue.map((track) => track.id)).toEqual(FEED_TRACKS.map((track) => track.id));
    expect(useQueueStore.getState().source).toBe("browse");

    // The name is the generator's own, checked by the shared rule — and the action's
    // visible label is plain copy that names no mix and claims nothing.
    const stored = useMixStore.getState().mixes[0];
    expect(stored?.name).toBeDefined();
    expect(isHonestMixName(stored?.name ?? "")).toBe(true);
    expect(screen.getByTestId(TIME_SHELF_STATUS_ID).textContent).toContain(stored?.name ?? "");
    expect(isHonestMixName(TIME_SHELF_ACTION_LABEL)).toBe(true);
    expect(document.body.textContent).not.toMatch(/best|top|essential|chart|ranking/i);
  });

  it("keeps the composed set empty until the action is pressed", async () => {
    renderShelf();
    expect(await (await getLocalData()).mixes.list()).toEqual([]);

    await act(async () => {
      press();
    });

    await awaitStoredMixes(0);
    expect(await (await getLocalData()).mixes.list()).toHaveLength(1);
  });
});

describe("TimeShelf: the band's seed set is what the request asks for", () => {
  it("hands the generator the band's own terms, bounded to the generator's own read", async () => {
    renderShelf();

    await act(async () => {
      press();
    });

    await waitFor(() => expect(generator).toHaveBeenCalledTimes(1));
    expect(seedsOfCall(0)).toEqual(expectedSeeds("evening"));
    // Deliberately bounded here, rather than left to `generateMix`'s `slice(0, 4)`.
    expect(seedsOfCall(0).length).toBeLessThanOrEqual(MAX_BAND_QUERY_SEEDS);
    expect(seedsOfCall(0).length).toBeGreaterThan(0);
    // The mood word leads, so the band always has an effect on the query.
    expect(seedsOfCall(0)[0]).toBe(TIME_BAND_TERMS.evening);
    await awaitStoredMixes(0);
  });

  it("carries the mood in the request itself, and no band, label, or hour", async () => {
    const { calls } = stubDiscovery();
    renderShelf();

    await act(async () => {
      press();
    });

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await awaitStoredMixes(0);
    const mix = calls.find((url) => url.searchParams.get("kind") === "mix");
    expect(mix).toBeDefined();
    // Exactly the band's terms and the listener's languages — nothing else, so the
    // band reached the query and nothing about *when* it was pressed left with it.
    expect(mix?.searchParams.get("seeds")).toBe(expectedSeeds("evening").join(","));
    expect(mix?.searchParams.get("languages")).toBe("en");
    expect([...(mix?.searchParams.keys() ?? [])].sort()).toEqual([
      "kind",
      "languages",
      "limit",
      "seeds",
    ]);
    const wire = [...calls.flatMap((url) => [...url.searchParams.values()])].join(" ");
    expect(wire).not.toMatch(/band|hour|clock|morning|afternoon|evening|night/i);
    expect(wire).not.toMatch(/\d{1,2}:\d{2}|\b(am|pm)\b/i);
  });

  it("gives two injected hours two different seed sets, so the band reaches the query", async () => {
    const morning = await composeAndReadSeeds(instantAtLocalHour(8));
    const night = await composeAndReadSeeds(instantAtLocalHour(2));

    expect(morning[0]).toBe(TIME_BAND_TERMS.morning);
    expect(night[0]).toBe(TIME_BAND_TERMS["late-night"]);
    expect(morning).not.toEqual(night);
    // And each is exactly what the band's own strategy selects, not merely
    // something different.
    expect(morning).toEqual(expectedSeeds("morning"));
    expect(night).toEqual(expectedSeeds("late-night"));
  });

  it("leads with each band's own mood at every band", async () => {
    let stored = 0;
    for (const [band, hour] of BAND_HOURS) {
      generator.mockClear();
      const rendered = renderShelf({ now: instantAtLocalHour(hour) });

      await act(async () => {
        press();
      });

      await waitFor(() => expect(generator).toHaveBeenCalledTimes(1));
      expect(seedsOfCall(0)[0]).toBe(TIME_BAND_TERMS[band]);
      // The pure helper and the shelf agree, which is what makes "the band selects a
      // seed set" checkable without the DOM.
      expect(
        bandTasteProfile(band, {
          likedTracks: moodTaste(),
          events: [],
          languages: LANGUAGES,
          now: instantAtLocalHour(hour),
        }).seedTerms,
      ).toEqual(expectedSeeds(band));
      stored = await awaitStoredMixes(stored);
      rendered.unmount();
    }
  });

  it("writes the band into no store and into no request parameter name", async () => {
    const { calls } = stubDiscovery();
    renderShelf({ now: instantAtLocalHour(14) });

    await act(async () => {
      press();
    });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await awaitStoredMixes(0);

    for (const url of calls) {
      for (const key of url.searchParams.keys()) {
        expect(key, key).not.toMatch(/band|time|hour|clock|mood/i);
      }
    }
    // And the persisted mix carries the seeds, not the band that chose them.
    const stored = useMixStore.getState().mixes[0];
    expect(stored?.seeds).toEqual(expectedSeeds("afternoon"));
    expect(JSON.stringify(stored ?? {})).not.toMatch(/"(band|timeOfDay|hour)"/i);
  });
});

describe("TimeShelf: an activation that produced no mix is explained", () => {
  it("explains an empty feed, starts nothing, and stays pressable", async () => {
    stubDiscovery([], false);
    renderShelf();

    await act(async () => {
      press();
    });

    await waitFor(() => expect(screen.getByTestId(TIME_SHELF_STATUS_ID)).toBeInTheDocument());
    expect(screen.getByRole("status").textContent).toBe(
      "The feed had nothing for this mix right now.",
    );
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
    expect(useMixStore.getState().mixes).toEqual([]);
    const action = screen.getByTestId(TIME_SHELF_ACTION_ID);
    expect(action).not.toBeDisabled();
    expect(action).not.toHaveAttribute("aria-busy");
  });

  it("explains a provider failure, and leaves the shelf itself intact", async () => {
    stubDiscovery([], true);
    renderShelf();

    await act(async () => {
      press();
    });

    await waitFor(() => expect(screen.getByTestId(TIME_SHELF_STATUS_ID)).toBeInTheDocument());
    expect(screen.getByRole("status").textContent?.length).toBeGreaterThan(0);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    // One failed activation does not empty the shelf it belongs to.
    expect(screen.getByRole("heading", { name: TIME_BAND_LABELS.evening })).toBeInTheDocument();
    expect(screen.getAllByTestId("shelf-track-card").length).toBeGreaterThan(0);
  });

  it("distinguishes a device with no signal from a feed with nothing", async () => {
    // Reachable only by forcing the outcome: the action is not offered at all when
    // the profile has no signal, so the generator can only report it if the signal
    // disappeared between rendering and pressing. That is the case the branch is
    // for, and it must not be answered with the feed's message.
    generator.mockResolvedValueOnce({ status: "no-signal" });
    renderShelf();

    await act(async () => {
      press();
    });

    await waitFor(() => expect(screen.getByTestId(TIME_SHELF_STATUS_ID)).toBeInTheDocument());
    expect(screen.getByRole("status").textContent).not.toBe(
      "The feed had nothing for this mix right now.",
    );
    expect(screen.getByRole("status").textContent).toMatch(/nothing to build from/i);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("explains a thrown composition rather than leaving an inert control", async () => {
    generator.mockRejectedValueOnce(new Error("Local data is unavailable."));
    renderShelf();

    await act(async () => {
      press();
    });

    await waitFor(() => expect(screen.getByTestId(TIME_SHELF_STATUS_ID)).toBeInTheDocument());
    expect(screen.getByRole("status").textContent).toBe("Local data is unavailable.");
    expect(screen.getByTestId(TIME_SHELF_ACTION_ID)).not.toBeDisabled();
  });

  it("is busy and disabled only while composing", async () => {
    let release: (() => void) | undefined;
    generator.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "empty" });
          };
        }),
    );
    renderShelf();

    fireEvent.click(screen.getByTestId(TIME_SHELF_ACTION_ID));

    await waitFor(() => expect(screen.getByTestId(TIME_SHELF_ACTION_ID)).toBeDisabled());
    expect(screen.getByTestId(TIME_SHELF_ACTION_ID)).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(TIME_SHELF_ACTION_BUSY_LABEL)).toBeInTheDocument();

    await act(async () => {
      release?.();
    });

    await waitFor(() => expect(screen.getByTestId(TIME_SHELF_ACTION_ID)).not.toBeDisabled());
    expect(screen.getByTestId(TIME_SHELF_ACTION_ID)).not.toHaveAttribute("aria-busy");
  });
});

describe("TimeShelf: the action is offered only where it can do something", () => {
  it("offers no action for a device with no local taste", () => {
    renderShelf({ likedTracks: [] });

    // Stronger than explaining an empty mix: with no signal there is nothing the
    // generator could honestly build from, so no control is offered at all. The
    // shelf still renders, because its local lens has its own empty state.
    expect(screen.getByTestId("home-time-shelf")).toBeInTheDocument();
    expect(screen.queryByTestId(TIME_SHELF_ACTION_ID)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: TIME_SHELF_EMPTY.title })).toBeInTheDocument();
  });

  it("is a real focusable button with an accessible name, and the shelf keeps a band label", () => {
    renderShelf();
    const action = screen.getByRole("button", { name: TIME_SHELF_ACTION_LABEL });
    expect(action.tagName).toBe("BUTTON");
    action.focus();
    expect(action).toHaveFocus();
    // The shelf's own label stays a band name, never a clock reading.
    expect(screen.getByRole("region", { name: TIME_BAND_LABELS.evening })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d{1,2}:\d{2}|\b(am|pm)\b/i);
  });

  it("follows the presented filter, like every sibling surface", () => {
    const props = {
      likedTracks: moodTaste(),
      events: [],
      now: NOW,
      languages: LANGUAGES,
      clock: CLOCK,
    };
    const podcasts = render(<TimeShelf {...props} filter="podcasts" />);
    expect(screen.queryByTestId("home-time-shelf")).not.toBeInTheDocument();
    podcasts.unmount();

    const music = render(<TimeShelf {...props} filter="music" />);
    expect(screen.getByTestId("home-time-shelf")).toBeInTheDocument();
    music.unmount();
  });
});

describe("TimeShelf: the band is observable, and it is not in the prerender", () => {
  it("puts the band on the rendered region, so a test can read it", () => {
    renderShelf();
    // The evidence hook for band verification. It was silently dropped for a whole
    // milestone because a hyphenated JSX attribute is invisible to TypeScript.
    expect(screen.getByTestId("home-time-shelf")).toHaveAttribute("data-band", "evening");
  });

  it("prerenders no band at all, so a build cannot ship one visitor's band", () => {
    // `/` is a static prerender, and `renderToStaticMarkup` is the same render the
    // build performs: no effects, no client clock, and `useSyncExternalStore`'s
    // server snapshot. Whatever it emits is what every visitor is served.
    for (const [band, hour] of BAND_HOURS) {
      const markup = renderToStaticMarkup(
        createElement(TimeShelf, {
          likedTracks: moodTaste(),
          events: [],
          now: instantAtLocalHour(hour),
          languages: LANGUAGES,
        }),
      );
      expect(markup).toBe("");
      // Neither the band's id nor its label — the two forms a build-time band would
      // have shipped as.
      expect(markup).not.toContain(band);
      expect(markup).not.toContain(TIME_BAND_LABELS[band]);
      expect(markup).not.toContain("data-band");
    }
  });

  it("still renders a real band once hydrated, at every injected hour", () => {
    for (const [band, hour] of BAND_HOURS) {
      const rendered = renderShelf({ now: instantAtLocalHour(hour) });
      expect(screen.getByTestId("home-time-shelf")).toHaveAttribute("data-band", band);
      expect(screen.getByRole("heading", { name: TIME_BAND_LABELS[band] })).toBeInTheDocument();
      rendered.unmount();
    }
  });

  it("imports the one generator by name, so there is no second composition path", () => {
    // The property no DOM assertion can see. Two composition paths that disagree is
    // the bug design decision 1 exists to prevent.
    const source = readFileSync(
      join(frontendDir, "src", "features", "home", "TimeShelf.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /import\s*\{[^}]*\bgenerateMix\b[^}]*\}\s*from\s*["']@\/features\/mixes\/generateMix["']/,
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(code).not.toMatch(/\bfetchDiscoveryFeed\b/);
    expect(code).not.toMatch(/from\s*["'][^"']*discoveryApi["']/);
    // And the band's whole reach into a request is the profile's term list.
    expect(code).toContain("bandTasteProfile");
  });
});
