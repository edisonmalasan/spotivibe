# Spec Delta

## MODIFIED Requirements

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