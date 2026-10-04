import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertNoBlockScalars,
  jobRunDefaults,
  prepareWorkflow,
  scalarValue,
  stepWith,
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
 * a deeper indent. **A step's `run:` is a direct child of its `- name:` line**, which is the rule round 9
 * added; `run:` lines used to be attributed to "the step above them" purely by position.
 */
function readSteps(yaml: string): Step[] {
  const lines = yaml.split(/\r?\n/);
  const steps: Step[] = [];

  let inSteps = false;
  let stepsIndent = 0;
  let current: Step | null = null;
  // The indent of the current step's direct children — the indent of the first non-blank line after its
  // `- name:` line. Derived rather than assumed as `stepIndent + 2` so the reader does not encode one
  // workflow's indentation style as a rule.
  let childIndent: number | null = null;

  for (const [index, line] of lines.entries()) {
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
      childIndent = null;
      steps.push(current);
      continue;
    }

    if (current !== null && childIndent === null && indent > stepsIndent) {
      childIndent = indent;
    }

    const runMatch = /^\s*run:\s*(.*)$/.exec(line);
    if (runMatch) {
      // **Round 9's CRITICAL: `run:` had no indentation scope at all.** Any `run:` line anywhere under the
      // open step was recorded as *that step's command*, including one nested inside the step's own `env:`
      // or `with:`. Proven live, composed with the real gate becoming non-blocking:
      //
      //     - name: Checkout
      //       uses: actions/checkout@v7
      //       env:
      //         run: npm run lint      # an ENV VAR, not a command
      //     …
      //     - name: Lint
      //       run: npm run lint || true
      //
      // `js-yaml` says step 0 has keys `[name, uses, env]`, has no `run` command at all, and that the lint
      // step's command is `npm run lint || true`. `readSteps` reported the env var as the Checkout step's
      // command, so `stepsRunning(steps, "npm run lint")` found exactly one step — a step that runs nothing
      // — and every ordering assertion held. **21/21 green in the file, 3306/3306 across the suite, with the
      // lint gate unable to fail CI.**
      //
      // Round 8 unified the *comparison* (exact command equality) and left the *attribution* positional,
      // which is the level directly beneath it. `current` was simply "the most recent `- name:` line" —
      // the same certainty `findIndex` expressed, in a signature that cannot say "I am not sure".
      //
      // The rule now: a step's `run:` is a **direct child** of its `- name:` line, by indent. Deeper is
      // somebody else's key, and this refuses rather than absorbing it — an `env:` variable called `run` is
      // exactly the shape that made the old reader certain, and certainty is the defect.
      const indent = line.length - line.trimStart().length;

      if (current === null || childIndent === null || indent !== childIndent) {
        throw new Error(
          `line ${index + 1}: a 'run:' key that is not a direct child of a step. ` +
            `The step above is '${current?.name ?? "(none)"}' and its direct children are at indent ` +
            `${childIndent ?? "(unknown)"}; this one is at ${indent}. Absorbing it would read a ` +
            "mapping nested inside the step -- an 'env:' variable named 'run', say -- as the step's " +
            "command, and that is the shape round 9's CRITICAL used.",
        );
      }

      if (current.run !== null) {
        throw new Error(
          `line ${index + 1}: step '${current.name}' declares 'run:' twice. ` +
            "The later one used to overwrite the earlier, so the step's command was whichever came last " +
            "in the file rather than the one the step declares.",
        );
      }

      // A block scalar (`run: |` / `run: >`) would match this as the literal command `|`, recording a
      // one-character command for a multi-line script. `prepareWorkflow` refuses block scalars before
      // we get here, so reaching that value means the guard was bypassed; recording it as empty is
      // falsifiable by any assertion that requires a command, where `|` would silently pass some of them.
      current.run = /^[|>][-+0-9]*$/.test(runMatch[1]!.trim()) ? null : runMatch[1]!.trim();
      continue;
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

/**
 * Every command the workflow claims to run, in the order it claims. Declared once so the ordering
 * assertions and the witness that guards them cannot disagree about what the list is — the same
 * reason the round-3 repair stopped scraping a value the file already held.
 */
const GATES = [
  "npm ci",
  "npm run lint",
  "npm run format:check",
  "npm run typecheck",
  "npm run build",
  "npm test",
];

/**
 * The steps whose **whole command** is `command`.
 *
 * This is the single definition of "a step that runs the gate", and both the ordering lookups and the
 * once-per-gate count go through it. Round 7 generalised the count to exact equality while leaving the
 * lookups on `.includes`, which put a strict rule and a loose rule in one file for one question — the
 * exact shape of the WARNING it had just closed, where `npm ci` was compared by equality and the other
 * five by substring. See `indexOfStep` for what that cost.
 */
const stepsRunning = (list: Step[], command: string): Step[] =>
  list.filter((step) => (step.run ?? "").trim() === command);

/**
 * Index of the step running `needle`, throwing if there is none and refusing if there is more than one.
 *
 * **Two defects, one per round, and the second was created by repairing the first.**
 *
 * Round 6: this returned `-1`, and `-1` is less than every real index, so an ordering assertion naming a
 * step that does not exist was vacuously true. `npm run lint` could be replaced with
 * `echo lint is disabled for now`, `npm run typecheck` with `echo typecheck deferred`, and `npm run lint`
 * with `npx eslint .` — all green, all while the gate the workflow claims to run no longer ran.
 *
 * Round 8: it matched by **substring**, first match winning. So a step that merely *spells* a gate can
 * stand in for the step that *runs* it. Proven live, in three composed edits — a decoy step early whose
 * `run:` mentions `npm run lint`, the real Lint step moved to **after** the production build, and the
 * expected step-name list updated to agree:
 *
 *     Gate summary -> Checkout -> Setup Node.js -> Install dependencies -> Format check ->
 *     Typecheck -> Production build -> Lint -> Unit tests
 *
 * `runs the static checks before the build` compares `indexOfStep("npm run lint")` — the **decoy's** index,
 * 0 — against the build's, and passes. **37/37 green, with lint running after the build.** The claim
 * "lint runs before build" was false in the file and true in the assertion.
 *
 * The single-edit version of that probe is caught, by `reads every step the file declares` — which pins
 * the ordered name list. That is *incidental* safety, a consumer's guarantee rather than this function's,
 * and the third edit removes it. Round 7 recorded the identical distinction for `stepWith`, so the pattern
 * is now named rather than rediscovered: **a helper's safety that lives in a different assertion is not the
 * helper's safety.**
 *
 * Hence: exact command equality, and a **throw** rather than a first match when two steps run it — the
 * same "refuse rather than choose" rule `helpers/yaml.ts` now applies at every level of a scoped lookup.
 */
const indexOfStep = (needle: string): number => indexOfRunning(steps, needle);

const indexOfRunning = (list: Step[], needle: string): number => {
  const running = stepsRunning(list, needle);

  if (running.length === 0) {
    throw new Error(
      `no step runs \`${needle}\` as its whole command. An absent step used to read as index -1, and -1 ` +
        "is less than every real index, so every ordering assertion naming it passed without checking " +
        "anything; and a step that merely spells the gate used to be accepted as one running it.",
    );
  }

  if (running.length > 1) {
    throw new Error(
      `refusing to read the position of \`${needle}\`: ${running.length} steps run it as their whole ` +
        `command (${running.map((step) => `\`${step.name}\``).join(", ")}). Which one an ordering ` +
        "assertion is talking about is not decidable from the workflow, and taking the first would be " +
        "answering on the decoy's behalf.",
    );
  }

  return list.indexOf(running[0]!);
};

describe("the workflow reader is witnessed on the shapes that actually failed", () => {
  // Round 5's three witnesses all fed the helper a single line. That proved trailing-decoy handling and
  // nothing else, and round 6 walked straight through the gap: an earlier line elsewhere in the document.
  // Every witness below is multi-line for that reason.

  it("reads a step's inputs and nothing outside them", () => {
    const yaml = [
      "    env:",
      '      NODE_VERSION: "24"',
      "    steps:",
      "      - name: Setup Node.js",
      "        uses: actions/setup-node@v7",
      "        with:",
      "          node-version: 22",
      "      - name: Something else",
      "        with:",
      "          node-version: 20",
    ].join("\n");

    const inputs = stepWith(yaml, "Setup Node.js");
    expect(inputs, "the named step's inputs must be found").not.toBeNull();
    expect(workflowScalar(inputs!, "node-version")).toBe("22");

    // A whole-document read is now **refused outright**, not merely out-ranked. It used to answer `24`:
    // the `env:` decoy is earlier and first-wins. So round 6's defeat needed two things at once — a
    // whole-document scope *and* a single occurrence of the key — and either one alone is now fatal.
    // This is on synthetic input so the witness does not depend on what `ci.yml` contains.
    expect(() => workflowScalar(yaml, "node-version")).toThrow(/appears 2 times/);

    // And the second step's value is not reachable through the first step's scope.
    expect(workflowScalar(inputs!, "node-version")).not.toBe("20");
    expect(stepWith(yaml, "No Such Step")).toBeNull();
  });

  it("reads the job's run defaults rather than any working-directory in the file", () => {
    const yaml = [
      "jobs:",
      "  quality-gates:",
      "    defaults:",
      "      run:",
      "        working-directory: frontend",
      "    steps:",
      "      - name: Lint",
      "        run: npm run lint",
      "        working-directory: frontend",
    ].join("\n");
    const defaults = jobRunDefaults(yaml);
    expect(defaults).not.toBeNull();
    expect(workflowScalar(defaults!, "working-directory")).toBe("frontend");
    // A workflow with no `jobs:` at all, and one whose single job has no `defaults:`, are both "no such
    // scope" rather than an error. Round 7 made the *ambiguous* case loud; the *absent* case stays
    // quiet, because absent and undecidable are different claims and only one of them is a defect.
    expect(jobRunDefaults("    steps: []")).toBeNull();
    expect(jobRunDefaults(["jobs:", "  quality-gates:", "    steps: []"].join("\n"))).toBeNull();
  });

  it("refuses a repeated key rather than resolving it by position", () => {
    // Position is the thing a decoy manipulates. Taking the first of two occurrences IS the round-6
    // defect, so a repeated key is stopped and the line numbers are named.
    expect(() => scalarValue("  node-version: 24\n  node-version: 22", "node-version")).toThrow(
      /appears 2 times/,
    );
    expect(() => scalarValue("  node-version: 24\n  node-version: 22", "node-version")).toThrow(
      /lines 1, 2/,
    );
    expect(() => scalarValue("  cache: npm", "node-version")).not.toThrow();
    expect(scalarValue("  cache: npm", "node-version")).toBeNull();
  });

  it("keeps quoting and trailing text out of the value only by refusing them", () => {
    // Retained from round 5: still true, and still the reason the scope work is not enough on its own.
    expect(workflowScalar("        node-version: x # node-version: 24", "node-version")).toBe(
      "x # node-version: 24",
    );
    expect(workflowScalar('        cache: "a#b"', "cache")).toBe("a#b");
  });
});

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

    // **Round 7's WARNING B, reproduced.** The pattern above required the indicator to be the last
    // thing on the line, so a trailing comment on the *header* walked straight past the guard — and
    // then the stripper deleted a real command from the literal body. That is the outcome this whole
    // function exists to prevent, reached by spelling the header the way YAML permits:
    //
    //     run: | # the unit tests
    //       # a literal command
    //       npm test
    //
    // A YAML block header may carry a comment after the indicator, so the comment is part of the header.
    // A guard that only recognises the tidy spelling of the thing it guards is not a guard.
    const commentedHeader = [
      "        run: | # the unit tests",
      "          # a literal command",
      "          npm test",
    ].join("\n");
    expect(() => assertNoBlockScalars(commentedHeader)).toThrow(/block scalar/);
    expect(() =>
      assertNoBlockScalars("        run: >- # folded, with a comment\n          npm test\n"),
    ).toThrow(/block scalar/);
    // And the consequence, stated as behaviour rather than implied: with the guard firing, the body is
    // never stripped, so the command inside it survives.
    expect(() => prepareWorkflow(commentedHeader)).toThrow(/block scalar/);
  });

  it("refuses to pick one of two jobs, rather than reading the first", () => {
    // **Round 7's CRITICAL, reproduced on synthetic input.** `jobRunDefaults` resolved the scope with
    // `findIndex` on a bare `defaults:`, so a decoy in a *second job* won:
    //
    //     jobs:
    //       dependency-audit:            # decoy job, carries the value the assertion wants
    //         defaults:
    //           run:
    //             working-directory: frontend
    //       quality-gates:               # the real job
    //         steps: …                    # each step carrying its own working-directory
    //
    // The workflow behaves identically — same work, same directory — and the real job has no default
    // working directory at all. **181 files / 3302 tests, green.** So the thing that decides *which
    // mapping is the scope* was itself answering by position, which is round 6's defect one level up.
    const decoyJob = [
      "jobs:",
      "  dependency-audit:",
      "    runs-on: ubuntu-latest",
      "    defaults:",
      "      run:",
      "        working-directory: frontend",
      "    steps:",
      "      - run: node --version",
      "  quality-gates:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: npm run lint",
      "        working-directory: frontend",
    ].join("\n");

    // Two jobs, and the helper's own contract says "the single job". So two is not something to
    // resolve — it is something to stop on, naming what was found.
    expect(() => jobRunDefaults(decoyJob)).toThrow(/declares 2 jobs/);

    // And the control that attributes it: the *same* workflow with one job reads correctly. Without
    // this, the throw above could be firing for any reason at all.
    const singleJob = [
      "jobs:",
      "  quality-gates:",
      "    runs-on: ubuntu-latest",
      "    defaults:",
      "      run:",
      "        working-directory: frontend",
      "    steps:",
      "      - run: npm run lint",
    ].join("\n");
    expect(workflowScalar(jobRunDefaults(singleJob)!, "working-directory")).toBe("frontend");

    // A second `defaults:` in the *same* job is the level below, and is refused too — one mechanism at
    // every level rather than a different rule per level.
    expect(() =>
      jobRunDefaults(
        singleJob.replace(
          "    steps:",
          "    defaults:\n      run:\n        shell: bash\n    steps:",
        ),
      ),
    ).toThrow(/appears 2 times/);
  });

  it("ignores a `defaults:` nested inside a step rather than treating the subtree as the scope", () => {
    // **Round 7's N5.** The walk matched the key at *any* depth deeper than the enclosing indent, so
    // the scope was a subtree rather than a mapping. No Actions-valid workflow was found that exploits
    // it — `defaults:` has exactly one legal child under a job, and an action's `with:` inputs are
    // scalars — so this is latent rather than live. It is witnessed anyway, because the walker's
    // boundary being "subtree" instead of "mapping" is exactly the kind of thing a reader assumes to
    // be the former and relies on the latter.
    const nestedOnly = [
      "jobs:",
      "  quality-gates:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Something",
      "        with:",
      "          defaults:",
      "            run:",
      "              working-directory: frontend",
    ].join("\n");

    // Not found, rather than found-and-wrong: the job has no `defaults:`, so there is nothing to read.
    expect(jobRunDefaults(nestedOnly)).toBeNull();
  });

  it("refuses two steps sharing a name rather than reading the first", () => {
    // **Round 7's N4.** `stepWith` used `findIndex` on `- name:`, so two steps named `Setup Node.js`
    // resolved to the first. The real workflow was safe — but only *incidentally*, because a different
    // test asserts the list of step names. That is a consumer's guarantee, not this helper's, and the
    // helper's own doc comment promises "the step named `stepName`", which has no referent here.
    const twoSteps = [
      "jobs:",
      "  quality-gates:",
      "    steps:",
      "      - name: Setup Node.js",
      "        with:",
      "          node-version: 20",
      "      - name: Setup Node.js",
      "        with:",
      "          node-version: 24",
    ].join("\n");

    expect(() => stepWith(twoSteps, "Setup Node.js")).toThrow(/2 steps carry that name/);

    // Control: one step of that name reads correctly, so the refusal above is about the *duplicate* and
    // not about the name filter failing to discriminate. Built as its own document rather than by
    // slicing `twoSteps`, because a slice that cuts the step off its own `- name:` line would test a
    // different workflow than the one the throw above was proven on.
    const oneStep = [
      "jobs:",
      "  quality-gates:",
      "    steps:",
      "      - name: Setup Node.js",
      "        with:",
      "          node-version: 20",
      "      - name: Something else",
      "        with:",
      "          node-version: 24",
    ].join("\n");
    expect(workflowScalar(stepWith(oneStep, "Setup Node.js")!, "node-version")).toBe("20");
    expect(stepWith(oneStep, "No Such Step")).toBeNull();
  });

  it("reads a step's `run:` only where the step declares it, and refuses the rest", () => {
    // **Round 9's CRITICAL, reproduced on synthetic input.** `run:` had no indentation scope, so any
    // `run:` line under the open step became that step's command — including an `env:` variable named
    // `run`. The proof that it mattered is on the real file, in `mut-round9`; what is built here is the
    // *shape*, so the rule is stated where it lives rather than only demonstrated against a mutation.
    const decoy = [
      "jobs:",
      "  quality-gates:",
      "    steps:",
      "      - name: Checkout",
      "        uses: actions/checkout@v7",
      "        env:",
      "          run: npm run lint",
    ].join("\n");

    expect(() => readSteps(decoy)).toThrow(/not a direct child of a step/);

    // Two `run:` keys in one step: the later used to overwrite the earlier, so the command the assertions
    // compared was whichever came last in the file rather than the one the step declares. A duplicate is
    // not a choice this reader is allowed to make.
    const twice = [
      "jobs:",
      "  quality-gates:",
      "    steps:",
      "      - name: Lint",
      "        run: npm run lint",
      "        run: npm run build",
    ].join("\n");
    expect(() => readSteps(twice)).toThrow(/declares 'run:' twice/);

    // Controls, so neither throw above is firing because the reader rejects everything. A step may carry
    // `uses:` and `run:` together — that is ordinary GitHub Actions — and both are read.
    const correct = [
      "jobs:",
      "  quality-gates:",
      "    steps:",
      "      - name: Checkout",
      "        uses: actions/checkout@v7",
      "        env:",
      "          NODE: 24",
      "      - name: Lint",
      "        run: npm run lint",
    ].join("\n");
    const read = readSteps(correct);
    expect(read).toHaveLength(2);
    expect(read[0]!.run).toBeNull();
    expect(read[1]!.run).toBe("npm run lint");

    // And a nested sequence inside a step must not swallow the step's own command. The old reader ended a
    // step's block at *any* `- ` line, so this lost the command entirely; it is here because the fix for
    // round 9's CRITICAL removed that branch, and a removed branch deserves a witness.
    const withArgs = [
      "jobs:",
      "  quality-gates:",
      "    steps:",
      "      - name: Lint",
      "        args:",
      "          --max-warnings=0",
      "        run: npm run lint",
    ].join("\n");
    expect(readSteps(withArgs)[0]!.run).toBe("npm run lint");
  });

  it("keeps its place in the file across a blank line", () => {
    // **Round 9's CRITICAL, second form.** `nestedBlocks` skipped blank lines while returning *text*, and
    // `keyLinesIn` recovered a line number by adding an offset to `at + 1`. That arithmetic is only
    // correct while the body is a contiguous slice, so every index after the first blank line in a block
    // was wrong — silently.
    //
    // The consequence was not a wrong answer but a *confident wrong answer*: one blank line before
    // `defaults:` made `jobRunDefaults` answer `null` for a workflow that sets `working-directory`, and
    // the assertion then reported **the workflow must set a default working directory** — a false claim
    // about a file, because the helper could not tell it had lost its place in it.
    const base = [
      "jobs:",
      "  quality-gates:",
      "    defaults:",
      "      run:",
      "        working-directory: frontend",
      "    steps:",
      "      - name: Setup Node.js",
      "        uses: actions/setup-node@v7",
      "        with:",
      "          node-version: 24",
    ].join("\n");

    const withBlankLineAfter = (lines: string[], after: string): string => {
      const at = lines.indexOf(after);
      expect(
        at,
        `the witness line '${after}' is not in the document it is mutating`,
      ).toBeGreaterThan(-1);
      return [...lines.slice(0, at + 1), "", ...lines.slice(at + 1)].join("\n");
    };

    // Three placements, because the failure moves with the blank rather than announcing itself: before the
    // value being read, before a sibling key, and *inside* the nested block that owns the other value. The
    // third is the one that also lost the Node pin, and only on the suite's own path — once
    // `prepareWorkflow` had removed comment lines and renumbered everything a second time.
    for (const after of ["    defaults:", "        working-directory: frontend", "        with:"]) {
      const mutated = withBlankLineAfter(base.split("\n"), after);
      expect(
        workflowScalar(jobRunDefaults(mutated)!, "working-directory"),
        `a blank line after '${after}' must not cost the job its working directory`,
      ).toBe("frontend");
      expect(
        workflowScalar(stepWith(mutated, "Setup Node.js")!, "node-version"),
        `a blank line after '${after}' must not cost the step its Node pin`,
      ).toBe("24");
    }

    // Control: the unmutated document reads correctly, so nothing above is passing because the reader
    // answers `null` to everything.
    expect(workflowScalar(jobRunDefaults(base)!, "working-directory")).toBe("frontend");
  });

  it("reads a step that runs the gate, not one that merely spells it", () => {
    // **Round 8's finding, reproduced on synthetic input.** The defect needs a workflow with three
    // properties at once — a step that mentions a gate early, the real gate elsewhere, and the name list
    // updated to match — so the witness builds the shape rather than the whole file. All three matter: the
    // name list is what made the one-edit version look caught, and "incidentally caught by another
    // assertion" is not caught.
    const withDecoy: Step[] = [
      { name: "Gate summary", run: 'echo "npm run lint runs below"' },
      { name: "Production build", run: "npm run build" },
      { name: "Lint", run: "npm run lint" },
    ];

    // The decoy is at index 0 and the real gate at 2, so a substring lookup answering "first match" puts
    // lint *before* the build and an ordering assertion comparing them passes. With exact command
    // equality the decoy is not a candidate at all, so the comparison is between the two steps it names.
    expect(indexOfRunning(withDecoy, "npm run lint")).toBe(2);
    expect(indexOfRunning(withDecoy, "npm run build")).toBe(1);

    // And the composed claim, stated as the assertion would state it: lint runs after the build in this
    // list, so `lint < build` must be **false** — which is the whole point. A lookup that returned 0 here
    // would report it true.
    expect(indexOfRunning(withDecoy, "npm run lint")).toBeGreaterThan(
      indexOfRunning(withDecoy, "npm run build"),
    );

    // A step that mentions a gate is not a step that runs it, so a gate nobody runs is still absent.
    expect(() => indexOfRunning(withDecoy, "npm run typecheck")).toThrow(/no step runs/);

    // Two steps running the same gate is ambiguous rather than first-wins, matching the rule
    // `helpers/yaml.ts` now applies at every level of a scoped lookup.
    expect(() =>
      indexOfRunning([...withDecoy, { name: "Lint again", run: "npm run lint" }], "npm run lint"),
    ).toThrow(/2 steps run it/);

    // Control: the correct workflow reads as the assertions expect, so nothing above is firing because the
    // lookup rejects everything.
    const correct: Step[] = [
      { name: "Lint", run: "npm run lint" },
      { name: "Production build", run: "npm run build" },
    ];
    expect(indexOfRunning(correct, "npm run lint")).toBeLessThan(
      indexOfRunning(correct, "npm run build"),
    );
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
    // -1 is true. So this must cover **every** gate the ordering assertions mention, not only the
    // two M21 moved.
    //
    // Round 6's WARNING B is exactly what happens when it does not. This test checked `npm run
    // build` and `npm test`; `npm run lint`, `npm run format:check` and `npm run typecheck` were
    // never witnessed, so all three could be replaced with `echo` and every ordering assertion
    // stayed green. A witness that covers two of the five things it is a witness for is not a
    // witness for the other three.
    const indexes = GATES.map((gate) => indexOfStep(gate));
    expect(indexes.every((at) => at >= 0)).toBe(true);
    // Distinct as well as present: two gates sharing an index means one step matched both needles,
    // which would make their ordering comparison a comparison of a number with itself.
    expect(new Set(indexes).size, "each gate must be its own step").toBe(GATES.length);
    // And the total is the one this workflow has. A gate added without being added here would not
    // be ordered against anything, which is the failure this file exists to prevent.
    expect(steps.filter((step) => (step.run ?? "").trim() !== "").length).toBeGreaterThanOrEqual(
      GATES.length,
    );
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

  it("runs each gate as exactly that command, so no gate can be silently made non-blocking", () => {
    // `npm ci` in CI is correct and is not the defect this change is about: a CI runner's working
    // tree is disposable, so deleting `node_modules` there costs nothing. The defect was doing it
    // in a *developer's* tree. Asserted so a future edit adding a second install is noticed, and so
    // nobody reads this file as an argument against CI installs.
    //
    // **Round 7's WARNING B generalised this from one gate to all six, and the generalisation is the
    // finding.** This assertion compared `step.run.trim() === "npm ci"` — the *command*. The ordering
    // assertions above went through `indexOfStep`, which uses `.includes(gate)` — the *text*. So the
    // file already knew the difference between a step that runs the gate and a step that spells it,
    // and applied it to one gate out of six. `npm run lint || true`, `npm test || true` and
    // `npm run build || true` all keep the needle in the text, so every ordering assertion stayed green
    // while the gate could not fail CI. **3302/3302, with five of six gates unable to fail.**
    //
    // `|| true` on a CI step is an entirely ordinary edit and it is silent. So the fix is not a cleverer
    // matcher; it is to require the command to *be* the gate.
    //
    // **Round 8 then found that this assertion and `indexOfStep` were two mechanisms for one question**,
    // and that the loose one was the one every ordering assertion used. Both now call `stepsRunning`, so
    // the rule exists exactly once: a step runs a gate when its whole trimmed command **is** that gate.
    for (const gate of GATES) {
      expect(
        stepsRunning(steps, gate),
        `exactly one step must run \`${gate}\` as its whole command`,
      ).toHaveLength(1);
    }
  });

  it("keeps the Node pin, the cache path and the repository contract in agreement", () => {
    // Not re-derived here: `tests/deployment-contract.test.ts` already asserts that `engines.node`,
    // `package.json` and this workflow agree, and it proves itself by rejecting a pin Vercel
    // cannot build. Duplicating it would be a second place for the value to drift.
    // Compared as **values within the mapping that owns them**, which is two mechanisms rather than
    // one, and rounds 4, 5 and 6 each defeated the previous single mechanism.
    //
    // Round 4: a substring check was satisfied by a comment.
    // Round 5: the value check was satisfied by a decoy on the same line as the value.
    // Round 6: the value check was satisfied by a decoy on an EARLIER line, because the lookup
    // returned the first match in the whole document. `node-version` placed in a job-level `env:`
    // block beat the real pin in `setup-node`'s `with:`, and the real pin could be set to 22 with
    // all 3297 tests green.
    //
    // So the scope is named: `setup-node`'s inputs own the pin, the job's `defaults.run` owns the
    // working directory, and nothing else is reachable. A decoy outside the scope is not merely
    // unlikely to win — it is not found at all.
    const setupNode = stepWith(workflowCode, "Setup Node.js");
    expect(setupNode, "the workflow must configure actions/setup-node by name").not.toBeNull();
    expect(workflowScalar(setupNode!, "node-version")).toBe("24");
    expect(workflowScalar(setupNode!, "cache-dependency-path")).toBe("frontend/package-lock.json");

    const runDefaults = jobRunDefaults(workflowCode);
    expect(runDefaults, "the job must set a default working directory").not.toBeNull();
    expect(workflowScalar(runDefaults!, "working-directory")).toBe("frontend");

    // The scopes must be reached through the step the rest of the file also refers to. If a future
    // edit renames the step, the assertion above fails with "not.toBeNull" and names the step —
    // rather than silently reading a mapping that no longer exists.
    expect(steps.map((step) => step.name)).toContain("Setup Node.js");
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
