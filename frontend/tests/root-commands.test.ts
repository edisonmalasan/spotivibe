import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The root manifest, held to what it is for (spec `release-validation` — "The application is
 * reachable from the repository root").
 *
 * `package.json` exists at the repository root so that `npm run dev` starts the application
 * without a `cd frontend` first. The application package is still where it has always been:
 * this manifest declares no dependencies, holds no lockfile, and every script proxies into
 * `frontend/`.
 *
 * The reason this file exists at all is that a root manifest with no lockfile is an
 * invitation. `npm install` at the root would create a root `package-lock.json` and a root
 * `node_modules` that nothing installs from, and npm cannot be told to refuse it. So the
 * properties that make the proxy correct are asserted here rather than left to convention —
 * a second source of truth looks exactly like the first one until something needs the wrong
 * one.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const REPO = join(FRONTEND, "..");

function root(): {
  name?: string;
  private?: boolean;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: unknown;
} {
  return JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
}

/** The scripts a developer is expected to run from the root, per the requirement. */
const REQUIRED_ROOT_SCRIPTS = [
  "dev",
  "build",
  "start",
  "lint",
  "format",
  "format:check",
  "typecheck",
  "test",
] as const;

describe("the root manifest adds no second source of truth (M15 task 3.3)", () => {
  it("declares no dependencies, so installing from the root installs nothing", () => {
    const manifest = root();
    expect(
      manifest.dependencies,
      "the root must declare no dependencies; the application package owns them",
    ).toBeUndefined();
    expect(manifest.devDependencies, "nor any devDependencies").toBeUndefined();
  });

  it("is private, so it is never published by accident", () => {
    expect(root().private, "the root manifest must be private").toBe(true);
  });

  it("is not a workspace, and the application stays in frontend/", () => {
    const manifest = root();
    expect(
      manifest.workspaces,
      "the repository is not a workspace; a proxy needs no change to dependency resolution",
    ).toBeUndefined();
    // The application directory is where it has always been, and it is still the only one
    // holding a lockfile.
    expect(existsSync(join(FRONTEND, "package.json")), "frontend/ holds the application").toBe(
      true,
    );
    expect(
      existsSync(join(FRONTEND, "package-lock.json")),
      "the application lockfile is the only one",
    ).toBe(true);
    expect(
      existsSync(join(REPO, "package-lock.json")),
      "a root lockfile would be a second source of truth, installed by nobody",
    ).toBe(false);
  });

  it("names the same runtime the application package does", () => {
    const application = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    // Two manifests declaring different runtimes is a new way for the M15 defect to exist.
    expect(
      root().engines?.node,
      "the root and the application must declare the same Node major",
    ).toBe(application.engines?.node);
  });
});

describe("every root command reaches the application package (M15 tasks 3.1, 3.3)", () => {
  it("provides every command the requirement names", () => {
    const scripts = root().scripts ?? {};
    for (const name of REQUIRED_ROOT_SCRIPTS) {
      expect(scripts[name], `the root must provide a "${name}" script`).toBeDefined();
    }
  });

  it("proxies each one into the application package", () => {
    const scripts = root().scripts ?? {};
    for (const name of REQUIRED_ROOT_SCRIPTS) {
      const command = scripts[name] ?? "";
      expect(
        command,
        `"${name}" must proxy with --prefix frontend rather than reimplement the command`,
      ).toMatch(/npm --prefix frontend/);
    }
  });

  it("proxies a command the application actually defines", () => {
    // A root script naming a script the application does not have fails at the root and
    // nowhere else, which is the worst place to find out. Checked against the real
    // application manifest rather than a restated list.
    const application = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const defined = application.scripts ?? {};
    const scripts = root().scripts ?? {};
    for (const name of REQUIRED_ROOT_SCRIPTS) {
      // `test` proxies `npm --prefix frontend test` rather than `run test`; both are valid
      // and both reach the same script, so both are accepted here.
      const target = /--prefix frontend (?:run )?([\w:-]+)/.exec(scripts[name] ?? "")?.[1];
      expect(target, `"${name}" must name an application script`).toBeDefined();
      expect(
        defined[target as string],
        `the application defines no "${String(target)}" script for the root "${name}" to reach`,
      ).toBeDefined();
    }
  });

  it("installs from the application lockfile, so there is one documented path", () => {
    const scripts = root().scripts ?? {};
    expect(scripts.setup, "the root must offer the install command").toBeDefined();
    // `ci`, not `install`: installing must reproduce the lockfile rather than resolve a
    // fresh tree, which is the whole reason a lockfile exists.
    expect(scripts.setup, "setup must install from the lockfile").toMatch(
      /npm --prefix frontend ci/,
    );
  });
});

describe("a root command reaches the application's own tooling (M15 task 3.4)", () => {
  it("the formatter is the application's, so a root format formats the application", () => {
    const application = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const configured = application.scripts?.format ?? "";
    // Proved against a plausible wrong answer: a root `format` that did not reach the
    // application's own script would be a command with the right name and nothing behind
    // it, which is worse than no root command at all.
    expect(configured, "the application defines a format script").toMatch(/prettier/);
    const rootFormat = root().scripts?.format ?? "";
    expect(
      /--prefix frontend run format\b/.test(rootFormat),
      "the root format must invoke the application script by name, not its own prettier call",
    ).toBe(true);
    // And a root prettier invocation would be the tell.
    expect(rootFormat, "the root must not call prettier directly").not.toMatch(/prettier/);
  });

  it("the test command runs the application's configured test runner", () => {
    const application = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(application.scripts?.test, "the application defines test").toMatch(/vitest/);
    expect(root().scripts?.test, "the root test must reach it").toMatch(/--prefix frontend test/);
  });
});
