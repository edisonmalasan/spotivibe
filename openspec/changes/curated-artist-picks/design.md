# Design — `curated-artist-picks`

## D1 — What is ported is the behaviour; the artist names are data and are attributed

Lyrix's `QuickPicks.tsx` holds `PICKS_BY_LANGUAGE` — 11 languages, 39 artists, each a
`{ label, query }` pair. The **behaviour** it demonstrates is: *a rail of popular artists, shaped by
the listener's language, that does not depend on the network and is never empty.*

**The behaviour is independently reimplemented.** It is not Lyrix's component, its data flow, its
SWR caching, or its card. `ROADMAP.md` §9.2 forbids *"Lyrix branding/UI components as final Spotivibe
UI"*, and `ATTRIBUTION.md` rule 1 prefers independent reimplementation informed by Lyrix behaviour over
verbatim copying.

**The artist names are Lyrix's data and are copied, so they are attributed.** A list of well-known
artists per language is a curation, not an algorithm, and re-deriving the same names while claiming
independence would be the dishonest option. So:

- the module that holds the lists carries the **MIT notice** (`ATTRIBUTION.md` rule 2);
- `ATTRIBUTION.md`'s derived-files table gains a row naming it and its source;
- the lists are keyed by **Spotivibe's own ISO 639-1 codes**, so the module is a list of this
  application's data rather than a transplant of Lyrix's.

## D2 — The mapping, and the two gaps it exposes

Lyrix's ids are its own (`hindi`); Spotivibe's are ISO 639-1 (`hi`). The mapping is not derivable —
it is a decision, and it is recorded as one:

| Lyrix | Spotivibe | | Lyrix | Spotivibe |
|---|---|---|---|---|
| `hindi` | `hi` | | `korean` | `ko` |
| `english` | `en` | | `spanish` | `es` |
| `punjabi` | **none** | | `japanese` | `ja` |
| `tamil` | `ta` | | `urdu` | `ur` |
| `telugu` | `te` | | | |
| `bengali` | `bn` | | | |
| `marathi` | `mr` | | | |

**Gap one: Punjabi is not portable.** Spotivibe's catalog has 38 entries and `pa` is not among them,
so Lyrix's 5 Punjabi artists cannot be offered. The list is **not** ported under an invented code —
a language code that does not exist is a lookup that silently never matches.

**Gap two: 28 of Spotivibe's 38 languages have no Lyrix list at all.** Lyrix's own rail renders
*nothing* for the 25 of its 37 languages it has no list for — `QuickPicks.tsx` returns `null` when the
filtered list is empty. That is a behaviour worth **not** copying, and it is the reason the
language-agnostic floor exists (D4).

**What is ported: 10 languages, 34 artists.**

## D3 — The precedence, and why the curated source sits where it does

```
explicit picks  →  local material  →  curated popular artists  →  provider results
```

**Local evidence is never displaced.** The existing rule — *"Provider results SHALL NOT contribute
entries while any local material exists"* — exists because a device with one liked track would
otherwise be flooded with unrelated artists and the one signal it has would drown. The curated source
is exactly that kind of unrelated artist, so it is subject to the same rule: it **completes** the rail
and never **leads** it.

**Curated before provider results.** A curated popular artist for the listener's language is a better
cold start than whatever the trending shelf happened to return, and it is the difference between a
rail that is *shaped by the language* and one that merely *reorders* candidates the provider happened
to send. The rail's own description already claims *"Artists from what you have played, your
languages, and what is playing now"* — and before this change "your languages" only reordered
candidates. Now it determines who is on the rail at all.

**Provider results keep their gate.** Unchanged: they contribute only when the device holds no local
material. They are the last resort because they are the only source that reflects what is happening
right now.

## D4 — The language-agnostic floor, and the one-card-per-language trap

**The floor.** A language with no list of its own is offered artists from a list that is not
language-specific. Lyrix's own default — no language selected — is `hindi + english` sliced to 10,
which is the same idea, so the floor is the ported list used the way Lyrix uses it.

**The trap.** Lyrix's **marathi** list holds exactly **one** artist. A Marathi-only selection would
therefore produce a rail of exactly one card, and the `home-mixes` spec forbids precisely that shape:
*"the number of entries never equals the number of selected languages by that coincidence."*

So the curated source **always offers at least two entries**: where a selection would yield one, it
is topped up from the floor. The rule is stated in the requirement rather than left to the
implementation, because "at least two" is a property a reader can check.

**The floor is language-agnostic, and that is the honest name for it.** It is a list of widely-known
artists, offered to a listener whose language has no list of its own because an empty rail is worse
than a generic one. Lyrix's own rail offers nothing in that case, which is a worse answer.

## D5 — The same artist, twice

The existing dedupe is by `kind:target`, and a curated entry's target is a **name** while a provider
entry's is often a **provider id**. The same artist offered by both would therefore be offered twice,
which the spec forbids.

So the curated source also dedupes by **normalized name** against what has already been collected. The
normalisation is the same one the rest of the rail uses — `groupArtistsByIdentity` already keys an
artist by its provider id when the track carried one and by its normalized name otherwise — so the two
agree on what "the same artist" means.

**The curated entries carry no artwork.** They are names, not tracks, so there is nothing to read
artwork from and the spec forbids the derivation issuing a request to obtain it. They render the
application's existing artist placeholder. **That is a visible cost**: a curated card is a placeholder
circle, where a provider-derived card is a real image. It is recorded rather than solved, because the
two ways to solve it are both forbidden — Lyrix's batch thumbnail endpoint is a request, and
Spotivibe has no provider artwork endpoint to read from.

## D6 — Where the code goes

**A new module** under `frontend/src/features/home/`, holding the per-language lists and the floor,
with the MIT notice. It is **pure data plus one pure function** — no React, no fetch, no storage — so
it can be tested without a DOM and the derivation stays pure.

**`deriveQuickPicks` gains the source.** It is already pure and already takes the selected languages,
so the curated source needs no new input. The derivation's contract is unchanged: the same inputs
always yield the same entries in the same order.

**Nothing else moves.** No route, no provider call, no new request, no stored data, no new app
directory. The shelf and the card are unchanged — the curated entries are ordinary `QuickPick`s that
the existing card already renders.

## D7 — The client bundle, and the budget this change has to answer to

The lists are static data, and the derivation is client-side, so the names land in the client bundle.
M34 established the rules: the total carries **4,096 bytes** of tolerance, and the **largest-chunk
rule carries none at all** — a rule that means different things on two machines is not a rule, and CI
measures the runner rather than the recording machine.

So this change is expected to need a **budget re-record**, and the re-record is expected to be
**measured on CI's runner** rather than on a local build. The lists are ~34 names and 10 keys; the
measurement is whatever it is, and it is recorded in `docs/MOTION.md` with the figures.

**The chunk count is the figure to watch.** A new module that is imported by the rail adds to the
main chunk; it does not add a *chunk*, because it is imported by exactly one route's graph. If the
measurement says otherwise, that is a finding.

## D8 — Rejected alternatives, with the reasons kept

| Alternative | Why not |
|---|---|
| A separate "Popular Artists" section beside Quick Picks | The `discovery` spec says *"no separate Popular Artists section SHALL render beside it"* — Quick Picks is the feed's single circular artist section. |
| Lyrix's `ArtistCard` | §9.2: Lyrix branding/UI as final Spotivibe UI. `DESIGN.md`'s circular artist card is used. |
| Lyrix's `/api/artist/thumbnails` batch lookup | The `home-mixes` spec: the derivation *"SHALL issue no request of its own to obtain"* artwork. |
| Lyrix's name-slug artist route | Spotivibe's `/artist/[key]` already resolves a text key — `artistRequestKey` returns `{ name }` for anything that is not a provider id. No route change needed. |
| Replace the derived rail with the curated one, as Lyrix has it | It would break *"Quick Picks derive from local material"* and *"Local evidence is never displaced"*. The curated list completes the rail; it does not become the rail. |
| Hand-write lists for the 28 uncovered languages | That is a curation task, not a port, and inventing artist lists for 28 languages is exactly the kind of guess this repository records rather than makes. |
| Port Lyrix's Punjabi list under a `pa` code Spotivibe does not have | A language code that does not exist is a lookup that silently never matches. |
| Fetch the lists from the server | A request, which the spec forbids for the derivation, and it would make the rail's contents depend on the network again. |
