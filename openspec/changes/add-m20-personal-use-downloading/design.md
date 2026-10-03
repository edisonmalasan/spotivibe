# Design — M20 personal-use media downloading

ROADMAP §21.5 is the requirement source. This document records the decisions that source leaves
open, and — more importantly — the decisions where a reasonable implementer could have gone further
than the roadmap author intended.

---

## Decision 1 — The dependency is added, and it is server-only

**Decision.** `@distube/ytdl-core` goes into `dependencies` and is imported *only* through a dynamic
`import()` inside the extractor's resolve path. It never appears in a client module.

**Why.** §21.5 names it as the primary extractor, and the alternative — hand-rolling a manifest
fetch and a signature decipher — is precisely what ROADMAP §2.5 clause 3 and the §2.5 detector in
`release-exclusions.test.ts` were written to stop, twice over: the second verification pass of M15
added a violation fixture for exactly that shape ("a hand-rolled extractor over the stream manifest").
Adding the dependency is the honest way to do what §18 approved.

**Cost, stated.** It is a CommonJS package of some size in the *server* function bundle, which
lengthens cold start for the download route. It does not touch the client bundle at all, so M19's
`motion-budget.test.ts` ceiling is unaffected — verified, not assumed (task 6.2).

**Risk, stated.** Whether it works on a real Vercel function is **unverifiable here** (§21.5's own
"Not verifiable in this environment"). If it fails at runtime the route must fall through to
Invidious and surface a failure — which is why decision 3 makes the fallback real rather than
decorative.

---

## Decision 2 — Format honesty is a pure function with a fixture per container

**Decision.** `src/server/download/container.ts` exports one pure mapping:

```
describeAudioFormat({ mimeType, codec }) -> { container, codec, extension, mime } | { unknown }
```

| container / mimeType          | codec      | extension | MIME           |
| ----------------------------- | ---------- | --------- | -------------- |
| `audio/webm`                  | `opus`     | `.webm`   | `audio/webm`   |
| `audio/webm`                  | `vorbis`   | `.webm`   | `audio/webm`   |
| `audio/mp4`                   | `mp4a.40` (AAC) | `.m4a` | `audio/mp4`  |
| `audio/mp4`                   | `mp4a.6b` / `mp3` | `.mp3` | `audio/mpeg` |
| `audio/mpeg`                  | `mp3`      | `.mp3`    | `audio/mpeg`   |
| `audio/ogg`                   | `opus`     | `.opus`   | `audio/ogg`    |
| anything else                 | —          | —         | — (structured 502) |

**Why unknown is an error and not a guess.** The temptation is a default of `.mp3`, because that is
what a download button is expected to produce. That default is the exact lie §21.5 forbids: "a file
is never named `.mp3` unless it contains MP3 audio." A container this milestone has never seen is
more likely to be something exotic (DASH, HDR audio, a `application/octet-stream` that is really MP4)
than it is to be MP3. Refusing is one 502; guessing writes a mislabelled file to someone's disk.

**The codec is read, not inferred from the extension.** `audio/webm` names the container, not the
codec; a WebM can carry Vorbis or Opus and only the codec string distinguishes them. Both are
`.webm`, so the mapping is stable, but it is derived from the format's own `mimeType` string —
`audio/webm; codecs="opus"` — rather than from any client hint.

---

## Decision 3 — The Invidious fallback is bounded, per-instance, and honest about being best-effort

**Decision.** A short fixed list of instances, tried in order, each with its own attempt timeout,
each abortable via the request signal. If all fail the route returns a structured **502** naming the
fallback as the reason.

**Why a structured failure and not a silent success.** §21.5's own table says public Invidious
instances are "frequently rate-limited or down" and that "this must be surfaced as a failure state,
not hidden." A download that silently produces nothing, or that produces a truncated file because a
range request died, is worse than an error the user can retry.

**Why a fixed list rather than the existing provider list.** The music providers resolve through
`chain.ts` with ranking, caching, and a scoring policy tuned for *catalog metadata*. This needs
something narrower and faster: an instance that answers `/api/v1/videos/:id` once, within ~6 seconds,
or is skipped.

---

## Decision 4 — "Highest suitable" is highest-that-fits, and the budget is derived from Vercel's documented numbers

**Decision.** `selectAudioFormat(formats, budget)` is pure and deterministic:

1. Filter to formats the container mapper recognises.
2. Sort by `audioBitrate` descending, tie-broken by `contentLength` ascending (a smaller file at the
   same bitrate is the better choice).
3. Walk down, taking the first whose **estimated size** fits `budget`.
4. If **no** candidate fits, take the **lowest** recognised bitrate that is still above
   `MIN_AUDIO_BITRATE`, and say so in the response header. If nothing is above the floor, fail with a
   structured 502 rather than deliver something unusable.

Estimated size is `contentLength` when the extractor reports one, and `audioBitrate × durationSeconds`
otherwise. The estimator is therefore stated, tested against both branches, and never silently
substituted.

**Where the budget comes from.** §21.5's table: 4.5 MB response limit (streams exempt), 300 s max
duration, **120 s proxied request timeout**. A track over ~10 minutes at a high audio bitrate
comfortably exceeds what 120 s of proxying will carry on a slow link, and picking the top bitrate
"maximises the chance of exceeding the 120 s proxy timeout for no benefit to a personal download" —
§21.5's own words. So the budget is expressed in **seconds of transfer**, and the bitrate is chosen
to fit. Default budget: 45 s of transfer at the observed upstream rate, with the duration taken from
`videoDetails.lengthSeconds` (ytdl) or `lengthSeconds` (Invidious) and falling back to the format's
own `contentLength` when the duration is unknown.

**Why the walk-down rather than a hard cap.** A single `MAX_BITRATE` constant silently degrades to
"whatever happened to be under the line" and behaves differently on a 30-second clip and a
45-minute set. Walking the ladder means a short track still gets the best format available.

---

## Decision 5 — Streaming means streaming; the byte counter is the guard, and it aborts

**Decision.** The response body is a `ReadableStream` built from the extractor's chunk iterable. The
route never calls `.arrayBuffer()`, `.blob()`, or `.text()` on the upstream body. A running byte
counter **cancels the stream** when it passes the hard ceiling.

**Why the counter is not merely a header.** §21.5's 120 s timeout means a stream can be cut off
mid-flight, and a cut-off stream served as a 200 is a truncated file that looks complete. Cancelling
makes the failure loud, and the truncation detectable.

**What is NOT streaming, and why that is not a contradiction.** §21.5 prescribes the *client* doing
"a Blob, an object URL, and a temporary `<a download>`", which necessarily holds the file in browser
memory before the save dialog. The 4.5 MB limit is a **server** limit and the memory concern in
§21.5's table is server memory (2 GB / 1 vCPU). So: **never buffered in server memory; buffered in
the browser, as the roadmap instructs.** This distinction is called out in the spec requirement
itself, because a reviewer reading "never buffers" without it will correctly flag the client Blob.

---

## Decision 6 — Rate limiting is a dedicated, much tighter budget than the shared one

**Decision.** `guardRequest` still runs first (cheap, and keeps the route inside the existing
`security` requirement). Behind it, `src/server/download/limiter.ts` adds what a shared 60-per-minute
counter cannot express:

- **6 downloads per address per 10 minutes** — one track is ~5 MB of upstream traffic; 60/minute
  would be ~300 MB/minute from one caller.
- **1 concurrent download per address** — a second concurrent request for the same address is
  refused with 429 rather than queued, because a queued request holds a function invocation open.
- **4 concurrent downloads per instance** (one semaphore slot, reused from `server/music/limiter.ts`'s
  primitive), because the upstream is a shared third party and so is the function.

All three are per-process, per-instance, and lost on restart — stated in the module header, exactly
as `throttle.ts` states it, because an over-claimed limiter is worse than none.

---

## Decision 7 — The client state machine is one module, and single-flight is keyed by provider id

**Decision.** `useDownloadTrack()` returns `{ status, error, download }` where `status` is
`idle | busy | done | failed` and `download(track)` returns a promise. A module-level `Map` of
in-flight promises keyed by `track.id` gives single-flight: a second call **returns the same promise**
rather than starting a second transfer, and the busy state reflects the first.

**Why the Map is module-level.** Two `ResultMenu` instances on a page for the same track would
otherwise each fetch the whole file. The map is tiny (one entry per in-flight download, deleted on
settle) and is the same deliberate cross-cutting state `http/throttle.ts` already uses, documented as
such.

**Why the object URL is revoked immediately after the click.** `URL.revokeObjectURL` on the next
tick, not on unmount: the anchor has already been handed to the browser's download machinery, and
holding the blob alive for the lifetime of a component would keep several megabytes resident for no
reason.

**Why `cache: "no-store"` on the fetch.** The route is per-track media with a distinct URL per
request; a cached copy in the HTTP cache is a second copy of the file nobody asked to keep.

---

## Decision 8 — PlayerBar and MiniPlayer get a new overflow menu, because the roadmap's premise is false

**Decision.** Add `components/player/OverflowMenu.tsx` — a minimal, dependency-free overflow trigger
using exactly the semantics `ResultMenu` already establishes (`IconButton` trigger with
`aria-haspopup="menu"` / `aria-expanded`, `role="menu"` items in DOM order as plain buttons so Tab
reaches each, Escape and outside-click close, focus moves to the first item on open and returns to
the trigger on Escape) — and give it the **Download** item.

**Why this is in scope at all.** §21.5 says download actions go on "the PlayerBar/MiniPlayer
overflow". **Neither component has an overflow menu.** The roadmap described a surface as though it
existed; it does not. Creating the smallest surface that carries the approved action is the only
reading that delivers §21.5 rather than silently dropping half of it. Recorded here so nobody later
discovers this as an unrequested addition.

**Why not reuse `ResultMenu` itself.** `ResultMenu` is feature-local by design (`design §8 — no
shared menu primitive until another feature needs one`), takes a `Track`, and owns like/queue/playlist
items. A second use is exactly the condition that design note anticipates, so the *behaviour* is
extracted into the shared component while `ResultMenu` keeps its items.

---

## Decision 9 — The `release-validation` exclusions are narrowed clause by clause, and the diff is published

This is the decision the rest of the milestone is judged against, so it is enumerated exactly.

ROADMAP §2.5 reads:

> 6. **No YouTube audio downloading/extraction.**
>    - Do not implement YouTube-to-MP3.
>    - Do not cache extracted YouTube audio for offline playback.
>    - Do not port Lyrix's `downloadService.ts` or `/api/download/:videoId` behavior.

ROADMAP §18 reverses **the feature**, and §21.5 quotes it: "This milestone reverses a permanent v1
decision." What §18 reverses is therefore clause 3 — Lyrix's specific behaviour, at Lyrix's specific
path — because §21.5 mandates that very path. Clauses 1 and 2 are untouched by §18's bullet list and
by §21.5's non-goals, so **they stay enforced at full strength**.

| §2.5 clause | After M20 | Enforced by |
| --- | --- | --- |
| "Do not implement YouTube-to-MP3" | **STILL PERMANENT** | `no-mp3-faking` detector + the container fixture + absence of any transcoder |
| "Do not cache extracted audio for offline playback" | **STILL PERMANENT** | `no-media-caching` detector + an import-graph assertion that the download client imports no repository |
| "Do not port Lyrix's `downloadService.ts` or `/api/download/:videoId` behaviour" | **REVERSED** by §18 / §21.5 | — (recorded, not deleted) |

§2.7 ("media proxied through the application server") has no explicit clause list. §18 does not
reverse §2.7, and §21.5's non-goals forbid "unrelated media scraping". So §2.7 is **not** dropped —
it is redefined by what this milestone actually does, which is the opposite of what it forbids:

| §2.7 concern | After M20 | Enforced by |
| --- | --- | --- |
| A generic forwarder taking a **caller-supplied URL** | **STILL PERMANENT** — all of §2.7's URL-intake clauses stay verbatim: `searchParams.get("url")` → fetch, `request.json()` → fetch, every `new RegExp`/rename variant | the existing pattern, unchanged |
| Arbitrary **media scraping** of anything but the validated provider id | **STILL PERMANENT** | new clause: the download route contains no URL intake of any kind |
| **Buffering** a fetched body to hand it back | **STILL PERMANENT** | `arrayBuffer()` → `new Response` clause, unchanged; plus a streaming assertion |
| The route itself existing at `/api/download/[videoId]` | **REVERSED** by §18 / §21.5 | — (recorded, not deleted) |

**The path rules.** `FORBIDDEN_SEGMENTS` contains `download`; `MEDIA_ROUTE` contains both `download`
and `dl`. Both must stop rejecting the approved route. They are narrowed to reject the *other* shapes
they were catching — a generic `/api/download` with no validated id, a `/api/dl`, an arbitrary
`/api/stream` — and each retains a violation fixture proving it can still fail, including the
**new** shape `src/app/api/download/route.ts` (no `[videoId]` segment) which the old rule rejected for
the wrong reason and must still reject.

**The two-proofs discipline is not relaxed anywhere.** Every detector that survives keeps its
violating snippets and gains at least one written against the shape M20 makes newly possible.

---

## Decision 10 — Non-goals are enforced by a dedicated suite, not by review

`tests/download-non-goals.test.ts` asserts, over the real sources:

- exactly one API route under `/api/download/`, it is `GET`-only (no `POST`/`PUT`/`DELETE` export);
- no query-parameter or body URL intake anywhere in `src/server/download/**`;
- no `child_process`, no `ffmpeg`, no `spawn`/`exec` — transcoding is absent, not merely unused;
- no `MediaRecorder` / `captureStream` / `AudioContext` — nothing re-records the parked player;
- no percentage-progress state or `progress` event wiring in the download client;
- the download client modules import **no** module under `src/data/repositories` — proved on the real
  import graph, not on a grep of names;
- the set of exported local-data repositories is unchanged from its pinned list — a new offline
  media store fails this;
- the four non-goals §18 explicitly does *not* authorise (ad blocking, accounts, unrelated scraping,
  parked-player change) are covered by the surviving exclusion detectors, which is asserted rather
  than assumed.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| `@distube/ytdl-core` broken on Vercel | Invidious fallback; both failures surface as structured errors; recorded as unverified, never as passing |
| The 120 s proxy timeout cuts a stream | Bounded selection (decision 4) + a hard byte ceiling that cancels the stream (decision 5) |
| The narrowed exclusion suite is weaker than it looks | Every drop enumerated in decision 9 with its citation; every surviving detector re-proven; the diff published in the evidence report |
| A reviewer reads "never buffers" and flags the client Blob | The distinction is written into the requirement itself (decision 5) |
| Browser verification impossible here | `DOWNLOADING.md` states the manual procedure; the change records it as **not run**, and says why |