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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
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
