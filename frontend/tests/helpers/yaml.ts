/**
 * Reading values out of the CI workflow.
 *
 * ## Why this file is not a comment stripper
 *
 * Round 4 closed a CRITICAL: `expect(workflow).toContain("node-version: 24")` was satisfied by
 * `# node-version: 24`, so commenting out the Node pin left 3292/3292 tests green. The repair stripped
 * comments before asserting — and round 5 defeated *the repair* with one line:
 *
 *     x: it's # node-version: 24
 *
 * The previous version toggled quote state on every `'`. A YAML **plain scalar may contain an
 * apostrophe**, so `it's` opened a quote that never closed, every later `#` on that line was treated as
 * quoted content, and the decoy survived. 181 files / 3292 tests, all green.
 *
 * So this does not attempt trailing comments at all. Hand-rolling that requires knowing whether the `#`
 * is inside a plain scalar, a single-quoted scalar, a double-quoted scalar, or a block scalar's literal
 * body — which is a parser, not a helper.
 *
 * ## Why a key is not enough to find a value
 *
 * Round 5's repair made assertions compare **values** and claimed a decoy *anywhere* would become part
 * of the value. Round 6 defeated that claim, and the claim was the defect — not the implementation it
 * described. `scalarValue` returned the **first** line matching `key:` anywhere in the file, so a decoy
 * placed *earlier* won:
 *
 * ```yaml
 *     env:
 *       NODE_VERSION: "24"
 *       node-version: 24        # decoy, in a mapping that does not own the pin
 *     steps:
 *       - uses: actions/setup-node@v7
 *         with:
 *           node-version: 22      # the real pin, now wrong
 * ```
 *
 * 181 files / 3297 tests, all green, with the runner on Node 22. Confirmed with a real YAML parser
 * rather than by the absence of an error, which is the only way to confirm an absence.
 *
 * The lesson is not "be careful with regexes". It is: **a bare key is ambiguous, and position is exactly
 * what a decoy manipulates.** Resolving "which `node-version` did you mean?" by taking the first one is
 * a choice, and it is the choice an attacker or an accident makes for you.
 *
 * So a value is read from a **scope** — the mapping that must own it — and a repeated key inside that
 * scope is refused rather than resolved by position:
 *
 *   - `stepWith(yaml, "Setup Node.js")` returns that step's `with:` inputs, and nothing else. A decoy in
 *     a job-level `env:` is not in the scope, so it is not found; the real pin is, and it is `22`.
 *   - `scalarValue` **throws** when the key appears more than once in the text it is given. A duplicate
 *     is not resolved by taking the first — that is the defect. It is stopped, naming the line numbers.
 *
 * Both are needed and each covers the other: scoping alone would still take the first of two duplicates
 * inside one mapping, and refusing duplicates alone would still read a decoy that is the only occurrence
 * in the whole file.
 *
 * ## Round 7: every level of a scoped lookup is itself a scoped lookup
 *
 * Round 6 installed refusal at two levels — the scalar key and the container key inside a scope — and
 * scoping at one. Round 7 walked through the level above both: **the thing that decides which mapping is
 * the scope was still `findIndex` on a bare key.** A second job carrying `working-directory: frontend`
 * won, the real job's `defaults:` was never read, and the workflow behaved identically while
 * `quality-gates` had no default working directory at all. 181 files / 3302 tests, green.
 *
 * That is the fourth round in a row to find the same defect class one level up from where the previous
 * round fixed it, and it is worth stating as a property of this code rather than as an incident:
 *
 *     **Every level of a scoped lookup is itself a scoped lookup, so every level must refuse.**
 *
 * Hence the shape throughout: zero matches is `null`, two or more is a **throw** naming the lines, and
 * there is no "first match wins" anywhere. `findIndex` does not appear in this file, and that is the
 * point — `findIndex` cannot express "I am not sure", so it always answers, and the answer is always
 * available to whoever placed the earlier block.
 */

/** Whole-line comments removed. Every other byte is preserved exactly. */
export function stripWholeLineComments(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
}

/** Whether `line` is a whole-line YAML comment. */
export function isCommentLine(line: string): boolean {
  return /^\s*#/.test(line);
}

/**
 * Block scalars are refused rather than mishandled.
 *
 * `run: |` introduces literal text in which `#` is **content, not a comment**. Deleting such a line
 * would silently remove a real command, and keeping it would mean the strip is wrong. Neither is
 * acceptable, and guessing is worse than stopping: this throws, naming the line, so the gap is a loud
 * failure instead of a quiet one.
 *
 * `ci.yml` and the archived release gate contain no block scalars today, so this never fires — which is
 * itself worth asserting rather than assuming (see `ci-workflow.test.ts`).
 *
 * @throws if a block scalar indicator is found.
 */
export function assertNoBlockScalars(yaml: string): void {
  // The trailing `(?:#.*)?` is round 7's WARNING B. The indicator used to have to be the last thing on
  // the line, so `run: | # the unit tests` walked straight past the guard — and then the stripper
  // deleted a real command from the literal body, which is the exact outcome this function exists to
  // prevent. **A guard that only recognises the tidy spelling of the thing it guards is not a guard.**
  // A YAML block header may carry a comment after the indicator, so the comment is part of the header.
  const line = yaml
    .split(/\r?\n/)
    .find((candidate) => /:\s*[|>][-+0-9]*\s*(?:#.*)?$/.test(candidate));
  if (line !== undefined) {
    throw new Error(
      "refusing to strip a YAML block scalar: its body is literal text in which `#` is content, not a " +
        `comment, so stripping would delete a real command. Found: ${JSON.stringify(line)}. ` +
        "Either extend this helper to track block scalars properly or remove the block scalar.",
    );
  }
}

/** Indentation width of `line`; blanks are 0 so they never look like structure. */
function indentOf(line: string): number {
  if (line.trim() === "") return 0;
  return line.length - line.trimStart().length;
}

/** `text` with regex metacharacters escaped, so a key or step name is matched literally. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Any `key:` line at any depth, including a sequence entry's first key. */
const KEY_LINE = /^\s*(?:-\s*)?(?:["'])?[\w.$-]+(?:["'])?\s*:/;

/**
 * The **indexes** of the lines nested under the mapping that starts at `at`, stopping at the first line not
 * indented deeper.
 *
 * This is how a mapping ends in YAML without needing to know the whole grammar. It is *not* enough to
 * find a mapping: a nested block is nested too, and this is what tells the two apart.
 *
 * **Indexes, not lines — round 9's CRITICAL.** This used to return `string[]`, skipping blank lines as it
 * went, and `keyLinesIn` then recovered a line number by adding an offset to `at + 1`. That arithmetic is
 * only correct while the body is a contiguous slice, and skipping a blank line makes it not one: **every
 * index after the first blank in a block was wrong**, silently.
 *
 * The consequence was not a wrong answer, it was a *confident wrong answer*. One blank line before
 * `defaults:` made `jobRunDefaults` answer `null` for a workflow that sets `working-directory: frontend`;
 * one blank line inside `setup-node`'s `with:` lost the Node pin, on the suite's own path, once
 * `prepareWorkflow` had also removed comment lines and renumbered everything a second time. The assertion
 * then reported *the workflow must configure actions/setup-node by name* — a false claim about a file,
 * because the helper could not tell it had lost its place in it.
 *
 * The doc comment below named this hazard exactly, in the past tense, and then performed the arithmetic.
 * **A hazard described in prose is not a hazard handled.**
 */
function nestedBlockIndexes(lines: string[], at: number): number[] {
  const keyIndent = indentOf(lines[at]!);
  const found: number[] = [];
  for (let next = at + 1; next < lines.length; next += 1) {
    const candidate = lines[next]!;
    if (candidate.trim() === "") continue;
    if (indentOf(candidate) <= keyIndent) break;
    found.push(next);
  }
  return found;
}

/** The lines themselves, for callers that genuinely only want text. Never derive an index from this. */
function nestedBlocks(lines: string[], at: number): string[] {
  return nestedBlockIndexes(lines, at).map((index) => lines[index]!);
}

/**
 * The indexes of the lines of the mapping that starts at `at` that are **keys** — as opposed to block
 * content.
 *
 * Split out from `nestedBlocks` because the distinction matters and round 7 walked through it. A mapping's
 * body includes everything nested, but only the *shallowest* key lines are its direct children; the rest
 * belong to mappings further in. Returning one list for both concepts is what made the job lookup count
 * `runs-on`, `steps`, `- name:` and every `with:` input as separate jobs.
 *
 * Indent is left unbounded here on purpose: this function's only job is "which lines are keys", and a key
 * nested four levels down is still a key line.
 */
function keyLinesIn(lines: string[], at: number): number[] {
  return nestedBlockIndexes(lines, at).filter((index) => KEY_LINE.test(lines[index]!));
}

/**
 * The indexes of the **direct** children of the mapping at `at` whose key matches `keyPattern`.
 *
 * Direct means: the key line's indent is the shallowest indent among the mapping's key lines. That one
 * rule is the whole difference between a mapping and a subtree — round 7's N5 was that the walk matched
 * `defaults:` at *any* depth, so one nested inside a step's `with:` was a candidate for the job's own.
 *
 * Returns indexes into `lines`, so a caller need not re-derive the offset. Getting that wrong is silent
 * rather than loud: an index off by one yields `null`, and `null` reads as "this workflow has no such
 * scope" — a claim about the file rather than a symptom of a bug. That is why it is derived here once, and
 * why `nestedBlockIndexes` returns indexes rather than text: deriving an index from text is where round 9's
 * CRITICAL lived.
 */
function directChildKeys(lines: string[], at: number, keyPattern: RegExp): number[] {
  const candidates = keyLinesIn(lines, at);
  if (candidates.length === 0) return [];

  const shallowest = Math.min(...candidates.map((index) => indentOf(lines[index]!)));
  return candidates.filter(
    (index) => indentOf(lines[index]!) === shallowest && keyPattern.test(lines[index]!),
  );
}

/**
 * The lines nested under the first `key` found in `lines` at or after `start`.
 *
 * `keyPattern` is matched against the line; the block is every following line indented deeper than the
 * key's own line, stopping at the first line that is not.
 *
 * `outerIndent` is the indent of whatever *encloses* the search, and a line at or left of it ends the
 * search. It is a parameter rather than derived from `lines[start]` because the two callers enclose
 * differently: a step's `with:` is enclosed by the `- name:` line, while `defaults.run` is enclosed by
 * `defaults:` itself. Deriving it from `lines[start]` silently ended the step search on the first line of
 * the step body, which returned `null` for a workflow that plainly has the inputs — a false negative that
 * would have been indistinguishable from a missing step.
 *
 * **A repeated container key is refused, not resolved by taking the first.** This is not a restatement of
 * `scalarValue`'s rule; it is the same rule one level up, and round 6's own mutation suite found its
 * absence here. Inserting a second `run:` under `defaults:`, with the decoy inside it and the real
 * `working-directory` above it, left the first-wins lookup reading the decoy's sibling block and the
 * assertion green. Refusing a duplicate scalar while resolving a duplicate mapping by position is the
 * defect with one of its two faces removed.
 *
 * `parentAt` is the index of the key line that **owns** the block, so "direct child of the mapping at
 * `parentAt`" is decided by indentation relative to that line rather than by an outer bound passed in
 * separately. Round 7's N5 was that the previous version matched at any depth greater than some `outer
 * indent`, which made the scope a subtree.
 *
 * @throws if `keyPattern` matches more than once among the parent's direct children.
 */
function blockAfter(
  lines: string[],
  parentAt: number,
  keyPattern: RegExp,
  what: string,
): { at: number; lines: string[]; indent: number } | null {
  const matches = directChildKeys(lines, parentAt, keyPattern);

  if (matches.length === 0) return null;

  if (matches.length > 1) {
    throw new Error(
      `refusing to read ${what}: it appears ${matches.length} times ` +
        `(lines ${matches.map((at) => at + 1).join(", ")}). Taking the first would resolve it by position, ` +
        "which is what lets a correct-looking decoy in the earlier block be read instead of the real one.",
    );
  }

  const at = matches[0]!;
  return { at, lines: nestedBlocks(lines, at), indent: indentOf(lines[at]!) };
}

/**
 * The one direct child of the mapping at `parentAt` whose key matches `keyPattern`, or `null`.
 *
 * ## Why this exists, and why its refusal is the point
 *
 * Round 6 scoped two lookups and refused duplicates *within* a scope. Round 7 walked straight through it:
 * the thing that decides **which** mapping is the scope was still `findIndex` on a bare key, so a decoy
 * block placed anywhere earlier won. The general form, and it is the whole of this change's defect class:
 *
 *     a lookup that answers "which one?" by order of appearance is answering on the decoy's behalf,
 *     and *every level of a scoped lookup is such a lookup*.
 *
 * Round 6 refused at the scalar key (`scalarValue`) and at the container key inside a scope
 * (`blockAfter`). Round 7 found the level above both: **the scope selector itself** — `findIndex` for the
 * step name, `findIndex` for `defaults:`. Six rounds, four levels, and every repair has been correct about
 * the level beneath it. So the rule is the strongest one available:
 *
 *     **at every level, refuse rather than choose.**
 *
 * Hence `null` for zero and a throw for two or more. There is no third answer, and in particular no
 * "first match wins", which is the answer that hands the choice to whoever planted the decoy.
 *
 * @throws if more than one direct child matches.
 */
function onlyChild(
  lines: string[],
  parentAt: number,
  keyPattern: RegExp,
  what: string,
): { at: number; lines: string[]; indent: number } | null {
  return blockAfter(lines, parentAt, keyPattern, what);
}

/**
 * The `with:` inputs of the step named `stepName`, as text, or `null` if there is no such step.
 *
 * This is the scope that owns `node-version` and `cache-dependency-path`: `actions/setup-node`'s inputs.
 * Nothing outside that mapping is reachable through it, which is what makes a decoy elsewhere in the
 * workflow unfindable rather than merely unlikely.
 *
 * @param yaml whole-line-comment-free workflow text, as returned by `prepareWorkflow`.
 */
export function stepWith(yaml: string, stepName: string): string | null {
  const lines = yaml.split(/\r?\n/);
  const namePattern = new RegExp(`^\\s*-\\s*name:\\s*${literal(stepName)}\\s*$`);

  // Round 7's N4: this was `findIndex`, so two steps sharing a name resolved to the first. The helper
  // promises "the step named `stepName`" and that phrase has no answer when there are two, so it now
  // refuses rather than picking one. The safety here was previously *incidental* — a different test
  // happened to assert the workflow's step names, which is a consumer's guarantee, not this helper's.
  const named = lines.reduce<number[]>(
    (found, line, at) => (namePattern.test(line) ? [...found, at] : found),
    [],
  );
  if (named.length === 0) return null;
  if (named.length > 1) {
    throw new Error(
      `refusing to read the 'with:' inputs of step '${stepName}': ${named.length} steps carry that name ` +
        `(lines ${named.map((at) => at + 1).join(", ")}). The name does not identify one step, so reading ` +
        "the first would be choosing by position — and the step you get is the one you did not mean.",
    );
  }
  const start = named[0]!;

  // The `- name:` line *is* the step's mapping, so it is the parent — no separate body slice, and no
  // hand-rolled sibling-boundary loop to get wrong. `nestedBlocks` stops at the next line not indented
  // deeper, which is the next step's `- name:` at the same indent, so another step's `with:` is not
  // reachable through this one. And `directChildKeys` requires `with:` to sit at the shallowest key
  // indent in the step, so one nested under an `env:` is not found either (round 7's N5).
  const inputs = onlyChild(
    lines,
    start,
    /^\s*with:\s*$/,
    `the 'with:' inputs of step '${stepName}'`,
  );
  if (inputs === null || inputs.lines.length === 0) return null;
  return inputs.lines.join("\n");
}

/**
 * The `defaults.run` mapping of the single job, as text, or `null` if there is none.
 *
 * This is the scope that owns `working-directory`. Reading that key from the whole file would be the
 * round-6 defect exactly: any earlier `working-directory` anywhere in the workflow would win.
 */
export function jobRunDefaults(yaml: string): string | null {
  const lines = yaml.split(/\r?\n/);

  // Round 7's CRITICAL, and the level above both round-6 repairs. `defaults:` was found with
  // `findIndex`, so a *second job* carrying `working-directory: frontend` won:
  //
  //     jobs:
  //       dependency-audit:            # decoy job
  //         defaults:
  //           run:
  //             working-directory: frontend
  //       quality-gates:               # the real job, its own `defaults:` deleted
  //         steps: …                    # each step carrying its own working-directory
  //
  // The workflow's behaviour is identical — CI does the same work in the same directory — and
  // `quality-gates` has no default working directory at all. **181 files / 3302 tests, green.**
  //
  // Round 6 refused duplicates *inside* a scope and scoped two lookups. This is the level above both:
  // the thing that decides *which* mapping is the scope. The doc comment above already claimed "of the
  // single job"; that was an assumption in prose, and this is where it becomes enforced.
  const jobs = lines.reduce<number[]>(
    (found, line, at) => (/^\s*jobs:\s*$/.test(line) ? [...found, at] : found),
    [],
  );
  if (jobs.length === 0) return null;
  if (jobs.length > 1) {
    throw new Error(
      `refusing to read the job's run defaults: the workflow declares 'jobs:' ${jobs.length} times ` +
        `(lines ${jobs.map((at) => at + 1).join(", ")}), so which job owns the defaults is not decidable ` +
        "from the text.",
    );
  }

  const jobsAt = jobs[0]!;

  // The job *names* are the direct children of `jobs:`. `directChildKeys` decides "direct" by the
  // shallowest key indent in the block, so `runs-on`, `steps`, `- name:` and every `with:` input are not
  // candidates — they belong to mappings further in. Round 7's N5 was matching at *any* depth, which
  // made this count every key line in the file as a separate job.
  const jobNames = directChildKeys(lines, jobsAt, KEY_LINE);
  if (jobNames.length === 0) return null;
  if (jobNames.length > 1) {
    throw new Error(
      `refusing to read the job's run defaults: the workflow declares ${jobNames.length} jobs ` +
        `(lines ${jobNames.map((at) => at + 1).join(", ")}). Which one owns 'defaults.run' is a question ` +
        "this helper answered by position until round 7, and position is what the decoy controls.",
    );
  }
  const jobAt = jobNames[0]!;

  const defaults = onlyChild(lines, jobAt, /^\s*defaults:\s*$/, "the job's 'defaults' mapping");
  if (defaults === null) return null;

  // Scoped to `defaults:` by *index*, not by a hand-computed offset. `defaults.at` is where that key
  // actually is, so this needs no arithmetic on `lines` at all — and arithmetic on the wrong array is the
  // kind of off-by-one that returns `null` instead of throwing, where `null` reads as "this workflow has
  // no run defaults": a claim about the file rather than a symptom.
  const run = onlyChild(lines, defaults.at, /^\s*run:\s*$/, "the job's 'defaults.run' mapping");
  if (run === null || run.lines.length === 0) return null;
  return run.lines.join("\n");
}

/**
 * The scalar value of `key` in the given text, or `null` if absent.
 *
 * Takes a **scope**, not a whole workflow — `stepWith` or `jobRunDefaults` — because a bare key in a
 * whole document is ambiguous and resolving it by position is what round 6 defeated.
 *
 * Returns the remainder of the line **verbatim**, trailing comment included, which is deliberate: see the
 * file header for why an exact comparison on that value is what defeats a decoy on the same line.
 *
 * @throws if `key` appears more than once. A repeated key is refused rather than resolved, because
 *   resolving it means choosing a winner by position, and the whole defect is that position is what a
 *   decoy controls.
 */
export function scalarValue(yaml: string, key: string): string | null {
  const pattern = new RegExp(`^\\s*(?:-\\s*)?${literal(key)}:\\s*(.*)$`);
  const found: Array<{ line: number; raw: string }> = [];

  yaml.split(/\r?\n/).forEach((line, index) => {
    const match = pattern.exec(line);
    if (match !== null) found.push({ line: index + 1, raw: match[1]!.trim() });
  });

  if (found.length === 0) return null;

  if (found.length > 1) {
    throw new Error(
      `refusing to read '${key}': it appears ${found.length} times in this scope ` +
        `(lines ${found.map((entry) => entry.line).join(", ")}). Taking the first would resolve it by ` +
        "position, which is exactly what lets a correct-looking decoy above the real value be read " +
        "instead of it. Narrow the scope, or remove the duplicate.",
    );
  }

  const raw = found[0]!.raw;
  if (raw === "") return "";
  const quoted = /^(['"])(.*)\1$/.exec(raw);
  return quoted ? quoted[2]! : raw;
}

/** `scalarValue` as a trimmed string, with `null` for an absent key. Convenience for exact assertions. */
export function workflowScalar(yaml: string, key: string): string | null {
  const value = scalarValue(yaml, key);
  return value === null ? null : value.trim();
}

/** The workflow prepared for content assertions: whole-line comments gone, block scalars refused. */
export function prepareWorkflow(yaml: string): string {
  assertNoBlockScalars(yaml);
  return stripWholeLineComments(yaml);
}
