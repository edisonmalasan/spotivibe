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
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { CASES } from "./lyrics-induced-violations.cases.mjs";

const ROOT = process.cwd();

/**
 * vitest's entry point, invoked through `node` rather than through `npx`.
 *
 * `npx.cmd` on Windows returns **empty stdout and empty stderr** to a parent that asked for pipes,
 * so a harness that inspects the run's output silently gets nothing and concludes the runner broke.
 * That cost two wrong implementations before it was diagnosed by a probe that printed the byte
 * lengths. Calling the real executable is also faster and removes npx's package resolution from the
 * measurement.
 */
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");

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
  let outcome = "NOT CAUGHT";
  let detail = "";
  const reportPath = join(ROOT, ".vitest", "json", "output.json");
  try {
    // vitest is invoked through `node` on its own entry point rather than through `npx`, and its
    // JSON reporter is read from the file it writes.
    //
    // Three wrong approaches came first, and the reasons are worth keeping: matching a text
    // reporter's `FAIL <file>` line reported 0 of 18 caught on a suite where all 18 were caught (the
    // `dot` reporter prints no such line); `npx.cmd` on Windows returns **empty stdout and stderr**
    // to a piped parent, so any output inspection saw nothing; and this vitest version ignores
    // `--outputFile` for the json reporter, writing instead to `.vitest/json/output.json` and
    // printing only "JSON report written to ...". Each of those fails toward "your tests are dead",
    // which is the direction that gets a real suite deleted.
    execFileSync(process.execPath, [VITEST, "run", testCase.test, "--reporter=json"], {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 300000,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    detail = String(error.stdout ?? "") + String(error.stderr ?? "");

    // A non-zero exit is not the same thing as the test failing: a missing vitest, a syntax error in
    // the mutated file, or a bad config all exit non-zero while testing nothing. So the JSON report
    // is the authority — it must show at least one *failed assertion* in the file this case claims
    // to break. Anything else is either "not caught" or "the runner broke", and the two are kept
    // apart deliberately.
    let failedAssertions = 0;
    let ranAssertions = 0;
    let sawReport = false;
    try {
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      sawReport = true;
      for (const result of report.testResults ?? []) {
        const reported = (result.name ?? "").replace(/\\/g, "/");
        if (!reported.endsWith(testCase.test.replace(/\\/g, "/"))) continue;
        for (const assertion of result.assertionResults ?? []) {
          ranAssertions += 1;
          // `=== "failed"`, not `!== "passed"`. vitest's status set is
          // { pass, fail, only, run, skip, todo, queued } and everything except `pass` and `skip`
          // maps onto a non-"passed" label: an **interrupted or timed-out** run leaves tests as
          // `pending`/`queued`, so `!== "passed"` counted a run that never executed as a caught
          // violation. The looser comparison failed toward "your tests are broken", which is the
          // direction that deletes a correct suite.
          if (assertion.status === "failed") failedAssertions += 1;
        }
      }
    } catch {
      sawReport = false;
    }

    // **Zero assertions means the suite never ran**, which is a broken runner rather than an escaped
    // violation. Found by a probe: a case that happened to delete a trailing comma turned the route
    // into a parse error, the file reported 0 tests, and this classifier called it "not caught" —
    // i.e. it accused a correct test of being dead when the truth was that nothing had executed.
    outcome =
      !sawReport || ranAssertions === 0
        ? "RUNNER BROKE"
        : failedAssertions > 0
          ? "caught"
          : "NOT CAUGHT";
  } finally {
    // Restore unconditionally, even when the run threw for a reason other than a test failure. A
    // violation left behind in production source would be worse than no evidence at all.
    writeFileSync(file, original);
    // The report is removed rather than left in the tree: it is a build artefact, and an artefact
    // that a verification tool leaves behind is a tool that can break the gate it exists to feed.
    rmSync(reportPath, { force: true });
  }

  results.push({ ...testCase, outcome, detail });
}

console.log("");
for (const result of results) {
  const pass = result.outcome === "caught";
  console.log((pass ? "  PASS  " : "  FAIL  ") + result.name);
  console.log("          violation: " + result.why);
  console.log("          caught by:  " + result.test + "  -> " + result.outcome);
  if (!pass) {
    const firstFailure = (result.detail.match(/FAIL[^\r\n]*/) || ["(no failure line captured)"])[0];
    console.log("          the named test did not fail: " + firstFailure.trim());
  }
}

const good = results.filter((result) => result.outcome === "caught");
const escaped = results.filter((result) => result.outcome === "NOT CAUGHT");
const skipped = results.filter((result) => result.outcome === "ANCHOR NOT FOUND");
const broken = results.filter((result) => result.outcome === "RUNNER BROKE");

console.log("");
console.log(
  `  ${good.length}/${results.length} induced violations were caught by their named test`,
);
if (skipped.length > 0) console.log(`  ${skipped.length} case(s) had an unresolved anchor`);
if (broken.length > 0) {
  console.log(
    `  ${broken.length} case(s) could not be judged: the test runner itself failed, so the result proves nothing`,
  );
}
if (escaped.length > 0) {
  console.log(`  ${escaped.length} case(s) escaped: the test named for them is dead`);
}

process.exit(escaped.length === 0 && skipped.length === 0 && broken.length === 0 ? 0 : 1);
