# Design: Radio, queue autofill, and local personalization

## Context

Constraints that shape every decision here:

- **No account, no server profile, no cross-user data** (permanent). The only personalization signal is what the app already owns locally: M7's liked tracks, M8's listening events (which already carry `secondsPlayed`, `completed`, `skipped`, and a `context`), and M8's preferences (languages).
- **The provider layer exposes no radio, related, or recommendation capability.** Every feed is composed from curated search seeds through the fixed tier chain. So "more radio" must mean *different seeds*, not a new endpoint type.
- **The M8 verification proved the hard rule**: a page may never fan out more concurrent provider work than the shared outbound budget can serve. A radio refill is a background request that can fire repeatedly, so it inherits that bound rather than inventing a new one.
- **The queue is already a mode-bearing structure** (`source`, `shuffle`, `playOrder`, `history`) with duplicate protection. A radio must not fork it.
- `QueueSource` is `search | browse | library | queue | unknown` and needs a `radio` value; `ListeningContext` already includes `"radio"`, so history was built for this.

## Goals / Non-Goals

**Goals**

- A radio that continues across multiple refill cycles without an obvious short loop.
- One implementation of "keep playing" shared by radio modes and ordinary-playback autofill.
- A local taste profile that improves ranking, is derived (never stored twice), and provably never leaves the device.
- Deterministic, testable behavior: no hidden randomness in what the app decides.

**Non-Goals (with owner milestone)**

- Smart Mixes, listening stats, streaks (M11). M10's profile is the input M11 will visualize; M11 does not change how it is built.
- Podcast radio or episode queues (M12).
- Server-side ranking of any kind, or a "for you, because other people played it" signal of any shape — permanently out of scope.
- Rewriting the queue store's playback-order machinery (M6); radio reuses it.

## Decisions

### 1. A radio is a queue mode, not a second player

**Decision.** `radioStore` holds only the *radio's* identity and bookkeeping: its seed (track or artist), the session played-id set, the refill counter, and its status. The tracks themselves live in the existing `queueStore` with `source: "radio"`, so the transport, mini-player, Now Playing, and queue view are literally the same state a normal queue is.

**Why.** A separate player would duplicate M4's transport, M6's play order, and M7's persistence, and would make "Now Playing and mini-player represent the same state" false for radios. Mode-as-store means every existing surface works on the first day.

**Alternatives considered.** A separate `radioQueue` store (rejected: two sources of truth for "what plays next", and every existing consumer would need a branch).

### 2. Refill asks for *new* material with rotating seeds, not a fixed feed

**Decision.** `GET /api/radio?kind=track|artist&title=&artist=&exclude=<ids>&limit=&variant=<n>` plans at most two seeds chosen by rotating through a curated phrase list indexed by `variant`, where `variant` is the client's own refill counter. The exclusion list is bounded (≤ 60 ids) and applied server-side after the merge. A TTL cache is keyed on the *whole* request, so identical refill requests dedupe and different cycles never collide.

**Why.** Reusing M9's `/api/artist` for an artist radio cannot work: its result is a fixed, cached, 5-minute set, so cycle 2 would return only already-played tracks and the radio would starve. Rotating curated phrases is the same mechanism M8 used to get variety out of a search-only provider (`planDiscoverySeeds`), and the client-held counter means **the server never learns how many times anyone has asked**.

**Alternatives considered.** (a) A new provider capability (does not exist). (b) Random seeds (unreproducible in tests and unfalsifiable in evidence). (c) Reuse `/api/similar` (excludes only the source track, and its seed is a single track phrase — it would loop).

### 3. The played set lives on the client and is enforced twice

**Decision.** The radio's session played-id set lives in `radioStore` and is sent with each refill as the bounded `exclude` list; the client *also* filters the returned candidates against it before appending, because the server can only honor the ids it was given. Autofill uses a different, weaker rule (see 5).

**Why.** Defense in depth where the boundary is a network call. The server-side exclusion keeps the *response* small (fewer wasted rows); the client-side filter keeps the *invariant* true even if the request is truncated, retried, or served from a cache built before a track was played.

### 4. The taste profile is a pure derivation, scored locally

**Decision.** `buildTasteProfile(input)` is a pure function over the liked dataset, the history events, and the preferences (languages); it returns weighted artists and genres, a recent-track id set, and public-text seed terms. `scoreCandidates(candidates, context)` is a second pure function that ranks candidates against that profile plus a caller-supplied clock — `ScoreContext` carries `now`, `playedIds`, a *timestamped* `playedRecently` map, and the recency window, so recency is measured by the ranker rather than delegated to the caller. The profile is computed on demand and is never persisted as a second copy of data the app already owns. **Nothing derived from it crosses the network**: a radio or autofill request carries the seed identity, the rotation index, the limit, and the exclusion list only, and the profile's entire influence is local ranking (spec `personalization` — "Ephemeral personalization, never a profile on the wire").

**Why.** The roadmap requires a local taste profile and forbids uploading it; a derived profile is trivially auditable ("clear your data → the profile is gone") and cannot drift out of sync with its sources. Persisting a derived profile would add a backup dataset and a migration for no behavioral gain.

**Scoring rules** (all deterministic, each independently testable): artist affinity (likes weigh more than plays, completions more than skips), genre/category affinity, language affinity from preferences, a **recency penalty** for tracks played inside the recent window, a **repeat penalty** for any id in the played set, and the existing provider-quality score as a floor. No randomness.

**Alternatives considered.** Storing a persisted profile (rejected above); a learned model (no training data, no server, and unexplainable results).

### 5. Radio refill and autofill share one engine, two policies

**Decision.** One agent (mounted with the persistent player, because the player is the only thing that observes "the queue is running low") decides when the queue is low and then applies a *policy*: `radio` (rotate seeds from the radio's identity, exclude the session played set) or `autofill` (seeded by the current track, excluding only the recent window, and only when the setting is on). Both go through the same request → filter → score → append path, and both are latched so a failing or slow request cannot start a loop.

**Why.** Two independent refill implementations would drift in exactly the places that matter (dedupe, latch, abort). The policies differ only in *what seeds* and *how much is excluded*, which is data, not code.

**Alternatives considered.** Autofill as a special radio (rejected: it would mark ordinary playback's queue as a radio, mislabeling history context and the queue source).

### 6. A radio is persisted with the queue it belongs to, and ends when the queue moves on

**Decision.** Two behaviors the M10 evidence run forced, both about the same seam:

1. **The radio's identity travels in the M6 session snapshot** (`SessionSnapshot.radio`: the seed — a track radio by *id only*, since the track is already in `queue` — plus the rotation counter). On a cold boot the radio is restored, the rotation resumes where it left off, and the played set is rebuilt from the session's played stack. Without this, the M10 run showed exactly the failure: a reload returned a queue still labelled "From radio" while `radioStore` was empty, so every later "refill" was silently **autofill** seeded by whatever happened to be playing. A track radio whose seed can no longer be resolved (it is not in the queue) is **not** restored — the radio's identity *is* its seed, so there is nothing to refill for, and the queue keeps playing as ordinary content rather than pretending otherwise.
2. **Ordinary playback ends the radio.** The engine watches the queue's recorded source: when it leaves `"radio"`, the radio is stopped (and any pending refill message cleared) before the next cycle. The queue keeps its tracks; only the radio identity and its refills go. Conversely a radio ends user-visibly: the Now Playing radio control *toggles* — it starts a radio when none is running and ends it when one is, which is what makes "SHALL be cancelable" a real affordance rather than a programmatic `AbortSignal`.

**Why.** A radio is a *mode of the queue* (decision 1), so the queue's own persistence is the only place its identity belongs — inventing a second store for it would be the fork decision 1 rejected. And an un-ended radio is worse than no radio: it keeps refilling somebody else's queue and keeps claiming the Now Playing indicator over content it did not start.

**Alternatives considered.** Persisting the radio as its own IndexedDB record (rejected: a second dataset for a mode of an already-persisted queue, and a backup-schema whitelist to keep in step). Ending the radio inside `queueStore.setContext` (rejected: a data-layer store would have to import a UI store; the engine already observes the source and is the component that owns the policy).

### 7. Settings gate autofill; radio needs no opt-out

**Decision.** One new preference (`autofillQueue`, default on) in the existing Settings surface. Radio is an explicit user action ("Start … radio") and is therefore never automatic.

**Why.** Autofill spends provider requests on the user's behalf, so it must be switchable; a radio only starts when the user asks for one, so gating it would be a surprise.

### 7. Clearing local data changes future personalization, and that is testable

**Decision.** No explicit invalidation: because the profile is derived, clearing likes/history/preferences changes the next profile by construction. A test clears the stores and asserts the derived profile (and the seed terms it would send) change.

**Why.** This is the acceptance criterion "clearing local history/preferences affects future local personalization", and deriving the profile is what makes it true without a cache to invalidate.

## Risks / Trade-offs

- **A cold device has nothing to personalize with.** The first radio follows the seed only. The design says so in the proposal and the surfaces never claim otherwise; as the session accumulates, the profile starts steering.
- **Provider flakiness during a background refill** → identical tolerance to M8/M9: one failed refill surfaces a small non-blocking notice on the queue (never a modal, never a lost queue), and the latch prevents a retry storm. A refill that returns nothing usable ends the radio gracefully rather than looping.
- **Growth order and unbounded membership.** `appendUpcoming` inserts immediately after the current track, so a *later* refill lands in front of an earlier one and successive batches play in reverse order of arrival. That is a consequence of inserting at the cursor — the only position that provably cannot disturb the current track or the play-order permutation — and it is stable; the alternative (appending at the tail of the upcoming region) interacts with M6's `reorder` invariants, so it is recorded rather than changed mid-milestone. Relatedly, the queue *membership* is never evicted (M6 bounds its played-history stack, not the list), and M10 is what makes that unbounded by default because `autofillQueue` defaults on. Bounding membership changes M6 semantics — entries behind the cursor are what `historyJump` walks — so it is deferred to M14 hardening with a named owner. Per-cycle growth is already bounded by `REFILL_LIMIT` and the low-water latch.
- **Bound ids in a query string** → the exclusion list is capped (60 ids ≈ well under any practical URL limit) and the route rejects an over-long list with a 400 rather than truncating silently, because a silently truncated exclusion would quietly re-serve a played track.
- **The taste profile reads the whole history dataset** → derived work is bounded by the existing in-memory store cap and is memoized; no new read path and no unbounded scan.
- **`source: "radio"` is a new `QueueSource`** → the queue view needs a label, and any exhaustive match on the type must be updated; the type system enforces that at build time.
- **Rotation quality depends on the curated phrase list** → it is unit-tested for coverage (every variant index yields a seed, no duplicates within a cycle) and deliberately short, so it can be improved without touching the engine.

## Migration Plan

1. Additive: one server module + one route, two client modules, one store, one agent, and small additions to five existing surfaces.
2. `QueueSource` gains `"radio"` — a type-level change only; existing sessions persist unchanged (the stored session snapshot records the source it had).
3. No IndexedDB schema change, no backup-schema change, no new dependency.
4. Rollback = revert the merge commit; nothing to unwind.

## Open Questions

None that change the specs, the approach, or the task breakdown.
