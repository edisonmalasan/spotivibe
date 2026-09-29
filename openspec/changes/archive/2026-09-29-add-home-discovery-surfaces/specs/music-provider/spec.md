# Spec Delta

## ADDED Requirements

### Requirement: Discovery feed resolution

The music API SHALL expose a discovery-feed endpoint that composes a requested feed from the curated seed catalog server-side and resolves each seed through the same fixed provider tier order and per-tier fallback as search, returning normalized canonical Spotivibe `Track` objects that additionally carry the language code of the seed that produced them. The endpoint SHALL accept only a feed kind, selected language codes, short caller-supplied seed terms, and a bounded result count — it SHALL NOT accept or persist liked-track, playlist, or history data, and SHALL NOT create a stored user profile. Each seed attempt SHALL be bounded by a timeout, an aborted client request SHALL propagate to in-flight upstream calls, no provider key or credential SHALL be required, and the response SHALL be metadata only. Seeds within one feed SHALL be executed with bounded concurrency so a multi-language feed cannot exhaust the shared outbound budget, and a seed that is skipped for budget reasons SHALL be reported. A seed that fails SHALL be skipped while the remaining seeds still produce results, and only a feed whose every seed fails SHALL respond with a structured non-success error. Responses SHALL use a short-lived HTTP cache so repeat feeds do not re-query providers.

#### Scenario: Seeds resolve to canonical tracks carrying language attribution

- **WHEN** a discovery feed is requested for one or more language codes
- **THEN** each returned track is a canonical Track carrying the language code of the seed that produced it and no provider-specific keys

#### Scenario: One failing seed does not fail the feed

- **WHEN** some seeds for a requested feed fail across the tier chain while at least one seed succeeds
- **THEN** the response contains the successful seeds' tracks and reports the feed as successful with diagnostics naming the failed seeds

#### Scenario: Every seed failing yields a structured error

- **WHEN** all seeds for a requested feed fail on every tier
- **THEN** the endpoint responds with a structured upstream error and a non-success status, not an unhandled exception

#### Scenario: Invalid feed requests are rejected without upstream calls

- **WHEN** the feed kind, language codes, or seed terms are missing, unknown, or out of bounds
- **THEN** the endpoint responds with a structured 400-class error and no provider is contacted

#### Scenario: Discovery requires no credentials and no user profile

- **WHEN** the server environment contains no provider configuration and discovery feeds are served
- **THEN** feeds still resolve through the keyless tier chain and no stored per-user feed state is created

#### Scenario: Discovery requests carry no local library data

- **WHEN** the discovery endpoint's accepted inputs are inspected
- **THEN** only a feed kind, language codes, seed terms, and a bounded result count exist, with no field for liked tracks, playlists, or listening history

#### Scenario: A multi-language feed does not exhaust the outbound budget

- **WHEN** one feed is requested for many languages, so its seeds outnumber the shared outbound concurrency
- **THEN** the seeds run with bounded concurrency, the feed still returns results, and any seed skipped for budget reasons is named in the diagnostics
