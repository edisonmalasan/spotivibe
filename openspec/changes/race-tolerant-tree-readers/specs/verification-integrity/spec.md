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
