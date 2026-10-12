import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isMissing,
  readTree,
  readTreeStrict,
  retriesWithinBudget,
  retryBackoffMs,
  SOURCE_TREE_RETRY_BUDGET_MS,
} from "./helpers/sourceTree";

/**
 * Listing a tree and reading it, when the tree changes in between.
 *
 * `tests/motion-scope.test.ts` writes a probe module into `src/features/sharing/` and deletes it
 * again. `tests/architecture.test.ts` listed `src` and then read each file, and the window between
 * those two halves produced `ENOENT` — an intermittent failure in a suite that has nothing to say
 * about the architecture. Vitest isolates VM state and not the filesystem, so `isolate: true`
 * cannot prevent it.
 *
 * ## What changed when the reader started looking again
 *
 * Tolerating on first contact fixed the crash and left the gate: M32 measured the reporter firing in
 * **2 of 8** full-suite runs, which is a gate nobody can rely on. So the reader now repeats the whole
 * listing after a wait, and **the meaning of `onRace` changed with it**:
 *
 * | | before | now |
 * |---|---|---|
 * | `onRace` fires | the moment a listed file is found gone | only when the budget is exhausted |
 * | a collision that resolves | reported, and the caller failed | **silent** — the listing returned is the one that was read |
 * | raced paths reported | the files missed on that one attempt | the **union across every attempt** |
 *
 * Every test below that asserts on `onRace` was re-read against that table rather than kept, because a
 * test that still passes is not evidence it still tests what it says.
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

/**
 * The budget used by every test that manufactures a `ENOENT` no filesystem would ever produce.
 *
 * **Not an optimisation — the tests would be asserting nothing.** These cases stub the reader to
 * throw on every attempt, so with the production budget each one spends a full second asleep before
 * it can reach its first expectation, and five of them is five seconds of a suite whose per-test
 * timeout is already a known source of red runs. `0` says "do not repeat", which also makes each of
 * those tests a statement about the *exhausted* path rather than about timing.
 */
const NO_REPETITION_MS = 0;

/** A budget small enough to be instant and large enough to buy several real attempts. */
const SHORT_BUDGET_MS = 30;

/** The bare filename of an absolute path, so an assertion survives `readdirSync` ordering. */
function nameOf(file: string): string {
  return file.split(/[\\/]/).pop()!;
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

  it("reports a file that is still gone after the budget, with a budget of zero", () => {
    // The defect, caused rather than raced. `motion-scope.test.ts` deletes its probe inside a
    // `finally`, so any worker that listed `src` first and read second could hit `ENOENT` for a file
    // that never mattered — an intermittent failure in a suite with nothing to say about it.
    //
    // **Re-read against the new contract rather than kept.** Before the repetition this asserted
    // "a vanished file is skipped and reported". That is no longer what happens: with a real budget
    // `afterList` would run again, `a.ts` would no longer be listed at all, and the second attempt
    // would converge — so the report would never fire and this test would pass for a reason it does not
    // name. `budgetMs: 0` pins it to the exhausted path, which is what it claims to be about, and the
    // converging path is asserted separately below rather than assumed here.
    const root = tree();
    const raced: string[] = [];

    const files = readTree(root, {
      afterList: (listed) => rmSync(listed.find((file) => file.endsWith("a.ts"))!),
      onRace: (file) => raced.push(file),
      budgetMs: NO_REPETITION_MS,
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
    //
    // `afterList` removes every file on every call, so with a real budget this would repeat until the
    // budget ran out and the same paths would be reported repeatedly — passing a length check by
    // repetition rather than by completeness. The budget is zeroed so the count means what it says.
    const root = tree();
    const raced: string[] = [];
    readTree(root, {
      afterList: (listed) => listed.forEach((file) => rmSync(file)),
      onRace: (file) => raced.push(file),
      budgetMs: NO_REPETITION_MS,
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
    //
    // **The tolerated call gets a zero budget and the fatal one gets nothing.** That asymmetry is the
    // test: `ENOENT` is retried, `EISDIR` is not, so under a real budget the fatal call would throw on
    // its first attempt anyway while the tolerated call would spend the budget and then report. Both
    // still behave as claimed, but pinning the tolerated side to the exhausted path keeps the case
    // about the *branch*, not about how long it took to reach it.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });

    const tolerated = readTree(root, {
      budgetMs: NO_REPETITION_MS,
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

  it("fails when a file is still gone after the budget, and names it", () => {
    // The obligation this wrapper exists to discharge. `readTree` would return one file silently here,
    // and a reader built on it would report success while checking less than it set out to.
    //
    // **Re-read rather than kept.** Under the production budget this read never converges — the stub
    // throws for `a.ts` on every attempt — so the throw would still fire, but after a second of
    // sleeping. `budgetMs: 0` keeps the case about the throw and names the exhausted path in its title.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });

    expect(() =>
      readTreeStrict(root, {
        budgetMs: NO_REPETITION_MS,
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
    //
    // The budget is zeroed for the reason above, and the count assertion is what makes it a *partial
    // report* test rather than a substring test: every path is named, and exactly as many are named as
    // there were files.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });

    let thrown: Error | undefined;
    try {
      readTreeStrict(root, {
        budgetMs: NO_REPETITION_MS,
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
    //
    // **Re-read rather than kept, because this one would have gone quietly green.** The read throws for
    // every file, so under the production budget the wrapper's own `onRace` would fire once per path
    // *after* exhaustion - and the caller's callback would still see nothing, because the override happens
    // when the options are assembled rather than when a race is noticed. It passes for a reason close to
    // its stated one, which is exactly the sort of near-miss a kept test hides. Zeroing the budget pins it
    // to a single attempt, where the override is the only thing that can explain the result.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });
    const callerSaw: string[] = [];

    expect(() =>
      readTreeStrict(root, {
        budgetMs: NO_REPETITION_MS,
        read: () => {
          throw vanished;
        },
        onRace: (file) => callerSaw.push(file),
      }),
    ).toThrow(/vanished between being listed and being read/);
    expect(callerSaw).toEqual([]);
  });
});

/**
 * ## The two arms of the repetition
 *
 * The repetition is the whole point of the change, and it has exactly two outcomes. Both are driven
 * through the seams this file already had — `afterList` decides *what the tree looks like* on each
 * attempt, `read` decides *whether a listed file can be read* — so both execute on every run rather than
 * waiting for two workers to collide, which is the condition the header above exists to avoid depending on.
 *
 * The convergence arm is the one that fixes the gate. The exhaustion arm is the one that keeps the
 * helper honest, and it is asserted with the same care as the first: a retry that cannot be shown to
 * fail is a retry nobody knows is doing anything.
 */
describe("the repetition", () => {
  it("returns the complete second listing and reports nothing when the file is gone only once", () => {
    // The convergence arm. `a.ts` is removed after the first listing and never comes back, so the
    // second listing genuinely differs from the first — and the returned contents are asserted to *be*
    // that second listing, file for file. Comparing against the first would let a cache satisfy the test.
    const root = tree();
    const raced: string[] = [];
    const listings: Array<ReadonlyArray<string>> = [];

    const files = readTree(root, {
      afterList: (listed) => {
        listings.push(listed);
        if (listings.length === 1) rmSync(listed.find((file) => file.endsWith("a.ts"))!);
      },
      onRace: (file) => raced.push(file),
      budgetMs: SHORT_BUDGET_MS,
    });

    // It looked again rather than reporting, so the listing really was taken twice...
    expect(listings, "the whole listing is repeated, not just the failed read").toHaveLength(2);
    expect(listings[0]!.map(nameOf)).toEqual(["a.ts", "b.tsx"]);
    expect(listings[1]!.map(nameOf)).toEqual(["b.tsx"]);

    // ...the complete second listing is what came back, contents included...
    expect(files.map((entry) => entry.file)).toEqual([...listings[1]!]);
    expect(files.map((entry) => entry.source)).toEqual(["export const b = 2;\n"]);

    // ...and a collision that resolved cost the caller nothing to know about. This is the assertion
    // that changed meaning with the contract: before, a race here was reported.
    expect(raced).toEqual([]);
  });

  it("retries exactly as many times as the budget pays for, then reports every path that vanished", () => {
    // The exhaustion arm. The read never succeeds, so the loop must stop — and it must stop after the
    // number of attempts its budget bought, not after one, and not after forever.
    const root = tree();
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });
    const raced: string[] = [];
    let attempts = 0;

    const files = readTree(root, {
      afterList: () => {
        attempts += 1;
      },
      onRace: (file) => raced.push(file),
      budgetMs: SHORT_BUDGET_MS,
      read: () => {
        throw vanished;
      },
    });

    const expectedAttempts = retriesWithinBudget(SHORT_BUDGET_MS) + 1;
    expect(expectedAttempts, "a short budget still buys several attempts").toBeGreaterThan(2);
    expect(attempts, "one initial listing plus one per retry").toBe(expectedAttempts);
    expect(raced.map(nameOf).sort()).toEqual(["a.ts", "b.tsx"]);
    expect(
      files,
      "a read that never succeeded returns nothing rather than a partial listing",
    ).toEqual([]);
  });

  it("throws naming every path that vanished on any attempt, not only the last", () => {
    // The union across attempts, and the reason it is not a detail.
    //
    // Each attempt loses a *different* file, and the last attempt's file was perfectly readable on the
    // first. A report narrowed to the final attempt would name `b.tsx` alone — while `a.ts`, the file a
    // reader would most need told about, went unmentioned despite having genuinely vanished once.
    const root = tree();
    writeFileSync(join(root, "c.ts"), "export const c = 3;\n", "utf8");
    const vanished = Object.assign(new Error("gone"), { code: "ENOENT" });
    // What the tree "loses" on each attempt, in order. The files are not removed: the read seam decides,
    // so every attempt lists the whole tree and the only thing that varies is which file cannot be read.
    const lostPerAttempt = [["a.ts"], ["c.ts"], ["b.tsx"]];
    let attempts = 0;

    let thrown: Error | undefined;
    try {
      readTreeStrict(root, {
        budgetMs: SHORT_BUDGET_MS,
        afterList: () => {
          attempts += 1;
        },
        read: (file) => {
          if (lostPerAttempt[attempts - 1]!.includes(nameOf(file))) throw vanished;
          return `contents of ${file}`;
        },
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(attempts, "every attempt until the budget ran out").toBe(
      retriesWithinBudget(SHORT_BUDGET_MS) + 1,
    );
    expect(thrown).toBeDefined();
    expect(thrown!.message).toMatch(/3 file\(s\)/);
    for (const expected of ["a.ts", "c.ts", "b.tsx"]) {
      expect(thrown!.message, `${expected} vanished on some attempt and must be named`).toContain(
        expected,
      );
    }
  });

  it("never repeats a read failure that is not a vanished file", () => {
    // The narrowing survives the repetition, and this is where it is proved rather than assumed: a
    // retried `EACCES` would burn the whole budget re-reading a tree that fails identically every time,
    // and — worse — an implementation that caught every error and retried it would look identical here
    // unless the *attempt count* were asserted.
    const root = tree();
    const denied = Object.assign(new Error("permission denied"), { code: "EACCES" });
    let attempts = 0;

    expect(() =>
      readTree(root, {
        budgetMs: SOURCE_TREE_RETRY_BUDGET_MS,
        afterList: () => {
          attempts += 1;
        },
        read: () => {
          throw denied;
        },
      }),
    ).toThrow(denied);

    expect(attempts, "a fatal read failure is not something to wait out").toBe(1);
  });

  it("never schedules more waiting than the budget pays for, and stops there", () => {
    // The budget's own invariant, asserted over the values that matter rather than against a copied
    // schedule. A hard-coded expected count would go stale the moment a constant changed, and would be
    // asserting the arithmetic rather than the property.
    for (const budget of [0, 1, 30, 250, SOURCE_TREE_RETRY_BUDGET_MS]) {
      const retries = retriesWithinBudget(budget);
      let scheduled = 0;
      for (let retry = 0; retry < retries; retry += 1) scheduled += retryBackoffMs(retry);

      expect(scheduled, `budget ${budget}ms must not be overspent`).toBeLessThanOrEqual(budget);
      if (retries > 0) {
        expect(
          scheduled + retryBackoffMs(retries),
          `budget ${budget}ms must be fully spent`,
        ).toBeGreaterThan(budget);
      }
    }
  });

  it("caps the backoff rather than doubling without limit", () => {
    // The cap is what stops a long budget from buying a single enormous park at the end. Without it a
    // budget of a second would schedule a 512ms wait before the last attempt.
    expect(retryBackoffMs(0)).toBeLessThan(retryBackoffMs(1));
    const capped = retryBackoffMs(50);
    expect(retryBackoffMs(49)).toBe(capped);
    expect(retryBackoffMs(1_000)).toBe(capped);
    // The cap's whole purpose: it must be small enough that the production budget still buys *many*
    // attempts. A cap set near the budget would collapse the repetition to two tries and make the
    // whole mechanism a coin toss on which side of a race the reader lands.
    expect(
      retriesWithinBudget(SOURCE_TREE_RETRY_BUDGET_MS),
      "a capped wait must leave the production budget able to buy many attempts",
    ).toBeGreaterThanOrEqual(10);
  });

  it("buys no repetition at all from a budget of zero", () => {
    // The seam the re-read tests above depend on. If this stopped holding, every one of those tests
    // would silently start sleeping for the production budget and the suite's timing would change for a
    // reason nobody could see.
    expect(retriesWithinBudget(0)).toBe(0);
    expect(retriesWithinBudget(-1)).toBe(0);
    expect(retriesWithinBudget(Number.NaN)).toBe(0);
  });
});
