# Spec Delta

## MODIFIED Requirements

### Requirement: Home discovery feed

The application SHALL replace the placeholder Home route with a discovery feed composed of named sections rendered per `frontend/docs/DESIGN.md`: horizontal card shelves of square track cards, at most one circular artist section, a section header per shelf, and compact vertical section spacing. The baseline feed SHALL include Trending Now, Made For You, Smart Mixes, Popular Artists, genre discovery, a podcast preview, and curated collections; Continue/Recently Played SHALL appear only when local listening history exists, and the Smart Mixes section SHALL appear only when at least one locally generated mix exists, listing those mixes by their generated names. The Smart Mixes section is the one exception to the card-shelf shape: a mix is a named *collection* rather than a single track, so that section renders its header (title plus the authored description) followed by the mixes as a named list with their track counts, and it SHALL NOT offer a generation action or start playback. The circular artist section SHALL never be adjacent to another circular section, and it SHALL interrupt the square shelves within the first four sections rather than trailing the feed. The feed SHALL render skeleton placeholders while a shelf loads, an explanatory empty state when a shelf has no content, and a retryable error state for that shelf alone; one failing shelf SHALL NOT prevent other shelves from rendering. The feed SHALL NOT start playback by itself and every card SHALL be keyboard operable with a visible focus state and an accessible name.

#### Scenario: Fresh user sees non-personalized discovery

- **WHEN** a user with no likes, playlists, or listening history opens Home
- **THEN** Trending Now, Popular Artists, genre, podcast, and curated shelves render from provider queries without any local personalization, and no local-only section is shown

#### Scenario: Returning user sees local-informed sections

- **WHEN** a user with liked tracks and listening history opens Home
- **THEN** a recently played section, a locally informed Made For You shelf, and the Smart Mixes section listing the locally generated mixes appear, and the non-personalized shelves still render

#### Scenario: Geometry rhythm keeps circular contrast unclustered

- **WHEN** the Home feed renders its sections
- **THEN** no two circular artist sections are adjacent, and the circular section appears within the first four rendered sections

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
