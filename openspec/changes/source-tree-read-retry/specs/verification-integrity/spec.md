# Spec Delta

## MODIFIED Requirements

### Requirement: A test may not mutate the tree another test reads

A test that writes a file into the application source tree SHALL NOT delete it while another test may
be reading that tree, because test isolation separates process state and not the filesystem. Such a
test SHALL write outside the tree, or take an explicit lock, or the reading test SHALL tolerate the
file's presence.

The reader's obligation SHALL be discharged by a check rather than by inspection. The repository SHALL
carry a check that reads the test files as they stand and fails when one of them reads the application
source tree by listing it and reading each listed file, without that read passing through a path which
both tolerates a vanished file and reports it. A recorded count of migrated readers SHALL NOT satisfy
this, because a count describes the readers that existed when it was written and not the ones that do.

Tolerating a vanished file SHALL mean looking again rather than reading less. A reader that finds a
listed file gone SHALL repeat the whole listing after a wait, rather than skip that file on first
contact, because a file that was present a moment ago and is not now is evidence that the tree was
being written and not that the tree cannot be read. The repetition SHALL be bounded by a stated budget,
and exhausting the budget SHALL remain a failure that names every raced path, so the promise the
reader makes is that it returns a complete read or fails — never that it quietly returns less.

A bounded repetition is only sound if the writer's window is shorter than the budget, and that SHALL be
asserted rather than assumed. The repository SHALL carry a check that measures how long the writing
test's file is on disk and fails when that window no longer fits inside the budget, so the case where
the repetition can no longer help is reported by the check instead of surfacing later as an
intermittent failure.

#### Scenario: A probe file exists while another test walks the tree

- **WHEN** two test files run concurrently and one has written a temporary source file
- **THEN** the tree-walking test does not fail because of a file the other test created and will
  delete

#### Scenario: A test asserts on a temporary file it created

- **WHEN** a guard needs a file to exist in order to be tested
- **THEN** the file is created at a path the guard under test walks, because a probe placed where the
  guard cannot see it would make that guard prove nothing
- **AND** every reader of the source tree tolerates a file that vanished between being listed and
  being read, and treats any other read failure as fatal
- **AND** the tolerating reader reports each vanished file, and its caller asserts that no file was
  reported, so a run that does lose a file fails rather than quietly reading fewer files than it
  believes

#### Scenario: A reader that lists a tree and reads each listed file is added

- **WHEN** a test file reads the application source tree by listing it and reading each listed file
- **THEN** the check fails unless that read tolerates a vanished file and reports it, because the
  obligation above was stated for four milestones and discharged by one of fourteen readers, with
  nothing failing in the meantime

#### Scenario: A reader tolerates the race without reporting it

- **WHEN** a reader skips a file that vanished instead of failing, and records nothing
- **THEN** the check fails, because a skip that is never reported is indistinguishable from a reader
  that never listed the file at all

#### Scenario: A vanished file reappears when the tree is read again

- **WHEN** a reader lists the tree, finds a listed file gone, and lists again after a wait
- **THEN** it returns the complete second listing and reports nothing, because the first listing was
  made while the tree was being written and never described what is on disk now

#### Scenario: The tree keeps changing for longer than the budget

- **WHEN** a reader finds a listed file gone on every attempt within the budget
- **THEN** it fails naming every raced path, because a bounded wait that never converges is a real
  condition and reporting it is the whole point of the budget being finite

#### Scenario: The writing test's window grows past the budget

- **WHEN** the test that writes into the source tree holds its file on disk for longer than the
  reader's budget allows
- **THEN** the check that measures the window fails naming both figures, because a repetition that
  cannot outlast the writer is not a slower fix but no fix at all

> **M21 Apply, 2026-10-04 — this scenario was rewritten because it did not describe what was
> implemented.** As first written it required the file to be created outside the application tree, and
> `design.md` §2.5 recorded that as the decision. The code does the opposite: the probe stays at
> `src/features/sharing/ProbeM19Motion.tsx`, because the guard under test asserts on the application
> sources and needs a file at a source path to be exercised at all. Independent verification, CRITICAL
> C7, found the spec and the design both advertising a decision the code had reversed.
>
> The rewrite keeps the requirement the scenario was reaching for — one guard must not break because
> another test wrote a file — and states it as a property of the *reader* rather than as a location
> rule. See `design.md` §2.5 for why tolerating a vanished file needs no excluded-directory constant,
> and therefore has no second spelling that can drift.

> **M32 — the second clause was true and discharged once.** M25 built the tolerant read path and
> applied it to the single reader it was shown. Thirteen other readers still listed the same tree and
> read each listed file unguarded, and one more skipped a vanished file without reporting it, while the
> scenario's "every reader" went unexamined by anything that could fail. The scenario was correct; the
> repository did not meet it, and a rule nothing fails on is a comment. That is why this requirement
> gains a second paragraph rather than a new requirement: the obligation is the same one, and what
> changed is that it is now checked.
>
> The writer side of this requirement is deliberately unchanged. The probe still lives inside the
> application source tree, because the guard under test asserts on the application sources and a probe
> the walkers cannot see would make it prove nothing.

> **M32 Apply — the check is a decidable proxy for the sentence above, and that is a deliberate gap
> between the requirement and its mechanism.** The requirement says the check fails when a file "reads the
> application source tree by listing it and reading each listed file". Deciding whether a read *depends on*
> a listing was attempted five times and failed five times — the last attempt missed `branding.test.tsx`,
> the one reader that failed live in M31. So the check does not decide it. It requires that a test file
> never calls `readdirSync`, and that a file importing the untolerated `walk` never reads inside a loop.
>
> Every reader the requirement is about trips one of those, which is why both scenarios above are
> discharged and proven by mutation. A reader of fixed, named paths trips neither, which is why the
> fixed-path readers §1.3 named stay exempt. The proxy is **stricter** than the requirement in one
> direction — a file that lists a directory and reads nothing from it still fails, hence the stated
> exemptions — and **weaker** in another: a listing obtained by importing a walker from a *new* module is
> not traced. Both directions are recorded in `tasks.md` §4.1 and `design.md` D3 rather than left to a
> reader of the code to discover.

> **M33 — the third paragraph turns M32's recorded problem into the shipped remedy, and it revises one
> sentence of M32's record rather than contradicting it.** M32 measured the consequence of making
> readers report: across 8 full-suite runs, 2 were red with `readTreeStrict: 1 file(s) vanished between
> being listed and being read`. That is the reporter working, and it is also a gate that is red about one
> run in four.
>
> M32 closed by recording three options and taking none, and it noted that *"a retry would not save it"* —
> the vanished file being gone for the duration of the writer's `it` block. **That sentence describes the
> implementation M32 shipped, which throws on first contact; it is not a claim that no repetition can
> succeed**, and this paragraph rests on that distinction rather than on the sentence being wrong. The
> distinction is the reason the fourth paragraph exists: the claim that a repetition outlasts the writer
> is asserted by a measurement, not by this note.
>
> **The remedy is the requirement's own second-listed one, an explicit lock, realised as a wait on the
> reader side.** Relocating the probe stays rejected — a probe the walkers cannot see makes the guard
> under test prove nothing — and no marker file, shared directory or inter-worker protocol is
> introduced, so there is nothing to deadlock and no state to go stale between runs. Both reader
> families are covered by the same change because M32 routed both through `tests/helpers/sourceTree.ts`.
>
> **What did not change:** exhausting the budget is still a failure naming every raced path, and a
> reader still never returns a partial listing. The repetition narrows *when* a collision is reported.
> It does not make a collision unreportable.