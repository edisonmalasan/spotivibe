import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isMissing, readTree, readTreeStrict } from "./helpers/sourceTree";

/**
 * Listing a tree and reading it, when the tree changes in between.
 *
 * `tests/motion-scope.test.ts` writes a probe module into `src/features/sharing/` and deletes it
 * again. `tests/architecture.test.ts` listed `src` and then read each file, and the window between
 * those two halves produced `ENOENT` — an intermittent failure in a suite that has nothing to say
 * about the architecture. Vitest isolates VM state and not the filesystem, so `isolate: true`
 * cannot prevent it.
 *
 * ## Why this is tested with an injected hook rather than by racing two workers
 *
 * The real collision takes about a millisecond and only happens sometimes, which makes a test that
 * depends on reproducing it a test that usually passes without proving anything — the worst kind.
 * `readTree` therefore takes an `onRace` callback, so the file's disappearance is *caused* at a
 * known point in the sequence and the behaviour is asserted every run.
 *
 * The temptation is to leave `onRace` out of the test and simply run both files together
 * repeatedly. That measures the collision rate and not the fix: if the tolerance were removed, a
 * repetition-based test would go red eventually, on a machine, on a day, for reasons nobody could
 * reconstruct. This asserts the property directly.
 *
 * ## Nothing here touches the repository
 *
 * Fixtures live under the system temporary directory. A test file whose subject is "do not write
 * into the tree other tests are reading" would be the worst possible place to do it.
 */

const scratch: string[] = [];
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "source-tree-test-"));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** A tree with two files, one of them nested. */
function tree(): string {
  const root = scratchDir();
  mkdirSync(join(root, "nested"), { recursive: true });
  writeFileSync(join(root, "a.ts"), "export const a = 1;\n", "utf8");
  writeFileSync(join(root, "nested", "b.tsx"), "export const b = 2;\n", "utf8");
  return root;
}

describe("readTree", () => {
  it("reads every matching file under the directory, at any depth", () => {
    const files = readTree(tree());
    expect(files).toHaveLength(2);
    expect(files.map((entry) => entry.file).map((file) => file.split(/[\\/]/).pop())).toEqual([
      "a.ts",
      "b.tsx",
    ]);
  });

  it("ignores files whose extension was not asked for", () => {
    const root = tree();
    writeFileSync(join(root, "styles.css"), "body {}\n", "utf8");
    expect(readTree(root).map((entry) => entry.file)).not.toContain(join(root, "styles.css"));
  });

  it("returns nothing for a directory that does not exist", () => {
    // Not an error: a guard that reads an optional subtree must not fail because it is absent.
    expect(readTree(join(scratchDir(), "absent"))).toEqual([]);
  });

  it("skips a file that vanishes between being listed and being read", () => {
    // The defect, caused rather than raced. `motion-scope.test.ts` deletes its probe inside a
    // `finally`, so any worker that listed `src` first and read second could hit `ENOENT` for a file
    // that never mattered — an intermittent failure in a suite with nothing to say about it.
    const root = tree();
    const raced: string[] = [];

    const files = readTree(root, {
      afterList: (listed) => rmSync(listed.find((file) => file.endsWith("a.ts"))!),
      onRace: (file) => raced.push(file),
    });

    // The vanished file is skipped rather than thrown, the surviving one is still read, and the
    // disappearance is reported rather than swallowed.
    expect(files).toHaveLength(1);
    expect(files[0]!.file).toContain("b.tsx");
    expect(raced).toHaveLength(1);
    expect(raced[0]).toContain("a.ts");
  });

  it("reports every vanished file, not just the first", () => {
    // A partial report would let a caller believe a single file was involved when a whole probe
    // directory went at once, which is what actually happens when a test cleans up.
    const root = tree();
    const raced: string[] = [];
    readTree(root, {
      afterList: (listed) => listed.forEach((file) => rmSync(file)),
      onRace: (file) => raced.push(file),
    });
    expect(raced).toHaveLength(2);
  });

  it("does not tolerate a read failure that is not a vanished file", () => {
    // The tolerance is narrow on purpose: a permission error or an unreadable directory is a real
    // failure, and reporting it as a race would hide it.
    expect(isMissing(Object.assign(new Error("denied"), { code: "EACCES" }))).toBe(false);
    expect(isMissing(Object.assign(new Error("busy"), { code: "EBUSY" }))).toBe(false);
    expect(isMissing(new Error("boom"))).toBe(false);
    expect(isMissing(undefined)).toBe(false);
  });

  // ## The two tests below are the ones that were missing
  //
  // Everything above this line unit-tested the `isMissing` **predicate**. Nothing exercised
  // `readTree`'s **decision** — the line `if (!isMissing(error)) throw error` — which is the whole
  // stated purpose of the helper. Independent verification found that deleting it entirely
  // (`void error`) left 139 tests green. A predicate can be right while the branch that uses it is
  // dead, and that is the more likely failure, because deleting a branch looks like cleanup.

  it("throws when a read fails for any reason other than the file being gone", () => {
    const root = tree();
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const raced: string[] = [];

    expect(() =>
      readTree(root, {
        read: (file) => {
          if (file.endsWith("a.ts")) throw denied;
          return `contents of ${file}`;
        },
        onRace: (file) => raced.push(file),
      }),
    ).toThrow(denied);

    // **And it must not be reported as a race.** This is the half that matters: a real read failure
    // dressed up as a vanished file would let `architecture.test.ts` pass while silently reading fewer
    // files than it thinks, which is worse than failing, because the suite would claim to have checked
    // the architecture of files it never opened.
    expect(raced).toEqual([]);
  });

  it("keeps tolerating the vanished case while the fatal case throws", () => {
    // Both branches of the same decision, in one place, so neither can be changed without the other
    // being visible. A narrowing that broke the tolerance would show up here as the first expectation;
    // a widening would show up as the absence of a throw.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });

    const tolerated = readTree(root, {
      read: (file) => {
        if (file.endsWith("a.ts")) throw vanished;
        return "";
      },
    });
    expect(tolerated.map((entry) => entry.file.split(/[\\/]/).pop())).toEqual(["b.tsx"]);

    expect(() =>
      readTree(root, {
        read: (file) => {
          if (file.endsWith("a.ts")) throw Object.assign(new Error("boom"), { code: "EISDIR" });
          return "";
        },
      }),
    ).toThrow();
  });

  it("uses readFileSync when no reader is given", () => {
    // The seam is optional. If the default were wrong, every caller that omits it would silently get
    // empty contents rather than an error — so the ordinary path is asserted, not assumed.
    expect(
      readTree(tree())
        .map((entry) => entry.source)
        .sort(),
    ).toEqual(["export const a = 1;\n", "export const b = 2;\n"]);
  });

  it("recognises a vanished file", () => {
    expect(isMissing(Object.assign(new Error("no such file"), { code: "ENOENT" }))).toBe(true);
  });

  it("reads a complete tree without reporting any race", () => {
    // The ordinary path, asserted so the tolerance cannot be mistaken for the normal behaviour:
    // a healthy tree must produce no vanished files at all.
    const root = tree();
    const raced: string[] = [];
    const files = readTree(root, { onRace: (file) => raced.push(file) });
    expect(files).toHaveLength(2);
    expect(raced).toEqual([]);
  });
});

/**
 * ## The three arms of the asserting wrapper
 *
 * Every case below is driven through `readTreeStrict`'s injected `read` rather than through a real
 * filesystem race, for the reason in this file's header: a race that only sometimes happens is a test that
 * usually passes without proving anything.
 *
 * The arms are `readTree`'s own two branches plus the reporting the wrapper adds, so all three execute on
 * every run rather than being left to the one run in a hundred that happens to collide.
 */
describe("readTreeStrict", () => {
  it("returns the tree unchanged when nothing vanished", () => {
    // The ordinary path, asserted: a healthy tree must not throw, or every converted reader would be
    // broken by construction and the failure would look like a product bug.
    const root = tree();
    expect(readTreeStrict(root).map((entry) => entry.file.split(/[\\/]/).pop())).toEqual([
      "a.ts",
      "b.tsx",
    ]);
  });

  it("fails when a file vanished, and names it", () => {
    // The obligation this wrapper exists to discharge. `readTree` would return one file silently here,
    // and a reader built on it would report success while checking less than it set out to.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });

    expect(() =>
      readTreeStrict(root, {
        read: (file) => {
          if (file.endsWith("a.ts")) throw vanished;
          return `contents of ${file}`;
        },
      }),
    ).toThrow(/a\.ts/);
  });

  it("names every vanished file, not just the first", () => {
    // The partial-report case: `motion-scope.test.ts` removes its probe in a `finally`, and a reader that
    // learned of only the first loss would conclude a single file was involved when a directory went.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });

    let thrown: Error | undefined;
    try {
      readTreeStrict(root, {
        read: () => {
          throw vanished;
        },
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/a\.ts/);
    expect(thrown!.message).toMatch(/b\.tsx/);
    expect(thrown!.message).toMatch(/2 file\(s\)/);
  });

  it("propagates a read failure that is not a vanished file, and does not report it as a race", () => {
    // The arm that keeps `isMissing` narrow. If this were reported as a race, a suite would tolerate an
    // unreadable tree and pass while having checked none of it - strictly worse than failing.
    const root = tree();
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });

    expect(() =>
      readTreeStrict(root, {
        read: () => {
          throw denied;
        },
      }),
    ).toThrow(denied);
  });

  it("does not turn a caller-supplied onRace into a second, unreported channel", () => {
    // `readTreeStrict` overrides `onRace` so the raced paths cannot be diverted somewhere the wrapper does
    // not see. If a caller's callback were honoured as well, a caller could pass one that does nothing and
    // the throw would still fire - so the test asserts the override rather than the convenience.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });
    const callerSaw: string[] = [];

    expect(() =>
      readTreeStrict(root, {
        read: () => {
          throw vanished;
        },
        onRace: (file) => callerSaw.push(file),
      }),
    ).toThrow(/vanished between being listed and being read/);
    expect(callerSaw).toEqual([]);
  });
});
