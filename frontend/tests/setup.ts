import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// vitest globals are disabled, so Testing Library cannot self-register cleanup —
// without this, renders accumulate across tests within a file.
afterEach(cleanup);
