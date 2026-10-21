# Spec Delta

## MODIFIED Requirements

### Requirement: Quick Picks are artist surfaces that exist

The Home surface SHALL present a Quick Picks shelf of **artist** entries. Every Quick Pick SHALL be a
resolvable artist: it SHALL carry a canonical artist identity, SHALL render as a circular artist card
showing the artist's name, the label `Artist`, and the artist's own artwork when the provider
supplied any, and SHALL navigate to that artist's own surface on activation using the provider artist
identity when the entry has one and the artist's name otherwise.

A Quick Pick SHALL NOT be rendered as a non-interactive element, and SHALL NOT carry an empty or
unresolvable target.

A Quick Pick SHALL NOT be a search, a release, or any other kind of entry. The shelf SHALL NOT render
a card for a selected language, and SHALL NOT reserve rail capacity for one. Where the device holds
no local material, the shelf SHALL complete the rail from provider results the Home surface already
holds in memory, and from curated popular artists. Completing the rail this way SHALL introduce no
new request and no new stored data of its own. **Artists the listener explicitly picked during
first-run onboarding are not provider results**: where such picks exist they are a source in their
own right, ranked above provider results and above derived local material, and the cold-start gate no
longer applies to them.

**The shelf SHALL offer curated popular artists, shaped by the selected languages.** A curated popular
artist is an artist the application knows by name, rather than one it inferred from the listener's
material or from the provider's results. Curated popular artists SHALL be ranked below local material
and below the listener's explicit picks, and SHALL NOT displace, outrank, or reorder an entry derived
from either. They SHALL be shaped by the selected languages, and a language that has no list of its
own SHALL be offered artists from a list that is not language-specific. The shelf SHALL never be
empty: where no other source offers an artist, it SHALL offer curated popular artists. Curated popular
artists SHALL NOT be offered as one card per selected language, and a selection that would otherwise
yield a single card SHALL be completed to more than one. Curated popular artists SHALL NOT be
required in order for the rail to hold artist entries, and the shelf SHALL never fall back to a
non-artist entry to fill itself.

Provider results SHALL NOT contribute entries while any local material exists, and SHALL NOT
displace, outrank, or reorder an entry derived from local material. Provider results SHALL NOT be
required in order for the rail to hold artist entries: the shelf SHALL never fall back to a
non-artist entry to fill itself.

Where provider results are used, the selected languages SHALL shape **which artist candidates are
offered** rather than what kind of card is offered: an artist whose tracks carry a selected language
SHALL be preferred over an artist whose tracks carry none, and the preference SHALL NOT remove an
otherwise valid artist in order to satisfy it. The same holds for curated popular artists, whose
membership of the rail is determined by the selected languages rather than by the provider's results.
The shelf SHALL remain deterministic and SHALL NOT offer the same artist twice.

Artist entries SHALL be deduplicated by canonical artist identity and by the artist's name, so an
artist offered once under a provider identity and again under a name is offered once. Artist artwork
SHALL resolve from artwork already carried by the candidate tracks; the derivation SHALL issue no
request of its own to obtain it, and an artist whose tracks carry no artwork SHALL render the
application's existing artist placeholder rather than a broken image.

#### Scenario: Every Quick Pick navigates somewhere

- **WHEN** a Quick Pick is activated
- **THEN** the application navigates to the surface that target names

#### Scenario: No Quick Pick has an unresolvable target

- **WHEN** the Quick Picks shelf renders
- **THEN** every card carries a non-empty artist target that resolves to an artist route

#### Scenario: Quick Picks derive from local material

- **WHEN** Quick Picks are derived
- **THEN** they are derived from the local listening profile, liked artists and tracks, existing
  provider results the Home surface already holds, and curated popular artists

#### Scenario: A device with no local material is still offered artists

- **WHEN** Quick Picks are derived for a device with no liked tracks and no listening events, and the
  Home surface holds resolved provider results
- **THEN** the shelf offers artist entries derived from those results, or curated popular artists
  where those results offer none

#### Scenario: A full set of selected languages still permits artist Quick Picks

- **WHEN** Quick Picks are derived for a device whose selected languages fill the maximum selection
  and which holds no local material
- **THEN** the shelf offers artist entries derived from the provider results or from curated popular
  artists, and renders no search card and no entry standing for any selected language

#### Scenario: Quick Picks never become one card per selected language

- **WHEN** Quick Picks are derived for any device, with any number of selected languages
- **THEN** no entry in the rail is a selected language, and the number of entries never equals the
  number of selected languages by that coincidence

#### Scenario: A selected language shapes candidates rather than card type

- **WHEN** the selected languages change and the candidate tracks carry language metadata
- **THEN** the offered artist candidates are ordered to prefer artists with tracks in a selected
  language, and every entry offered remains an artist

#### Scenario: Local evidence is never displaced by provider results

- **WHEN** Quick Picks are derived for a device that holds liked tracks or listening events, and
  provider results are also available
- **THEN** no entry derived from local material is displaced, outranked, or reordered by provider
  results, and the entries derived from it are the entries the shelf leads with

#### Scenario: Local evidence is never displaced by curated popular artists

- **WHEN** Quick Picks are derived for a device that holds liked tracks or listening events, and
  curated popular artists are also available
- **THEN** no entry derived from local material is displaced, outranked, or reordered by them, and
  the entries derived from it are the entries the shelf leads with

#### Scenario: Completing the rail reads no new request

- **WHEN** Quick Picks are derived from provider results or from curated popular artists
- **THEN** the derivation reads only its arguments and performs no request of its own

#### Scenario: Every Quick Pick is a resolvable artist navigation target

- **WHEN** the Quick Picks shelf renders
- **THEN** every card's href resolves to the artist route for its canonical artist identity

#### Scenario: Duplicate artists are offered once

- **WHEN** the candidate material names the same artist under one provider identity and again under a
  different name or a different provider identity
- **THEN** the rail offers that artist exactly once

#### Scenario: Artist artwork renders when the provider supplied it

- **WHEN** an artist's candidate tracks carry artwork
- **THEN** the card renders that artist's own image, not a generic placeholder

#### Scenario: Missing artist artwork degrades to the existing placeholder

- **WHEN** an artist's candidate tracks carry no artwork
- **THEN** the card renders the application's existing artist placeholder

#### Scenario: Artist cards are circular and labelled

- **WHEN** the Quick Picks shelf renders
- **THEN** each card uses the circular artist geometry and shows the artist name with the label
  `Artist`

#### Scenario: Quick Pick artwork is not fetched per card

- **WHEN** Quick Picks are derived
- **THEN** no request is issued to obtain artist artwork, because the artwork is read from the
  candidate tracks the caller already supplied

#### Scenario: The rail holds only one circular artist section

- **WHEN** Home renders
- **THEN** exactly one section of the feed uses circular artist geometry, and no two circular
  sections are adjacent

#### Scenario: The rail is never empty

- **WHEN** Quick Picks are derived for a device with no explicit picks, no local material, and no
  provider results
- **THEN** the shelf offers curated popular artists, because a rail with no artist in it is a dead
  end rather than a first run

#### Scenario: A language with no list of its own is still offered artists

- **WHEN** the selected languages include a language the application holds no curated list for
- **THEN** the shelf offers artists from a list that is not language-specific, so the rail does not
  depend on the catalog's coverage

#### Scenario: The rail is never one card per selected language

- **WHEN** the selected languages would yield a single curated popular artist
- **THEN** the shelf offers more than one, because a rail holding exactly one card per selected
  language is the shape this requirement forbids

#### Scenario: Curated popular artists are shaped by the selected languages

- **WHEN** the selected languages change
- **THEN** the curated popular artists offered change with them, because their membership of the rail
  is determined by the selected languages rather than by the provider's results

#### Scenario: Curated popular artists resolve to a real artist

- **WHEN** a curated popular artist is offered
- **THEN** its target resolves to the artist route for that artist's name, and it carries no artwork
  of its own, so it renders the application's existing artist placeholder
