# Spec Delta

## ADDED Requirements

### Requirement: Radio feed resolution

The music API SHALL expose a radio feed endpoint that answers a refill or autofill request. It SHALL compose at most two provider queries per request, chosen by rotating a curated seed list indexed by a client-supplied variant number, so successive requests for the same identity return different material instead of repeating one fixed feed. It SHALL resolve through the same fixed provider tier order and per-tier fallback as search, return canonical `Track` objects, and exclude every id in a bounded client-supplied exclusion list. It SHALL validate its input before contacting a provider, SHALL require no provider key or credential, SHALL return metadata only, SHALL bound each upstream attempt and the request as a whole with timeouts, SHALL propagate an aborted client request to in-flight upstream calls, and SHALL use a short-lived HTTP cache. A request whose every seed fails SHALL respond with a structured non-success error, and one that resolves nothing after exclusions SHALL report an empty result rather than substituting material outside the requested identity. The server SHALL NOT receive, derive, or retain any taste profile, listening history, or liked-track data, and SHALL NOT use the variant number to recognize a caller.

#### Scenario: Successive requests for one identity return different material

- **WHEN** the same identity is requested with two different variant numbers
- **THEN** the two requests plan different seed queries, and the second request's results are not limited to what the first returned

#### Scenario: The variant number is the only rotation input

- **WHEN** requests for the same identity are repeated
- **THEN** the planned seeds depend only on the identity and the requested variant, with no server-held state and no randomness

#### Scenario: Excluded ids are absent from the result

- **WHEN** a request carries an exclusion list
- **THEN** no returned track has an id in that list, and the exclusion is applied after resolution so it holds for every tier

#### Scenario: An over-long exclusion list is rejected

- **WHEN** a request carries more ids than the documented bound
- **THEN** the endpoint responds with a structured 400-class error and no provider is contacted, rather than silently truncating the list

#### Scenario: An invalid request is rejected before any provider call

- **WHEN** the identity, variant, or limit is missing, malformed, or out of bounds
- **THEN** the endpoint responds with a structured 400-class error and no provider is contacted

#### Scenario: Everything excluded is an empty result, not a substitution

- **WHEN** every resolved track is excluded
- **THEN** the endpoint reports an empty result set rather than returning material outside the requested identity

#### Scenario: No personalization data reaches the server

- **WHEN** a radio feed is requested
- **THEN** the request carries only the identity, the variant, the limit, and the exclusion list, and no request carries taste-profile, liked-track, or listening-history data

#### Scenario: Resolution is keyless and profile-free

- **WHEN** the server environment contains no provider configuration and this endpoint is served
- **THEN** resolution still completes through the keyless tier chain and no per-caller state is created or retained
