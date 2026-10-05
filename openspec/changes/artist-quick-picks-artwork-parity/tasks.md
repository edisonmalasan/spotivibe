# Tasks — Lyrix-style artist Quick Picks and Home artwork parity

Checkboxes record **what actually ran**, not what was intended. Anything not executed is left
unchecked and its blocker is named. A red mutation control voids every other row, so the control
runs first.

## 1. Pre-flight

- [x] 1.1 Working tree clean on updated `main`; no unrelated active OpenSpec change conflicts
- [x] 1.2 Production before-picture recorded: Quick Picks' seven cold-start targets, the `English`
      search card on a fresh profile, the Quick Picks/Popular Artists prefix overlap, and the
      failing `yt3` image loads. Recorded in `ROADMAP.md` §21.8 and `proposal.md`
- [x] 1.3 `grep`ped every consumer of the `popular-artists` section id and of `QUICK_PICK_KINDS`
      before changing either. Consumers found: `homeSections.ts`, `HomeView.tsx`,
      `home-sections.test.ts`, `home-view.test.tsx`, `routes.test.tsx`,
      `search-entry-points.test.tsx`

## 2. Quick Picks becomes an artist rail

- [x] 2.1 `QUICK_PICK_KINDS` narrowed to `["artist"]`; `collectReleases`, the `search`/`album`
      branches in `quickPickHref`, and the `standInLimit` reservation deleted
- [x] 2.2 Language-aware stable partition (D2) implemented as `byLanguagePreference` over
      `collectCandidates` output: matched artists first, remainder after, nothing removed
- [x] 2.3 `QUICK_PICKS_DESCRIPTION` no longer claims the rail offers searches/releases; the
      stand-in's `material.length === 0` gate kept, so the warm path is untouched
- [x] 2.4 `QuickPicksShelf` renders every entry with the circular `ArtistCard`, the artist name,
      the `Artist` label, real artwork when present, the existing placeholder when not; anchors are
      keyboard operable
- [x] 2.5 `data-testid="home-artist-card"` preserved, now on the card inside the `quick-pick`
      anchor. `ArtistCard` gained an optional `testId` prop because one element cannot carry two ids
- [x] 2.6 `popular-artists` removed from `homeSections.ts` and its `Shelf` case removed from
      `HomeView.tsx`
- [x] 2.7 `HomeView` still passes `[...feed.trending.tracks, ...feed.collections.tracks]`. No new
      request: asserted by `tests/home-view.test.tsx` ("completes Quick Picks from the feed it
      already fetched, with no extra request"). No new persisted state

**Not in the proposal, found during apply.** The removed section carried the trending feed's
provider error state onto the artist rail. Consolidating without carrying it would have left a
silently empty rail, so `QuickPicksShelf` takes `providerState`/`onRetry` and shows the error only
when the rail is empty *and* the provider failed. Local taste fills the rail first, so a provider
failure never hides artists the device already knows. Both halves are asserted in
`tests/home-view.test.tsx`.

## 3. Artwork parity

- [x] 3.1 `yt3.googleusercontent.com` and the three other fixture-measured artwork hosts added to
      `CLIENT_IMAGE_ORIGINS`; the comment claiming `i.ytimg.com` is the artwork origin corrected —
      Invidious and Piped return *proxied* thumbnails pointing at the instance itself, so the
      browser really does contact provider origins for artwork
- [x] 3.2 `tests/security-policy.test.ts` now derives artwork origins from
      `tests/fixtures/providers/*.json` by JSON-walking only the keys providers actually extract
      (`videoThumbnails`, `thumbnails`, `thumbnail`); the client-source scan is retained
- [x] 3.3 Detector proven able to fail: removing `yt3` from the policy with fixtures unchanged
      turned **2 tests red on the intended clause**; source restored byte-identical
- [x] 3.4 `deriveMixPreviewCollage` draws each card's preview from the tracks its own
      `seedTerms` select, using the two slices `MixCards` already receives. No provider request per
      card, asserted at the maximum eight-language card count
- [x] 3.5 A generated mix's cover still replaces the preview, derived from the mix's own tracks;
      generation still happens only on activation
- [x] 3.6 Playlist artwork verified end-to-end. **Found and fixed:** `LibraryView` derived a cover
      from tracks while `Sidebar` and `PlaylistDetailView` preferred the playlist's own artwork, so
      one record showed two pictures depending on where you looked. The preference moved into
      `derivePlaylistArtwork` itself so all three agree by construction

## 4. Tests

- [x] 4.1 Eight selected languages + valid provider artists → artist cards, **zero** search cards
- [x] 4.2 Changing only the selected languages reorders artist candidates; every entry stays an
      artist
- [x] 4.3 Every Quick Pick resolves to `/artist/[key]`, by provider id and by text key
- [x] 4.4 Duplicate artists deduplicated by canonical identity
- [x] 4.5 Artist artwork renders when the provider supplied it
- [x] 4.6 Missing artist artwork uses the existing placeholder
- [x] 4.7 Circular artist geometry with an `Artist` label
- [x] 4.8 Activation reaches the artist route
- [x] 4.9 No new persisted user profile/state
- [x] 4.10 No account/auth dependency introduced — `package.json` untouched this milestone
- [x] 4.11 Collage: 1 cover → one image; 2–4 → 2×2; 0 → placeholder; usable artwork never
      replaced by a generic placeholder
- [x] 4.12 Home mix preview issues no provider request per card
- [x] 4.13 Generated mix resolves its cover from its own tracks
- [x] 4.14 Library playlist card, sidebar, and detail all use real available artwork
- [ ] 4.15 Compact and desktop layouts remain usable — **browser verification, section 7; not yet
      run**
- [x] 4.16 Exactly one circular artist section renders, and none adjacent — asserted in
      `tests/home-sections.test.ts` over every combination of local signals and in
      `tests/routes.test.tsx` over the rendered feed
- [x] 4.17 Existing tests encoding the superseded language-card behaviour updated
- [x] 4.18 No regression in playback, queue, personalization, PWA, download, lyrics, shortcuts —
      full suite green at 3389 tests

## 5. Mutation evidence

All six rows were run against the finished tree, with a green control first and the source restored
byte-for-byte after each. Recorded which test went red, not merely that something did.

- [x] 5.1 **Control run green FIRST; abort the suite if not** — 182 files / 3389 tests green,
      abort criteria not triggered
- [x] 5.2 Restore the language-card pass → **red.** 22 tests failed, headed by "recognises exactly
      one kind", "emits no release entry for a track that names an album", and "offers no entry of
      any other kind, at any language count"
- [x] 5.3 Restore the slot reservation (`MAX_QUICK_PICKS - selected.size`) → **red.** 3 tests
      failed, all three in "a full set of selected languages still permits artists"
- [x] 5.4 Remove the language partition → **red.** 2 tests failed: "prefers artists whose tracks
      carry a selected language" and "keeps first-appearance order within each half"
- [x] 5.5 Remove `yt3` from `img-src` → **red.** 2 tests red on the fixture-derived clause
- [x] 5.6 Break the collage 1/2–4/0 branches → **red, in both halves.** Collapsing every count to
      the single branch: 2 tests red. Removing the placeholder branch so an artwork-less mix claims
      a cover: 2 tests red, including "falls back to the placeholder when the library carries no
      artwork"
- [x] 5.7 Every row above recorded its failing test names; `git status` clean and full suite green
      after restoration

**Extra row, not in the plan.** The playlist own-artwork preference added in 3.6 is load-bearing
for three surfaces, so it was proven too: removing the preference from `derivePlaylistArtwork`
turned **3 tests red** across `playlist-presentation.test.ts` and `library-surface.test.tsx`.

## 6. Verification

- [ ] 6.1 Independent read-only verification against the change artifacts — **not yet run**
- [ ] 6.2 Repair every CRITICAL; rerun — **blocked on 6.1**
- [x] 6.3 `openspec validate artist-quick-picks-artwork-parity --strict` → valid;
      `openspec validate --specs --strict` → 27 passed, 0 failed
- [x] 6.4 Full gate from the repo root, build before test: `npm run gate` → **exit 0**
      (lint 0 problems, format clean, typecheck 0 errors, build compiled, 182 files / 3389 tests)
- [x] 6.5 Client-bundle delta recorded against a `main` control build: `main` at `e3c39a4`
      reproduced M22's record **byte for byte** (26 chunks / 389,572 B), so the delta is
      attributable. M23's own figure is **25 chunks / 388,571 B** — a *reduction* of 1,001 B,
      because consolidating two overlapping sections removed one. M22's record preserved as
      `M22_CLIENT_BUDGET`

## 7. Browser verification

- [ ] 7.1 1280×900 and 390×844 against the M23 preview
- [ ] 7.2 Fresh profile / default language; two languages; eight languages; local history present;
      no local history
- [ ] 7.3 Evidence: artist Quick Picks render circular artwork; eight languages produce **no**
      language cards; labels readable; cards navigate to artist pages; artist page images and
      releases render
- [ ] 7.4 Evidence: mix/playlist artwork appears where real source art exists; 2×2 collages crop
      correctly; no broken-image icons; shelves scroll; no colliding circular shelves; reduced
      motion correct
- [ ] 7.5 Confirm artist artwork now loads by measuring `naturalWidth > 0` in-page

**Blocked, and honestly so.** The in-app `browser` catalog tools report
`[browser.disconnected] No desktop browser is connected to this session`, and that cannot be fixed
from inside the tools. `orca computer` GUI keyboard input fails with `window_not_focused` even with
`--restore-window`. Section 7 therefore requires either a connected desktop browser or an operator
running the steps by hand. Nothing in section 7 is claimed as verified.

## 8. Lifecycle

- [ ] 8.1 Apply PR opened and merged with a **merge commit**
- [ ] 8.2 Specs synced into `openspec/specs/`
- [ ] 8.3 Change archived

## 9. Residuals recorded, not smuggled in

- The CSP is static while `SPOTIVIBE_INVIDIOUS_INSTANCES` is runtime-configurable, so a custom
  instance's proxied artwork would still be refused. The durable fix is canonicalising artwork URLs
  at the adapter boundary, which is a different change.
- `PlaylistsRepository.update` ignores an `artwork` patch, so a playlist's own artwork can only
  arrive at creation or through import. Found while writing the 3.6 tests.
- `yt3.ggpht.com` occurs 380+ times under `authorThumbnails`, which Spotivibe never reads. It is
  permitted because it also serves track artwork, not because of `authorThumbnails`.
