#!/usr/bin/env node
// Induced-violation harness for M16 (spec `lyrics`, `app-shell`).
//
// Why this exists: this repository has paid four separate times for a green check sitting on top of a
// live defect. A test that has never been observed to fail is a claim, not evidence. Each case in
// `./lyrics-induced-violations.cases.mjs` breaks ONE production behaviour, runs the test named for
// it, and requires that test to fail. A case that passes proves its test is dead.
//
// It is a script rather than a test because it spawns `vitest`, and running it from inside `vitest`
// would nest a test runner inside a test runner. Its guard — which asserts every anchor still
// resolves, so the harness cannot silently degrade into a wall of skips — is
// `tests/lyrics-induced-violations.test.ts`.
//
//   node scripts/lyrics-induced-violations.mjs
//
// Node built-ins only, and it writes production source while it runs. Every file it touches is
// restored in a `finally`, and the exit code is non-zero if any case escaped or any anchor was
// unresolved.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CASES } from "./lyrics-induced-violations.cases.mjs";

const ROOT = process.cwd();
const results = [];

for (const testCase of CASES) {
  const file = join(ROOT, testCase.file);
  const original = readFileSync(file, "utf8");

  if (!original.includes(testCase.from)) {
    // Reported as a failure, not a skip. A case whose anchor has moved cannot catch anything, and
    // counting it as anything but a failure is how a harness starts lying.
    results.push({ ...testCase, outcome: "ANCHOR NOT FOUND", detail: "" });
    continue;
  }

  writeFileSync(file, original.replace(testCase.from, testCase.to));
  let failed = false;
  let detail = "";
  try {
    execFileSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["vitest", "run", testCase.test, "--reporter=dot"],
      { cwd: ROOT, stdio: "pipe", timeout: 300000 },
    );
  } catch (error) {
    failed = true;
    detail = String(error.stdout ?? "") + String(error.stderr ?? "");
  } finally {
    // Restore unconditionally, even when the run threw for a reason other than a test failure. A
    // violation left behind in production source would be worse than no evidence at all.
    writeFileSync(file, original);
  }

  results.push({ ...testCase, outcome: failed ? "caught" : "NOT CAUGHT", detail });
}

console.log("");
for (const result of results) {
  const pass = result.outcome === "caught";
  console.log((pass ? "  PASS  " : "  FAIL  ") + result.name);
  console.log("          violation: " + result.why);
  console.log("          caught by:  " + result.test + "  -> " + result.outcome);
  if (!pass && result.outcome === "NOT CAUGHT") {
    const firstFailure = (result.detail.match(/FAIL[^\n\r]*/) || ["(no failure line captured)"])[0];
    console.log("          the named test did not fail: " + firstFailure.trim());
  }
}

const good = results.filter((result) => result.outcome === "caught");
const escaped = results.filter((result) => result.outcome === "NOT CAUGHT");
const skipped = results.filter((result) => result.outcome === "ANCHOR NOT FOUND");

console.log("");
console.log(
  `  ${good.length}/${results.length} induced violations were caught by their named test`,
);
if (skipped.length > 0) console.log(`  ${skipped.length} case(s) had an unresolved anchor`);
if (escaped.length > 0) {
  console.log(`  ${escaped.length} case(s) escaped: the test named for them is dead`);
}

process.exit(escaped.length === 0 && skipped.length === 0 ? 0 : 1);
