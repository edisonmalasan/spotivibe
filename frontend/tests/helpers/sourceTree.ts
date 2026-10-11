import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Listing a source tree and reading it, without failing on a file that left in between.
 *
 * ## The defect this exists to fix
 *
 * `tests/architecture.test.ts` enumerated a directory and then read each file it found:
 *
 *     const files = walk(dir).map((file) => ({ file, source: readFileSync(file, "utf8") }));
 *
 * That is a time-of-check/time-of-use gap. Another test in another worker — for example
 * `motion-scope.test.ts`, which writes a probe module into `src/features/sharing/` and deletes it
 * again — can remove a file between the two halves. The result is `ENOENT` in a suite that has
 * nothing to say about the architecture, and it presents as an intermittent failure in whichever
 * file happened to be running.
 *
 * Vitest's isolation separates VM state and not the filesystem, so `isolate: true` cannot prevent
 * this, and it is not specific to that one probe: any test that writes a temporary file into the
 * tree produces it.
 *
 * ## Why the probe was not moved out of `src/` instead
 *
 * That was the obvious alternative and it is the wrong one. `motion-scope.test.ts`'s probe exists
 * to prove the detector's coverage is *walked* rather than typed — "a probe cannot be dropped
 * anywhere unnoticed". Putting the probe in a directory the walkers skip would have removed the
 * race by making the test prove nothing.
 *
 * A lock file was also rejected: vitest's workers share a filesystem and do not coordinate, so a
 * lock means implementing coordination for one test. And telling `architecture.test.ts` about
 * `Probe*.tsx` by name would couple two unrelated guards, and re-couple them the next time a third
 * probe appears.
 *
 * Tolerating a vanished file is the fix that addresses the class rather than the instance.

/**
 * A file that is no longer there.
 *
 * Named as a predicate rather than inlined so the tolerance is *narrow*: a permission error or a
 * directory that cannot be read is still a failure, because "the file went away" and "I cannot
 * read the file" are different problems and only one of them is expected here.
 */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT";
}

/**
 * Every `.ts`/`.tsx` file under `directory`, with its contents.
 *
 * A file that disappears between the listing and the read is skipped rather than thrown. `onRace`
 * exists so that behaviour is testable deterministically — see the test file — rather than only
 * observable when two workers happen to collide.
 *
 * @param afterList called with the listed paths, after listing and before reading. This is the
 *   seam the race test uses to cause the race deterministically; ordinary callers omit it.
 * @param onRace called with each path that vanished before it could be read, for reporting
 * @param read how to read one file. Defaults to `readFileSync`. Present because the *other* branch
 *   - a read failure that is **not** a vanished file - is the whole reason `isMissing` is narrow, and
 *   it cannot be provoked reliably through the filesystem: making a real file unreadable needs a
 *   permission this platform may not grant, and a directory is never listed as a file because
 *   `walk` recurses into it first. Injecting the reader makes that branch testable on every
 *   platform and on every run, which is the difference between a documented intention and a
 *   checked one.
 */
export function readTree(
  directory: string,
  {
    extensions = [".ts", ".tsx"],
    afterList = () => {},
    onRace = () => {},
    read = (path: string) => readFileSync(path, "utf8"),
  }: {
    extensions?: ReadonlyArray<string>;
    afterList?: (files: ReadonlyArray<string>) => void;
    onRace?: (path: string) => void;
    read?: (path: string) => string;
  } = {},
): Array<{ file: string; source: string }> {
  const files = walk(directory, extensions);
  afterList(files);
  const contents: Array<{ file: string; source: string }> = [];
  for (const file of files) {
    try {
      contents.push({ file, source: read(file) });
    } catch (error) {
      // The one tolerated case. Anything else propagates: a tree that cannot be read is a real
      // failure and must not be reported as a race.
      // Note the scope: only errors from `read` reach this decision. `afterList` runs outside the
      // `try`, so a caller that misuses that seam fails loudly rather than being reported as a
      // race - which is the correct behaviour for a programming error.
      if (!isMissing(error)) throw error;
      onRace(file);
    }
  }
  return contents;
}

/**
 * The same read, with the reporting obligation discharged by the call.
 *
 * ## Why this exists rather than thirteen call sites remembering to assert
 *
 * `verification-integrity` requires two things of every reader of the application source tree: tolerate a
 * file that vanished, **and** report each one while the caller asserts none was reported. That second half
 * is the half that gets forgotten — a reader that tolerates silently reads fewer files than it believes it
 * did, and the suite still passes. `token-contrast.test.ts` is that case, and it is in the repository today.
 *
 * So the obligation is made **unskippable**: raced paths are collected here and, if any occurred, this
 * throws naming every one. A caller cannot call this and forget the assertion, because the call *is* the
 * assertion.
 *
 * ## Why it throws rather than merely reporting
 *
 * The alternative was to return the raced paths and let each caller assert. That is thirteen
 * opportunities to write `onRace` and drop the `expect`, and the failure mode is invisible — the suite
 * stays green and has checked fewer files than it claims.
 *
 * ## Why the message names every file rather than the first
 *
 * A partial report would let the reader conclude one file was involved when a whole probe directory went
 * at once, which is what actually happens when `motion-scope.test.ts` cleans up in its `finally`.
 *
 * @throws if any listed file vanished before it could be read. A read failure that is **not** `ENOENT`
 *   still propagates from `readTree` untouched and is never reported as a race.
 */
export function readTreeStrict(
  directory: string,
  options: Parameters<typeof readTree>[1] = {},
): Array<{ file: string; source: string }> {
  const raced: string[] = [];
  const files = readTree(directory, { ...options, onRace: (path) => raced.push(path) });
  if (raced.length > 0) {
    throw new Error(
      `readTreeStrict: ${raced.length} file(s) vanished between being listed and being read under ` +
        `${directory}. A reader that skips them silently checks fewer files than it believes it does, so ` +
        `this is a failure rather than a skip:\n  - ${raced.join("\n  - ")}`,
    );
  }
  return files;
}

/** Absolute paths of the matching files under `directory`, depth first. */
export function walk(directory: string, extensions: ReadonlyArray<string>): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return walk(full, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [full] : [];
  });
}
