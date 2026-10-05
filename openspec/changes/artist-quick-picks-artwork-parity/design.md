# Design — Lyrix-style artist Quick Picks and Home artwork parity

## Context

Three defects, all measured against production before implementation (evidence in `proposal.md`):
the Quick Picks rail renders selected languages as `Search` cards; the Quick Picks rail and the
Popular Artists rail render the same artists; and production's `Content-Security-Policy` blocks the
artwork host its own provider payloads use, so no artist image loads.

The governing constraint is `discovery`'s "at most one circular artist section" plus `DESIGN.md`'s
rule against two adjacent circular sections. Quick Picks is becoming a circular artist rail, so
something has to give, and the choice must be deliberate rather than incidental.

## Goals

- Quick Picks is an artist rail. No language is ever a card.
- Selected languages influence which artists are surfaced.
- Real provider and local artwork renders wherever it exists.
- One circular artist section, with nothing shipped silently removed.
- Every critical clause provably able to fail.

## Non-goals

Accounts, auth, cloud state, Supabase, user database, cross-user signals. Recommending tracks.
Composing mixes on render. Reproducing Lyrix's backend.

## Decisions

### D1 — The Quick Picks rail is artist-only

`QUICK_PICK_KINDS` becomes `["artist"]`. The `search` and `album` kinds, the `collectReleases`
pass, and the `standInLimit` slot reservation are removed rather than left dormant, because a
dormant code path that the spec forbids is a path a future change will re-enable.

**Rejected:** keeping the kinds and simply not emitting language entries. It leaves the reservation
and the release pass in place, and the rail's cardinality would still vary with the language count —
which is the behaviour being removed.

**Rejected:** keeping album entries for a device with no artists. The user asked that no album or
search tile be shown "merely to fill an artist rail"; an honest shorter rail is the specified
outcome.

### D2 — Languages order candidates; they do not filter them

Every discovery track is stamped with the language of the seed that produced it
(`discovery.ts`: `language: attempt.seed.language`), so candidate artists carry language evidence.
An artist with at least one track whose language is selected outranks an artist whose tracks are all
in unselected languages.

It is a **stable partition**, not a filter: selected-language artists come first, in their existing
order, and the remainder follows. Nothing is removed.

**Why not a filter:** the rail could empty on a device whose results carry no language stamp, and
`ROADMAP.md` §21.7 already withdrew an explained-empty state once because the code could not reach
it. A stable partition degrades to the previous ordering when no stamp is present, which is also
what makes the cold and warm paths testable.

**Why this is not cosmetic:** a test that changes only `languages` and observes a different
candidate order is meaningful precisely because the tracks are unchanged — the ordering comes from
the language metadata on those tracks, and if `Track.language` were removed upstream the test would
fail rather than silently pass.

### D3 — Artist artwork comes from the candidate tracks; no adapter is added

`groupArtistsByIdentity` already reads `artworkUrl` off each artist's own tracks. Lyrix's
`/api/artist/thumbnails?names=…` is deliberately **not** reproduced: it is an Express route behind
auth, keyed by artist *name*, and `searchArtistThumbnail` returns the first artists-search result's
thumbnail without checking it is the requested artist. Spotivibe's artwork is identity-correct by
construction because it comes from tracks credited to that artist, and it costs no request.

**Consequence:** the artwork fix is the `img-src` change (D6), not a new endpoint. Requirement 11 of
the corrective brief asked whether a bounded adapter was needed; the measured answer is no.

### D4 — Quick Picks absorbs Popular Artists; the section is removed deliberately

Both rails are circular; the spec permits one. Quick Picks is kept because it is the
language-aware, locally informed rail the brief asks for, and because it already reads
`feed.collections`, which Popular Artists never did.

`homeSections.ts` drops the `popular-artists` entry, `HomeView` drops its case, and the `discovery`
spec's requirement is formally `REMOVED` with a stated reason and migration note rather than quietly
deleted. `groupArtistsByIdentity` is retained — it is the implementation Quick Picks reuses.

**Consequence:** `data-testid="home-artist-card"` moves to the Quick Picks rail, and the geometry
scenario asserting a single circular section becomes real rather than vacuous.

### D5 — Mix cards preview from local material, honestly labelled

A mix card's preview collage derives from the listener's liked tracks and listening events — data
the store already holds — using the existing `deriveMixCollage` rule (1 → single, 2–4 → 2×2, 0 →
placeholder). No request is issued per card; the request count is independent of the card count.

The preview is **not** a generated mix and the card does not describe it as one. Generation still
happens on activation, and the generated mix's own tracks replace the preview as the cover, exactly
as `MixCards.tsx` already does through `deriveMixCollage(outcome.mix.tracks)`.

**Rejected:** pre-composing every mix on render to obtain real covers. It would make Home issue one
mix generation per card per visit and would contradict the existing "cards are not composed on
render" scenario.

### D6 — The `img-src` origins are derived from captured fixtures, and the detector is replaced

`CLIENT_IMAGE_ORIGINS` gains `https://yt3.googleusercontent.com`. The justification is the captured
provider fixtures, which contain 84 `yt3` matches across five files.

`tests/security-policy.test.ts` currently scans `src/**` for host literals. That method is
**structurally incapable** of observing an origin that arrives as provider data, so it cannot be
evidence for this requirement and is replaced with one that reads
`tests/fixtures/providers/*.json`, plus the existing source scan for client-side origins.

The replacement must be shown to fail: removing `yt3` from the policy while the fixtures still carry
it must turn the test red. A guard that cannot fail is not a guard.

### D7 — No new persisted state and no account dependency

The derivation stays a pure function over its arguments. Nothing is written to IndexedDB, no
profile is introduced, and no preference is added. The backup/import schema is untouched.

## Risks

| Risk | Mitigation |
|---|---|
| Removing `popular-artists` breaks consumers | `grep` for the id across `src/`, `tests/`, and specs before merging; spec removal carries a migration note |
| Quick Picks loses its guaranteed non-empty entry | The rail is now filled by provider results that Home already fetches; an empty state is specified honestly rather than padded with a non-artist card |
| Language ordering silently becomes a no-op | A test varies only `languages` against fixed tracks; it fails if `Track.language` disappears |
| CSP broadened too far | Origins are enumerated from fixtures, and a no-unused-origin assertion prevents accumulation |
| Mix preview misread as a generated mix | Spec scenario forbids it; preview and generated cover are distinct code paths |

## Migration

`data-testid="home-artist-card"` is retained on the Quick Picks artist cards so existing assertions
keep their meaning. The `popular-artists` section id, its `HomeView` case, and its `discovery`
requirement are removed together. `QUICK_PICK_KINDS` narrows to `["artist"]`, which is a type-level
break for any caller constructing another kind — intended, and the compiler will find them.