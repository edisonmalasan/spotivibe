# Proposal — M33: make the tolerance wait instead of failing at once

## Why

M32 made every reader of the application source tree report a file that vanished between being
listed and being read. It measured the consequence and recorded it as the milestone's most important
finding: **across 8 full-suite runs, 2 were red**, every one with

```
readTreeStrict: 1 file(s) vanished between being listed and being read under ...\frontend\src
```

That is M32 working. `readTreeStrict` caught a real collision, named it, and failed rather than
silently reading fewer files than it believed. It is also a gate that is red one run in four, which
is a gate nobody can rely on — and M32 recorded that "the gate is reliably green" is **not** something
the change claims.

M32 then closed with three options, all of them spec decisions rather than implementation details, and
took none of them:

1. accept an intermittently red gate in exchange for a suite that never silently under-reads;
2. revert to tolerating, and lose the reporting half the whole change exists to discharge;
3. amend the spec to allow removing the collision — serialising the writer, or relocating the probe.

This change takes **option 3, by the remedy the requirement already names**, and leaves the other two
untouched. The requirement's own first sentence already offers it:

> Such a test SHALL write outside the tree, **or take an explicit lock**, or the reading test SHALL
> tolerate the file's presence.

M25 rejected a lock — *"vitest's workers share a filesystem and do not coordinate, so a lock means
implementing coordination for one test"* — and rejected relocating the probe, because a probe the
walkers cannot see makes the guard under test prove nothing. Both rejections still hold. What has
changed is the arithmetic behind them.

## What

**M32 put every reader through one shared helper.** `frontend/tests/helpers/sourceTree.ts` is now the
single place a source tree is listed and read, and both reader families reach it: the fourteen files
that call `readTreeStrict`, and `architecture.test.ts`'s local memoising wrapper, which calls the same
`readTree` and then asserts `racedFiles` is empty at the end of its suite. That is what turns the
next step from "implementing coordination for one test" into one change in one file.

So: when a listed file vanishes, **the read is retried** — the whole listing, from scratch, after a
wait — rather than skipped on first contact. A file that was there a moment ago and is not now is
evidence that the tree was being written, not that the tree is unreadable, and the correct response to
a transient is to look again.

`onRace` therefore stops meaning *"this happened"* and starts meaning **"this is still happening after
the budget"**. `readTreeStrict` still throws, naming every path, when the budget is exhausted. Nothing
about the guarantee is weakened: the promise is that a reader never silently under-reads, and a retry
that succeeds returns a *complete* read while a retry that fails still reports and fails.

## The load-bearing assumption, and why it is checked rather than argued

A retry is only sound if the writer's window is bounded and short relative to the budget. This change
**rests** on that, and M32's record contains a sentence that looks like it contradicts it:

> the vanished file is gone for the duration of the writer's `it` block — so a retry would not save it.

That sentence is about the shipped implementation, which throws on first contact; it is not a claim
that no retry can succeed. But "the archived note is probably reading it narrowly" is exactly the kind
of argument this repository has been burned by before, so **the window is measured in the repository
and asserted against the budget**, by the writer itself. If the probe's on-disk lifetime ever grows
past the reader's budget, that test fails and says so, rather than the reader quietly ceasing to help.

## What this does not do

- It does **not** move the probe out of `src/`. That would keep the gate green by making the guard
  under test prove nothing, which is the specific thing M25 rejected and the spec's own scenario
  forbids.
- It does **not** add a lock, a marker file, a shared state directory, or any inter-worker
  coordination. There is no protocol to get wrong, nothing to deadlock, and no state to go stale
  between runs.
- It does **not** touch production code, dependencies, manifests, the gate script, or the CI workflow.
- It does **not** relax `readTreeStrict`. A reader that cannot get a complete read within the budget
  still fails, still names every raced path, and still says the run checked fewer files than it
  believed.

## Evidence this change must produce

- A green baseline before anything is mutated, and **each new detector proven to fail** — a retry that
  cannot be shown to fail is a retry nobody knows is doing anything.
- The retry's two arms shown separately and deterministically through the existing `afterList` seam: a
  read that succeeds on a later attempt reports nothing, and a read that never succeeds exhausts the
  budget and reports everything.
- The writer's probe window measured against the budget, as a checked fact rather than a comment.
- A measured flake rate over repeated full-suite runs, compared against M32's 2-of-8, reported as a
  count of runs and not as a single green gate run.

## Out of scope, recorded not absorbed

Found while reconciling the tree before this change began, and **not** addressed here:

- **The root lockfile guard detects one spelling, not the property.** `root-commands.test.ts` asserts
  *"the application lockfile is the only one"* while checking only `package-lock.json`. `AGENTS.md`
  says the only lockfile is `frontend/package-lock.json`, and that a second one at the root is exactly
  what must not exist — yet `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` and `bun.lockb` at the root would
  all pass that guard. This is a live instance, not a hypothetical: an untracked root `pnpm-lock.yaml`
  and a two-entry root `node_modules/` are present in the working tree right now, both left by a `pnpm`
  run at the repository root, both untracked, and neither caught by anything. This belongs to
  `verification-integrity`'s "a check's name does not overstate its scope" and "a guard detects a
  spelling, not the property", and it deserves its own change rather than being folded in here.
- Everything M31 and M32 carried forward: `icons:check` absent from the gate and CI with no root
  proxy; `sync-m18-interactions.mjs` unused by M30's Sync; the gate not asserting its own working tree;
  M21 CRITICAL 1 & 2 unclosable without the forbidden archived gate; M25's criterion 5 of 6
  permanently unmet; `scripts/sync-m17-home.mjs` dropping a spec's trailing newline; no gate batch run
  for M31 or M32.

## Scope

Test files, `frontend/tests/helpers/sourceTree.ts`, and the spec delta. No production code. No
dependency, manifest, gate-step or client-bundle change.