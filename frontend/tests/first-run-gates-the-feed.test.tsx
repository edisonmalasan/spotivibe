import "fake-indexeddb/auto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/page";
import { getLocalData, type RepositorySet } from "@/data/localData";
import type { ListeningEventRecord, Track } from "@/data/repositories";
import { HomeView } from "@/features/home/HomeView";
import { HOME_SECTIONS } from "@/features/home/homeSections";
import { ARTIST_ONBOARDING_LABEL } from "@/features/onboarding/ArtistOnboarding";
import { clearOnboardingSeen, markOnboardingSeen } from "@/features/onboarding/onboardingGate";
import { resetHistoryStore, useHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore, useLibraryStore } from "@/stores/libraryStore";
import { resetMixStore, useMixStore } from "@/stores/mixStore";
import { resetPreferencesStore, usePreferencesStore } from "@/stores/preferencesStore";
import { resetQuickPickPicksStore } from "@/stores/quickPickPicksStore";
import { readTreeStrict } from "./helpers/sourceTree";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * M36 — the first run presents one thing (spec: `home-mixes` — "First run asks
 * for artists, not languages"; design decisions D1–D4).
 *
 * The requirement the milestone implements is old and was never true of the
 * code: *"the discovery feed SHALL NOT be presented until onboarding is
 * completed or dismissed."* The feed was rendered beside the surface, so the
 * first run was a question laid over a dashboard — the exact defect M28's own
 * proposal named when it replaced the language dialog with the artist picker.
 *
 * Four properties, each a scenario in the delta:
 *
 * 1. **No part of the feed is in the document** while the first-run surface is
 *    up. Not hidden, not behind the surface — *absent*, so "not presented" is a
 *    statement about the DOM rather than about a z-index.
 * 2. **The feed is presented** once the surface completes or is dismissed.
 * 3. **The first-run surface still offers real artists** while the feed is
 *    gated, because the artists are derived rather than rendered — gating what
 *    is presented withholds what is rendered, not what is known.
 * 4. **A surface opened on demand does not gate the feed**, because a listener
 *    revising their picks from the rail is revising the feed behind them.
 *
 * And the fifth property, which is the shape of the defect rather than of the
 * feature: **the two capabilities must not contradict each other about what
 * first run is.** The `discovery` capability still said first run was a
 * language choice — a claim the code stopped making in M28 — and this file
 * reads the specifications to keep the two in agreement.
 */

// The feed's cards navigate, and the surface's cards do not.
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

configure({ asyncUtilTimeout: 5000 });

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");

/** A track credited to an artist the rail can derive. */
function credited(id: string, title: string, artist: string): Track {
  return makeTrack({ id: `youtube:${id}`, providerId: id, title, artists: [{ name: artist }] });
}

/** A listening event, in the shape the history store holds it. */
function event(id: string, title: string, artist: string): ListeningEventRecord {
  return {
    id: `event-${id}`,
    trackId: `youtube:${id}`,
    track: credited(id, title, artist),
    playedAt: 1_000,
    secondsPlayed: 0,
    context: "home",
  };
}

/** Stub the discovery endpoint, per feed kind. */
function stubDiscovery(
  reply: (kind: string | null) => { tracks: Track[] } = () => ({ tracks: [] }),
) {
  const calls: Array<{ kind: string | null }> = [];
  const mock = vi.fn((input: RequestInfo | URL) => {
    const kind = new URL(String(input), "http://localhost").searchParams.get("kind");
    calls.push({ kind });
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ tracks: reply(kind).tracks, diagnostics: {} }),
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

/** The feed's own parts, by the test ids they render under. */
const FEED_TEST_IDS = [
  // The filter bar: the group and each of its three controls.
  "home-filter",
  "home-filter-all",
  "home-filter-music",
  "home-filter-podcasts",
  // The artist rail.
  "home-quick-picks",
  // The mix cards.
  "home-mix-cards",
  // The time-aware shelf.
  "home-time-shelf",
] as const;

let repositories: RepositorySet;

beforeEach(async () => {
  resetHistoryStore();
  resetLibraryStore();
  resetMixStore();
  resetPreferencesStore();
  resetQuickPickPicksStore();
  clearOnboardingSeen();
  repositories = await getLocalData();
  await repositories.resetAll();

  /*
   * A **returning** device, seeded directly into the stores.
   *
   * The mix-card row is gated on local signal, so a fresh device would not
   * render it at all — and the claim under test is that *every* part of the
   * feed is gated, which a device that never had one of the parts cannot
   * demonstrate. The stores are injected rather than hydrated so the suite
   * never opens IndexedDB for the feed's own input.
   */
  useHistoryStore.setState({
    events: [event("h1", "Played", "Aurora")],
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  useLibraryStore.setState({
    likedTracks: [credited("l1", "Liked", "Aurora")],
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  usePreferencesStore.setState({
    languages: ["en"],
    hydrated: true,
    hydrate: () => Promise.resolve(),
  });
  useMixStore.setState({ mixes: [], hydrate: () => Promise.resolve() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the first run presents one thing", () => {
  it("puts no part of the feed in the document while the surface is up", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomeView />);

    const dialog = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    expect(dialog).toBeInTheDocument();

    // The five parts of the feed, by their own test ids. Absent, not hidden.
    for (const id of FEED_TEST_IDS) {
      expect(screen.queryByTestId(id), id).not.toBeInTheDocument();
    }
    // And every section, whether or not the local signals enabled it — so the
    // claim is about the feed's *rows* rather than about the ones this device
    // happened to qualify for.
    expect(document.querySelectorAll('[data-testid^="home-section-"]')).toHaveLength(0);
    for (const section of HOME_SECTIONS) {
      expect(
        screen.queryByTestId(`home-section-${section.id}`),
        section.id,
      ).not.toBeInTheDocument();
    }
  });

  it("keeps the shell around the feed", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomePage />);

    // The route's own heading and container are outside `HomeView`, and the
    // feed's container is inside it — so the shell survives the gate.
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.getByTestId("home-view")).toBeInTheDocument();
    await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    expect(screen.queryByTestId("home-quick-picks")).not.toBeInTheDocument();
  });

  it("still offers real artists while the feed is gated", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomeView />);

    const dialog = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    // The provider's own artist is offered, by name…
    expect(await within(dialog).findByRole("button", { name: /Aurora/ })).toBeInTheDocument();
    // …while the feed that would have shown it is not in the document at all.
    expect(screen.queryByTestId("home-quick-picks")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-mix-cards")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-time-shelf")).not.toBeInTheDocument();
  });

  it("still issues the feed's provider requests while the feed is gated", async () => {
    // The shelves are hooks in `HomeView`'s body, and hooks run whether or not
    // their output is rendered. The requirement is about what is **presented**,
    // not what is **fetched** — and the fetch is what lets the surface offer the
    // provider's artists with their artwork.
    const calls = stubDiscovery(() => ({ tracks: [] }));
    render(<HomeView />);

    await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    await waitFor(() => {
      expect([...new Set(calls.map((call) => call.kind ?? "?"))].sort()).toEqual([
        "collection",
        "for-you",
        "podcast",
        "trending",
      ]);
    });
  });

  it("presents the feed once the surface is dismissed", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomeView />);

    const dialog = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    // The surface only offers a dismissal once it has settled, so the artist
    // grid is the precondition for the dismissal.
    await within(dialog).findByRole("button", { name: "Start listening" });
    expect(screen.queryByTestId("home-quick-picks")).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: ARTIST_ONBOARDING_LABEL }),
      ).not.toBeInTheDocument(),
    );

    // The gate is what the first run held, and not a permanent state.
    expect(await screen.findByTestId("home-quick-picks")).toBeInTheDocument();
    for (const id of FEED_TEST_IDS) {
      expect(screen.queryByTestId(id), id).toBeInTheDocument();
    }
  });

  it("presents the feed once the surface is completed", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomeView />);

    const dialog = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    fireEvent.click(await within(dialog).findByRole("button", { name: /Aurora/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Start listening" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: ARTIST_ONBOARDING_LABEL }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByTestId("home-quick-picks")).toBeInTheDocument();
  });
});

describe("a surface opened on demand does not gate the feed", () => {
  it("keeps the feed behind the picker", async () => {
    // A listener who has already answered opens the picker from the rail. The
    // feed is what they are revising, so it stays presented behind them.
    markOnboardingSeen();
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    render(<HomeView />);

    const rail = await screen.findByTestId("home-quick-picks");
    expect(rail).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("quick-picks-pick-action"));
    const picker = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    expect(picker).toBeInTheDocument();

    // The feed is still there — behind the surface, and still in the document.
    for (const id of FEED_TEST_IDS) {
      expect(screen.queryByTestId(id), id).toBeInTheDocument();
    }
    expect(document.querySelectorAll('[data-testid^="home-section-"]').length).toBeGreaterThan(0);
  });
});

/**
 * The two capabilities must agree about what first run is.
 *
 * `discovery` said first run was a *language* choice — a claim the code has
 * not made since M28 replaced the language dialog with the artist picker, and
 * a claim that contradicted `home-mixes` outright. Two capabilities asserting
 * opposite things about first run is not a documentation blemish: it is a
 * specification an implementer can read and build the wrong thing from.
 *
 * **The effective capability is computed rather than read raw.** The sync that
 * applies this change's delta is a later stage of the change's lifecycle, so
 * the main spec still carries the stale requirement until then. Asserting
 * against the main spec alone would assert a state that is false now and true
 * later — a test that fails at Apply and passes at Sync, which is a broken
 * test rather than a guard. So the effective spec is computed: the stale
 * requirement's block is dropped and the delta's added block is put in its
 * place, which is what the sync does. The assertion therefore holds in both
 * stages, and fails in either if the delta stops saying the right thing.
 */
const STALE_TITLE = "Language catalog and first-run onboarding";
const REPLACEMENT_TITLE = "Language catalog and language preference";

/**
 * This change's own delta for `discovery`, whether the change is active or
 * archived.
 *
 * `openspec archive` moves the directory, and a suite whose path is pinned to
 * one location stops running when it moves — the failure this repository has
 * already been bitten by. The archive is searched through the repository's
 * race-tolerant tree reader rather than a bare directory listing, so a file
 * that vanishes mid-read is reported instead of thrown.
 */
function readDelta(): string | null {
  const slug = "first-run-gates-the-feed";
  const active = join(REPO, "openspec", "changes", slug);
  if (existsSync(active)) {
    const path = join(active, "specs", "discovery", "spec.md");
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }
  const archiveRoot = join(REPO, "openspec", "changes", "archive");
  if (!existsSync(archiveRoot)) return null;
  const needle = `${slug}${sep}specs${sep}discovery${sep}spec.md`;
  const found = readTreeStrict(archiveRoot, { extensions: [".md"] }).find((file) =>
    file.file.endsWith(needle),
  );
  return found?.source ?? null;
}

/** The main `discovery` capability, and this change's delta for it. */
function readDiscoverySpecs(): { main: string; delta: string | null } {
  const main = readFileSync(join(REPO, "openspec", "specs", "discovery", "spec.md"), "utf8");
  return { main, delta: readDelta() };
}

/**
 * The delta, read once.
 *
 * `null` once the change has been archived and its delta applied to the main
 * spec — which is when the main spec becomes the guard and the delta has
 * nothing left to say. The cases that read it are then **skipped and reported
 * as skips**, never as passes.
 */
const DELTA = readDelta();

/** The `discovery` capability as it will read once the delta is synced. */
function effectiveDiscoverySpec(main: string, delta: string | null): string {
  // Already synced: the main spec is the capability, whole.
  if (!main.includes(`### Requirement: ${STALE_TITLE}`)) return main;
  // Not yet synced: the pending delta is what removes it, so the effective
  // capability is the main spec with that requirement's block dropped and the
  // delta's added block put in its place — which is what the sync does.
  if (delta === null) {
    throw new Error(
      "the discovery capability still carries the stale first-run requirement, and this change's " +
        "delta cannot be found — so the two capabilities are contradicting each other and nothing " +
        "in the tree says how the contradiction is resolved",
    );
  }
  const start = main.indexOf(`### Requirement: ${STALE_TITLE}`);
  const rest = main.slice(start + 1);
  const next = rest.search(/\n### Requirement: /);
  const withoutStale = main.slice(0, start) + (next === -1 ? "" : rest.slice(next));
  const added = delta.slice(delta.indexOf("## ADDED Requirements"));
  return `${withoutStale}\n${added}\n`;
}

describe("the discovery capability and the home-mixes capability agree about the first run", () => {
  it("removes the stale first-run requirement and replaces it with the language preference", () => {
    const { main, delta } = readDiscoverySpecs();
    const effective = effectiveDiscoverySpec(main, delta);

    // The requirement that claimed first run was a language choice is gone…
    expect(effective).not.toContain(`### Requirement: ${STALE_TITLE}`);
    expect(effective).not.toContain("SHALL be offered language selection on first run");
    // …and the one that says what is true is in its place.
    expect(effective).toContain(`### Requirement: ${REPLACEMENT_TITLE}`);
  });

  it("leaves the main capability free of the contradiction once the change has been synced", () => {
    const { main, delta } = readDiscoverySpecs();

    /*
     * **The stage is read from the main spec, not from the delta's presence.**
     *
     * The effective-capability computation above is right for a suite that must be
     * green at Apply and green after the Sync: before the Sync the main spec still
     * carries the stale requirement and the pending delta is what removes it, and
     * after the Sync the main spec *is* the capability.
     *
     * But that computation **re-derives** the answer from the delta, so it would
     * happily pass with a main spec that still carried the contradiction — the
     * delta is found whether the change is active or archived, so it is never
     * absent to absorb it. A guard that cannot fail against the very thing it
     * guards is not a guard.
     *
     * So the main spec's own state is asserted directly, and the stage decides
     * which way round it is checked:
     *
     *   - **before the Sync** the main spec is *expected* to still carry the stale
     *     requirement, and the delta is what says how it goes away. That is the
     *     pre-sync guard, and the delta must exist for it to be resolvable.
     *   - **after the Sync** the main spec carries the replacement, and it SHALL
     *     NOT also carry the stale requirement. That is the permanent guard.
     */
    const synced = main.includes(`### Requirement: ${REPLACEMENT_TITLE}`);

    if (synced) {
      expect(
        main.includes(`### Requirement: ${STALE_TITLE}`),
        "the main capability carries the replacement requirement and the stale one as well, so " +
          "the two capabilities still contradict each other",
      ).toBe(false);
      expect(main).not.toContain("SHALL be offered language selection on first run");
    } else {
      expect(
        delta,
        "the main capability still carries the stale first-run requirement and this change's " +
          "delta cannot be found, so nothing in the tree says how the contradiction is resolved",
      ).not.toBeNull();
    }
  });

  it.skipIf(DELTA === null)("declares the removal with a reason and a migration", () => {
    const removed = DELTA!.slice(
      DELTA!.indexOf("## REMOVED Requirements"),
      DELTA!.indexOf("## ADDED Requirements"),
    );
    expect(removed).toContain(`### Requirement: ${STALE_TITLE}`);
    expect(removed).toContain("**Reason**");
    expect(removed).toContain("**Migration**");
  });

  it.skipIf(DELTA === null)(
    "states the catalog and the preference, and points at home-mixes for the first run",
    () => {
      const added = DELTA!.slice(DELTA!.indexOf("## ADDED Requirements"));
      // The catalog and the preference — the requirement's true half.
      expect(added).toContain("at least 37 selectable languages");
      expect(added).toContain("#### Scenario: The language preference persists");
      // The two scenarios of the removed requirement that are still true.
      expect(added).toContain("#### Scenario: Languages are changeable later");
      expect(added).toContain("#### Scenario: Catalog stays broad");
      // And the first run is *pointed at*, not restated: duplication is what
      // produced the contradiction in the first place.
      expect(added).toContain("First run SHALL NOT offer language selection");
      expect(added).toContain("home-mixes");
    },
  );

  it("leaves the first run specified in one place only", () => {
    const { main } = readDiscoverySpecs();
    const homeMixes = readFileSync(
      join(REPO, "openspec", "specs", "home-mixes", "spec.md"),
      "utf8",
    );
    // `home-mixes` states the first run…
    expect(homeMixes).toContain("### Requirement: First run asks for artists, not languages");
    // …and `discovery`, once this change is synced, states no first run of its
    // own — which is what stops the two capabilities coming to disagree again.
    expect(main).not.toContain("### Requirement: First run asks for artists, not languages");
  });
});

/**
 * The gate is keyed on the first run, and not on "is the surface open".
 *
 * The two cases share a component, so the distinction cannot be read off the
 * component alone: it has to be asserted from the outside, in both directions.
 */
describe("the gate is keyed on the first run, not on the surface being open", () => {
  it("holds the feed on the first run and releases it on the second", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));

    // First run: the surface is up and the feed is not in the document.
    const first = render(<HomeView />);
    await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    expect(screen.queryByTestId("home-quick-picks")).not.toBeInTheDocument();
    first.unmount();

    // The same device, after the first run has been answered.
    act(() => {
      markOnboardingSeen();
    });
    render(<HomeView />);
    expect(await screen.findByTestId("home-quick-picks")).toBeInTheDocument();
    // And no first-run surface comes back for a listener who has answered it.
    expect(screen.queryByRole("dialog", { name: ARTIST_ONBOARDING_LABEL })).not.toBeInTheDocument();
  });
});
