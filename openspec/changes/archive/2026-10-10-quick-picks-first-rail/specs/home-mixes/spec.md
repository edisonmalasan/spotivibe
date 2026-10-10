# Spec Delta

## ADDED Requirements

### Requirement: The artist Quick Picks rail is the first content Home presents

Home SHALL render the Quick Picks artist rail as the first content below the filter bar, ahead of the
mix-card row, the time-of-day shelf, and every discovery section.

The artist rail is the one surface that speaks to who the listener already is. A rail derived from the
selected languages, or from the time of day, answers a different question, and a listener opening Home
meets those answers first. Making the rail artist-only is not sufficient on its own: an artist rail
that renders third, behind language-derived mix cards, presents the same first impression as the
language-first arrangement it replaced.

The mix-card row, the time shelf, and the discovery sections SHALL keep their content and their
relative order to one another. Only Quick Picks' position changes.

This SHALL be asserted against **rendered document order**, and the assertion SHALL require the rail to
be first rather than merely near the top. A bound the current arrangement satisfies is a bound that
cannot detect the arrangement being changed.

#### Scenario: Home is opened on a fresh device

- **WHEN** the Home route renders
- **THEN** the Quick Picks artist rail is the first rendered shelf row, ahead of the mix-card row, the
  time-of-day shelf, and the section stack

#### Scenario: A rail has moved behind a language-derived rail

- **WHEN** the mix-card row or the time-of-day shelf renders above the Quick Picks rail
- **THEN** the ordering assertion fails, naming the rail that moved rather than reporting a count

### Requirement: A containment bound that the current arrangement satisfies cannot guard the arrangement

An assertion about where a surface appears SHALL state the position that is required, not a window the
present arrangement happens to fall inside.

An assertion such as "the circular rail is within the first four rendered sections" is satisfied by an
artist rail rendering first, third, or fourth. It therefore reports green for an arrangement that puts
language-derived rails ahead of the artist rail, and it cannot fail on the change it names.

This SHALL be recorded when a containment bound is replaced by a positional requirement, so the reason
the weaker bound was previously acceptable — that it encoded a rhythm rule rather than a position — is
not lost along with it. The rhythm contract itself is unchanged: `shelfRhythmViolations` still forbids
a circular row adjacent to another circular row and past `CIRCULAR_WINDOW`.

#### Scenario: The weaker bound is in place

- **WHEN** the ordering assertion permits the artist rail anywhere in the first four rows
- **THEN** moving the rail behind two other rows leaves the assertion green, and the requirement that
  it be first is not enforced
