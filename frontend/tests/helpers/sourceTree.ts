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
 *
 * ## And looking again, rather than reading less
 *
 * Tolerating on first contact was right and was not enough. M32 made every reader report what it
 * skipped, and over eight full-suite runs the reporter fired twice — the same gate, red one run in four,
 * because a reader that found a file gone reported the loss instead of waiting for the writer to finish.
 *
 * A file that was there a moment ago and is not now is evidence that the tree was being *written*, not
 * that the tree cannot be read, and the response to a transient is to look again. So the repetition is
 * here, wrapping the whole list-then-read cycle: a listed file that has gone causes the listing to be
 * taken again after a wait, and the read that finally succeeds describes what is on disk *now*.
 *
 * ## Why the repetition is in `readTree` and not in `readTreeStrict`
 *
 * Because the strict wrapper is not the only reader. `architecture.test.ts` does not call it: it
 * defines its own memoising `readTree`, which calls this one and asserts its own `onRace` stayed empty
 * at the end of its suite. A repetition inside `readTreeStrict` would cover fourteen readers and leave
 * that one on the failing path — and it would leave it worse, because the repetition has to happen
 * *above* its cache or the cache would freeze whichever short listing came first.
 *
 * ## Why the repetition is bounded
 *
 * An unbounded repetition is a check that cannot fail, which is the defect this repository keeps buying.
 * So the wait is capped, the total wait is a stated budget, and exhausting it is still the failure this
 * helper was built around. A reader either converges on a complete listing or reports — never both
 * quietly. `onRace` firing is that second outcome and nothing else.
 */

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
 * How long a reader will keep looking, in milliseconds, before it reports what it could not get.
 *
 * **The load-bearing number in this module.** A retry only helps if it can outlast the writer, and
 * `tests/motion-scope.test.ts` asserts its own probe's on-disk window against this figure — so if the
 * window ever grows past the budget, that test fails and says so, rather than the reader quietly
 * ceasing to help. The two numbers are therefore related by an assertion, not by a hope.
 *
 * Chosen against the two things it has to sit between: the writer's window, measured at roughly a
 * millisecond, and the suite's per-test timeout, which is already a known source of red runs. A second
 * is several orders of magnitude above the first and orders below the second, which is the whole of the
 * argument.
 *
 * **Exported rather than written inline** so a caller asserting against the budget compares the real
 * number rather than a copy of it that a later edit to this line would silently invalidate.
 */
export const SOURCE_TREE_RETRY_BUDGET_MS = 1000;

/** Wait before the first retry. Doubles from here, and stops growing at the cap below. */
const FIRST_RETRY_BACKOFF_MS = 5;

/**
 * The longest a single wait may be.
 *
 * The cap is what keeps the schedule bounded in *both* senses at once: the budget bounds the total, and
 * this bounds any one attempt, so the loop cannot park for a long time on its final attempt and then
 * discover it has already exceeded what it was allowed to spend. A fixed wait would have been either too
 * short to outlast the writer or long enough to trip a test timeout on every contended run.
 */
const MAX_RETRY_BACKOFF_MS = 50;

/**
 * How long to wait before the given retry — `retry` zero-based, so the first is `0`.
 *
 * Doubling rather than fixed: a file that has just been written is most likely to still be there a few
 * milliseconds later, and a reader that raced on its first contact should not pay a full interval to find
 * that out. The doubling is capped, so this stops growing.
 */
export function retryBackoffMs(retry: number): number {
  return Math.min(FIRST_RETRY_BACKOFF_MS * 2 ** retry, MAX_RETRY_BACKOFF_MS);
}

/**
 * How many retries a budget of `budgetMs` pays for.
 *
 * **Derived arithmetically rather than measured against a clock, and that is deliberate.** A wall-clock
 * deadline would make the retry count depend on how busy the machine is, which is precisely the number
 * the exhaustion test asserts — so a run under load would assert a different thing from a run on an idle
 * box, and the flaky figure would be the retry count rather than the behaviour. This is pure, so the
 * count is the same everywhere.
 *
 * The cost of that choice is stated rather than hidden: this bounds the *scheduled* waits, and
 * `Atomics.wait` blocks for at least its timeout and may be scheduled late, so real elapsed time can
 * exceed the budget by up to one interval per wait. The cap keeps that bounded, which is the property
 * the budget exists to provide.
 *
 * A budget of zero — or one that is not a positive finite number — buys no retries at all, which is a
 * first contact that behaves exactly as it did before the repetition existed.
 */
export function retriesWithinBudget(budgetMs: number): number {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return 0;
  let scheduled = 0;
  let retries = 0;
  for (;;) {
    const next = retryBackoffMs(retries);
    if (scheduled + next > budgetMs) return retries;
    scheduled += next;
    retries += 1;
  }
}

/**
 * Block the calling thread for `ms`.
 *
 * `Atomics.wait` on a `SharedArrayBuffer` is Node's synchronous sleep: it parks the thread rather than
 * spinning, and it needs no dependency. The obvious alternative, `setTimeout`, would make every reader
 * async, and that is fourteen call sites reshaped for no gain — this helper's whole interface is
 * synchronous and one seam in it should not be able to change that.
 *
 * The buffer is allocated per call and is never written to. Nothing is waiting on it; the timeout is the
 * entire mechanism, and a shared module-level buffer would be mutable global state shared between test
 * files for no benefit.
 */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms);
}

/**
 * Every `.ts`/`.tsx` file under `directory`, with its contents.
 *
 * A file that disappears between the listing and the read causes the **whole listing to be taken again**
 * after a wait, rather than that file being skipped. A read that succeeds on a later attempt returns that
 * complete later listing and reports nothing at all; a read that never succeeds reports every path that
 * vanished, across every attempt, and returns what the last attempt managed.
 *
 * ## What `onRace` now means
 *
 * **Before:** `onRace` fired the moment a listed file was found gone — "this happened".
 * **Now:** it fires once, with each path, and only when the budget is exhausted without a complete read —
 * "this is *still* happening". A collision that resolves within the budget is not an event worth
 * reporting, because nothing was lost: the listing that is returned is the one that was read.
 *
 * That is a change to a documented callback, so it is stated here in the same terms every other behaviour
 * in this file is stated in. A callback whose contract changed silently is how the next reader
 * reintroduces the original defect — either by asserting that `onRace` never fires and being satisfied
 * by a tolerance that is merely quieter, or by adding a skip back on first contact because the reporting
 * it relied on appears to have gone away.
 *
 * ## Why the wait is here and not in `readTreeStrict`
 *
 * See the module header. `architecture.test.ts` calls this function and not the strict wrapper, and it
 * memoises what it gets — so a repetition placed in the wrapper would both miss that reader and, if it
 * were placed in its cache instead, freeze whichever short listing arrived first.
 *
 * @param afterList called with the listed paths, after listing and before reading, **once per attempt**.
 *   This is the seam the race test uses to cause the race deterministically; ordinary callers omit it.
 *   It runs outside the `try` below, so a caller that misuses it fails loudly rather than being reported
 *   as a race — which is the correct behaviour for a programming error.
 * @param onRace called once per raced path, and **only after the budget is exhausted**
 * @param budgetMs total wait this call may spend before it reports. Defaults to
 *   {@link SOURCE_TREE_RETRY_BUDGET_MS}; `0` means no repetition at all. Tests that manufacture a
 *   permanent `ENOENT` pass a small one, because they are not racing a writer and should not pay for the
 *   production budget to prove a branch.
 * @param read how to read one file. Defaults to `readFileSync`. Present because the *other* branch
 *   - a read failure that is **not** a vanished file - is the whole reason `isMissing` is narrow, and
 *   it cannot be provoked reliably through the filesystem: making a real file unreadable needs a
 *   permission this platform may not grant, and a directory is never listed as a file because
 *   `walk` recurses into it first. Injecting the reader makes that branch testable on every
 *   platform and on every run, which is the difference between a documented intention and a
 *   checked one. **A failure that is not `ENOENT` is never retried** — it propagates on the attempt
 *   that raised it.
 */
export function readTree(
  directory: string,
  {
    extensions = [".ts", ".tsx"],
    afterList = () => {},
    onRace = () => {},
    budgetMs = SOURCE_TREE_RETRY_BUDGET_MS,
    read = (path: string) => readFileSync(path, "utf8"),
  }: {
    extensions?: ReadonlyArray<string>;
    afterList?: (files: ReadonlyArray<string>) => void;
    onRace?: (path: string) => void;
    budgetMs?: number;
    read?: (path: string) => string;
  } = {},
): Array<{ file: string; source: string }> {
  const retries = retriesWithinBudget(budgetMs);
  // The union across every attempt, not the last attempt's set. A path that vanished on one attempt and
  // was listed again on the next is still a path a caller must hear about, and a report narrowed to the
  // final attempt would drop exactly the paths that flapped — the ones a reader most needs named.
  const raced = new Set<string>();
  let contents: Array<{ file: string; source: string }> = [];

  for (let attempt = 0; ; attempt += 1) {
    const files = walk(directory, extensions);
    afterList(files);
    // Reset per attempt: `raced` is cumulative for reporting, but whether *this* attempt was complete
    // is a separate question, and conflating the two would make a converging read report itself.
    let vanishedThisAttempt = false;
    const attemptContents: Array<{ file: string; source: string }> = [];
    for (const file of files) {
      try {
        attemptContents.push({ file, source: read(file) });
      } catch (error) {
        // The one tolerated case, and the only one ever retried. Anything else propagates on the spot: a
        // tree that cannot be read is a real failure and must not be reported as a race — nor spent the
        // budget re-listing a tree that will fail identically every time.
        if (!isMissing(error)) throw error;
        raced.add(file);
        vanishedThisAttempt = true;
      }
    }
    contents = attemptContents;
    if (!vanishedThisAttempt) return contents;
    if (attempt === retries) break;
    sleepMs(retryBackoffMs(attempt));
  }

  // Only reachable by exhausting the budget, which is the whole point of the budget being finite.
  for (const path of raced) onRace(path);
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
 * ## What it throws on, now that `readTree` looks again
 *
 * Nothing was weakened; the reporting moved later. `readTree` retries first, so a collision that
 * resolves within the budget produces no raced path, no throw, and a **complete** read — and the only
 * thing this wrapper can still catch is a tree that stayed broken for the whole budget. That is the
 * correct division: a reader returns everything or reports, and this is the reporting half.
 *
 * ## Why the message names every file rather than the first
 *
 * A partial report would let the reader conclude one file was involved when a whole probe directory went
 * at once, which is what actually happens when `motion-scope.test.ts` cleans up in its `finally`. The
 * paths come from `readTree`'s union across every attempt, so a file that flapped in and out is named
 * even if the final listing happened to contain it.
 *
 * @param options passed through to `readTree`, including `budgetMs` — a caller that wants to know how
 *   long this may block asks here, and a test that manufactures a permanent `ENOENT` says so.
 * @throws if the budget is exhausted with listed files still missing. A read failure that is **not**
 *   `ENOENT` still propagates from `readTree` untouched, unretried, and is never reported as a race.
 */
export function readTreeStrict(
  directory: string,
  options: Parameters<typeof readTree>[1] = {},
): Array<{ file: string; source: string }> {
  const raced: string[] = [];
  const files = readTree(directory, { ...options, onRace: (path) => raced.push(path) });
  if (raced.length > 0) {
    const budget = options?.budgetMs ?? SOURCE_TREE_RETRY_BUDGET_MS;
    throw new Error(
      `readTreeStrict: ${raced.length} file(s) vanished between being listed and being read under ` +
        `${directory}, and were still missing after looking again for ${budget}ms. A reader that skips ` +
        `them silently checks fewer files than it believes it does, so this is a failure rather than a ` +
        `skip:\n  - ${raced.join("\n  - ")}`,
    );
  }
  return files;
}

/**
 * Every file, whatever its extension.
 *
 * `walk` matches on `name.endsWith(extension)`, and every string ends with `""`, so this single-entry
 * list disables the filter without a second code path. Exported as a named constant rather than written
 * inline at each call site because `[extensions]` is opaque: a reader who wants "all files" and does not
 * know the trick would reach for a directory listing instead, which is the thing this helper exists to
 * replace.
 */
export const ALL_FILES: ReadonlyArray<string> = [""];

/** Absolute paths of the matching files under `directory`, depth first. */
export function walk(directory: string, extensions: ReadonlyArray<string>): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return walk(full, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [full] : [];
  });
}
