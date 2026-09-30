#!/usr/bin/env node
/**
 * Parse every evidence script in this change (M15; the `evidence-parses` gate item).
 *
 * ## Why this exists
 *
 * The evidence scripts live under `openspec/`, not `frontend/`, so the project's quality
 * gates — `npm run lint`, `npm run format:check`, `npm run typecheck` — never read them.
 * That is not a stylistic complaint: a backtick inside a comment inside an interpolated
 * template literal ended a string three separate times while this change was being written,
 * and nothing failed until a flow was run. Every one of those was found by `node --check`
 * *after* the edit, which is a habit rather than a gate.
 *
 * So this runs the same check as a gate item. It parses without executing, so it costs
 * nothing and cannot start a browser.
 *
 * It is also the only check in the repository that covers a class of file the others do
 * not, and saying so is the point: a script nothing checks is a script nobody can change
 * safely.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = resolve(HERE);

/** Every `.mjs` under the evidence directory, including `lib/`. */
function scripts(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...scripts(full));
    else if (entry.name.endsWith(".mjs")) found.push(full);
  }
  return found.sort();
}

const targets = scripts(EVIDENCE);
if (targets.length === 0) {
  console.error("FAIL: no evidence scripts were found to check");
  process.exit(1);
}

let failed = 0;
for (const target of targets) {
  const outcome = spawnSync(process.execPath, ["--check", target], {
    encoding: "utf8",
  });
  const name = relative(EVIDENCE, target);
  if (outcome.status === 0) {
    console.log(`  parses  ${name} (${statSync(target).size} bytes)`);
  } else {
    failed += 1;
    console.error(`  BROKEN  ${name}`);
    console.error(`${outcome.stderr ?? ""}`.split("\n").slice(0, 8).join("\n"));
  }
}

if (failed > 0) {
  console.error(
    `FAIL: ${failed} of ${targets.length} evidence script(s) do not parse`,
  );
  process.exit(1);
}
console.log(`  all ${targets.length} evidence scripts parse.`);
