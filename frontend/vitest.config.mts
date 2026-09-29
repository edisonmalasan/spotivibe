import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // The suite runs ~120 files across parallel workers, and the heaviest React
    // files (route shells, the Settings surface, the search views) render real
    // trees against jsdom. At the 5s default they intermittently timed out on a
    // loaded machine — each run failing a *different* handful of files — which
    // made the gate flaky rather than strict. A hung test still fails, just a
    // little later; no assertion is weakened by this.
    testTimeout: 20_000,
  },
});
