# music-provider Specification

## Purpose

Server-side music discovery: a provider-independent search capability that queries the multi-tier YouTube stack (YouTube Music Innertube, YouTube Web Innertube, Invidious, Piped), normalizes everything into canonical Spotivibe Tracks, and filters, scores, and caches results before anything reaches the UI.

## Requirements

### Requirement: Normalized Track conversion

Every search result SHALL be converted to the canonical Spotivibe `Track` shape (ROADMAP §8.1) before leaving the server: stable identity with the YouTube video ID as `providerId`, `source: "youtube"`, normalized artists from the provider's channel/author text, artwork from the best available thumbnail, duration in seconds parsed when the provider presents it, `music` or `podcast` category, an assigned `qualityScore`, and `capabilities: { stream: true, offlineDownload: false }`. Raw provider or Innertube renderer structures SHALL NOT cross the API boundary, and UI code SHALL NOT import provider response types.

#### Scenario: Response contains only canonical track fields

- **WHEN** a provider response fixture is parsed and normalized
- **THEN** every returned object contains only canonical `Track` fields, carries the YouTube video ID in `providerId`, and no renderer/provider-specific keys remain

#### Scenario: Duration, artwork, and artists normalize when present

- **WHEN** a provider result includes a duration text such as `3:45` or `1:02:03`, one or more thumbnails, and channel/author text
- **THEN** duration is parsed to seconds, the largest available artwork is selected (with a documented fallback when absent), and artist names are joined into normalized artist summaries

#### Scenario: Music and podcast results are categorized

- **WHEN** normalized results are produced by any tier
- **THEN** each track is categorized as `music` or `podcast`, preferring explicit provider markers and falling back to a documented duration-based heuristic

#### Scenario: UI code carries no provider types

- **WHEN** the application code under routes, components, and features is inspected
- **THEN** no Innertube renderer type or raw provider response type is imported there

### Requirement: Multi-tier provider fallback chain

Discovery SHALL query tiers in fixed order — YouTube Music Innertube (primary), YouTube Web Innertube, Invidious, Piped — and fall through to the next tier whenever a tier fails (network error, timeout, non-2xx response, unparsable body) or produces no usable results. When every tier fails, the search endpoint SHALL return a structured error response instead of crashing.

#### Scenario: Primary tier success stops the chain

- **WHEN** YouTube Music Innertube returns usable results
- **THEN** no fallback tier is contacted for that request

#### Scenario: Failed primary falls through to fallbacks

- **WHEN** the primary tier fails or returns no usable results
- **THEN** the next tier in order is queried and its normalized results are returned

#### Scenario: One failed fallback provider does not crash the endpoint

- **WHEN** an intermediate fallback tier (Invidious) fails while a later tier (Piped) succeeds
- **THEN** the request completes successfully with results from the successful tier

#### Scenario: All tiers failing yields a structured error

- **WHEN** every tier fails for a valid query
- **THEN** the endpoint responds with a structured, human-readable error and a non-success status, not an unhandled exception

### Requirement: Search API contract

The search API SHALL expose a query endpoint that validates input (non-empty after trimming, bounded length) and returns JSON containing the normalized `tracks` plus optional diagnostics metadata describing which tiers were attempted and whether the result came from cache. Diagnostics MUST NOT contain credentials, secrets, or configuration values, and UI consumers MUST NOT depend on diagnostics fields to function.

#### Scenario: Valid query returns normalized tracks

- **WHEN** a valid query is submitted
- **THEN** the endpoint responds with success JSON whose `tracks` are canonical Track objects

#### Scenario: Invalid query is rejected without upstream calls

- **WHEN** the query is empty, whitespace-only, or exceeds the length bound
- **THEN** the endpoint responds with a structured 400-class error and no provider is contacted

#### Scenario: Diagnostics are safe to expose

- **WHEN** diagnostics metadata is included in a response
- **THEN** it contains only tier identifiers, outcomes, and cache status — no API keys, tokens, instance credentials, or internal configuration

### Requirement: Baseline search requires no provider key

Search SHALL work with no YouTube Data API key and no provider credential configured; the baseline discovery path depends only on public, keyless endpoints.

#### Scenario: Search functions with an empty server environment

- **WHEN** the server environment contains no provider configuration values
- **THEN** a search request still completes through the provider chain

### Requirement: Provider timeouts and abort propagation

Every upstream provider attempt SHALL be bounded by a timeout, and aborting the incoming request SHALL propagate cancellation to in-flight upstream calls so failed or abandoned searches do not leave orphaned requests running.

#### Scenario: Hung provider times out and falls through

- **WHEN** a tier's upstream request exceeds its timeout
- **THEN** the attempt is aborted, counted as a tier failure, and the chain proceeds to the next tier

#### Scenario: Client disconnect cancels upstream work

- **WHEN** the caller aborts the search request while an upstream call is in flight
- **THEN** the upstream request is aborted rather than continuing to completion

### Requirement: Bounded outbound concurrency

The server SHALL cap concurrent outbound provider requests within its runtime instance so a burst of client searches cannot fan out uncontrolled upstream calls. This bound is explicitly best-effort per-instance behavior compatible with serverless deployment, not a claim of global rate limiting.

#### Scenario: Search bursts queue instead of fanning out

- **WHEN** more concurrent searches arrive than the outbound cap allows
- **THEN** excess attempts wait for a slot, and observed concurrent upstream calls never exceed the cap

### Requirement: Identical in-flight request deduplication

Concurrent searches for the same normalized query and limit SHALL share one upstream result instead of issuing duplicate provider calls, and all sharers SHALL receive equivalent responses.

#### Scenario: Concurrent identical searches share one upstream call

- **WHEN** two identical searches run concurrently
- **THEN** the providers are queried once for that key and both responses contain the same tracks

### Requirement: Short-lived caching without external services

Repeated identical searches within a short time-to-live SHALL be served from a bounded cache without re-querying providers, expressed through HTTP caching semantics compatible with serverless/edge caching; no Redis or other external cache service is required. Cached state SHALL be bounded and per-instance best-effort, with expiry leading back to live provider queries.

#### Scenario: Repeat query within the TTL is served from cache

- **WHEN** the same normalized query repeats inside the TTL
- **THEN** no new upstream provider call is made and the response is marked as cached

#### Scenario: Expired cache falls back to live queries

- **WHEN** the same query repeats after the TTL has elapsed
- **THEN** the provider chain is queried again

### Requirement: Centralized filtering and quality scoring

All tier results SHALL pass through one shared filtering and scoring stage before returning: reject reaction/vlog/interview content, Shorts, unwanted remix/mashup/slowed+reverb/bass-boost/DJ-mix variants, and invalid durations; collapse exact duplicates by video ID and near-duplicates by normalized title plus artist; assign `qualityScore` values and order results by them. The same rules apply regardless of which tier produced a track.

#### Scenario: Non-music and Shorts results are rejected

- **WHEN** results include titles marking reactions, vlogs, interviews, or Shorts
- **THEN** those tracks are absent from the response

#### Scenario: Unwanted remix variants are rejected

- **WHEN** results include remix, mashup, slowed/reverb, bass-boost, or DJ-mix variants of tracks
- **THEN** those tracks are absent from the response

#### Scenario: Invalid durations are rejected and results are score-ordered

- **WHEN** results include tracks with implausible or unparsable durations
- **THEN** those tracks are dropped and the remaining tracks are ordered by descending `qualityScore`

#### Scenario: Duplicates collapse

- **WHEN** results contain the same video ID twice, or two entries whose normalized title and artist match
- **THEN** only one representative track remains

#### Scenario: Fallback results receive identical filtering

- **WHEN** the same junk content arrives from a fallback tier as from the primary tier
- **THEN** it is filtered by the same rules

### Requirement: Local data never reaches the provider layer

The search API SHALL accept only query parameters (query text and result limit); it SHALL NOT accept local library content, and the server SHALL NOT durably persist user queries or results — only the bounded, short-lived cache. Local-library search SHALL remain a client-side concern that requires no upload.

#### Scenario: Search requests carry only query parameters

- **WHEN** the search endpoint's accepted inputs are inspected
- **THEN** only query text and limit parameters exist, with no field for local library or user data

#### Scenario: Queries are not durably persisted server-side

- **WHEN** searches complete
- **THEN** no server-side durable store records the user's queries; only the bounded in-memory TTL cache holds recent results

### Requirement: No media streaming through the server

The music API SHALL return metadata only. No route SHALL proxy, extract, cache, or download audio/video bytes; playback remains the YouTube IFrame player's responsibility using the track's `providerId`.

#### Scenario: Search responses contain no media byte routes

- **WHEN** the API route surface is inspected
- **THEN** it exposes only JSON metadata endpoints, with no endpoint that returns audio or video bytes and no stream-extraction path

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
