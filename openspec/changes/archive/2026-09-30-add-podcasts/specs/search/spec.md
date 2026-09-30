# Spec Delta

## Purpose

How the search surface carries a podcast mode and presents podcast results: the mode is part of the query state, and a podcast result presents a show and a long-form duration instead of music-only sections.

## MODIFIED Requirements

### Requirement: Query input and URL synchronization

The top-bar search input SHALL be functional: typing a query focuses the search experience, navigates to the Search route, and keeps the visible query in the URL (`/search?q=...`) without remounting the input or losing focus while typing. The Search route SHALL read the query from the URL so deep links and back/forward navigation reproduce the same query state, and the input's value SHALL always reflect the current query. Clearing the query returns the Search surface to its browse state. The search mode SHALL be part of that URL state alongside the query, SHALL default to music mode when absent or unrecognized, and SHALL be changeable without retyping the query.

#### Scenario: Typing in the top bar drives the search surface

- **WHEN** the user types a query into the top-bar search input from any route
- **THEN** the Search route becomes active, its URL carries the typed query, and results for that query render without the input losing focus or characters being dropped

#### Scenario: Deep link and history navigation reproduce the query

- **WHEN** the user opens `/search?q=...` directly or navigates browser back/forward between search URLs
- **THEN** the search surface shows the query from the URL and searches for it, and the top-bar input value matches

#### Scenario: Clearing the query returns to browse state

- **WHEN** the user empties the search input
- **THEN** the search surface shows the browse state (recent searches when any exist) rather than stale results

#### Scenario: The mode travels with the query in the URL

- **WHEN** the listener switches to podcast mode
- **THEN** the URL carries both the query and the podcast mode, and reloading or sharing that URL reproduces the same mode and query

#### Scenario: An absent or unrecognized mode falls back to music

- **WHEN** the URL carries no mode or an unrecognized mode value
- **THEN** the search surface runs and renders in music mode rather than failing

#### Scenario: The top-bar input stays focused across a mode switch

- **WHEN** the listener switches mode from the search surface
- **THEN** the top-bar input is not remounted and its value is preserved

### Requirement: Result sections from canonical metadata

Search results SHALL render as a Top Result (when the result set contains a clear best match for the query), a Songs section in provider relevance order, and derived Artists and Albums sections computed client-side from the canonical Track metadata — an artist entry only where artist metadata resolves, an album entry only where album metadata resolves. Derived artist and album entries SHALL be deduplicated across the result set (one entry per artist/album identity), and the song list SHALL collapse duplicates so the same video never appears twice. In podcast mode the same derivation runs over podcast metadata: the result section presents each episode with its show or channel, its canonical duration, and its artwork, and the Albums section is omitted because podcast metadata resolves no album identity, while artist entries resolve only where a show or channel is actually present.

#### Scenario: Songs render canonical track information

- **WHEN** a remote search returns tracks
- **THEN** each song row shows the track's title, artist name(s), duration, and artwork from the canonical Track, with results in the order the API returned them

#### Scenario: Artists and albums derive only where metadata resolves

- **WHEN** results contain tracks with artist and album metadata
- **THEN** the Artists section lists each distinct artist once and the Albums section lists each distinct album once, and tracks lacking album metadata contribute no album entry

#### Scenario: A clear best match renders as Top Result

- **WHEN** the top-ranked result closely matches the query (by title, artist, or album text)
- **THEN** it is presented in a prominent Top Result section; when no result closely matches, no Top Result section is shown

#### Scenario: Duplicate results collapse

- **WHEN** the response contains the same video twice or results that duplicate an already-listed song
- **THEN** only one entry for that video remains in the rendered song list

#### Scenario: Podcast results present show and duration, not albums

- **WHEN** a podcast-mode search returns episodes
- **THEN** each row shows the episode title, its show or channel, its canonical duration, and artwork, and no Albums section is rendered for that result set
