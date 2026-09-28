import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveConnection,
  initNetworkMonitor,
  isNetworkMonitorActive,
  resetNetworkStore,
  useNetworkStore,
  type NetworkInformationLike,
} from "@/stores/networkStore";

/**
 * Network derivation and monitor coverage (M6 task 8.1, design §7): the
 * priority matrix (offline > degraded > online), event-driven transitions for
 * window and Network Information signals, the API-absent case, and idempotent
 * init (a second init adds no listeners and cannot detach the first).
 */

function setOnLine(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

/** Install a mutable `navigator.connection` stub with a controllable change event. */
function stubConnectionInformation(initial: Partial<NetworkInformationLike>): {
  information: NetworkInformationLike;
  emitChange: () => void;
} {
  let handler: (() => void) | null = null;
  const information: NetworkInformationLike = {
    ...initial,
    addEventListener: (type, listener) => {
      if (type === "change") handler = listener;
    },
    removeEventListener: (type, listener) => {
      if (type === "change" && handler === listener) handler = null;
    },
  };
  Object.defineProperty(window.navigator, "connection", {
    configurable: true,
    value: information,
  });
  return { information, emitChange: () => handler?.() };
}

let teardown: (() => void) | null = null;

afterEach(() => {
  teardown?.();
  teardown = null;
  // Drop the navigator stubs so later tests see the pristine environment.
  delete (window.navigator as unknown as Record<string, unknown>).connection;
  setOnLine(true);
});

beforeEach(() => {
  resetNetworkStore();
});

describe("connection derivation (design §7)", () => {
  it("never degrades or drops offline without the Network Information API", () => {
    expect(deriveConnection(true, null)).toBe("online");
    expect(deriveConnection(true, undefined)).toBe("online");
    expect(deriveConnection(false, null)).toBe("offline");
  });

  it("derives degraded from saveData or a slow effectiveType", () => {
    expect(deriveConnection(true, { saveData: true })).toBe("degraded");
    expect(deriveConnection(true, { effectiveType: "slow-2g" })).toBe("degraded");
    expect(deriveConnection(true, { effectiveType: "2g" })).toBe("degraded");
    expect(deriveConnection(true, { effectiveType: "3g" })).toBe("online");
    expect(deriveConnection(true, { effectiveType: "4g" })).toBe("online");
    expect(deriveConnection(true, {})).toBe("online");
  });

  it("gives offline priority over every degraded signal", () => {
    expect(deriveConnection(false, { saveData: true, effectiveType: "slow-2g" })).toBe("offline");
  });
});

describe("network store", () => {
  it("starts online with no change recorded and stamps transitions", () => {
    const initial = useNetworkStore.getState();
    expect(initial.connection).toBe("online");
    expect(initial.lastChangedAt).toBe(0);

    useNetworkStore.getState().setConnection("offline");
    const after = useNetworkStore.getState();
    expect(after.connection).toBe("offline");
    expect(after.lastChangedAt).toBeGreaterThan(0);
    expect(after.lastChangedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("network monitor (initNetworkMonitor)", () => {
  it("follows window online/offline events", () => {
    teardown = initNetworkMonitor();
    expect(useNetworkStore.getState().connection).toBe("online");

    setOnLine(false);
    window.dispatchEvent(new Event("offline"));
    expect(useNetworkStore.getState().connection).toBe("offline");
    expect(useNetworkStore.getState().lastChangedAt).toBeGreaterThan(0);

    setOnLine(true);
    window.dispatchEvent(new Event("online"));
    expect(useNetworkStore.getState().connection).toBe("online");
  });

  it("derives degraded and recovers through the Network Information change event", () => {
    const { information, emitChange } = stubConnectionInformation({ effectiveType: "2g" });
    teardown = initNetworkMonitor();
    expect(useNetworkStore.getState().connection).toBe("degraded");

    information.effectiveType = "4g";
    emitChange();
    expect(useNetworkStore.getState().connection).toBe("online");
  });

  it("never reports degraded when the API is absent", () => {
    teardown = initNetworkMonitor();
    setOnLine(true);
    window.dispatchEvent(new Event("online"));
    expect(useNetworkStore.getState().connection).toBe("online");
  });

  it("adds its listeners only once on a double init", () => {
    const addSpy = vi.spyOn(window, "addEventListener");

    teardown = initNetworkMonitor();
    const second = initNetworkMonitor(); // idempotent: no second listener set

    expect(isNetworkMonitorActive()).toBe(true);
    expect(addSpy.mock.calls.filter(([type]) => type === "online")).toHaveLength(1);
    expect(addSpy.mock.calls.filter(([type]) => type === "offline")).toHaveLength(1);
    addSpy.mockRestore();

    // The no-op teardown must not stop the first init's listeners.
    second();
    setOnLine(false);
    window.dispatchEvent(new Event("offline"));
    expect(useNetworkStore.getState().connection).toBe("offline");

    const first = teardown;
    teardown = null;
    first();
    expect(isNetworkMonitorActive()).toBe(false);
    setOnLine(true);
    window.dispatchEvent(new Event("online"));
    expect(useNetworkStore.getState().connection).toBe("offline"); // detached
  });
});
