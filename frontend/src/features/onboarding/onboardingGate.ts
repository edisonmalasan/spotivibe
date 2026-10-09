/**
 * The first-run gate.
 *
 * A tiny `localStorage` flag, and deliberately not IndexedDB: the decision
 * "should the onboarding surface be on screen?" must be answerable **before the
 * repositories open**. A gate read from IndexedDB resolves a tick or two after
 * first paint, so the dialog would appear and then vanish — worse than having no
 * onboarding at all. `installPrompt.ts` records the same reasoning for the same
 * reason.
 *
 * What is *not* here is the picked artists. Those are user data, and they live
 * in IndexedDB so they survive a cache clear and travel through the backup
 * envelope. This flag only answers "has this been seen", which is exactly the
 * kind of tiny boot-time preference `AGENTS.md` scopes `localStorage` to.
 */

/** The namespaced key the first-run gate is remembered under. */
export const ONBOARDING_SEEN_KEY = "spotivibe:quick-picks-onboarding-seen";

/*
 * Same-tab subscribers.
 *
 * These exist because the `storage` event does **not** fire in the tab that
 * performed the write — only in the others. An earlier version of this file
 * assumed a `useSyncExternalStore` consumer would pick a same-tab write up "on the
 * next render". That assumption was wrong: `useSyncExternalStore` re-reads its
 * snapshot when a subscriber fires and on no other occasion, so the dialog stayed
 * open after dismissal. The HomeView onboarding test is what caught it.
 */
const sameTabSubscribers = new Set<() => void>();

function notifySameTab(): void {
  for (const subscriber of sameTabSubscribers) {
    subscriber();
  }
}

function readFlag(key: string): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(key) === "1";
  } catch {
    // A locked-down or full context can throw on access. Unreadable is the same
    // as "not seen", so the affordance reappears rather than the listener being
    // locked out of it forever.
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* best effort: a failed write only costs a repeat first-run surface */
  }
  // Notified outside the `try`: a subscriber that throws must not be swallowed by
  // the catch above, which exists for storage failures only.
  notifySameTab();
}

/** Whether the listener has already completed or dismissed first-run onboarding. */
export function isOnboardingSeen(): boolean {
  return readFlag(ONBOARDING_SEEN_KEY);
}

/**
 * Record that first run is over.
 *
 * Called for a dismissal with nothing selected as well as a confirmation: the
 * alternative is a dialog that returns on every visit to a listener who has
 * already answered it, which is nagging rather than onboarding.
 */
export function markOnboardingSeen(): void {
  writeFlag(ONBOARDING_SEEN_KEY, true);
}

/** Clear the gate. Exists for "Reset Spotivibe data" and for tests. */
export function clearOnboardingSeen(): void {
  writeFlag(ONBOARDING_SEEN_KEY, false);
}

/**
 * Subscribe to writes in this tab *and* in others.
 *
 * Both halves are needed. The `storage` event covers other tabs (onboarding
 * completed in one, revisited in another). The same-tab set covers the write this
 * tab just made, which `storage` deliberately does not report.
 */
export function subscribeToOnboarding(onChange: () => void): () => void {
  sameTabSubscribers.add(onChange);
  if (typeof window === "undefined") {
    return () => {
      sameTabSubscribers.delete(onChange);
    };
  }
  window.addEventListener("storage", onChange);
  return () => {
    sameTabSubscribers.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The snapshot the server renders.
 *
 * `true` — no dialog in server HTML. There is no `localStorage` there, so the
 * honest server answer is "do not show a modal the server cannot know about".
 * The client reads the real flag on hydration, and because this differs the two
 * snapshots must be supplied explicitly: without the third argument React would
 * reuse the server value and the dialog would never appear for a new listener.
 */
export function getOnboardingServerSnapshot(): boolean {
  return true;
}
