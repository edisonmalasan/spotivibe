# Tasks: make the artist Quick Picks rail the first thing Home presents

## 1. Proposal and design

- [x] 1.1 Write `proposal.md`, recording that the previous diagnosis — a stale service worker — was
      wrong, and that the defect was the rail's position rather than its content
- [x] 1.2 Write `design.md`, including the two declarations that must agree and the four rejected
      options, including "drop `MixCards`"
- [x] 1.3 Write the `home-mixes` spec delta: the rail is first, and a containment bound the current
      arrangement satisfies cannot guard that arrangement
- [x] 1.4 `openspec validate quick-picks-first-rail --strict`

## 2. Prove the new assertion can fail, BEFORE the fix

- [x] 2.1 Tighten `routes.test.tsx` from `circularIndex < CIRCULAR_WINDOW` to require the rail be the
      first rendered row
- [x] 2.2 Run it **against the current order** and require it to go **red** — it did, naming the row
      that sat ahead: `these rows render above the artist rail: expected [ 'home-time-shelf' ] to
      deeply equal []`
- [x] 2.3 Add a second assertion in `home-view.test.tsx` covering the case `routes.test.tsx` cannot
      reach: that fixture is a fresh device, and the mix-card row is gated on `profile.hasSignal`, so
      the row the listener complained about was never in the document the route test measured. The
      seeded `moodTaste()` fixture renders all three M17 surfaces.
- [x] 2.4 Prove **that** assertion can fail too, by restoring the old JSX order temporarily:
      `the artist rail must precede the mix cards: expected 4 to be +0`, where `4` is
      `DOCUMENT_POSITION_FOLLOWING`. Source restored from backup and confirmed byte-identical by
      SHA-256 (`132654767781598411C246088214920414E4F04491352A44A37433EA90DBEB23`).

## 3. Implementation

- [x] 3.1 Move `QuickPicksShelf` above `MixCards` and `TimeShelf` in `HomeView`'s JSX
- [x] 3.2 Move `QUICK_PICK_SURFACE` to the front of `M17_SURFACE_ROWS`, since that declaration exists
      to mirror the JSX for `assertShelfRhythm`
- [x] 3.3 Confirm `assertShelfRhythm` still passes — a circular row at index 0 has no predecessor and
      is inside `CIRCULAR_WINDOW`
- [x] 3.4 `npm run format:check` and `npm run lint` — clean, and `format` reported the touched files
      unchanged

## 4. Verification

- [x] 4.1 The tightened assertion goes green
- [x] 4.2 Run the full Home test set — `home-view`, `home-quick-picks`, `home-mix-cards`,
      `home-time-shelf`, `routes`, `home-sections`. 175 passed across the six that ran together;
      `home-sections.test.ts` was **silently dropped by the combined invocation** (7 paths requested,
      6 files reported) and was run separately — 26 passed. The drop is a property of that multi-path
      invocation, not a failure, and is recorded rather than glossed.
- [x] 4.3 Confirm the rail is still artist-only: `QUICK_PICK_KINDS` unchanged at `["artist"]`, and
      `quickPicks.ts` has a **zero-line diff** — this change never touched the derivation
- [x] 4.4 Run `npm run gate` to completion — exit code **0**, 183 files / 3413 tests (3412 before,
      plus the one new assertion)
- [x] 4.5 Record explicitly that this is **verified by rendered document order in tests, not in a
      browser** — no browser is attached to this session, and that limit is stated rather than implied

## 5. Batch evidence

- [x] 5.1 Six `npm run gate` runs plus the corroborator from the canonical home
- [x] 5.2 Corroborator exit 0, six distinct digests, one commit, 0 skipped
- [x] 5.3 Batch commit's **tree** equals the merge commit's tree
- [x] 5.4 Record commit, tree and `merge-base` in the **PR body**, not in this file

> **5.1–5.3 were done; 5.4 was not.** All six runs happened and every figure checked out, but the
> batch was run *after* PR #119's body was written and the result was never posted back — the body
> still reads "A batch run … is the remaining evidence step". Tasks 5.1–5.3 were therefore ticked
> late, against artifacts rather than against the original claim, on 2026-10-10:
>
> | Claim | How it was actually checked |
> |---|---|
> | 5.1 six runs | `%LOCALAPPDATA%\Temp\opencode\qpf-batch`, six log files present |
> | 5.2 corroborator | re-run on those logs, **exit 0**, 6 distinct digests of 6, 1 distinct commit `0b903259b1c4`, 0 skipped |
> | 5.3 trees equal | merge `d7bf41a` and branch head `0b903259b1c4` both carry tree `f0f1c33a1ffc8bacebe19e6498fe11a2d3a7ce7e` |
> | 5.4 PR body | **was genuinely absent** — no commit, tree, or `merge-base` token anywhere in the merged body. Recorded in the close-out PR. |
>
> The corroborator was re-run with `--expect-files 183 --expect-budget 24`, this tree's own figures.
> It reads the counts out of the *logs*, so it still corroborates that historical batch even though
> `main` has since grown to 185 files.
>
> **The prior session's summary asserted 5.4 was done. It was not** — reading the merged PR body
> rather than trusting the summary is what caught it.

## 6. Statements

- [x] 6.1 State that M21 CRITICAL 1 and CRITICAL 2 remain open — untouched by this change and still
      unclosable without the forbidden archived gate
- [x] 6.2 State that this is a position change, not a content change: `quickPicks.ts` has a zero-line
      diff and languages remain legitimate inputs to mix plans, the time shelf, and discovery
- [x] 6.3 State that no browser verification was possible. Evidence is rendered **document order**
      asserted by tests over the real DOM — the same evidence the pre-existing rhythm rule rests on —
      and not a screenshot. `compareDocumentPosition` is used rather than `indexOf` so the assertion
      asks the DOM directly instead of trusting a query's ordering.

## 7. Close out

- [x] 7.1 `openspec validate --specs --strict`
- [x] 7.2 Commit, push, PR, merge with a merge commit, delete the branch
- [x] 7.3 Archive, and record the outcome in `ROADMAP.md`

> **7.1–7.3 are being completed by the close-out PR, after this change's own PR merged.** The change
> sat merged-but-unarchived for a while: PR #119 landed as `d7bf41a`, and nothing then synced its two
> `home-mixes` requirements into `openspec/specs/` or moved the directory to `archive/`. Both
> requirements were therefore live only inside the change folder, which is exactly the state a reader
> of the main specs would not find them in.
>
> The close-out syncs both requirements, archives the change, records the batch evidence in PR #119's
> body, and adds the ROADMAP row this change never got.
