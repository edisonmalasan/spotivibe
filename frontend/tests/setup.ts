import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { resetNetworkStore } from "@/stores/networkStore";

// vitest globals are disabled, so Testing Library cannot self-register cleanup —
// without this, renders accumulate across tests within a file.
afterEach(cleanup);

// Connectivity is app-global state (window/navigator derived): reset it so a
// connection set in one test never leaks into another.
afterEach(() => {
  resetNetworkStore();
});
