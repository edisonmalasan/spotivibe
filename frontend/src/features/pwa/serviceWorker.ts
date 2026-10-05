/**
 * Service worker registration and the update handshake (M13; spec `pwa` —
 * "Service worker update flow"; design decision 6).
 *
 * One module owns everything about the worker's lifecycle on the page side:
 * registering it, noticing a build that is waiting to take over, and telling the
 * shell about it. It is deliberately a *store* plus a thin controller rather than
 * a context: the shell reads the state, the notice renders it, and the reload
 * action calls one function.
 *
 * Three properties this module guarantees, because each is a way a PWA update can
 * go wrong in the field:
 *
 * 1. **Registration is optional.** A browser without service workers, a private
 *    window where registration throws, and a server that does not serve the worker
 *    file all have to be non-events: the app is a working local-first application
 *    without an offline shell.
 * 2. **A waiting worker is never activated behind the listener's back.** It is
 *    announced, and only an explicit action activates it - reloading a page
 *    mid-playback without warning is worse than being a version behind.
 * 3. **Activation is not the same as the page being current.** After the worker
 *    takes over, the page is reloaded so the new build's hashed assets are what
 *    actually render.
 *
 * `options.timeoutMs` exists for the same reason `attachSessionPersistence` takes a
 * `debounceMs`: the bound is part of the contract, and a test should be able to assert the
 * behavior without waiting five seconds for it.
 */
import { create } from "zustand";

/** Path the worker is served from (`public/sw.js`). */
export const SERVICE_WORKER_URL = "/sw.js";

/** The scope the worker controls: the whole origin. */
export const SERVICE_WORKER_SCOPE = "/";

/**
 * How long to wait for a registration before giving up on this page load.
 *
 * A missing or blocked `sw.js` must not hold the first paint hostage, and the
 * worker is an enhancement, so the module resolves either way. A slow network
 * (which is exactly when an offline shell matters) is the case this bounds.
 */
export const REGISTRATION_TIMEOUT_MS = 5000;

/** What the shell needs to know about the worker. */
export type ServiceWorkerStatus =
  /** No worker registered yet, or registration is unsupported/failed. */
  | "unsupported"
  /** A worker is registered and controlling or able to control this page. */
  | "ready"
  /** A newer build is installed and waiting for an explicit activation. */
  | "update-available"
  /** The listener dismissed the notice for this build. */
  | "dismissed";

export interface ServiceWorkerState {
  status: ServiceWorkerStatus;
  /** Epoch ms when the current status was reached. */
  changedAt: number;
  setStatus(status: ServiceWorkerStatus): void;
}

export const initialServiceWorkerState = {
  status: "unsupported" as ServiceWorkerStatus,
  changedAt: 0,
};

/** The newest attacher's token; older ones may no longer report. */
let latestAttachToken = 0;

export function resetServiceWorkerStore(): void {
  // A reset invalidates any attacher in flight, for the same reason a second
  // attach does: its outcome belongs to a page state that no longer exists.
  latestAttachToken += 1;
  useServiceWorkerStore.setState({ ...initialServiceWorkerState });
}

export const useServiceWorkerStore = create<ServiceWorkerState>((set) => ({
  ...initialServiceWorkerState,
  setStatus(status) {
    set({ status, changedAt: Date.now() });
  },
}));

/** Whether this environment can run a service worker at all. */
export function isServiceWorkerSupported(
  scope: { navigator?: { serviceWorker?: unknown } | null } = typeof window === "undefined"
    ? {}
    : window,
): boolean {
  return (
    typeof scope === "object" &&
    scope !== null &&
    "navigator" in scope &&
    typeof scope.navigator === "object" &&
    scope.navigator !== null &&
    "serviceWorker" in scope.navigator
  );
}

/**
 * The status a registration implies, and the transitions a registration makes.
 *
 * Pure, so the state machine is testable without a browser: a *waiting* worker
 * means an update is available, an *active* worker without a waiting one means the
 * current build is in control, and a registration that resolved but installed
 * nothing yet is still "ready" (the worker takes control on the next navigation,
 * or immediately after `clients.claim()`).
 */
export function statusForRegistration(registration: {
  waiting?: unknown;
  active?: unknown;
}): ServiceWorkerStatus {
  if (registration.waiting) return "update-available";
  if (registration.active) return "ready";
  return "ready";
}

/**
 * Register the worker and keep the store in step with it.
 *
 * Returns a detach function, like the other lifecycle attachers in this codebase
 * (`attachSessionPersistence`, `attachListeningRecorder`), so a caller can stop
 * observing without leaking listeners. Calling it twice is safe: the second call
 * is a no-op while the store already knows a worker is in charge.
 */
export function attachServiceWorker(options: { timeoutMs?: number } = {}): () => void {
  const timeoutMs = options.timeoutMs ?? REGISTRATION_TIMEOUT_MS;
  if (typeof window === "undefined") return () => {};
  if (!isServiceWorkerSupported()) {
    useServiceWorkerStore.getState().setStatus("unsupported");
    return () => {};
  }
  // Idempotency lives in the store, not on a property of this function: a hidden
  // function-property latch survives every reset and is exactly the kind of global
  // that makes a test order matter. A second attach while a worker is already known
  // to be controlling (or waiting) has nothing to add.
  const known = useServiceWorkerStore.getState().status;
  if (known === "ready" || known === "update-available") return () => {};

  let detached = false;
  // Every attach takes a token, and every status write checks it. A superseded
  // attacher - one whose registration never resolved, whose timer fires late, or
  // whose component unmounted - must not be able to report an outcome for a
  // worker the current attacher is tracking. Without this, a slow attacher can
  // overwrite "ready" with its own "unsupported" seconds later, which is exactly
  // the kind of bug that only shows up on a slow network.
  const token = ++latestAttachToken;
  const isCurrent = (): boolean => !detached && token === latestAttachToken;
  const store = useServiceWorkerStore.getState();

  /** Mirror a registration's state into the store, and watch for changes. */
  const observe = (registration: ServiceWorkerRegistration): void => {
    if (!isCurrent()) return;
    store.setStatus(statusForRegistration(registration));
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        // A worker that reaches "installed" while another one still controls the
        // page is an *update*, not a first install: that is the whole distinction.
        if (!isCurrent()) return;
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          store.setStatus("update-available");
        } else if (installing.state === "activated" || installing.state === "redundant") {
          store.setStatus("ready");
        }
      });
    });
  };

  const timer = setTimeout(() => {
    if (isCurrent()) store.setStatus("unsupported");
  }, timeoutMs);

  void navigator.serviceWorker
    // `updateViaCache: 'none'` is load-bearing, not a default worth restating.
    //
    // The worker is governed by the CSP served **with its script**, so a worker running
    // an older copy of `sw.js` is also running under an older policy. Measured in a
    // browser: after the M23 policy fix, a returning visitor's page kept failing to load
    // provider artwork while a first-time visitor on a clean origin loaded it correctly
    // from the very same server — the only difference being whether that origin had ever
    // registered a worker. The default (`'imports'`) lets the HTTP cache answer the
    // script request, so a corrected worker can sit unapplied indefinitely.
    //
    // The cost is one revalidation of `/sw.js` per update check rather than a possible
    // cache hit. For a worker whose correctness depends on the policy shipped alongside
    // it, that is the right trade.
    .register(SERVICE_WORKER_URL, {
      scope: SERVICE_WORKER_SCOPE,
      updateViaCache: "none",
    })
    .then((registration) => {
      clearTimeout(timer);
      if (!isCurrent()) return;
      observe(registration);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // Fires after `skipWaiting` + `clients.claim`; the reload below makes it
        // real, and this is what stops the notice lingering across the swap.
        if (isCurrent()) store.setStatus("ready");
      });
    })
    .catch((error: unknown) => {
      clearTimeout(timer);
      if (!isCurrent()) return;
      // A blocked or missing worker is an enhancement failure, not an app failure.
      console.warn("[pwa] service worker registration skipped:", error);
      store.setStatus("unsupported");
    });

  return () => {
    detached = true;
    clearTimeout(timer);
  };
}

/** Mark an update as noticed and not worth showing again for this build. */
export function dismissServiceWorkerUpdate(): void {
  useServiceWorkerStore.getState().setStatus("dismissed");
}

/**
 * Activate the waiting worker and reload into it.
 *
 * The message is what the worker waits for; the reload is what makes the new
 * build's assets render. A worker that never answers (an old registration, a
 * message that is lost) still gets the reload, because a stuck notice is worse
 * than a reload - and a reload with no new worker is a no-op that keeps the
 * current build.
 */
export function activateServiceWorkerUpdate(): void {
  // Checked against the real window scope, because that is where support lives;
  // `navigator.serviceWorker` is the container, not the scope.
  if (!isServiceWorkerSupported()) return;
  navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" });
  window.location.reload();
}
