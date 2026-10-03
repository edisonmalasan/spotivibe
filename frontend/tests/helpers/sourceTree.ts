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
 */
export function readTree(
  directory: string,
  {
    extensions = [".ts", ".tsx"],
    afterList = () => {},
    onRace = () => {},
  }: {
    extensions?: ReadonlyArray<string>;
    afterList?: (files: ReadonlyArray<string>) => void;
    onRace?: (path: string) => void;
  } = {},
): Array<{ file: string; source: string }> {
  const files = walk(directory, extensions);
  afterList(files);
  const read: Array<{ file: string; source: string }> = [];
  for (const file of files) {
    try {
      read.push({ file, source: readFileSync(file, "utf8") });
    } catch (error) {
      // The one tolerated case. Anything else propagates: a tree that cannot be read is a real
      // failure and must not be reported as a race.
      if (!isMissing(error)) throw error;
      onRace(file);
    }
  }
  return read;
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
