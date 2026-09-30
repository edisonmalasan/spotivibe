# Spec Delta

## Purpose

The provider-facing contract for asking a podcast question: one bounded category parameter on the search request, a category-appropriate tier order and upstream parameters, and one shared filter stage whose rules are scoped by category instead of applied to everything.

## MODIFIED Requirements

### Requirement: Multi-tier provider fallback chain

Discovery SHALL query tiers in fixed order — YouTube Music Innertube (primary), YouTube Web Innertube, Invidious, Piped — and fall through to the next tier whenever a tier fails (network error, timeout, non-2xx response, unparsable body) or produces no usable results. When every tier fails, the search endpoint SHALL return a structured error response instead of crashing. A podcast-category request SHALL query only tiers that can answer it: YouTube Music Innertube SHALL be skipped because it is a music-only surface, and the remaining tiers SHALL be queried with podcast-appropriate query parameters. A tier skipped for category reasons SHALL be recorded in the request's diagnostics rather than silently omitted.

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

#### Scenario: Podcast mode queries only tiers that can answer it

- **WHEN** a podcast-category request runs
- **THEN** YouTube Music Innertube is not queried, the remaining tiers are queried with podcast-appropriate parameters, and the skipped tier is recorded in diagnostics

### Requirement: Search API contract

The search API SHALL expose a query endpoint that validates input (non-empty after trimming, bounded length) and returns JSON containing the normalized `tracks` plus optional diagnostics metadata describing which tiers were attempted and whether the result came from cache. Diagnostics MUST NOT contain credentials, secrets, or configuration values, and UI consumers MUST NOT depend on diagnostics fields to function. The endpoint SHALL accept an optional bounded `category` parameter of `music` or `podcast` that defaults to `music`, SHALL validate it like every other input by rejecting an unknown value, and SHALL include it in the request's cache key so a result cached for one category is never served for the other. Returned tracks SHALL carry the category the request resolved.

#### Scenario: Valid query returns normalized tracks

- **WHEN** a valid query is submitted
- **THEN** the endpoint responds with success JSON whose `tracks` are canonical Track objects

#### Scenario: Invalid query is rejected without upstream calls

- **WHEN** the query is empty, whitespace-only, or exceeds the length bound
- **THEN** the endpoint responds with a structured 400-class error and no provider is contacted

#### Scenario: Diagnostics are safe to expose

- **WHEN** diagnostics metadata is included in a response
- **THEN** it contains only tier identifiers, outcomes, and cache status — no API keys, tokens, instance credentials, or internal configuration

#### Scenario: An unknown category is rejected

- **WHEN** the `category` parameter carries a value that is neither `music` nor `podcast`
- **THEN** the endpoint responds with a structured 400-class error and no provider is contacted

#### Scenario: A podcast request resolves podcast tracks

- **WHEN** a query is submitted with the podcast category and results are returned
- **THEN** every returned track carries the podcast category regardless of its duration

### Requirement: Centralized filtering and quality scoring

All tier results SHALL pass through one shared filtering and scoring stage before returning: reject Shorts in every category and promotional fragments in podcast results; in music results reject reaction/vlog/unboxing/interview content and unwanted remix/mashup/slowed+reverb/bass-boost/DJ-mix variants; reject invalid durations; collapse exact duplicates by video ID and near-duplicates by normalized title plus artist; assign `qualityScore` values and order results by them. The same rules apply regardless of which tier produced a track. Duration bounds SHALL be per-category, with music keeping a song-shaped window and podcasts a long-form window, so an episode longer than a song is never rejected for being long and a clip shorter than an episode is not presented as one. Podcast results SHALL NOT be rejected for words that legitimately occur in spoken-word titles, and the filtering a category applies SHALL NOT change which results the other category accepts or rejects.

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

#### Scenario: A podcast request is not asked a music-scoped question

- **WHEN** a podcast-category request reaches a tier that exposes a music-scoped upstream search parameter
- **THEN** that parameter is omitted for the podcast request and kept for the music request, on the same endpoint

#### Scenario: Podcast results keep words that music results reject

- **WHEN** podcast results include titles containing words such as interview, reaction, vlog, or remix
- **THEN** those tracks are present in the response, because those words are legitimate in spoken-word titles

#### Scenario: Podcast results still reject Shorts and promotional fragments

- **WHEN** podcast results include Shorts, trailers, teasers, or previews
- **THEN** those tracks are absent from the response

#### Scenario: Duration bounds are per-category

- **WHEN** a podcast result is longer than a song's maximum and a music result is shorter than a podcast's minimum
- **THEN** the podcast is kept and the music result is kept, each against its own category's window
