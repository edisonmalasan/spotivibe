# Tasks — M20 personal-use media downloading

Ordered so that every task is independently verifiable, and so that the highest-risk edit
(task 5, the exclusion narrowing) happens **after** the feature exists and can be swept for real.

## 1. Honest format mapping (pure, no network)

- [ ] 1.1 `src/server/download/container.ts` — `describeAudioFormat({ mimeType, codec })` returning
      `{ container, codec, extension, mime }` for the six known pairs in design decision 2, and
      `unknown` for anything else. Pure; no imports beyond types.
- [ ] 1.2 Parse the codec out of a full `mimeType` string (`audio/webm; codecs="opus"`) rather than
      trusting a caller to have split it.
- [ ] 1.3 Fixture: **Opus-in-WebM is named `.webm` / `audio/webm` and never `.mp3`** — the fixture is
      a realistic ytdl `format` object, not a hand-written pair.
- [ ] 1.4 Fixtures for the other five pairs, plus an unknown container that maps to `unknown`.
- [ ] 1.5 Prove the mapping can be wrong: a test asserting that feeding the Opus-in-WebM fixture to a
      hypothetical `.mp3`-defaulting mapper would fail. (Without this, "never `.mp3`" could pass
      because the mapper is the identity.)

## 2. Bounded format selection (pure)

- [ ] 2.1 `selectAudioFormat(formats, budget)` — filter to recognised containers, sort by bitrate
      descending with `contentLength` ascending as tie-break, walk down to the first that fits.
- [ ] 2.2 No candidate fits → take the lowest bitrate above `MIN_AUDIO_BITRATE`, and report that the
      budget was exceeded (asserted through the returned value, not a log line).
- [ ] 2.3 Nothing above the floor → structured failure, never a silent downgrade to something unusable.
- [ ] 2.4 Estimator branches: `contentLength` when present, `audioBitrate × durationSeconds` when not,
      duration from ytdl's `videoDetails.lengthSeconds` and Invidious's `lengthSeconds`.
- [ ] 2.5 Determinism: same input, same output, and a documented tie-break so equal bitrates are stable.

## 3. Extractors behind one interface

- [ ] 3.1 `src/server/download/sources.ts` — `AudioSource` interface: `resolve(videoId, signal)` →
      `{ url, contentType, codec, audioBitrate, contentLength?, durationSeconds?, source }`, and
      `open(url, signal)` → `ReadableStream<Uint8Array>`.
- [ ] 3.2 `resolveViaYtdl` — dynamic `import("@distube/ytdl-core")`, `getInfo()`, `audioonly` filter,
      mapped through task 1's mapper and selected through task 2's selector.
- [ ] 3.3 `resolveViaInvidious` — bounded instance list, per-attempt timeout, `adaptiveFormats`
      filtered to `audio/*`, same mapping and selection path so the two extractors cannot drift.
- [ ] 3.4 Add `@distube/ytdl-core` to `frontend/package.json` and the lockfile; assert in a test that
      no **client** module imports it.
- [ ] 3.5 Prove the extractor layer is reachable: a test drives `resolve` with a stubbed extractor and
      gets a selection back, so the seam is proven rather than assumed.

## 4. The route

- [ ] 4.1 `src/app/api/download/[videoId]/route.ts` — `export const maxDuration = 300` **stated
      explicitly** (§21.5 requires this rather than relying on the platform default).
- [ ] 4.2 zod validation of the path parameter against `/^[A-Za-z0-9_-]{11}$/`; malformed input is a
      structured 400 and **never reaches an extractor**.
- [ ] 4.3 `guardRequest` first, then the dedicated download limiter (design decision 6): 6 per 10 min
      per address, 1 concurrent per address, 4 per instance.
- [ ] 4.4 Body is a `ReadableStream`; no `.arrayBuffer()` / `.blob()` / `.text()` on the upstream body.
- [ ] 4.5 Hard byte ceiling cancels the stream; `Content-Length` is **not** set (the length is a
      guess and a wrong one is worse than none).
- [ ] 4.6 `request.signal` aborts the extractor; client disconnect aborts the stream.
- [ ] 4.7 `Content-Disposition: attachment; filename="<safe>.webm"` — the filename is sanitised, the
      extension comes from the selected container.
- [ ] 4.8 Structured errors: 400 invalid, 429 throttled, 502 no usable format / both extractors failed,
      499 client disconnected. Each carries a machine-readable `code`.

## 5. Narrow the exclusion detectors to the clauses that survive — **publish the diff**

- [ ] 5.1 Re-read ROADMAP §2.5, §2.7, §18 and §21.5 and confirm design decision 9's table clause by
      clause **before editing the suite**. If the reading is wrong, stop and amend this change.
- [ ] 5.2 Split the `no audio extraction or download` exclusion into `no-mp3-faking` and
      `no-media-caching`, keeping every clause that still holds. Remove only the shapes §18 reversed.
- [ ] 5.3 `no-mp3-faking` violation fixtures: a converter invocation, an `ffmpeg` shell-out, a
      `toFormat("mp3")`-style rename, and the shape that actually motivated the rule — an extractor
      that writes the bytes it selected under a hardcoded `.mp3` name.
- [ ] 5.4 `no-media-caching` violation fixtures: `captureStream`/`MediaRecorder` re-recording, an
      IndexedDB media store write, a Cache API `put` of a media response.
- [ ] 5.5 Redefine §2.7 as "no caller-supplied-URL media proxying and no unrelated scraping", keeping
      the URL-intake clauses verbatim, and add the clause that the download route has no URL intake.
- [ ] 5.6 Narrow `FORBIDDEN_SEGMENTS` and `MEDIA_ROUTE` to still reject `download` routes **without** a
      validated `[videoId]` segment, `/api/dl`, and arbitrary `/api/stream`.
- [ ] 5.7 Update the "the exclusions cover the whole permanent list" guard: it asserted
      `>= 8` exclusions and eight labels. The count changes; the guard must change with it, explicitly,
      naming which permanent clauses each surviving label now covers.
- [ ] 5.8 **Publish the before/after of every edited pattern in `evidence/exclusions-diff.md`**, clause
      by clause, with the ROADMAP citation authorising each removal and the surviving clause each
      remaining pattern still catches.

## 6. The client

- [ ] 6.1 `features/download/saveFile.ts` — Blob → `URL.createObjectURL` → temporary `<a download>` →
      click → `revokeObjectURL`, with the anchor removed from the DOM.
- [ ] 6.2 `features/download/useDownloadTrack.ts` — `idle | busy | done | failed`, single-flight keyed
      by `track.id` returning the same promise for a concurrent call, `cache: "no-store"`.
- [ ] 6.3 `components/player/OverflowMenu.tsx` — the shared overflow semantics lifted from
      `ResultMenu`; `ResultMenu` keeps its own items and delegates the shell.
- [ ] 6.4 PlayerBar and MiniPlayer gain the overflow with a **Download** item; disabled when there is
      no current track.
- [ ] 6.5 Now Playing gains a Download control for the current track.
- [ ] 6.6 `ResultMenu` gains a Download item with its own busy/done/failed state.
- [ ] 6.7 Global-shortcut and menu semantics preserved: the new menu participates in the existing
      `[role="menu"]` subtree rules and does not hijack a shortcut.
- [ ] 6.8 Verify the client bundle is unchanged in substance by this feature: run the M19 budget
      measurement and record the delta.

## 7. Non-goals, enforced

- [ ] 7.1 `tests/download-non-goals.test.ts` — the ten assertions in design decision 10.
- [ ] 7.2 Each non-goal detector proven against a violating snippet **and** against the real sources.

## 8. Documentation

- [ ] 8.1 `frontend/docs/DOWNLOADING.md` — what it does, the manual browser procedure, and an
      explicit statement that it is **not** compliant with YouTube's documented policies (§18).
- [ ] 8.2 Correct `DEPLOYMENT.md`, which currently asserts the application "does not extract,
      download, capture, or proxy audio or video" and "does not proxy media through the application
      server". Both claims become false with this milestone.
- [ ] 8.3 Amend `tests/release-documentation.test.ts`'s assertions over those two sentences, keeping
      the requirement that the document states what it does *not* authorise.
- [ ] 8.4 `ROADMAP.md` §2.5 and §21.5 marked complete, with §21.5's browser-verification limit
      restated as still-not-run.
- [ ] 8.5 `MEMORY.md` lesson for the direct push to `main` (§ recorded in the proposal PR).

## 9. Verification

- [ ] 9.1 `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`
      from the repository root under Node 24 — each actually run, each recorded with its exit code.
- [ ] 9.2 Every new detector proven able to fail: mutate the code, watch the test go red, restore.
- [ ] 9.3 Evidence report with the mutation table, including the two detectors whose narrowing could
      most plausibly have been faked.
- [ ] 9.4 Record explicitly as **not verified**: the 4.5 MB streaming bypass, the 300 s duration, the
      120 s proxy timeout, `@distube/ytdl-core` on a real function, and the browser download.