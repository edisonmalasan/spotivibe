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
  const line = yaml.split(/\r?\n/).find((candidate) => /:\s*[|>][-+0-9]*\s*$/.test(candidate));
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

/**
 * The lines nested under the first `key` found in `lines` at or after `start`.
 *
 * `keyPattern` is matched against the line; the block is every following line indented deeper than the
 * key's own line, stopping at the first line that is not — which is how a mapping ends in YAML without
 * needing to know the whole grammar.
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
 * @throws if `keyPattern` matches more than once in the searched region.
 */
function blockAfter(
  lines: string[],
  start: number,
  keyPattern: RegExp,
  outerIndent: number,
  what: string,
): { lines: string[]; indent: number } | null {
  const matches: number[] = [];

  for (let at = start; at < lines.length; at += 1) {
    const line = lines[at]!;
    if (line.trim() === "") continue;
    if (at > start && indentOf(line) <= outerIndent) break;
    if (keyPattern.test(line)) matches.push(at);
  }

  if (matches.length === 0) return null;

  if (matches.length > 1) {
    throw new Error(
      `refusing to read ${what}: it appears ${matches.length} times ` +
        `(lines ${matches.map((at) => at + 1).join(", ")}). Taking the first would resolve it by position, ` +
        "which is what lets a correct-looking decoy in the earlier block be read instead of the real one.",
    );
  }

  const at = matches[0]!;
  const keyIndent = indentOf(lines[at]!);
  const body: string[] = [];
  for (let next = at + 1; next < lines.length; next += 1) {
    const candidate = lines[next]!;
    if (candidate.trim() === "") continue;
    if (indentOf(candidate) <= keyIndent) break;
    body.push(candidate);
  }
  return { lines: body, indent: keyIndent };
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

  const start = lines.findIndex((line) => namePattern.test(line));
  if (start === -1) return null;

  // The step's body: deeper lines, up to the next sibling entry at the `- name:` line's own indent.
  const stepIndent = indentOf(lines[start]!);
  const body: string[] = [];
  for (let at = start + 1; at < lines.length; at += 1) {
    const line = lines[at]!;
    if (line.trim() === "") continue;
    if (indentOf(line) <= stepIndent) break;
    body.push(line);
  }

  const inputs = blockAfter(
    body,
    0,
    /^\s*with:\s*$/,
    stepIndent,
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
  const start = lines.findIndex((line) => /^\s*defaults:\s*$/.test(line));
  if (start === -1) return null;
  const run = blockAfter(
    lines,
    start,
    /^\s*run:\s*$/,
    indentOf(lines[start]!),
    "the job's 'defaults.run' mapping",
  );
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
