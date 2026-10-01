# M16 evidence — Lyrics and Now Playing enrichment

Change: `m16-synced-lyrics` · Branch: `feat/m16-lyrics-apply` · Runtime: **Node v24.21.0**, npm 11.19.0

Everything below was actually run. Anything that was not run is in "Not verified" rather than
implied by a green check elsewhere.

## Automated checks

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` (root → `frontend`) | exit `0` |
| Format | `npm run format:check` | exit `0` |
| Types | `npm run typecheck` (`next typegen && tsc --noEmit`) | exit `0` |
| Tests | `npm test` (`vitest run`) | exit `0` |
| Build | `npm run build` | exit `0` |
| Lyrics suites | `npx vitest run tests/lyrics/ tests/lyrics-route.test.ts tests/nowplaying-lyrics.test.tsx` | 105 passed, 0 failed (5 files) |
| Induced violations | `node scripts/lyrics-induced-violations.mjs` | **15/15 caught**, exit `0` |
| **Release gate** | M15's archived `evidence/release-gate.mjs` | **exit `1`, and not usable as a comparison — see below.** |

**Full suite: 2472 tests passed, 0 failed, across 150 files** (2356 before this change, so +116).

### What the counts do and do not prove

They prove the five gates pass on this machine under Node 24, and that the lyrics capability's
behavioural tests pass. They do **not** prove the lyrics panel follows a real YouTube playback
position in a real browser — see "Not verified".

## The release gate could not be used as a comparison, and running it did damage

Task 6.2 asked for the gate's counts to be compared against the pre-change baseline. **That
comparison was not obtained.** The gate ran and exited `1`, but for reasons that have nothing to do
with this change, and running it twice caused collateral damage that had to be repaired by hand.
Both facts belong here rather than in a footnote.

**Finding 1 — the gate is already recorded as intermittently red.** `ROADMAP.md` carries a
flaky-release-gate item: M15's end-to-end suite fails intermittently on a CDP race in its own fixture
router, reproduced on a commit before the runtime correction, and its repair is scheduled for **M21**.
This change does not attempt that repair.

**Finding 2 (new, and the reason the comparison is missing) — the gate's own install step destroys
`node_modules` when it fails, and it fails whenever any process holds a native module.** The gate's
`gates-install` item runs `npm ci`, which deletes `node_modules` *before* installing. The first run
was made with a production server up on port 3212, which held
`lightningcss-win32-x64-msvc/lightningcss.win32-x64-msvc.node` open; `npm ci` aborted with `EPERM`
on `unlink` and left **19 top-level packages, no `node_modules/.bin`, and `next` without its
`package.json`**. Every subsequent gate item then failed in under a second, not because the code is
broken but because the toolchain no longer existed.

The second run, with no server running, got past the install and then failed on the `end-to-end` and
`falsifiability` items — consistent with the known CDP race rather than with anything in this change.

`node_modules` was restored with `npm ci` (**445 packages, 446 audited, 0 vulnerabilities**, matching
the documented M0 baseline) and all five gates re-verified green afterwards. Nothing in
`frontend/node_modules` is committed.

**Restored, not rewritten:** the gate overwrote three files of *archived* M15 evidence
(`end-to-end-results.json`, `measurement/results.json`, `release-gate.json`). Those were reverted
with a path-scoped `git checkout`, and no archived evidence is modified by this change. A
path-scoped revert is deliberate — a bare `git checkout -- frontend` has twice in this repository's
history silently discarded uncommitted work.

**What this means for M21.** The gate cannot be trusted to be non-destructive, and "run the gate"
currently carries a real risk of breaking a developer's working tree with no obvious cause. Repairing
that is now a concrete, evidenced item for M21 alongside the CDP race — and it is the kind of defect
that only shows up when someone actually runs the thing.

## The induced-violation run, and why it exists

This repository has paid four separate times for a green check sitting on top of a live defect, so a
test that has never been observed to fail is treated here as a claim rather than as evidence. Each
case below breaks exactly one production behaviour, runs the test named for it, and requires that
test to fail. A case that passes would prove its test is dead.

| # | Violation | Caught by |
|---|---|---|
| 1 | Timestamp fraction coerced naively, so `[00:12.5]` becomes 12.005 | `lyricsTiming.test.ts` |
| 2 | Active line selects the first line *strictly after* the position | `lyricsTiming.test.ts` |
| 3 | Empty timed line rendered as a lyric (an instrumental gap becomes the highlighted row) | `lyricsTiming.test.ts` |
| 4 | "No lyrics" reported as a provider error | `lyrics-route.test.ts` |
| 5 | A provider failure cached as a permanent miss | `lyricsService.test.ts` |
| 6 | Miss TTL made as long as the hit TTL | `lyricsService.test.ts` |
| 7 | In-flight de-duplication removed | `lyricsService.test.ts` |
| 8 | Settled result no longer tagged with its request key, so a late response lands under the new track | `lyricsPanel.test.tsx` |
| 9 | Active line made an `aria-live` region | `lyricsPanel.test.tsx` |
| 10 | Reduced motion no longer changes the scroll `behavior` | `lyricsPanel.test.tsx` |
| 11 | Following never suspends | `lyricsPanel.test.tsx` |
| 12 | Lyrics panel positioned as a fixed overlay | `nowplaying-lyrics.test.tsx` |
| 13 | Route reads a taste-profile query parameter | `lyrics-route.test.ts` |
| 14 | Malformed video id accepted | `lyrics-route.test.ts` |
| 15 | Lyrics retry label reverted to "Try again" | `radio-entry-points.test.tsx` |

The harness is `scripts/lyrics-induced-violations.mjs` with its cases in
`scripts/lyrics-induced-violations.cases.mjs`. It is a script rather than a test because it spawns
`vitest`; `tests/lyrics-induced-violations.test.ts` guards it, and in particular asserts that **every
anchor still resolves** — an unresolved anchor makes a case skip, and a skip counted as neither a
pass nor a failure is how a harness starts lying.

Case 15 is worth noting separately: it was not found by inspection. The full suite failed with
`Found multiple elements with the role "button" and name "Try again"`, because the radio's own
failure surface on the same page already offers that exact label. Two identically-labelled retry
buttons on one screen leave a listener no way to tell which thing they are retrying, so the label is
now "Try lyrics again".

## Defects found and fixed during this change

These are recorded because they are the substance of the change, not decoration.

1. **`cleanTitle` did not strip `Song Title - Official Music Video`.** The ported Lyrix pattern
   strips a suffix that is a *single* noise word, so this very common YouTube title form survived
   intact and then matched nothing in LRCLIB. Widened to a *run* of noise words. The asymmetry is
   deliberate: a missed match costs the whole feature for that track, while over-stripping only
   widens the query slightly — and duration-aware scoring recovers from that.
2. **Literal en/em dashes in a test were silently corrupted** by a PowerShell text round-trip that
   decoded UTF-8 bytes as Latin-1. The corruption failed *open*: the separator no longer matched, the
   split never happened, and the failure read as a plain "did not split" rather than an encoding
   fault. Both the service and the test now spell those characters as `\uXXXX` escapes. **Lesson:
   never round-trip a file through PowerShell text commands in this repository.**
3. **The follow-suspension rule was not implemented at all** in the first version of the panel —
   nothing ever set `following` false, so the spec's "a manual scroll suspends following" scenario
   would have failed while the file reported complete. The first attempt at a rule (comparing scroll
   offsets) was also wrong in a subtler way: a smooth programmatic scroll fires a `scroll` event for
   every animation frame, so it read the panel's *own* scrolling as a manual scroll and switched
   following off moments after enabling it. The rule is now positional — the middle half of the
   panel — which its own scroll cannot trip.
4. **The controller's first design reset state inside the effect and carried a generation counter.**
   `react-hooks/set-state-in-effect` flagged it and was right: a synchronous `setState` in an effect
   causes a cascading render, and the generation counter was a second source of truth that could
   disagree with the payload it guarded. Resolved by **deriving** the reset — a settled result is
   tagged with the request key, and a result whose key does not match is treated as not-arrived.
   That removed the bug class rather than silencing the warning.
5. **One test asserted nothing.** The first version of the follow test tolerated either outcome
   ("if the button appeared, check it was off") because jsdom gives every element a zero rect, so the
   live band was degenerate. jsdom also does not implement `scrollBy` at all, so giving the elements
   real geometry made the panel call a method that threw. Both are now stubbed, and the
   reduced-motion requirement is asserted on the `behavior` value actually passed to `scrollBy`
   rather than on a `data-` attribute the component could set without ever scrolling.

## Not verified, and not claimable here

- **The position plumbing is verified; the following is not observed in a real browser.** The
  YouTube IFrame API is blocked by CSP in this environment, so no browser run can confirm the active
  line advancing against a real playback position. What *is* verified: `positionSeconds` drives the
  selection, the centring delta is exact, and reduced motion changes the scroll `behavior`. What is
  not: that a live player reports position smoothly enough for the highlight to look right.
- **The LRCLIB integration is exercised only against a stubbed transport.** No test performs a real
  network request, by design — the suite must not depend on a third-party service. The query shape,
  scoring, timeouts, and abort propagation are verified; whether LRCLIB returns the right thing for
  any specific real track is not.
- **No visual review at either viewport.** The panel's layout is asserted structurally (sibling, not
  overlay, bounded scroll) and by the existing Now Playing suites, but nobody has looked at it.

## Files

**Added** — `src/lyrics` equivalents under the repository's existing layout:
`src/features/lyrics/{lyricsTiming,lyricsApi,useLyricsPanel,LyricsPanel}.tsx|ts`,
`src/server/lyrics/lyricsService.ts`, `src/app/api/lyrics/route.ts`,
`src/hooks/usePrefersReducedMotion.ts`,
`tests/lyrics/{lyricsTiming,lyricsService,lyricsPanel}.test.*`,
`tests/lyrics-route.test.ts`, `tests/nowplaying-lyrics.test.tsx`,
`tests/lyrics-induced-violations.test.ts`,
`scripts/lyrics-induced-violations{,.cases}.mjs`.

**Changed** — `src/app/now-playing/page.tsx` (hosts the panel, one import).

**Not changed** — no dependency added, no store added, no IndexedDB schema change, no persisted
state, no backup-format change, no change to the player engine, and nothing in `openspec/specs/`
(which this change's Sync stage will own).
