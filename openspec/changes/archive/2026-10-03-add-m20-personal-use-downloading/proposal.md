# M20 — Personal-use media downloading

## Why

Every other milestone built something you look at. This one builds something you **keep**. A track
you liked enough to want outside the app is currently unrecoverable: the catalogue is a set of
provider IDs, playback is a parked YouTube iframe, and the export produces your *metadata*, not your
*music*. For a private, personal-use instance that is the single largest gap between "a player" and
"a music collection".

ROADMAP §21.5 approves it. §21.5 also says plainly that this **reverses a permanent v1 decision**
(§2.5), so this proposal is deliberately more careful about what it does *not* reverse than about
what it adds.

## What changes

- **A route handler** `src/app/api/download/[videoId]/route.ts` — `GET` only, one validated provider
  ID in the path, nothing else about the request can influence where the bytes come from.
- **Two extractors behind one interface.** Primary `@distube/ytdl-core` (`getInfo()` → `audioonly`
  formats → highest *suitable* bitrate); fallback Invidious (`/api/v1/videos/:id` → `adaptiveFormats`
  → `audio/*` → highest suitable). The interface is the seam every test drives.
- **Honest format.** The extension and MIME come from the container and codec actually selected.
  Opus-in-WebM is named `.webm`. A file is never named `.mp3` unless it contains MP3. No transcoding,
  no renaming to fake a conversion.
- **Bounded selection, streaming delivery.** The bitrate ceiling is derived from the deployment's
  own documented constraints, not chosen for maximum fidelity. The body is a `ReadableStream`; media
  is never materialised whole in server memory.
- **Download-to-device only.** Blob → object URL → temporary `<a download>`. Nothing is written to
  IndexedDB. Playback is untouched.
- **Four entry points, one state machine.** PlayerBar and MiniPlayer overflow menus (new — neither
  exists today), the Now Playing route, and the track context menu. Idle / busy / done / failed, with
  no duplicate concurrent download of the same track.

## What this does not do

Accounts, auth, OAuth, ad blocking, cloud sync, a user database, a managed offline library,
local-file playback, transcoding, batch or playlist downloading, percentage progress, and any change
to the parked-player decision. Each of these is a **non-goal enforced by a test**, not by review.

## The hard part, stated up front

The single highest-risk edit in this milestone is to `frontend/tests/release-exclusions.test.ts`,
which currently encodes §2.5 and §2.7 as *permanent* exclusions — including a path rule that rejects
`/api/download/` and a dependency shape that rejects `ytdl-core`. Those clauses are the ones §18
reversed. They cannot simply be deleted: deleting a detector is indistinguishable from switching it
off, which is the exact failure that suite was written to prevent.

So they are **narrowed to the clauses that survive**, each drop justified against the roadmap's own
wording, each surviving detector re-proven against a fresh violating snippet, and the whole diff
recorded line by line in the change's evidence report. ROADMAP §2.5's *other* two clauses — "do not
implement YouTube-to-MP3" and "do not cache extracted audio for offline playback" — are untouched by
§18 and stay enforced at full strength.

## Impact

- New capability spec: `download` (7 requirements).
- Modified capability: `release-validation` (the exclusions requirement gains two scenarios about
  narrowed detectors).
- New dependency: `@distube/ytdl-core` (server-only; never reaches the client bundle).
- New documentation: `frontend/docs/DOWNLOADING.md`; `DEPLOYMENT.md` claims about downloading and
  proxying corrected.