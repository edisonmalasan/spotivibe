import "fake-indexeddb/auto";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
import { getLocalData, type RepositorySet } from "@/data/localData";
import type { Track } from "@/data/repositories";
import { HomeView } from "@/features/home/HomeView";
import {
  ARTIST_ONBOARDING_LABEL,
  ARTIST_ONBOARDING_PENDING_TIMEOUT_MS,
} from "@/features/onboarding/ArtistOnboarding";
import {
  clearOnboardingSeen,
  isOnboardingSeen,
  markOnboardingSeen,
} from "@/features/onboarding/onboardingGate";
import { resetHistoryStore } from "@/stores/historyStore";
import { resetLibraryStore } from "@/stores/libraryStore";
import { resetMixStore } from "@/stores/mixStore";
import { resetPreferencesStore } from "@/stores/preferencesStore";
import { resetQuickPickPicksStore, useQuickPickPicksStore } from "@/stores/quickPickPicksStore";
import { makeTrack } from "./helpers/music-fixtures";

/**
 * The artist picks re-entry (spec: `home-mixes` — "First run asks for artists,
 * not languages"; design decisions D1–D7).
 *
 * Five properties, each stated as a scenario in the spec delta:
 *
 * 1. A listener who dismissed the first run can still choose artists, and the
 *    choice persists and feeds the rail.
 * 2. The artist selection is changeable later, as the language selection
 *    already is.
 * 3. The first-run surface does not report "no artists" and does not offer a
 *    dismissal before the rail has settled.
 * 4. The settled-with-no-artists case says so and points at a place that
 *    exists.
 * 5. Resetting local data clears the gate, and Home asks again.
 *
 * Plus the two the design requires and the delta implies: the `pending` state
 * is time-bounded, and the empty rail leads somewhere.
 */

// The dialog links to Settings, and the feed's cards navigate.
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

let repositories: RepositorySet;

/**
 * The real `load`, kept so a case that stubs it can put it back.
 *
 * `resetQuickPickPicksStore` resets the *state*, not the action, so a stubbed
 * `load` would otherwise outlive the case that installed it.
 */
const realLoad = useQuickPickPicksStore.getState().load;

/** A track credited to an artist the rail can derive. */
function credited(id: string, title: string, artist: string): Track {
  return makeTrack({ id: `youtube:${id}`, providerId: id, title, artists: [{ name: artist }] });
}

/** Stub the discovery endpoint: `hang` never settles. */
function stubDiscovery(reply: (kind: string | null) => { tracks: Track[] } | { hang: true }) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const kind = new URL(String(input), "http://localhost").searchParams.get("kind");
    const outcome = reply(kind);
    if ("hang" in outcome) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ tracks: outcome.tracks, diagnostics: {} }),
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** The artists the rail currently offers, in rail order. */
function railTargets(): string[] {
  return screen
    .getAllByTestId("quick-pick")
    .map((card) => card.getAttribute("data-quick-pick-target") ?? "");
}

/** Wait until the rail has settled and holds something (or has decided it holds nothing). */
async function waitForRail(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryAllByTestId("shelf-skeleton")).toHaveLength(0);
  });
}

/**
 * Wait until the Data controls have opened the local-data connection.
 *
 * The cleanup buttons are disabled until they have, so a click before this
 * point is a click on a disabled control — which is a test that passes or fails
 * on timing rather than on behaviour.
 */
async function waitForDataControls(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Reset Spotivibe data" })).toBeEnabled();
  });
}

beforeEach(async () => {
  resetHistoryStore();
  resetLibraryStore();
  resetMixStore();
  resetPreferencesStore();
  resetQuickPickPicksStore();
  useQuickPickPicksStore.setState({ load: realLoad });
  clearOnboardingSeen();
  repositories = await getLocalData();
  await repositories.resetAll();
});

afterEach(() => {
  // Restored before anything else: a test that leaves the fake clock installed
  // stalls every later test's IndexedDB round-trip, and the failure looks like
  // an unrelated timeout.
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a listener who dismissed the first run can still choose artists", () => {
  it("offers the same artists in Settings, stores the choice, and feeds the rail", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));

    // First run: the listener sees the picker and dismisses it without choosing.
    const home = render(<HomeView />);
    const dialog = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    await within(dialog).findByRole("button", { name: /Aurora/ });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: ARTIST_ONBOARDING_LABEL }),
      ).not.toBeInTheDocument(),
    );
    expect(isOnboardingSeen()).toBe(true);
    home.unmount();

    // Settings carries the same selection, and the same artists.
    const settings = render(<SettingsPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Artists" })).toBeInTheDocument();
    expect(screen.getByTestId("artists-summary")).toHaveTextContent(/no artists picked/i);

    fireEvent.click(screen.getByRole("button", { name: "Choose artists" }));
    const picker = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    await within(picker).findByRole("button", { name: /Aurora/ });

    // The very same artist the Home rail offered: one derivation, two surfaces.
    expect(within(picker).getByRole("button", { name: /Aurora/ })).toBeInTheDocument();

    fireEvent.click(within(picker).getByRole("button", { name: /Aurora/ }));
    fireEvent.click(within(picker).getByRole("button", { name: "Start listening" }));

    // Stored, not just rendered.
    await waitFor(async () => {
      const stored = await repositories.quickPickPicks.list();
      expect(stored.map((record) => record.name)).toEqual(["Aurora"]);
    });
    await waitFor(() =>
      expect(screen.getByTestId("artists-summary")).toHaveTextContent(/Picked: Aurora/),
    );
    settings.unmount();

    // And it survives a reload: the summary reads the stored selection again.
    render(<SettingsPage />);
    expect(await screen.findByTestId("artists-summary")).toHaveTextContent(/Picked: Aurora/);
  });

  it("feeds the Quick Picks rail with the artist chosen in Settings", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));

    // A first run that was answered and dismissed.
    markOnboardingSeen();

    const settings = render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose artists" }));
    const picker = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    await within(picker).findByRole("button", { name: /Aurora/ });
    fireEvent.click(within(picker).getByRole("button", { name: /Aurora/ }));
    fireEvent.click(within(picker).getByRole("button", { name: "Start listening" }));
    await waitFor(async () => {
      expect(await repositories.quickPickPicks.list()).toHaveLength(1);
    });
    settings.unmount();

    // The rail leads with the pick.
    render(<HomeView />);
    await waitForRail();
    expect(railTargets()[0]).toBe("Aurora");
  });
});

describe("the artist selection is changeable later", () => {
  it("replaces the stored selection, and the new one is the one that survives", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));

    // Choose Aurora first.
    const settings = render(<SettingsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose artists" }));
    let picker = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    await within(picker).findByRole("button", { name: /Aurora/ });
    fireEvent.click(within(picker).getByRole("button", { name: /Aurora/ }));
    fireEvent.click(within(picker).getByRole("button", { name: "Start listening" }));
    await waitFor(async () => {
      expect((await repositories.quickPickPicks.list()).map((record) => record.name)).toEqual([
        "Aurora",
      ]);
    });

    // Then change it: the picker reopens and the selection is replaced, not added to.
    fireEvent.click(screen.getByRole("button", { name: "Choose artists" }));
    picker = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    await within(picker).findByRole("button", { name: /Aurora/ });
    fireEvent.click(within(picker).getByRole("button", { name: /Aurora/ }));
    fireEvent.click(within(picker).getByRole("button", { name: "Start listening" }));
    await waitFor(async () => {
      expect((await repositories.quickPickPicks.list()).map((record) => record.name)).toEqual([
        "Aurora",
      ]);
    });
    settings.unmount();

    // The stored selection is the one that is read back.
    render(<SettingsPage />);
    expect(await screen.findByTestId("artists-summary")).toHaveTextContent(/Picked: Aurora/);
  });

  it("does not re-present the first-run surface once it has been answered", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    markOnboardingSeen();

    render(<HomeView />);
    await waitForRail();

    expect(screen.queryByRole("dialog", { name: ARTIST_ONBOARDING_LABEL })).not.toBeInTheDocument();
  });
});

describe("the first-run surface before the rail has settled", () => {
  it("reports no artists and offers no dismissal while the rail is still in flight", async () => {
    stubDiscovery(() => ({ hang: true }));
    clearOnboardingSeen();

    render(<HomeView />);
    const dialog = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });

    // Not "there are no artists" — the rail has not been asked.
    expect(within(dialog).queryByText(/couldn't find any artists/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("artist-onboarding-empty")).not.toBeInTheDocument();
    // And no dismissal control of any kind.
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("artist-onboarding-pending")).toBeInTheDocument();
  });

  it("does not settle while the local stores are still hydrating", async () => {
    /*
     * The provider has resolved, so the rail can already name an artist — but
     * the local stores have not been read yet. A rail that settled against
     * empty stores would report "no artists" for a device that has liked
     * tracks it has not read yet: the same defect one level down.
     */
    useQuickPickPicksStore.setState({
      picks: [],
      hydrated: false,
      load: () => new Promise<void>(() => {}),
    });
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    clearOnboardingSeen();

    render(<HomeView />);
    const dialog = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });

    // The rail knows an artist…
    await waitFor(() => {
      expect(screen.getAllByTestId("quick-pick").length).toBeGreaterThan(0);
    });
    // …and the surface does not yet, because the rail has not decided.
    expect(within(dialog).queryByRole("button", { name: /Aurora/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId("artist-onboarding-empty")).not.toBeInTheDocument();
    expect(within(dialog).getByTestId("artist-onboarding-pending")).toBeInTheDocument();
  });

  it("cannot strand the listener: the pending state is time-bounded", async () => {
    /*
     * Only the timeout functions are faked. Faking `setImmediate` as well would
     * stall `fake-indexeddb`, whose callbacks are scheduled through it, and the
     * stall would look like an unrelated timeout rather than a test failure.
     */
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubDiscovery(() => ({ hang: true }));
    clearOnboardingSeen();

    render(<HomeView />);
    // The gate is read during render, so the surface is in the document on the
    // first committed paint — no waiting needed, and none possible with a
    // faked clock.
    const dialog = screen.getByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ARTIST_ONBOARDING_PENDING_TIMEOUT_MS);
    });
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});

describe("the settled-with-no-artists case", () => {
  it("says so, and points at a place that exists", async () => {
    stubDiscovery(() => ({ tracks: [] }));
    clearOnboardingSeen();

    render(<HomeView />);
    const dialog = await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL });

    await waitFor(() =>
      expect(within(dialog).getByTestId("artist-onboarding-empty")).toBeInTheDocument(),
    );
    expect(within(dialog).getByTestId("artist-onboarding-empty")).toHaveTextContent(
      /couldn't find any artists/i,
    );
    // The place it names is a real route…
    expect(within(dialog).getByRole("link", { name: "Open Settings" }).getAttribute("href")).toBe(
      "/settings",
    );
    // …and the route carries the section that lets a listener choose artists.
    render(<SettingsPage />);
    expect(await screen.findByRole("heading", { level: 2, name: "Artists" })).toBeInTheDocument();
  });

  it("offers the empty rail a way to choose artists", async () => {
    stubDiscovery(() => ({ tracks: [] }));
    markOnboardingSeen();

    render(<HomeView />);
    await waitForRail();

    // The empty rail is not a dead end.
    const action = await screen.findByTestId("quick-picks-empty-action");
    fireEvent.click(action);
    expect(
      await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL }),
    ).toBeInTheDocument();
  });
});

describe("resetting local data clears the first-run gate", () => {
  it("clears the gate, and the next visit to Home asks again", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    markOnboardingSeen();
    expect(isOnboardingSeen()).toBe(true);

    render(<SettingsPage />);
    await waitForDataControls();
    fireEvent.click(screen.getByRole("button", { name: "Reset Spotivibe data" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Reset everything" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Spotivibe data reset."),
    );

    // The gate is gone, so the next visit to Home asks again.
    expect(isOnboardingSeen()).toBe(false);
  });

  it("asks again on Home after the reset", async () => {
    stubDiscovery(() => ({ tracks: [credited("a", "Alpha", "Aurora")] }));
    markOnboardingSeen();

    const settings = render(<SettingsPage />);
    await waitForDataControls();
    fireEvent.click(screen.getByRole("button", { name: "Reset Spotivibe data" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Reset everything" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Spotivibe data reset."),
    );
    settings.unmount();

    render(<HomeView />);
    expect(
      await screen.findByRole("dialog", { name: ARTIST_ONBOARDING_LABEL }),
    ).toBeInTheDocument();
  });
});
