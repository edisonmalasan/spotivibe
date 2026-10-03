# M20 verification evidence

Change: `add-m20-personal-use-downloading`. Recorded 2026-10-03, Windows, Node 24.21.0.

Every number below comes from a command that was actually run in this change's working tree. Where
a check was **not** possible, it is listed under [Not verified](#not-verified) and is not counted as
anything.

---

## 1. The gates

Run from the repository root, under Node 24, with the root proxy scripts.

| Check | Exit code | Result |
| --- | --- | --- |
| `npm run lint` | `0` | clean, no errors and no warnings |
| `npm run format:check` | `0` | all matched files use Prettier code style |
| `npm run typecheck` | `0` | strict `tsc --noEmit` after `next typegen` |
| `npm test` | `0` | **177 files, 3114 tests passed** (baseline before M20: 167 files / 2829 tests) |
| `npm run build` | `0` | compiled in 4.7 s; `ƒ /api/download/[videoId]` present in the route table |
| `openspec validate add-m20-personal-use-downloading --strict` | `0` | `Change 'add-m20-personal-use-downloading' is valid` |
| `openspec validate --specs --strict` | `0` | `Totals: 25 passed, 0 failed (25 items)` |

Suite sizes, each run on its own, **after** the independent review of §9: `download-container` 21,
`download-select-format` 27, `download-sources` 35, `download-limiter` 14, `download-service` 24,
`download-route` 24, `download-save-file` 23, `download-client` 40, `download-non-goals` 22,
`downloading-documentation` 27, `release-exclusions` 89.

## 2. Mutation table — every new detector, proven able to fail

A detector nobody has watched fail is a comment. Each row below is a real edit to the shipped code,
a real red run, and a real restore. Files were restored with `git checkout --` or with node writing
explicit UTF-8; **not** through PowerShell text commands, for the reason in §5.

| # | Mutation | Expected to fail | Observed |
| --- | --- | --- | --- |
| 1 | `DOWNLOAD_BUDGET_BYTES` 20 MiB → 40 MiB | the budget constant, the ladder, the doc test | `download-select-format` **4 failed**, `downloading-documentation` **1 failed** (5 total) |
| 2 | `container.ts`: `webm` + `opus`/vorbis named `.mp3` | format honesty | `download-container` **5 failed**, `download-service` **1 failed** (6 total), including "answers `.mp3` only for the pairs that really are MP3" and "names the file for what it contains" |
| 3 | `service.ts`: `new ReadableStream` → a buffered `Buffer.from(await …)` | the streaming claim | `download-non-goals` **1 failed** — "service bounds the stream: expected … to match `/new\s+ReadableStream</`". The file also failed to parse, so the type-level damage is visible too |
| 4 | `service.ts`: add `Content-Length: "1"` to the download headers | the no-`Content-Length` rule | `download-service` **1 failed** — "never sends a `Content-Length`" |

Mutation 2 is the one that matters most: it is precisely the lie ROADMAP §21.5 forbids, and it is
caught by four separate assertions plus the service-level header test.

### The non-goal detectors

All seven detectors in `tests/download-non-goals.test.ts` are proven against a **violating snippet**
in the file itself (`NON_GOALS[].violation.code`), so "the detector missed X" fails if a pattern stops
matching its own proof. Those 7 assertions passed in every run above.

Each detector was **also** run against the real source tree, which is how the over-broad first drafts
were found. That pass found five false positives, all fixed by narrowing a clause rather than
deleting it. §4 records each.

## 3. The bundle cost, measured

`node scripts/measure-client-bundle.mjs`, against the build produced by `npm run build` above.

| Measurement | M19's record | After M20 | Delta |
| --- | ---: | ---: | ---: |
| Client JS, total gzipped | 384,831 B | 387,992 B | **+3,161 B** |
| Largest single chunk, gzipped | 96,644 B | 96,667 B | +23 B |
| Emitted chunks | 24 | 25 | +1 |
| `/` first load, gzipped | 227,266 B (12 chunks) | 230,555 B (13 chunks) | +3,289 B |

**No dependency was added to the client.** `@distube/ytdl-core@4.16.12` is reached only through a
dynamic `import()` inside `src/server/download/sources.ts`, a server module; `download-non-goals`
asserts both that and that nothing outside `src/server/` names the package. The 3,161 bytes are all
first-party source.

`PRE_M19_CLIENT_BUDGET` preserves M19's figures as their own exported constant and
`tests/motion-budget.test.ts` asserts them on their own terms, so the record was not overwritten.

## 4. Detector narrowing — what was removed, kept, and why

Recorded clause by clause. No clause was deleted; each was narrowed to the thing it was actually
for, and each narrowing was because the *narrower* version still passes its violating snippet.

| Detector | First draft matched | False positive on | Narrowed to | Still fails on |
| --- | --- | --- | --- | --- |
| auth | `login`, `sign-in`, `createSession`, `refreshToken`, `oauth` as bare words | 7 of our own files: an IndexedDB session **restore** repository, a debounce counter in `historyStore` named `refreshToken`, three doc comments stating there is no sign-in, a comment about "unauthenticated GET" | executable positions only — auth SDK import specifiers, auth **calls**, `access_token`-shaped literals, `Authorization: Bearer`, credential fields | a route importing `next-auth` and calling `createSession({ email, password })` |
| ad blocking | `ad-container` case-**insensitive**, `\bblockAds?\b`, `\.ad\b` | `src/server/download/service.ts`, on the substring `ad-Container` inside `X-Spotivibe-Download-Container` | case-**sensitive** tokens that appear verbatim in a real filter list or host pattern | `'@@||doubleclick.net^'` |
| local-file playback | any `type="file"` | `features/backup/DataControls.tsx` — the **versioned JSON backup importer**, an M2 requirement; and `file://` in a `styles/motionTokens.ts` doc comment | a file input scoped to **audio**, plus the filesystem picker APIs and `blob:null/` | `<input type="file" accept="audio/*" multiple />` |
| percentage progress | any `Math.round(x * 100)`, any `aria-valuenow` | `components/player/ProgressSlider.tsx`, a **playback scrubber** whose percentage is a true position within a known duration — removing it would be a regression | download-scoped vocabulary only | `Math.round((loaded / contentLength) * 100)` |
| streaming claim | read the raw source | `service.ts` **documents in a comment** the three calls (`arrayBuffer`/`blob`/`text`) it forbids | a `codeOnly()` helper that strips comments and string literals, used for that one assertion only | a real `.arrayBuffer()` call in code |

The last row is the one worth arguing about. Comments are **not** exempt from the non-goal detectors —
a comment naming `ffmpeg` beside an absent import is a stronger hint than the import would be, and a
comment is not an exemption from a policy. The exemption is applied to exactly one assertion, and the
reason is stated in the helper's own doc comment: the module's explanation of why it does not make a
call would otherwise be the thing that fails.

Two other harness defects surfaced and were fixed, because both made a rule report a false result:

- `architecture.test.ts`'s route walker read one directory deep, so `api/download/[videoId]/route.ts`
  was reported as `api/download/route.ts` and then failed on a missing file. **A new route broke a
  rule rather than the rule checking it.** Now recursive, with the relative path in `name`.
- `architecture.test.ts`'s "first statement" window started at `export async function GET` and took
  three lines. The download route's signature spans three lines and its `context` parameter contains
  an object literal, so a route that *did* guard first looked unguarded. Now measured from the `{`
  that follows the parameter list, with comments stripped — the rule is about what the handler does.

`motion-scope`/`motion-vocabulary` needed a `delegatesTo` field rather than a weakened rule: M20
lifted the menu shell out of `ResultMenu`, so `ResultMenu` no longer declares its rows' feedback
itself. Deleting its allowance would have quietly dropped a named surface from the scope rule, and
declaring a class it does not apply would be motion with no behaviour. The delegation target must
itself be an allowance **and** must carry the marker — asserted, and the assertion has its own
proof.

## 5. A process failure worth recording

Three source files (`container.ts`, `selectFormat.ts`, `service.ts`) were corrupted during the
mutation runs: PowerShell's `Set-Content -Encoding utf8` re-encoded already-UTF-8 bytes as
windows-1252, so an em dash became the three-character sequence `â` + `€` + `”` and an arrow became
five such sequences. `service.ts` needed three decode rounds, not one.

(This paragraph originally quoted the corrupted bytes verbatim. It does not any more, because a file
that contains mojibake *as an example of mojibake* is indistinguishable from a file that contains
it by accident — and `tests/encoding-integrity.test.ts` scans the tree for exactly that pattern.)

This is the concrete demonstration of the rule in `MEMORY.md`: **never round-trip a repository file
through a PowerShell text command.** It was repaired with node and an explicit cp1252→UTF-8 decode,
verified by asserting that no file under `src/`, `tests/`, `scripts/`, `docs/` or `openspec/` contains
a UTF-8 BOM, a mojibake run, or a stray control character (result: `clean` across 695 files), and
then re-run through every gate. `lint`, `format:check`, `typecheck` and the full `npm test` were all
re-run after the repair — 177 files / 3114 tests passed, `build` exit `0`.

That check is now a **test** rather than a one-off command. A UTF-8 BOM or a mojibake run is
invisible in review and harmless to every compiler, so without an assertion it survives to `main` and
turns a diff into unreadable noise. `tests/encoding-integrity.test.ts` fails on all three: BOM,
mojibake, and a C0 control character — the last of which is what made a test fixture read as
**binary** to every tool in the chain.

The repair used a cp1252 **encoder**, derived by inverting Node's cp1252 decoder, because `Buffer`
has no cp1252 encoder and decoding in the wrong direction maps `0xAC` to `¬` rather than recovering
the original byte.

## 6. Not verified

None of the following was observed. Each is a documented constraint the implementation is designed
against, recorded in `frontend/docs/DOWNLOADING.md` §8 and in ROADMAP §21.5.

**Browser verification was impossible.** The only installed browser is Edge, there is no automation
dependency in this repository, and both `https://spotivibe-web.vercel.app` and every Vercel Preview
deployment sit behind Deployment Protection — `302` to `vercel.com/sso-api`, then
`DEPLOYMENT_NOT_FOUND`. Deployment Protection was not circumvented.

| Item | Status |
| --- | --- |
| The 4.5 MB streaming bypass | **not verified** — a documented Vercel behaviour |
| The 300 s function duration | **not verified** — `maxDuration = 300` is stated, never observed |
| The 120 s proxied request timeout | **not verified** |
| `@distube/ytdl-core` on a real function | **not verified** — pure JavaScript, no native binary, compatible in principle |
| A real download in a real browser | **not verified** — no file has landed on a disk here |
| Invidious fallback availability | **not verified** — best-effort by nature, surfaced as a failure state |
| `MEDIA_HOST_SUFFIXES` covers what instances actually return | **not verified** — the fixture hosts are the CDN shapes that were reasoned about, never an observed response from a live instance |
| The repaired `invidious-search.json` against a live instance | **not verified** — the repair is provably the inverse of the corruption, but the original capture was never re-fetched, so the restored characters are unconfirmed against the real service |

The last two were added by the second review. The first is the honest cost of keeping
`.googleusercontent.com` in the suffix list rather than narrowing it on the strength of no
observation; the second follows from the fixture repair in §10.

### The arithmetic finding

`DOWNLOAD_BUDGET_BYTES` is 20 MiB. At realistic audio-only bitrates the transfer is slow, and the
whole range has to be stated rather than its most flattering end:

| Bitrate | Throughput | 20 MiB takes | vs the 120 s proxy timeout |
| --- | ---: | ---: | --- |
| 160 kbit/s (fast end) | ~20 kB/s | **~17 minutes** | ~9× over |
| 50 kbit/s (slow end) | ~6 kB/s | **~56 minutes** | ~28× over |

ROADMAP §21.5 records the proxied request timeout as 120 s. **The budget does not fit inside the
timeout at either end.** A short track finishes comfortably; a long one at the top of the ladder
cannot. An earlier version of this document quoted only the 17-minute figure, which is the *fast*
end — it read as though the budget were borderline when it is in fact out of reach by a wide margin
either way.

The 50–160 kbit/s range is an assumption about link speed, not a measurement taken on this
deployment. No transfer has been observed here, so the ratio is a design argument, not an
observation.

The design bets that `maxDuration = 300` is the operative ceiling rather than the 120 s proxy
timeout. That bet is unverified and could be wrong. Neither remedy — lowering the budget, nor
raising it and relying on the 300 s duration — has been applied, because choosing without observing
the real timeout would be a guess dressed as a decision. It is recorded here and in
`DOWNLOADING.md` §8 so the next person sees it before changing the constant.

## 7. `npm audit`

`npm audit` reports **5 high** severity findings, all in the **dev-only lint chain**:
`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`. **None is in
`@distube/ytdl-core`**, and none reaches a shipped function.

`AGENTS.md` previously recorded "0 vulnerabilities reported". That was true as of the 2026-10-01
install and is now stale. The finding is recorded rather than papered over: no dependency was added
or upgraded to address it, because a lint-chain advisory is not fixed by changing the application's
runtime dependencies, and doing so would be an unrequested change under a milestone whose scope is
downloading.

## 8. Two defects found by writing the tests

Both were in the implementation, both are now fixed, and both are covered:

1. `filenameFrom` used a single combined regex that took the ASCII `filename=` and discarded
   `filename*=`. **Every accented title would have been mangled.** It is now an ordered array of
   three RFC 5987 patterns, `filename*=` first. Found by `download-save-file.test.ts`, not by reading
   the code.
2. `DownloadView.download()` accepted a track argument and ignored it, which would have let a caller
   download the wrong track. It is now parameterless and bound to its own track. Found by
   `download-client.test.tsx`.

`radio-entry-points.test.tsx` also failed for a real reason rather than a flake: `DownloadIconButton`
claimed `role="status"`, and Now Playing's radio alert already owns that page-level role. The
component now uses a bare polite live region. Two `role="status"` regions on one page tells assistive
technology there are two surface-level states when there is one state and one control-level message.

## 9. Independent review

The Apply stage was reviewed before merge, read-only, against `main...HEAD`. It returned
**`REJECT`** with three CRITICAL and nine WARNING findings. All three CRITICALs were real defects,
two of them serious, and none of them would have been caught by the gates above — every gate was
green while the feature shipped an SSRF and a limiter that bounded nothing.

### CRITICAL A — the MP3-honesty detector had a hole

The reviewer did not infer this; it **proved** it by running a violating snippet through the old and
new regexes side by side:

```
<a download="Never Gonna Give You Up.mp3" href={streamUrl}>Save</a>
```

- pre-narrowing pattern: **true** (caught)
- shipped pattern: **false** (not caught)

The compensating "download initiation" sweep does not save it: that classifier only fires on files
mentioning `.download =` or `createObjectURL(`, and a *declarative JSX attribute* contains neither
token, so such a file never reached it.

Worse, `exclusions-diff.md` claimed the removed blanket-extension clauses had been "replaced by a
stronger, positive rule". **That claim was false**, and it is the kind of claim that survives
because nobody re-runs the old pattern against the new shape.

Fixed: an extension-bearing `download` attribute (JSX `{…}` form and imperative `= "…"` form) is
now matched in its own right, with two fixtures — one per form, so the arm cannot quietly narrow to
one. The false claim is corrected in place rather than deleted.

### CRITICAL B — the limiter bounded the wrong thing

```ts
try { const payload = await resolveTrackDownload(...); return new Response(payload.stream, {...}); }
finally { permit.release(); }   // ← runs when GET returns; payload.stream is still streaming
```

A `Response` is constructed *before* its body is read. The `finally` therefore released the slot
while the upstream transfer had barely started, so:

- "1 concurrent download per address" bounded concurrent **resolutions**, not downloads;
- `DOWNLOAD_CONCURRENCY_LIMIT = 4` bounded 4 metadata lookups, after which 4 multi-megabyte bodies
  streamed concurrently — the exact opposite of what `limiter.ts` documents about itself.

The test that should have caught it was titled *"refuses a second download from the same address
through the real limiter"* and asserted that the second request **succeeded with a 200**. A test
asserting the negation of its own name is worse than no test: it read as coverage of the concurrency
requirement while establishing the reverse.

Fixed: `holdUntilSettled` in `service.ts` hands the permit to the body and releases on close, on
error, and on cancellation, exactly once. Five tests cover it directly, including "does not settle
while the body is still open". Two route tests now assert the real behaviour — the second concurrent
request is refused with `already_downloading` while the first is mid-body, and a client that walks
away cancels the upstream and frees the slot. The test that asserted the defect was rewritten, and
the rewrite says in its own comment that it was a ratchet holding the defect in place.

### CRITICAL C — unvalidated SSRF via the public Invidious fallback

`sources.ts` fetched whatever media URL the instance's own JSON returned: no scheme check, no host
allowlist, `redirect: "follow"`, body piped to an unauthenticated caller.

The instance list being a bundled constant bounds *who configures it*, not *what an instance replies
with*. One hostile or compromised public instance could aim the function at `169.254.169.254`,
loopback, or an internal service, and stream the body straight back.

Fixed: `classifyMediaUrl` — a pure, exported, unit-tested function — requires HTTPS (with one
deliberate same-origin exception for a locally configured plain-HTTP instance), requires a known
media host or the instance's own host, and refuses credentials in the URL. The fetch uses
`redirect: "manual"`, because a permitted host answering with a 302 to a forbidden one is how an
allowlist gets walked around.

Tested against loopback, the metadata service, a private-network host, plain HTTP, an
`evil-googlevideo.com.attacker.test` lookalike, and credentials-in-URL. **The existing fixtures had
to change**: they used `cdn.example` as a media host, which the control correctly refuses. A security
control that passes against fixtures written before it existed proves nothing.

### WARNINGs, all addressed

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | `player.js` was removed from `no MP3 faking` and published in **no** removal table — the exact failure Requirement 8's scenario exists to prevent. No test caught it, because its fixture still fires on `player_ias`, `\/base\.js` and `new Function(`. | Published, and made structural: `REMOVED_CLAUSES` in `release-exclusions.test.ts` lists every removed clause as a fingerprint and asserts each appears in the diff. A future quiet drop now fails. |
| 2 | A raw NUL byte in `download-container.test.ts`, making the file read as **binary** to tooling. | Replaced with a `\u0000` escape. Same test input, text file. |
| 3 | Three citations of `tests/download-format-honesty.test.ts`, a file that **never existed**. | Corrected to `download-container.test.ts`, and a new assertion resolves every `.test.ts` the diff cites. |
| 4 | `as unknown as` erases the ytdl typings at `sources.ts:177`. | **Accepted, not changed.** The cast is honest about what is known — this integration has never run on a real function — and removing it would require inventing a type for an API that has not been observed. Recorded in §6 as unverified. |
| 5 | `download-client` recorded as 34; it is 35. | All counts re-measured and re-recorded. |
| 6 | "20 MiB is about 17 minutes" quotes only the **fast** end of the bitrate range. | Both ends stated, in a table, with the 50 kbit/s figure (~56 minutes) added and the ratio to the 120 s timeout given for each. The range is labelled an assumption, not a measurement. |
| 7 | Requirement 7's "every surface offers the action" was only asserted for the search menu — `PlayerBar`, `MiniPlayer` and Now Playing mounted the control with nothing checking. | Four surfaces asserted to mount the control **bound to the current track**, plus a complement test that a fifth surface fails. |
| 8 | `evictIfFull()` discarded the oldest entry even mid-download, so a live window's `release()` could no longer decrement its counter. | Now evicts the oldest **idle** window. Test proven able to fail: with the live window created **first** (so it is the oldest), the old logic fails it. That ordering is the whole test — created last, the old code would evict an idle entry and the test would pass against the bug. |
| 9 | `requestToAddress` trusts caller-supplied `x-forwarded-for`; now it keys a far more expensive limiter. | Pre-existing M14 behaviour, **not changed here**. Recorded so M21 can weigh it against the higher-value key it now protects. |

### A new flake, found and not fixed here

`tests/discover-view.test.tsx > "shows skeletons"` failed once in a full run during this pass and
passed in isolation (22/22) and on the next full run (178 files / 3119 tests). It asserts that
skeleton placeholders are gone after data arrives, so it is timing-sensitive under load. Nothing in
this change touches that surface.

It is recorded rather than fixed because it is a **pre-existing** load-dependent flake, and fixing
another feature's test timing inside the downloading milestone would be scope creep against a change
whose reviewed defects were substantial enough. It joins the flake list for **M21**, alongside
`tests/podcast-playback-history.test.ts` and `tests/settings-ui.test.tsx`. The full-suite result
reported above is from the run that passed, and this paragraph is the honest reason a reader should
not treat a green `npm test` as proof that no test in this repository is timing-sensitive.

### A detector loosened by the fix, then tightened again

Correcting CRITICAL B changed the route, which broke `download-non-goals`' positive half
(`new Response(payload.stream`). The pattern was relaxed to accept the `holdUntilSettled` wrapper —
and then a probe of the relaxed pattern against four violating shapes found that
`new Response(payload.stream).text()` **still matched**, because the inner constructor satisfies it.

A required trailing comma fixes it: `payload.stream` must be an *argument* of the outermost
`Response`. The probe now reports `ok` on all five cases — the real route and the approved
pass-through match; buffered, array-collected, and text-decoded do not. This is recorded because the
sequence is the lesson: loosening a detector to accommodate a fix is exactly when it stops being a
detector, and only probing violating shapes revealed it.

## 10. Second independent review

An independent read-only reviewer re-examined the branch after the three CRITICALs above were fixed.
Verdict: **REJECT** — the three original CRITICALs were confirmed fixed, but the fix for CRITICAL B had
introduced a new one.

### CRITICAL D — an unauthenticated remote permit leak that wedges the limiter

Found by *reviewing the fix*, not by any test. All four of these had to be true at once:

1. `route.ts` set `handedOff = true` on the line **before** `new Response(...)`.
2. `new Response(body, { headers })` coerces header values to `ByteString` and **throws** above U+00FF.
3. So a construction failure reached the `finally` with a permit already marked handed off, and
   released nothing.
4. `permit.release()` is the only path back to the instance semaphore slot
   (`limiter.ts:169` → `releaseSlot()`), and `resetDownloadLimiter()` is test-only
   (`limiter.ts:180-183`). `DOWNLOAD_CONCURRENCY_LIMIT` is 4.

Four such requests therefore consumed every slot on the instance and disabled downloading for **every**
address, until Vercel recycled it. The per-address `active` counter does self-heal when the 10-minute
window expires, so the per-address limit is not the bound that matters — the semaphore is.

**The trigger was real, and it was a 500 on every download for every listener whose track title was
not Latin-1.** `downloadStem` keeps every `\p{L}`, which is Unicode-wide, so a Greek, Cyrillic, CJK or
Arabic title produced a stem such as `Ωmega-Track`; that was correct in the `filename*` half and was
being emitted **raw** in the `filename` half, which RFC 6266 defines as latin1.

Nothing caught it because the fixture every existing test used, `Sigur Rós`, happens to be Latin-1:
NFKD already decomposes `ó` to `o` plus a combining mark, and the mark is stripped. The suite tested
one script and the bug lived in the other three.

Both halves are fixed, and separately:

| Half | Fix | Test | Proven able to fail |
| --- | --- | --- | --- |
| The trigger | `asciiDispositionFilename(stem, extension)` — decompose, drop combining marks, drop what has no ASCII spelling, re-append the extension last. `filename*` still carries the true title. | 6 new cases in `download-container.test.ts`, including `new Response(null, { headers })` through the real constructor | A probe runs the **old** header shape through the same constructor: it throws for all four non-Latin-1 titles and does not throw for `Sigur Rós` |
| The window | The `Response` is built inside its own `try`; `handedOff = true` is set only after it returns. A construction failure releases and rethrows. | `releases the permit even when the response body cannot be constructed`, injecting an unconstructable header directly so it does not rely on the trigger being fixed | Restoring the previous ordering fails it: `expected false to be true` |

Two details worth keeping:

- The route test injects an **unconstructable header directly**. It therefore still closes the window
  if some *other* module ever produces a bad header — it does not test the trigger, it tests the
  window.
- The extension is re-appended **after** stripping, or a fully non-Latin title yields `.webm`, which
  every browser shows as hidden. That is the same failure the dash-trimming inside `downloadStem`
  exists to prevent, reached by a different route.

The Latin-1 control in the probe is asserted, not just observed: it is the reason the original suite
missed this, so a probe that stopped distinguishing it would be a worse probe.

### WARNINGs from the second review

| # | Finding | Resolution |
| --- | --- | --- |
| 1 | The new `download`-shaped arm also matches `<a download="Track.webm">` — honest extensions — so it is broader than the exclusion's name, "no MP3 faking". | **Kept, and the divergence documented.** The rule is right: the extension must come from the server's `Content-Disposition`, so a client asserting *any* extension is second-guessing it. The approved shape (`anchor.download = filename`) matches no arm at all. Narrowing it to "probably lying" versus "lying" inside a regex is not a distinction worth having. |
| 2 | The arm missed `el.setAttribute("download", "Track.mp3")` and `anchor.download = name + ".mp3"`. | Two arms added, each with its own fixture. **A narrowing fix that only patches the shape it was shown is not a fix.** |
| 3 | `REMOVED_CLAUSES` was decorative: it proved the *document* named a clause, never that the clause left the pattern. A row could name a clause, the clause could still be in `no MP3 faking`, and every test would pass — the exact failure it exists to prevent, one layer up. | Each entry now carries a `sample` and a `survivesIn`. `null` → no live pattern may catch the sample. A label → that detector still must. The second direction is what makes "moved, not removed" true rather than aspirational. `survivesIn` was **read off a diagnostic run**, not reasoned out. Both directions proven able to fail: re-adding `\bytdl\b` fails the absence row; dropping `\.getAudioData\s*\(` fails the moved row. |
| 4 | The mojibake detector searched the UTF-8 **lead**-byte range (0xC0–0xFF) instead of the **continuation** range, so it caught a mangled em dash — the one failure this repository had actually suffered — and missed mangled Cyrillic, mangled CJK, and every other form that does not happen to contain a mangled quotation mark. | Rewritten as lead byte (0xC2–0xF4) followed by what a windows-1252 continuation byte becomes, which is two ranges because 0x80–0x9F map to typographic punctuation. Calibration pinned by 8 must-catch and 11 must-not-match cases. |
| 5 | The `\u00C2[\s]` arm flagged `Â ngela` — and `Â` is a real Portuguese and French letter, so that is a real name. | Alternative dropped. `aÂ b` and `Â ngela` are indistinguishable to any rule; chasing the low-value catch at the cost of a false positive on a real name trades a detector that gets switched off for one that does not. |
| 6 | The locator accepted the instance's host on a **different port** on the HTTPS branch, while the plain-HTTP branch compared ports. | Now one rule, `sameOrigin`, on both branches. The exposure was small — an operator-chosen hostname, unreachable to loopback or the metadata service — but the asymmetry was unintentional, and an allowlist whose two branches disagree about what "the same instance" means is one nobody can reason about. |
| 7 | The download-initiation sweep filter `/\.download\s*=|createObjectURL\(/` requires a dot, so a **declarative** JSX attribute never entered the set and property 2 was unenforced for the most natural way to write one. | Fixed — twice. `\bdownload\s*=` over-corrected into `const download = useCallback(…)`, an ordinary local in the approved hook, and **broke the check it was meant to strengthen**. The attribute is now *located*, not the word. `DOWNLOAD_INITIATION_BEFORE` is kept in the file so the change can be justified rather than asserted. |
| 8 | `downloadNamesOffered` truncated `<a download={\`${title}.mp3\`}>` at the first `}`, which is the one inside `${title}`, so the extension sat past the captured point and the name looked honest. | The brace form is captured whole, up to the last `}` before the tag closes. Over-reading is the right direction: it can only make the check stricter. |
| 9 | `.googleusercontent.com` is a broader surface than the evidence requires. | **Kept, deliberately.** Not attacker-registrable — Google controls the parent — so not a live hole. Narrowing it to a specific subdomain on the strength of no observation would risk disabling a fallback that has never been seen working, which is the worse failure. Recorded rather than guessed at. |
| 10 | Fixture hosts were re-aimed at real CDN hosts. | Recorded in §9's earlier pass. A security control proven only against fixtures written before it existed proves nothing. |

### The self-reference trap, three times in one file

Widening the mojibake detector immediately flagged **eleven lines** — all of them its own calibration
fixtures. The pattern literal contained the bytes it searched for; then the fixtures did; then the
comment explaining the fixtures did.

That is a detector matching its own pattern, which is a self-inflicted false positive, and the
available "fix" — excluding the file from the scan — is exactly the carve-out that turns a check into
decoration. Every one was fixed by construction instead: the pattern is built from `\uXXXX` escapes,
and the fixtures are produced by **actually performing** the corruption
(`Buffer.from(text, "utf8").toString("latin1")`), which is self-documenting and cannot drift from what
the damage really looks like.

### A corrupted provider fixture, found by the widened detector

`tests/fixtures/providers/invidious-search.json` — captured evidence of a real `GET
/invidious.f5.si/api/v1/search` — turned out to be mojibake-corrupted. Three of its titles were damaged: a
channel name with a mangled en dash, a Korean-language video title, and a channel name with a
mangled geometric character. The old detector could not see any of it, because none of it happens
to contain the mangled sequence the old pattern was fitted to.

Repaired rather than excepted, on three grounds, each checked before anything was written:

1. **The inverse is deterministic, not a reconstruction.** The damage was one latin1 round trip, and
   re-mangling the repair reproduces the damaged bytes **byte for byte**. There is only one possible
   preimage, so nothing was guessed at.
2. **Nothing depended on it.** `tests/providers/invidious.test.ts` asserts exactly one title and it is
   pure ASCII.
3. **An exception would have been worse.** A detector that has to be told about the file it found is
   not doing its job.

The pinned byte size in `tests/fixtures/providers/README.md` moved 48,872 → 48,839, which is how a
reader can tell a capture was replaced.

This is **outside M20's feature scope** and recorded as such. Corrupted provider evidence is not
evidence: the fixture's value is that it is what a real instance actually returned, and mangled
titles are not what it returned.

### A corrupted probe, and what it proved

The first version of the ByteString probe was written with the `write` tool and then piped through
`Set-Content -Encoding utf8` to patch an import path. That re-encoded the titles as windows-1252
mojibake. Mojibake happens to be **Latin-1 representable**, so the probe reported *"the trigger is not
reproduced"* for three of four titles — while still printing `raw threw` from a branch that had not
run.

A corrupted probe that reports a clean result is worse than no probe at all, and the specific trap is
worth naming: the very corruption under investigation destroyed the ability to investigate it. The
rewrite uses `write` end to end and never a PowerShell text command.

### Detector narrowing, first pass

Per the standing instruction to prove every new detector can fail, each of the following was mutated
and the failure observed:

| Detector | Mutation | Result |
| --- | --- | --- |
| `no MP3 faking` — removed-clause absence | add `\bytdl\b` to the vocabulary | 2 failures: the real code check **and** the new removal row |
| `no MP3 faking` — moved-clause presence | drop `\.getAudioData\s*\(` from the offline detector | 1 failure: *"moved, not removed" is not a removal* |
| `classifyMediaUrl` — port equality | accept the instance host on any port | `download-sources` fails on the differing-port case |
| Route — permit release on construction failure | move `handedOff = true` before `new Response` | fails: `expected false to be true` |
| ByteString — the trigger | run the old header shape through `new Response` | throws for all four non-Latin-1 titles, not for the Latin-1 control |
| `downloadNamesOffered` — brace capture | truncate at the first `}` | the declarative `.mp3` case is missed |

The `getAudioData` probe also corrected the fixture itself. Its original sample was
`const { getAudioData } = el.captureStream();`, which trips the neighbouring `captureStream` arm — so
the row would have kept passing after `getAudioData` itself had been dropped. **A sample that
exercises two clauses at once cannot tell you which one is missing**, which is the same mistake as
calibrating a detector on a single observed failure.

### Gates at the final commit

Node 24.21.0, repository root:

| Gate | Result |
| --- | --- |
| `npm run lint` | 0 |
| `npm run format:check` | 0 (after `npm run format`; four files were reformatted) |
| `npm run typecheck` | 0 |
| `npm test` | 0 — **178 files / 3141 tests** (3119 before this pass) |
| `npm run build` | 0 — `ƒ /api/download/[videoId]` |
| `openspec validate add-m20-personal-use-downloading --strict` | valid |
| `openspec validate --specs --strict` | 25 passed, 0 failed |

Bundle, measured over `.next/static/chunks/**/*.js` at gzip 9: **387,992 B total, 96,667 B largest, 25
chunks** — delta `0`, `0`, `0` against the recorded `CLIENT_BUDGET`. Expected: every code change in
this pass is server-side (`route.ts`, `container.ts`, `service.ts`, `sources.ts`) or test-side.

The `/` first-load figure is **not re-claimed here**. This pass's measurement method did not reproduce
it — Turbopack's per-page `build-manifest.json` has an empty `pages` object, and `rootMainFiles` holds
only the 5 framework-and-page roots (129,849 B), not the 13 entries the recorded 230,555 B came from.
An earlier attempt at this pass measured 129,849 B and looked like a 100 KB regression; it was the
method that differed, not the build. The recorded 230,555 B / 13 chunks stands unre-verified rather
than replaced with a number from a different measurement.

## 11. Third independent review

An independent read-only reviewer re-examined the branch after CRITICAL D was fixed. Verdict:
**REJECT** — the permit fix confirmed good, and one new CRITICAL found, in a place no test had ever
been able to fail.

### CRITICAL E — two dead arms in §2.7, and fixtures that passed for an unrelated reason

The binding scenario is *"a caller-supplied URL is never fetched and its bytes are never returned"*.
The detector meant to enforce it, `no media proxied through the application server`, carried a
group that read:

```
(?:searchParams\.get|get\s*\(\s*["'`](?:url|target|src|source|media|href)["'`]\s*\))\s*\)
```

Neither alternative can match ordinary code, for two different reasons:

- **`searchParams\.get` followed by `\s*\)`** demands the literal text `searchParams.get)`. Real code
  is `searchParams.get("url")` — a `(` after `get`, never a `)`. This arm can only ever match a
  syntax error.
- **The `.get("url")` alternative consumes the closing paren** of `.get("url")`, and the group then
  demands a **second** `)`. It fires only on a nested call: `wrapper(get("url"))`.

Both arms had a fixture filed under them, and both fixtures passed — via the
`fetch(…)…new Response(x.body)` arm, which is about *handing a body back* and says nothing about
*where the URL came from*. The reviewer separately found that for the two **header** shapes
(`fetch(request.headers.get("x-media-url"))`, the single-line evasion) **zero** of the suite's
several hundred regex literals matched, and that 5 of 8 injected violations passed every check.

This is the same shape as every other CRITICAL in this change, and it is worth stating plainly:
**a dead arm and a fixture that passes for an unrelated reason are indistinguishable from outside.
Both are green.** A rule is not exercised by its own fixture; it is exercised by a test that fails
when the rule stops working.

#### The structural fix: `caughtBy`

Each `violations` entry may now name the **individual arm** that must match, and the suite asserts
the named arm is the one that fires — separately from asserting the whole pattern matches. So:

- `caughtBy` present → a test named *"flags X by the clause it is filed under, not by another"*.
- `caughtBy` absent → only the whole-pattern assertion, and the entry says so by omission.

This cannot be retrofitted to hide a dead arm, because the assertion runs over every entry that
declares one. **It immediately caught two of my own mistakes during this pass**, which is the
argument for having it:

| Mistake | Caught by |
| --- | --- |
| `HEADER_URL` required the envelope read *before* the `fetch` | the "fetch first" fixture failed the arm assertion |
| `media-source` is not any single alternative of a literal key list | the "named header" fixture failed |

#### The arms

`URL_KEY` is now matched as `*url*`/`*media*`/`*src*`-style rather than as a list of whole names,
because `x-media-url`, `media-source` and `targetUrl` are one idea written three ways.

`callerSuppliedUrlArm` matches the envelope read and a `fetch` within a window **in either order**.
The order is the part that was wrong twice: "envelope, then somewhere a fetch" misses
`fetch(request.headers.get("x-media-url"))`, where the read is an *argument to* the fetch and so
comes after it. That is the shape a hurried implementation actually writes.

Three envelopes are now covered — query parameter, header, request body — with **nine fixtures**, two
per envelope per order or distance, each filed against its own arm.

#### An arm written, measured, and deleted

A fourth arm was added for the body envelope and then **removed**, and the removal is recorded
because deleted arms get re-added later as improvements. It required a URL-ish *field* off the
parsed body (`b.mediaUrl`, `body.href`) as well as the read. It was wrong twice over:

- **Less precise.** The field name is a property of the offending code; the envelope is the thing
  that makes it a violation.
- **Strictly less reach.** With the field required inside the first 240 characters and the `fetch`
  then inside the next 240, the arm could only see a body of at most 480 characters with the field
  early in it — so a 480-character plain body was *out of its reach* while the plain arm caught it.

The plain arm's window was widened from 240 to **480** instead, with a fixture putting **310
characters** between the body read and the fetch. That fixture is the honest form: a handler that
validates and logs its input before acting on it is what a careful author writes, and a window
narrow enough to miss it is not a rule about evasion.

#### W3 — a rule narrower than its own statement

*"No `<a download>` points at a remote origin"* was implemented as
`/download=["']true["'][^>]*href=["']https?:/`, which spells out one attribute **order**.
`<a href="https://cdn…" download>` passed — and href-first is exactly what a component whose first
prop is `href` produces. Now a tag scan: locate the tag, then check both properties inside it, so
the rule is "this tag has both" as stated rather than "in this sequence". Six pinned cases, both
orders, a protocol-relative URL, and three shapes that must pass.

#### A pre-existing false positive, found by the probe and recorded rather than fixed

`fetch(serverResolvedUrl)` … `new Response(media.body)` is the **approved** M20 shape — M20 reverses
§2.7 for a validated provider id resolved server-side — and the coarse
`fetch(…)…new Response(x.body)` arm flags it regardless of origin.

The real route does not trip it, but only **incidentally**: its body argument is
`holdUntilSettled(payload.stream, permit.release)`, a call rather than a `.body`, so the arm misses
the spelling. The route is safe by *spelling*, not by design, and one refactor naming that value
differently would trip a detector whose whole purpose is to be impossible to argue with.

Verified which arm is responsible, so the finding is precise rather than speculative: the coarse arm
matches; **none** of the query-parameter, header or request-body arms match the approved shape. That
is direct evidence the new arms are precisely targeted at *where the URL came from*, which is the
distinction §2.7 actually turns on. Narrowing the coarse arm needs that same origin judgement, now
made structurally by the envelope arms, and belongs to M21.

#### Evidence

An independent probe re-declares the arms from scratch rather than importing them — a probe that
imports the thing it is checking cannot catch the case where the import itself is wrong — and checks
9 violating shapes, the two original dead arms pinned to stay dead, 4 legitimate request-handling
shapes, and the false positive above. All pass. Two probe bugs were found and fixed en route, both
of the same kind: a control testing `yt-dlp` against the string `ytdlp`, and a "no URL-ish field"
control whose `body.mediaId` *is* URL-ish by the arm's own definition. A probe whose controls do not
test what their labels claim is worse than no probe.

`release-exclusions.test.ts` is now **116 tests** (91 at the second review).

#### Carried to M21

W1 (`audio/` replaced by a "positive rule" that does not exist server-side), W2 (four more
`download`-attribute spellings not matched), W5 (a queued caller receives no response at all),
W6 (a residual permit leak if the platform never reads or cancels the body), and the coarse-arm
shape noted above.

---

## 12. Fourth independent review

An independent read-only reviewer attacked the two commits above. Verdict: **REJECT**, on a finding
larger than anything it had found before, plus two of its own errors.

### Corrections to this file, made first

Two claims in §11 were wrong, and they are corrected here rather than quietly amended in place,
because a commit that fixes a false claim elsewhere while adding two of its own is worth very
little.

| §11 said | Actually | Who found it |
| --- | --- | --- |
| "310 characters" between the body read and the `fetch` | **344** strictly between, 358 from the start of `request.json()` | the review, and my own re-derivation |
| "three envelopes … with nine fixtures, two per envelope per order or distance" | **eighteen** fixtures across the three detectors, and the per-arm split was 5 / 2 / 3, not "two per envelope" | the review, for the shape; my own count, for the split |

The 310 was measured in a **probe's copy** of the fixture, which was indented differently and so was
34 characters shorter. A number measured on a copy of the thing is a number about the copy. The
fixture comment in the source now carries 344 and says it was measured in that file.

The reviewer separately reported "9 `caughtBy` declarations" against 10 fixtures. That one is the
reviewer's error: the file has 10, split 5 / 2 / 3, re-derived mechanically.

### CRITICAL F — 21 of 33 clauses could be deleted with the whole suite green

The method was to parse each detector into its top-level alternation arms, delete one arm at a
time, and re-run the entire exclusion suite. Across `no media proxied through the application
server`, `no MP3 faking` and `no media cached for offline playback`:

| Detector | Clauses | Deletable with the suite green |
| --- | ---: | ---: |
| `no media cached for offline playback` | 10 | 4 |
| `no MP3 faking` | 16 | 10 |
| `no media proxied through the application server` | 9 | 9 |

Two distinct causes, and the second is the one that matters.

**Cause 1 — no clause had its own fixture.** The fixtures were realistic whole handlers, which is
right for asking "does this detector catch a realistic violation" and useless for asking "does *this
clause* do any work". A handler re-recording a parked element mentions `captureStream`,
`getAudioTracks`, `MediaRecorder` and `createMediaElementSource` at once, so deleting any one of
them left the other three catching the same snippet. Each clause was "covered" by its neighbours.

**Cause 2 — one broad clause was doing nearly all the work, and masked the rest.** In §2.7 the
clause `fetch(…)…new Response(x.body)` matches *every* forwarder fixture, because every one of them
ends `return new Response(<something>.body, …)`. With that clause present, deleting any precise
clause lost nothing. So §2.7's three envelope clauses — the ones the third review spent its CRITICAL
on — were all individually deletable.

That is the sharpest form of this change's recurring defect: **the clause added to fix a hole was
being carried by the clause that caused the false positive.** §11 recorded that
`fetch(serverResolvedUrl)` … `new Response(media.body)` is the *approved* M20 shape and the coarse
clause flags it. The same clause was also propping up three precise ones.

#### The fix: compute attribution instead of declaring it

`caughtBy` is gone. In its place, every detector's clauses are a named `arms` array, and one test
**deletes each clause in turn and requires a fixture to stop matching**:

```
for each clause:
  reduced = the detector rebuilt without it
  some fixture that matched before must fail to match after
```

Nothing is hand-declared, so the four ways the review defeated `caughtBy` — delete every field, set
them all to `^`, set them all to the whole pattern, re-file a header fixture under the query clause
— have no analogue. There is nothing to lie about; the fixtures do the arithmetic.

#### What that forced, clause by clause

Getting to green took **27 new fixtures** — 9 for §2.7, 10 for `no MP3 faking`, 8 for the offline
detector — and **three clause rewrites**, and every one of them was a clause doing something other
than what its name said:

| Clause | What was actually wrong | Fix |
| --- | --- | --- |
| `objectStore("…")` | matched **inside** `createObjectStore("…")` — no word boundary — so it covered the clause above it | added `\b`; in `createObjectStore` the `O` follows the `e` of `create`, two word characters, so there is no boundary, while `.objectStore(` has one |
| `n-parameter` | matched the token as *documented*, not as it *appears in code*, so nothing matched | replaced with `"n":"…"`, which is what the player source actually contains. Found by the new check **on its first run** |
| the query-string clause | its envelope list included `headers`, making it a strict **superset** of the header clause — so the header clause could never be load-bearing and re-filing was undetectable | `headers` removed; the two envelopes are now disjoint |

The `n-parameter` clause is the same defect as §2.7's `searchParams.get)` arm, found by the same
mechanism, in a clause nobody had looked at since M15.

#### The blunt clause is kept, and §11's finding about it is now sharper

With the envelope arms disjoint and the fixtures destructuring their response bodies, the blunt
`fetch(…)…new Response(x.body)` clause became the *only* redundant one in §2.7. The obvious move was
to delete it — and that would have been wrong twice over. It false-positives on the approved M20
shape (§11), so deleting it would have **fixed** a false positive by accident. And it is the only
clause that catches the most realistic §2.7 violation in the file:

```
a caller-controlled path segment used to build a media URL
```

The caller picks the slug, the server supplies the host, the bytes go straight back. No envelope
read — the slug is in the *path*, not a query or header. No literal host in the `fetch` call. No
named helper. Nothing but "a fetched body handed straight back" applies. A §2.7 built only from
precise clauses would miss it, and every precise clause would still be green.

So it stays, and it now has a fixture whose loss it alone detects.

#### The check is mutation-proven, in both directions

A check that cannot fail is decoration, and this file has shipped several. Five mutations, each
restoring the file from a byte copy verified by content hash:

| Mutation | Expected | Result |
| --- | --- | --- |
| delete the query-envelope clause | red | **red**, via a violation test |
| delete the fixture that witnesses it | red | **red**, via the load-bearing check |
| delete the decipher-by-name clause | red | **red**, via a violation test |
| delete the fixture that witnesses it | red | **red**, via the load-bearing check |
| fold the n-parameter clause into the manifest clause | **green** | **green** |

The first four are caught by *different* checks, which is the point: deleting a clause is caught by
the violation tests, and deleting the evidence that a clause works is caught only by the new one.

The fifth must stay green, and asserting that is part of the design. Coverage-preserving
consolidation is a legitimate refactor, and a check that fails on every conceivable edit gets
disabled — after which it protects nothing. The check's job is to catch **loss of coverage**, not
to preserve the shape of the source.

Two probe bugs were found and fixed en route, both worth recording because a broken probe reports
false confidence: the fixture-deletion mutation initially left the opening `{` behind, so the file
was unparseable and the run failed for a syntax reason rather than a coverage one; and one clause
deletion did not apply, which the probe reported as a skip rather than quietly counting as a pass.

### W10 — 29 text files were outside the encoding scan, and one hole was three years deep

The review noted the gap without enumerating it, so it was enumerated before being closed: 17
top-level text files (`ROADMAP.md`, `MEMORY.md`, `README.md`, `package.json`, `tsconfig.json`,
`eslint.config.mjs`, `next.config.ts`, `postcss.config.mjs`, `next-env.d.ts`, `package-lock.json`,
the agent instruction files) plus `.github`.

Covered now: **703 files**, up from 685 — 236 `frontend/src`, 200 `frontend/tests`, 4
`frontend/scripts`, 6 `frontend/docs`, 1 `frontend/public`, 238 `openspec`, **1 `.github`** (the CI
workflow), 11 `frontend/` top level, 6 repository top level.

Adding `.github` immediately failed, and the reason is the finding: `IGNORED` was
`/node_modules|\.next|\.git|coverage/`, and **`\.git` also matches `.github`**. So the CI workflow
had never once been inside this scan, and the new root was silently scanning nothing. `IGNORED` is
now anchored to a complete path segment.

That is worth stating plainly: the fix *looked* like it worked, and only an assertion naming the
workflow's exact path caught it. This is the fourth time in this change that a pattern matching more
than it was written to match has defeated a check — and the third time the thing that caught it was
a new assertion rather than a review of the pattern.

The newly covered areas are pinned **by name**, not by count. A count is satisfied by any large set
of files and cannot distinguish "the configs are covered" from "the configs stopped being scanned
and the source tree grew". A duplicate-file assertion was added at the same time, so the count
cannot be satisfied by listing the same file twice.

Top level only, deliberately: `package-lock.json` is regenerated by every install, and descending
into it would add hundreds of files nobody edits by hand.

### CRITICAL G — a removal-table row covering five clauses with one sample

`REMOVED_CLAUSES` had one row whose fingerprint listed
`captureStream|getAudioTracks|MediaRecorder|MediaElementAudioSourceNode|createMediaElementSource`
and whose sample contained **two** of them. A sample exercising two clauses keeps passing after
either is dropped, so the row cannot say which went missing; three of the five had no sample that
reached them at all.

Split into five rows, one clause and one single-clause sample each — the approach the `getAudioData`
row immediately below already used, and whose comment already explained why.

### Gates at this commit

Node 24.21.0, repository root:

| Gate | Result |
| --- | --- |
| `npm run lint` | 0 |
| `npm run format:check` | 0 (after `npm run format`; two files reformatted) |
| `npm run typecheck` | 0 |
| `npm test` | 0 — **178 files / 3186 tests** (3157 before this pass) |
| `npm run build` | 0 — `ƒ /api/download/[videoId]` |
| `openspec validate add-m20-personal-use-downloading --strict` | valid |
| `openspec validate --specs --strict` | 25 passed, 0 failed |

`release-exclusions.test.ts` is **145 tests** (116 at the third review);
`encoding-integrity.test.ts` is 7.

Bundle re-measured after this pass, gzip 9 over `.next/static/chunks/**/*.js`: **387,992 B total,
96,667 B largest, 25 chunks** — byte-identical to the last three passes, which is what a pass that
touches only tests and evidence should produce.

The `/` first-load figure is still **not re-claimed**, for the reason given at the end of §10. The
129,849 B this pass's script prints is the 5 framework roots, not the 13 entries the recorded
230,555 B came from, so quoting it would replace one unre-verified figure with a differently-measured
one.