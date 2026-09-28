# Spec Delta

## ADDED Requirements

### Requirement: Public playlist resolution API

The music API SHALL expose a playlist-resolution endpoint that accepts a YouTube playlist reference — any common URL form carrying a list parameter (watch, playlist, embed, short-link) or a bare playlist ID — validates it before contacting any provider, and returns the resolved playlist's title, its optional description, and its entries normalized to canonical Spotivibe `Track` objects under the same conversion rules as search results (YouTube video ID as `providerId`, normalized artists, artwork, parsed duration, category, capabilities). Resolution SHALL follow the same fixed provider tier order as search with per-tier fallback, SHALL require no provider key or credential, SHALL return metadata only (no media bytes), SHALL accept only the playlist reference (no local library or user data), SHALL bound each upstream attempt with a timeout, and SHALL propagate an aborted client request to in-flight upstream calls.

#### Scenario: Supported references resolve to canonical tracks

- **WHEN** any supported URL form or a bare playlist ID is submitted
- **THEN** the endpoint responds with the playlist title and canonical track objects carrying no provider-specific keys

#### Scenario: Invalid input is rejected without upstream calls

- **WHEN** the input is not a valid playlist reference (empty, malformed, or not a playlist)
- **THEN** the endpoint responds with a structured 400-class error and no provider is contacted

#### Scenario: Resolution requires no credentials

- **WHEN** the server environment contains no provider configuration values
- **THEN** playlist resolution still completes through the public keyless tier chain

### Requirement: Graceful playlist resolution failures

Playlist resolution SHALL fail gracefully: a private, deleted, or otherwise inaccessible playlist SHALL produce a structured, distinguishable error response rather than a crash or an empty success; when every tier fails the endpoint SHALL respond with a structured non-success error; and individual unavailable or private videos within an otherwise resolvable playlist SHALL be skipped, with the count of skipped entries reported alongside the returned entries. No failure path SHALL present partial provider data as canonical success.

#### Scenario: Private or missing playlist is a distinguishable error

- **WHEN** the playlist is private, deleted, or does not exist
- **THEN** the endpoint responds with a structured "playlist unavailable" error that the UI can distinguish from invalid input

#### Scenario: All tiers failing yields a structured error

- **WHEN** every tier fails for a valid playlist reference
- **THEN** the endpoint responds with a structured upstream error and a non-success status, not an unhandled exception

#### Scenario: Unavailable entries are skipped, not fatal

- **WHEN** a playlist contains some unavailable or private videos
- **THEN** the resolvable entries are returned in source order together with the number of skipped entries
