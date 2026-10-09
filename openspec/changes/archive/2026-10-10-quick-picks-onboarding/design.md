# Design: a first-run artist picker with two-store persistence

## The decision that shapes everything else

The request was "quick picks should use localStorage to save". Read literally that is one store. It
cannot work, and the reason is worth stating plainly rather than implementing anyway:

localStorage is not cleared by IndexedDB eviction but **is** cleared by a browser cache clear, is not
included in the versioned JSON export, and is invisible to the backup/import path that `AGENTS.md`
makes canonical. Storing picked artists there means a listener who picks five artists, clears their
browser data, and returns finds all five forgotten. The application is accountless and local-first;
its persistence story *is* the backup file.

So the picks go to IndexedDB. This is a deliberate divergence from the literal request, and it is
recorded here so the next reader sees the reasoning rather than the divergence.

What localStorage *does* hold is the one thing that genuinely belongs there: a "has seen onboarding"
flag. `installPrompt.ts` already establishes the pattern and, more importantly, the reason —

> it must be readable before the IndexedDB repositories open (the affordance must not need a
> database round trip to decide whether to nag)

The same constraint applies exactly. An onboarding gate decided after the database opens would flash
the dialog across the first paint and then dismiss it, which is worse than not having onboarding.

## Schema

A v3 migration, appended to `SCHEMA_MIGRATIONS`, following the M11 mixes precedent precisely:
idempotent guard, because a database created fresh at v3 already has the store from
`createInitialSchema`.

```
{ name: STORE.quickPickPicks, options: { keyPath: "artistId" },
  indexes: [{ name: "byPickedAt", keyPath: "pickedAt" }] }
```

Keyed by artist identity, so picking is idempotent and un-picking is a delete — the same shape as
`likedTracks` keyed by `trackId`.

## Backup

`quickPickPicks` joins the envelope as an **optional** dataset, exactly as `mixes` did in M11. A v1
envelope exported before this change carries no such key and must keep importing cleanly; `mixes` set
the precedent and the `local-data` spec already requires it for that dataset. Optional, not required
— making it required would break every existing export file in the wild.

`apply.ts`'s `SUPPORTED_DATASETS` gains the name so merge and replace both cover it. Omitting it
would produce an envelope that exports the picks and silently drops them on import, which is worse
than not shipping the feature.

## Derivation: a third source, not a replacement

`deriveQuickPicks` currently reads two sources: local material, or provider results when there is
none. Explicit picks become a third, and the ordering rule is the whole design question:

    explicit picks → liked/plays → provider results

Picks lead because they are the only evidence the listener *gave*. A liked track is evidence they
acted on; a provider artist is evidence nobody chose. But the derivation is **not** replaced: a
device with picks still gets its rail updated as it listens, which is the behaviour the existing
spec protects and which freezing the rail would destroy.

The gate `material.length === 0` is the subtle part. Picks must not be gated behind it — otherwise a
device that picked five artists and then liked nothing would silently fall through to provider
results and lose its own choices. The existing cold-start stand-in is bypassed when picks exist.

## Options rejected

**A. Store picks in localStorage.** Rejected above: loses data on cache clear, outside the backup
envelope, contradicts local-first persistence.

**B. Gate only — show the rail, remember nothing.** Rejected by the user's explicit choice of a real
picker. Recorded because it was the smaller change and remains the fallback if explicit picks prove
unwanted.

**C. Remove languages entirely, including from Settings.** Rejected: the user chose to keep the
preference. Discovery and mix plans filter on it, so removal is a much larger change than the
onboarding question.

**D. Reuse the `mixes` store for picks.** Rejected: mixes are derived and disposable; picks are
stated by the listener. Mixing them would make a backup restore resurrect picks the listener never
made.

## Accessibility

`LanguageOnboarding` implements a real a11y contract — `role="dialog"`, `aria-modal`, focus on
mount, Escape/backdrop dismissal, opener-owned focus return. The picker replaces it and **inherits
that contract rather than dropping it**. Multi-select adds `aria-pressed` on each artist toggle so
selection is announced, not conveyed by colour alone.

## Scope

New: migration, store definition, repository, zustand store, onboarding component, picker surface.
Modified: `deriveQuickPicks`, `HomeView`, backup schema, `apply.ts`, delete `LanguageOnboarding`.
Tests for each.