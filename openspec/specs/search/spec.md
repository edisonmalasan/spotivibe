# search Specification

## Purpose

Lets users find and act on music: a responsive search surface over the provider search API and the local library, with progressive result rendering, playback and library affordances, and local-first search history that never leaves the device.

## Requirements

### Requirement: Query input and URL synchronization

The top-bar search input SHALL be functional: typing a query focuses the search experience, navigates to the Search route, and keeps the visible query in the URL (`/search?q=...`) without remounting the input or losing focus while typing. The Search route SHALL read the query from the URL so deep links and back/forward navigation reproduce the same query state, and the input's value SHALL always reflect the current query. Clearing the query returns the Search surface to its browse state.

#### Scenario: Typing in the top bar drives the search surface

- **WHEN** the user types a query into the top-bar search input from any route
- **THEN** the Search route becomes active, its URL carries the typed query, and results for that query render without the input losing focus or characters being dropped

#### Scenario: Deep link and history navigation reproduce the query

- **WHEN** the user opens `/search?q=...` directly or navigates browser back/forward between search URLs
- **THEN** the search surface shows the query from the URL and searches for it, and the top-bar input value matches

#### Scenario: Clearing the query returns to browse state

- **WHEN** the user empties the search input
- **THEN** the search surface shows the browse state (recent searches when any exist) rather than stale results

### Requirement: Debounced stale-safe requests

Query changes SHALL be debounced before a search request is issued, and a request for an older query MUST NOT overwrite the results of a newer query. Changing the query SHALL abort any in-flight request for the previous query, and a late-arriving response for a superseded query MUST be discarded. Fast typing SHALL never render results that do not correspond to the newest query.

#### Scenario: Rapid typing keeps only the newest results

- **WHEN** the user types quickly so several queries are generated before earlier responses arrive
- **THEN** the rendered results correspond to the final query, and no earlier response replaces them after the fact

#### Scenario: Superseded requests are aborted

- **WHEN** the query changes while a search request is still in flight
- **THEN** the in-flight request is aborted rather than left running, and its eventual result is ignored

### Requirement: Progressive loading state

While a search is in flight, the surface SHALL show skeleton placeholders shaped like the result layout instead of a blank region or stale content, and SHALL transition to results, empty, or error state when the request settles.

#### Scenario: Skeletons show while results load

- **WHEN** a debounced query's request is pending
- **THEN** skeleton placeholders matching the result rows are visible until the response renders

### Requirement: Result sections from canonical metadata

Search results SHALL render as a Top Result (when the result set contains a clear best match for the query), a Songs section in provider relevance order, and derived Artists and Albums sections computed client-side from the canonical Track metadata — an artist entry only where artist metadata resolves, an album entry only where album metadata resolves. Derived artist and album entries SHALL be deduplicated across the result set (one entry per artist/album identity), and the song list SHALL collapse duplicates so the same video never appears twice.

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

### Requirement: Playback from search results

Activating a song result SHALL start persistent playback through the playback engine with the current result set as queue context: the player region and Now Playing surface reflect the track, playback continues across route changes, and playback is never started automatically by the search surface itself.

#### Scenario: Clicking a result starts playback

- **WHEN** the user activates a song result
- **THEN** that track loads and plays in the persistent player, the player region shows its title and artist, and the track continues playing when the user navigates to another route

#### Scenario: Search never autoplays

- **WHEN** the Search route renders or a search completes
- **THEN** no playback starts without an explicit user activation of a result

### Requirement: Result context actions

Each song result SHALL expose a context menu with: play, like/unlike, add to queue, add to local playlist, go to artist, and go to album (where album metadata exists). Like/unlike SHALL persist to the local liked-tracks repository and reflect current state when results render. Add to queue SHALL append the track to the end of the queue per the queue capability's insertion rules (including its duplicate protection) without disturbing current playback. Add to local playlist SHALL let the user pick an existing local playlist or create a new one inline, then append the track — unless the playlist already contains it, in which case the playlist is unchanged and the picker reports that the track is already there, per the library capability's duplicate rule. Go to artist and go to album SHALL refine the search to that artist/album name. The menu SHALL be operable by keyboard with a visible focus state and an accessible name per control.

#### Scenario: Like persists locally

- **WHEN** the user likes a result and then reloads the application
- **THEN** the result's like state is still active, and the track is present in the local liked-tracks dataset

#### Scenario: Add to an existing playlist appends the track

- **WHEN** the user adds a result to an existing local playlist
- **THEN** the track is appended to that playlist's ordered track list and persists across reload

#### Scenario: Inline playlist creation adds the track

- **WHEN** the user chooses to add a result to a new playlist and supplies a name
- **THEN** a local playlist with that name is created and the track is added to it

#### Scenario: Going to artist or album refines the search

- **WHEN** the user activates "go to artist" or "go to album" on a result
- **THEN** the search query becomes that artist/album name and results update accordingly

#### Scenario: Add to queue appends without disturbing playback

- **WHEN** the user activates "Add to queue" on a result while a track is playing
- **THEN** the result track is appended to the end of the queue (once — duplicate protection applies), the menu closes, and the current track, status, and position are unchanged

#### Scenario: Adding a track already in the playlist does not duplicate it

- **WHEN** the user adds a result to a local playlist that already contains that track
- **THEN** the playlist's tracks and order are unchanged, and the picker reports that the track is already in the playlist

### Requirement: Local-first search history

Settled searches SHALL be recorded to the local search-history repository (one entry per normalized query, most recent search wins), and the browse state SHALL list recent searches newest-first with per-entry remove and clear-all controls. Recording, listing, removing, and clearing SHALL use repository APIs only, and search history MUST NOT be transmitted over the network; history survives reload.

#### Scenario: A settled search is recorded once

- **WHEN** a query's results settle and the user keeps that query active
- **THEN** the query exists as a single recent-search entry, and re-searching it refreshes its timestamp instead of duplicating it

#### Scenario: Recent searches survive reload and are removable individually

- **WHEN** the user removes one recent search and reloads the application
- **THEN** only that entry is gone and the remaining entries are still listed newest-first

#### Scenario: Clear-all empties recent searches

- **WHEN** the user activates the clear-all control on recent searches
- **THEN** the recent-searches list becomes empty and stays empty across reload

#### Scenario: Search history never leaves the device

- **WHEN** searches are recorded, listed, removed, or cleared
- **THEN** no network request carries search-history data

### Requirement: Local library fallback

When the remote search API fails or the browser is offline, the surface SHALL search the local library and listening history client-side (liked tracks, playlist tracks, history tracks) by title/artist text and present matches as playable results with a visible notice that local results are being shown. Local fallback SHALL issue no request that carries library content, and when the browser is offline it SHALL issue no remote search request at all.

#### Scenario: Remote failure falls back to local matches

- **WHEN** the search API responds with an error for a valid query
- **THEN** matching tracks from the local library/history are shown with a notice explaining local results are displayed, and a retry affordance for the remote search remains available

#### Scenario: Offline search stays fully local

- **WHEN** the browser is offline and the user searches
- **THEN** no remote search request is issued and local matches (or an explicit no-local-results state) are shown

### Requirement: Empty, error, and offline states

The search surface SHALL provide an empty state when a query yields no results (distinguishing "no remote results" from "no local results" during fallback), an error state with a retry affordance when the remote search fails and local fallback finds nothing, and an explicit offline indication when searching while offline. No state SHALL render as a blank region.

#### Scenario: Query with no results shows the empty state

- **WHEN** a search completes successfully with zero matches
- **THEN** an empty state naming the query is displayed instead of an empty list

#### Scenario: Failure with no local matches shows a retryable error

- **WHEN** the remote search fails and the local library contains no matches
- **THEN** an error state with a retry control is shown rather than a blank region
