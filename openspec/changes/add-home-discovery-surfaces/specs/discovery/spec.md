# Spec Delta

## Purpose

The discovery layer that makes Spotivibe feel alive without accounts: a DESIGN.md-driven Home feed of curated, query-driven shelves, first-run language selection that persists locally, language-mixed multi-language feeds, locally informed For You and mixes, recently played from on-device listening signals, and a Discover surface for genre and language exploration — every shelf tolerant of partial provider failure and honest about not being an official chart.

## ADDED Requirements

### Requirement: Home discovery feed

The application SHALL replace the placeholder Home route with a discovery feed composed of named sections rendered per `frontend/docs/DESIGN.md`: horizontal card shelves of square track cards, at most one circular artist section, a section header per shelf, and compact vertical section spacing. The baseline feed SHALL include Trending Now, Made For You, Smart Mixes (only when enough local signal exists), Popular Artists, genre discovery, a podcast preview, and curated collections; Continue/Recently Played SHALL appear only when local listening history exists. The circular artist section SHALL never be adjacent to another circular section, and it SHALL interrupt the square shelves within the first four sections rather than trailing the feed. The feed SHALL render skeleton placeholders while a shelf loads, an explanatory empty state when a shelf has no content, and a retryable error state for that shelf alone; one failing shelf SHALL NOT prevent other shelves from rendering. The feed SHALL NOT start playback by itself and every card SHALL be keyboard operable with a visible focus state and an accessible name.

#### Scenario: Fresh user sees non-personalized discovery

- **WHEN** a user with no likes, playlists, or listening history opens Home
- **THEN** Trending Now, Popular Artists, genre, podcast, and curated shelves render from provider queries without any local personalization, and no local-only section is shown

#### Scenario: Returning user sees local-informed sections

- **WHEN** a user with liked tracks and listening history opens Home
- **THEN** a recently played section and a locally informed Made For You shelf appear, and the non-personalized shelves still render

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

### Requirement: Curated query-driven discovery shelves

Trending, genre, podcast, and curated collection shelves SHALL be produced from a curated catalog of static seed queries executed against the music provider API; the application SHALL NOT claim that these shelves are an official YouTube or Spotify chart, ranking, or editorial selection, and its copy SHALL NOT attribute the content to those services. Shells SHALL require no account, no provider credential, and no user data. The podcast preview SHALL be presented as podcasts and SHALL prefer long-form results when a duration is known. Feed and shelf content SHALL be served with a short-lived cache so repeated visits do not re-query providers unnecessarily.

#### Scenario: Trending shelf populates from curated seeds

- **WHEN** the Trending Now shelf loads
- **THEN** its tracks come from the curated seed catalog through the provider API, and no request carries user data

#### Scenario: Copy makes no chart claim

- **WHEN** any curated, trending, or collection shelf is rendered
- **THEN** its title and description make no claim of official chart status, ranking authority, or editorial curation by another service

#### Scenario: Curated collections need no account

- **WHEN** a curated collection shelf loads
- **THEN** it resolves through the same keyless provider chain and requires no login, credential, or stored profile

#### Scenario: Podcast preview presents long-form content

- **WHEN** the podcast preview shelf renders
- **THEN** it is presented as podcasts and prefers results whose known duration indicates long-form content

### Requirement: Language catalog and first-run onboarding

The application SHALL offer a catalog of at least 37 selectable languages, each identified by a stable language code with a human-readable name. A user who has not completed onboarding SHALL be offered language selection on first run, presented as an explicit, dismissible-or-confirmable choice that can be completed with one or more languages. Completing it SHALL persist the selected languages and the completed state through the local preferences repository, SHALL survive reload, and SHALL NOT require an account. After onboarding, the selected languages SHALL remain changeable from Settings, and changing them SHALL persist the same way.

#### Scenario: First run offers language selection

- **WHEN** a user opens the app with onboarding not yet completed
- **THEN** language selection is offered with the full catalog, and no account, sign-in, or email prompt is shown

#### Scenario: Completing onboarding persists the choice

- **WHEN** the user confirms one or more languages and the app is reloaded
- **THEN** the same languages are selected and onboarding is not offered again

#### Scenario: Languages are changeable later

- **WHEN** the user changes the selected languages from Settings
- **THEN** the new selection persists across reload and feeds follow it

#### Scenario: Catalog stays broad

- **WHEN** the language catalog is inspected
- **THEN** at least 37 languages are selectable, each with a stable code and a readable name

### Requirement: Local-only personalization inputs

Language selections, liked tracks, playlists, listening history, and any taste signal derived from them SHALL remain on the device. Discovery requests MAY carry the selected language codes and short seed terms derived from local taste, but the server SHALL NOT persist a user profile, SHALL NOT receive liked-track or history datasets, and SHALL NOT correlate requests into a stored identity. Clearing local history SHALL change what locally informed sections show, and no discovery request SHALL carry identifiable user data beyond the selected languages and the seed terms needed to fulfill it.

#### Scenario: Discovery requests carry only languages and seeds

- **WHEN** a discovery request is issued
- **THEN** its parameters are limited to the requested feed kind, selected language codes, and short seed terms, with no liked-track, playlist, or history payload

#### Scenario: No server-side profile is created

- **WHEN** discovery requests are served
- **THEN** no stored user profile, identity, or per-user feed state is created server-side

#### Scenario: Clearing history changes local-informed shelves

- **WHEN** the user clears listening history and reopens Home
- **THEN** the recently played section disappears and locally informed shelves fall back to the non-personalized baseline

### Requirement: Language mixing in multi-language feeds

When more than one language is selected, multi-language shelves SHALL interleave their results so that no single language dominates the rendered order, using a deterministic round-robin over the results attributed to each selected language. With a single selected language the shelf SHALL present that language's results in the order the provider chain returned them. Results whose language cannot be attributed SHALL still be shown and SHALL be ordered deterministically, and interleaving SHALL NOT drop or duplicate tracks.

#### Scenario: Multiple languages produce mixed ordering

- **WHEN** a shelf is filled from two selected languages and one language returns substantially more results
- **THEN** the rendered order alternates between the languages instead of grouping or exhausting one language first

#### Scenario: Single language keeps provider order

- **WHEN** exactly one language is selected
- **THEN** the shelf shows that language's results in the order the provider chain returned them

#### Scenario: Interleaving is lossless and deterministic

- **WHEN** interleaving runs over the same shelf results twice
- **THEN** the same order is produced both times, and every input track appears exactly once

### Requirement: Recently played and local listening signals

When playback of a track starts, the application SHALL record a local listening event through the listening-history repository carrying the track identity, a timestamp, and the source context, and SHALL NOT record an event for a track that is already the most recent event for the same playback session without an intervening change. The Home feed SHALL render recently played tracks newest-first from those events and SHALL omit the section entirely when no events exist. Components and routes SHALL reach listening history through repository interfaces only. Meaningful-play thresholds, completion statistics, streaks, and retention policy are outside this capability's scope.

#### Scenario: Playing a track feeds recently played

- **WHEN** a user plays a track from any surface
- **THEN** a listening event is recorded for that track with its source context, and the track appears newest-first in the Home recently played section

#### Scenario: Empty history hides the section

- **WHEN** no listening events exist
- **THEN** Home renders no recently played section rather than an empty one

#### Scenario: Repeat plays of one track are recorded once per session step

- **WHEN** the same track is re-activated without any other playback in between
- **THEN** at most one additional event is recorded, and the newest event reflects the latest activation

#### Scenario: Clearing history empties recently played

- **WHEN** the user clears listening history from Settings
- **THEN** the recently played section is gone on the next Home render

### Requirement: Popular artists shelf

The feed SHALL present a Popular Artists shelf derived by grouping discovery results by canonical artist identity, showing one entry per artist with that artist's artwork when available, rendered as circular artist cards. Artist entries SHALL be deduplicated by artist identity and ordered deterministically. Activating an artist entry SHALL navigate to the search surface refined to that artist's name, and SHALL NOT require an artist page. The shelf SHALL render an explanatory empty state when no artist entries can be derived.

#### Scenario: Grouping yields one entry per artist

- **WHEN** discovery results contain several tracks by the same artist
- **THEN** the shelf lists that artist once, with the best available artwork and a deterministic position

#### Scenario: Artist cards are circular with artwork

- **WHEN** an artist entry with artwork renders
- **THEN** it uses the circular artist card with the image, the artist name, and the Artist label

#### Scenario: Activating an artist refines search

- **WHEN** the user activates a Popular Artists entry
- **THEN** the search surface opens refined to that artist's name

### Requirement: Discover surface for genres and languages

The application SHALL provide a Discover route presenting genre discovery and the user's selected languages. Each genre entry SHALL resolve a shelf of tracks for that genre through the provider API, and the surface SHALL summarize the selected languages with an affordance to change them. Entries SHALL render skeleton placeholders while loading, explanatory empty states when a genre yields nothing, and a retryable error state for a failing genre alone. The surface SHALL NOT start playback by itself, SHALL NOT claim official chart status, and SHALL remain usable when the device is offline by explaining that remote discovery needs a connection.

#### Scenario: Genre entry resolves its own shelf

- **WHEN** the Discover surface renders a genre entry
- **THEN** that genre's shelf is requested for the selected languages and renders its own results independently of other genres

#### Scenario: Selected languages are summarized with an affordance

- **WHEN** the Discover surface renders
- **THEN** the selected languages are named and a control is offered to change them

#### Scenario: A failing genre is isolated

- **WHEN** one genre request fails while others succeed
- **THEN** only that genre shows a retryable error state and the rest of the surface stays usable

#### Scenario: Offline explains that discovery needs a connection

- **WHEN** the device is offline and the user opens Discover
- **THEN** the surface explains that remote discovery needs a connection instead of rendering a blank region or an unhandled failure
