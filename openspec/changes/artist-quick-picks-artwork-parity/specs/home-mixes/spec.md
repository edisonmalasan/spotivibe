## REMOVED Requirements

### Requirement: Quick Picks lead to surfaces that exist

**Reason**: superseded by "Quick Picks are artist surfaces that exist". The retired requirement
allowed the rail to hold three kinds of entry — artist, release, and search — and required that
selected languages be offered as `Search` cards with rail capacity reserved for them. Because
`MAX_SELECTED_LANGUAGES` equals `MAX_QUICK_PICKS`, that design's maximum selection yields eight
`Search` cards and zero artists, and the reservation meant even the minimum selection rendered a
language card at the end of an otherwise artist-only rail — measured on production as a fresh
profile showing seven artists plus a card named `English`.

Three scenarios are retired with it, and the reason for each is recorded rather than left implicit:

- **"A device with no local material is offered more than the language entry"** — retired because it
  describes the outcome in terms of what precedes "the language entries". The behaviour it protects
  is real and survives: a cold device is offered entries derived from provider results. That is now
  stated by "A device with no local material is still offered artists".
- **"A full set of selected languages keeps the rail to itself"** — retired because it *requires* the
  eight-language outcome the user identified as the defect. Selected languages no longer occupy the
  rail at all, so there is nothing for them to keep. Replaced by "A full set of selected languages
  still permits artist Quick Picks", which requires the opposite outcome.
- **"The language entries survive a full stand-in pass"** — retired because there are no language
  entries to survive. The stand-in is no longer required to leave room for them.

**Migration**: callers constructing a `search` or `album` Quick Pick stop compiling, because the kind
narrows to `"artist"`. The intent behind each retired scenario is carried by a named scenario in the
replacement requirement.

## ADDED Requirements

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
holds in memory. Completing the rail this way SHALL introduce no new request and no new stored data.

Provider results SHALL NOT contribute entries while any local material exists, and SHALL NOT
displace, outrank, or reorder an entry derived from local material. Provider results SHALL NOT be
required in order for the rail to hold artist entries: the shelf SHALL never fall back to a
non-artist entry to fill itself.

Where provider results are used, the selected languages SHALL shape **which artist candidates are
offered** rather than what kind of card is offered: an artist whose tracks carry a selected language
SHALL be preferred over an artist whose tracks carry none, and the preference SHALL NOT remove an
otherwise valid artist in order to satisfy it. The shelf SHALL remain deterministic and SHALL NOT
offer the same artist identity twice.

Artist entries SHALL be deduplicated by canonical artist identity. Artist artwork SHALL resolve from
artwork already carried by the candidate tracks; the derivation SHALL issue no request of its own to
obtain it, and an artist whose tracks carry no artwork SHALL render the application's existing artist
placeholder rather than a broken image.

#### Scenario: Every Quick Pick navigates somewhere

- **WHEN** a Quick Pick is activated
- **THEN** the application navigates to the surface that target names

#### Scenario: No Quick Pick has an unresolvable target

- **WHEN** the Quick Picks shelf renders
- **THEN** every card carries a non-empty artist target that resolves to an artist route

#### Scenario: Quick Picks derive from local material

- **WHEN** Quick Picks are derived
- **THEN** they are derived from the local listening profile, liked artists and tracks, and existing
  provider results the Home surface already holds

#### Scenario: A device with no local material is still offered artists

- **WHEN** Quick Picks are derived for a device with no liked tracks and no listening events, and the
  Home surface holds resolved provider results
- **THEN** the shelf offers artist entries derived from those results

#### Scenario: A full set of selected languages still permits artist Quick Picks

- **WHEN** Quick Picks are derived for a device whose selected languages fill the maximum selection
  and which holds no local material
- **THEN** the shelf offers artist entries derived from the provider results, and renders no search
  card and no entry standing for any selected language

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
- **THEN** the shelf's entries are exactly those it would offer without those results

#### Scenario: Completing the rail reads no new request

- **WHEN** Quick Picks are derived from provider results
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

### Requirement: Mix cards present honest preview artwork

A Home mix card SHALL present artwork before it is activated, and SHALL derive that artwork only
from material the device already holds — the listener's liked tracks and listening events — so that
presenting a mix card's artwork issues no provider request and no additional discovery request.

Preview artwork SHALL NOT be presented as the generated mix. The card SHALL continue to compose its
mix on activation rather than on render, and once a mix has been generated its cover SHALL be derived
from that mix's own tracks in place of the preview.

A card SHALL present preview artwork according to the same cover rule the application's other
collections use: one usable cover as a single image, two to four distinct covers as a 2×2 collage,
and no usable cover as the existing honest placeholder rather than a generic decorative image.

#### Scenario: A mix card shows preview artwork before activation

- **WHEN** Home renders mix cards and the device holds liked tracks or listening events carrying
  artwork
- **THEN** each card presents cover artwork derived from that material rather than a placeholder

#### Scenario: Preview artwork issues no provider request per card

- **WHEN** Home renders any number of mix cards
- **THEN** no provider request is issued to obtain their artwork, and the number of provider requests
  is unaffected by the number of cards rendered

#### Scenario: Preview artwork does not claim to be the generated mix

- **WHEN** a mix card presents preview artwork before it is activated
- **THEN** no mix has been composed, and the card does not describe the preview as the mix's contents

#### Scenario: Mix generation still happens on activation

- **WHEN** a mix card is activated
- **THEN** a mix is composed for that card at that moment and begins playing

#### Scenario: A generated mix's cover replaces the preview

- **WHEN** a mix card has generated a mix
- **THEN** its cover is derived from that mix's own tracks

#### Scenario: One usable cover renders one image

- **WHEN** the material a card draws artwork from offers one distinct usable cover
- **THEN** the card presents a single image rather than a grid

#### Scenario: Several usable covers form a collage

- **WHEN** the material a card draws artwork from offers two to four distinct usable covers
- **THEN** the card presents them as a 2×2 collage

#### Scenario: No usable artwork uses the existing placeholder

- **WHEN** the material a card draws artwork from offers no usable cover
- **THEN** the card presents the existing honest placeholder

#### Scenario: Usable artwork is never replaced by a placeholder

- **WHEN** usable real artwork is available for a mix card
- **THEN** the card does not present a generic music icon or decorative gradient in its place