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
| `npm test` | `0` | **177 files, 3077 tests passed** (baseline before M20: 167 files / 2829 tests) |
| `npm run build` | `0` | compiled in 8.9 s; `ƒ /api/download/[videoId]` present in the route table |
| `openspec validate add-m20-personal-use-downloading --strict` | `0` | `Change 'add-m20-personal-use-downloading' is valid` |
| `openspec validate --specs --strict` | `0` | `Totals: 25 passed, 0 failed (25 items)` |

Suite sizes, each run on its own: `download-container` 21, `download-select-format` 27,
`download-limiter` 13, `download-sources` 24, `download-service` 19, `download-route` 23,
`download-save-file` 23, `download-client` 34, `download-non-goals` 22,
`downloading-documentation` 25.

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
windows-1252, producing `â€”` for `—` and `ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â` for a three-times-mangled arrow.
`service.ts` needed three decode rounds, not one.

This is the concrete demonstration of the rule in `MEMORY.md`: **never round-trip a repository file
through a PowerShell text command.** It was repaired with node and an explicit cp1252→UTF-8 decode,
verified by asserting that no file under `src/`, `tests/`, `scripts/`, `docs/` or `openspec/` contains
a UTF-8 BOM or a mojibake run (result: `clean`), and then re-ran through every gate. `lint`,
`format:check`, `typecheck`, `typecheck`-adjacent suites and the full `npm test` were all re-run after
the repair — 177 files / 3077 tests passed, `build` exit `0`.

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

`DOWNLOAD_BUDGET_BYTES` is 20 MiB. At realistic audio-only bitrates — 50 to 160 kbit/s, which is
6 to 20 kB/s — 20 MiB is **about 17 minutes**. ROADMAP §21.5 records the proxied request timeout as
120 s. **The budget does not fit inside the timeout.** A short track finishes comfortably; a long one
at the top of the ladder cannot.

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