# Spec Delta

## ADDED Requirements

### Requirement: Catalog entity resolution

The music API SHALL expose artist, album, and similar-track resolution endpoints. Each SHALL compose at most two curated seed queries from the requested identifier or from the current track's public metadata, resolve them through the same fixed provider tier order and per-tier fallback as search, and return canonical Spotivibe `Track` objects alongside the structured entity view derived from that same result set. Artist resolution SHALL return the artist identity, its popular tracks, related artists, and releases; album resolution SHALL return the release metadata, its tracks in resolved order, and whether album metadata was confirmed; similar-track resolution SHALL return candidate tracks excluding the source track. Every endpoint SHALL validate its input before contacting a provider, SHALL require no provider key or credential, SHALL return metadata only, SHALL bound each upstream attempt with a timeout, SHALL propagate an aborted client request to in-flight upstream calls, SHALL accept no local library or user data, and SHALL use a short-lived HTTP cache. A resolution whose every seed fails SHALL respond with a structured non-success error, and one that resolves nothing SHALL be reported as unresolvable rather than substituted with a different entity.

#### Scenario: Artist resolution derives the whole artist view from one resolution

- **WHEN** an artist is resolved by name or by provider entity id
- **THEN** the response carries the artist identity, canonical popular tracks, related artists, and releases, and the request issued at most two provider queries

#### Scenario: Album resolution reports whether metadata was confirmed

- **WHEN** an album is resolved
- **THEN** the response carries the release metadata, the resolved tracks in order, and an explicit flag stating whether album metadata was confirmed for them

#### Scenario: Similar tracks exclude the source track

- **WHEN** similar tracks are requested for a track
- **THEN** the response's candidates never include the source track's own id

#### Scenario: Invalid identifiers are rejected without upstream calls

- **WHEN** an artist, album, or similar request carries a missing, malformed, or out-of-bounds identifier
- **THEN** the endpoint responds with a structured 400-class error and no provider is contacted

#### Scenario: Resolution is keyless and profile-free

- **WHEN** the server environment contains no provider configuration and these endpoints are served
- **THEN** resolution still completes through the keyless tier chain, no stored per-user state is created, and no request carries liked-track, playlist, or history data

#### Scenario: An unresolvable entity is not substituted

- **WHEN** every seed fails or nothing usable is resolved for an identifier
- **THEN** the endpoint reports unresolvable (or a structured non-success error when every seed failed) rather than returning a different entity
