import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertNoBlockScalars,
  prepareWorkflow,
  stripWholeLineComments,
  workflowScalar,
} from "./helpers/yaml";

/**
 * The CI workflow's step order.
 *
 * ## Why this file exists
 *
 * `tests/motion-budget.test.ts` has two halves. Its manifest and import rules run
 * unconditionally; its **size** rules need a build report and skip without one. The workflow ran
 * `npm test` before `npm run build`, so on every CI run those size rules skipped and the job
 * reported green for a file whose headline is a budget.
 *
 * That is not a small gap. A named-list rule and a size rule were the only two backstops against
 * a renamed or forked animation package, and in CI only one of them was actually running. M19
 * disclosed the skip in the test file's own header, which is honest and does not make the check
 * run — a documented skip is still a check that does not run.
 *
 * ## Why the workflow is read with a purpose-built reader
 *
 * `js-yaml` is resolvable here but only transitively, and a test that breaks when a transitive
 * dependency is pruned is a test that gets deleted rather than fixed. `yaml` is not installed at
 * all. Adding a devDependency for one assertion is a worse trade than twenty lines that read the
 * structure this repository owns.
 *
 * The reader is therefore checked for completeness rather than trusted: `reads every step` asserts
 * the parsed list has exactly the steps the file declares, so a reader that silently matched
 * nothing fails instead of passing vacuously.
 *
 * ## What it deliberately does not check
 *
 * It does not check that any step *passes*. Only GitHub can run the workflow, and this repository
 * has not observed a green run on this branch. It asserts the declared order, which is the part
 * that was wrong and the part a future edit can silently undo.
 */

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const WORKFLOW = join(REPO, ".github", "workflows", "ci.yml");

interface Step {
  name: string;
  run: string | null;
}

/**
 * Read the steps of the single job, in order.
 *
 * Indentation is the structure: `steps:` sits under the job, and each step is a `- name:` entry at
 * a deeper indent. `run:` lines belong to the step above them.
 */
function readSteps(yaml: string): Step[] {
  const lines = yaml.split(/\r?\n/);
  const steps: Step[] = [];

  let inSteps = false;
  let stepsIndent = 0;
  let current: Step | null = null;

  for (const line of lines) {
    // The input is already stripped by `prepareWorkflow` at the call site, so this function does not
    // check for comments. It used to skip them here inline while three assertions later read the
    // RAW text - the file knew to distrust comments and then did not - and when the strip was fixed, the
    // comment here was left claiming a guarantee the call no longer provided. One code path, and the
    // path is named at the call site rather than described from a distance.
    if (line.trim() === "") continue;

    const indent = line.length - line.trimStart().length;

    const stepsMatch = /^(\s*)steps:\s*$/.exec(line);
    if (stepsMatch) {
      inSteps = true;
      stepsIndent = stepsMatch[1]!.length;
      continue;
    }

    if (!inSteps) continue;

    // A line at or left of `steps:` that is not a step entry has left the block.
    if (indent <= stepsIndent && !/^\s*-\s/.test(line)) {
      inSteps = false;
      continue;
    }

    const nameMatch = /^\s*-\s*name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch && indent > stepsIndent) {
      current = { name: nameMatch[1]!, run: null };
      steps.push(current);
      continue;
    }

    const runMatch = /^\s*run:\s*(.*)$/.exec(line);
    if (runMatch && current) {
      // A block scalar (`run: |` / `run: >`) would match this as the literal command `|`, recording a
      // one-character command for a multi-line script. `prepareWorkflow` refuses block scalars before
      // we get here, so reaching that value means the guard was bypassed; recording it as empty is
      // falsifiable by any assertion that requires a command, where `|` would silently pass some of them.
      current.run = /^[|>][-+0-9]*$/.test(runMatch[1]!.trim()) ? null : runMatch[1]!.trim();
      continue;
    }

    // A key that is neither `name` nor `run` ends the previous step's block. `uses:` does this, and
    // a step with only a `uses:` legitimately has no `run`, so this must not merge two steps.
    if (/^\s*-\s|^\s{2}\w+:/.test(line) && !runMatch && !nameMatch) {
      if (/^\s*-\s/.test(line)) current = null;
    }
  }

  return steps;
}

const workflow = readFileSync(WORKFLOW, "utf8");

/**
 * The workflow prepared for reading: whole-line comments gone, block scalars refused outright.
 *
 * Two rounds of the same defect sit behind this. Round 4: `toContain("node-version: 24")` on the raw
 * text was satisfied by `# node-version: 24`, so commenting out the Node pin left 3292/3292 green.
 * Round 5: the first repair stripped *trailing* comments by tracking quotes, and a plain scalar may
 * contain an apostrophe — `x: it's # node-version: 24` opened a quote that never closed, so the decoy
 * survived and all 3292 tests stayed green again.
 *
 * So this does not strip trailing comments, and the assertions below compare **values** via
 * `workflowScalar` instead of substrings. A decoy in a trailing comment is then part of the value and
 * fails an exact comparison: `node-version: x # node-version: 24` reads as `"x # node-version: 24"`,
 * not `"24"`. That fails closed on a legitimate trailing comment, which `ci.yml` has none of; when one
 * is added the test goes red and a human decides, which is the right way round.
 *
 * `workflow` stays raw for exactly one test, which checks that the workflow *explains* its
 * build-before-test ordering and the budget it mentions. There the comment is the subject.
 */
const workflowCode = prepareWorkflow(workflow);
const steps = readSteps(workflowCode);
const indexOfStep = (needle: string): number =>
  steps.findIndex((step) => (step.run ?? "").includes(needle));

describe("the workflow reader is witnessed on input the real workflow does not contain", () => {
  // Each of these guards is a claim about a shape `ci.yml` does not currently have. Without a
  // synthetic witness they are all trivially green, and a guard that has never been seen to fire is
  // indistinguishable from no guard.
  it("refuses a block scalar rather than deleting its body", () => {
    expect(() => assertNoBlockScalars("        run: |\n          npm test\n")).toThrow(
      /block scalar/,
    );
    expect(() => assertNoBlockScalars("        run: >-\n          npm test\n")).toThrow(
      /block scalar/,
    );
    // The case that motivated refusing rather than stripping: inside a literal body a `#` is content,
    // so removing that line would delete a real command.
    const withHashInBody = ["        run: |", "          # not a comment, a command", ""].join(
      "\n",
    );
    expect(() => assertNoBlockScalars(withHashInBody)).toThrow(/block scalar/);
    expect(() => assertNoBlockScalars("        run: npm test\n")).not.toThrow();
  });

  it("removes whole-line comments and nothing else", () => {
    const yaml = [
      "# a whole-line comment",
      "        node-version: 24",
      '        run: echo "it\'s # not a comment"',
      "   # indented whole-line comment",
    ].join("\n");
    expect(stripWholeLineComments(yaml)).toBe(
      ["        node-version: 24", '        run: echo "it\'s # not a comment"'].join("\n"),
    );
  });

  it("reads a scalar as the whole rest of the line, so a trailing decoy is part of the value", () => {
    // The property the value-level assertions depend on. If this ever returned `"24"` for a decoy, the
    // whole repair would be back to a substring match wearing a value comparison's clothes.
    expect(workflowScalar("        node-version: 24", "node-version")).toBe("24");
    expect(workflowScalar("        node-version: x # node-version: 24", "node-version")).toBe(
      "x # node-version: 24",
    );
    expect(workflowScalar("        node-version: 24 # pinned", "node-version")).toBe("24 # pinned");
    expect(workflowScalar('        cache: "a#b"', "cache")).toBe("a#b");
    expect(workflowScalar("        node-version: 24", "absent-key")).toBeNull();
  });
});

describe("every gate that runs these steps builds before it tests", () => {
  // ## Why the release gate is in this file
  //
  // M21 moved the build ahead of the tests in `.github/workflows/ci.yml` and added this suite to
  // assert it. The suite read **only the workflow file**. The release gate — the artifact this whole
  // change exists to harden — ran `npm test` at line 108 and `npm run build` at line 115, so it kept
  // the defect the change was about while a passing check sat next to it looking as though it covered
  // it. Independent verification caught this; it is the same lesson as §1's cascade guard, and the
  // same as the arm scraper: **a check pointed at one file says nothing about the other file that does
  // the same work.**
  //
  // The gate's items are read structurally — `id:` keys in source order — rather than by searching for
  // `npm test` text, so a comment mentioning the order cannot satisfy the assertion.

  const gate = readFileSync(
    join(
      REPO,
      "openspec",
      "changes",
      "archive",
      "2026-09-30-add-release-validation-and-deployment",
      "evidence",
      "release-gate.mjs",
    ),
    "utf8",
  );

  /**
   * The `id:` of every gate item, in the order the array declares them.
   *
   * **The indent in this pattern is decorative today, and that is recorded rather than implied.**
   * Loosening `^\s{4}id:` to `id:` leaves the suite green, because the gate contains no other
   * `id: "..."` for it to pick up. It is kept because a differently-indented item would be a real
   * change to the file's shape and would then be *missed* rather than reported - but nothing here
   * should be read as claiming the indent is what proves the scan worked.
   *
   * That is `toHaveLength(26)` below. This regex decides which keys are read and in what order; the
   * length assertion decides whether the read was complete. Confusing the two is how a scan that
   * matched three of twenty-six items gets described as a structural check.
   */
  const gateItemIds = [...gate.matchAll(/^\s{4}id: "([^"]+)",$/gm)].map((match) => match[1]!);

  it("reads every gate item the file declares", () => {
    // The same anti-vacuity guard as the workflow reader above. If the scan matched nothing, both
    // indexes would be -1 and `-1 < -1` is false... which would fail here rather than pass, but only
    // by accident. Stated explicitly so the guard does not depend on that accident.
    expect(gateItemIds.length, "the gate's items must have been found").toBeGreaterThan(20);
    // M21 task 1.1 recorded "24 items"; the file declares 26. The count is asserted rather than
    // restated so the two cannot disagree again.
    expect(gateItemIds).toHaveLength(26);
  });

  it("produces the production build before running the tests", () => {
    const build = gateItemIds.indexOf("gates-build");
    const test = gateItemIds.indexOf("gates-tests");
    expect(build).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(-1);
    expect(
      build,
      "the gate must build before it tests, or the size budget silently skips",
    ).toBeLessThan(test);
  });

  it("runs the static checks before the build", () => {
    const build = gateItemIds.indexOf("gates-build");
    for (const item of ["gates-lint", "gates-format", "gates-typecheck"]) {
      const at = gateItemIds.indexOf(item);
      expect(at, `${item} must be a declared gate item`).toBeGreaterThan(-1);
      expect(at, `${item} must precede the build`).toBeLessThan(build);
    }
  });
});

describe("the CI workflow's steps", () => {
  it("reads every step the file declares", () => {
    // The reader is load-bearing for all four ordering assertions below, so it is checked first.
    // If it matched nothing, every `indexOfStep` would return -1 and the ordering assertions
    // would compare two identical numbers and pass. This is the assertion that prevents that.
    expect(steps).not.toHaveLength(0);
    expect(steps.map((step) => step.name)).toEqual([
      "Checkout",
      "Setup Node.js",
      "Install dependencies",
      "Lint",
      "Format check",
      "Typecheck",
      "Production build",
      "Unit tests",
    ]);
  });

  it("is proven able to fail", () => {
    // Every ordering assertion here is a comparison of two indexes, and a comparison of -1 with
    // -1 is true. This confirms the indexes are real, distinct numbers rather than missing ones.
    const build = indexOfStep("npm run build");
    const test = indexOfStep("npm test");
    expect(build).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(-1);
    expect(build).not.toBe(test);
  });

  it("produces the production build before running the tests", () => {
    // The fix. With the tests first, M19's bundle-size assertions skipped on every CI run.
    const build = indexOfStep("npm run build");
    const test = indexOfStep("npm test");
    expect(build).toBeLessThan(test);
  });

  it("runs the static checks before the build, so a bad commit fails on the cheap gate first", () => {
    // The ordering the build move must not have disturbed. Linting after a production build would
    // spend minutes of CI to report a stray semicolon.
    expect(indexOfStep("npm run lint")).toBeLessThan(indexOfStep("npm run build"));
    expect(indexOfStep("npm run format:check")).toBeLessThan(indexOfStep("npm run build"));
    expect(indexOfStep("npm run typecheck")).toBeLessThan(indexOfStep("npm run build"));
  });

  it("installs from the lockfile exactly once", () => {
    // `npm ci` in CI is correct and is not the defect this change is about: a CI runner's working
    // tree is disposable, so deleting `node_modules` there costs nothing. The defect was doing it
    // in a *developer's* tree. Asserted so a future edit adding a second install is noticed, and so
    // nobody reads this file as an argument against CI installs.
    const installs = steps.filter((step) => (step.run ?? "").trim() === "npm ci");
    expect(installs).toHaveLength(1);
  });

  it("keeps the Node pin, the cache path and the repository contract in agreement", () => {
    // Not re-derived here: `tests/deployment-contract.test.ts` already asserts that `engines.node`,
    // `package.json` and this workflow agree, and it proves itself by rejecting a pin Vercel
    // cannot build. Duplicating it would be a second place for the value to drift.
    // Compared as **values**, not as substrings. `node-version: 24` present *somewhere* in the file is
    // not the claim; `node-version`'s value being `24` is. A substring check is what let a comment
    // satisfy the assertion twice, and a value check cannot be satisfied by text after the value.
    expect(workflowScalar(workflowCode, "node-version")).toBe("24");
    expect(workflowScalar(workflowCode, "cache-dependency-path")).toBe(
      "frontend/package-lock.json",
    );
    expect(workflowScalar(workflowCode, "working-directory")).toBe("frontend");
  });

  it("states why the build comes first, in the workflow rather than only in a test comment", () => {
    // A comment in the test file is where this was disclosed for a whole milestone. The
    // disclosure belongs next to the thing it explains, or the next person reorders the steps
    // having read only the file they were editing.
    // Raw text, and deliberately: `motion-budget` appears in `ci.yml` only inside the comment that
    // explains why the build precedes the tests. This asserts the workflow *documents* the budget's
    // two halves, not that it runs anything about it - there is no executable reference to it. Moving it
    // to `workflowCode` would have looked like fixing the strip and would have deleted the check.
    expect(workflow).toContain("motion-budget.test.ts");
    // Raw text, and these are the only two assertions in the file that read `workflow`. Both check that
    // comment is the subject here. Every other content assertion in this file reads `workflowCode`.
    expect(workflow).toContain("The build runs **before** the tests");
  });
});
