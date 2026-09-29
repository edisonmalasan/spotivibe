# Spec Delta

## Purpose

The browsing graph that turns a search result or a playing track into somewhere to go: first-class artist and album pages built from query-driven provider resolution, related content for what is playing, and playback entry points that keep the persistent player and the local library as the only state.

## ADDED Requirements

### Requirement: Artist page

The application SHALL provide an artist page on its own route showing the artist's identity (name, and artwork when the resolved metadata provides it), that artist's popular tracks, their releases where resolvable, and related artists, all derived from one provider resolution. Each track SHALL be playable and likeable from the page, each release and related-artist entry SHALL be activatable, and the page SHALL offer a "Start artist radio" action that begins playback seeded by the artist. The page SHALL render an explanatory state when the provider resolves nothing and a recoverable not-found state for an unknown key. It SHALL never require an account, and it SHALL NOT autoplay on open.

#### Scenario: Artist page renders identity, tracks, releases, and related artists

- **WHEN** the user opens an artist page for a resolvable artist
- **THEN** the artist name, artwork when available, popular tracks, releases, and related artists are shown, and every section comes from the same resolution without a second provider round trip

#### Scenario: Playing or liking from an artist track

- **WHEN** the user activates play or like on a track in the artist page's popular tracks
- **THEN** playback starts with the artist feed as its context, and the like state persists in the local liked dataset and matches every other surface

#### Scenario: Releases and related artists are activatable

- **WHEN** the user activates a release or a related-artist entry
- **THEN** the corresponding album or artist surface opens for that entry

#### Scenario: Related artists come from the artist's own resolution

- **WHEN** the artist page shows related artists
- **THEN** they are other artists credited on the tracks of that same artist resolution, and no second provider request is issued to obtain them

#### Scenario: An artist with no co-credited artist says so

- **WHEN** the resolution yields no artist other than the one requested
- **THEN** the Related artists section reports that no related artist was found instead of presenting unrelated or invented artists

#### Scenario: Artist radio seeds playback

- **WHEN** the user activates "Start artist radio" on an artist page
- **THEN** playback begins within the artist's resolved tracks with that feed as the playback context

#### Scenario: Unresolvable artist degrades gracefully

- **WHEN** the provider resolves no usable results for an artist key
- **THEN** the page shows an explanatory empty state with a retry affordance instead of a blank region, and the rest of the app keeps working

#### Scenario: Unknown artist key is recoverable

- **WHEN** the user opens an artist route whose key resolves to no artist
- **THEN** a not-found state with a way back is shown rather than an error or a blank screen

### Requirement: Album page

The application SHALL provide an album/release page on its own route showing the release artwork, its title, its artist, whatever release metadata the provider resolved, and its tracks in the resolved order. The page SHALL offer play and shuffle over the full track list, per-track like, and add-to-local-playlist through the existing picker. When the resolved tracks carry no album metadata for the requested release, the page SHALL say so explicitly and still list the resolved tracks rather than presenting them as a definitive tracklist. An unknown key SHALL yield a recoverable not-found state.

#### Scenario: Album page renders its release and ordered tracks

- **WHEN** the user opens an album page for a resolvable release
- **THEN** artwork, title, artist, the available release metadata, and the tracks in resolved order are shown

#### Scenario: Play and shuffle adopt the album as context

- **WHEN** the user activates play or shuffle on an album page
- **THEN** playback starts with the album's first track (shuffle enabled for the shuffle action) and the whole album as the playback context

#### Scenario: Album tracks can be liked and added to a local playlist

- **WHEN** the user likes a track on an album page or adds one through the playlist picker
- **THEN** the like persists in the local liked dataset, or the track is appended to the chosen local playlist, with the M7 duplicate rule unchanged

#### Scenario: Incomplete album metadata is reported

- **WHEN** the resolved tracks carry no album metadata for the requested release
- **THEN** the page states that the release's track list could not be confirmed and still shows the resolved tracks, without presenting them as authoritative

#### Scenario: Unknown album key is recoverable

- **WHEN** the user opens an album route whose key resolves to no release
- **THEN** a not-found state with a way back is shown

### Requirement: Related content for the current track

The Now Playing surface SHALL offer a More Like This shelf for the current track: tracks similar to it, excluding the current track itself, resolved from the provider and rendered with the shared shelf primitives. The shelf SHALL be scoped to the playing track and SHALL re-resolve when the track changes, SHALL show loading, empty, and retryable error states like every other shelf, and SHALL NOT start playback by itself. Resolution SHALL use only the track's public metadata and MUST NOT require a cloud user profile or any stored user identity.

#### Scenario: More Like This excludes the current track

- **WHEN** the More Like This shelf resolves for a playing track
- **THEN** the current track does not appear among the suggested tracks

#### Scenario: The shelf follows the current track

- **WHEN** the current track changes
- **THEN** the shelf re-resolves for the new track and the previous suggestions are discarded

#### Scenario: Related content needs no user profile

- **WHEN** a More Like This request is issued
- **THEN** its parameters are limited to the current track's public title/artist metadata, with no user, history, or library data

#### Scenario: The shelf never autoplays

- **WHEN** the More Like This shelf loads or re-resolves
- **THEN** no playback starts without an explicit user activation

### Requirement: Catalog entity keys and resolution requests

Artist and album routes SHALL be addressable by a stable key: a provider entity id when the provider supplied one, otherwise a normalized text key derived from the artist's name or the release's title. The client SHALL translate the key into the corresponding provider request, and the request SHALL accept only that identifier — never a liked-track, playlist, or history payload. Keys the provider cannot resolve SHALL be reported as unresolvable rather than silently substituted with a different entity.

#### Scenario: Id and text keys both resolve

- **WHEN** an artist or album is reached by a provider entity id and another by a text key
- **THEN** both routes resolve the correct entity

#### Scenario: An id key the provider cannot confirm stays unconfirmed

- **WHEN** a release is reached by a provider entity id that no tier can resolve to that release's own metadata
- **THEN** the page reports that the tracklist could not be confirmed and never presents the resolved tracks as that release's tracklist

#### Scenario: Requests carry only the identifier

- **WHEN** an artist, album, or similar-track request is issued
- **THEN** its parameters are limited to the entity identifier or the current track's public metadata, with no library or user payload

#### Scenario: An unresolvable key is not substituted

- **WHEN** a key resolves to nothing
- **THEN** the surface reports it as unresolvable instead of showing a different entity that merely matched the text

### Requirement: Local catalog signals

An artist page SHALL show the user's liked tracks by that artist, computed entirely on-device from the local liked dataset, and SHALL omit that section when there are none. This signal SHALL be produced without any network request and SHALL disappear when the local liked data changes. Related content and personalization SHALL never require a cloud user profile.

#### Scenario: Liked tracks by this artist appear locally

- **WHEN** a user has liked tracks by an artist and opens that artist's page
- **THEN** those tracks are listed in a dedicated section without any network request for the signal

#### Scenario: The section is omitted when nothing matches

- **WHEN** no liked track belongs to the artist
- **THEN** the section is not rendered rather than rendered empty

### Requirement: Now Playing presentation of the current track

The Now Playing surface SHALL present the current track with an artwork-derived background, a long-title treatment that does not fight the layout, and the related-content shelf, while continuing to represent exactly the same store/player state as the player region. The background SHALL be derived from the current artwork when one exists and SHALL degrade to the plain surface when it does not. The long-title treatment SHALL animate only when the title overflows and SHALL be disabled when the user prefers reduced motion, in which case the full title remains available as text.

#### Scenario: Background follows the current artwork

- **WHEN** the current track has artwork
- **THEN** the Now Playing surface shows an artwork-derived background behind the content, and it changes when the track changes

#### Scenario: No artwork leaves a plain surface

- **WHEN** the current track has no artwork
- **THEN** the surface renders its normal background with no empty or broken image box

#### Scenario: Long titles remain readable

- **WHEN** the current track's title does not fit the available width
- **THEN** the title is presented so it stays readable rather than clipped mid-word, and under `prefers-reduced-motion` it is static with the full title still available

#### Scenario: Now Playing and the player region agree

- **WHEN** the user changes track, play/pause state, or like state anywhere in the app
- **THEN** the Now Playing surface and the player region show the same current track, status, and like state without a reload
