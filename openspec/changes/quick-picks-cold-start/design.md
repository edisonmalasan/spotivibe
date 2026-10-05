# Design

## Context

`deriveQuickPicks` is a pure function over two inputs and is the whole of Quick Picks' data layer.
It runs three passes in a documented order and explains that order as *the strength of the
evidence*: a liked artist is somewhere the listener has been, a release on a liked track is
somewhere they have not, and a selected language is "a way in rather than something they chose to
follow". `collect` enforces a single shared bound of `MAX_QUICK_PICKS = 8` and a resolvability
check, so every entry the function returns already renders as a working link.

Three facts shape the approach:

1. **The rail cannot be empty.** `normalizeLanguageCodes` returns `[DEFAULT_LANGUAGE]` for an empty
   or wholly invalid selection, so the language pass always contributes at least one entry. An
   explained-empty state for this shelf would be unreachable code, so one was scoped and then
   withdrawn (`ROADMAP.md` §21.7) rather than shipped untested.
2. **The source the specification names is already in memory.** `HomeView` calls
   `useDiscoveryShelf` for `trending` and `collections` unconditionally, in the same render, and
   `DiscoveryShelf.tracks` is populated whenever the shelf is ready.
3. **The warm path must not move.** Every existing test in `home-quick-picks.test.tsx` describes the
   behaviour of a device with material, and that behaviour is what other shelves and filters were
   built against. A cold-start improvement that perturbs it is a regression with a nice story.

## Goals / Non-Goals

**Goals:**

- A device with no likes and no plays sees a rail of real artists and releases, with artwork,
  instead of one bare search icon.
- A device with likes or plays renders **exactly** what it renders today.
- No new request, no new persisted state, no change to the backup envelope.
- Every entry still resolves and still renders as a real `next/link` anchor.

**Non-Goals:**

- Recommending tracks. Quick Picks stays a shortcut rail; no entry starts playback.
- Touching `For You`'s `signals.hasLocalArtists` gate, which decides a different shelf.
- Changing the warm path's treatment of the bound — including making its documentation true by
  changing the code. The comment is corrected; the behaviour is recorded as-is.
- An explained-empty state, per the withdrawal above.
- Any server-side, cross-user, or profile signal.

## Decisions

### D1 — `providerTracks` is optional, not required

`QuickPickInput` gains `readonly providerTracks?: readonly Track[]`.

**Why optional rather than required.** A required field would force every call site and every test
to state an answer to a question only Home can answer, and the compiler cannot tell a caller that
passed `[]` on purpose from one that forgot. Optional makes the omission the default and the
cold-start path opt-in, which is the honest default: a derivation that has no provider results says
so by not being given any.

**Alternative rejected:** a required field with a `feed` object parameter. That would couple the
pure module to Home's shelf shape and make the existing tests depend on a hook's return type.

### D2 — The gate is "no local material", stated as the material array being empty

```ts
const material = [...input.taste.likedTracks, ...input.taste.events.map((e) => e.track)];
const standIn = material.length === 0 ? (input.providerTracks ?? []) : [];
```

**Why this gate and not "the rail is nearly empty".** Three reasons, in order of weight.

First, it makes warm-path invariance *structural* rather than *tested*: when `material` is
non-empty the stand-in array is empty, so every downstream pass sees exactly today's input. The
requirement "a device with material is unchanged" is then true by construction instead of true
because a test noticed.

Second, "nearly empty" is unfalsifiable in a way that matters. A threshold invites the argument
that four artists is thin enough to justify overriding four artists. An emptiness test has no
tunable.

Third, the specification's own phrase is about absence: *"Where the device holds no local
material"*. The gate and the requirement use the same words, so the code cannot drift from the
contract unnoticed.

**Alternative rejected:** a minimum-count threshold with the stand-in appended after the local
passes. Softer, but it would reorder output for devices with one liked track and it makes the
result depend on a constant nobody can justify.

### D3 — The stand-in sits between the local passes and the language pass

The stand-in runs the *same* two passes as the local material (group artists, then releases),
immediately before the language loop. The existing doc comment's evidence ordering is therefore
extended rather than replaced: real local evidence, then a way in backed by what is popular right
now, then a way in backed by a preference.

**Why not last, after the languages.** On a cold device the stand-in's first entries would land
after the language cards, so the rail would open with a search icon for "English" above a specific
artist — the exact presentation the milestone exists to remove.

**Why the ordering is safe rather than merely conventional.** Because D2 makes the stand-in empty
whenever local material exists, the two orderings are never in conflict. There is no case in which
a provider result could outrank a liked artist, because there is no case in which they are
considered together.

### D4 — Two passes become helpers, not a second copy

The artist and release loops are extracted into `collectArtists(picks, seen, material, limit)` and
`collectReleases(picks, seen, material, limit)`, and both local and stand-in paths call them.

**Why.** The alternative — a second inline pair of loops over the stand-in array — is
character-identical to the first pair at the moment of writing and free to drift afterwards. Any
later change to resolvability, dedupe, artwork selection, or the bound would have to be made twice
and would be made once. The helpers take the bound as a parameter precisely because the two call
sites pass different ones (D5); that is the one real difference between them.

`collect`'s own guard is unchanged. The bound is enforced in the helpers, so `collect` keeps its
single responsibility of "resolvable, unseen, not full".

### D5 — The stand-in reserves the language slots

```ts
const languageCodes = normalizeLanguageCodes(input.languages); // moved above the passes
const standInLimit = Math.max(0, MAX_QUICK_PICKS - languageCodes.length);
```

**Why this is necessary rather than cautious.** Without it, a cold device on a healthy network
supplies more than eight trending artists; the stand-in fills the bound and the language pass
contributes nothing. The rail then contains no entry for a language at all — the rail becomes
dependent on the network for whether its guaranteed fallback exists. Reserving makes the guarantee
independent of how much the provider returns.

**Why only the stand-in.** Applying the reservation to the local passes would change the warm
path, which D2's structural guarantee depends on. The asymmetry is deliberate and is stated rather
than smoothed over: on the warm path a large local library *can* fill the bound and drop the
language entries; on the cold path it cannot.

### D6 — That asymmetry exposes a false comment, which is corrected but not fixed

`deriveQuickPicks`'s doc comment claims the shared bound means "a device with many artists cannot
push the language entries out entirely". The code beneath it does not deliver that: eight artists
fill the bound and the language loop is then a no-op.

The comment is wrong as written. It is corrected to say what the code does. The behaviour is
**not** changed, because the only fix is D5's reservation applied to the local passes, which is the
warm-path change this milestone forbids. The inaccuracy is recorded in `ROADMAP.md` §21.7 and here
so the next reader finds it stated rather than has to re-derive it from the code.

**Why not leave it.** A comment that asserts a guarantee the code does not keep is worse than no
comment: it is the kind of thing a reviewer trusts. This repository's own rule is that a statement
false as written is repaired even when its repair is documentation-only.

**Why not fix the behaviour.** See above. A recorded defect beats an unrequested behaviour change to
a path that sixteen existing tests cover.

### D7 — `trending` and `collections`, read unconditionally

`HomeView` passes `[...feed.trending.tracks, ...feed.collections.tracks]`.

**Why these two.** They are requested unconditionally for every device (`useDiscoveryShelf` is
called at the top level for both, unlike `forYou`, which is gated on `hasLocalArtists`), so both
are populated on exactly the device that needs them. They are also the two results whose content is
not a function of local taste, which is what makes them a legitimate stand-in for taste rather than
a restatement of it.

**Why reading them costs nothing.** `DiscoveryShelf.tracks` is `[]` unless the shelf is ready, so a
cold device whose discovery request failed or is still in flight passes `[]` and Quick Picks behaves
exactly as it does today. The fallback degrades to the status quo rather than to an error.

**Why their visibility does not matter.** The rail reads the fetch, not the section. `forYou` is
hidden on a cold device while its data would still be available; a shortcut rail surfacing a
popular artist is not a leak of anything the device did not already receive in that same render.
Whether the trending *section* is displayed is a layout decision and is deliberately not consulted.

**The one configuration where the stand-in contributes nothing, recorded rather than left to be
discovered.** `MAX_SELECTED_LANGUAGES` is 8 and `MAX_QUICK_PICKS` is 8, so a device that has
selected eight languages computes `standInLimit = 0` and both helpers return on their first
iteration: eight search cards, no provider entry. That is the boundary of this decision, found by
review rather than by a user, and it is deliberate — D5's purpose is to stop provider volume from
crowding out the language entries, so a listener who has explicitly selected as many languages as
the rail has slots gets exactly those. It is still strictly better than the pre-M22 behaviour (the
same device got those same eight language cards and nothing else), but it is **not** the
improvement, so the requirement now states it as its own scenario and a test pins both sides of the
boundary. Left unstated, it would have been a spec clause that quietly did not hold.

**Alternative rejected — clamping the reservation** so the stand-in always keeps a slot or two. It
would make the stand-in win at eight languages, at the cost of hiding two of the eight languages a
listener explicitly chose. That is a product decision about which promise matters more, it is not
this milestone's to make unilaterally, and it would change what the language pass promises. If the
cold-start rail should win at full language selection, that is a separate, deliberate change.

**Alternative rejected — a dedicated provider request for Quick Picks.** It would be the only fetch
in Home whose sole purpose is a shortcut rail, contradicting "no new request" in the requirement.

### D8 — Verified by mutation, not by assertion

The new clauses are shown load-bearing by breaking each one and recording **which** test went red,
against an **unmodified control** run of the same file in the same batch. A red control voids every
other row. Each verdict is recorded as `DID NOT APPLY` / `RED BUT DID NOT RUN` / `RED` / `STILL
GREEN` / `RED, FILE COULD NOT LOAD` / expected-green, never collapsed into a single word.

The clause this is most able to fool is warm-path invariance, because a mutation that *also*
removes the stand-in entirely would keep it green. M4 below is therefore written to remove only the
gate, leaving the stand-in reachable, which is the mutation that can actually detect a regression
here.

### D9 — The client-bundle ceiling is re-recorded, against a `main` control

This change adds first-party code to the client, so `motion-budget.test.ts` went **red**: 26
emitted chunks against a ceiling of 25, and `/` first load at 14 chunks against 13. The byte
figures were *inside* the recorded tolerance (389,564 B against a 392,088 B ceiling); only the
two chunk-count assertions failed.

**The control, and why it was necessary.** Before attributing anything, `main` at `0401573` was
built from a clean `.next` and measured. It reproduced M20's record **byte for byte** — 25 chunks,
387,992 B, largest 96,667, `/` 230,555 across 13. So the build is deterministic on this machine and
the delta is this change's. Without that control a re-record is an assumption in a measurement's
clothes.

**The finished figure is 1,580 B, not the 1,572 B the probes saw.** Independent review found that
`QUICK_PICKS_DESCRIPTION` — the one string every listener reads — still claimed the rail was derived
"from your languages and what you already played", which stopped being true when the stand-in landed.
Rewording it to name its third source cost 8 gzipped bytes. The record and its test were updated to
the finished tree rather than left describing a build that no longer exists: a criterion's
satisfaction may not outlive the tree it was measured on.

**Two probes, both on clean builds, and one hypothesis that was wrong.**

| Probe | Result | What it ruled in or out |
|---|---|---|
| Revert `HomeView`'s wiring, so nothing passes `providerTracks` | 26 chunks, 389,564 B — unchanged | The split is caused by the code being **present**, not by the new path being reachable |
| Replace the added `import type { Track }` with a `LocalTaste`-borrowed alias | 26 chunks, 389,564 B — byte-identical | The import edge is **not** the cause |

The second probe began as a hypothesis that the new type-only import had added a module edge and
so a chunk. **It was wrong**, the measurement said so, and the code was reverted to the plain
`readonly Track[]` rather than left carrying an indirection whose only justification was a false
claim. A type alias that buys nothing is worse than the import it replaced.

**The mechanism is not established, and is not claimed.** Turbopack split one chunk
(`3hx8bmalvmktu.js`) into two, with the Quick Picks module landing in its own chunk. What makes
that happen is not known from the two probes above. Chasing it further would mean writing worse
code — duplicating the artist and release passes inline to nudge a chunk graph — so the search
stopped and the result is recorded as unattributed.

**Why re-recording is the right response rather than a source change.** M20 established the
precedent in this very file, with the same shape: one extra chunk, first-party code, no dependency.
What separates both from the declined `framer-motion` spike — which cost the same *one chunk* — is
size and origin, not shape. 1,572 bytes of the project's own source sits inside the 4,096-byte
tolerance that existed before any of this; the spike measured +41.4 kB, over ten times that whole
tolerance. The manifest assertion still independently fails on any animation library appearing, so
the byte comparison is not the only guard.

**What was done to keep the history readable.** `M20_CLIENT_BUDGET` was added as its own frozen
record, exactly as `PRE_M19_CLIENT_BUDGET` was, and M20's delta test now measures against it. That
was not optional bookkeeping: the existing evidence test derived M20's cost as
`CLIENT_BUDGET − PRE_M19_CLIENT_BUDGET`, which after a re-record reports **4,733 B** — the sum of two
milestones — and would have published M20 as having spent M22's money. Each milestone's cost is now
measured against the record it replaced, and `docs/MOTION.md` carries all three.

**The uncomfortable part, stated plainly.** This change raised a budget ceiling. That is the kind of
act that deserves scrutiny rather than a commit message, so the reasoning, the control, the failed
hypothesis and the unattributed mechanism are all above rather than in a summary. What was *not*
done: no tolerance was widened, no assertion was loosened, and no source was contorted to protect a
number.

## Risks / Trade-offs

**Provider results in a rail documented as local-first.** This is the real cost, and it is why the
milestone is scoped as narrowly as it is. The stand-in means a device with no taste is offered what
is popular rather than only what it has evidence for. That is a weaker claim, and the design
accepts it: the alternative is a rail with nothing in it. Mitigations already in place — the
stand-in cannot run when local material exists (D2), it is ordered below it (D3), and every entry
still navigates somewhere real.

**Two passes over the same helper with different bounds (D5)** is the main complexity cost. It is
paid once, in a helper signature, rather than in a duplicated pair of loops that must be kept in
step for the life of the file.

**The HomeView wiring is untested by the derivation tests.** `deriveQuickPicks` can be fully
covered as a pure function while nothing proves `HomeView` actually passes `feed.trending`. Task
3.4 exists to close that gap with a rendered assertion, and if it cannot be closed honestly, it is
reported unverified rather than marked done.

**The provider request may fail.** Handled by D7: `tracks` is `[]`, the rail falls back to today's
single language entry, and nothing is claimed about a device whose network is down. This path is
covered by a test that supplies `providerTracks: []`.

**Withdrawal risk — `discovery`'s Quick Picks scenarios.** They are untouched and still hold: every
new entry goes through the same unchanged `collect` → `quickPickHref` gate. The capability is not
listed as modified because no scenario's behaviour changes, only the rail's population.