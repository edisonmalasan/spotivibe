import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalData } from "@/data/localData";
import type { Track } from "@/data/repositories";
import { MixCards, MIX_CARDS_TITLE } from "@/features/home/mixes/MixCards";
import { MAX_MIX_CARD_SEEDS } from "@/features/home/mixes/namedMixes";
import { generateMix } from "@/features/mixes/generateMix";
import { makeTrack } from "./helpers/music-fixtures";
import { resetHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetMixStore, useMixStore } from "@/stores/mixStore";
import { resetPlayerStore, usePlayerStore } from "@/stores/playerStore";
import { resetQueueStore, useQueueStore } from "@/stores/queueStore";

/**
 * M17 tasks 2.2, 2.4, 2.5, and the card half of 6.3 (spec: `home-mixes` — "Mix
 * cards start playback and name honestly", scenarios "Cards use the one
 * generator, not their own", "Cards are not composed on render", "An empty mix is
 * explained rather than silently inert"; `discovery` — "Mix cards start playback
 * rather than navigating away", "One failing shelf does not break the feed";
 * design decisions 1 and 2).
 *
 * The generator is **spied rather than replaced**: `vi.mock` wraps the real
 * `generateMix`, so every assertion about what the card does is also an assertion
 * about the real composition path — a card that composed through a private
 * composer would pass a test that stubbed the shared one, and would fail these.
 *
 * The clock is injected, so nothing here reads the wall clock and the mix's own
 * generation period is deterministic.
 */

// Only the generator is wrapped; the rest of the module is the real one.
vi.mock("@/features/mixes/generateMix", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/mixes/generateMix")>();
  return { ...actual, generateMix: vi.fn(actual.generateMix) };
});

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
}));

const NOW = new Date(2026, 9, 2, 9, 0, 0, 0).getTime();
const CLOCK = (): number => NOW;

// Keep the literal in a variable — Vite rewrites an inline `new URL("<literal>")`.
const srcRel = "..";
const frontendDir = fileURLToPath(new URL(srcRel, import.meta.url));

/** Every module that sits beside the mix cards, read as source. */
function homeMixModules(): Array<{ file: string; source: string }> {
  const dir = join(frontendDir, "src", "features", "home", "mixes");
  return readdirSync(dir)
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => {
      const file = join(dir, name);
      return { file, source: readFileSync(file, "utf8") };
    });
}

/**
 * Whether a module reaches the mix feed's transport itself.
 *
 * A card-specific composer would have to do exactly this — that is the only thing
 * that builds a mix — so naming the transport beside the cards *is* the second
 * generation path, whether or not it is called one. Comments are stripped first,
 * so a module that explains the rule cannot trip it.
 */
function reachesMixFeed(source: string): boolean {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return (
    /\bfetchDiscoveryFeed\b/.test(code) ||
    /from\s*["'][^"']*discoveryApi["']/.test(code) ||
    /["'`]\/api\/discover/.test(code)
  );
}

function feedTrack(index: number, artist: string, artwork?: string): Track {
  return makeTrack({
    id: `youtube:mix${index}`,
    providerId: `mix${index}`,
    title: `Mix Song ${index}`,
    artists: [{ name: artist }],
    ...(artwork === undefined ? {} : { artwork: [{ url: artwork }] }),
  });
}

/** A local artist with real signal, so the cards have seeds to select. */
function liked(id: string, title: string, artist: string): Track {
  return makeTrack({
    id: `youtube:${id}`,
    providerId: id,
    title,
    artists: [{ name: artist }],
  });
}

/** Four distinct covers, so the composed mix gets a collage. */
const FEED_TRACKS = Array.from({ length: 4 }, (_unused, index) =>
  feedTrack(index, `Mix Artist ${index}`, `https://example.test/cover${index}.jpg`),
);

/** Stub the discovery endpoint; `fail` answers every feed with a 503. */
function stubDiscovery(tracks: Track[] = FEED_TRACKS, fail = false) {
  const calls: string[] = [];
  const mock = vi.fn((input: RequestInfo | URL) => {
    calls.push(String(input));
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

/** Click one card, by identity. */
function pressCard(identity: string) {
  const card = screen
    .getAllByTestId("mix-card")
    .find((entry) => entry.getAttribute("data-mix-id") === identity);
  if (card === undefined) throw new Error(`no card with identity ${identity}`);
  fireEvent.click(card);
  return card;
}

function renderCards(): void {
  render(
    <MixCards
      likedTracks={[
        liked("l1", "Deep Funk Cut", "Aurora"),
        liked("l2", "Modern Soul Cut", "Beacon"),
        liked("l3", "Ambient Drift", "Cobalt"),
      ]}
      events={[]}
      languages={["en"]}
      clock={CLOCK}
    />,
  );
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

describe("MixCards: cards are not composed on render", () => {
  it("issues no provider request and composes no mix while rendering the row", async () => {
    const { calls } = stubDiscovery();
    renderCards();

    const shelf = await screen.findByTestId("home-mix-cards");
    expect(within(shelf).getAllByTestId("mix-card").length).toBeGreaterThan(0);
    // Rendering must spend nothing: no feed request, no generator call, no stored
    // mix, and no playback.
    expect(calls).toEqual([]);
    expect(generator).not.toHaveBeenCalled();
    expect(useMixStore.getState().mixes).toEqual([]);
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
  });

  it("offers no card at all for a device with no local taste", () => {
    // Stronger than explaining an empty mix: with no signal there is nothing any
    // strategy could honestly build from, so no card is offered.
    render(<MixCards likedTracks={[]} events={[]} languages={["en"]} clock={CLOCK} />);
    expect(screen.queryByTestId("home-mix-cards")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("mix-card")).toHaveLength(0);
  });

  it("keeps the composed set empty until a card is pressed", async () => {
    renderCards();
    await screen.findByTestId("home-mix-cards");
    expect(await (await getLocalData()).mixes.list()).toEqual([]);
  });
});

describe("MixCards: a card activates through the one generator", () => {
  it("calls the shared generator on activation and composes through it", async () => {
    const { calls } = stubDiscovery();
    renderCards();
    await screen.findByTestId("home-mix-cards");

    pressCard("top");

    await waitFor(() => expect(generator).toHaveBeenCalledTimes(1));
    // The call went through with the shared generator's own input shape: the card's
    // seed strategy as a profile, the listener's languages, and a supplied instant.
    const request = generator.mock.calls[0][0];
    expect(request.languages).toEqual(["en"]);
    expect(request.now).toBe(NOW);
    expect(request.profile.seedTerms.length).toBeGreaterThan(0);
    expect(request.profile.seedTerms.length).toBeLessThanOrEqual(MAX_MIX_CARD_SEEDS);
    expect(request.profile.hasSignal).toBe(true);

    // And the mix really was built and stored, not merely returned.
    await waitFor(async () => {
      expect(await (await getLocalData()).mixes.list()).toHaveLength(1);
    });
    expect(calls.every((url) => url.includes("kind=mix"))).toBe(true);
  });

  it("scopes a language card to its own language", async () => {
    render(
      <MixCards
        likedTracks={[liked("l1", "Deep Funk Cut", "Aurora")]}
        events={[]}
        languages={["en", "es"]}
        clock={CLOCK}
      />,
    );
    await screen.findByTestId("home-mix-cards");

    pressCard("language:es");

    await waitFor(() => expect(generator).toHaveBeenCalledTimes(1));
    expect(generator.mock.calls[0][0].languages).toEqual(["es"]);
  });

  it("imports no alternative generator", () => {
    // The property that cannot be observed through the DOM: that there is only one
    // composition path. Two paths that disagree is the user-visible bug design
    // decision 1 exists to prevent, so it is stated as two structural rules.
    //
    // Rule one: the card names the shared generator by name, so a rename of the
    // generator breaks this file rather than silently leaving it unbound.
    const card = readFileSync(
      join(frontendDir, "src", "features", "home", "mixes", "MixCards.tsx"),
      "utf8",
    );
    expect(card).toMatch(
      /import\s*\{[^}]*\bgenerateMix\b[^}]*\}\s*from\s*["']@\/features\/mixes\/generateMix["']/,
    );

    // Rule two, and the one that catches the realistic mistake: a card-owned
    // composer would have to reach the mix feed itself, because that is the only
    // thing that builds a mix. So no module beside the card may name the transport.
    const offenders = homeMixModules().filter((entry) => reachesMixFeed(entry.source));
    expect(
      offenders.map((entry) => entry.file),
      "the mix feed is reachable only through generateMix",
    ).toEqual([]);
  });

  it("confirms the alternative-generator detector can fail", () => {
    // A card-owned composer: its own fetch of the mix feed.
    const rogue = [
      'import { fetchDiscoveryFeed } from "@/features/home/discoveryApi";',
      "export async function generateCardMix() {",
      '  return fetchDiscoveryFeed({ kind: "mix", languages: ["en"] });',
      "}",
    ].join("\n");
    expect(reachesMixFeed(rogue)).toBe(true);

    // The real modules must not trip it, or the rule would be reporting noise.
    expect(homeMixModules().map((entry) => reachesMixFeed(entry.source))).toEqual(
      homeMixModules().map(() => false),
    );
  });
});

describe("MixCards: a card starts playback rather than navigating", () => {
  it("plays the composed mix with the browse source and stays put", async () => {
    const push = vi.fn();
    const navigation = await import("next/navigation");
    vi.spyOn(navigation, "useRouter").mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
    } as unknown as ReturnType<typeof navigation.useRouter>);

    renderCards();
    await screen.findByTestId("home-mix-cards");

    pressCard("top");

    await waitFor(() => expect(usePlayerStore.getState().currentTrack).not.toBeNull());
    // The mix is the queue, so it plays through.
    const queue = useQueueStore.getState().queue;
    expect(queue.map((track) => track.id)).toEqual(FEED_TRACKS.map((track) => track.id));
    expect(usePlayerStore.getState().currentTrack?.id).toBe(queue[0]?.id);
    // Home is a browse surface: the queue source is the one every shelf records.
    expect(useQueueStore.getState().source).toBe("browse");
    // And activating a card never navigates — the listener stays on Home.
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("home-mix-cards")).toBeInTheDocument();
  });

  it("lists the mix it just built on this very page", async () => {
    renderCards();
    await screen.findByTestId("home-mix-cards");
    expect(useMixStore.getState().mixes).toHaveLength(0);

    pressCard("top");

    // The store's cache is updated so the Smart Mixes shelf does not need a reload.
    await waitFor(() => expect(useMixStore.getState().mixes).toHaveLength(1));
    expect(useMixStore.getState().mixes[0]?.tracks).toHaveLength(FEED_TRACKS.length);
  });

  it("derives the card's cover from the mix it composed", async () => {
    renderCards();
    await screen.findByTestId("home-mix-cards");
    // Nothing composed yet, so nothing to show: the monochrome placeholder.
    expect(screen.getAllByTestId("mix-card-cover-placeholder")).toHaveLength(
      screen.getAllByTestId("mix-card").length,
    );

    pressCard("top");

    await waitFor(() => expect(screen.getByTestId("mix-card-cover-collage")).toBeInTheDocument());
    const collage = screen.getByTestId("mix-card-cover-collage");
    expect(collage.querySelectorAll("img")).toHaveLength(4);
  });
});

describe("MixCards: an empty mix is explained rather than silently inert", () => {
  it("explains an empty feed, starts nothing, and leaves the card usable", async () => {
    stubDiscovery([], false);
    renderCards();
    await screen.findByTestId("home-mix-cards");

    pressCard("top");

    await waitFor(() => expect(screen.getByTestId("mix-card-notice")).toBeInTheDocument());
    expect(screen.getByTestId("mix-card-notice").textContent).toBe(
      "The feed had nothing for this mix right now.",
    );
    // Nothing started: not playback, not a stored mix, no queue.
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    expect(useQueueStore.getState().queue).toHaveLength(0);
    expect(useMixStore.getState().mixes).toEqual([]);
    // And the card is not inert — it is pressable again.
    const card = screen
      .getAllByTestId("mix-card")
      .find((entry) => entry.getAttribute("data-mix-id") === "top");
    expect(card).not.toBeDisabled();
  });

  it("explains a provider failure in the generator's own words", async () => {
    stubDiscovery([], true);
    renderCards();
    await screen.findByTestId("home-mix-cards");

    pressCard("top");

    await waitFor(() => expect(screen.getByTestId("mix-card-notice")).toBeInTheDocument());
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });

  it("leaves every sibling card working when one fails", async () => {
    // The first request this card makes fails; everything after it answers. Keying
    // the failure on the *request* rather than on the seeds keeps the case honest
    // about what it is: one failed composition, not a particular card's seeds.
    let failing = true;
    const mock = vi.fn(() => {
      if (failing) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ error: { code: "upstream_unavailable" } }),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ tracks: FEED_TRACKS, diagnostics: {} }),
      } as unknown as Response);
    });
    vi.stubGlobal("fetch", mock);

    renderCards();
    await screen.findByTestId("home-mix-cards");
    const cardsBefore = screen.getAllByTestId("mix-card");
    expect(cardsBefore.length).toBeGreaterThan(1);

    // One card fails…
    pressCard("top");
    await waitFor(() => expect(screen.getByTestId("mix-card-notice")).toBeInTheDocument());
    expect(usePlayerStore.getState().currentTrack).toBeNull();
    // …and the row itself is intact: every sibling is still rendered and enabled.
    expect(screen.getAllByTestId("mix-card")).toHaveLength(cardsBefore.length);
    for (const card of screen.getAllByTestId("mix-card")) expect(card).not.toBeDisabled();

    // A sibling still composes and plays.
    failing = false;
    await act(async () => {
      pressCard("discovery");
    });
    await waitFor(() => expect(usePlayerStore.getState().currentTrack).not.toBeNull());
    expect(useQueueStore.getState().source).toBe("browse");
    // And the failure stays explained on the card that hit it.
    expect(screen.getAllByTestId("mix-card-notice")).toHaveLength(1);
  });
});

describe("MixCards: the row follows the presented filter", () => {
  it("is not presented under Podcasts, and is under the other two", () => {
    const props = {
      likedTracks: [liked("l1", "Deep Funk Cut", "Aurora")],
      events: [],
      languages: ["en"],
      clock: CLOCK,
    };
    const podcasts = render(<MixCards {...props} filter="podcasts" />);
    expect(screen.queryByTestId("home-mix-cards")).not.toBeInTheDocument();
    podcasts.unmount();

    for (const filter of ["all", "music"] as const) {
      const rendered = render(<MixCards {...props} filter={filter} />);
      expect(screen.getByTestId("home-mix-cards")).toBeInTheDocument();
      rendered.unmount();
    }
  });

  it("names the row for what activating it does", () => {
    renderCards();
    expect(screen.getByRole("heading", { name: MIX_CARDS_TITLE })).toBeInTheDocument();
    // No ranking or editorial claim anywhere in the row.
    expect(document.body.textContent).not.toMatch(/chart|ranking|best|editor|spotify|youtube/i);
  });
});
