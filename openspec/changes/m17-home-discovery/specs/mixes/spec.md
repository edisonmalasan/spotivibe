# Spec Delta

## MODIFIED Requirements

### Requirement: Mix identity and naming

A generated mix SHALL have a stable identity and a name, both persistent across reloads and across the period it was generated in, so the listener can recognize and re-enter it. The name SHALL be derived from the mix's strongest local signal — its top artist where one is present, otherwise its leading genre, otherwise a neutral local label — and SHALL NOT claim a ranking, an editorial selection, or any status beyond what this device derived. The period in which a mix was generated SHALL be recorded with it.

Named mix cards offered on Home SHALL select a mix's seeds rather than composing it, and every card name SHALL satisfy the same honest-naming rule, falling back to the neutral name where no signal supports a specific one. A card's name SHALL reflect a **taste** claim, not a clock claim: naming a mix for the hour it was made would assert something the mix cannot support. A card's identity SHALL be separate from its display name, so an identity may be named for what it asks for while the name it shows remains within what its evidence supports.

#### Scenario: A mix keeps its identity and name

- **WHEN** a mix is revisited after a reload
- **THEN** it has the same identity, the same name, and the same tracks

#### Scenario: The name comes from the strongest local signal

- **WHEN** a mix is generated
- **THEN** its name names the artist it contains most, or its leading genre when no artist dominates, and carries no chart or editorial claim

#### Scenario: The generation period is recorded

- **WHEN** a mix is generated
- **THEN** the mix records the period it was generated in, and a later regeneration within that period is a refresh rather than a new identity

#### Scenario: A name is never more specific than the evidence

- **WHEN** no local signal supports a specific name
- **THEN** the neutral fallback name is used rather than an invented one

#### Scenario: A card's identity selects seeds without composing

- **WHEN** a named mix card is presented
- **THEN** the card exposes an identity and its seeds are selected, but no mix has been composed yet

#### Scenario: A card name is a taste claim, not a clock claim

- **WHEN** a named mix card is named
- **THEN** the name describes a taste or mood and does not assert the time of day it was made