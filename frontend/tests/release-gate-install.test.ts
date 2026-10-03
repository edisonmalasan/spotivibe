import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dependencyTreeState,
  isShortCircuited,
  prepareDependencies,
  promoteStagedInstall,
  stageInstall,
} from "../../openspec/changes/archive/2026-09-30-add-release-validation-and-deployment/evidence/lib/install.mjs";
import {
  beginRouting,
  createReadiness,
  pausedAction,
  PAUSED_ACTION,
} from "../../openspec/changes/archive/2026-09-30-add-release-validation-and-deployment/evidence/lib/router.mjs";

/**
 * The release gate's dependency preparation.
 *
 * M21 replaced a `npm ci` that deleted `node_modules` before installing. The recorded failure was
 * an `EPERM` on a native module held by a running dev server, which left 19 packages, no `.bin`,
 * and a `next` without its `package.json` — after which every later gate item failed for a reason
 * that was not the code.
 *
 * ## Why this file exists at all
 *
 * The gate is 780 lines and had **no tests whatsoever**. That is the same defect class as everything
 * else M21 found: a mechanism whose correctness is asserted in prose. A replacement for a
 * destructive step, written without tests, is a replacement that is trusted because it reads
 * carefully.
 *
 * ## Why the fixtures are built from a name list written here
 *
 * `BINARIES` and `PACKAGES` below are this file's own belief about what the later gate steps
 * invoke. They are deliberately **not** imported from the module under test: a fixture derived from
 * the implementation's own list would keep passing if that list were wrong, which is precisely the
 * failure the completeness check exists to catch. If the module later requires something this file
 * does not know about, the "a complete tree needs no install" test fails — a real signal rather than
 * a silent agreement.
 *
 * ## Why nothing here touches the repository
 *
 * Every fixture is built under the system temporary directory. A test in this repository that wrote
 * into `frontend/src/` collided with the guard that walks that tree, and M21's other half is the
 * fix for exactly that. Writing the tests to the same standard they are asserting is the least
 * defensible thing available.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const EVIDENCE = join(
  FRONTEND,
  "..",
  "openspec",
  "changes",
  "archive",
  "2026-09-30-add-release-validation-and-deployment",
  "evidence",
);

/** What the gate's later steps invoke: lint, format, typecheck, test, build, and its own test items. */
const BINARIES = ["eslint", "prettier", "tsc", "next", "vitest"];

/**
 * Packages whose manifest must be readable.
 *
 * `next` is here because the recorded failure broke it while leaving its bin shim, so a check on
 * the binary alone would have called that tree complete.
 */
const PACKAGES = ["next", "vitest", "eslint"];

const shim = (name: string): string => (process.platform === "win32" ? `${name}.cmd` : name);

/** A temporary directory removed after each test, so a failed test does not leak a whole tree. */
const scratch: string[] = [];
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-install-test-"));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  while (scratch.length > 0) {
    rmSync(scratch.pop()!, { recursive: true, force: true });
  }
});

/** Build a `node_modules` containing exactly what a usable dependency tree would contain. */
function populateModules(root: string): string {
  const modules = join(root, "node_modules");
  mkdirSync(join(modules, ".bin"), { recursive: true });
  for (const name of BINARIES) {
    writeFileSync(join(modules, ".bin", shim(name)), "@echo off\r\n", "utf8");
  }
  for (const name of PACKAGES) {
    mkdirSync(join(modules, name), { recursive: true });
    writeFileSync(join(modules, name, "package.json"), '{"name":"x"}\n', "utf8");
  }
  return modules;
}

/** A frontend directory with a lockfile and a dependency tree in the given condition. */
function frontend(
  condition: "complete" | "no-modules" | "no-bin" | "no-next-manifest" | "empty-manifest",
) {
  const root = scratchDir();
  writeFileSync(join(root, "package.json"), '{"name":"frontend"}\n', "utf8");
  writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}\n', "utf8");

  switch (condition) {
    case "complete":
      populateModules(root);
      break;
    case "no-modules":
      break;
    case "no-bin":
      populateModules(root);
      rmSync(join(root, "node_modules", ".bin", shim("tsc")));
      break;
    case "no-next-manifest":
      populateModules(root);
      rmSync(join(root, "node_modules", "next", "package.json"));
      break;
    case "empty-manifest":
      populateModules(root);
      // An interrupted `npm ci` leaves this behind, and `existsSync` calls it present.
      writeFileSync(join(root, "node_modules", "next", "package.json"), "", "utf8");
      break;
  }
  return root;
}

/**
 * A byte-level record of a directory tree, so "untouched" is a measurement rather than a hope.
 */
function fingerprint(root: string): string {
  const entries: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else entries.push(`${full.slice(root.length)}:${readFileSync(full).toString("base64")}`);
    }
  };
  walk(root);
  return entries.join("\n");
}

/**
 * Source with every comment removed, so a source assertion cannot match a comment.
 *
 * ## Why this exists, and why it is the second time in one commit
 *
 * Two of this file's own assertions failed on first run, both for the same reason, and it is the
 * same defect this change exists to fix. `startRouting`'s ordering assertion compared the index of
 * `routerPaused = true` against the index of `Fetch.enable` — and the **explanatory comment
 * written to describe that very bug** mentions `Fetch.enable` first, so the check was reading the
 * prose. The second failed because the comment quotes the original broken guard verbatim
 * (`if (sessionId !== pageSession() || !routerPaused) return;`), so the assertion meant to prove the
 * drop was gone matched the sentence recording that it once was.
 *
 * A guard that matches the documentation instead of the code is a guard that passes on a comment
 * saying the opposite of what it claims to check. M20 found this three times, in arms that matched
 * a token as the documentation spelled it. It is not a subtle failure and it is not rare.
 *
 * Comments are removed rather than avoided, because a check that only works while nobody explains
 * the code stops being runnable the first time somebody does.
 *
 * String literals are preserved, so a `//` inside a URL is not mistaken for a comment — a real
 * risk in this repository, which contains many of them.
 */
function code(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const char = source[i]!;
    if (quote) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      // An unterminated block comment would otherwise swallow the rest of the file and make every
      // later assertion vacuously true — which is the failure mode this function exists to avoid,
      // so it refuses rather than guesses.
      if (end === -1) throw new Error("unterminated block comment");
      out += "\n".repeat((source.slice(i, end).match(/\n/g) ?? []).length);
      i = end + 2;
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** A `run` that pretends to install, by writing a usable tree into whatever staging directory it is given. */
function fakeInstall(fail = false) {
  return vi.fn((_command: string, _args: string[], cwd: string) => {
    if (fail) return { code: 1, output: "npm error code EPERM\nnpm error errno -4048" };
    populateModules(cwd);
    return { code: 0, output: "added 445 packages in 4s" };
  });
}

describe("dependencyTreeState", () => {
  it("reports a complete tree as complete, with nothing missing", () => {
    const state = dependencyTreeState(frontend("complete"));
    expect(state).toEqual({ complete: true, missing: [] });
  });

  it("names the directory rather than fifteen binaries when it is absent", () => {
    // Listing every missing binary when the directory itself is gone is noise, and a reader told
    // fifteen names would look for fifteen separate problems.
    expect(dependencyTreeState(frontend("no-modules"))).toEqual({
      complete: false,
      missing: ["node_modules/"],
    });
  });

  it("names a missing binary", () => {
    const state = dependencyTreeState(frontend("no-bin"));
    expect(state.complete).toBe(false);
    expect(state.missing).toEqual([`node_modules/.bin/${shim("tsc")}`]);
  });

  it("names a package whose manifest is gone, even when its binary survives", () => {
    // This is the recorded incident: `next` without its `package.json`. A check on the binary
    // alone calls that tree complete, and every later gate item then fails for a reason that is
    // not the code.
    const state = dependencyTreeState(frontend("no-next-manifest"));
    expect(state.complete).toBe(false);
    expect(state.missing).toContain("node_modules/next/package.json");
  });

  it("names an empty manifest, which existsSync reports as present", () => {
    const state = dependencyTreeState(frontend("empty-manifest"));
    expect(state.complete).toBe(false);
    expect(state.missing).toContain("node_modules/next/package.json (empty)");
  });

  it("is proven able to fail", () => {
    // Without this, every expectation above could hold against a function that always returns
    // `complete: true`, which is a plausible implementation of this check.
    const complete = dependencyTreeState(frontend("complete"));
    const broken = dependencyTreeState(frontend("no-bin"));
    expect(complete.complete).toBe(true);
    expect(broken.complete).toBe(false);
    expect(broken.missing).not.toEqual(complete.missing);
  });
});

describe("stageInstall", () => {
  it("copies only the two files that define the install", () => {
    // Copying the package directory wholesale would copy the `node_modules` this exists to avoid
    // depending on.
    const root = frontend("no-modules");
    writeFileSync(join(root, "next.config.ts"), "export default {};\n", "utf8");
    const run = fakeInstall();

    const staged = stageInstall({ frontendDir: root, run });

    expect(staged.ok).toBe(true);
    expect(existsSync(join(staged.stagedDir, "package.json"))).toBe(true);
    expect(existsSync(join(staged.stagedDir, "package-lock.json"))).toBe(true);
    expect(existsSync(join(staged.stagedDir, "next.config.ts"))).toBe(false);
  });

  it("installs into a directory outside the working tree", () => {
    const root = frontend("no-modules");
    const staged = stageInstall({ frontendDir: root, run: fakeInstall() });
    expect(staged.stagedDir.startsWith(root)).toBe(false);
    expect(staged.stagedDir).not.toContain(`${root}/`);
  });

  it("removes the staging directory when the install fails", () => {
    // Left behind, a failed gate leaks a full copy of the dependency tree into the system
    // temporary directory, and the caller's own cleanup does not run if it throws first.
    const staged = stageInstall({ frontendDir: frontend("no-modules"), run: fakeInstall(true) });
    expect(staged.ok).toBe(false);
    expect(existsSync(staged.stagedDir)).toBe(false);
  });

  it("carries the installer's own output, so the failure is diagnosable", () => {
    const staged = stageInstall({ frontendDir: frontend("no-modules"), run: fakeInstall(true) });
    expect(staged.output).toContain("EPERM");
  });
});

describe("promoteStagedInstall", () => {
  it("puts the staged tree in place", () => {
    const root = frontend("no-modules");
    const staged = stageInstall({ frontendDir: root, run: fakeInstall() });
    const promoted = promoteStagedInstall({ stagedDir: staged.stagedDir, frontendDir: root });

    expect(promoted.ok).toBe(true);
    expect(dependencyTreeState(root).complete).toBe(true);
    rmSync(staged.stagedDir, { recursive: true, force: true });
  });

  it("leaves the previous tree in place when there is nothing to promote", () => {
    // The failure mode this guards is "the gate destroyed the working tree and then failed". A
    // rename-aside with a restore is what makes that unreachable; a delete-then-copy is not.
    const root = frontend("complete");
    const before = fingerprint(join(root, "node_modules"));

    const promoted = promoteStagedInstall({
      stagedDir: join(scratchDir(), "absent"),
      frontendDir: root,
    });

    expect(promoted.ok).toBe(false);
    expect(promoted.error).toContain("nothing was changed");
    expect(fingerprint(join(root, "node_modules"))).toBe(before);
    expect(dependencyTreeState(root).complete).toBe(true);
  });

  it("leaves no backup directory behind on success", () => {
    const root = frontend("no-modules");
    const staged = stageInstall({ frontendDir: root, run: fakeInstall() });
    promoteStagedInstall({ stagedDir: staged.stagedDir, frontendDir: root });
    expect(existsSync(`${join(root, "node_modules")}.gate-backup`)).toBe(false);
    rmSync(staged.stagedDir, { recursive: true, force: true });
  });

  it("replaces a leftover backup rather than failing on it", () => {
    // `rename` onto an existing directory fails on Windows. A backup from an interrupted earlier
    // run would otherwise report an install failure that has nothing to do with this run.
    const root = frontend("complete");
    mkdirSync(`${join(root, "node_modules")}.gate-backup/stale`, { recursive: true });

    const staged = stageInstall({ frontendDir: root, run: fakeInstall() });
    const promoted = promoteStagedInstall({ stagedDir: staged.stagedDir, frontendDir: root });

    expect(promoted.ok).toBe(true);
    rmSync(staged.stagedDir, { recursive: true, force: true });
  });
});

describe("prepareDependencies", () => {
  it("does not run any command at all when the tree is already complete", () => {
    // The regression this whole module exists to prevent, asserted directly: a usable tree is left
    // exactly as it is, so there is no window in which it is not.
    const run = fakeInstall();
    const prepared = prepareDependencies({ frontendDir: frontend("complete"), run });

    expect(prepared.ok).toBe(true);
    expect(prepared.installed).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(prepared.detail).toContain("nothing was reinstalled or deleted");
  });

  it("installs from the lockfile when the tree is unusable", () => {
    const root = frontend("no-modules");
    const run = fakeInstall();
    const prepared = prepareDependencies({ frontendDir: root, run });

    expect(prepared.ok).toBe(true);
    expect(prepared.installed).toBe(true);
    expect(run).toHaveBeenCalledWith("npm", ["ci", "--no-audit", "--no-fund"], expect.any(String));
    expect(dependencyTreeState(root).complete).toBe(true);
  });

  it("leaves the working tree byte-identical when the staged install fails", () => {
    // The recorded incident, asserted as the property that would have prevented it.
    const root = frontend("no-bin");
    const before = fingerprint(root);

    const prepared = prepareDependencies({ frontendDir: root, run: fakeInstall(true) });

    expect(prepared.ok).toBe(false);
    expect(fingerprint(root)).toBe(before);
    expect(prepared.installed).toBe(false);
  });

  it("reports the install's own error, so the reader is not left guessing", () => {
    const prepared = prepareDependencies({
      frontendDir: frontend("no-modules"),
      run: fakeInstall(true),
    });
    expect(prepared.output).toContain("EPERM");
    expect(prepared.detail).toContain("left untouched");
  });

  it("fails when the install claims success but the tree is still incomplete", () => {
    // `npm ci` exiting `0` is not evidence the tree is usable — the recorded failure did exactly
    // that. So the result is re-inspected rather than believed.
    const root = frontend("no-modules");
    const prepared = prepareDependencies({
      frontendDir: root,
      run: (_c, _a, cwd) => {
        mkdirSync(join(cwd, "node_modules", ".bin"), { recursive: true });
        return { code: 0, output: "added 445 packages" };
      },
    });

    expect(prepared.ok).toBe(false);
    expect(prepared.detail).toContain("reported success but the tree is still incomplete");
  });

  it("removes the staging directory on every path", () => {
    const tmpRoot = scratchDir();
    for (const run of [fakeInstall(), fakeInstall(true)]) {
      prepareDependencies({ frontendDir: frontend("no-modules"), run, tmpRoot });
      // The staging directory is a sibling of `tmpRoot`, created by mkdtemp inside it.
      expect(readdirSync(tmpRoot)).toEqual([]);
    }
  });

  it("is proven able to fail", () => {
    expect(prepareDependencies({ frontendDir: frontend("complete"), run: fakeInstall() }).ok).toBe(
      true,
    );
    expect(
      prepareDependencies({ frontendDir: frontend("no-modules"), run: fakeInstall(true) }).ok,
    ).toBe(false);
  });
});

describe("the gate script itself", () => {
  // Comments removed for the same reason as the router assertions below.
  const gate = code(readFileSync(join(EVIDENCE, "release-gate.mjs"), "utf8"));

  it("no longer runs npm ci over the working tree", () => {
    // A guard on the guard. The replacement logic lives in `lib/install.mjs` and is tested above;
    // without this, deleting the `how: "install"` branch and restoring `command: "npm",
    // args: ["ci"]` would leave every one of those tests green while the gate went back to
    // destroying the tree.
    const installItem = /id:\s*"gates-install"[\s\S]*?\n  \},/.exec(gate)?.[0] ?? "";
    expect(installItem).not.toMatch(/args:\s*\[\s*"ci"/);
    expect(installItem).toMatch(/how:\s*"install"/);
  });

  it("reports a broken environment once rather than as a failure per item", () => {
    // The cascade is the diagnostic half of this fix, and it is invisible in a test of
    // `prepareDependencies` alone.
    expect(gate).toMatch(/environmentBroken/);
    expect(gate).toMatch(/NOT RUN/);
    expect(gate).toContain("the environment is broken");
  });

  it("parses, and its helper modules parse", () => {
    for (const file of [
      "release-gate.mjs",
      join("lib", "install.mjs"),
      join("lib", "harness.mjs"),
    ]) {
      const outcome = spawnSync(process.execPath, ["--check", join(EVIDENCE, file)], {
        encoding: "utf8",
      });
      expect(`${file}: ${outcome.stderr}`).toBe(`${file}: `);
    }
  });
});

describe("the end-to-end fixture router's readiness", () => {
  it("continues a request that arrives before interception is enabled", () => {
    // The window. For the duration of the `Fetch.enable` round trip the domain is intercepting
    // while a flag set *after* the await still says it is not; the original handler then discarded
    // every request paused in that window. A paused request that is neither continued nor failed
    // does not error — it hangs — so the caller waited out its own timeout and the run failed
    // somewhere downstream of the real cause. That is why it presented as intermittent.
    const readiness = createReadiness();
    expect(readiness.ready).toBe(false);
    expect(pausedAction(readiness, true)).toBe(PAUSED_ACTION.CONTINUE);
  });

  it("routes a request once interception is enabled", () => {
    const readiness = createReadiness();
    readiness.claim();
    expect(pausedAction(readiness, true)).toBe(PAUSED_ACTION.ROUTE);
  });

  it("has no outcome that leaves a request unresolved", () => {
    // The strongest form of "never drop": every combination resolves to one of the three actions,
    // and none of them is "do nothing". Enumerated rather than spot-checked because a spot check
    // would miss a fourth branch added later.
    for (const ready of [false, true]) {
      for (const isPage of [false, true]) {
        const readiness = createReadiness();
        if (ready) readiness.claim();
        expect(Object.values(PAUSED_ACTION)).toContain(pausedAction(readiness, isPage));
      }
    }
  });

  it("continues again after readiness is released, rather than reverting to dropping", () => {
    const readiness = createReadiness();
    readiness.claim();
    expect(pausedAction(readiness, true)).toBe(PAUSED_ACTION.ROUTE);
    readiness.release();
    expect(readiness.ready).toBe(false);
    expect(pausedAction(readiness, true)).toBe(PAUSED_ACTION.CONTINUE);
  });

  it("leaves another target's request entirely alone", () => {
    // A service worker or the browser's own requests share the CDP connection. Continuing those
    // would interfere with a session this router does not own.
    const readiness = createReadiness();
    readiness.claim();
    expect(pausedAction(readiness, false)).toBe(PAUSED_ACTION.IGNORE);
  });

  it("claims readiness before enabling interception, and enables exactly once", async () => {
    // Ordering as an observed call sequence rather than as a comparison of string indices. The
    // index version of this assertion was **unchecked** — the mutation proof showed restoring the
    // original order left the suite green, because a comment in the file mentioned `Fetch.enable`
    // before the code did.
    const calls: string[] = [];
    const readiness = createReadiness();
    const send = async (method: string) => {
      calls.push(method);
      // Observed from inside the enable call, which is the moment the original bug lived.
      expect(readiness.ready).toBe(true);
    };

    await beginRouting({ send, readiness, patterns: [{ urlPattern: "*" }] });

    expect(calls).toEqual(["Fetch.enable"]);
    expect(readiness.ready).toBe(true);
  });

  it("releases readiness when enabling interception fails", () => {
    // Leaving it claimed would make the handler *continue* requests it has no interception
    // configured to intercept — a quieter version of the same bug reached by another route.
    const readiness = createReadiness();
    const send = async () => {
      throw new Error("Fetch.enable failed");
    };

    return expect(beginRouting({ send, readiness, patterns: [{ urlPattern: "*" }] }))
      .rejects.toThrow("Fetch.enable failed")
      .then(() => {
        expect(readiness.ready).toBe(false);
      });
  });

  it("propagates an enabling failure rather than swallowing it", () => {
    // A swallowed failure would report a router that is intercepting and is not, which is the
    // original bug's outcome arriving by a different path.
    const readiness = createReadiness();
    const send = async () => {
      throw new Error("boom");
    };
    return expect(beginRouting({ send, readiness, patterns: [] })).rejects.toThrow("boom");
  });

  it("the harness routes its handler through this decision", () => {
    // One guard, on the fact that the extracted decision is actually the one in use. Without it the
    // extraction could be inert — the functions tested above real, and the hang still present.
    const harness = code(readFileSync(join(EVIDENCE, "lib", "harness.mjs"), "utf8"));
    const handler = /on\("Fetch\.requestPaused"[\s\S]*?const \{ requestId/.exec(harness)?.[0] ?? "";
    expect(handler).toContain("pausedAction(readiness, sessionId === pageSession())");
    expect(handler).toContain("PAUSED_ACTION.CONTINUE");
    // And the bare-drop guard must be gone from executable text, not merely from the comments.
    expect(handler).not.toMatch(/!routerPaused/);
  });
});

describe("the broken-environment cascade", () => {
  it("short-circuits every item once the install has failed", () => {
    expect(isShortCircuited({ how: "command" }, "the tree is broken")).toBe(true);
    expect(isShortCircuited({ how: "test" }, "the tree is broken")).toBe(true);
    expect(isShortCircuited({ how: "install" }, "the tree is broken")).toBe(false);
  });

  it("short-circuits nothing when the install worked", () => {
    for (const how of ["install", "command", "test", "manual"]) {
      expect(isShortCircuited({ how }, null)).toBe(false);
    }
  });

  it("never short-circuits the item that decides whether the environment is broken", () => {
    // Otherwise the gate reports no install result at all and the cascade has no cause.
    expect(isShortCircuited({ how: "install" }, "anything")).toBe(false);
  });

  it("is a returned value, not a condition at the call site", () => {
    // The condition was inline and unchecked: replacing it with `false` left the suite green while
    // the gate went back to reporting sixteen failures where there is one.
    const gate = code(readFileSync(join(EVIDENCE, "release-gate.mjs"), "utf8"));
    expect(gate).toContain("isShortCircuited(item, environmentBroken)");
    expect(gate).not.toMatch(/environmentBroken !== null && item\.how/);
  });
});

describe("the comment stripper", () => {
  it("strips comments rather than losing the code they sat on", () => {
    // `code()` is load-bearing for the source assertions above, so it is itself checked: a stripper
    // that removed everything would make them vacuously green, which is the failure this file
    // exists to avoid repeating.
    const sample = 'const a = 1; // gone\nconst url = "https://x/y"; /* also gone */const b = 2;';
    const stripped = code(sample);
    expect(stripped).toContain("const a = 1;");
    expect(stripped).toContain('"https://x/y"');
    expect(stripped).toContain("const b = 2;");
    expect(stripped).not.toContain("gone");
  });

  it("refuses to guess at an unterminated block comment", () => {
    // Swallowing the rest of the file would make every later source assertion vacuously true.
    expect(() => code("/* never closed\nconst a = 1;")).toThrow("unterminated block comment");
  });
});
