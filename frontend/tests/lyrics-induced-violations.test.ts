import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CASES } from "../scripts/lyrics-induced-violations.cases.mjs";

/**
 * Guard for the M16 induced-violation harness.
 *
 * `scripts/lyrics-induced-violations.mjs` proves the tests written for the lyrics capability can
 * actually fail: it breaks one production behaviour at a time, runs the test named for that
 * behaviour, and requires it to fail. The cases now span three milestones — M16's lyrics work and
 * M17's home-discovery work — and the harness's own printed count is the authority for how many
 * were caught.
 *
 * The number in this sentence has gone stale twice — once when cases were added and the docstring was
 * not, and once when pass 4 fixed a stale "Eighteen" here and added a case in the same commit. It is
 * a claim about a number, and the fifth verification pass caught the second instance, so it is stated
 * here to be checked against the harness's own output rather than trusted.
 *
 * **Why the harness is a script and not a test.** It spawns vitest, so running it from inside vitest
 * would nest a test runner inside a test runner, and its several-minute cost is not something to add
 * to every local run or to CI.
 *
 * **Why it then needs a test.** A harness that silently degrades is worse than none. Its cases live
 * in `scripts/lyrics-induced-violations.cases.mjs` — imported here rather than parsed out of the
 * harness's source, because the first version of this guard did exactly that with a regex, matched 4
 * of the 11 cases, and reported "4 of 11" instead of reporting that its own parser was broken. What
 * it must still guarantee is that every anchor resolves — an unresolved anchor makes a case *skip*,
 * and the harness now reports a skip as a failure with its own exit-code contribution, because a skip
 * that is counted as neither a pass nor a failure is how a harness starts lying quietly.
 *
 * **This harness has already earned its keep twice.** It reported 18/18 while its classifier was
 * reading the `dot` reporter's output, which contains no `FAIL <file>` line at all; and it reported
 * an "escape" for a case whose violation had turned a source file into a parse error, so zero tests
 * had run. Both were caught by running it and reading the number — which is the only reason it
 * exists.
 */

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..");

describe("the M16 induced-violation harness (spec lyrics)", () => {
  it("carries the thirty-six cases the evidence records", () => {
    // A floor rather than an exact count: adding a case is the expected way to grow this, but a
    // harness that has lost its cases must fail rather than report a vacuous pass.
    //
    // The M17 home-discovery change added **eight** cases, taking the count from twenty-two to
    // thirty: the band's effect on seeds, the one generator for a card, the honest-name rule,
    // deferred composition, the filter's subset property, the unrecognised-filter fallback, and
    // Quick Pick resolvability. (An earlier version of this comment said *seven* while the diff
    // added eight — a sentence about a number, wrong without anything to notice.)
    //
    // The M17 verification pass added **six** more for the time-aware shelf's activation, taking it
    // to thirty-six: composition on render, an activation that composes nothing, the band's seeds
    // dropped from the composed profile, the band's label riding along in the request, a
    // `data-band` attribute that never reaches the DOM, and motion added to the new action. As with
    // every number in this file, it is stated here to be checked against the harness's own output
    // rather than trusted.
    expect(CASES.length).toBeGreaterThanOrEqual(36);
  });

  it("gives every case a distinct name, so a result identifies which behaviour it broke", () => {
    const names = CASES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("records why each violation matters", () => {
    // A case with no stated consequence is a case nobody can triage when it unexpectedly passes.
    for (const entry of CASES) {
      expect(entry.why.length, `${entry.name} must record why it matters`).toBeGreaterThan(20);
    }
  });

  it("points every case at a test file that exists", () => {
    for (const entry of CASES) {
      expect(existsSync(join(frontend, entry.test)), `${entry.name} -> ${entry.test}`).toBe(true);
    }
  });

  it("points every case at a source file that exists", () => {
    for (const entry of CASES) {
      expect(existsSync(join(frontend, entry.file)), `${entry.name} -> ${entry.file}`).toBe(true);
    }
  });

  it("resolves every anchor, so no case can silently skip", () => {
    // The one condition the harness cannot check about itself. An unresolved anchor means the case
    // breaks nothing, so it can never be caught — and a case that cannot be caught must not be
    // counted as one that was.
    for (const entry of CASES) {
      const source = readFileSync(join(frontend, entry.file), "utf8");
      expect(
        source.includes(entry.from),
        `${entry.name}: anchor not found in ${entry.file}. The harness would skip this case.`,
      ).toBe(true);
    }
  });

  it("breaks one behaviour per case, in a file the milestone actually wrote", () => {
    // Every case is an edit to production source that one named test must notice. Two
    // shape properties are asserted here rather than left to the harness run, because
    // the harness only notices them when they happen to be *this* case's failure:
    //
    // - an anchor must resolve to exactly **one** place in the file. Zero means the
    //   harness would silently skip the case; more than one means it edits whichever
    //   came first, which is a different behaviour from the one the case describes.
    // - the edited text must differ, which the `changes the source for every case`
    //   case below already covers. What is added here is the uniqueness.
    for (const entry of CASES) {
      const source = readFileSync(join(frontend, entry.file), "utf8");
      const occurrences = source.split(entry.from).length - 1;
      expect(occurrences, `${entry.name}: anchor must resolve exactly once`).toBe(1);
    }
  });

  it("reports an unresolved anchor as a failure, not a skip", () => {
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    expect(harness).toContain('"ANCHOR NOT FOUND"');
    expect(harness).toContain("skipped.length === 0");
  });

  it("changes the source for every case, so no case is a no-op", () => {
    // A case whose `to` equals its `from` would break nothing and could never fail, which would
    // read as a caught violation while testing nothing.
    for (const entry of CASES) {
      expect(entry.to, `${entry.name} must actually change something`).not.toBe(entry.from);
    }
  });

  it("uses a distinct file+anchor for every case, so no case can mask another", () => {
    const targets = CASES.map((entry) => `${entry.file}::${entry.from}`);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it("restores every file it modifies, unconditionally", () => {
    // The harness writes production source, so a crash between the violation and the restore would
    // leave a broken tree. Asserting the `finally` makes removing it a deliberate act.
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    expect(harness).toContain("finally {");
    // ESM, so the import is bare rather than `fs.writeFileSync` — the assertion has to name what the
    // file actually says, or it stops being an assertion at all.
    expect(harness).toContain("writeFileSync(file, original);");
  });

  it("exits non-zero when a case escapes or an anchor is unresolved", () => {
    // Otherwise "some violations escaped" is indistinguishable from "all were caught".
    //
    // Both sides are whitespace-normalised, which is not fussiness: an assertion on the harness's
    // exact line breaks breaks the moment anyone runs a formatter over it, and a guard that breaks
    // for cosmetic reasons is a guard that gets deleted rather than fixed.
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    const squeezed = harness.replace(/\s+/g, " ");
    expect(squeezed).toContain(
      "process.exit(escaped.length === 0 && skipped.length === 0 && broken.length === 0 ? 0 : 1);",
    );
  });

  it("distinguishes a failing test from a broken runner", () => {
    // Without this the harness records a non-zero exit as "caught" — and a missing vitest, a syntax
    // error in the mutated file, or a bad config all exit non-zero while testing nothing. That is a
    // machine which prints 18/18 while proving less than ever, so the distinction has its own
    // outcome and its own exit-code contribution.
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    expect(harness).toContain('"RUNNER BROKE"');
    expect(harness).toContain("broken.length === 0");
  });

  it("treats a suite that ran zero assertions as a broken runner, not an escape", () => {
    // Found by a probe, not by reading. A case that happened to delete a trailing comma turned a
    // source file into a parse error; the test file reported 0 tests, and the classifier called that
    // "not caught" — accusing a correct test of being dead when the truth was that nothing had run.
    // The failure mode is the worst kind for a detector: it reports a broken harness as a working one.
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    expect(harness).toContain("ranAssertions === 0");
  });

  it("invokes vitest through node, not through npx", () => {
    // `npx.cmd` on Windows returns **empty stdout and stderr** to a parent that asked for pipes, so
    // a harness that inspects the run's output silently gets nothing. That cost two wrong
    // implementations before a probe printed the byte lengths. Calling the real executable also
    // removes npx's package resolution from the measurement.
    //
    // Comments are stripped before the check: the harness *explains* at length why it avoids npx, and
    // an assertion that cannot tell prose from code would fail on its own documentation.
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    const code = harness.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(harness).toContain("process.execPath");
    expect(code).not.toContain("npx");
  });

  it("reads the JSON report from the path this vitest version actually writes", () => {
    // `--reporter=json --outputFile=...` is silently ignored by this vitest: it writes to
    // `.vitest/json/output.json` and prints only "JSON report written to ...". A harness that
    // assumes the flag works reads nothing and reports every case as unjudgeable.
    const harness = readFileSync(
      join(frontend, "scripts", "lyrics-induced-violations.mjs"),
      "utf8",
    );
    expect(harness).toContain('join(ROOT, ".vitest", "json", "output.json")');
  });

  /**
   * The one behavioural check, and the reason the string assertions above are not the whole story.
   *
   * Those read the harness's source, which is the pattern this file's own header calls fragile. This
   * instead *runs* the classifier's decision rule — including the file-scoping step, which is what
   * stops a failure in some *other* test file counting as coverage.
   *
   * **This is a hand-copied duplicate of the harness's rule, and that is a known structural risk.**
   * It was checked against the harness line by line and is currently faithful, but editing the
   * harness does not fail this check — which is the defect the string assertions have too. The
   * proper fix is a single shared exported predicate, which is a small refactor of the harness; until
   * then, treat a `scripts/lyrics-induced-violations.mjs` edit as requiring a manual re-read of the
   * block below. A previous version of this check had already drifted, which is how the risk was
   * confirmed rather than assumed.
   */
  it("classifies a run the way the harness does, including scoping and interrupted runs", () => {
    const classify = (report: string, testFile: string): string => {
      let failedAssertions = 0;
      let ranAssertions = 0;
      let sawReport = false;
      try {
        const parsed = JSON.parse(report);
        sawReport = true;
        for (const result of parsed.testResults ?? []) {
          const reported = (result.name ?? "").replace(/\\/g, "/");
          if (!reported.endsWith(testFile.replace(/\\/g, "/"))) continue;
          for (const assertion of result.assertionResults ?? []) {
            ranAssertions += 1;
            if (assertion.status === "failed") failedAssertions += 1;
          }
        }
      } catch {
        sawReport = false;
      }
      if (!sawReport || ranAssertions === 0) return "RUNNER BROKE";
      return failedAssertions > 0 ? "caught" : "NOT CAUGHT";
    };

    const suite = (name: string, statuses: string[]) =>
      JSON.stringify({
        testResults: [
          { name: "/x/" + name, assertionResults: statuses.map((status) => ({ status })) },
        ],
      });

    // A suite that ran and passed: nothing was caught.
    expect(classify(suite("tests/a.test.ts", ["passed", "passed"]), "tests/a.test.ts")).toBe(
      "NOT CAUGHT",
    );

    // A suite that ran and genuinely failed: caught.
    expect(classify(suite("tests/a.test.ts", ["passed", "failed"]), "tests/a.test.ts")).toBe(
      "caught",
    );

    // A suite that never ran: the runner broke, which is not an escape.
    expect(classify(suite("tests/a.test.ts", []), "tests/a.test.ts")).toBe("RUNNER BROKE");

    // No report at all: also a broken runner.
    expect(classify("not json", "tests/a.test.ts")).toBe("RUNNER BROKE");

    // **Scoping.** A failure in a *different* file must not count as coverage for this one. Without
    // the scoping step this returns "caught" for a case whose named test never ran.
    expect(classify(suite("tests/other.test.ts", ["failed"]), "tests/a.test.ts")).toBe(
      "RUNNER BROKE",
    );

    // An interrupted or timed-out run leaves "pending"/"queued", not "failed", and must not be
    // counted as caught.
    expect(classify(suite("tests/a.test.ts", ["pending", "queued"]), "tests/a.test.ts")).toBe(
      "NOT CAUGHT",
    );

    // A skipped test is not a failure either.
    expect(classify(suite("tests/a.test.ts", ["passed", "skipped"]), "tests/a.test.ts")).toBe(
      "NOT CAUGHT",
    );
  });
});
