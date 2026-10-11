#!/usr/bin/env node
// Gate step: examine every tracked file in the repository-root `scripts/` directory.
//
// **Why this exists.** These six scripts sat outside every gate step. They are not linted, not
// format-checked, not type-checked and not tested, and nothing ran them. Three of them are provers
// that guard the OpenSpec sync path, and all three were failing - `3/15`, `5/11` and `3/8`. That went
// unnoticed for four milestones, and M30's coverage guard recorded the directory as frozen evidence
// with an accurate reason: *"nothing in any manifest or test references them"*. An exemption that
// describes the absence of a check as though it justified one is the defect this step removes.
//
// **What it checks.** Two things, both of which the directory had neither of:
//
//   1. Formatting, against the repository's own `.prettierrc.json`. Prettier resolves configuration per
//      file and the repository root has none, so a check pointed here without naming a config silently
//      measures `printWidth: 80` instead of the repository's 100 - which reports all six files as
//      needing changes when only two do. The config is named explicitly for that reason.
//   2. The provers, which are run. A prover is executable evidence; leaving three of them failing in a
//      directory no step reads is how a broken guard survives for four milestones.
//
// **What it does not check, and is not claimed to.** It does not lint. There is no ESLint-resolvable
// toolchain at the repository root, and none may be added without creating a second lockfile at a root
// whose manifest deliberately declares no dependencies. That is a recorded limitation, asserted by
// `tests/gate-coverage.test.ts`, not a claim made here. It also does not type-check: `tsconfig.json`
// includes `**/*.mts` and not `**/*.mjs`, so no `.mjs` in this repository is type-checked.
//
// **The provers write only to temporary directories.** Each copies the `openspec/` tree out, mutates
// the copy, and drives the guard under test against it. The real tree is never written to; this step
// asserts that by checking the working tree is unchanged when it finishes.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as prettier from "prettier";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..");
const REPO = resolve(FRONTEND, "..");

/**
 * The repository-root `scripts/` directory, and nothing else.
 *
 * `frontend/scripts/` is already covered by ESLint, Prettier and this step's own siblings, and
 * `openspec/changes/archive/` is frozen evidence. Naming the one directory this step exists to reach
 * keeps the coverage guard's claim checkable against a single literal.
 */
const ROOT_SCRIPTS = "scripts/";

function fail(message) {
  process.stderr.write(`${message}\n`);
  return { exit: 1 };
}

/** Tracked files under the repository-root `scripts/` directory, repo-relative. */
function trackedRootScripts() {
  let listed;
  try {
    listed = execFileSync("git", ["ls-files", "--", `${ROOT_SCRIPTS}*.mjs`], {
      cwd: REPO,
      encoding: "utf8",
    });
  } catch (error) {
    fail(`could not list tracked files: ${error.message}`);
    return null;
  }

  return listed
    .split("\n")
    .filter(Boolean)
    .filter((file) => file.startsWith(ROOT_SCRIPTS))
    .map((file) => ({ repoRelative: file, absolute: join(REPO, file) }))
    .filter((file) => existsSync(file.absolute));
}

const scripts = trackedRootScripts();
if (scripts === null) process.exit(1);

if (scripts.length === 0) {
  process.stdout.write(
    "scripts:check - no tracked files under the repository-root `scripts/`; nothing to examine\n",
  );
  process.exit(0);
}

process.stdout.write(
  `scripts:check - ${scripts.length} tracked file(s) under \`${ROOT_SCRIPTS}\`\n`,
);

/* ── 1. formatting, against the repository's own config ──────────────────────────────────── */

// Named rather than resolved. See the header: resolution from the root would silently apply
// Prettier's defaults, which measure a standard this repository has never claimed for these files.
const PRETTIER_CONFIG = join(FRONTEND, ".prettierrc.json");
let options;
try {
  options = await prettier.resolveConfig(PRETTIER_CONFIG);
} catch (error) {
  process.stderr.write(`could not read ${PRETTIER_CONFIG}: ${error.message}\n`);
  process.exit(1);
}

/**
 * The working-tree state of `scripts/`, as porcelain text.
 *
 * Compared before and after rather than merely asserted at the end: a developer running the gate
 * mid-edit has an already-dirty tree, and reporting that as "a prover wrote to the repository" would
 * be both wrong and enough to make people distrust the check. What matters is that *running the
 * provers changed nothing*.
 */
function workingTreeState() {
  try {
    return execFileSync("git", ["status", "--porcelain", "--", ROOT_SCRIPTS], {
      cwd: REPO,
      encoding: "utf8",
    });
  } catch (error) {
    fail(`could not read the working tree state: ${error.message}`);
    return null;
  }
}

const before = workingTreeState();
if (before === null) process.exit(1);

let failures = 0;

for (const script of scripts) {
  const source = readFileSync(script.absolute, "utf8");
  let formatted = true;
  try {
    formatted = await prettier.check(source, { ...options, filepath: script.absolute });
  } catch (error) {
    // A file Prettier cannot parse is a failure, not a skip: it is the same class of defect
    // `ps:check` exists for, and reporting it as anything else would repeat the gap this step
    // closes.
    process.stderr.write(`FAIL ${script.repoRelative}\n      could not parse: ${error.message}\n`);
    failures += 1;
    continue;
  }

  if (formatted) {
    process.stdout.write(`ok   ${script.repoRelative} (format)\n`);
    continue;
  }

  process.stderr.write(
    `FAIL ${script.repoRelative} (format)\n` +
      `      does not match ${PRETTIER_CONFIG}. Run:\n` +
      `      npm --prefix frontend exec -- prettier --config frontend/.prettierrc.json --write ${script.repoRelative}\n`,
  );
  failures += 1;
}

/* ── 2. the provers, which are run rather than merely present ────────────────────────────── */

const provers = scripts.filter((script) => script.repoRelative.endsWith(".prove.mjs"));
if (provers.length === 0) {
  process.stdout.write("scripts:check - no provers found; nothing was executed\n");
} else {
  for (const prover of provers) {
    const started = Date.now();
    let code = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [prover.absolute], {
        cwd: REPO,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      code = error.status ?? 1;
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const tally = output
      .split("\n")
      .map((line) => line.trim())
      .findLast((line) => /\d+\/\d+ sync-guard cases behaved correctly/.test(line));

    if (code === 0) {
      process.stdout.write(`ok   ${prover.repoRelative} (${tally ?? "exit 0"}, ${seconds}s)\n`);
      continue;
    }

    process.stderr.write(`FAIL ${prover.repoRelative} (exit ${code}, ${seconds}s)\n`);
    for (const line of output
      .split("\n")
      .filter((line) => line.trim())
      .slice(-20)) {
      process.stderr.write(`      ${line.trim()}\n`);
    }
    failures += 1;
  }
}

/* ── 3. the provers must not have written to the working tree ────────────────────────────── */

const after = workingTreeState();
if (after === null) process.exit(1);

if (after !== before) {
  process.stderr.write(
    `FAIL running the provers changed the repository working tree. They are contracted to mutate a\n` +
      `     temporary copy only, so this is a defect in a prover rather than a normal result.\n` +
      `     before:\n${before}     after:\n${after}`,
  );
  failures += 1;
}

if (failures > 0) {
  process.stderr.write(`\nscripts:check - ${failures} failure(s).\n`);
  process.exit(1);
}

process.stdout.write("scripts:check - all root scripts are formatted and their provers pass\n");
process.exit(0);
