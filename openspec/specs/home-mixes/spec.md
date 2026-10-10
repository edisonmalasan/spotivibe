# home-mixes Specification

## Purpose

Named mix cards the listener can start, a time-of-day shelf, an artist Quick Picks shelf, and an
`All`/`Music`/`Podcasts` filter over Home's single section model — all derived on the device from the
existing local taste profile.

## Requirements

### Requirement: The local clock selects a time-of-day band

The system SHALL derive one of four bands — morning, afternoon, evening, late night — from the
current local time, through an injectable clock, and SHALL use that band only to select **seed terms
and query construction**. The band SHALL NOT be persisted, SHALL NOT be transmitted to any service,
and SHALL NOT be combined with any stored listening data to form a profile.

Band selection SHALL be a pure function of the hour, so the same hour always yields the same band.

#### Scenario: Each hour maps to its band

- **WHEN** the local hour is 8, 14, 20, and 2 respectively
- **THEN** the bands are morning, afternoon, evening, and late night

#### Scenario: Band boundaries are half-open and cover every hour

- **WHEN** every hour from 0 to 23 is classified
- **THEN** each yields exactly one band, and no hour yields none

#### Scenario: Band selection is a pure function of the hour

- **WHEN** the same hour is classified twice, at different instants
- **THEN** both classifications agree, with no dependence on elapsed time

#### Scenario: The band influences only seed selection

- **WHEN** a band is selected
- **THEN** the only difference it makes is to the seed terms and the query they construct

#### Scenario: The band is not persisted

- **WHEN** a band has been selected
- **THEN** no band value, and no record of the selection, is written to any store

### Requirement: Mix cards start playback and name honestly

The Home surface SHALL present named mix cards — Top Mix, Discovery Mix, Chill Mix, Night Mix, and
language-aware mixes — each of which starts playback of a mix when activated. Every card SHALL be
composed through the existing single mix generator rather than a card-specific one, and every card
name SHALL satisfy the application's honest-naming rule.

A card SHALL NOT be composed until it is activated, so that rendering Home does not itself start a
mix or issue a provider search per card.

#### Scenario: A card starts playback when activated

- **WHEN** the listener activates a mix card
- **THEN** a mix is composed for that card and begins playing

#### Scenario: Cards use the one generator, not their own

- **WHEN** a card composes its mix
- **THEN** it uses the same mix generator as every other mix surface in the application

#### Scenario: Cards are not composed on render

- **WHEN** Home renders
- **THEN** no mix has been composed and no provider search has been issued for a card

#### Scenario: Every card name is honest

- **WHEN** a card's name is derived
- **THEN** the name passes the application's honest-naming rule, or the neutral fallback name is used

#### Scenario: An empty mix is explained rather than silently inert

- **WHEN** a card cannot compose a mix from the listener's material
- **THEN** activating it explains why, rather than appearing to work

#### Scenario: Language mixes are bounded

- **WHEN** the listener has many selected languages
- **THEN** the number of language mix cards offered is bounded by a documented limit

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
holds in memory. Completing the rail this way SHALL introduce no new request and no new stored data of its own. **Artists the listener explicitly picked during first-run onboarding are not provider results**: where such picks exist they are a source in their own right, ranked above provider results and above derived local material, and the cold-start gate no longer applies to them.

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

#### Scenario: A new device is opened

- **WHEN** the Home route is opened on a device that has not completed onboarding
- **THEN** the artist onboarding surface is presented, no language dialog is presented, and the
  discovery feed is not yet presented

#### Scenario: The language preference is still reachable

- **WHEN** the first-run language dialog no longer exists
- **THEN** the selected languages remain visible and editable in Settings, and discovery still
  filters by them

### Requirement: Picked artists persist locally and travel through backup

Artists selected during first-run onboarding SHALL be stored in IndexedDB under a dedicated store
keyed by canonical artist identity, SHALL survive a reload, and SHALL be included in the versioned
JSON backup envelope so they are restored by import.

The envelope dataset SHALL be **optional**, so that a backup exported before this behaviour existed
continues to validate and import. This mirrors the `mixes` dataset, and omitting it would produce an
envelope that exports the picks and silently drops them on import.

**Explicit picks SHALL NOT be stored in `localStorage`.** They are user data rather than a tiny
boot-time preference: a browser cache clear would silently destroy them, and they would fall outside
the backup envelope that `AGENTS.md` makes canonical for local-first data.

The gate recording that onboarding has been seen **SHALL** be stored in `localStorage` under a
namespaced key, and SHALL be readable before the IndexedDB repositories open, so that the onboarding
surface does not appear and then disappear across the first paint. An unreadable or unwriteable gate
SHALL be treated as "not seen" rather than as an error.

#### Scenario: Picks survive a reload

- **WHEN** artists are selected during onboarding and the application is reloaded
- **THEN** the same artists remain selected and are offered by the Quick Picks rail

#### Scenario: Picks round-trip through backup

- **WHEN** picks exist and the data is exported and then imported
- **THEN** the imported application offers the same picked artists

#### Scenario: A pre-existing backup still imports

- **WHEN** a backup envelope exported before this behaviour is imported
- **THEN** it validates and imports, and the picks dataset is treated as empty

#### Scenario: Clearing browser storage does not silently lose the picks

- **WHEN** picks are stored and `localStorage` is cleared
- **THEN** the picks remain, because they are held in IndexedDB rather than in `localStorage`

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

### Requirement: A time-aware shelf is offered

The Home surface SHALL offer a shelf appropriate to the current time-of-day band, whose contents are
seeded by that band. The shelf SHALL be labelled with the band so the listener can tell what they are
looking at, and the label SHALL NOT assert a time the clock has not reported.

#### Scenario: The shelf reflects the current band

- **WHEN** Home renders at a given local hour
- **THEN** the time-aware shelf is seeded by the band that hour falls into

#### Scenario: The shelf names its band

- **WHEN** the time-aware shelf is shown
- **THEN** it is labelled with the current band, so the listener can tell why it is showing these
  results
