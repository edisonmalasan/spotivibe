/**
 * The install affordance (M13; spec `pwa` — "Install affordance"; design
 * decision 5).
 *
 * A PWA's install prompt is a one-shot platform event, and the two easy ways to
 * get this wrong are both about nagging: a banner on every visit, or a Settings row
 * that never appears because the module waited for an event that only fires once
 * per browser. So the module keeps three facts and nothing else:
 *
 * - whether the platform has **offered** installation (`beforeinstallprompt`);
 * - whether the listener has **dismissed** the affordance;
 * - whether the application is **installed** (`appinstalled`).
 *
 * Where no programmatic prompt exists — iOS Safari, and Firefox's desktop build —
 * the affordance cannot offer a button that would do nothing, so it explains the
 * platform's own home-screen step instead. That is a real difference between
 * platforms, stated rather than hidden.
 *
 * The dismissal lives in `localStorage` under a namespaced key, deliberately: it
 * must be readable before the IndexedDB repositories open (the affordance must not
 * need a database round trip to decide whether to nag), and it is not listening
 * data, so it does not belong in a whitelisted dataset or the backup envelope
 * (AGENTS.md: `localStorage` for tiny boot-time preferences).
 */

/** The namespaced key the dismissal is remembered under. */
export const INSTALL_DISMISSAL_KEY = "spotivibe:install-dismissed";

/** The namespaced key recording a completed installation. */
export const INSTALL_COMPLETED_KEY = "spotivibe:installed";

/** The platform's minimum shape, so the module is testable without a browser. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readFlag(key: string): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(key) === "1";
  } catch {
    // Storage can throw in a locked-down context; an unreadable flag is the same
    // as no flag, and the affordance may reappear rather than nag forever.
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* best effort: a failed write only costs a repeat affordance */
  }
}

/** Whether the affordance was dismissed by the listener. */
export function isInstallDismissed(): boolean {
  return readFlag(INSTALL_DISMISSAL_KEY);
}

/** Whether the application is already installed. */
export function isInstallCompleted(): boolean {
  return readFlag(INSTALL_COMPLETED_KEY);
}

/** Remember a dismissal, so the affordance does not come back on its own. */
export function dismissInstall(): void {
  writeFlag(INSTALL_DISMISSAL_KEY, true);
}

/**
 * The four states the affordance can be in, and the only one that offers a
 * button. Pure, so the mapping from platform facts to what the listener sees is
 * testable without a browser.
 */
export type InstallAffordance = "install" | "instructions" | "hidden" | "installed";

export function installAffordance(facts: {
  /** The platform fired `beforeinstallprompt` at least once. */
  offered: boolean;
  dismissed: boolean;
  completed: boolean;
  /** The platform is one where installation is a manual, documented gesture. */
  manualOnly: boolean;
}): InstallAffordance {
  if (facts.completed) return "installed";
  if (facts.dismissed) return "hidden";
  if (facts.offered) return "install";
  // No programmatic prompt. On a platform that has a home-screen installation
  // gesture, the honest affordance is the instruction; where nothing is known,
  // there is nothing to offer.
  return facts.manualOnly ? "instructions" : "hidden";
}

/**
 * Whether this platform installs only through a manual gesture.
 *
 * iOS Safari is the case that matters: it has no `beforeinstallprompt` at all, and
 * its only path is Share → Add to Home Screen. Everything else is either unknown
 * (so the affordance stays hidden) or has a programmatic prompt.
 */
export function isManualInstallPlatform(userAgent: string): boolean {
  return (
    /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && "ontouchend" in window)
  );
}

/** The observer handle, so a caller can stop listening. */
export interface InstallObserver {
  /** Ask the platform to install, when it offered to. Resolves to the outcome. */
  install(): Promise<"accepted" | "dismissed" | "unavailable">;
  /** The state a render should show right now. */
  state(): InstallAffordance;
  /**
   * Subscribe to state changes: `beforeinstallprompt` and `appinstalled` are
   * window events, and a component must re-render when they arrive rather than
   * poll for them. Polling would need a `setState` inside an effect, which is the
   * cascading-render smell this codebase's lint rule exists to prevent.
   */
  subscribe(listener: () => void): () => void;
  /** Forget the captured prompt (after an install, or when a test resets). */
  release(): void;
}

/**
 * Observe installability. Returns a handle, and never throws: an environment
 * without the events simply reports `hidden`.
 */
export function observeInstallability(
  options: { userAgent?: string; dismissed?: boolean; completed?: boolean } = {},
): InstallObserver {
  const userAgent =
    options.userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent);
  const manualOnly = typeof window === "undefined" ? false : isManualInstallPlatform(userAgent);

  let offered = false;
  let dismissed = options.dismissed ?? isInstallDismissed();
  let completed = options.completed ?? isInstallCompleted();
  let prompt: InstallPromptEvent | null = null;
  const listeners = new Set<() => void>();

  const state = (): InstallAffordance =>
    installAffordance({ offered, dismissed, completed, manualOnly });
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (event) => {
      // Suppressing the browser's own mini-infobar is what makes the app's
      // affordance the only one: two prompts for one app is the nagging this
      // milestone is supposed to avoid.
      event.preventDefault();
      prompt = event as InstallPromptEvent;
      offered = true;
      notify();
    });
    window.addEventListener("appinstalled", () => {
      completed = true;
      writeFlag(INSTALL_COMPLETED_KEY, true);
      prompt = null;
      notify();
    });
  }

  return {
    async install() {
      if (prompt === null) return "unavailable" as const;
      const deferred = prompt;
      // The event is single-use by specification, and holding it after a
      // dismissed prompt is how an affordance ends up offering a dead button.
      prompt = null;
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice?.outcome === "dismissed") {
        dismissed = true;
        writeFlag(INSTALL_DISMISSAL_KEY, true);
      } else {
        // An accepted prompt means the platform installed the app, and the
        // affordance must not offer to install what is already installed. The
        // `appinstalled` event records the same fact when it arrives; setting it
        // here as well is what makes the row disappear at the moment the listener
        // accepted, rather than a moment later, and it covers a platform that
        // never fires the event.
        completed = true;
        writeFlag(INSTALL_COMPLETED_KEY, true);
      }
      notify();
      return choice?.outcome ?? "dismissed";
    },
    state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    release() {
      prompt = null;
      offered = false;
      listeners.clear();
    },
  };
}
