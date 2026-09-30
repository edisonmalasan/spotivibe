"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/design-system/Button";
import { observeInstallability, type InstallAffordance } from "@/features/pwa/installPrompt";
import {
  activateServiceWorkerUpdate,
  dismissServiceWorkerUpdate,
  useServiceWorkerStore,
} from "@/features/pwa/serviceWorker";

/**
 * The update notice (M13; spec `pwa` — "Service worker update flow").
 *
 * A new build is waiting to take over, so this says so and offers the one action
 * that makes it real. It is a notice rather than a reload because a reload without
 * warning discards in-progress playback and anything half-typed, and this app's
 * listener is often mid-episode. It is dismissible because a listener who is not
 * ready still gets the next update announced — the dismissal is for this build.
 *
 * Mounted by the AppShell so it is present on every route: an update that only
 * announced itself on the page you happened to be on would be an announcement most
 * people never see.
 */
export function UpdateNotice() {
  const status = useServiceWorkerStore((state) => state.status);
  // Derived, not mirrored: a local `visible` flag was a second source of truth
  // that could disagree with the status it copies, and it needed an effect to
  // stay in step. The store is the single answer; dismissal is a status.
  if (status !== "update-available") return null;

  return (
    <div
      role="status"
      data-testid="update-notice"
      className="fixed left-1/2 top-18 z-40 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-cards bg-graphite px-4 py-3 shadow-lg"
    >
      <span className="text-body font-regular text-pure-white">
        A new version of Spotivibe is ready.
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          className="px-3 py-1 text-body"
          data-testid="update-dismiss"
          onClick={() => {
            dismissServiceWorkerUpdate();
          }}
        >
          Later
        </Button>
        <Button
          className="px-4 py-1 text-body"
          data-testid="update-reload"
          onClick={() => {
            activateServiceWorkerUpdate();
          }}
        >
          Reload
        </Button>
      </span>
    </div>
  );
}

/**
 * The install affordance, rendered for a route that has room for it (M13).
 *
 * Settings uses this rather than a shell-level banner: an install prompt the
 * listener cannot find is a prompt they dismiss, and one that reappears on every
 * visit is a prompt they learn to ignore. Here it is a row in the place people
 * already go to change settings, and it says what the platform will do.
 */
export function InstallRow({ userAgent }: { userAgent?: string }) {
  const [busy, setBusy] = useState(false);

  // One observer per user agent, created lazily, and read through
  // `useSyncExternalStore` so the row re-renders when `beforeinstallprompt` (or
  // `appinstalled`) actually arrives. The earlier version polled the observer from
  // an effect on a `setTimeout(0)`, which is both a cascading render and a race
  // with an event that may fire later than a macrotask.
  const observer = useMemo(
    () => observeInstallability(userAgent === undefined ? undefined : { userAgent }),
    [userAgent],
  );
  const subscribe = useCallback((listener: () => void) => observer.subscribe(listener), [observer]);
  const affordance: InstallAffordance = useSyncExternalStore(
    subscribe,
    observer.state,
    observer.state,
  );

  if (affordance === "hidden" || affordance === "installed") return null;

  if (affordance === "instructions") {
    return (
      <div
        data-testid="install-instructions"
        className="flex flex-col gap-1 rounded-cards bg-carbon p-4"
      >
        <span className="text-body-lg font-bold text-pure-white">Install Spotivibe</span>
        <span className="text-body text-mist">
          On this device, add Spotivibe to your home screen from the browser&apos;s share menu —
          your library and history keep working without a connection.
        </span>
      </div>
    );
  }

  return (
    <div data-testid="install-row" className="flex items-center justify-between gap-3">
      <span className="flex flex-col">
        <span className="text-body-lg font-bold text-pure-white">Install Spotivibe</span>
        <span className="text-body text-mist">
          Open it like an app. Playback and search still need a connection.
        </span>
      </span>
      <Button
        className="shrink-0 px-4 py-2 text-body"
        disabled={busy}
        data-testid="install-confirm"
        onClick={async () => {
          setBusy(true);
          await observer.install();
          setBusy(false);
        }}
      >
        Install
      </Button>
    </div>
  );
}
