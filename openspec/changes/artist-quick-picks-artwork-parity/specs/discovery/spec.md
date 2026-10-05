## MODIFIED Requirements

### Requirement: Home discovery feed

The application SHALL replace the placeholder Home route with a discovery feed composed of named sections rendered per `frontend/docs/DESIGN.md`: horizontal card shelves of square track cards, **exactly one circular artist section**, a section header per shelf, and compact vertical section spacing. The baseline feed SHALL include Trending Now, Made For You, Smart Mixes, Quick Picks, genre discovery, a podcast preview, and curated collections; Continue/Recently Played SHALL appear only when local listening history exists, and the Smart Mixes section SHALL appear only when at least one locally generated mix exists, listing those mixes by their generated names. The Smart Mixes section is the one exception to the card-shelf shape: a mix is a named *collection* rather than a single track, so that section renders its header (title plus the authored description) followed by the mixes as a named list with their track counts, and it SHALL NOT offer a generation action or start playback. **Quick Picks is the feed's single circular artist section**, and no separate Popular Artists section SHALL render beside it. The circular artist section SHALL never be adjacent to another circular section, and it SHALL interrupt the square shelves within the first four sections rather than trailing the feed. The feed SHALL render skeleton placeholders while a shelf loads, an explanatory empty state when a shelf has no content, and a retryable error state for that shelf alone; one failing shelf SHALL NOT prevent other shelves from rendering. The feed SHALL NOT start playback by itself and every card SHALL be keyboard operable with a visible focus state and an accessible name.

The feed SHALL remain a **single section model**: an `All`/`Music`/`Podcasts` filter SHALL *select* from that one list at render rather than forking it into three divergent copies, an unrecognised filter value SHALL present the whole list rather than none, and no filter SHALL introduce a section the list does not contain. The feed SHALL additionally present named mix cards that start playback of a mix on activation, a Quick Picks shelf whose every entry navigates to an artist surface that already exists, and a time-of-day shelf whose content follows the listener's local band. These are *additional* sections beside the baseline feed: the Smart Mixes section remains the one that offers no generation action and starts no playback, and the filter narrows the one list rather than adding to it.

Home SHALL remain readable and operable at a compact viewport, with its sections a scrolling region and the persistent player region unmoved.

#### Scenario: Fresh user sees non-personalized discovery

- **WHEN** a user with no likes, playlists, or listening history opens Home
- **THEN** Trending Now, Quick Picks, genre, podcast, and curated shelves render from provider queries without any local personalization, and no local-only section is shown

#### Scenario: Returning user sees local-informed sections

- **WHEN** a user with liked tracks and listening history opens Home
- **THEN** a recently played section, a locally informed Made For You shelf, and the Smart Mixes section listing the locally generated mixes appear, and the non-personalized shelves still render

#### Scenario: Geometry rhythm keeps circular contrast unclustered

- **WHEN** the Home feed renders its sections
- **THEN** no two circular artist sections are adjacent, and the circular section appears within the first four rendered sections

#### Scenario: Exactly one circular artist section renders

- **WHEN** Home renders
- **THEN** exactly one section uses circular artist geometry, and no separate Popular Artists section renders alongside the Quick Picks artist rail

#### Scenario: One failing shelf does not break the feed

- **WHEN** one shelf's discovery request fails while the others succeed
- **THEN** that shelf alone shows a retryable error state and every other shelf still renders its content

#### Scenario: Loading shelves show skeleton placeholders

- **WHEN** a shelf's discovery request is in flight
- **THEN** that shelf shows skeleton placeholders shaped like the cards it will replace, and the rest of the feed stays interactive

#### Scenario: Home never autoplays

- **WHEN** the Home feed renders or finishes loading
- **THEN** no playback starts without an explicit user activation of a card

#### Scenario: The Smart Mixes section lists the listener's own mixes

- **WHEN** the local profile has generated one or more Smart Mixes
- **THEN** the Smart Mixes section appears within the feed and lists those mixes by their generated names, and activating a mix plays it

#### Scenario: No mixes means no mixes section

- **WHEN** the local profile holds no taste signal and no mix has been generated
- **THEN** the Smart Mixes section is absent from the feed rather than showing an empty rail

#### Scenario: The filter presents a subset of the one section model

- **WHEN** a filter is applied
- **THEN** the presented shelves are a selection from the single section list, and no shelf appears
  that the list does not contain

#### Scenario: An unrecognised filter presents everything

- **WHEN** the filter value is not one the surface recognises
- **THEN** every shelf is presented, rather than an empty Home

#### Scenario: Mix cards start playback rather than navigating away

- **WHEN** the listener activates a mix card on Home
- **THEN** a mix starts playing, and the listener stays on Home

#### Scenario: Quick Picks navigate to existing surfaces

- **WHEN** the listener activates a Quick Pick
- **THEN** the application navigates to the artist surface that entry names

#### Scenario: The time-aware shelf is seeded by the current band

- **WHEN** Home renders at a given local hour
- **THEN** the time-aware shelf offers material appropriate to that hour's band

#### Scenario: Home stays compact-viewport usable

- **WHEN** Home is presented at a compact viewport width
- **THEN** its sections remain a scrolling region and the persistent player region does not move

## REMOVED Requirements

### Requirement: Popular artists shelf

**Reason**: superseded, and the two shelves could not both exist. Measured on production before this
change, the Quick Picks rail's artist targets were a **strict prefix** of the Popular Artists rail's —
every artist, in the same order, with the same image URLs — because both derive from
`groupArtistsByIdentity(trending.tracks)`. Two visually identical circular shelves, one a subset of
the other, is not two sections. `DESIGN.md` requires that circular sections never sit adjacent, and
this capability's own baseline permitted "at most one circular artist section", so retaining both as
circular rails was not available.

Quick Picks is retained as the single circular artist rail because it is the language-aware and
locally informed one, and because it already reads the collections feed that Popular Artists never
did, so no artist is lost by consolidating. Nothing Popular Artists provided is dropped; its content
is reachable through Quick Picks.

**Migration**: the `popular-artists` section entry in `src/features/home/homeSections.ts` and its
rendering case in `src/features/home/HomeView.tsx` are removed in the same change. The artist
grouping implementation in `src/features/recommendations/artists.ts` is retained and reused by Quick
Picks. The `home-artist-card` test id is preserved on the Quick Picks artist cards so existing
assertions keep their meaning.