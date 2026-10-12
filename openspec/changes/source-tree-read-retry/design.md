# Design — `source-tree-read-retry`

## D1 — The retry lives in the shared helper, not in `readTreeStrict`

`frontend/tests/helpers/sourceTree.ts` exports two readers. `readTree` is the tolerant primitive that
skips a vanished file and hands it to `onRace`; `readTreeStrict` is the wrapper that collects those
paths and throws.

The obvious placement is inside `readTreeStrict`. That is wrong, and the reason is visible in the call
sites: `architecture.test.ts` **does not call `readTreeStrict`**. It defines its own memoising
`readTree` at `:97` which calls the shared `readTree` with `onRace: (file) => racedFiles.add(file)`
and asserts `racedFiles` is empty at the end of its own suite. It is a legitimate reader and a real
participant in this race, and a retry placed in `readTreeStrict` would leave it on the failing path.

So the repetition goes **inside `readTree`**, wrapping the listing-and-reading cycle, and `onRace` is
invoked only when the budget is exhausted. One change covers both families, which is only possible
because M32 consolidated them into one module.

The reader-facing consequence is a change in what `onRace` means. It stops meaning *"this happened"* and
becomes *"this is still happening after the budget"*. That is a semantic change to a documented
callback and every existing test that asserts on it has to be re-read rather than kept.

### D1.1 Why not also retry inside `architecture.test.ts`'s cache

Its `readTree` memoises per directory, and the cache is populated from whichever call comes first. If
that first call raced, the cache holds a short list and every later caller gets it. The suite-end
assertion still catches it, so this is not a silent hole — but it does mean the retry must happen
*above* the cache, inside the shared `readTree`, or the cache would freeze a raced result. Putting the
retry in the shared helper means `readTree` returns either a complete listing or throws; it cannot
return a partial one for anyone to cache.

## D2 — The budget, and how to wait without a dependency

The wait is synchronous, because the whole read path is synchronous and an `async` seam would change
every call site's shape across fourteen files. Node has no built-in synchronous sleep, and adding one
means a dependency, which this change forbids.

The primitive used is **`Atomics.wait` on a `SharedArrayBuffer`** — a static method that blocks the
calling thread for a timeout and is specified to behave as a sleep when the value is `0` and the wait is
not on the main thread of a browser. In a Node worker it is the standard synchronous sleep. No
dependency, no polyfill, and it does not spin.

Backoff is capped rather than fixed, because a fixed wait would either be too short to matter or long
enough to trip a test timeout on every contended run. At the shipped constants — first wait 5 ms,
doubling, capped at 50 ms — a 1000 ms budget buys **22 retries across 23 attempts**, scheduling
**975 ms**. That arithmetic is re-derived independently from the constants, not taken from a report.

#### D2.0 The budget bounds scheduled waits, not elapsed time — corrected during Apply

**This revises the paragraph above, which originally made the budget a wall-clock deadline.** The
implementation derives the retry count arithmetically (`retriesWithinBudget`) instead of checking a
clock, because **the exhaustion test asserts an exact number of attempts**. Under a wall-clock deadline
that number becomes load-dependent, so the same test would assert something different on a busy box than
on an idle one — and the figure that flickers would be the retry count rather than the behaviour, which
is the worst possible thing for a test to be sensitive to.

The cost is stated in the code rather than hidden: `Atomics.wait` blocks for *at least* its timeout and
may be scheduled late, so elapsed time can exceed the budget by up to one interval per wait. The cap
bounds that.

The budget is therefore a bound on **scheduled** waiting, and the claim D2 makes — that the writer's
window fits inside it — is a claim about ordering, which holds either way. Turning this into a real
deadline later would first require the exhaustion test's exact-count assertion to become a tolerance.

A non-positive or non-finite budget buys **no** retries, so `Infinity` means *do not repeat* rather
than *repeat forever*. That is a deliberate fail-safe and it is documented in the code.

### D2.1 The budget is overridable per call, and must be

Added after reading the existing suite rather than before it. **Seven call sites drive the raced path
deliberately** and would otherwise each spend the whole production budget before asserting anything.

**The first count given for this was five, and it was wrong.** Re-reading the implemented suite found
**six** in `source-tree-race.test.ts`, not five, plus **a seventh outside the change's owned files**:
`architecture.test.ts:3660`, which stubs `read` to throw `ENOENT` for every file and for every attempt.
That seventh was the one that mattered — measured at **1223 ms** with the repetition shipped, and
**588 ms** once given `budgetMs: 0`. Roughly two thirds of that file's entire runtime, for one line.

It was found because the implementation worker **reported it instead of reaching outside its ownership
to fix it**, and the orchestrator then owned it. A number in a design document is a claim about code, and
the code is what checks it.

Each site manufactures a *permanent* `ENOENT` rather than racing a writer, so opting out of the
repetition is exactly right: with no budget the first contact is the last, `onRace` still fires, and the
branch under test is still reached. Only the waiting is skipped, and the production default stays
correct for every ordinary caller.

### D2.2 Why a finite budget is the whole design

An unbounded repetition is the defect this repository keeps buying: a check that cannot fail. The
budget is what keeps `readTreeStrict`'s throw reachable, and it is why the delta says "exhausting the
budget SHALL remain a failure that names every raced path" rather than something softer. A reader that
converges returns a complete listing; a reader that does not fails and says which paths.

## D3 — The writer's window is measured, not assumed

The whole design is conditional on the writer's on-disk window being short relative to the budget. The
archived M32 record contains a sentence that reads as a denial — *"a retry would not save it"* — and
the honest response is neither to accept it nor to wave it away but to **make the condition checkable**.

`motion-scope.test.ts` measures its own probe window: the instant immediately before `writeFileSync`
and immediately after `rmSync`, in the same `it` block that owns the probe. That measurement is
asserted against the reader's budget, with both figures in the failure message.

This is deliberately the writer reporting on itself, not an observer timing it from outside. An
observer would have to be running concurrently, which is the condition that makes the measurement
unreliable in the first place — and it would add a second reader of the source tree, which is the class
of thing this change exists to reduce.

**The claim is that the window is bounded and short. It is not claimed that the probe could not grow**,
and the assertion is written so that growth fails loudly instead of quietly outliving the budget.

## D4 — What the writer does and does not change

`motion-scope.test.ts` gains the measurement and nothing else. It does not take a lock, does not move
the probe, does not change what it asserts, and does not change when the probe exists on disk.
M32 deliberately left this file untouched as the repository's only writer, and this change keeps that
property: the collision is fixed entirely from the reader side, and the writer is only made
*measurable*.

## D5 — Limits of the mechanism, stated rather than implied

- **The retry does not help a reader that is listing while a writer creates a file.** That is the
  opposite direction — a file appears between listing and reading, which no amount of re-listing
  detects, because the second listing simply contains it too. The reported failure is specifically
  *vanished*, so this direction is unaffected and also unaddressed by this change.
- **A reader that races on every attempt within the budget fails**, by design (D2.1). The budget must
  therefore be large relative to the window (D3) and small relative to the per-test timeout. Both
  numbers are recorded rather than tuned silently.
- **Repetition is per call.** A caller making many `readTree` calls — `architecture.test.ts` makes
  dozens — pays the budget once per colliding call, not once per suite. Under sustained contention that
  is still bounded but not free, and the memoisation above each call is what keeps it small.
- **`walk` can still throw an unretried `ENOENT`.** It is `existsSync(dir)` then `readdirSync(dir)`, so
  a **directory** vanishing between those two propagates as an ordinary error — not as a race, and not
  retried. This is pre-existing and unchanged by this work, and D5's first bullet does not cover it:
  D5 is about a file *appearing*, this is a directory *disappearing*, and they fail differently. Recorded
  in `tasks.md` §7 so it is not later mistaken for handled.
- **This makes the collision rarer, not impossible.** The delta's wording is "look again", and no
  section of it claims the race is gone. M32's note about the guard being a decidable proxy is
  unchanged and still accurate.

## D7 — The race did not reproduce locally, and that changes what the evidence must be

Recorded **before** implementation, from §1's measurement, because it decides how the rest of this
change has to be argued.

On `main@684d988`, **24 full-suite runs produced 1 red**, and the vanished-file race appeared in
**none** of them. M32 recorded **2 red of 8** with exactly that signature. Both numbers are real; they
were measured on different trees and, more importantly, under different machine load — this measurement
ran on an otherwise-idle box, while M32's ran alongside its Apply work.

Two consequences, and the second is the important one:

1. **The single red is unidentified.** It came from the first batch, whose per-run detail I did not
   retain — a mistake, corrected in the two batches that followed by capturing full output for every
   run, which is why 18 log files survive from runs 1–18. It was *not* the vanished-file race: the
   signature search came back empty. So there may be a **second** intermittent failure in this
   repository that M32 never saw and that this change will not fix. Recorded, not explained away.
2. **The retry's benefit cannot be demonstrated by a local flake-rate delta**, because the failure it
   targets does not occur here. A before/after comparison of red runs would read "0 → 0" and prove
   nothing either way.

So the evidence for this change rests on the deterministic proofs instead: the convergence arm, the
exhaustion arm, and the measured writer window, all driven through the existing `read` seam and all
run on every execution. That is not a consolation prize — a test that reproduces the defect by causing
it is strictly better evidence than one that waits for the defect to happen, which is the argument this
file's own header in `source-tree-race.test.ts` has been making since M25.

What the change *does* buy locally is the elimination of the mechanism rather than the suppression of
the symptom, and that is an argument about the code, not about a rate. **§5's re-measurement is still
required**, and its result must be reported as a count of runs, whatever it is.

## D6 — Rejected alternatives, with the reasons kept

| Alternative | Why not |
|---|---|
| Move the probe out of `src/` | Makes the guard under test prove nothing. Rejected by M25, forbidden by the spec's own scenario, and this change does not revisit it. |
| A lock file / marker / shared directory | M25's second rejection. A reader-side wait needs no protocol, so there is nothing to deadlock and no state to go stale between runs. |
| Retry inside `readTreeStrict` only | Leaves `architecture.test.ts`'s local reader on the failing path (D1). |
| Revert to M25's silent tolerance | Discharges neither half of the obligation, and is M32's option 2. |
| Unbounded repetition | A check that cannot fail. D2.1. |
| A polling seam driven by `setTimeout` | Requires making the reader async, which changes fourteen call sites for no benefit over `Atomics.wait`. |