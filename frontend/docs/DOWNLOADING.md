# Personal-use downloading

**One track, to your own device, in the format the source actually provides.** No account, no
library, no queue, no percentage.

This file describes what `GET /api/download/[videoId]` does, what it refuses to do, and which
parts of it have never been exercised on a real deployment. The non-goals below are enforced by
`tests/download-non-goals.test.ts`, each with a violating fixture so the detector is known to be
able to fail.

---

## 1. What it is, and what it is not

M20 reverses one permanent v1 decision — that this application would never contain an extractor.
`ROADMAP.md` §18 and §21.5 state exactly what that reversal authorizes, and this implementation
does not go one step past it:

- It is a **download to the device**. The browser receives a stream, wraps it in a `Blob`, and
  hands it to the filesystem through a temporary `<a download>`.
- It is **not playback**. Nothing feeds the queue, the player, or the radio. The YouTube IFrame
  player remains the only thing that plays audio.
- It is **not a library**. Nothing is written to IndexedDB. `capabilities.offlineDownload` stays
  `false` in `src/server/music/normalize.ts` — the single place that declares it, asserted to be
  the single place by `tests/release-exclusions.test.ts`.
- It is **not compliant with YouTube's download policies**, and nothing here may be described as
  such. It is a private, personal-use affordance, deliberately at odds with the platform's
  published rules.

## 2. The route

`src/app/api/download/[videoId]/route.ts`, one handler, `GET` only.

| Concern | Decision | Where |
| --- | --- | --- |
| Input | `videoId` must match the 11-character YouTube id shape. No URL parameter, no arbitrary upstream — the caller cannot name what the server fetches. | `downloadParamsSchema` (zod) |
| Function duration | `maxDuration = 300` stated explicitly, not inherited from the platform default. | the route module |
| Throttling | The shared `guardRequest` entry point, then an immediate `request.signal.aborted` check, then the dedicated limiter. | the route module |
| Rate limit | 6 requests per address per 10 minutes; 1 concurrent transfer per address; 4 concurrent per instance. | `src/server/download/limiter.ts` |
| Duplicate downloads | A module-level `Map` keyed by `track.id`, so two surfaces asking for the same track share one transfer. | `src/features/download/useDownloadTrack.ts` |
| Body | A `ReadableStream`, never a buffer. No `Content-Length` is ever sent, because a lying upstream must not be able to make the browser trust a number the route cannot honour. | `src/server/download/service.ts` |

### Status codes

| Code | Meaning |
| --- | --- |
| `400` | The `videoId` is malformed. Rejected before any provider call. |
| `429` | The download limiter refused: too many requests, or one already in flight for this address. |
| `499` | The caller went away, or the deadline passed. The upstream is aborted. |
| `502` | No extractor could produce a usable audio format, with a structured reason. |
| `200` | A stream, with honest `Content-Type` and `Content-Disposition`. |

A **non**-`ExtractionError` thrown inside the resolver is deliberately **rethrown** rather than
turned into a 502. That is a defect in this application, not an upstream outage, and telling a
listener to retry would disguise it. `tests/download-route.test.ts` asserts the rethrow.

## 3. Format honesty

This is the part §21.5 is most specific about, and the part the code takes literally.

`src/server/download/container.ts` maps the selected container and codec to a file name:

| Container | Codec | Extension | Media type |
| --- | --- | --- | --- |
| `webm` | `opus` | `.webm` | `audio/webm` |
| `webm` | `vorbis` | `.webm` | `audio/webm` |
| `mp4` | `aac` | `.m4a` | `audio/mp4` |
| `mp4` | `mp3` | `.mp3` | `audio/mpeg` |
| `ogg` | `opus` | `.opus` | `audio/ogg` |
| `mpeg` | `mp3` | `.mp3` | `audio/mpeg` |
| anything else | — | **no honest name** | — |

Anything unmapped is `known: false` and is **filtered out of selection entirely** — the route
answers `502 no_suitable_format` rather than guessing. `audio/mpeg` additionally **requires an
explicit codec** in the media type; a bare `audio/mpeg` is not enough, because `audio/mpeg` is the
one media type a bare declaration would let us name a file `.mp3` without knowing what is inside.

**A file is never named `.mp3` unless it contains MP3 audio.** There is no transcoding anywhere in
this application: no `ffmpeg`, no codec conversion, no renaming to a lie.
`tests/download-container.test.ts` carries the Opus-in-WebM fixture §21.5 asks for by name.

## 4. Choosing the format: highest that *fits*

`src/server/download/selectFormat.ts`. One number governs both the ladder and the ceiling:

```
DOWNLOAD_BUDGET_BYTES = 20 MiB      // selectFormat.ts, exported
```

Selection walks candidates from the highest bitrate down and takes the first that fits the budget,
estimating size from a reported `contentLength` when there is one and from
`bitrate × duration` when there is not. `MIN_AUDIO_BITRATE` is applied at the top of the function
to **every** candidate, so no branch can walk past a format too poor to rank.

Why "highest that fits" and not "highest available": `ROADMAP.md` §21.5 records the reasoning, and
it is the correct call here. A maximal-bitrate transfer maximises the chance of exceeding Vercel's
proxied request timeout for no benefit to a personal download.

**The byte ceiling cancels the stream; it does not merely stop counting.** When the budget is
exceeded the route cancels its own `ReadableStream`, which aborts the upstream request, rather than
truncating a file the listener would believe is complete.

## 5. Extractors

| | Primary | Fallback |
| --- | --- | --- |
| Implementation | `@distube/ytdl-core` | Invidious |
| Loaded | **dynamic `import()`**, inside `src/server/download/sources.ts` | `fetch` |
| Resolve deadline | 8 s | 4 s per attempt, at most 3 attempts |
| Instances | — | a fixed, bounded list (2 by default) |
| Body | Node `Readable` converted with `Readable.toWeb` | passed through as-is |

The dynamic import is load-bearing twice over: it keeps `@distube/ytdl-core` out of the client
bundle entirely (`docs/MOTION.md` §2a records the measured cost), and a module that fails to load
falls back to Invidious rather than failing the whole function at import time.

The fallback list is **fixed and bounded** rather than discovered: a public-instance list fetched at
runtime is an unbounded, untrusted input, and §21.5's own table says public Invidious instances are
"frequently rate-limited or down". When both fail, the route says so. It does not pretend.

## 6. The client surface

- `src/features/download/saveFile.ts` — builds the URL (title as an encoded query parameter and
  nothing else), reads `filename*=` before `filename=` per RFC 5987, saves the Blob, and revokes the
  object URL on the next tick rather than synchronously.
- `src/features/download/useDownloadTrack.ts` — the four states (idle / busy / success / failure),
  single-flight by `track.id`, and a **parameterless** `download()` bound to its own track.
- `src/features/download/DownloadControl.tsx` — the row and the affordance.
- `src/components/player/OverflowMenu.tsx` — the shared menu shell, lifted out of `ResultMenu`
  because the two player bars needed the same behaviour.

`filename*=` is tried **first** as an ordered array of patterns, not as a single combined regex. A
single regex silently took the ASCII `filename=` and discarded it, which would have mangled every
accented title — a bug found by writing the test, not by reading the code.

**No percentage, anywhere.** The size behind any percentage is an estimate, and an estimate rendered
as a confident figure is a lie. `tests/download-client.test.tsx` asserts the rendered surface shows
no percentage and no progress figure at any point, and `tests/download-non-goals.test.ts` asserts
the vocabulary never appears in source.

## 7. Non-goals, enforced

Each row below is a detector in `tests/download-non-goals.test.ts`, and each detector is first shown
a violating snippet so it is known to be able to fail.

| Non-goal | How it is caught |
| --- | --- |
| Accounts or auth of any kind | Import specifiers for auth SDKs, auth calls, `access_token`-shaped literals, `Authorization: Bearer`, credential fields. Anchored on executable positions, not on the English word "login" — the first draft matched this repository's own IndexedDB session-restore code and three doc comments saying there is no sign-in. |
| Ad blocking or suppression | Tokens that appear verbatim in real filter lists and host patterns. Case-**sensitive**: a case-insensitive `ad-container` matched `X-Spotivibe-Download-Container`. |
| A managed offline library | IndexedDB/audio store names, `offlineDownload: true`, a persisted download record. |
| Local-file playback | A file input scoped to **audio**, the filesystem picker APIs, `blob:null/`, and a server-side path join onto a media extension. A bare `type="file"` is the versioned-JSON **backup importer**, which is how data comes *in*. |
| Transcoding | `ffmpeg`, `avconv`, codec conversion, and a rename-as-conversion shape. |
| Batch or playlist downloading | Anything taking an array of ids, a playlist id, or a `?ids=` parameter. |
| Progress reporting by percentage | Download-scoped percentage vocabulary only. Any `Math.round(x * 100)` would have caught `ProgressSlider`, a playback scrubber whose percentage is a true position within a known duration. |

## 8. What has **not** been verified

Recorded as unverified, never as a pass.

**No browser verification was possible.** The only installed browser is Edge, there is no automation
dependency in this repository, and both the production origin
(`https://spotivibe-web.vercel.app`) and every Preview deployment sit behind Vercel Deployment
Protection — `302` to `vercel.com/sso-api`, then `DEPLOYMENT_NOT_FOUND`. Deployment Protection was
not circumvented.

So the following remain **documented constraints this feature is designed against**, not observed
behaviour:

| Constraint | Value | Why it matters here |
| --- | --- | --- |
| Response body size | 4.5 MB | A full track exceeds it. Vercel documents that **streaming** responses do not carry this limit, which is why the route must stream and must never buffer, even once. |
| Max function duration | 300 s | Stated explicitly in `maxDuration`. |
| Proxied request timeout | 120 s | See the arithmetic below. |
| `@distube/ytdl-core` on a real function | — | Pure JavaScript, no native binary; compatible in principle, never observed. |
| Invidious availability | — | Best-effort by nature, surfaced as a failure state. |

### The 20 MiB budget does not fit inside 120 s

At realistic audio-only bitrates — 50 to 160 kbit/s — a transfer runs at roughly 6 to 20 kB/s.
20 MiB at that rate is **about 17 minutes**, which is past the 120 s proxied timeout by a wide
margin. A short track finishes comfortably; a long one at the top of the ladder cannot.

This is **documented, not solved**. The design bets on `maxDuration = 300` being the operative
ceiling rather than the 120 s proxy timeout. That bet is unverified and could be wrong. The two
options, in the order they should be tried, are: lower `DOWNLOAD_BUDGET_BYTES` so the ladder's top
rung fits 120 s at a realistic rate, or raise the budget and rely on the 300 s duration. Neither is
done here, because choosing without observing the real timeout would be a guess dressed as a
decision.

### Also unverified

- A real download in a real browser: that the file lands, plays locally, and its extension matches
  its content. `ROADMAP.md` §21.5 asks for this under **Browser verification**; it was not possible.
- That the service worker does not interfere. `public/sw.js` lists `googlevideo.com` in a
  deny-list, which is consistent with the design, but the interaction with a download response has
  not been observed.

**What would change all of this:** someone with Vercel account access running the route on the
protected origin with a real provider id. That is user-only input, and it is the only way these
numbers stop being documentation.

## 9. A note on dependencies

`@distube/ytdl-core@4.16.12` is this milestone's only new dependency. `npm audit` reports **5 high**
severity findings, all in the **dev-only lint chain**
(`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`) — **not** in
`@distube/ytdl-core`. An earlier `AGENTS.md` line recording "0 vulnerabilities" was true as of
2026-10-01 and is now stale. The finding is recorded rather than papered over, and no dependency was
added or upgraded to address it, because a lint-chain advisory is not fixed by changing the
application's dependencies.