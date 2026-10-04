/**
 * YAML comment handling for assertions about the CI workflow.
 *
 * Shared because two files asserted against the workflow's raw text and both could be satisfied by a
 * comment. `expect(workflow).toContain("node-version: 24")` passes when the line is
 * `# node-version: 24` - commenting out the Node pin in `.github/workflows/ci.yml` left the entire
 * suite green, at 43 tests and then at 3292. `deployment-contract.test.ts`'s `ciNodeMajor()` had the
 * same hole with a regex instead of a `toContain`.
 *
 * The failure is not subtle once stated: a *comment* is the workflow saying what it does not do.
 * Asserting that a commented-out line is present is asserting the absence of the thing being pinned.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It does not parse YAML. A real parser would be more correct, and would also be a dependency, and
 *     the only consumer is two assertions' worth of reading. The rules below are the two forms that
 *     actually occur: a whole-line comment, and a trailing comment after real content.
 *   - It does not remove the *raw* text. One assertion in `ci-workflow.test.ts` genuinely wants the
 *     comment - it checks that the workflow explains why the build precedes the tests. That assertion
 *     keeps the raw string on purpose, and says so at the call site.
 */

/** Whether `line` is a whole-line comment. */
export function isCommentLine(line: string): boolean {
  return /^\s*#/.test(line);
}

/**
 * `line` with any trailing comment removed, leaving quoted `#` characters alone.
 *
 * A `#` only starts a comment when it is at the start of the line or preceded by whitespace *and* is
 * outside quotes. `cache: "a#b"` and `run: echo '# not a comment'` both keep their `#`, which is the
 * difference between this and a naive `split("#")[0]`.
 */
export function stripTrailingComment(line: string): string {
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === "\\") {
      index += 1; // An escaped character cannot close a quote.
      continue;
    }
    if (character === "'" && !inDouble) inSingle = !inSingle;
    else if (character === '"' && !inSingle) inDouble = !inDouble;
    else if (character === "#" && !inSingle && !inDouble) {
      const precededByWhitespace = index === 0 || /\s/.test(line[index - 1]);
      if (precededByWhitespace) return line.slice(0, index).trimEnd();
    }
  }

  return line;
}

/** The workflow with comments removed, blank lines dropped, indentation preserved. */
export function stripYamlComments(yaml: string): string {
  return yaml
    .split(/\r?\n/)
    .filter((line) => !isCommentLine(line))
    .map(stripTrailingComment)
    .filter((line) => line.trim() !== "")
    .join("\n");
}
