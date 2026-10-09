# Tasks: first-run artist picker replacing the language dialog

## 1. Proposal and design

- [x] 1.1 `proposal.md` — including why the literal "use localStorage" request is not what gets built
- [x] 1.2 `design.md` — the two-store decision, the four rejected options, the derivation ordering
- [x] 1.3 `home-mixes` delta — MODIFIED provider-completion requirement, ADDED picker + persistence
- [x] 1.4 `local-data` delta — the picks dataset, optional, covered by merge and replace
- [x] 1.5 `openspec validate quick-picks-onboarding --strict`

## 2. Persistence, before any UI

- [x] 2.1 Add `STORE.quickPickPicks` and its definition, keyed by `artistId`, indexed by `pickedAt`
- [x] 2.2 Bump `SCHEMA_VERSION` to 3 and append an **idempotent** v3 migration, per the M11 precedent
- [x] 2.3 Migration test: an existing v2 database gains the store; opening at v3 twice is safe
- [x] 2.4 `QuickPickPicksRepository` — `pick`, `unpick`, `replaceAll`, `list`, `has`, `clear`
- [x] 2.5 Wire it into `repositories/index.ts` and `indexeddb/index.ts`
- [x] 2.6 Repository tests against real IndexedDB: pick/list/unpick round-trip, identity keying,
      one-timestamp `replaceAll`, `clear` empties

> **2.4 changed shape during implementation.** The task said `set`/`remove`; what shipped is
> `pick`/`unpick` **plus** `replaceAll`. Onboarding confirms a whole selection, and doing
> that as a delete-then-insert loop would let the rail show a half-applied selection —
> so the repository owns the single-transaction write. `replaceAll` takes
> `{artistId, name}` rather than bare ids: the display name came from a card the
> listener clicked and cannot be recovered from the id. That was a real bug, caught by
> a test rather than review (see 2.6).

## 3. Backup

- [x] 3.1 Optional `quickPickPicks` array in `backupEnvelopeSchema.data`
- [x] 3.2 Export it in `serialize.ts`
- [x] 3.3 Add to `apply.ts` `SUPPORTED_DATASETS` so **merge and replace** both cover it
- [x] 3.4 Tests: absent dataset imports as empty; present dataset round-trips; replace clears;
      merge takes the newer `pickedAt` by artist identity and converges

## 4. Derivation

- [x] 4.1 Add `picks` to `QuickPickInput`
- [x] 4.2 Rank explicit picks above local material, which stays above provider results
- [x] 4.3 **Do not** gate picks behind `material.length === 0` — the cold-start gate must not swallow
      a device that picked artists and then liked nothing
- [x] 4.4 Tests for each rank, and for the no-likes-after-picking case
- [x] 4.5 Prove the ordering can fail: a test that fails if picks are ranked below local material

## 5. Onboarding gate

- [x] 5.1 `localStorage` "onboarding seen" flag, mirroring `installPrompt.ts` — namespaced key, try/catch,
      unreadable = not seen
- [x] 5.2 Readable **before** IndexedDB opens; assert the dialog does not flash and vanish
- [x] 5.3 The flag gates the dialog; `preferences.onboardingComplete` is no longer read by `HomeView`

> **5.2 and 5.3 did not land as designed.** The gate is read through
> `useSyncExternalStore`, not `useState` + `useEffect`: an effect that set state on
> mount is flagged by `react-hooks/set-state-in-effect`, and would show the dialog in
> the first paint and remove it in the second — the exact flash 5.2 forbids.
>
> That change surfaced a second bug the original design would have hidden: the
> `storage` event fires only in *other* tabs, so a same-tab `markOnboardingSeen()`
> never notified the subscription and the dialog stayed open after dismissal. Fixed
> with a same-tab subscriber set in `onboardingGate.ts`, and asserted directly rather
> than left to the HomeView test to notice again.
>
> 5.3's original wording ("store `onboardingComplete` through the repository as today")
> is deliberately **not** what shipped. The language dialog was the only writer of
> that preference; keeping it in the gate condition would have pinned onboarding *on*
> for anyone whose stored preferences were written by an older build. `HomeView` no
> longer reads it. A test asserts the gate ignores it.

## 6. UI

- [x] 6.1 `ArtistOnboarding` — inherits the a11y contract from `LanguageOnboarding` rather than
      dropping it: `role="dialog"`, `aria-modal`, focus on mount, Escape/backdrop dismissal
- [x] 6.2 Multi-select toggles carry `aria-pressed`, so selection is not conveyed by colour alone
- [x] 6.3 Dismissal with nothing selected reaches the dashboard, and ends first run
- [x] 6.4 Remove the `LanguageOnboarding` mount from `HomeView`; delete the component
- [x] 6.5 Language preference stays editable in Settings — verified by preserved tests, not assumed

> **6.1's "opener-owned focus return" is not implemented.** The old dialog had an
> opener that owned focus return; this one is opened by `HomeView` itself rather than
> by a button the listener pressed, so there is no opener to return focus to. Recorded
> as a deliberate omission rather than quietly dropped.

> **6.3's second clause is a judgement call, made without user confirmation.** The user
> was asked whether confirming with nothing selected should complete onboarding and was
> told to proceed on stated judgement. It does: re-asking someone who has already
> answered is nagging rather than onboarding, and it matches `installPrompt.ts`'s
> "never nag forever" behaviour.

## 7. Verification

- [x] 7.1 Prove the new persistence and gate tests can fail before trusting them
- [x] 7.2 `npm run gate` to completion
- [x] 7.3 `openspec validate --specs --strict`
- [x] 7.4 Record explicitly that **no browser verification was possible**

> **7.2 is qualified.** `npm run gate` as a single `npm run` invocation terminated with
> `StackOverflowException` under PowerShell output redirection and did not reproduce when
> the steps were run individually. Every step was therefore run separately and each
> exited `0`. That is not the same evidence as one green `npm run gate`, and it is
> reported as such.

## 8. Batch evidence

- [x] 8.1 Six gate runs plus the corroborator, from the canonical home
- [x] 8.2 Corroborator exit 0, six distinct digests, one commit, 0 skipped — using this tree's own
      `--expect-files` / `--expect-budget`, not the stale defaults
- [x] 8.3 Batch commit's **tree** equals the merge commit's tree — `ab5a627` on both, verified
      after the merge, with nothing committed in between
- [x] 8.4 Record commit, tree and `merge-base` in the **PR body**

## 9. Statements

- [x] 9.1 State that picks are in IndexedDB, **not** localStorage, and why the literal request was
      not implemented as written
- [x] 9.2 State that M21 CRITICAL 1 and CRITICAL 2 remain open
- [x] 9.3 State that the language preference was kept, only the first-run question removed