# Spec Delta

## MODIFIED Requirements

### Requirement: Mix identity and naming

Every mix SHALL have a stable identity and a name, derived from the strongest local signal available,
recorded with the generation period. A name SHALL satisfy the application's honest-naming rule: it
SHALL NOT claim more than the mix knows, and where no signal supports a specific name the neutral
fallback SHALL be used.

Named mix cards offered on Home SHALL select a mix's seeds rather than composing it, and every card
name SHALL satisfy the same honest-naming rule. A card's name SHALL reflect a **taste** claim, not a
clock claim: naming a mix for the hour it was made would assert something the mix cannot support.

#### Scenario: A mix keeps its identity and name

- **WHEN** a mix is generated
- **THEN** it has a stable identity and a name that persists across views of it

#### Scenario: The name comes from the strongest local signal

- **WHEN** a mix is named
- **THEN** the name is derived from the strongest available local signal

#### Scenario: The generation period is recorded

- **WHEN** a mix is generated
- **THEN** the period it was generated for is recorded with it

#### Scenario: A name is never more specific than the evidence

- **WHEN** no local signal supports a specific name
- **THEN** the neutral fallback name is used rather than an invented one

#### Scenario: A card's identity selects seeds without composing

- **WHEN** a named mix card is presented
- **THEN** the card exposes an identity and its seeds are selected, but no mix has been composed yet

#### Scenario: A card name is a taste claim, not a clock claim

- **WHEN** a named mix card is named
- **THEN** the name describes a taste or mood and does not assert the time of day it was made
