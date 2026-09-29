# Spec Delta

## MODIFIED Requirements

### Requirement: Popular artists shelf

The feed SHALL present a Popular Artists shelf derived by grouping discovery results by canonical artist identity, showing one entry per artist with that artist's artwork when available, rendered as circular artist cards. Artist entries SHALL be deduplicated by artist identity and ordered deterministically. Activating an artist entry SHALL navigate to that artist's own surface — the catalog capability's artist route — using the provider's artist identity when the entry has one and the artist's name otherwise, and SHALL NOT require a search refinement. The shelf SHALL render an explanatory empty state when no artist entries can be derived.

#### Scenario: Grouping yields one entry per artist

- **WHEN** discovery results contain several tracks by the same artist
- **THEN** the shelf lists that artist once, with the best available artwork and a deterministic position

#### Scenario: Artist cards are circular with artwork

- **WHEN** an artist entry with artwork renders
- **THEN** it uses the circular artist card with the image, the artist name, and the Artist label

#### Scenario: Activating an artist refines search

<!-- Scenario name retained verbatim: a MODIFIED block must carry every scenario
     the main spec still has, and the validator matches on names. The asserted
     behavior changed in M9 — the entry now opens the artist's own page, keyed
     by provider identity when present and by name otherwise. -->
- **WHEN** the user activates a Popular Artists entry
- **THEN** that artist's own page opens, keyed by the provider artist identity when the entry has one and by the artist's name otherwise
