# release-validation Specification

## Purpose

Whether this release can be shipped: the permanent product exclusions enforced by checks
rather than by review, the release gate runnable and honest about what it did not run, the
application's deployment contract asserted instead of assumed, and the two things the
checklist demands that nobody wrote.

## Requirements

### Requirement: The permanent product exclusions are enforced

Each permanent product exclusion SHALL be asserted by a check over the shipped sources, so
that introducing one fails a check rather than waiting to be noticed in review. Each
detector SHALL be proven against a violating input, and SHALL be proven against the real
sources so that a check which cannot fail, or which fails on a source that documents the
exclusion, is caught before it is trusted.

A permanent exclusion that an explicit roadmap change reverses SHALL be narrowed to the clauses
that survive, and never deleted outright, because a deleted detector is indistinguishable from
one that was switched off. Each clause removed from a narrowed detector SHALL be published with
the roadmap clause that authorised its removal, and each surviving clause SHALL be left intact.

#### Scenario: A permanent exclusion that is introduced fails a check

- **WHEN** a source, dependency, or configuration that ROADMAP's permanent product
  constraints forbid is added
- **THEN** the release check for that exclusion fails and names what it found

#### Scenario: A detector is known to be able to fail

- **WHEN** a detector for an exclusion is proven
- **THEN** it is shown failing on a violating snippet, so a detector that cannot fail is
  never mistaken for a passing one

#### Scenario: A source that documents an exclusion is not reported as breaking it

- **WHEN** a source explains in prose that it holds no account, credential, or third-party
  service, and names those words while doing so
- **THEN** the exclusion check passes, because a comment is not an account and a
  constraint's own documentation must not be the thing that trips its check

#### Scenario: The exclusions cover the whole permanent list

- **WHEN** the exclusion checks are enumerated
- **THEN** each clause the roadmap states as permanent has a check, including the clauses
  of any constraint whose other clauses an explicit roadmap change reversed: no accounts, no
  cloud sync, no cloud user database, no user database dependency, no conversion of
  downloaded audio to MP3, no caching of extracted audio for offline playback, no forced
  background-play circumvention, no ad-blocking behaviour, and no caller-supplied-URL
  media proxying

#### Scenario: A reversed clause is narrowed to, not deleted from, its detector

- **WHEN** an explicit roadmap change reverses one clause of a permanent product constraint
- **THEN** the detector covering that constraint is narrowed to its surviving clauses, and
  the removed clause is published with the roadmap clause that authorised its removal

#### Scenario: A narrowed detector is still proven able to fail

- **WHEN** a detector has been narrowed by a roadmap change
- **THEN** it is still shown failing on a violating snippet for every surviving clause, and
  is additionally shown failing on a snippet shaped like what the narrowing newly permits

### Requirement: The release gate is runnable and reports what it did not run

The release gate SHALL be executable as a single command, SHALL exit non-zero when any
automated check fails, and SHALL report for every checklist item either its result or the
reason it cannot be automated together with the steps to perform it manually. It SHALL NOT
report a single overall pass in place of per-item results.

The release gate SHALL NOT prepare its environment by deleting and recreating the dependency
directory it is validating. A failure to prepare the environment SHALL be reported as its own
named failure, and the remaining items SHALL be reported as not run rather than as failures of
the thing under test, because a cascade is a property of the environment and attributing it to
the product sends the reader to the wrong code.

#### Scenario: A failing check fails the gate

- **WHEN** an automated release check fails
- **THEN** the gate exits non-zero and names the item and what it found

#### Scenario: An item that cannot be automated is reported as not run

- **WHEN** the gate runs and a checklist item requires a human, a device, or a live
  deployment
- **THEN** the gate reports that item as not run, with the steps to perform it, rather than
  omitting it or reporting it as passed

#### Scenario: Every checklist item appears in the output

- **WHEN** the gate runs to completion
- **THEN** every checklist item is listed with its result or its reason for not running

#### Scenario: The environment cannot be prepared

- **WHEN** the gate's dependency install fails or leaves the dependency tree incomplete
- **THEN** exactly one failure is reported, naming the install, and the remaining items are
  reported as not run rather than as failures of the product

#### Scenario: The dependency tree is not destroyed to run the gate

- **WHEN** the gate begins
- **THEN** it does not delete and recreate the working tree's dependency directory, because a
  gate that can silently break a working tree cannot be the thing that validates one

#### Scenario: An item depends on an artifact that does not exist

- **WHEN** a gate item requires a build report that has not been produced
- **THEN** the item is reported as not run for that stated reason, and the gate's overall
  result states that the run was partial

### Requirement: The deployment contract is asserted

The application's deployable shape SHALL be asserted by checks rather than assumed, and SHALL
cover: a single application with no custom server and no request-interception hook; no
required environment variable; the response security policy declared where a CDN cannot remove
it rather than injected at the edge; and the service worker and manifest served as static files
whose caching does not prevent the worker's update flow.

The runtime the application is verified on SHALL be declared, and the declared runtime SHALL be
one the project's stated deployment target can actually build, with the CI workflow verifying
the same major, so that a host builds the thing that was tested rather than a thing that
merely resembles it.

#### Scenario: A shape that breaks single-application deployment fails a check

- **WHEN** a custom server or a request-interception hook is introduced
- **THEN** the deployment contract check fails, because either breaks the single
  deployable application the free tier depends on

#### Scenario: A required environment variable is introduced deliberately

- **WHEN** an environment variable becomes required for the application to run
- **THEN** the deployment contract check fails, because a required variable makes a
  deployment fail in a way nothing else would reveal until deployment

#### Scenario: A build uses a different runtime than the one verified

- **WHEN** the declared runtime and the runtime the CI workflow verifies are different majors
- **THEN** the deployment contract check fails, because the pin is then decorative and the
  host would build something other than the thing that was tested

#### Scenario: A runtime the deployment target cannot build fails a check

- **WHEN** the declared runtime names a major the stated deployment target does not offer
- **THEN** the deployment contract check fails and names the major and the supported set,
  because a build would otherwise fail on the target's own schedule rather than in this
  repository

#### Scenario: The check rejects a runtime the target cannot build

- **WHEN** the host-support check is proven
- **THEN** it is shown failing against every major the target does not offer, including the
  one this change replaced, so a check that cannot reject an unsupported pin is never mistaken
  for one that can

#### Scenario: The service worker can still update after deployment

- **WHEN** the deployment contract is checked
- **THEN** the service worker file is served as a static asset with caching that does not
  prevent a new worker from being fetched, because a long-lived cached worker is an
  application that cannot be updated

### Requirement: The release documentation states what it covers

The backup format and version SHALL be documented for a person, including the envelope's
version, its top-level fields, what each holds, the compatibility rule, and where the code
that writes it lives; and the document SHALL cite the checks that hold it honest. The
browser support matrix SHALL be documented, and SHALL state at the outset which targets are
covered by automated checks and which are manual, with instructions for each manual entry.

#### Scenario: A person can tell whether a backup can be restored

- **WHEN** someone holds a backup file and the release documentation
- **THEN** they can determine the format version, what the file contains, and whether this
  release will accept it, without reading source code

#### Scenario: The matrix does not imply coverage it does not have

- **WHEN** the browser support matrix is read
- **THEN** it states which targets are covered by automated checks and which are manual
  before listing any target, so a list of targets is not read as a list of verified
  targets

#### Scenario: A manual matrix entry is actionable

- **WHEN** a matrix entry is manual
- **THEN** it states what to open, what to do, and what to look for, so a person
  performing it knows what evidence to produce

### Requirement: The roadmap reflects the release

The release bookkeeping SHALL record the milestone's actual scope and status, the checks
that were run and their results, the items that were not run and why, and the limitations
that remain. It SHALL NOT record an item as delivered on the basis of a check that was not
run.

#### Scenario: An item that was not verified is recorded as unverified

- **WHEN** a release item could not be verified in this environment
- **THEN** the bookkeeping records it as unverified with the reason, rather than as
  delivered

#### Scenario: A recorded result is the result that was produced

- **WHEN** the bookkeeping states a count, a status, or a pass
- **THEN** it is the value the run or check produced, and it names what produced it

### Requirement: The application is reachable from the repository root

The repository root SHALL provide a manifest whose scripts run the application's commands, so
that a developer starting the application, testing it, or linting it does not first have to
change directory. The root manifest SHALL proxy to the application package and SHALL NOT
introduce a second dependency manifest, a second lockfile, or a workspace, and the application
directory SHALL remain where it is.

#### Scenario: The application starts from the repository root

- **WHEN** a developer runs the development command from the repository root
- **THEN** the application starts, and the command does not require a prior change of directory

#### Scenario: The root adds no second source of truth

- **WHEN** the root manifest is inspected
- **THEN** it declares no dependencies and the application package's lockfile remains the only
  one, so installing from the root cannot produce a manifest nothing installs from

#### Scenario: A root command reaches the application's own tooling

- **WHEN** a root command runs the formatter, the linter, or the type checker
- **THEN** it runs the application's configured tool over the application directory, and not a
  different command with a similar name

#### Scenario: Installation still has one correct path

- **WHEN** a developer is told how to install dependencies
- **THEN** there is one documented command that installs from the application lockfile, and it
  is reachable from the repository root, so the lockfile's location is not something a
  developer has to discover
