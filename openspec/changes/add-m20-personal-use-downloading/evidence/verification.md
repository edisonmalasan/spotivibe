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