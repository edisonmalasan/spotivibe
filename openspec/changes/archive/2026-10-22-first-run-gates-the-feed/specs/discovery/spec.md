# Spec Delta

## REMOVED Requirements

### Requirement: Language catalog and first-run onboarding

**Reason**: its first-run half describes a dialog that was deleted in M28, and it has said the
opposite of the `home-mixes` capability about what first run is since that milestone.

The removed requirement said a user who has not completed onboarding *"SHALL be offered language
selection on first run, presented as an explicit, dismissible-or-confirmable choice that can be
completed with one or more languages"*, and that *"Completing it SHALL persist the selected languages
and the completed state through the local preferences repository"*. **The code has done none of that
since M28**: the language dialog was replaced by an artist picker, and the `home-mixes` requirement
says so in terms — *"SHALL present a first-run surface offering **artist** selections … and SHALL NOT
present a language-selection dialog."*

Two capabilities asserting opposite things about first run is not a documentation blemish. It is a
spec that an implementer can read and build the wrong thing from, and M34 and M35 each recorded the
contradiction and deferred it to a change that owns the first-run requirement as a whole. This is
that change.

**Migration**: the requirement's true half — the language catalog, and the language preference being
changeable and persistent — is carried by the requirement added below, which states it without
claiming a first-run surface that does not exist. The first-run surface itself remains specified, in
one place only, by `home-mixes`' *"First run asks for artists, not languages"*, so the two
capabilities agree rather than contradict. Nothing in the code changes for this removal: the code has
not offered language selection at first run since M28, and the removal makes the specification match
what the code has always done.

## ADDED Requirements

### Requirement: Language catalog and language preference

The application SHALL offer a catalog of at least 37 selectable languages, each identified by a stable
language code with a human-readable name. The selected languages SHALL be a **preference** rather than
a profile: they SHALL be persisted locally, SHALL survive reload, and SHALL NOT require an account.

The selected languages SHALL remain changeable from Settings, and changing them SHALL persist the same
way. **First run SHALL NOT offer language selection** — the first-run surface asks for artists, and is
specified in `home-mixes`' *"First run asks for artists, not languages"*. This capability states the
language catalog and the language preference; it does not state a first-run surface, so that the two
capabilities cannot come to disagree about one again.

#### Scenario: First run does not offer language selection

- **WHEN** a user opens the app with onboarding not yet completed
- **THEN** language selection is not offered, and no account, sign-in, or email prompt is shown

#### Scenario: The language preference persists

- **WHEN** the selected languages are persisted and the app is reloaded
- **THEN** the same languages are selected, and no account was required to do it

#### Scenario: Languages are changeable later

- **WHEN** the user changes the selected languages from Settings
- **THEN** the new selection persists across reload and feeds follow it

#### Scenario: Catalog stays broad

- **WHEN** the language catalog is inspected
- **THEN** at least 37 languages are selectable, each with a stable code and a readable name
