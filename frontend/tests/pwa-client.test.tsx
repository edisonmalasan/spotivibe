import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallRow, UpdateNotice } from "@/features/pwa/UpdateNotice";
import {
  dismissInstall,
  INSTALL_DISMISSAL_KEY,
  installAffordance,
  isInstallCompleted,
  isInstallDismissed,
  isManualInstallPlatform,
  observeInstallability,
} from "@/features/pwa/installPrompt";
import {
  attachServiceWorker,
  isServiceWorkerSupported,
  REGISTRATION_TIMEOUT_MS,
  resetServiceWorkerStore,
  SERVICE_WORKER_SCOPE,
  SERVICE_WORKER_URL,
  statusForRegistration,
  useServiceWorkerStore,
} from "@/features/pwa/serviceWorker";
import { resetNetworkStore, useNetworkStore } from "@/stores/networkStore";
import { ConnectionBanner } from "@/components/layout/ConnectionBanner";

/**
 * M13 tasks 2.3, 4.1, 5.1, 5.2, 5.3: the client half of the PWA.
 *
 * Every module here is written to be inert where the platform cannot help — no
 * `navigator.serviceWorker`, no `beforeinstallprompt`, a locked-down `localStorage`
 * — because "works everywhere" is the difference between a PWA that installs and
 * one that breaks a page. The tests therefore check the *inert* paths as carefully
 * as the working ones.
 */

configure({ asyncUtilTimeout: 5000 });

/** A registration whose `waiting`/`active`/`installing` the test controls. */
function fakeRegistration(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, Array<() => void>>();
  return {
    waiting: null,
    active: {},
    installing: null,
    addEventListener(type: string, handler: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener() {},
    fire(type: string) {
      for (const handler of listeners.get(type) ?? []) handler();
    },
    listeners,
    ...overrides,
  } as unknown as ServiceWorkerRegistration & { fire(type: string): void };
}

/** Install a fake `navigator.serviceWorker` for the duration of a test. */
function stubServiceWorker(overrides: Partial<ServiceWorkerContainer> = {}) {
  const registration = fakeRegistration();
  const container = {
    controller: null,
    register: vi.fn(async () => registration),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...overrides,
  };
  Object.defineProperty(window.navigator, "serviceWorker", {
    value: container,
    configurable: true,
  });
  return { container, registration };
}

function removeServiceWorker() {
  Reflect.deleteProperty(window.navigator, "serviceWorker");
}

beforeEach(() => {
  resetServiceWorkerStore();
  resetNetworkStore();
  localStorage.clear();
});

afterEach(() => {
  removeServiceWorker();
  vi.restoreAllMocks();
});

describe("service worker support and registration (task 2.3)", () => {
  it("detects support, and says so when there is none", () => {
    removeServiceWorker();
    expect(isServiceWorkerSupported()).toBe(false);
    expect(isServiceWorkerSupported({ navigator: null })).toBe(false);
    expect(isServiceWorkerSupported({})).toBe(false);
    stubServiceWorker();
    expect(isServiceWorkerSupported()).toBe(true);
  });

  it("is a no-op where service workers are unsupported, and says so in the store", () => {
    removeServiceWorker();
    const detach = attachServiceWorker();
    expect(() => detach()).not.toThrow();
    // A browser without service workers is not an error state: the app is a
    // working local-first application without an offline shell.
    expect(useServiceWorkerStore.getState().status).toBe("unsupported");
  });

  it("registers the worker at the documented path and scope", async () => {
    const { container } = stubServiceWorker();
    const detach = attachServiceWorker();
    await waitFor(() => expect(container.register).toHaveBeenCalledTimes(1));
    // `updateViaCache: 'none'` is asserted rather than left to the implementation: the
    // worker inherits the CSP shipped with its script, so a worker served from the HTTP
    // cache also runs under a stale policy. Measured in a browser — a returning visitor
    // kept failing to load provider artwork after the M23 policy fix while a first-time
    // visitor on the same server loaded it correctly. The default lets the cache answer
    // the script request, so the correction can sit unapplied.
    expect(container.register).toHaveBeenCalledWith(SERVICE_WORKER_URL, {
      scope: SERVICE_WORKER_SCOPE,
      updateViaCache: "none",
    });
    await waitFor(() => expect(useServiceWorkerStore.getState().status).toBe("ready"));
    detach();
  });

  it("settles as unsupported when registration fails", async () => {
    stubServiceWorker({ register: vi.fn(async () => Promise.reject(new Error("blocked"))) });
    attachServiceWorker({ timeoutMs: 5 });
    // A blocked worker is an enhancement failure, not an app failure: the store says
    // so and the app carries on.
    await waitFor(() => expect(useServiceWorkerStore.getState().status).toBe("unsupported"));
  });

  it("does not let a registration that never settles hold the page", async () => {
    // The bound is what makes a missing worker an enhancement failure, so the test
    // drives it through the same seam the production default uses.
    stubServiceWorker({ register: vi.fn(() => new Promise(() => {})) as never });
    const detach = attachServiceWorker({ timeoutMs: 5 });
    expect(useServiceWorkerStore.getState().status).not.toBe("ready");
    await waitFor(() => expect(useServiceWorkerStore.getState().status).toBe("unsupported"));
    detach();
    // And the production default is a real bound, not a test-only number.
    expect(REGISTRATION_TIMEOUT_MS).toBeGreaterThan(1000);
  });

  it("does not let a superseded attacher report for the current one", async () => {
    // A slow attacher must not overwrite the live one's outcome: on a slow network
    // the first registration can still be pending when a second mount has already
    // learned that the worker is in charge.
    stubServiceWorker({ register: vi.fn(() => new Promise(() => {})) as never });
    attachServiceWorker({ timeoutMs: 5 });
    resetServiceWorkerStore();

    useServiceWorkerStore.getState().setStatus("ready");
    await new Promise((resolve) => setTimeout(resolve, 30));
    // The stale attacher's timer has fired by now; the status is still the live one.
    expect(useServiceWorkerStore.getState().status).toBe("ready");
  });
  it("maps a registration's state onto the shell's view of it", () => {
    expect(statusForRegistration({ waiting: {}, active: {} })).toBe("update-available");
    expect(statusForRegistration({ active: {} })).toBe("ready");
    // A registration that has installed nothing yet is still the current build:
    // the worker takes control on the next navigation or right after claim().
    expect(statusForRegistration({})).toBe("ready");
  });

  it("announces an update when a new worker installs behind an existing one", async () => {
    const installing = { state: "installing", addEventListener: vi.fn() };
    const { registration, container } = stubServiceWorker();
    (registration as unknown as { installing: unknown }).installing = installing;
    (container as unknown as { controller: unknown }).controller = {};

    attachServiceWorker({ timeoutMs: 5000 });
    await waitFor(() => expect(useServiceWorkerStore.getState().status).toBe("ready"));

    // The installing worker reaches "installed" while another one controls the
    // page: that is an update, not a first install.
    (installing as unknown as { state: string }).state = "installed";
    registration.fire("updatefound");
    const handler = (installing.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      (() => void) | undefined;
    handler?.();

    await waitFor(() => expect(useServiceWorkerStore.getState().status).toBe("update-available"));
  });
});

describe("the update notice (task 5.3)", () => {
  it("is absent until an update is waiting", () => {
    const { container } = render(<UpdateNotice />);
    expect(container.querySelector('[data-testid="update-notice"]')).toBeNull();

    useServiceWorkerStore.getState().setStatus("ready");
    render(<UpdateNotice />);
    expect(screen.queryByTestId("update-notice")).toBeNull();
  });

  it("announces a waiting update with a reload action, and stays clear of the player", async () => {
    useServiceWorkerStore.getState().setStatus("update-available");
    const { container } = render(<UpdateNotice />);

    const notice = await screen.findByTestId("update-notice");
    expect(notice).toHaveTextContent(/new version of Spotivibe is ready/i);
    expect(notice).toHaveAttribute("role", "status");
    // The notice is a top bar overlay, never a sheet over the player surface
    // (the same constraint the connection banner honors).
    expect(notice.className).not.toContain("bottom-0");
    // And on a compact viewport it sits below the connection banner's band rather
    // than in it: both are fixed overlays at the same stacking level, and three of
    // them in one 72px strip is how an honest status message ends up unreadable.
    expect(notice.className).toContain("top-32");
    expect(notice.className).toContain("lg:top-18");
    expect(container.textContent).toContain("Reload");
  });

  it("activates the waiting worker and reloads into it", async () => {
    const postMessage = vi.fn();
    stubServiceWorker({
      controller: { postMessage },
    } as unknown as Partial<ServiceWorkerContainer>);
    // jsdom does not implement navigation, so `reload` is replaced rather than
    // performed - the assertion is that the reload was requested, because that is
    // what makes the new build's assets the ones that render.
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      configurable: true,
      writable: true,
    });

    useServiceWorkerStore.getState().setStatus("update-available");
    render(<UpdateNotice />);
    fireEvent.click(await screen.findByTestId("update-reload"));

    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("announces a later update again after a dismissal", async () => {
    useServiceWorkerStore.getState().setStatus("update-available");
    const { unmount } = render(<UpdateNotice />);
    fireEvent.click(await screen.findByTestId("update-dismiss"));
    // The notice is gone, and the store records why, so a later update for the
    // same build is not announced while a different one still is.
    expect(useServiceWorkerStore.getState().status).toBe("dismissed");
    await waitFor(() => expect(screen.queryByTestId("update-notice")).toBeNull());
    unmount();

    useServiceWorkerStore.getState().setStatus("update-available");
    render(<UpdateNotice />);
    expect(await screen.findByTestId("update-notice")).toBeInTheDocument();
  });
  it("marks the update dismissed in the store, which is what the store test reads", async () => {
    useServiceWorkerStore.getState().setStatus("update-available");
    render(<UpdateNotice />);
    const dismiss = await screen.findByTestId("update-dismiss");
    fireEvent.click(dismiss);
    // The notice is gone (the click ran) and the store records why, so a later
    // update for the same build is not announced and a different one is.
    await waitFor(() => expect(screen.queryByTestId("update-notice")).toBeNull());
    expect(useServiceWorkerStore.getState().status).toBe("dismissed");
  });
});

describe("the install affordance (tasks 5.1, 5.2)", () => {
  it("maps platform facts onto the four states", () => {
    expect(
      installAffordance({ offered: true, dismissed: false, completed: false, manualOnly: false }),
    ).toBe("install");
    expect(
      installAffordance({ offered: true, dismissed: true, completed: false, manualOnly: false }),
    ).toBe("hidden");
    expect(
      installAffordance({ offered: false, dismissed: false, completed: true, manualOnly: false }),
    ).toBe("installed");
    // No programmatic prompt, but the platform has a manual gesture: explain it.
    expect(
      installAffordance({ offered: false, dismissed: false, completed: false, manualOnly: true }),
    ).toBe("instructions");
    // No prompt and no known gesture: nothing to offer.
    expect(
      installAffordance({ offered: false, dismissed: false, completed: false, manualOnly: false }),
    ).toBe("hidden");
  });

  it("recognizes the platforms whose only install path is manual", () => {
    expect(isManualInstallPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(
      true,
    );
    expect(isManualInstallPlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
    expect(isManualInstallPlatform("Mozilla/5.0 (Windows NT 10.0) Chrome/120")).toBe(false);
  });

  it("captures the platform's prompt, installs on request, and forgets it afterwards", async () => {
    const prompt = vi.fn(async () => undefined);
    const event = new Event("beforeinstallprompt") as Event & {
      prompt: typeof prompt;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    Object.defineProperty(event, "prompt", { value: prompt });
    Object.defineProperty(event, "userChoice", {
      value: Promise.resolve({ outcome: "accepted" as const }),
    });
    event.preventDefault = vi.fn();

    const observer = observeInstallability({ userAgent: "Chrome/120" });
    expect(observer.state()).toBe("hidden");
    window.dispatchEvent(event);
    // The app's own affordance suppresses the browser's mini-infobar: two prompts
    // for one app is the nagging this milestone exists to avoid.
    expect(event.preventDefault).toHaveBeenCalled();
    expect(observer.state()).toBe("install");

    expect(await observer.install()).toBe("shown");
    expect(prompt).toHaveBeenCalledTimes(1);
    // The event is single-use: a second request must not re-prompt a dead handle.
    expect(await observer.install()).toBe("unavailable");
    // Having asked, the affordance withdraws: the app does not re-ask on its own,
    // and `appinstalled` (not this call) is what records an actual installation.
    expect(observer.state()).toBe("hidden");
    await Promise.resolve();
    expect(isInstallCompleted()).toBe(false);
  });

  it("does not wait for a choice the platform may never report", async () => {
    // Headless Edge (and some embedded browsers) accept `prompt()` and never resolve
    // `userChoice`. A row that awaited it would sit on "installing" forever, so
    // `install()` resolves as soon as the prompt is up and the choice is recorded
    // only if it ever arrives.
    const event = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    Object.defineProperty(event, "prompt", { value: vi.fn(async () => undefined) });
    Object.defineProperty(event, "userChoice", { value: new Promise(() => {}) });
    event.preventDefault = vi.fn();

    const observer = observeInstallability({ userAgent: "Chrome/120" });
    window.dispatchEvent(event);
    expect(observer.state()).toBe("install");
    // Resolves rather than hanging: that is the whole point of the contract.
    expect(await observer.install()).toBe("shown");
    expect(observer.state()).toBe("hidden");
  });

  it("remembers a dismissal across mounts, and an installation", async () => {
    const declined = new Event("beforeinstallprompt") as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
    };
    Object.defineProperty(declined, "prompt", { value: vi.fn(async () => undefined) });
    Object.defineProperty(declined, "userChoice", {
      value: Promise.resolve({ outcome: "dismissed" as const }),
    });
    declined.preventDefault = vi.fn();

    const first = observeInstallability({ userAgent: "Chrome/120" });
    window.dispatchEvent(declined);
    expect(await first.install()).toBe("shown");
    // The dismissal is recorded when the platform reports it, not before.
    await waitFor(() => expect(isInstallDismissed()).toBe(true));
    expect(localStorage.getItem(INSTALL_DISMISSAL_KEY)).toBe("1");

    // A fresh observer - a later visit - must not resurrect the affordance.
    const second = observeInstallability({ userAgent: "Chrome/120" });
    expect(second.state()).toBe("hidden");

    // And a completed installation is remembered too.
    dismissInstall();
    window.dispatchEvent(new Event("appinstalled"));
    expect(isInstallCompleted()).toBe(true);
    expect(observeInstallability({ userAgent: "Chrome/120" }).state()).toBe("installed");
  });

  it("renders the row only where installation is offered, and explains the manual path", async () => {
    // Nothing offered and no manual gesture: the row is not rendered at all.
    const hidden = render(<InstallRow userAgent="Chrome/120" />);
    expect(hidden.container.querySelector('[data-testid="install-row"]')).toBeNull();
    expect(hidden.container.querySelector('[data-testid="install-instructions"]')).toBeNull();

    // iOS: no programmatic prompt, so instructions instead of a dead button.
    const ios = render(
      <InstallRow userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" />,
    );
    const instructions = await waitFor(() => {
      const node = ios.container.querySelector('[data-testid="install-instructions"]');
      if (!node) throw new Error("no instructions yet");
      return node;
    });
    expect(instructions).toHaveTextContent(/home screen/i);
    // The copy names what still needs a connection rather than implying the app
    // works the same offline.
    expect(instructions).toHaveTextContent(
      /library and history keep working without a connection/i,
    );
    expect(ios.container.querySelector('[data-testid="install-confirm"]')).toBeNull();
  });

  it("records a dismissal from the row itself, and does not offer again", async () => {
    // The app suppresses the browser's own prompt, so the platform dialog is not a
    // route to a recorded dismissal: the row's own control is. Without one, the
    // "a dismissed affordance does not come back on its own" requirement could only
    // be satisfied by a listener who first installed and then declined the browser's
    // dialog - which this app has deliberately hidden.
    const event = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void> };
    Object.defineProperty(event, "prompt", { value: vi.fn(async () => undefined) });
    event.preventDefault = vi.fn();

    const { container } = render(<InstallRow userAgent="Chrome/120" />);
    window.dispatchEvent(event);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="install-confirm"]')).not.toBeNull(),
    );
    fireEvent.click(container.querySelector('[data-testid="install-dismiss"]')!);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="install-confirm"]')).toBeNull(),
    );
    expect(isInstallDismissed()).toBe(true);

    // A later visit must not resurrect it, even if the platform offers again.
    const revisit = render(<InstallRow userAgent="Chrome/120" />);
    window.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(revisit.container.querySelector('[data-testid="install-confirm"]')).toBeNull();
  });

  it("offers the install button once the platform has offered, and withdraws it after asking", async () => {
    const prompt = vi.fn(async () => undefined);
    const event = new Event("beforeinstallprompt") as Event & { prompt: typeof prompt };
    Object.defineProperty(event, "prompt", { value: prompt });
    Object.defineProperty(event, "userChoice", {
      value: Promise.resolve({ outcome: "accepted" as const }),
    });
    event.preventDefault = vi.fn();

    const { container } = render(<InstallRow userAgent="Chrome/120" />);
    window.dispatchEvent(event);
    // The row re-reads the platform state on a microtask after mount, because
    // `beforeinstallprompt` can fire after the effect has run.
    await waitFor(() =>
      expect(container.querySelector('[data-testid="install-confirm"]')).not.toBeNull(),
    );
    fireEvent.click(container.querySelector('[data-testid="install-confirm"]')!);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="install-confirm"]')).toBeNull(),
    );
  });
});

describe("the offline message names what is unavailable (task 4.1)", () => {
  it("says search and playback need a connection, and what still works", () => {
    useNetworkStore.getState().setConnection("offline");
    render(<ConnectionBanner />);

    const banner = screen.getByTestId("connection-banner");
    expect(banner).toHaveAttribute("data-connection", "offline");
    expect(banner).toHaveTextContent(/search and playback need a connection/i);
    // The second half is what makes it useful rather than merely apologetic.
    expect(banner).toHaveTextContent(/library, playlists, and history still work/i);
    // The existing contracts are unchanged: a status region, on every route.
    expect(banner).toHaveAttribute("role", "status");
  });

  it("keeps the degraded copy distinct and never claims offline playback", () => {
    useNetworkStore.getState().setConnection("degraded");
    render(<ConnectionBanner />);
    const banner = screen.getByTestId("connection-banner");
    expect(banner).toHaveTextContent(/connection looks slow/i);
    expect(banner.textContent ?? "").not.toMatch(/offline playback|listen offline|works offline/i);
  });
});
