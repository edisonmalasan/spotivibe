# Tasks: first-run artist picker replacing the language dialog

## 1. Proposal and design

- [x] 1.1 `proposal.md` — including why the literal "use localStorage" request is not what gets built
- [x] 1.2 `design.md` — the two-store decision, the four rejected options, the derivation ordering
- [x] 1.3 `home-mixes` delta — MODIFIED provider-completion requirement, ADDED picker + persistence
- [x] 1.4 `local-data` delta — the picks dataset, optional, covered by merge and replace
- [x] 1.5 `openspec validate quick-picks-onboarding --strict`

## 2. Persistence, before any UI

- [ ] 2.1 Add `STORE.quickPickPicks` and its definition, keyed by `artistId`, indexed by `pickedAt`
- [ ] 2.2 Bump `SCHEMA_VERSION` to 3 and append an **idempotent** v3 migration, per the M11 precedent
- [ ] 2.3 Migration test: an existing v2 database gains the store; opening at v3 twice is safe
- [ ] 2.4 `QuickPickPicksRepository` — `set`, `remove`, `list`, `has`, `clear`
- [ ] 2.5 Wire it into `repositories/index.ts` and `indexeddb/index.ts`
- [ ] 2.6 Repository tests against real IndexedDB: set/list/remove round-trip, `clear` empties

## 3. Backup

- [ ] 3.1 Optional `quickPickPicks` array in `backupEnvelopeSchema.data`
- [ ] 3.2 Export it in `serialize.ts`
- [ ] 3.3 Add to `apply.ts` `SUPPORTED_DATASETS` so **merge and replace** both cover it
- [ ] 3.4 Tests: absent dataset imports as empty; present dataset round-trips; replace clears

## 4. Derivation

- [ ] 4.1 Add `picks` to `QuickPickInput`
- [ ] 4.2 Rank explicit picks above local material, which stays above provider results
- [ ] 4.3 **Do not** gate picks behind `material.length === 0` — the cold-start gate must not swallow
      a device that picked artists and then liked nothing
- [ ] 4.4 Tests for each rank, and for the no-likes-after-picking case
- [ ] 4.5 Prove the ordering can fail: a test that fails if picks are ranked below local material

## 5. Onboarding gate

- [ ] 5.1 `localStorage` "onboarding seen" flag, mirroring `installPrompt.ts` — namespaced key, try/catch,
      unreadable = not seen
- [ ] 5.2 Readable **before** IndexedDB opens; assert the dialog does not flash and vanish
- [ ] 5.3 Store `onboardingComplete` through the repository as today; the flag only gates the dialog

## 6. UI

- [ ] 6.1 `QuickPicksOnboarding` — inherits the a11y contract from `LanguageOnboarding` rather than
      dropping it: `role="dialog"`, `aria-modal`, focus on mount, Escape/backdrop dismissal,
      opener-owned focus return
- [ ] 6.2 Multi-select toggles carry `aria-pressed`, so selection is not conveyed by colour alone
- [ ] 6.3 Dismissal with nothing selected reaches the dashboard
- [ ] 6.4 Remove the `LanguageOnboarding` mount from `HomeView`; delete the component
- [ ] 6.5 Language preference stays editable in Settings — verify, do not assume

## 7. Verification

- [ ] 7.1 Prove the new persistence and gate tests can fail before trusting them
- [ ] 7.2 `npm run gate` to completion
- [ ] 7.3 `openspec validate --specs --strict`
- [ ] 7.4 Record explicitly that **no browser verification was possible**

## 8. Batch evidence

- [ ] 8.1 Six gate runs plus the corroborator, from the canonical home
- [ ] 8.2 Corroborator exit 0, six distinct digests, one commit, 0 skipped — using this tree's own
      `--expect-files` / `--expect-budget`, not the stale defaults
- [ ] 8.3 Batch commit's **tree** equals the merge commit's tree
- [ ] 8.4 Record commit, tree and `merge-base` in the **PR body**

## 9. Statements

- [ ] 9.1 State that picks are in IndexedDB, **not** localStorage, and why the literal request was
      not implemented as written
- [ ] 9.2 State that M21 CRITICAL 1 and CRITICAL 2 remain open
- [ ] 9.3 State that the language preference was kept, only the first-run question removed