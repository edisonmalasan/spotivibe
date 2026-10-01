#!/usr/bin/env node
/**
 * Run M15's release gate against the current repository (task 5.4).
 *
 * ## Why this file exists
 *
 * The release gate is M15's instrument, and it is archived with that change — correctly,
 * because it is the record of what M15 shipped. It cannot be edited to suit each later
 * caller, and it locates the repository by counting directories from its own location, which
 * archiving moved one level too deep. Rather than edit archived evidence a second time
 * *and* keep a private copy of the gate, this runner tells the archived one where the
 * repository is and which change directory is current.
 *
 * So the gate has exactly one implementation, it stays the M15 record, and the two overrides
 * it gained are one line each with the reason inline. Duplicating the gate here would be the
 * failure M15's own design decision 1 exists to prevent.
 *
 * Note that `SPOTIVIBE_CHANGE` names **M15's** archived change directory. The gate's items
 * invoke M15's evidence scripts by path, so this runner runs those instruments rather than
 * providing substitutes of its own.
 *
 * ## What it does and does not add
 *
 * Nothing. It sets two environment variables and delegates, so the gate's output, its
 * arithmetic, and its honesty properties are the gate's own. What it does *not* do is add the
 * two things this repository's runtime correction changed — the root-level commands and the
 * Node 24 target — to the gate's checklist, because that checklist is the roadmap's release
 * checklist and it reads it from `ROADMAP.md`. A check for a new concern is a new gate item,
 * not a thing this runner should smuggle in.
 *
 * Usage: node openspec/changes/align-vercel-runtime-and-root-commands/evidence/release-gate.mjs [--skip-browser]
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up looking for the repository, rather than counting directories.
 *
 * This file's first version used `resolve(HERE, "../../../..")`, which is correct while the
 * change is active and wrong the moment it is archived — and this change is about to be
 * archived. That is precisely the defect this runner's own header documents at length: M15's
 * three harnesses each needed a patch for it, and `harness.mjs` carries a comment saying the
 * real fix belongs in the harness design rather than in another patch.
 *
 * Writing the fourth instance of that bug while explaining why it is a bug would be absurd, so
 * this file walks up for a marker instead. A marker cannot rot when a directory moves, and the
 * error message names what was searched for rather than a path the caller has to reverse
 * -engineer.
 */
function findRepo(from) {
  let current = from;
  for (;;) {
    // `openspec/specs` exists only at the repository root, and is a more specific marker than
    // `package.json` — the application package has one of those too.
    if (existsSync(join(current, "openspec", "specs"))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `could not find the repository root above ${from}: no ancestor contains openspec/specs`,
      );
    }
    current = parent;
  }
}

const REPO = process.env.SPOTIVIBE_REPO
  ? resolve(process.env.SPOTIVIBE_REPO)
  : findRepo(HERE);
const M15 = join(
  REPO,
  "openspec",
  "changes",
  "archive",
  "2026-09-30-add-release-validation-and-deployment",
);
const GATE = join(M15, "evidence", "release-gate.mjs");

const outcome = spawnSync(process.execPath, [GATE, ...process.argv.slice(2)], {
  cwd: REPO,
  stdio: "inherit",
  // The two overrides. `SPOTIVIBE_REPO` is the same name `audit.mjs` already accepts, so
  // the measurement harness and the gate now take their repository root the same way.
  //
  // `SPOTIVIBE_CHANGE` names **M15's** change directory, not this one, and the first version
  // of this runner got that wrong. The gate's checklist items invoke M15's own evidence
  // scripts by path — `check-parses.mjs`, `end-to-end.mjs` — so pointing it here made three
  // items fail in 0.1–0.3 seconds each, which is what a missing file looks like from the
  // gate's output. They are M15's instruments; this change runs them rather than
  // reimplementing them.
  env: {
    ...process.env,
    SPOTIVIBE_REPO: REPO,
    SPOTIVIBE_CHANGE: M15,
  },
});

process.exitCode = outcome.status ?? 1;
