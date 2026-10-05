# Proposal

## Why

The Home Quick Picks rail is useless on a device that has no local taste yet. It renders exactly
**one** entry — a single search card for the default catalog language, with no artwork and no
artist or release behind it — directly under a heading that promises "Artists, releases, and
searches".

This is not a cold-start opinion invented now. `ROADMAP.md` §21.2 specifies Quick Picks as
derived from "selected languages, the local listening profile, liked artists/tracks, **and
existing provider results**", and the synced `home-mixes` requirement repeats the clause verbatim.
`deriveQuickPicks` accepts `languages` and `taste` and reads no fourth source; its own header
states the contract as "only what the device already holds". **The fourth specified source was
never implemented**, so the clause has been satisfied on paper and not in the product.

The source it needs already exists in memory. `HomeView` fetches `trending` and `collections`
through `useDiscoveryShelf` on the same render, unconditionally and for every device. Wiring those
results into the derivation adds **no request and no stored data** — it makes an existing fetch
count for something the specification has been claiming it counts for since M17.

## What Changes

- **`deriveQuickPicks` gains an optional `providerTracks` input.** Optional, so every existing call
  site and every existing test compiles and behaves identically without it.
- **A stand-in pass runs only when the device holds no local material** — no liked tracks and no
  listening events. It derives the same artist and release entries the local passes derive, from
  the provider results the feed already holds, and places them **before** the language entries.
- **The stand-in pass reserves slots for the language entries.** It may not fill the bound, because
  the language entry is the one thing the derivation guarantees unconditionally and the rail's last
  resort. The reservation applies to the stand-in pass only; the local passes keep today's
  behaviour byte-for-byte.
- **`HomeView` passes `feed.trending` and `feed.collections` into the shelf**, which forwards them
  to the derivation. Both are already fetched; nothing new is requested.
- **One inaccurate comment is corrected.** `deriveQuickPicks` documents that the shared bound
  means "a device with many artists cannot push the language entries out entirely". The code below
  it does not deliver that. The comment is fixed; the behaviour it misdescribes is **not** changed,
  because that would change the warm path this milestone is required not to perturb.
- **Non-breaking.** No requirement's existing scenario is weakened or removed. `QuickPicks navigate
  to existing surfaces` continues to hold for every entry, including the new ones.

Not in scope, and stated so the boundary is not read as an oversight: recommending tracks. Quick
Picks remains a shortcut rail to surfaces that exist. No entry starts playback.

## Capabilities

### New Capabilities

None. This closes a clause of already-approved scope rather than introducing a capability.

### Modified Capabilities

- `home-mixes`: the "Quick Picks lead to surfaces that exist" requirement gains the cold-start
  clause its own prose already states — that a device with no local material completes the rail
  from provider results already in memory — plus a scenario and the constraint that provider results
  never displace local evidence when local evidence exists.

`discovery` is **not** listed: its Quick Picks scenarios concern navigation, and every new entry is
subject to the identical, unchanged resolvability rule.

## Impact

- `frontend/src/features/home/quickPicks.ts` — one optional field on `QuickPickInput`; the local
  artist and release passes extracted into helpers so the stand-in pass reuses them rather than
  duplicating them; the stand-in pass itself, gated and slot-reserved.
- `frontend/src/features/home/QuickPicksShelf.tsx` — a passthrough prop.
- `frontend/src/features/home/HomeView.tsx` — passes the two provider results the feed already holds.
- `frontend/tests/home-quick-picks.test.tsx` — new clauses for the cold-start derivation, the
  warm-path invariance, the slot reservation, and the HomeView wiring.

No dependency changes. No new API route. No new persisted state, and no change to the backup
envelope. No change to `For You`'s `hasLocalArtists` gate, which is a separate decision about a
separate shelf.