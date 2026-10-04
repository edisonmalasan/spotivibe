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
 * ## What is done instead
 *
 * Only **whole-line** comments are removed, because that is the one form YAML leaves no ambiguity about:
 * a plain scalar cannot begin with `#`, so a line whose first non-space character is `#` is a comment in
 * every dialect. Nothing else is touched.
 *
 * Trailing comments are then not a hazard, because assertions compare **values**, not substrings.
 * `nodeVersion(workflow)` returns the text after `node-version:`, so a decoy in a trailing comment is
 * part of the *value* and fails an exact comparison:
 *
 *     node-version: 24 # pinned by Vercel   ->  "24 # pinned by Vercel"  ->  RED
 *     node-version: x  # node-version: 24    ->  "x  # node-version: 24"   ->  RED
 *     node-version: 24                       ->  "24"                      ->  pass
 *
 * That fails closed on a legitimate trailing comment, which `ci.yml` has none of. When one is added the
 * test goes red and a human decides — which is the right way round. Stripping comments to make such a
 * line pass would mean re-implementing YAML to accommodate a case that does not exist.
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

/**
 * The scalar value of `key` in a whole-line-comment-free workflow, or `null` if absent.
 *
 * Takes the *stripped* text. Matches a key at the start of a line — `- key:` or `key:` — and returns
 * everything after the first `:`, trimmed, with matching surrounding quotes removed.
 *
 * Returns the remainder of the line **verbatim**, trailing comment included. That is deliberate: see the
 * file header for why an exact comparison on this value is what defeats a decoy.
 */
export function scalarValue(yaml: string, key: string): string | null {
  const pattern = new RegExp(`^\\s*(?:-\\s*)?${key}:\\s*(.*)$`);
  for (const line of yaml.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (!match) continue;
    const raw = match[1]!.trim();
    if (raw === "") return "";
    const quoted = /^(['"])(.*)\1$/.exec(raw);
    return quoted ? quoted[2]! : raw;
  }
  return null;
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
