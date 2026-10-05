# Spec Delta

## MODIFIED Requirements

### Requirement: Quick Picks lead to surfaces that exist

The Home surface SHALL present a Quick Picks shelf derived from the listener's selected languages,
the local listening profile, liked artists and tracks, and existing provider results. Every Quick
Pick SHALL carry a kind and a target that the application can already resolve, and SHALL be rendered
as a control that navigates to that target.

A Quick Pick SHALL NOT be rendered as a non-interactive element, and SHALL NOT carry an empty or
unresolvable target.

Where the device holds no local material — no liked tracks and no listening events — the shelf
SHALL complete the rail from provider results the Home surface already holds in memory, ordered
ahead of the language entries. Completing the rail this way SHALL introduce no new request and no
new stored data.

Provider results SHALL NOT contribute entries while any local material exists, and SHALL NOT
displace, outrank, or reorder an entry derived from local material. Where provider results are used,
they SHALL NOT occupy the whole bound: at least the language entries SHALL remain.

#### Scenario: Every Quick Pick navigates somewhere

- **WHEN** a Quick Pick is activated
- **THEN** the application navigates to the surface that target names

#### Scenario: No Quick Pick has an unresolvable target

- **WHEN** the Quick Picks shelf renders
- **THEN** every card carries a non-empty target of a recognised kind

#### Scenario: Quick Picks derive from local material

- **WHEN** Quick Picks are derived
- **THEN** they are derived from the selected languages, the local listening profile, and the
  listener's liked artists and tracks, with no new stored data introduced

#### Scenario: A device with no local material is offered more than the language entry

- **WHEN** Quick Picks are derived for a device with no liked tracks and no listening events, the
  Home surface holds provider results, and the selected languages leave at least one slot free
- **THEN** the shelf offers artist and release entries derived from those results ahead of the
  language entries, each resolving to a surface that already exists

#### Scenario: A full set of selected languages keeps the rail to itself

- **WHEN** Quick Picks are derived for a device with no local material whose selected languages
  already fill the shelf's bound
- **THEN** the shelf offers the language entries and no provider-derived entry, because the
  reservation exists to keep the language entries from being crowded out by provider volume and not
  to be squeezed by them

#### Scenario: Local evidence is never displaced by provider results

- **WHEN** Quick Picks are derived for a device that holds liked tracks or listening events, and
  provider results are also supplied
- **THEN** the shelf's entries are exactly those it would offer without those results

#### Scenario: Completing the rail reads no new request

- **WHEN** Quick Picks are derived from provider results
- **THEN** the derivation reads only its arguments and performs no request of its own

#### Scenario: The language entries survive a full stand-in pass

- **WHEN** Quick Picks are derived with no local material and enough provider results to fill the
  shelf's bound
- **THEN** the shelf still offers at least the entry for the default language