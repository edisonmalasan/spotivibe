import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The gate's dependency preparation, made non-destructive.
 *
 * ## Why this module exists
 *
 * The first version of this step ran `npm ci` in the working tree. `npm ci` deletes
 * `node_modules` before installing, so a failed install — an `EPERM` on a native module held by a
 * running dev server, for instance — leaves 19 packages, no `.bin`, and a `next` without its
 * `package.json`. Every later item then fails for a reason that is not the code, which is how one
 * broken environment became sixteen unrelated findings.
 *
 * A gate that can silently break the working tree cannot be the thing that validates one, so the
 * step is split into three separable pieces, each of which can be tested without running `npm`:
 *
 *   1. `dependencyTreeState` — is the tree already usable? A complete tree is left alone.
 *   2. `stageInstall`      — install into a temporary directory outside the tree.
 *   3. `promoteStagedInstall` — swap the staged tree in, with a backup that is restored if the
 *      swap fails.
 *
 * ## Why staging rather than `npm ci --dry-run`
 *
 * A dry run would not have caught the recorded failure. The failure was filesystem contention over
 * a native module's files, and a dry run never opens those files. Verifying that the dry run
 * "works" would have reproduced the original incident's absence rather than its cause.
 *
 * ## Why completeness is not the exit code
 *
 * The recorded failure exited `0` while leaving `node_modules/.bin` empty. An exit code alone would
 * have called that a success and every later item would still have failed. So completeness is a
 * direct inspection of what the later steps actually invoke.
 */

/**
 * The binaries the gate's later steps invoke, and therefore the ones whose absence would make
 * those steps fail for a reason unrelated to the code.
 *
 * Named as the gate's own items name them, not as the dependency list spells them. A check that
 * enumerated packages would go stale the moment a step changed what it runs; a check that
 * enumerates the invoked binaries fails loudly instead, which is the behaviour that matters here.
 */
const REQUIRED_BINARIES = [
  // `npm run lint`, `npm run format:check`
  "eslint",
  "prettier",
  // `npm run typecheck` → `next typegen && tsc --noEmit`
  "tsc",
  "next",
  // `npm test`, and the gate's own `how: "test"` items which invoke vitest directly
  "vitest",
];

/**
 * Packages whose `package.json` must be readable.
 *
 * `next` is the one the recorded incident actually broke, and it is listed because a bin shim can
 * survive the loss of the package it shims to. The recorded state was "a `next` without its
 * `package.json`", which an existence check on the binary alone would have called complete.
 */
const REQUIRED_PACKAGES = ["next", "vitest", "eslint"];

/** The platform's name for an executable shim in `node_modules/.bin`. */
function binaryName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

/**
 * Inspect the working tree's dependency directory.
 *
 * Returns the list of what is missing rather than a bare boolean, because a gate that reports
 * "the install is broken" and one that reports "eslint, tsc and vitest are missing from
 * node_modules/.bin" cost the reader very different amounts of time — and only the second one
 * tells them whether anything needs doing at all.
 *
 * @returns {{complete: boolean, missing: string[]}}
 */
export function dependencyTreeState(frontendDir) {
  const missing = [];
  const modules = join(frontendDir, "node_modules");

  // A missing `node_modules` is reported as one entry rather than one per binary, because
  // listing fifteen missing binaries when the directory itself is absent is noise.
  if (!existsSync(modules)) {
    return { complete: false, missing: ["node_modules/"] };
  }

  for (const name of REQUIRED_BINARIES) {
    if (!existsSync(join(modules, ".bin", binaryName(name)))) {
      missing.push(`node_modules/.bin/${binaryName(name)}`);
    }
  }
  for (const name of REQUIRED_PACKAGES) {
    const manifest = join(modules, name, "package.json");
    if (!existsSync(manifest)) {
      missing.push(`node_modules/${name}/package.json`);
    } else if (statSync(manifest).size === 0) {
      // A zero-byte manifest is what an interrupted `npm ci` leaves behind, and `existsSync`
      // calls it present.
      missing.push(`node_modules/${name}/package.json (empty)`);
    }
  }

  return { complete: missing.length === 0, missing };
}

/**
 * Install from the lockfile into a temporary directory outside the working tree.
 *
 * Only the two files that define the install are copied. Copying the whole package directory would
 * copy the `node_modules` this step exists to avoid depending on.
 *
 * `run` is injected so this can be tested without invoking npm. It receives `(command, args, cwd)`
 * and must return `{code, output}`.
 *
 * @returns {{ok: boolean, stagedDir: string, output: string}}
 */
export function stageInstall({ frontendDir, run, tmpRoot = tmpdir() }) {
  const stagedDir = mkdtempSync(join(tmpRoot, "spotivibe-gate-install-"));

  for (const name of ["package.json", "package-lock.json", ".npmrc"]) {
    const from = join(frontendDir, name);
    if (existsSync(from)) copyFileSync(from, join(stagedDir, name));
  }

  const outcome = run("npm", ["ci", "--no-audit", "--no-fund"], stagedDir);
  const ok = outcome.code === 0;

  if (!ok) {
    // The staging directory is removed here rather than left for the caller's cleanup, so a
    // caller that throws before cleanup does not leak a full copy of the dependency tree into the
    // system temporary directory.
    rmSync(stagedDir, { recursive: true, force: true });
  }

  return { ok, stagedDir, output: outcome.output ?? "" };
}

/**
 * Swap a staged dependency tree into the working directory.
 *
 * The existing directory is **renamed**, not deleted, before the staged one is renamed in. A
 * rename is atomic on every filesystem this project targets, so there is no window in which the
 * working tree has no dependencies at all — which is the window the original `npm ci` opened, and
 * the window in which an interrupted install left the tree broken.
 *
 * If the second rename fails the backup is renamed back, so the failure mode is "the gate did not
 * install" rather than "the gate destroyed the working tree".
 *
 * @returns {{ok: boolean, error?: string}}
 */
export function promoteStagedInstall({ stagedDir, frontendDir }) {
  const target = join(frontendDir, "node_modules");
  const backup = `${target}.gate-backup`;

  // A backup from an interrupted earlier run is removed rather than renamed onto, because
  // `rename` onto an existing directory fails on Windows and would report an install failure for a
  // reason that is not this run's.
  rmSync(backup, { recursive: true, force: true });

  const hadTree = existsSync(target);
  if (hadTree) {
    try {
      renameSync(target, backup);
    } catch (error) {
      return { ok: false, error: `could not move the existing dependency tree aside: ${error}` };
    }
  }

  try {
    // A copy rather than a rename: the staged tree is inside the system temporary directory, which
    // may be a different volume from the repository, and `rename` fails across volumes. The
    // staging directory is removed by the caller afterwards.
    cpSync(join(stagedDir, "node_modules"), target, { recursive: true });
  } catch (error) {
    if (hadTree) {
      try {
        renameSync(backup, target);
      } catch {
        // Reported, because a failed restore is strictly worse than a failed install and the
        // reader needs to know the tree is now in the backup directory rather than guessing.
        return {
          ok: false,
          error:
            `the install failed (${error}) AND the previous dependency tree could not be ` +
            `restored; it is at ${backup}`,
        };
      }
    } else {
      rmSync(target, { recursive: true, force: true });
    }
    return { ok: false, error: `the install failed and nothing was changed: ${error}` };
  }

  rmSync(backup, { recursive: true, force: true });
  return { ok: true };
}

/**
 * Whether an item must be reported as not run because dependency preparation failed.
 *
 * Extracted so the decision is a returned value rather than a condition written at the call site.
 * It was inline, and a mutation proof showed the only check on it — a source assertion that the
 * identifier appeared somewhere in the file — stayed green when the condition was replaced with
 * `false`. A gate that reports sixteen failures where there is one is the diagnostic defect this
 * whole change is about, so the decision is now something a test can pin down.
 *
 * @param {{how: string}} item
 * @param {string | null} environmentBroken the install's failure detail, or null when it worked
 */
export function isShortCircuited(item, environmentBroken) {
  // The install item itself is never short-circuited: it is the thing that decides, and it is
  // first, so nothing can have broken the environment before it runs. Excluding it by `how` rather
  // than by position means the rule survives a reordering of the item list.
  if (environmentBroken === null) return false;
  return item.how !== "install";
}

/**
 * The reason every later item is short-circuited, given the install's outcome.
 *
 * ## Why this exists, given `isShortCircuited` is already extracted
 *
 * Extracting the *condition* was not enough, because the cascade has two halves and only one of them
 * lived in a testable function. The other half is the value: `environmentBroken = prepared.detail`.
 * Independent verification replaced that line's right-hand side with the literal
 * `"install reported success"` and the whole suite stayed green, because the only assertion touching
 * it was `expect(gate).toMatch(/environmentBroken/)` — a check that the *spelling* appears somewhere
 * in the file. Renaming every occurrence of the identifier was equally invisible.
 *
 * That check could not fail for a reason worth the name: it never looked at what the variable was
 * assigned. It would have passed just as happily if the cascade were wired to nothing at all.
 *
 * ## What this buys
 *
 * The mapping from an install outcome to the reason string is now a returned value with its own tests:
 * success yields `null` — which is what `isShortCircuited` reads as "nothing is broken" — and failure
 * yields the install's own detail, so the first line of output still names the real cause.
 *
 * The gate's remaining use of it is one call, and asserting *that call* is a narrow structural check
 * rather than the whole claim. If the gate stops calling this, the behaviour tests here still pass and
 * the structural assertion is what notices — which is the correct division of labour, and the reverse
 * of the previous arrangement where nothing but the spelling check existed.
 *
 * @param {{ok: boolean, detail?: string}} prepared the install outcome
 * @returns {string | null} the cascade reason, or null when the install worked
 */
export function cascadeReason(prepared) {
  return prepared.ok ? null : prepared.detail;
}

/** The real `run`, used when the caller does not inject one. */
export function spawnRunner(command, args, cwd) {
  const outcome = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { code: outcome.status ?? 1, output: `${outcome.stdout ?? ""}${outcome.stderr ?? ""}` };
}

/**
 * The whole step, in the order the decisions above require.
 *
 * Returns a discriminated result rather than throwing, because the caller has to render this into
 * one line of the gate's output and a thrown error would take the whole gate down before it could
 * say anything.
 */
export function prepareDependencies({ frontendDir, run = spawnRunner, tmpRoot = tmpdir() }) {
  const before = dependencyTreeState(frontendDir);

  // The common case, and the one that used to be destructive for no reason at all: a complete tree
  // is left exactly as it is.
  if (before.complete) {
    return {
      ok: true,
      detail: "the existing dependency tree is complete; nothing was reinstalled or deleted",
      output: "",
      installed: false,
    };
  }

  const staged = stageInstall({ frontendDir, run, tmpRoot });
  if (!staged.ok) {
    // Nothing has been touched. This is the whole point: the recorded failure destroyed the tree
    // *and then* failed, and the second part is the part that was survivable.
    return {
      ok: false,
      detail:
        `the dependency tree is incomplete (${before.missing.join(", ")}) and a staged install ` +
        `failed, so the working tree was left untouched`,
      output: staged.output,
      installed: false,
    };
  }

  const promoted = promoteStagedInstall({ stagedDir: staged.stagedDir, frontendDir });
  rmSync(staged.stagedDir, { recursive: true, force: true });
  if (!promoted.ok) {
    return { ok: false, detail: promoted.error, output: staged.output, installed: false };
  }

  // Re-inspected rather than assumed. `npm ci` exiting `0` is not evidence the tree is usable, and
  // this step's entire reason for existing is that it is not.
  const after = dependencyTreeState(frontendDir);
  if (!after.complete) {
    return {
      ok: false,
      detail:
        `the staged install reported success but the tree is still incomplete ` +
        `(${after.missing.join(", ")})`,
      output: staged.output,
      installed: true,
    };
  }

  return {
    ok: true,
    detail: `staged install from the lockfile, replacing an incomplete tree (${before.missing.length} problem(s))`,
    output: staged.output,
    installed: true,
  };
}