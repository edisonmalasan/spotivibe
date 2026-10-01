# Tasks

## 1. The parser and the active line, before any UI

- [ ] 1.1 Implement the LRC parser producing time-ordered non-empty lines, handling `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss.xxx]`, ignoring metadata tags, sorting by time, and dropping empty timed lines — verify: unit tests over real LRC fixtures, including all three timestamp precisions, metadata tags, unparsable lines, and out-of-order source (spec: `lyrics` — "Timed lyrics are parsed into ordered lines" and its four siblings).
- [ ] 1.2 Implement `activeLineIndex(lines, positionSeconds)` as a pure binary search returning the last line at or before the position, or `-1` before the first — verify: tests at every boundary (exactly on a timestamp, between, before the first, beyond the last, duplicate timestamps, empty input), and a test asserting two identical calls give the same answer (spec: `lyrics` — "The active line is selected from playback position").
- [ ] 1.3 Prove both modules are pure and clock-free — verify: a test asserts neither module reads a clock, a timer, or `Date.now`; the reason is that `podcast-playback-history` is a flake caused by a wall-clock budget standing in for synchronization, and repeating that here would repeat the defect.

## 2. The provider and its cache

- [ ] 2.1 Port the *behaviour* of Lyrix's title cleaning and artist/title split — `(Official Video)`, `| Lyrics`, `HD`, `ft.` normalisation, splitting on ` - `/` – `/` — `/` ~ ` — verify: tests over the noisy-title shapes the regexes exist for (spec: `lyrics` — "Lyrics are resolved for the active track").
- [ ] 2.2 Implement duration-aware scoring preferring timed lyrics, then closest duration, and return the provider's raw strings — verify: tests where a timed candidate beats an untimed one, and where two timed candidates are separated by duration; a test asserting the response carries raw strings, not parsed lines (spec: `lyrics` — "Timed lyrics beat untimed lyrics"; "Among timed candidates the closest duration wins").
- [ ] 2.3 Cache with the existing `createTtlCache` and `createInflightDedup`, a shorter TTL for a miss than for a hit — verify: tests for both TTLs, for eviction, and for concurrent same-track requests issuing one provider query (spec: `lyrics` — "A miss is retried sooner than a hit is distrusted"; "Concurrent requests for one track reach the provider once").
- [ ] 2.4 Make a provider failure distinct from a miss, with a bounded timeout, and assert the miss is **not** cached on failure — verify: tests for timeout, for non-OK response, for malformed body, and a test asserting no entry is cached when the request fails (spec: `lyrics` — "A track with no lyrics is reported as unavailable, not as an error"; "A provider failure does not become a cached miss"; "The lookup is bounded").

## 3. The route

- [ ] 3.1 Add `/api/lyrics` as a Next.js route handler over the server provider, returning the resolved strings and the `unavailable` outcome as data rather than as an error status — verify: route tests for the hit, the unavailable, and the failure outcomes, and a test asserting `unavailable` is not a 5xx (spec: `lyrics` — "A track with no lyrics is reported as unavailable, not as an error").

## 4. The panel

- [ ] 4.1 Build the panel with the four states — no track, loading, unavailable, error — each visually and textually distinct — verify: tests for all four, asserting unavailable and error are different text (spec: `lyrics` — "Unavailable and failure are different messages").
- [ ] 4.2 Render timed lines with the active line marked current, and untimed lyrics as plain text with no marking — verify: tests for both, including that the untimed view has no current-line element (spec: `lyrics` — "Untimed lyrics are shown when no timed lyrics exist"; "The active line is marked and kept in view").
- [ ] 4.3 Auto-scroll to centre the active line, suspend following on manual scroll, and restore it via an explicit back-to-live affordance — verify: tests that a manual scroll clears following, that following is off while it is off, and that the affordance restores it (spec: `lyrics` — "A manual scroll suspends following").
- [ ] 4.4 Under `prefers-reduced-motion`, disable the line animation and use non-smooth scrolling — verify: tests asserting the scroll behaviour and the transition are the reduced-motion values, since the global CSS rule is a net and the JS decision is the guarantee (spec: `lyrics` — "Reduced motion removes the animation and the smooth scroll").
- [ ] 4.5 Mark the active line with `aria-current` and no `aria-live` region — verify: tests asserting the current attribute is present and that no live region exists (spec: `lyrics` — "The active line is not announced as a live region").
- [ ] 4.6 Reset everything on track change — lyrics, active line, scroll, and any stale response — verify: a test that changes track mid-flight and asserts the earlier response cannot render (spec: `lyrics` — "A track change resets the panel completely").

## 5. Wiring into Now Playing

- [ ] 5.1 Host the panel in the Now Playing column, respecting the existing bottom padding, and never overlaying the player region — verify: layout assertions plus the existing Now Playing suites staying green (spec: `app-shell` — "Lyrics never displace or delay the rest of the surface").
- [ ] 5.2 Confirm artwork, title, transport, volume, queue, radio, video mode, and More Like This all remain operable in every lyrics state — verify: a test per state asserting the transport controls are present and enabled (spec: `app-shell` — "Lyrics never displace or delay the rest of the surface").

## 6. Verification

- [ ] 6.1 Run the six quality gates from the repository root under Node 24 — verify: each exits `0`, with the interpreter version recorded.
- [ ] 6.2 Run the release gate and confirm no existing item regressed — verify: the gate's pass/fail/not-run counts are recorded and compared against the pre-change baseline.
- [ ] 6.3 State plainly what could not be verified here: the YouTube IFrame API is blocked by CSP in this environment, so **the position plumbing is verified but the following is not observed in a real browser** — verify: the claim is recorded as a limit in the change's evidence, not as a pass.
