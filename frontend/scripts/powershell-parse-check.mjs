#!/usr/bin/env node
// Parse-validate every tracked PowerShell script in the gate's reach.
//
// **Why this exists.** `run-gate-batch.ps1` is the script that runs the gate, and
// until this check existed no gate step read it. ESLint returns exit 0 for it
// carrying "File ignored because no matching configuration was supplied", and
// `prettier --check .` never asks about it because Prettier has no parser for
// `.ps1`. The only thing that caught a defect in it was running it, by hand,
// during a batch — which is to say: at the most expensive possible moment.
//
// **What it checks, and what it does not.** It parses. A clean parse means the
// file is syntactically valid; it says nothing about whether the logic is right,
// and this check does not claim otherwise. It is a floor, not a substitute for
// the behavioural cases in `tests/gate-batch-apparatus.test.ts`.
//
// **Why PowerShell's own parser rather than a dependency.** `[Parser]::ParseFile`
// ships with every PowerShell, reports file, line and `ErrorId`, and needs no
// install step in CI. Adding a PowerShell formatter or linter to reach the same
// file would add a dependency to a repository whose whole argument for leaving
// `.ps1` ungated was that nothing could read it — and now something can.
//
// **A missing interpreter is a skip, never a pass.** If no PowerShell is
// reachable the check prints why it did not run and exits 0. It does not exit 0
// silently: `verification-integrity` requires that a skipped run is never
// reported as a pass, and a bare 0 here would be exactly that.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "..");
const REPO = resolve(FRONTEND, "..");

/** Roots whose contents are frozen evidence rather than live gate tooling. */
const FROZEN_ROOTS = ["openspec/changes/archive/"];

const SKIP = { exit: 0 };

function fail(message) {
  process.stderr.write(`${message}\n`);
  return { exit: 1 };
}

/**
 * Parse one file with PowerShell's own AST parser.
 *
 * The PowerShell side emits one JSON line per parse error and sets a non-zero
 * `$LASTEXITCODE` only on failure, so a parse error and a broken invocation are
 * distinguishable rather than collapsed into one failure.
 */
function parseFile(shell, absolute) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$errors = $null",
    `$null = [System.Management.Automation.Language.Parser]::ParseFile(` +
      `'${absolute.replaceAll("'", "''")}', [ref]$null, [ref]$errors)`,
    "$out = foreach ($e in $errors) {",
    "  [pscustomobject]@{ message = $e.Message; id = $e.ErrorId; line = $e.Extent.StartLineNumber; column = $e.Extent.StartColumnNumber }",
    "}",
    "$out | ConvertTo-Json -Compress",
    "exit 0",
  ].join("\n");

  let stdout;
  try {
    stdout = execFileSync(shell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return {
      ok: false,
      detail: error.stderr ? String(error.stderr).trim() : String(error.message),
    };
  }

  const trimmed = stdout.trim();
  if (trimmed === "") return { ok: true, errors: [] };
  // PowerShell omits the array wrapper for a single element, so a bare object
  // and an array both have to be handled.
  const parsed = JSON.parse(trimmed);
  return { ok: true, errors: Array.isArray(parsed) ? parsed : [parsed] };
}

/** Locate a PowerShell interpreter, preferring `pwsh` (cross-platform). */
function findShell() {
  for (const candidate of ["pwsh", "powershell"]) {
    try {
      execFileSync(
        candidate,
        ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.Major"],
        {
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/** Tracked `.ps1` files inside the gate's reach, repo-relative. */
function trackedScripts() {
  let listed;
  try {
    listed = execFileSync("git", ["ls-files", "--", "*.ps1"], { cwd: REPO, encoding: "utf8" });
  } catch (error) {
    fail(`could not list tracked files: ${error.message}`);
    return null;
  }

  return listed
    .split("\n")
    .filter(Boolean)
    .filter((file) => !FROZEN_ROOTS.some((root) => file.startsWith(root)))
    .map((file) => ({ repoRelative: file, absolute: join(REPO, file) }))
    .filter((file) => existsSync(file.absolute));
}

const shell = findShell();
if (shell === null) {
  process.stdout.write(
    "ps:check NOT RUN - no PowerShell interpreter found on PATH (tried `pwsh` and `powershell`).\n" +
      "  This step did not examine any file. Its absence is reported, not passed over:\n" +
      "  `tests/gate-coverage.test.ts` records .ps1 as covered BY THIS STEP, so deleting the step\n" +
      "  fails the coverage guard rather than leaving the file silently unchecked.\n",
  );
  process.exit(SKIP.exit);
}

const scripts = trackedScripts();
if (scripts === null) process.exit(1);

if (scripts.length === 0) {
  process.stdout.write("ps:check - no PowerShell scripts in the gate's reach; nothing to parse\n");
  process.exit(0);
}

let failures = 0;
for (const script of scripts) {
  const result = parseFile(shell, script.absolute);
  if (!result.ok) {
    process.stderr.write(`FAIL ${script.repoRelative}\n      could not parse: ${result.detail}\n`);
    failures += 1;
    continue;
  }
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      process.stderr.write(
        `FAIL ${script.repoRelative}:${error.line}:${error.column}  ${error.id}: ${error.message}\n`,
      );
    }
    failures += 1;
    continue;
  }
  process.stdout.write(`ok   ${script.repoRelative}\n`);
}

if (failures > 0) {
  process.stderr.write(`\n${failures} PowerShell script(s) failed to parse.\n`);
  process.exit(1);
}

process.stdout.write(
  `\nok   ${scripts.length} PowerShell script(s) parsed clean, via \`${shell}\`\n` +
    "     This asserts syntax only. It does not assert the script's behaviour.\n",
);
