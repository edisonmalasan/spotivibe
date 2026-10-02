# Proposal: M18 — Keyboard shortcuts, search suggestions, and sharing

## Why

Three things a listener does constantly are all awkward in Spotivibe right now.

**There are no keyboard shortcuts at all.** The player has `toggleMute`, `seek`, `setVolume`, and
`play`/`pause` in its store, and seven components already bind individual keys — but nothing binds
them at the application level. A listener has to reach for the player bar to pause. Meanwhile the
naive way to add shortcuts is the dangerous one: a global `ArrowLeft` that overrides the progress
slider, or a `Space` that fires while someone is typing a playlist name. A shortcut that breaks typing
is worse than no shortcut, and this milestone's own completion criteria say that must be *verified by
test*, not by inspection.

**Search is a dead end for refinement.** `useSearchController` is careful — 300 ms debounce, an
`AbortController` per request, a monotonic sequence guard — and the empty surface is one static
sentence. Someone who half-remembers a song has no way to narrow toward it, and someone who searched
for something yesterday has no way back to it except the browser's own history.

**Nothing is shareable.** There is no `navigator.share` call, no clipboard call, and no toast system
anywhere in the repository. A listener who finds an album has no way to send it to anyone.

Lyrix has shortcuts and sharing. Its `useKeyboardShortcuts.ts` fakes mute by setting volume to `0` and
restoring a hardcoded `70`, which destroys the listener's actual volume — and its `isContentEditable`
check is insufficient, because a focused `role="slider"` or a dialog's own key handling is equally "a
key with local meaning". Both are the specific mistakes worth not repeating.

## What Changes

### Keyboard shortcuts

- **A global binding set**: `Space` play/pause, `ArrowLeft`/`ArrowRight` seek ±10 s, `ArrowUp`/`ArrowDown`
  volume ±5, `M` mute, `L` like/unlike the now-playing track, `?` help, `Escape` dismiss.
- **One guard, one place.** A pure predicate decides whether the key that just fired had *local
  meaning* — an input, textarea, select, `contenteditable`, a `role="slider"`, a dialog, or a menu. If
  it did, the global handler does nothing. Because it is a pure function over an element, it is
  testable without a browser, which is the only way this property can honestly be verified.
- **Real state, not faked.** `M` calls the store's real `toggleMute`. Raising volume while muted
  unmutes, because otherwise the keypress looks broken.
- **A discoverable help surface** listing every binding, reachable by pointer as well as by key, on a
  new `Dialog` design-system primitive that actually traps focus and restores it on close. No such
  primitive exists today; five dialogs hand-roll the pattern and none of them traps.

### Search suggestions

- **Query-derived refinements and local recent searches**, offered as a suggestion list under the
  search field as the listener types.
- **`useSearchController` is not modified.** Its contract — debounce, abort-on-change, URL
  synchronisation, local history recording — is unchanged and asserted unchanged. Suggestions ride a
  separate lane with their own debounce and their own abort, because two lanes that share one timer
  are how a stale suggestion ends up rendered against a superseded query.
- **A combobox.** The repository has no `role="combobox"`/`listbox`/`option` anywhere, so this
  establishes the pattern: combobox input, listbox popup, `aria-activedescendant` for the active
  option, full keyboard traversal, and `Escape` returning focus to the field.

### Sharing

- **`navigator.share()` where available, clipboard copy-link as the fallback**, with a `role="status"`
  confirmation either way. No Web Share API is a supported path, not an error path.
- **A track shares a Spotivibe search URL** built from its artist and title through the existing
  `buildSearchUrl`. Album, artist, and playlist surfaces share their real href.
- **No toast system is invented.** The repository's existing pattern is a per-surface
  `role="status"` region, and the share confirmation is one of those.

## Two decisions taken deliberately

**No `/track/[id]` route.** A track has no Spotivibe URL — M9 deliberately omitted a track page — so a
track shares a search URL that resolves to it rather than a new route that would need its own `catalog`
delta, its own page, and its own lifecycle. This is a lossy representation and is recorded as such.

**Provider-derived discovery on an empty or failed search is deferred.** `ROADMAP.md` lists it as
*optional*, and it is a new provider data path with its own loading, error, and offline behaviour.
Deferring it keeps the milestone to two features that reuse existing paths. It is recorded as a
non-goal below rather than quietly dropped.

## Impact

- **Affected specs:** `keyboard-shortcuts` (new), `sharing` (new), `search` (one added requirement).
- **No existing requirement is modified.** That is a deliberate choice, not an oversight: every
  behaviour these three features add is additive, and no existing scenario stops being true. It also
  means the Sync stage has no lossy-merge surface to guard — which is exactly the failure mode M17's
  spec delta demonstrated at scale.
- **New dependencies:** none. `@testing-library/user-event` is **not** added; the repository
  simulates keys with `fireEvent.keyDown` and this milestone follows that.
- **No migration, no new IndexedDB store.** Recent searches already exist in `searchHistory`; sharing
  persists nothing.
- **Risks:** a global listener is the highest-blast-radius change in the post-v1 programme. It is
  mitigated by the local-meaning guard being a pure predicate with an induced-violation case per
  surface type, and by the seven existing document-level handlers being enumerated as tests rather
  than assumed.