# Spec Delta

## MODIFIED Requirements

### Requirement: First run asks for artists, not languages

On a device that has not completed first-run onboarding, the application SHALL present a first-run
surface offering **artist** selections derived from the Quick Picks rail, and SHALL NOT present a
language-selection dialog.

The language preference SHALL remain available and editable in Settings. Removing the first-run
question about languages SHALL NOT remove the ability to choose languages, and SHALL NOT change how
discovery, mix plans, or the time shelf use the selected languages.

The first-run surface SHALL gate the dashboard: the discovery feed SHALL NOT be presented until
onboarding is completed or dismissed. A listener who dismisses without selecting anything SHALL reach
the dashboard rather than being held.

**The artist selection SHALL be as changeable afterwards as the language selection is now.** The
first-run surface answers a question once, and an answer a listener cannot revise is a decision
rather than a question. The application SHALL therefore offer the same artist selection outside
first run, and a listener who dismisses the first-run surface without choosing SHALL still have a
reachable way to choose later. Offering that selection elsewhere SHALL NOT change what is stored, and
SHALL NOT re-present the first-run surface to a listener who has already answered it.

**The first-run surface SHALL distinguish "not known yet" from "nothing to offer".** The artists it
offers are derived from a shelf whose contents are not known until a request settles, and a surface
that reports an empty set before it has asked cannot distinguish a device with no artists from a
device whose artists have not arrived. It SHALL NOT offer a dismissal, or state that there are no
artists, before the shelf has settled. Once the shelf has settled and offers nothing, the surface
SHALL say so and SHALL point at the place where artists can be chosen later, and that place SHALL
exist.

**Resetting the application's local data SHALL clear the first-run gate.** A reset that leaves the
first-run question answered but its answer deleted is a reset that cannot be repeated, and it leaves
the listener in a state the application itself considers empty.

#### Scenario: A new device is opened

- **WHEN** the Home route is opened on a device that has not completed onboarding
- **THEN** the artist onboarding surface is presented, no language dialog is presented, and the
  discovery feed is not yet presented

#### Scenario: The language preference is still reachable

- **WHEN** the first-run language dialog no longer exists
- **THEN** the selected languages remain visible and editable in Settings, and discovery still
  filters by them

#### Scenario: A listener who dismissed the first run can still choose artists

- **WHEN** a listener has dismissed the first-run surface without choosing, and opens the place where
  artists are chosen
- **THEN** the same artist selection is offered, and a selection made there is stored and feeds the
  Quick Picks rail, because a first-run answer a listener cannot revise is a decision rather than a
  question

#### Scenario: The artist selection is changeable later, as the language selection already is

- **WHEN** the user changes the selected artists from Settings
- **THEN** the new selection persists across reload and is the selection the Quick Picks rail offers

#### Scenario: The first-run surface is shown before the artists are known

- **WHEN** the first-run surface is presented on a device whose artist shelf has not yet settled
- **THEN** it does not report that there are no artists and does not offer a dismissal, because an
  empty set reported before the question has been asked is not an answer

#### Scenario: The shelf settles with no artists at all

- **WHEN** the artist shelf has settled and offers no artists
- **THEN** the first-run surface says so and points at the place where artists can be chosen later,
  and that place exists

#### Scenario: Local data is reset

- **WHEN** the listener resets the application's local data
- **THEN** the first-run gate is cleared, and the next visit to Home asks again, because a reset
  that leaves the question answered but the answer deleted is a reset that cannot be repeated
