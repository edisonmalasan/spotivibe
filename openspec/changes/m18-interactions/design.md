# Design: M18 — Keyboard shortcuts, search suggestions, and sharing

## Context

Reconnaissance over the existing code, which decides most of the questions below:

| Question | Answer found in the tree |
|---|---|
| Is there a global keydown handler? | **No.** Seven components bind individual keys. |
| What do they bind? | `ProgressSlider` (arrows ±5 s, `Home`, `End`), five dialogs (`Escape`, all but one calling `stopPropagation()`), `ResultMenu` (`Escape`, **not** stopping propagation). |
| Where can a global listener attach? | `components/layout/AppShell.tsx` is `"use client"` and is already the single mount point for `useListeningRecorder`, `attachServiceWorker`, `RefillAgent`, `RadioStartedTracker`, `PlayerHost`. **There is no provider tree**, and Zustand is read directly, so no provider rewrite is needed. |
| Is mute real? | `playerStore` has `muted: boolean` and `toggleMute()`. No Lyrix-style fake mute exists. |
| Is there a focus-trapping dialog? | **No.** Five hand-rolled dialogs; none traps focus, several only move focus on mount. |
| Does a combobox exist? | **No** `role="combobox"`/`listbox`/`option`/`aria-activedescendant` anywhere. |
| What must `useSearchController` keep? | 300 ms debounce, per-request `AbortController`, monotonic sequence guard, repository-only history recording after a settle window. Returns exactly `{ surface, retry }`. |
| Does `navigator.share` or a clipboard exist? | **Neither.** No toast system either; the pattern is per-surface `role="status"`. |
| Does a track have a URL? | **No** `/track/[id]` route and no builder. `artistHref`, `albumHref`, `buildSearchUrl` exist; `/playlist/[id]` does not even have a builder. |

## Goals / Non-Goals

**Goals**

- A listener can drive playback, volume, and likes from the keyboard without reaching for the bar.
- **No shortcut can ever fire while a key has local meaning.** Verifiable by test.
- Suggestions that narrow toward a track, and a way back to a previous search, without disturbing the
  controller that already works.
- Sharing that is honest on a browser with no Web Share API.

**Non-Goals**

- **Customisable bindings.** A binding registry is a settings surface and a migration; this milestone
  ships a fixed set.
- **Shortcuts while a modal owns the keyboard.** Five dialogs already claim `Escape`, and they win.
- **Provider-derived discovery for an empty or failed search.** Deferred; `ROADMAP.md` marks it
  optional and it is a new provider lane with its own loading, error, and offline behaviour.
- **Refactoring the five existing dialogs onto the new `Dialog` primitive.** The primitive exists
  because the help surface needs one; converting five unrelated surfaces is its own change with its own
  regression risk.
- **A toast system.** The share confirmation is a `role="status"` region, which is the pattern already
  in the repository.
- **A `/track/[id]` route.**

## Decisions

### 1. The local-meaning guard is a pure predicate, and it is the whole safety story

`keyHasLocalMeaning(target: EventTarget | null): boolean` returns `true` for `input`, `textarea`,
`select`, `contenteditable`, any element with `role="slider"` or `role="spinbutton"`, any element
inside `[role="dialog"]`, and any element inside `[role="menu"]`.

It is a pure function over an element so it can be tested directly, with one assertion per surface
type, and so there is exactly one definition of "local meaning" rather than one per handler. This is
the difference between the guard being a property and the guard being a review comment.

`contenteditable` does not occur anywhere in `frontend/src` today. It is in the predicate anyway,
because the predicate is a statement about the web platform, not about today's inventory, and a
contenteditable surface can arrive without anyone revisiting the shortcut code.

### 2. The listener attaches in the **bubble** phase on `document`

Five dialogs call `event.stopPropagation()` on `Escape`, which means a bubble-phase listener on
`document` never sees that keypress while they are open — the dismissal the roadmap's "no shortcuts
while a modal owns the keyboard" requires comes for free, from code that already exists and is already
tested. A capture-phase listener would invert that and would have to re-implement the precedence.

`ResultMenu` does **not** stop propagation, and its own `Escape` handler therefore does **not** run
first. Listeners on the same node fire in registration order, `AppShell` mounts at page load, and
`ResultMenu` registers when it opens — so the global listener normally runs **first**, and the menu's
later `stopPropagation()` is beside the point. An earlier draft of this decision asserted the opposite:
it was wrong about the mechanism, though the outcome it predicted is the right one.

The outcome holds because of the **guard**, not the order. When the menu is open, focus is on a
`role="menuitem"`, so `keyHasLocalMeaning` declines and the global handler does nothing at all. That is
why the precedence test asserts the *outcome* and not the ordering — an ordering assertion would be
asserting an accident of when effects happen to run.

The global handler does not own `Escape` dismissal. It owns `Escape` only to close the help surface,
and even that is a **backstop** rather than the dismissal path: while help is open, focus is inside the
dialog, `Dialog` stops propagation, and the guard would decline anyway. It exists for the case where
focus has been stolen from the dialog by something else.

This was previously written as two consecutive sentences that contradicted each other — "does not own
`Escape` dismissal at all" followed by "it owns `Escape` only to close the help surface". An
independent review caught the contradiction. The correction is not that the handler does not own it;
it is that owning it is a *fallback* rather than the mechanism, which is a different claim.

One consequence is user-visible and was fixed: the help row for `Escape` read "Closes the shortcut list
and nothing else", which reads as though that binding is what closes it — and it is not, because the
row is printed inside the very dialog whose own handler does the closing. The row now says what is true
from the listener's side: Escape closes this list, and an open menu or dialog keeps its own dismissal.

### 2a. Modified keys decline; `Shift` does not

A binding fires only when `Ctrl`, `Meta`, and `Alt` are all absent. Without that rule `Cmd+M` toggles
mute and `Ctrl+L` likes the track — both are browser and OS chords the application would be stealing.
`Shift` is deliberately **not** in the rule, because `?` is `Shift+/` and the letter bindings are
readable with a shift held.

This is behaviour the spec did not state, and it was added during Apply rather than left implicit: a
global handler that answers chords is a bug a user discovers by pressing a key they meant for another
application.

### 2b. `contenteditable="false"` is not editable

`[contenteditable]` matches an element whose attribute is present but `"false"`, and the platform says
such an element is *not* editable. The guard follows the platform and returns `false` there. Treating a
read-only block as a guard would disable every shortcut anywhere a read-only region happened to be on
screen — a much worse failure than the one the rule prevents.

### 3. `M` uses the real `toggleMute`, and raising volume unmutes

The store's `setVolume` does not clear `muted`. Left alone, `ArrowUp` on a muted player would change a
number the listener cannot hear. The shortcut therefore calls `toggleMute()` when it is about to raise
the volume of a muted player. This is stated as behaviour rather than left as a surprise.

### 4. A new `Dialog` design-system primitive, used by the help surface only

`role="dialog"`, `aria-modal="true"`, focus moved in on open, **Tab and Shift+Tab trapped inside**,
focus restored to the invoking element on close, `Escape` and a close button both dismissing, and
pointer dismissal via backdrop click. Five existing dialogs lack the trap; adding the primitive
without converting them is the smallest change that makes the *new* surface correct.

### 5. Suggestions ride a lane beside `useSearchController`, not inside it

`useSearchController`'s contract is load-bearing and asserted by an existing suite. Suggestions need
their own debounce (shorter — a suggestion list that lags feels broken) and their own abort. Sharing
one timer would mean a suggestion request and a results request cancelling each other, which is
exactly the "superseded request renders" bug the controller's sequence guard exists to prevent.

The controller's public surface, its `SearchSurface` union, and its behaviour are unchanged, and a test
asserts that.

### 6. The combobox pattern is established here, once

`SearchInput` gains `role="combobox"`, `aria-expanded`, `aria-controls`, and `aria-activedescendant`;
the popup is `role="listbox"` with `role="option"` children. Arrow keys move the active option,
`Enter` accepts it, `Escape` closes and returns focus to the field. Nothing else in the repository uses
these roles, so this is the pattern's first and only definition.

### 7. Sharing is one hook over two transports, and never throws at the caller

`useShare({ url, title })` returns `{ share, status, busy }`. It prefers `navigator.share`, falls back
to the clipboard, and treats **both** a missing API and a rejected promise as the fallback path rather
than an error — the user cancelling the OS share sheet is not a failure, and must not render as one.
A `role="status"` region carries the outcome.

### 8. A track's share URL is a search URL

`buildSearchUrl(\`${artistName} ${title}\`)` — an existing helper — produces a real Spotivibe URL that
resolves to the track. Album, artist, and playlist share their real hrefs. Playlist currently has no
href builder; sharing from a playlist therefore requires adding one, which is small and removes a raw
string concatenation rather than adding one.

## Risks / Trade-offs

| Risk | Trade-off accepted |
|---|---|
| A global listener breaks typing somewhere not enumerated | Accepted deliberately, and mitigated by one pure predicate with a test per surface type, plus an induced-violation case per type. This is the milestone's central correctness claim. |
| Adding `role="combobox"` changes what assistive tech announces for search | Correct per the ARIA authoring practice; the input keeps its accessible name. Covered by an assertion rather than assumed. |
| Volume unmutes on `ArrowUp` | Slightly opinionated. The alternative — volume visibly changing while muted — is worse. |
| No provider discovery on an empty search | A recorded deferral of an explicitly optional item, not a silent cut. |
| `Dialog` used by one surface | Five hand-rolled dialogs remain untrapped. Recorded as its own follow-up rather than expanding this milestone. |

## Migration

None. No schema change, no store migration, no IndexedDB version bump. Recent searches already exist;
sharing persists nothing; shortcuts touch no persisted state.

## Open Questions

- Should the help surface be reachable from a footer link as well as `?`, and does the persistent player
  region have a slot for it? Deferred to Apply: it is a placement detail, not a behavioural one.
- Should `L` operate on the now-playing track only, or on a focused row when a shelf has focus? Apply
  will bind it to the now-playing track, matching `now-playing/page.tsx`'s existing precedent, and record
  that as the behaviour rather than leaving it implied.