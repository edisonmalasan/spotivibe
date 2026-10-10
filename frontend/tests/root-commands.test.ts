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
  "ps:check",
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
    expect(scripts.setup, "setup must install from the lockfile").toMatch(/\bnpm ci\b/);
  });

  it("runs the install in the application directory rather than with --prefix", () => {
    // Found by running it from a clean checkout, which is the only way it could be found.
    //
    // npm 11 — the npm that ships with Node 24 — fails an `npm ci` that is *nested* inside
    // an `npm run` script with `EALLOWSCRIPTS: --allow-scripts is not allowed in
    // project-scoped installs` when the user's `~/.npmrc` sets `allow-scripts`. Both
    // conditions are needed: with the npmrc bypassed the nested form works, and with the
    // npmrc present a *direct* `cd frontend && npm ci` works. Only the combination fails.
    //
    // This is a property of npm and of one machine's global configuration, not of this
    // repository, and the repository cannot control a user's npmrc. Adding a project-level
    // `allowScripts` to work around it would grant script permissions the project has no
    // reason to grant, so the fix is the other direction: the run scripts keep `--prefix`,
    // and the documented fallback for an install is the non-nested form.
    const scripts = root().scripts ?? {};
    expect(scripts.setup, "the install must reach the application directory").toMatch(
      /cd frontend/,
    );
    for (const name of REQUIRED_ROOT_SCRIPTS) {
      expect(scripts[name], `"${name}" should keep using --prefix`).toMatch(
        /npm --prefix frontend/,
      );
    }
  });

  it("documents the non-nested install, so the escape hatch cannot be deleted", () => {
    // The fallback is the part that matters on an affected machine, and a fallback nobody
    // can find is not a fallback. Held here because a documentation-only safety net is
    // exactly the kind of thing a later edit removes as redundant.
    const readme = readFileSync(join(REPO, "README.md"), "utf8");
    expect(
      readme,
      "the root README must document `cd frontend && npm ci` as the install that does not nest",
    ).toMatch(/cd frontend && npm ci/);
    expect(readme, "the root README must name the failure the fallback exists for").toMatch(
      /EALLOWSCRIPTS|allow-scripts/,
    );
  });
});

describe("the root gate builds before it tests, and says why", () => {
  // **This ordering is load-bearing, and the cost of getting it wrong is invisible.**
  //
  // `tests/motion-budget.test.ts`'s size rules need a build report and skip without one. With
  // `test` before `build`, a gate run reports that file green — its headline is a budget — while
  // six of its rules never execute. Measured both ways by moving `.next` aside: **21 passed with a
  // build, 15 passed and 6 skipped without one.**
  //
  // The same defect was found and fixed three times over: in `.github/workflows/ci.yml`, in the
  // archived release gate, and then here. `ci-workflow.test.ts` asserts the first; the gate's own
  // test file asserts the second. Nothing asserted the third, which is how it survived the other
  // two being fixed — a repair applied everywhere except the one place nobody re-read.
  //
  // So the order is asserted from the script itself rather than from the documentation beside it,
  // and the reason is asserted to be written down. The reason matters as much as the order: an
  // unexplained `&&` chain reads like tidiness, and tidying is exactly how it gets reverted.

  const gate = (): string => root().scripts?.gate ?? "";

  it("runs the build before the tests", () => {
    const script = gate();
    expect(script, "the root manifest must still define a gate").toContain("run build");
    expect(script, "the root manifest must still run the tests").toContain(" frontend test");
    // Both must be present for the comparison below to mean anything; asserting that first means a
    // script that dropped one entirely fails with a specific message rather than an index error.
    expect(
      script.indexOf("run build"),
      "the gate must build, or the bundle-size budget has no report to read",
    ).toBeGreaterThan(-1);
    expect(
      script.indexOf(" frontend test"),
      "the gate must test, or it is not a gate",
    ).toBeGreaterThan(-1);
    expect(
      script.indexOf("run build"),
      "the gate tested before it built: six of motion-budget's seven groups would skip, silently",
    ).toBeLessThan(script.indexOf(" frontend test"));
  });

  it("runs lint, formatting, PowerShell parsing and types before either", () => {
    // The cheap checks first is a separate property from build-before-test: a type error found
    // after a two-minute build is a two-minute wait spent to learn something available in seconds.
    //
    // `ps:check` is in this group for the same reason. It parses one tracked file, so it is
    // cheaper than the build by several orders of magnitude, and it is here because a check that is
    // not in the gate is a check nobody runs — which is the defect `icons:check` still has.
    const script = gate();
    const build = script.indexOf("run build");
    for (const [name, needle] of [
      ["lint", "run lint"],
      ["format:check", "run format:check"],
      ["ps:check", "run ps:check"],
      ["typecheck", "run typecheck"],
    ] as const) {
      const at = script.indexOf(needle);
      expect(at, `the gate must still run ${name}`).toBeGreaterThan(-1);
      expect(at, `the gate must run ${name} before it builds`).toBeLessThan(build);
    }
  });

  it("does not install, so the gate cannot destroy the tree it is validating", () => {
    // `npm ci` deletes `node_modules` before installing. The recorded incident is an `EPERM` on a
    // native module held by a running dev server, which left 19 packages, no `.bin`, and a `next`
    // without its `package.json`. The gate is the last thing that should ever do that, and it is
    // also the thing a person is most tempted to make self-sufficient.
    expect(gate(), "the gate must not run an install").not.toMatch(/npm ci|run setup/);
  });

  it("writes down the reason next to the order, so the order is not tidied back", () => {
    const agents = readFileSync(join(REPO, "AGENTS.md"), "utf8");
    expect(agents, "AGENTS.md must state the gate's order").toMatch(
      /npm run gate[^\n]*build -> test/,
    );
    expect(
      agents,
      "AGENTS.md must say the order is load-bearing, or a reader has no way to know it is a " +
        "decision rather than a preference",
    ).toMatch(/builds before it tests, and that order is load-bearing/);
    // And the measured comparison, so the claim is checkable rather than asserted.
    expect(
      agents,
      "AGENTS.md must record the two counts that make the ordering's effect measurable",
    ).toMatch(/21\s*passed with a build[\s\S]*?15 passed and 6 skipped without one/);
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
