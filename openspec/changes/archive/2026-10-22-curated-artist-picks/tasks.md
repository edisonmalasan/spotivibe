# Tasks

## 0. Baseline

- [x] 0.1 Record a green full-suite run before anything is changed: file count, test count, exit
      code. The counts are compared at §7 against this baseline.
- [x] 0.2 Record the **client bundle** as it stands, from the gate's own build: total gzipped, largest
      chunk, chunk count, and `/`'s first load. The curated lists are static data that lands in the
      client bundle, so the change's cost is a bundle figure and it is measured before and after
      rather than estimated.
- [x] 0.3 Record **how often the rail is empty today**, as a measured fact: with no explicit picks, no
      local material and no provider results, the derivation returns nothing. That is the defect this
      change removes, and it is asserted before anything changes so the "before" is a fact.

## 1. Port the curated lists (D1, D2)

- [x] 1.1 A new module under `frontend/src/features/home/` holding the per-language lists and the
      language-agnostic floor. **Pure data and one pure function** — no React, no fetch, no storage.
- [x] 1.2 The module SHALL carry the **MIT notice** required by `ATTRIBUTION.md` rule 2, and
      `ATTRIBUTION.md`'s derived-files table SHALL gain a row naming the file, its Lyrix source, and the
      nature of the derivation.
- [x] 1.3 The lists SHALL be keyed by **Spotivibe's ISO 639-1 codes**, and only by codes that exist in
      `frontend/src/lib/languages.ts`. **Punjabi is not ported** — Spotivibe has no `pa` code, and a
      language code that does not exist is a lookup that silently never matches.
- [x] 1.4 Assert the ported set: **10 languages, 33 artists**, and every key present in the catalog.
      A typo in a language code is a failing test rather than a silent no-op.
- [x] 1.5 The module SHALL NOT import anything from the application beyond the language catalog, and
      SHALL NOT issue a request of any kind.

## 2. Add the source to the derivation (D3, D5)

- [x] 2.1 `deriveQuickPicks` SHALL gain the curated source, ranked **after local material and explicit
      picks** and **before provider results**.
- [x] 2.2 The curated source SHALL complete the rail and never lead it: no entry derived from local
      material or from an explicit pick SHALL be displaced, outranked, or reordered.
- [x] 2.3 The derivation SHALL stay **pure and deterministic**: the same inputs yield the same entries
      in the same order, and nothing is mutated.
- [x] 2.4 The curated source SHALL dedupe by **normalized name** as well as by identity, so an artist
      offered once under a provider identity and again under a name is offered once. The normalisation
      SHALL be the same one the rest of the rail uses.
- [x] 2.5 A curated entry SHALL carry **no artwork** and SHALL render the application's existing
      artist placeholder. It SHALL NOT cause a request of any kind.

## 3. The floor, and the one-card-per-language trap (D4)

- [x] 3.1 A language with no list of its own SHALL be offered artists from the language-agnostic
      floor, so the rail does not depend on the catalog's coverage.
- [x] 3.2 The curated source SHALL **always offer at least two entries**. Lyrix's marathi list holds
      exactly one artist, and a one-card rail is the shape the `home-mixes` spec forbids.
- [x] 3.3 Assert both, for **every one of the 38 catalog languages** — not a sample: the rail is never
      empty, and it is never one card per selected language.

## 4. Prove the behaviour, and prove each detector can fail

- [x] 4.1 Green baseline first, before any mutation.
- [x] 4.2 A test proving the rail is **never empty** for a device with no picks, no local material and
      no provider results.
- [x] 4.3 A test proving a **Marathi-only** selection yields **at least two** entries.
- [x] 4.4 A test proving the curated artists offered **change with the selected languages**.
- [x] 4.5 A test proving a curated entry **resolves to the artist route** for its name, and carries no
      artwork.
- [x] 4.6 A test proving local evidence is **not displaced, outranked, or reordered** by the curated
      source.
- [x] 4.7 A test proving the same artist is offered **once** when the curated list and the provider
      material name it by different identities.
- [x] 4.8 A test proving the derivation issues **no request** while offering curated artists.
- [x] 4.9 **Each new assertion proven CAUGHT** by mutating the implementation and observing the
      expected test fail — non-zero exit **and** the expected test name in the output.
- [x] 4.10 Every source mutated for 4.9 restored **byte-for-byte**, proven by SHA-256 before and after,
      with the tree confirmed clean afterwards.
- [x] 4.11 **Re-read every existing Quick Picks test rather than keeping it.** The derivation's
      precedence changed, and a test that passed because the rail was empty now passes for a different
      reason.
- [x] 4.12 No existing test may be weakened to make this change pass.

## 5. Measure the bundle, and answer to the budget (D7)

- [x] 5.1 Measure the bundle after the change, from the gate's own build, and compare it with §0.2.
- [x] 5.2 The **chunk count** is the figure to watch: a module imported by one route's graph adds to a
      chunk, it does not add a chunk. If it does, that is a finding and not a surprise.
- [x] 5.3 If the largest chunk moves, the budget's record SHALL be re-recorded **with the figure CI
      measured**, because the largest-chunk rule carries no tolerance and a rule that means different
      things on two machines is not a rule (M34's finding). The re-record SHALL name the move and its
      cost in `docs/MOTION.md`, the way every earlier re-record does.
- [x] 5.4 The re-record SHALL preserve the record it replaced, so the earlier milestone's published
      figure is not restated by a later ceiling.

## 6. Record the limits, honestly

- [x] 6.1 The curated cards render a **placeholder**, not artwork, and the derivation may not fetch one.
      That is visible, and it is recorded in `design.md` D5 rather than left to be discovered.
- [x] 6.2 **28 of the 38 catalog languages have no list of their own** and are offered the
      language-agnostic floor. The port covers what Lyrix covers; the rest is a curation task and is
      **not** invented here.
- [x] 6.3 The floor is **generic**. It is a better answer than an empty rail and a worse answer than a
      language-matched one, and both halves of that are stated.

## 7. Verify the whole change

- [x] 7.1 `npm run gate` exit 0.
- [x] 7.2 Test file and test counts compared against §0.1; no existing file lost a test.
- [x] 7.3 `openspec validate curated-artist-picks --strict` exit 0.
- [x] 7.4 `openspec validate --specs --strict` exit 0.
- [x] 7.5 Diff reviewed for scope: `features/home/`, `ATTRIBUTION.md`, `docs/MOTION.md`, the budget
      record, and the spec delta. **No new route, no provider request, no dependency, no manifest, no
      gate step, no CI change, and no production code outside the Quick Picks derivation and its shelf.**
- [x] 7.6 The delta SHALL be checked for loss with a tool that distinguishes *modified* from *lost*, and
      the tool's report read: every modification deliberate, nothing dropped.
- [x] 7.7 Evidence reports only what was run. Anything not run is recorded as UNVERIFIED with the
      reason. **UNVERIFIED unless a browser is attached:** anything visual — including what a curated
      card looks like without artwork.

## 8. Out of scope, recorded not absorbed

- [x] 8.1 **`discovery/spec.md` still says "First run offers language selection"**, which the code
      contradicts, and the same requirement's feed-gating half is still unmet (M34 §8.1 and §8.2).
      Both need a change that owns the first-run requirement as a whole.
- [x] 8.2 The **Settings host** for the artist re-entry (M34 §8.5): 6,987 gzipped bytes and a 26th
      chunk against a 4,096-byte tolerance. It needs a change that owns the client budget.
- [x] 8.3 The root lockfile guard gap (M34 §8.6) — **live**, and the stray files are not this
      change's to delete.
- [x] 8.4 The unidentified intermittent failure (M34 §8.3), and M31–M34's carried-forward items,
      including no gate batch run for M31, M32, M33 or M34.

## 9. What actually happened

**Three implementation rounds, and two of them were corrections the design did not ask for.**

- **Round 1** built the module, the derivation pass, the dedupe and the floor, and ran **19 mutation
  probes, all CAUGHT**. It also reported the honest cost: a cold-start rail becomes *6 curated
  placeholder cards + 2 provider cards with artwork*, because a curated entry is a *name* and has no
  artwork of its own.
- **Round 2** fixed that cost. The requirement's artwork clause already said artwork *"SHALL resolve
  from artwork already carried by the candidate tracks"*, and a curated artist whose name matches an
  artist in the candidate tracks has exactly that. The lookup is **exact whole-key equality** on the
  normalized name, so it can only ever match the same name. Round 2 also **dropped Lyrix's
  `Anime OST`**: it is a *category*, not an artist, and the requirement says every Quick Pick SHALL be
  a resolvable artist. The ported set became **10 languages, 33 artists**.
- **Round 3** fixed a conformance issue round 2 introduced. A curated entry that won the name-dedupe
  over the provider's own entry made the card link by *name* when a **provider identity** was available
  — and the requirement says a Quick Pick navigates *"using the provider artist identity when the entry
  has one"*. A curated entry now takes that identity, and that artwork, from the candidate tracks.
  **34 probes, all CAUGHT.**

**Two probes went MISSED and were fixed rather than excused.** Round 2's name-dedupe probes stopped
failing their round-1 tests, because once a curated entry carries the provider identity the *identity*
dedupe catches those duplicates and the name dedupe is no longer the thing doing it. The two tests
were **not** weakened: both assertions were kept, their comments corrected (they had claimed the name
dedupe was the only thing that could catch them, which had become false), and a **new** test was added
for the case only the name dedupe can catch — one artist credited under two different provider ids.

**A second probe went MISSED for a mechanical reason and was fixed the same way:** prettier had reflowed
the `hi:` list to several lines, so the mutation's anchor no longer matched.

**The budget moved by +658 bytes and not one chunk.** 25 chunks before, 25 after, and `/`'s first load
still loads 13. The **largest chunk did not move at all**, so the one ceiling rule that carries no
tolerance needed no re-record of its own, and the record keeps the CI-measured 97,538. The total
carries 4,096 bytes of tolerance and re-recorded at the locally measured figure — **and that figure
must be confirmed on CI's runner**, because this machine measures the same build 4 B below the record
and a rule that means different things on two machines is not a rule.

**Two consequences of the curated source are recorded rather than hidden**, and no branch was deleted
for either:

- **The rail's error, empty and loading states are now unreachable.** The rail always holds artists, so
  it is "ready" from the first paint. A provider failure is no longer shown *on the rail* — it is
  reported by the trending shelf, which is where the failure belongs. The requirement's
  settled-with-no-artists path and its code are left intact, because there is no authority to remove
  them, and it stays covered by a direct test.
- **A device with local material sees the curated artists on the first paint and its own artists once
  the stores hydrate.** That is a content swap in the rail, and it is stated rather than discovered.

**A third consequence is a *precision* one, and round 3 fixed it:** a curated artist whose name matched
a provider artist by id but not by name — `Anirudh` against `Anirudh Ravichander`, and
`A.R. Rahman Tamil` against `A.R. Rahman` — would have taken the wrong picture and the wrong identity.
Both are asserted not to match, and two probes mutate the lookup into an `includes` match to prove the
tests can tell.

**UNVERIFIED:** no browser was attached at any point, so what a curated card looks like with a candidate
track's artwork, and with the placeholder, is unverified by eye.
