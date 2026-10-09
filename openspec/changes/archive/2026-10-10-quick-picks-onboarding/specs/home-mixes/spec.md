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

## ADDED Requirements

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