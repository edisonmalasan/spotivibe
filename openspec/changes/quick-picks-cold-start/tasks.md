# Tasks

## 1. Derivation

- [ ] 1.1 Add `readonly providerTracks?: readonly Track[]` to `QuickPickInput`, documented as the
      results the Home surface already holds and as used only when there is no local material.
- [ ] 1.2 Extract the artist pass and the release pass into `collectArtists` and `collectReleases`,
      each taking `(picks, seen, material, limit)` so both call sites share one implementation.
      `collect` keeps its single responsibility — resolvable, unseen, not full.
- [ ] 1.3 Compute `languageCodes` once, above the passes, from `normalizeLanguageCodes(input.languages)`.
- [ ] 1.4 Add the stand-in: `const standIn = material.length === 0 ? (input.providerTracks ?? []) : []`.
      Run `collectArtists` then `collectReleases` over it, with
      `limit = Math.max(0, MAX_QUICK_PICKS - languageCodes.length)`, immediately before the
      language loop.
- [ ] 1.5 Correct the doc comment that claims the shared bound stops artists pushing the language
      entries out. State what the code does. Do **not** change the behaviour — the warm path must
      not move. Record the remaining inaccuracy in `ROADMAP.md` §21.7 if not already there.
- [ ] 1.6 Update the module header: the contract is no longer "only what the device already holds",
      and the fourth specified source is now read. Name that it is read from the feed's existing
      results, so no reader takes it for a new request.

## 2. Shelf and wiring

- [ ] 2.1 `QuickPicksShelf` accepts `providerTracks` and forwards it into the derivation input.
- [ ] 2.2 `HomeView` passes `[...feed.trending.tracks, ...feed.collections.tracks]` to the shelf.
      Confirm neither is behind a section-visibility gate — both `useDiscoveryShelf` calls run
      unconditionally — and add a comment saying the rail reads the fetch, not the section.
- [ ] 2.3 Confirm no explained-empty state is added, per the withdrawal recorded in `ROADMAP.md`
      §21.7: `normalizeLanguageCodes` guarantees the language pass always contributes.

## 3. Tests

- [ ] 3.1 Cold start: no liked tracks, no events, provider tracks supplied → artist and release
      entries appear **ahead of** the language entry, and each resolves.
- [ ] 3.2 Warm path invariance: with liked tracks or events, `deriveQuickPicks` called **with**
      `providerTracks` deep-equals the same call **without** it. Assert equality of the whole
      array, not of a length.
- [ ] 3.3 Slot reservation: no local material and more provider results than the bound → the entry
      for the default language is still present. Repeat with three selected languages.
- [ ] 3.4 HomeView wiring: a rendered assertion that the shelf receives the feed's provider
      results. If this cannot be closed honestly, report it unverified — do not mark it done.
- [ ] 3.5 Degradation: `providerTracks: []` on a cold device → exactly today's single language
      entry, unchanged.
- [ ] 3.6 Coverage limit recorded: a track with no album metadata produces no release entry from
      the stand-in, matching the local pass. Assert it rather than assuming symmetry.
- [ ] 3.7 Every existing test in `home-quick-picks.test.tsx` still passes **unmodified**. Any that
      needs editing is a warm-path change and a scope violation — stop and report.

## 4. Mutation verification

- [ ] 4.1 Run an unmodified control of `home-quick-picks.test.tsx` in the same batch. Record the
      exact counts. **A red control voids every other row in this section.**
- [ ] 4.2 M1 — remove the `material.length === 0` gate so the stand-in always runs. Expect red on
      3.2. Record which test.
- [ ] 4.3 M2 — remove the language-slot reservation (`limit` becomes `MAX_QUICK_PICKS`). Expect red
      on 3.3. Record which test.
- [ ] 4.4 M3 — make the stand-in read `input.taste.likedTracks` instead of `providerTracks`. Expect
      red on 3.1. Record which test.
- [ ] 4.5 M4 — delete the stand-in entirely. Expect red on 3.1 and 3.3, and **green** on 3.2 —
      that green is the point: it shows 3.2 detects a warm-path regression rather than merely
      observing that the stand-in is absent.
- [ ] 4.6 Record each verdict as `DID NOT APPLY` / `RED BUT DID NOT RUN` / `RED` / `STILL GREEN` /
      `RED, FILE COULD NOT LOAD` / expected-green. Never collapse them into one word.

## 5. Verification and gates

- [ ] 5.1 `openspec validate quick-picks-cold-start --strict` and `openspec validate --specs --strict`.
- [ ] 5.2 `npm run lint`, `npm run format:check`, `npm run typecheck` — each 0.
- [ ] 5.3 `npm test` full, with the build present so `motion-budget.test.ts` runs its size rules
      rather than skipping them. Record the `Test Files` total from the parenthesised figure.
- [ ] 5.4 Browser verification of Home at 1280×900 and 390×844 on a fresh profile, default
      languages and two selected. **No browser automation is available on this machine and both
      Vercel origins sit behind Deployment Protection.** Record as unverified unless that changes.
- [ ] 5.5 Read `git diff` in full and confirm nothing outside §1–§3's files changed.

## 6. Lifecycle

- [ ] 6.1 Merge the Apply PR with a **merge commit** after independent read-only verification, and
      only once required checks are green.
- [ ] 6.2 Sync the delta into `openspec/specs/home-mixes/spec.md` on its own branch, then archive.