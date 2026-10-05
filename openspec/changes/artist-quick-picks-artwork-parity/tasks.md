# Tasks — Lyrix-style artist Quick Picks and Home artwork parity

## 1. Pre-flight

- [ ] 1.1 Confirm working tree clean on updated `main`; no unrelated active OpenSpec change conflicts
- [ ] 1.2 Record the production pre-change state as the before-picture: Quick Picks targets, the
      `English` search card on a fresh profile, the Quick Picks/Popular Artists prefix overlap, and
      the failing `yt3` image loads
- [ ] 1.3 `grep` every consumer of the `popular-artists` section id and of `QUICK_PICK_KINDS` before
      changing either

## 2. Quick Picks becomes an artist rail

- [ ] 2.1 Narrow `QUICK_PICK_KINDS` to `["artist"]`; delete `collectReleases`, the `search`/`album`
      branches in `quickPickHref`, and the `standInLimit` reservation
- [ ] 2.2 Implement the language-aware stable partition (D2) over `groupArtistsByIdentity` output:
      artists with a selected-language track first, remainder after, nothing removed
- [ ] 2.3 Remove the `QUICK_PICKS_DESCRIPTION` claim that the rail offers searches/releases; keep the
      stand-in's `material.length === 0` gate so the warm path is untouched
- [ ] 2.4 `QuickPicksShelf`: render each entry with the circular `ArtistCard`, the artist name, the
      `Artist` label, real artwork when present, the existing placeholder when not; keyboard operable
- [ ] 2.5 Preserve `data-testid="home-artist-card"` on the Quick Picks artist cards
- [ ] 2.6 Remove the `popular-artists` entry from `homeSections.ts` and its case from `HomeView.tsx`
- [ ] 2.7 `HomeView` keeps passing `[...feed.trending.tracks, ...feed.collections.tracks]`; confirm no
      new request and no new persisted state

## 3. Artwork parity

- [ ] 3.1 Add `https://yt3.googleusercontent.com` to `CLIENT_IMAGE_ORIGINS`; correct the comment that
      claims `i.ytimg.com` is the artwork origin
- [ ] 3.2 Replace the source-text CSP origin derivation in `tests/security-policy.test.ts` with one
      that reads `tests/fixtures/providers/*.json`, retaining the client-source scan
- [ ] 3.3 Prove the new detector can fail: remove `yt3` from the policy with fixtures unchanged and
      show red; restore and show green
- [ ] 3.4 Mix cards: derive preview artwork from liked tracks/listening events via the existing
      collage rule, with no provider request per card
- [ ] 3.5 Confirm a generated mix's cover still replaces the preview from its own tracks, and that
      generation still happens only on activation
- [ ] 3.6 Verify local playlist artwork end-to-end across `LibraryView`, `Sidebar`, and
      `PlaylistDetailView`; fix any wiring or normalization gap that prevents real images appearing

## 4. Tests

- [ ] 4.1 Eight selected languages + valid provider artists → artist Quick Picks render and **zero**
      search cards
- [ ] 4.2 Changing only the selected languages reorders artist candidates while every entry stays an
      artist
- [ ] 4.3 Every Quick Pick resolves to `/artist/[key]`
- [ ] 4.4 Duplicate artists deduplicated by canonical identity
- [ ] 4.5 Artist artwork renders when the provider supplied it
- [ ] 4.6 Missing artist artwork uses the existing placeholder
- [ ] 4.7 Circular artist geometry with an `Artist` label
- [ ] 4.8 Activation reaches the artist route
- [ ] 4.9 No new persisted user profile/state
- [ ] 4.10 No account/auth dependency introduced
- [ ] 4.11 Collage: 1 cover → one image; 2–4 → 2×2; 0 → placeholder; usable artwork never replaced by
      a generic placeholder
- [ ] 4.12 Home mix preview issues no provider request per card
- [ ] 4.13 Generated mix resolves its cover from its own tracks
- [ ] 4.14 Library playlist card, sidebar, and detail all use real available artwork
- [ ] 4.15 Compact and desktop layouts remain usable
- [ ] 4.16 Exactly one circular artist section renders, and none adjacent
- [ ] 4.17 Update existing tests that encode the superseded language-card behavior
- [ ] 4.18 Confirm no regression in playback, queue, personalization, PWA, download, lyrics,
      shortcuts

## 5. Mutation evidence

- [ ] 5.1 Control run green FIRST; abort the suite if not
- [ ] 5.2 Restore the language-card pass → red (artist-only clause)
- [ ] 5.3 Restore the slot reservation → red
- [ ] 5.4 Remove the language partition → red (candidate-shaping clause)
- [ ] 5.5 Remove `yt3` from `img-src` → red (fixture-derived policy clause)
- [ ] 5.6 Break the collage 1/2–4/0 branches → red
- [ ] 5.7 Record which test went red on every row; restore source byte-for-byte after each

## 6. Verification

- [ ] 6.1 Independent read-only verification against the change artifacts
- [ ] 6.2 Repair every CRITICAL; rerun
- [ ] 6.3 `openspec validate --strict` and `openspec validate --specs --strict`
- [ ] 6.4 Full gate from the repo root, build before test
- [ ] 6.5 Record the client-bundle delta against a `main` control build

## 7. Browser verification

- [ ] 7.1 1280×900 and 390×844 against the M23 preview
- [ ] 7.2 Fresh profile / default language; two languages; eight languages; local history present;
      no local history
- [ ] 7.3 Evidence: artist Quick Picks render circular artwork; eight languages produce **no**
      language cards; labels readable; cards navigate to artist pages; artist page images and
      releases render
- [ ] 7.4 Evidence: mix/playlist artwork appears where real source art exists; 2×2 collages crop
      correctly; no broken-image icons; shelves scroll; no colliding circular shelves; reduced motion
      correct
- [ ] 7.5 Confirm artist artwork now loads (the CSP fix) by measuring `naturalWidth > 0` in-page

## 8. Lifecycle

- [ ] 8.1 Propose PR merged with a merge commit
- [ ] 8.2 Apply PR merged with a merge commit, after independent verification
- [ ] 8.3 Sync PR merged with a merge commit
- [ ] 8.4 Archive PR merged with a merge commit
- [ ] 8.5 `ROADMAP.md` M23 row updated; no active change left behind
- [ ] 8.6 Production deploy confirmed to be the merged `main` commit, then re-checked in a real
      browser