# library Specification

## Purpose

The on-device personal library: the Your Library surface and sidebar, the Liked Songs collection, and local playlists — create/rename/delete, ordered membership with a deterministic duplicate rule, hero presentation with derived cover and duration, play-all/shuffle entry points, and public YouTube playlist import into a normal local playlist, all served from local storage without an account.

## Requirements

### Requirement: Library surface

The application SHALL provide a library surface at a dedicated route showing the user's on-device collections: an entry for Liked Songs carrying its track count, and the user's playlists with name, track count, and cover. The surface SHALL offer a filter input that narrows the shown playlists and Liked Songs by matching text, a Create playlist action, and an Import playlist action; every control SHALL be keyboard operable with visible focus and an accessible name, and every listed item SHALL navigate to its detail surface. The surface SHALL render entirely from local storage with no network dependency, and SHALL show an explanatory empty state when there are no liked songs and no playlists.

#### Scenario: Populated library renders from local storage

- **WHEN** the user opens the library route with liked songs and playlists stored locally
- **THEN** the Liked Songs entry and every playlist appear with their counts and covers, and no network request is required to render them

#### Scenario: Filter narrows the listed collections

- **WHEN** the user types into the library filter
- **THEN** only playlists whose names match remain shown, and clearing the filter restores the full list

#### Scenario: Empty library guides the user

- **WHEN** the library holds neither liked songs nor playlists
- **THEN** an empty state explains how to start the library, while the Create playlist and Import playlist actions remain available

#### Scenario: The library works offline

- **WHEN** the browser is offline and the user opens the library route
- **THEN** the surface renders fully from local storage; only playlist import and actually playing a track require the network

### Requirement: Library sidebar

The desktop sidebar's "Your Library" panel SHALL reflect the live local library: an entry for Liked Songs and one entry per playlist (cover and name), each navigating to its surface, plus a "+" control that opens playlist creation. Sidebar entries SHALL update within the current session after library changes without a page reload. While the library is empty the panel SHALL keep its guidance cards. The compact bottom navigation's Library link SHALL continue to reach the library route.

#### Scenario: Library changes appear in the sidebar immediately

- **WHEN** a playlist is created or deleted and the sidebar then renders
- **THEN** the entry appears or disappears without reloading the page

#### Scenario: Sidebar entries navigate to their surfaces

- **WHEN** the user activates a sidebar playlist entry or the Liked Songs entry
- **THEN** that playlist's detail route (or the Liked Songs route) opens

#### Scenario: Empty library keeps guidance cards

- **WHEN** the library contains no liked songs and no playlists
- **THEN** the sidebar shows its guidance cards instead of an entry list

### Requirement: Liked Songs surface

The application SHALL provide a Liked Songs surface on its own route showing every liked track newest-first with canonical row metadata, reachable from the library surface and the sidebar. It SHALL provide play-all and shuffle actions over the whole collection, a local filter narrowing rows by title/artist text, and both list and grid presentations that the user can switch between. Each row SHALL support playing that track within the collection and unliking it, the heart control on the Now Playing surface SHALL toggle like state for the current track, and like state SHALL stay consistent across search results, Now Playing, and this surface without remounting.

#### Scenario: Play all starts the collection as context

- **WHEN** the user activates play all on a non-empty Liked Songs collection
- **THEN** playback starts with the first liked track and the full collection becomes the playback context, recorded as coming from the library

#### Scenario: Shuffle enables shuffle and starts within the collection

- **WHEN** the user activates shuffle on the collection
- **THEN** shuffle is enabled and playback starts from within the collection

#### Scenario: Like state stays consistent across surfaces

- **WHEN** the user unlikes a track from this surface, or likes the current track from Now Playing
- **THEN** every visible surface reflecting that track's like state updates without a reload, and the liked list reflects the change

#### Scenario: Grid presentation plays the collection

- **WHEN** the user switches to the grid presentation and activates a tile
- **THEN** the same collection is shown as artwork tiles and the activated track plays within the collection

### Requirement: Playlist creation and editing

The user SHALL be able to create a playlist from the library surface with a name and an optional description; the playlist SHALL receive an immutable ID that never changes when the display name changes. From the playlist detail surface the user SHALL be able to rename the playlist, edit its description, and delete it behind an explicit confirmation that can be canceled without effect. All changes SHALL persist locally immediately (surviving reload) and SHALL never require an account, network access, or a server.

#### Scenario: Created playlist persists across reload

- **WHEN** a playlist is created and the page is reloaded
- **THEN** the playlist is present with its name, optional description, and empty track list

#### Scenario: Rename preserves identity and membership

- **WHEN** a playlist is renamed or its description edited
- **THEN** its ID, track list, and order are unchanged, and the new text persists across reload

#### Scenario: Delete is confirmed and complete

- **WHEN** the user cancels the delete confirmation
- **THEN** nothing changes; when the user confirms instead, the playlist disappears from the library surface and the sidebar, and its detail route shows a recoverable not-found state

### Requirement: Playlist detail hero

Each playlist SHALL have a detail route presenting a hero with its cover (the playlist's artwork, or a cover derived from its first tracks' artwork, or a styled placeholder when no artwork exists), the playlist name, its description when set, the track count, and the total duration summed from the tracks that report one. The hero SHALL expose the playlist's management actions (play all, shuffle, edit, delete), with the ordered track list beneath it. An unknown or deleted playlist ID SHALL yield a recoverable not-found state rather than a blank page.

#### Scenario: Hero shows derived metadata

- **WHEN** the user opens a playlist containing tracks with known durations
- **THEN** the hero shows the track count and the summed total duration formatted as minutes, or hours and minutes, with tracks that report no duration contributing nothing

#### Scenario: Cover derives from track artwork

- **WHEN** the playlist has no artwork of its own
- **THEN** the hero cover is derived from its first distinct track artworks, falling back to a styled placeholder when none exist

#### Scenario: Unknown playlist ID is recoverable

- **WHEN** the user opens a detail URL for a playlist that does not exist
- **THEN** a not-found state with a way back is shown instead of an error or blank screen

### Requirement: Playlist track operations

From the playlist detail surface each track SHALL be removable, and the order SHALL be changeable through both drag-and-drop and keyboard move controls that produce the identical resulting order. Adding a track that is already in the playlist SHALL be rejected deterministically on every add path: the playlist stays unchanged (no duplicate entry) and the user is told the track is already present. Track operations SHALL persist immediately, keep order stable across reload, and MUST NOT disturb current playback — the current track, status, and position stay unchanged — while a track is playing.

#### Scenario: Removal and reorder persist across reload

- **WHEN** the user removes or reorders tracks and then reloads the application
- **THEN** the playlist reflects exactly the resulting membership and order

#### Scenario: Drag and keyboard reordering agree

- **WHEN** the same reorder is performed once with drag-and-drop and once with the move controls
- **THEN** both produce the identical resulting order

#### Scenario: Duplicate addition is rejected on every path

- **WHEN** the user adds a track that is already in the playlist, from search results or any other add path
- **THEN** no duplicate entry is created, the playlist's tracks and order are unchanged, and feedback says the track is already in it

#### Scenario: Editing a playlist does not disturb transport

- **WHEN** playlist tracks are removed or reordered while a track is playing
- **THEN** the current track, playback status, and position are unchanged

### Requirement: Library playback

Liked Songs and playlist surfaces SHALL offer play-all and shuffle over their full ordered collections plus per-row play; a play activation SHALL load the activated track with its full ordered collection as the playback context, recorded with the `library` source. A shuffle activation SHALL enable shuffle as playback starts. Play-all and shuffle SHALL be visibly disabled and inert when the collection is empty, and nothing in the library SHALL start playback without an explicit user activation.

#### Scenario: Play all adopts the collection as context

- **WHEN** the user activates play all on a playlist
- **THEN** the playlist's first track plays with the whole playlist as context, and the queue surface shows the source as the library

#### Scenario: Shuffle activation enables shuffle

- **WHEN** the user activates shuffle on a playlist or the Liked Songs collection
- **THEN** shuffle is on and playback starts within that collection

#### Scenario: Empty collections disable bulk play

- **WHEN** the collection is empty
- **THEN** play-all and shuffle are visibly disabled and activating them does nothing

#### Scenario: Opening library surfaces never autoplays

- **WHEN** the user opens library routes without activating anything
- **THEN** no playback starts

### Requirement: Public playlist import

The library surface SHALL offer an import dialog that accepts a public or unlisted YouTube playlist URL (watch, playlist, embed, or short-link forms carrying a list parameter) or a bare playlist ID, resolves it without any Google OAuth or Spotivibe account, and creates a normal local playlist named from the resolved playlist with its tracks in source order. Unavailable or private entries SHALL be skipped rather than failing the import, with the skipped count reported. Invalid input, an inaccessible or private playlist, an upstream outage, or being offline SHALL each surface a clear error and create no playlist. The resulting playlist SHALL be indistinguishable from a manually created one — renameable, editable, deletable, and playable.

#### Scenario: Valid import creates a normal local playlist

- **WHEN** the user imports a valid public playlist
- **THEN** a new local playlist appears with the remote playlist's title and its tracks in source order, and it survives reload

#### Scenario: Unavailable entries are skipped and reported

- **WHEN** some entries in the playlist are unavailable or private
- **THEN** the remaining tracks are imported in order and the dialog reports how many entries were skipped

#### Scenario: Failures are clear and side-effect free

- **WHEN** the user submits an invalid playlist reference, an inaccessible or private playlist, or the upstream providers all fail while offline or online
- **THEN** a visible error explains the failure and no playlist is created

#### Scenario: Duplicate remote entries deduplicate deterministically

- **WHEN** the same remote playlist contains the same video more than once
- **THEN** the first occurrence is kept and later duplicates are dropped
