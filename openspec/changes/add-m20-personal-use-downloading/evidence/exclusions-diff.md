# ROADMAP §2.5 / §2.7 narrowing — clause by clause

Change: `add-m20-personal-use-downloading` (M20)
File narrowed: `frontend/tests/release-exclusions.test.ts`
Suite before: 67 tests, 5 failing
Suite after: **77 tests, 77 passing** (`node node_modules/vitest/vitest.mjs run tests/release-exclusions.test.ts`, Node 24.21.0, exit 0)

This document exists because the M20 design commits to narrowing the exclusion detectors
"clause-by-clause, never deleted", and because a narrowing that is only visible in a diff is a
narrowing nobody reviewed. Every clause removed is listed below with the reason it had to go and
the clause that replaced it. Every clause kept is listed with what it still catches.

---

## 0. The authority for each change

| ROADMAP text | Status in M20 |
|---|---|
| §2.5 clause 1 — "Do not implement YouTube-to-MP3" | **Kept.** Became `no MP3 faking`. |
| §2.5 clause 2 — "Do not cache extracted YouTube audio for offline playback" | **Kept.** Became `no media cached for offline playback`. |
| §2.5 clause 3 — "Do not port Lyrix's `downloadService.ts` or `/api/download/:videoId` behaviour" | **Reversed** by ROADMAP §18 (2026-10-03); §21.5 names the route and the extractor. |
| §2.7 — "Do not proxy media through the application server" | **Kept in full.** One violation fixture added; zero clauses removed. |

Nothing in §18's bullet list of what the reversal does *not* authorise, and nothing in §21.5's
non-goal list, mentions §2.5 clauses 1 or 2. §21.5 restates clause 2 in its own words ("no managed
offline library"). So clauses 1 and 2 were never candidates for deletion — only for being split
out from the bundle they shared with the clause that *was* reversed.

---

## 1. `no audio extraction or download` → two detectors

### 1a. Removed clauses, with the replacement for each

| Clause removed | Why it had to go | What replaced it |
|---|---|---|
| `\bytdl\b\|\bytdl-core\b` | §21.5 names `@distube/ytdl-core` as the primary extractor. A rule forbidding the approved dependency is a bug, not a guard. | `no downloader except the one the roadmap names` — a *manifest* rule that allows exactly that package name and rejects `youtube-dl-exec`, `yt-dlp`, `yt_dlp`, `streamlink`, `audiodl`, and any other spelling in the surviving list. It also asserts the approved package is genuinely present, so the exclusion cannot be satisfied by renaming it. |
| `\badaptiveFormats\b` | This is the documented response field the approved Invidious fallback (`parseInvidiousVideo`) must read. Naming a public API's field is what using an API means. | `streamingData` and `signatureCipher` remain. Those two are what a *hand-rolled* manifest reader cannot avoid and a documented API call does not need, so the hand-rolled extractor is still caught — proven by the fixture `a hand-rolled extractor over the stream manifest`, unchanged text, still firing. |
| `downloadAudio\|downloadTrack\|downloadVideo\|extractAudio\|audioExtract\|extractAudioBuffer` | The approved feature has functions by these names. A rule forbidding the vocabulary of a required feature is a rule that gets switched off within a week of the merge. | Nothing needed — the exclusion is about the *outcome*, and §2.5 clause 1's outcome is a wrong extension, covered below. |
| `audio/(?:mpeg\|mp4\|ogg\|opus\|flac\|wav\|x-m4a\|aac)` | `src/server/download/container.ts` must be able to say "Opus in WebM is `audio/webm`" and "MP3 is `audio/mpeg`". An honest container table cannot be written without these strings. | A **positive** rule: `tests/download-container.test.ts` plus the file-scoped assertion in this suite that no *client-side* file contains a media extension or media-type literal at all. A `.mp3` literal in a route, a helper, or a component still fails; one in the codec table that decides it is now the requirement. **Correction (independent review):** this was first recorded as "a *stronger* rule", which was not true for a client-side `<a download="….mp3">` that builds no object URL — the filename clause only inspected `filename*`, and the download-initiation sweep never saw such a file at all. An extension-bearing `download` attribute is now matched in its own right, with its own fixtures. |
| `\.(?:m4a\|mp3\|opus\|flac\|aac\|webm)\b` and `["'`][^"'`]*\.(?:m4a\|mp3\|opus\|flac\|aac)\b` | Same reason: `container.ts` holds `".webm"`, `".m4a"`, `".mp3"`, `".opus"` as data. | Same as above, plus the new **filename-literal** clause below, which distinguishes an extension that is *derived* (`filename="${name}"`) from one that is *asserted* (`filename="track.mp3"`). The old clauses could not make that distinction; the new one is the only thing that can. |
| `captureStream\|getAudioTracks\|MediaRecorder\|MediaElementAudioSourceNode\|createMediaElementSource` | These are clause 2's evidence, not clause 1's. | **Moved verbatim** into `no media cached for offline playback`. Nothing was lost; the clauses are byte-identical and the fixture `a media buffer written to local storage` is byte-identical and now sits with them. |
| `\.(?:getAudioData)\(` | Same. | Same. |
| `player\.js` | **Added to this table by independent review.** It was removed from `no MP3 faking` and had been published in no removal table at all, which is the exact failure `Requirement 8`'s scenario *"A removed clause is published, not quietly dropped"* exists to prevent. No test caught it, because its own fixture still fires on `player_ias`, `\/base\.js` and `new Function(`. | The clause is now redundant rather than wrong: a hand-rolled player-manifest reader necessarily names `player_ias`, the player base script, or a dynamic `new Function(` for the deciphering routine, and all three survive verbatim. The fixture for it is unchanged and still fires. Recorded here rather than quietly omitted. |

### 1b. Clauses **added** to `no MP3 faking`

| Clause added | What it catches that nothing else caught before |
|---|---|
| `filename\w*\s*[:=][^\n]{0,80}["'`][^"'\n]{1,64}\.(?:m4a\|mp3\|opus\|flac\|aac\|ogg\|wav\|webm)\b` | The lie §2.5 clause 1 exists to forbid, now written as the *approved route* with one thing wrong: `Content-Disposition: attachment; filename="track.mp3"`. Before M20 this was caught incidentally by the blanket extension clause; after M20 it has to be caught by name, and is. Proven by the fixture `the extracted bytes served under a hardcoded .mp3`. |
| `\.(?:toFormat\|convert\|remux\|encode)\w*\s*\(\s*["'\`](?:mp3\|m4a\|aac\|opus\|ogg\|flac)["'\`]` | Implementing transcoding. §21.5 lists transcoding as a non-goal, and the honest mapper's output (`.webm`) is exactly what tempts someone to "fix" it. Proven by the fixture `a transcoder that converts WebM audio to MP3`. |
| `avconv`, `\bsox\b`, `\blame\b` | Sibling real transcoders the original list omitted. Added because the narrowing is the moment to notice the list was incomplete. |
| `\bdecipher\b` (alongside `decipherFunction`) | The bare name is what the hand-rolled extractor's own code uses; the original list had only the suffixed form. |

### 1c. Violation fixtures — one replaced, three added

| Fixture | Change | Reason |
|---|---|---|
| `a named downloader as a dependency` | **Replaced** by `a second, unapproved downloader as a dependency`, using `youtube-dl-exec`. | The old fixture's body was `import ytdl from "ytdl-core"` — the exact package §21.5 approves. It could not stay a violation example. It was not deleted because the detector had lost its grip; it was re-aimed at a different real downloader that remains forbidden, and the clause that caught it (`yt-dlp`) is unchanged. |
| `a hand-rolled extractor over the stream manifest` | **Unchanged.** | It must keep firing after the narrowing, and does. |
| `a scraped media URL written to an audio file` | **Unchanged.** | `writeFile\w*\([^)]*\.m4a` and `googlevideo\.com[^"'`]*\.m4a` both retained. |
| `a downloaded player bundle executed to reverse a signature` | **Unchanged.** | `new\s+Function\s*(` retained. |
| `the extracted bytes served under a hardcoded .mp3` | **Added.** | Newly possible shape: the approved route with a hardcoded name. |
| `a transcoder that converts WebM audio to MP3` | **Added.** | Newly possible shape: converting what the honest mapper calls `.webm`. |
| `a second, unapproved downloader as a dependency` | **Added.** | Replaces the re-aimed fixture above in role. |
| `a media buffer written to local storage` | **Moved** verbatim to §1d. | Its clauses belong to clause 2. |
| a `download` name assembled by concatenation, and one set via `setAttribute` | **Added by the second independent review.** | The arm added for the `audio/` correction covered the imperative assignment and the declarative JSX attribute. `setAttribute("download", …)` has no `=` after the word at all, and `anchor.download = name + ".mp3"` has no literal extension next to `download` — only a `+` and then one, which is the shape a developer reaches for precisely because they think it is more dynamic. A narrowing fix that only patches the shape it was shown is not a fix. |
| a `download` attribute in markup that names an honest extension | **Not narrowed, on purpose.** | Second review flagged that the new arm also matches `<a download="Track.webm">`, which is broader than this exclusion's name, "no MP3 faking". Kept: the extension must come from the server's `Content-Disposition`, because the server is the only place that knows whether the bytes are Opus in WebM or MP3, so a client asserting *any* extension is second-guessing it. Distinguishing "probably lying" from "lying" inside a regex is not a distinction worth having, and the approved shape — `anchor.download = filename`, a variable — matches no arm at all. |

### 1c-bis. The download-initiation sweep, which is a filter and not a detector

A filter is not a detector: **nothing fails when it is too narrow.** That makes it the easiest part of
this suite to get quietly wrong, and two wrong versions existed before this pass:

| Version | What it matched | What it missed / broke |
|---|---|---|
| `/\.download\s*=\|createObjectURL\(/` | `anchor.download = x` | A **declarative** JSX attribute, which has no dot and calls no `createObjectURL`. So *"no `<a download>` points at a remote origin"* was unenforced for the most natural way to write one. |
| `/\bdownload\s*=/` | the above, plus the declarative form | `const download = useCallback(…)` — an ordinary local in the approved hook. Every file it swept in had to classify as a download, so the fix **broke the check it was meant to strengthen**. |
| `/\.\s*download\s*=\|createObjectURL\(\|<[A-Za-z][^>]*\sdownload\s*=\|setAttribute\(…/` | property access, a JSX tag attribute scoped to inside the tag, `setAttribute` | — |

The attribute is now *located* rather than the word. `DOWNLOAD_INITIATION_BEFORE` is kept in the file
so the third version can be **justified** rather than merely asserted: a detector that is quietly
loosened is indistinguishable from one that was always right. A five-row table in the suite pins both
directions, including that the two shapes which must *not* be found are not.

The companion helper `downloadNamesOffered` captures the brace form **whole**, up to the last `}`
before the tag closes. A lazier capture stops at the first `}`, which for
`<a download={\`${title}.mp3\`}>` truncates at the `}` inside `${title}` — the extension sits past the
captured point and the name looks honest. Over-reading rather than under-reading is the right
direction: it may swallow a neighbouring attribute's value, which can only make the check stricter.

### 1d. `no media cached for offline playback` (new entry, appended as index 8)

`EXCLUSIONS` is indexed elsewhere in this suite (`EXCLUSIONS[2]` is reused as a manifest vendor
matcher), so the new entry is **appended**, never inserted, and the suite asserts
`EXCLUSIONS.length >= 9` so the clause count cannot quietly drop back.

| Clause | What it catches |
|---|---|
| `\.getAudioData\s*\(` | A `AudioBuffer` being read back out — only useful if it was captured. |
| `captureStream\s*(` | Re-recording a media element. |
| `getAudioTracks` | Same, via the tracks. |
| `MediaRecorder` | The other re-recording path. |
| `MediaElementAudioSourceNode`, `createMediaElementSource\s*\(` | Tapping the parked player through the Web Audio graph — the exact route to a managed offline library when extraction is unavailable. |
| `createObjectStore\s*\(\s*["'`][^"'`]*(?:media\|audio\|offline\|download)[^"'`]*["'`]` | A media store created with a literal name. |
| `(?:STORE_DEFINITIONS\|STORE_DEFINITION\|createObjectStores?)\b[\s\S]{0,240}?name:\s*["'`][^"'`]*(?:media\|audio\|offline\|download)[^"'`]*["'`]` | **The load-bearing IndexedDB clause.** The application's `src/data/indexeddb/schema.ts` declares stores as `{ name: STORE.likedTracks, options: … }` and creates them via `createObjectStore(definition.name, definition.options)` — so a real store named `"offlineMedia"` puts its quoted string *nowhere* a `createObjectStore("…")` rule looks. Matching only the latter would have been a rule that could not have caught the code it was written for. Found this by running it: the first version of this clause missed its own fixture. |
| `objectStore\s*\(\s*["'`][^"'`]*(?:media\|audio\|offline)[^"'`]*["'`]` | Opening a media store for reading. |
| `caches\.open\s*\(\s*[^)]*(?:media\|audio\|offline\|download)[^)]*\)` | A Cache API bucket named for media. Anchored on `caches.open`, **not** `cache.put`: the service worker's own `await cache.put(request, response.clone())` at `public/sw.js:302–303` is correct code, is required to exist, and must not be reported. The first attempt matched `cache.put` and flagged the worker — a detector that fires on correct code is a detector that gets switched off. |

Fixtures: `a media buffer written to local storage` (moved verbatim), `the parked player
re-recorded through the Web Audio graph` (added), `an IndexedDB store created to hold media`
(added, matches the real `schema.ts` shape), `the download route caching its own response so a
later request replays it` (**added** — the newly possible bad neighbour: a route that streams
media *and keeps it*, which is a managed offline library wearing a download route's clothes).

---

## 2. §2.7 — `no media proxied through the application server`: nothing removed, two clauses repaired

**Nothing was deleted, narrowed or reworded.** Two clauses were *repaired*, which is the opposite
move and is recorded separately for that reason.

### 2a. The two arms that could not match, and the false claim made about them

This section previously read: *"It fires on the existing
`searchParams.get("url|target|src|source|media|href")` → `fetch` clause."*

**That was false.** The clause it named matched nothing. Its group read:

```
(?:searchParams\.get|get\s*\(\s*["'`](?:url|target|src|source|media|href)["'`]\s*\))\s*\)
```

- `searchParams\.get` followed by `\s*\)` demands the literal text `searchParams.get)`. Real code is
  `searchParams.get("url")` — a `(` after `get`, never a `)`. It can only match a syntax error.
- The `.get("url")` alternative **consumes** the closing paren of `.get("url")`, and the group then
  demands a **second** `)`. It fires only on a nested call: `wrapper(get("url"))`.

The fixture passed anyway, via `fetch(…)…new Response(x.body)` — a clause about handing a body back,
which says nothing about where the URL came from. So the document credited the work to a dead clause
and the suite never noticed, because **a dead arm and a fixture that passes for an unrelated reason
look identical from outside: both green.**

The lesson is now structural rather than a note. `violations` entries may declare `caughtBy`, naming
the individual arm that must match, and the suite asserts that arm fires *separately* from asserting
the whole pattern matches. The claim this section used to make is therefore checked rather than
asserted.

### 2b. What the arms are now

Three envelopes, because the binding scenario names three: query parameter, header, request body.

All three detectors' clauses are named `arms`, and §12's computed check requires every one of them
to have at least one fixture that **only it** catches — so a clause cannot be deleted unnoticed. For
§2.7, measured by running the real test module rather than by counting the file:

| Clause | Matches | Fixtures it catches | Caught by nothing else |
| --- | --- | ---: | ---: |
| `QUERY_PARAM_URL` | `searchParams`/`params`/`query`.get(*url*) near a `fetch` | 6 | 1 |
| `HEADER_URL` | `headers`.get(*url*) near a `fetch` | 3 | 1 |
| `BODY_JSON_FETCH` | `request.json()` then a `fetch` within **480** characters | 4 | 1 |

All nine clauses of §2.7 have an exclusive fixture; 19 fixtures in total. The last column is the one
that matters and the first is nearly trivia: the blunt clause below catches 10 of the 19, so "how many
fixtures does this clause match" would have made every precise clause look amply covered.

`URL_KEY` is matched as `*url*`/`*media*`/`*src*`-style rather than as a list of whole names, since
`x-media-url`, `media-source` and `targetUrl` are one idea written three ways.

Both orders are matched, in either direction of the envelope relative to the `fetch`. That is not
belt-and-braces: "envelope, then somewhere a `fetch`" **cannot** see
`fetch(request.headers.get("x-media-url"))`, where the read is an *argument to* the fetch. That is
the single-line evasion, and it is the shape a hurried implementation actually writes. For the two
header shapes, **zero** of this suite's several hundred regex literals matched anything before this
change.

The query envelope's key list **excludes `headers`**. It used to include it, which made
`QUERY_PARAM_URL` a strict superset of `HEADER_URL` — and a strict superset has two consequences,
both fatal: the header clause can never be load-bearing, because any fixture proving it also proves
the superset, and re-filing a header fixture under the query clause is undetectable for the same
reason. The fourth review listed that as one of four ways to defeat the previous `caughtBy`
mechanism.

### 2c. An arm written, measured and deleted

A fourth arm required a URL-ish *field* off the parsed body (`b.mediaUrl`, `body.href`) in addition
to the read. It was removed, and the removal is recorded because deleted arms get re-added later as
improvements. It was wrong twice:

- **Less precise.** The field name is a property of the offending code; the envelope is what makes it
  a violation.
- **Strictly less reach.** With the field required inside the first 240 characters and the `fetch`
  then inside the next 240, it could only see a body of at most 480 characters with the field early
  in it — so a 480-character plain body was out of its reach while the plain arm caught it.

The plain arm's window went from 240 to 480 instead, with a fixture placing **344 characters** between
the end of the read and the `fetch`, measured in the test file rather than in a copy of it. That
fixture is the honest form: a handler that validates and logs its input before acting on it is what
a careful author writes, and a window narrow enough to miss it is not a rule about evasion.

### 2d. A pre-existing false positive, recorded not fixed

`fetch(serverResolvedUrl)` … `new Response(media.body)` is the **approved** M20 shape, and the coarse
`fetch(…)…new Response(x.body)` arm flags it regardless of origin. The real route does not trip it,
but only **incidentally**: its body argument is `holdUntilSettled(payload.stream, …)`, a call rather
than a `.body`, so the arm misses the spelling. The route is safe by spelling, not by design.

Verified per-arm: the coarse arm matches the approved shape; **none** of the three envelope arms do.
That is direct evidence the new arms are aimed at *where the URL came from* — the distinction §2.7
turns on — and narrowing the coarse arm needs that same judgement, now made structurally. Carried to
M21. §12 adds that this clause is also the **only** one catching the most realistic §2.7 violation
in the file — a caller-controlled path segment used to build a media URL, with no envelope read and
no literal host — so deleting it to fix the false positive would have traded one undetected hole
for another.

### 2e. Clause attribution is computed, not declared

§2 above originally credited a fixture to "the existing `searchParams.get(…)` → `fetch` clause",
which was false. §12 records the fourth review's finding that **21 of 33 clauses across three
detectors could be deleted one at a time with the whole exclusion suite green** — including *all
nine* of §2.7's.

The mechanism now in place: every detector's clauses are a named `arms` array, and one test deletes
each clause in turn and requires a fixture to stop matching. It replaced a per-fixture `caughtBy`
field, which the review defeated four ways while the suite stayed green — delete every field, set
them all to `^`, set them all to the whole pattern, or re-file a header fixture under the query
clause. A field an author writes about their own detector is evidence of what the author believed,
not of what the detector does.

**Nothing was removed from §2.7 to achieve this.** Every clause that existed before still exists;
three gained fixtures, and three were *repaired* where they were doing something other than their
name said. `n-parameter` in `no MP3 faking` was the clearest: it matched the token as documented
rather than as it appears in code, so nothing matched it — and the new check found that on its first
run.

---

## 3. Path rules

### 3a. `FORBIDDEN_SEGMENTS` — `download` removed

`download` left the forbidden-segment alternation. ROADMAP §21.5 requires a route at
`src/app/api/download/[videoId]/`, so the capability's name stopped being evidence against
itself. The alternative — leaving `download` and adding an exception — would have turned the
list into a rule with a hole in it, and a hole is where the next exception goes.

Every other segment survives unchanged: `sync`, `synchronise`, `synchronize`, `replicate`,
`mirror`, `proxy`, `stream`, `relay`, `tunnel`, `upload`, `auth`, `login`, `signin`, `sign-in`,
`register`, `account`, `oauth`, `session`, `admin`. The suite now asserts
`FORBIDDEN_SEGMENTS.source` does **not** contain `download`, so the removal is deliberate and
visible, and `relay` was added to the must-reject fixture list so a future edit cannot cost it.

The rule was also **hoisted to module scope**. It was previously duplicated verbatim inside the
two tests that use it, which meant a narrowing applied to half a rule was possible and would
have looked correct in a diff of one test.

### 3b. `MEDIA_ROUTE` — `download` replaced by a named approval

The forbidden alternation `stream|proxy|media|audio|extract|download|dl` lost only `download`.
In its place, the exact path `src/app/api/download/[videoId]/route.ts` is named as approved, and
the rule changed from "no such route" to "**exactly this one route**".

A full path rather than a pattern is deliberate: `/download/\[?videoId\]?` would also allow
`/download/[anything]/`, which is the shape the allowlist exists to reject. Pinning the exact
path means a second download route — batch, playlist, artist, query — is a change this constant
has to be edited to make.

Must-reject fixtures now include, beyond the pre-M20 set: `dl/route.ts`,
`download/route.ts` (the old rule's catch), `download/batch/route.ts` (§21.5's explicit
"no batch or playlist download"), `download/[playlistId]/route.ts`,
`download/[query]/route.ts`, and `download/[videoId]/album/route.ts` — the last proving the
approval covers one file and not a directory.

---

## 4. The download-initiation classification

The old test was `every download the application initiates is a backup, not media`, and it
asserted every initiation's `type:` literal was textual. `src/features/download/saveFile.ts`
correctly breaks that, so the rule became `every download the application initiates is
classified, and named honestly`, with two classes:

- **backup** — the file states a textual media type. Identified by `src/features/backup/DataControls.tsx`.
- **approved media download** — the file reads `content-disposition`. Identified by `src/features/download/saveFile.ts`.

An earlier version of the classifier used an `audio/*`/`video/*` type literal as the media
signal. That is precisely what the approved client cannot do: it never inspects the content type
to pick a name, because a name it picks itself is a name it could pick wrongly. The only thing
that identifies a media download is that it defers to the server.

Two properties survived **unchanged** and are still asserted:

1. No download composes a media extension in the browser — `anchor.download = …` may not carry a
   media extension literal.
2. No `<a download>` points at a remote origin.

Added for the media class: the file must contain **no media extension literal at all**, which is
what makes "the extension has exactly one home, `src/server/download/container.ts`" enforceable
from this suite as well as from `download-container.test.ts`.

Both classes are asserted to be **non-empty**, so neither branch is vacuous, and a second test
names both known initiations so the classifier itself is known to be falsifiable.

### 4b. The removal table is enforced, not merely published

The removal tables above are read by `REMOVED_CLAUSES` in `release-exclusions.test.ts`, and the first
version of that table proved only that **the document named a clause**. It never proved the clause had
left a pattern — so a row could name `ytdl`, `ytdl` could still be sitting in `no MP3 faking`, and
every test would pass. That is the failure `Requirement 8` exists to prevent, one layer up, and the
second independent review found it.

Each entry now also carries a `sample` — a snippet the removed clause used to catch — and a
`survivesIn`:

- `survivesIn: null` — the clause is genuinely gone, and **no** live pattern may catch the sample.
- `survivesIn: "<a detector label>"` — the clause was *moved*, and that detector must still catch it.

The second direction is the point. Without it, "moved, not removed" is aspirational: the clause could
vanish from the whole suite and the publication check would still pass. The labels were **read off a
diagnostic run** over the live patterns rather than reasoned out, and both directions are proven able
to fail — re-adding `\bytdl\b` fails the absence row, and dropping `\.getAudioData\s*\(` fails the
moved row.

One fixture was corrected while proving the second direction. `getAudioData`'s sample was
`const { getAudioData } = el.captureStream();`, which trips the neighbouring `captureStream` arm, so
the row would have kept passing after `getAudioData` itself had been dropped. **A sample that
exercises two clauses at once cannot tell you which one is missing** — the same mistake as
calibrating a detector on one observed failure.

---

## 5. The dependency manifest

| Change | Reason |
|---|---|
| `@distube/ytdl-core` added to the pinned runtime-dependency list. | §21.5 names it. It is server-only by construction (a dynamic `import()` inside a route handler), so it never enters a client chunk; `download-non-goals.test.ts` asserts that. |
| A new `APPROVED_EXCLUSION_DEPENDENCIES` table records the package and the ROADMAP clause that approved it, and a guard test rejects an entry with no `ROADMAP §n[.n]` citation. | A bare allowlist would let anyone approve a dependency by typing its name. |
| The single test `declares no database, auth, downloader, or ad-blocking dependency` was **split into three**. | It reused `EXCLUSIONS[2]`, the *cloud user database* detector, which has never contained a downloader name — so only the first of the four things its name promised was ever enforced. M20 is the moment that became dangerous rather than merely untidy, because a downloader is now legitimately present and the unsound check would have admitted any *second* one silently. |
| A new `declares no downloader except the one the roadmap names` test, with its own vocabulary and its own must-fail fixtures. | Closes the gap above. It also asserts the approved package *is* present, so the rule cannot be satisfied by a rename. |

---

## 6. What this narrowing does **not** claim

- It does not claim the suite was weakened. Suite size went 67 → 77 tests; every violation
  fixture still fires against the pattern it belongs to, and every pattern still fires against
  the real application sources.
- It does not claim the new detectors are complete. They are clause-shaped, and a clause-shaped
  detector can always be defeated by writing code in a shape nobody enumerated. The mitigations
  are the two-proofs discipline (every clause has a fixture that must fire) and the
  file-scoped positive rule that confines media extension literals to one file.
- It does not claim ROADMAP §2.5 clause 3 is still enforced anywhere. It is not. That reversal is
  §18's, dated 2026-10-03, and the evidence for it is in
  `openspec/changes/archive/2026-10-03-m20-personal-use-downloading.md` — not here.
- `npm audit` currently reports **5 high**, from
  `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` — a
  dev-only lint chain, not from `@distube/ytdl-core`. Recorded rather than papered over; the
  earlier "0 vulnerabilities" figure in `AGENTS.md` was true as of 2026-10-01.