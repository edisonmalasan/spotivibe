import { create } from "zustand";

/**
 * `networkStore` (ROADMAP M6, design §7): the app's connectivity signal —
 * `online` / `degraded` / `offline` plus the timestamp of the last change.
 * Components (`ConnectionBanner`) and stores (`playerStore` suppression and
 * reconnect recovery) read it; `initNetworkMonitor()` is the single writer.
 *
 * Layering: components → networkStore; `playerStore` → networkStore for the
 * offline branch. No side effects run at module import (bundler purity).
 */

export type ConnectionState = "online" | "degraded" | "offline";

/** The Network Information API subset this store derives from (not in TS dom lib). */
export interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
}

export interface NetworkState {
  connection: ConnectionState;
  /** Epoch ms of the last connection change (0 until the first change). */
  lastChangedAt: number;
  setConnection(connection: ConnectionState): void;
}

export const initialNetworkState = {
  connection: "online" as ConnectionState,
  lastChangedAt: 0,
};

/** Reset network data — test isolation and hot-reload hygiene. */
export function resetNetworkStore(): void {
  useNetworkStore.setState({ ...initialNetworkState });
}

/** `effectiveType` values that mean "degraded" (design §7). */
const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g"]);

/**
 * Derivation with explicit priority (design §7): offline beats degraded beats
 * online. Without the Network Information API only `online`/`offline` are ever
 * produced — degradation is never fabricated.
 */
export function deriveConnection(
  online: boolean,
  information?: NetworkInformationLike | null,
): ConnectionState {
  if (!online) return "offline";
  if (
    information &&
    (information.saveData === true || SLOW_EFFECTIVE_TYPES.has(information.effectiveType ?? ""))
  ) {
    return "degraded";
  }
  return "online";
}

/** `navigator.connection` where the browser exposes it (absent in Safari/jsdom). */
export function readNetworkInformation(): NetworkInformationLike | null {
  if (typeof navigator === "undefined") return null;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection ?? null;
}

export const useNetworkStore = create<NetworkState>()((set) => ({
  ...initialNetworkState,

  setConnection(connection) {
    set({ connection, lastChangedAt: Date.now() });
  },
}));

let monitorTeardown: (() => void) | null = null;

/** Whether the monitor currently owns its window/navigator listeners. */
export function isNetworkMonitorActive(): boolean {
  return monitorTeardown !== null;
}

/**
 * Start the connectivity monitor (design §7): idempotent, once per page
 * session — a second init adds no listeners and returns a no-op teardown so
 * the first caller keeps ownership of cleanup. Re-derives the connection on
 * window `online`/`offline` events and on the Network Information `change`
 * event when that API exists. Returns the teardown.
 */
export function initNetworkMonitor(): () => void {
  if (monitorTeardown) return () => {};

  const information = readNetworkInformation();
  const recompute = () => {
    const online = typeof navigator === "undefined" ? true : navigator.onLine;
    const connection = deriveConnection(online, information);
    if (useNetworkStore.getState().connection !== connection) {
      useNetworkStore.getState().setConnection(connection);
    }
  };

  window.addEventListener("online", recompute);
  window.addEventListener("offline", recompute);
  information?.addEventListener?.("change", recompute);
  recompute();

  monitorTeardown = () => {
    window.removeEventListener("online", recompute);
    window.removeEventListener("offline", recompute);
    information?.removeEventListener?.("change", recompute);
    monitorTeardown = null;
  };
  return monitorTeardown;
}
