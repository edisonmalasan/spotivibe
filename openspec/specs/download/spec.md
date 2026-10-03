# download Specification

## Purpose

Getting one track out of the catalogue and onto the device as a file whose name tells the truth,
without turning the application into an account system, an offline library, a media proxy, or a
transcoder.

## Requirements
### Requirement: A track is downloaded through one validated provider id

The application SHALL expose exactly one download entry point, a `GET` route under
`/api/download/[videoId]/`, whose **only** input is the provider video id in its path. The route SHALL
reject a path segment that is not a well-formed provider id with a structured 400 before any outbound
request is made.

The route SHALL read **no** media location from anywhere else. A URL supplied in a query parameter, a
header, or a request body SHALL be ignored, and a route that accepted one SHALL fail the release
exclusion that no caller-supplied URL may be proxied. This is the boundary that separates "download
the track the listener is looking at" from "fetch anything this caller names", which ROADMAP §21.5's
non-goals forbid and which ROADMAP §2.7 has always forbidden in every other form.

The route SHALL state its maximum duration explicitly rather than relying on the deployment
platform's default, because the duration is a design decision here and not an inherited one.

#### Scenario: A well-formed provider id is accepted

- **WHEN** a request arrives at the download route with an eleven-character URL-safe provider id
- **THEN** the route proceeds to resolve a stream for that id

#### Scenario: A malformed provider id never reaches an extractor

- **WHEN** a request arrives with a path segment that is not a well-formed provider id
- **THEN** the route answers a structured `400` and no extractor has been invoked

#### Scenario: A caller-supplied media location is refused by the release checks

- **WHEN** any module under the download route's server tree reads a media URL from a query parameter,
  a header, or a request body
- **THEN** the release exclusion check for caller-supplied URL proxying fails

#### Scenario: The duration is stated rather than inherited

- **WHEN** the download route module is inspected
- **THEN** it exports an explicit maximum duration, and does not depend on the platform default

### Requirement: The delivered file is named for what it actually contains

The download SHALL report a file extension and a MIME type derived from the container and codec of
the format actually selected, read from that format's own media type.

**A file SHALL NOT be given the `.mp3` extension unless the selected format's codec is MP3.** A
container the application cannot map SHALL be a structured failure, never a guess: defaulting an
unrecognised container to `.mp3` would produce a mislabelled file, which is the one outcome this
requirement exists to prevent.

The application SHALL NOT convert between formats. Renaming a container is not conversion, and the
route SHALL NOT claim a conversion it did not perform. ROADMAP §2.5's clause "Do not implement
YouTube-to-MP3" remains permanent after this milestone and is enforced by these rules.

#### Scenario: Opus in a WebM container is not named `.mp3`

- **WHEN** the selected format is Opus audio in a WebM container
- **THEN** the download is served with a `.webm` extension and an `audio/webm` media type, and never
  with `.mp3`

#### Scenario: MP3 audio is named `.mp3`

- **WHEN** the selected format's codec is MP3
- **THEN** the download is served with a `.mp3` extension

#### Scenario: An unmappable container fails rather than guessing

- **WHEN** the selected format's media type is one the mapping does not cover
- **THEN** the route answers a structured failure and no file is offered

#### Scenario: No conversion is performed or claimed

- **WHEN** the download route's server tree is inspected
- **THEN** it contains no transcoder invocation and no container conversion, and the release check for
  MP3 faking passes

### Requirement: The bitrate is the highest one that fits the transfer budget

The application SHALL select the **highest suitable** bitrate, where suitable means the transfer
fits a stated budget, and SHALL walk the candidate ladder downward when the top candidate does not
fit. Selecting the highest *available* bitrate is a defect: it maximises the chance of exceeding the
deployment's proxied request timeout for no benefit to a personal download.

The estimated size of a candidate SHALL come from the format's reported content length when it has
one, and from its bitrate multiplied by the track's duration otherwise. Both branches SHALL be
exercised, so the estimator cannot be one branch wearing the other's name.

When no candidate fits, the application SHALL take the lowest bitrate still above a stated floor and
report that the budget was exceeded. When nothing is above the floor, it SHALL fail rather than
deliver an unusable file.

#### Scenario: The highest bitrate that fits is chosen

- **WHEN** several audio formats are available and the highest bitrate's estimated size fits the
  budget
- **THEN** that format is selected

#### Scenario: The ladder is walked down

- **WHEN** the highest bitrate's estimated size exceeds the budget and a lower one fits
- **THEN** the lower one is selected, and the selection is not the highest available

#### Scenario: Nothing fits and the floor does

- **WHEN** no candidate's estimated size fits the budget but some candidate is above the floor
- **THEN** the lowest such candidate is selected and the budget overrun is reported

#### Scenario: Nothing fits and the floor does not either

- **WHEN** no candidate is above the floor
- **THEN** the route fails with a structured error rather than delivering an unusable file

#### Scenario: Both size estimates agree

- **WHEN** a format reports a content length and the same format is estimated from bitrate and
  duration
- **THEN** both estimator branches are exercised, and the selection is the same either way

### Requirement: Media is streamed to the response and never buffered in server memory

The response body SHALL be a `ReadableStream` produced from the extractor's chunks as they arrive. The
route SHALL NOT read the upstream body whole — no whole-body buffer read, no blob read, no text read —
so that server memory does not scale with track length. ROADMAP §2.7's prohibition on handing a
buffered upstream body back to a caller remains permanent.

A running byte counter SHALL cancel the stream when it passes a hard ceiling, so a stream the platform
cuts off mid-flight cannot be served as a complete file.

**This constraint is about server memory, not about the listener's browser.** ROADMAP §21.5
prescribes the client holding the result as a Blob before the save dialog, and that is required: a
`Content-Length` SHALL NOT be invented for a length the application has estimated, because a wrong
length is worse than an absent one.

#### Scenario: The response body is a stream

- **WHEN** a download is served successfully
- **THEN** the response body is a stream and the route has read no whole-body buffer

#### Scenario: A stream past the ceiling is cancelled

- **WHEN** the upstream produces more bytes than the hard ceiling
- **THEN** the stream is cancelled rather than completed and served as a whole file

#### Scenario: The client holds the file as a Blob

- **WHEN** a download completes in the browser
- **THEN** the result is handed to a Blob and a temporary object URL, and the client does not claim
  otherwise

### Requirement: A download is bounded, abortable, and fails in a form the caller can act on

Each download request SHALL pass the application's shared request guard **and** a download-specific
limit that expresses what a multi-megabyte transfer costs: a per-address ceiling on how many
downloads may start in a window, a refusal of a second concurrent download for the same address, and a
per-instance cap on concurrent downloads. A refused request SHALL be refused before any upstream
request is made.

`request.signal` SHALL abort the upstream work, and a client disconnect SHALL abort the stream, so a
caller that goes away stops costing the function.

Every failure SHALL be structured — a machine-readable code with an HTTP status that distinguishes an
invalid request (400), a refusal (429), an upstream that could not supply a usable format (502), and
a caller that disconnected (499). The fallback extractor's unavailability SHALL be reported as a
failure rather than hidden behind an empty or truncated response.

#### Scenario: A refusal happens before any upstream request

- **WHEN** a request exceeds the download ceiling
- **THEN** it is refused with a structured `429` and no extractor has been invoked

#### Scenario: A concurrent download for the same address is refused

- **WHEN** a second download starts for an address that already has one in flight
- **THEN** the second is refused rather than queued

#### Scenario: A disconnect aborts the work

- **WHEN** the caller disconnects while the download is in flight
- **THEN** the upstream work is aborted and the stream is cancelled

#### Scenario: Both extractors failing is a reported failure

- **WHEN** the primary extractor and every fallback instance fail
- **THEN** the route answers a structured `502` naming the fallback as a reason, rather than an empty
  or truncated success

### Requirement: A download leaves no persistent application state

A download SHALL hand the file to the device through a Blob, an object URL, and a temporary download
element, and SHALL write nothing to the application's local data store. The download modules SHALL
import no repository, so this is a property of the module graph rather than of a code path that could
be reached.

The application SHALL NOT build a managed offline media library: no repository that stores media
bytes, and no cache entry that persists one. ROADMAP §2.5's clause "Do not cache extracted YouTube
audio for offline playback" remains permanent after this milestone.

Downloading SHALL NOT change playback. No store that playback reads is written, and the player keeps
its own parked configuration.

#### Scenario: Nothing is written to local data

- **WHEN** a download completes
- **THEN** no local-data store has been written, and the download modules import no repository

#### Scenario: No offline media store exists

- **WHEN** the application's local-data repositories are enumerated
- **THEN** the set is the one enumerated before this milestone, with no media store added

#### Scenario: Playback is untouched

- **WHEN** a download runs
- **THEN** no playback state has changed and no playback configuration has been altered

### Requirement: A download is offered where a track is, and only one runs at a time

Download actions SHALL be reachable from the persistent player bar, the compact player, the Now
Playing route, and the track context menu, each presenting an idle, busy, succeeded, or failed state.

Activating download for a track that is already downloading SHALL NOT start a second transfer; it
SHALL join the one in flight. Two affordances for the same track on one screen are therefore two views
of one download rather than two downloads.

The action SHALL be unavailable when there is no track to act on, and the outcome SHALL be reported
without a modal dialog, consistent with how the application's other background actions report.

#### Scenario: Every surface offers the action

- **WHEN** the player bar, the compact player, the Now Playing route, and the track context menu are
  rendered
- **THEN** each offers a download action for its track

#### Scenario: A second activation joins the transfer already running

- **WHEN** download is activated for a track whose download is already in flight
- **THEN** no second transfer starts and the existing one is awaited

#### Scenario: An idle bar offers nothing to download

- **WHEN** the player bar has no current track
- **THEN** its download action is disabled

#### Scenario: Failure is reported in place

- **WHEN** a download fails
- **THEN** the surface shows a failed state and the rest of the interface remains operable

### Requirement: The permanent non-goals of this feature are enforced

This milestone is a recorded reversal of one clause of one permanent product constraint, and the
clauses that survive SHALL be enforced by checks over the shipped sources rather than by review.

A release detector narrowed by an explicit roadmap change SHALL remain proven able to fail, on the
shapes the narrowing newly permits as well as the shapes it already rejected. **A detector that was
silently deleted SHALL be treated as a defect**, and the clauses removed from each narrowed detector
SHALL be published with the roadmap citation that authorised their removal.

The non-goals of this feature SHALL each be enforced by a check: no accounts or authentication, no ad
blocking, no unrelated media scraping, no managed offline library, no local-file playback, no
transcoding, no batch or playlist downloading, and no percentage-progress reporting.

#### Scenario: A narrowed detector is still proven able to fail

- **WHEN** a release detector has been narrowed because a roadmap clause was reversed
- **THEN** it is still shown failing on a violating snippet, including one written against the shapes
  the narrowing newly permits

#### Scenario: A removed clause is published, not quietly dropped

- **WHEN** a clause is removed from a release detector
- **THEN** the removal is recorded with the roadmap clause that authorised it, and the surviving
  clauses of that detector are unchanged

#### Scenario: A non-goal introduced into the download code fails a check

- **WHEN** a source, dependency, or configuration that this feature's non-goals forbid is added
- **THEN** a release check for that non-goal fails and names what it found

#### Scenario: The route is single-track, not batch

- **WHEN** the download routes are enumerated
- **THEN** there is exactly one, it accepts only `GET`, and it takes exactly one provider id
