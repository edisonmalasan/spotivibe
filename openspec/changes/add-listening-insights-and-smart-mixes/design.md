# Design: Listening insights and Smart Mixes

## Context

What already exists, and therefore what this milestone can and cannot need:

- **Listening events are already recorded** (M8): `ListeningEventRecord { trackId, track, playedAt, secondsPlayed, completed?, skipped?, context }` in an IndexedDB dataset that the M2 backup envelope already exports. M11 does not need a new event shape and must not add one.
- **The M8 discovery feed already serves `kind: "mix"`** with language interleaving, and `for-you`. So a Smart Mix needs **no new route and no new provider capability**: it is a composition of the existing mix feed across the profile's seeds, deduped.
- **M10's taste profile** already weights liked tracks, plays (weighted by completion/skip and recency), and the selected languages. M11 reads it; it does not extend it.
- **M9 shipped `/artist/[key]` and `/album/[key]`**, so a history entry can link to real surfaces instead of a search refinement.
- `historyStore` keeps the most recent `RECENT_HISTORY_LIMIT` (50) events **in memory** while the full dataset lives in IndexedDB. Stats must therefore be computed from the *dataset*, not the in-memory window, or a listener with 5,000 events would see stats for 50.

## Goals / Non-Goals

**Goals**

- Stats that are **recomputable** from local history, so clearing history changes them by construction rather than by invalidation.
- A history surface that is a real view of local data, with links to the surfaces M9 built.
- Streaks with an explicit, tested day-boundary rule (local time, "today or yesterday" keeps a streak alive).
- Mixes with a stable identity and name, ≥20 tracks where the provider supports it, deduped, language-aware, and refreshable — generated with zero server-side identity.

**Non-Goals (with owner milestone)**

- Podcast episode history surfaces and per-show stats (M12).
- Any collaborative or server-side signal — permanently out of scope.
- Changing the recorded event shape or adding a stored verdict (see decision 1).
- Offline cache of insights (M13); the derivation runs on demand either way.

## Decisions

### 1. Classification is a read-time policy, not stored data

**Decision.** `classifyPlay(event, thresholds)` is a pure function over what was recorded (`secondsPlayed`, `durationSeconds`, `completed`, `skipped`) returning `"completed" | "partial" | "skipped"`. The recorder keeps storing only the raw measurements; every surface that needs a verdict calls the same pure rule.

**Why.** A stored verdict is a migration waiting to happen: change the threshold and every historical event means something new, which means re-writing the whole dataset. Classifying on read makes the thresholds *policy*, so they can change freely and old events are re-read with today's rule — and it keeps the "recomputable from local history" acceptance criterion trivially true. It also means a device that never synced sees the same numbers as one that did.

**Thresholds** (documented constants, each unit-tested): a play counts as **completed** when the event says so, or when at least `COMPLETED_FRACTION` (0.5) of a known duration was played, or when at least `COMPLETED_MIN_SECONDS` (30 s) was played; as **skipped** when it is marked skipped or under `SKIP_MAX_SECONDS` (10 s) of a track longer than a minute; otherwise **partial**. A track of unknown duration falls back to the seconds-only rules.

### 2. Stats are a pure derivation from the dataset, recomputed on demand

**Decision.** `buildStats(events, options)` is a pure function over *all* history events. It returns totals, top tracks/artists, a language/genre/category breakdown (only where metadata exists), completion/skip summaries, and streaks. Nothing is cached across a data change; the History page memoizes per revision like M10's ranker.

**Why.** It makes two acceptance criteria structural: stats are recomputable because there is no stored aggregate to go stale, and deleting history updates them because the next call sees fewer events. An aggregate table would be faster but would need invalidation, a migration, and a repair path — none of which buy anything at this dataset size.

**Cost, stated honestly.** Every visit re-reads the full history dataset and reduces it. That is O(events) per render of the History page; it is acceptable while a session is thousands of events, and the number to watch. If it ever matters, the fix is an incremental projection — deliberately not built now, because it reintroduces the staleness this decision removes.

### 3. Streaks use local calendar days, and "today or yesterday" keeps one alive

**Decision.** A day counts as a listening day when it contains at least one **non-skipped** play. A streak is a run of consecutive such days: the *current* streak is the run ending today or yesterday (a streak is not broken until a whole day passes with no plays), and the *longest* streak is the longest run anywhere in the history. Day boundaries are computed in the listener's local time from the recorded epoch milliseconds, and the rule is a pure function of `(events, now)` so it is testable at any boundary.

**Why.** Servers have no notion of the listener's midnight; a UTC-day streak would break at the wrong moment and is unreproducible. "Today or yesterday" is the behavior people expect from a streak: opening the app in the evening must not show a broken streak.

### 4. A mix is a persisted, named, locally generated set

**Decision.** A mix is a record: a stable `id`, a `name` derived from its strongest local signal (the top artist, else the top genre, else a neutral local label), the epoch period it was generated in, its ordered tracks, and the profile terms it was built from. Mixes are generated by composing the **existing** `/api/discover?kind=mix` feed across up to a bounded number of profile-derived seed rounds, deduped against the tracks already in the mix and the local played set, and capped at the roadmap's 20+ target.

**Why.** "Stable mix identity/name within a period" needs persistence: a mix that is recomputed on every visit changes its name and its contents under the user. Persisting one small record per mix is the only state M11 adds, and it is what makes the identity meaningful. Deriving the name from the strongest local signal keeps it honest — it names what the mix actually contains.

**Alternatives considered.** Deriving mixes on every visit (rejected: no stable identity). Reusing M10's radio feed (rejected: a radio is a *continuously refilled* queue with no identity; a mix is a *snapshot* the user can revisit and re-enter).

### 5. Mix generation needs enough local signal to be honest, and says so when it does not

**Decision.** A mix is generated only when the local profile has actual taste signal (`hasSignal`, which M10 defines as ignoring a mere default language). With no signal, the Home mixes section explains that a mix appears after some listening, and no mix is fabricated from nothing.

**Why.** A "mix" assembled from a trending feed with no local input is not a mix of *your* listening; presenting it as one is the kind of fabricated authority M9's catalog spec forbids. M8 already gated the section on signal presence; M11 makes that gate real.

### 6. The mixes dataset is derived data, and is marked as such

**Decision.** Mixes get their own IndexedDB store so identities survive reloads, and the backup envelope carries them as an **optional derived dataset** with their tracks stored as ordinary `Track` records. Listening history remains in the envelope by default (M2), which this milestone confirms rather than changes.

**Why.** An identity the user can see (a named mix) that silently vanished on import would be a worse experience than one that is restored, and the cost is one more small dataset. Marking it derived means a future "drop derived data" export option can exclude mixes without losing anything unrecoverable — the mix can always be regenerated from the profile.

### 7. The recorder writes the measurements the rule reads, and still no verdict

**Decision.** The event is written at the step's start (as M8 does) and its *raw measurements* are patched onto it when the step ends: `secondsPlayed` from the engine's last reported position, clamped to the track's duration, plus a `completed` marker once playback reaches the end. Nothing else is stored, and `skipped` is left to the read-time rule rather than recorded, because the seconds already distinguish it. The patch happens on the next step, on detach, and on `pagehide`.

**Why (found during implementation).** M8's recorder writes `secondsPlayed: 0` and deliberately deferred thresholds to M11. Left as it was, *every* real event classifies as a skip under the rule above, so `playCount` is always 0, no day is ever a listening day, streaks stay at 0, and decision 5's "no signal, no mix" would read as "no signal" for a listener who has played a hundred tracks. The statistics requirement is unsatisfiable without a measurement, and the measurement belongs with the recorder that observes playback rather than inside the statistics derivation, which must stay a pure function of `(events, now)`.

**Alternatives considered.** Deriving seconds from wall-clock around a load request inside `buildStats` (rejected: the derivation would need a clock and would disagree with the position the engine actually reported). Recording a verdict at write time (rejected: exactly the stored interpretation decision 1 forbids). Setting `skipped` explicitly (rejected: redundant with the seconds, and one more stored claim to keep honest).
### 8. The mixes surface lives on /history; the Home shelf lists only

**Decision.** The full mix surface (list, build, play, refresh) is mounted on `/history` beside the statistics and the record, and the Home Smart Mixes shelf is **list-only**: no generation action, no playback, no provider request while the feed renders.

**Why.** All three Home sections are derived from the same local listening signal, so "what this device knows about your listening" is one page rather than three. More importantly, the split keeps the M8 promise that opening Home never spends a provider request: generation costs one or more feed rounds, so an action that builds mixes must not live on a route people open to browse. Putting it only on Home would have made generation discoverable but easy to trigger by accident; putting it nowhere would have left `generateMix` unreachable. A second build in the same period then takes the refresh path, so pressing the button twice is harmless.

**Alternatives considered.** Generation on Home behind a confirmation (rejected: still an action on a browse route, and the drawer competes with the feed). Mixes in `/library` next to playlists (rejected for this milestone: a mix is generated from *listening*, and its identity depends on the local signal rather than being a saved collection; revisit if mixes ever become editable collections).
## Risks / Trade-offs

- **Stats are O(events) per read** (decision 2) — stated, with the trigger for changing it.
- **Streak boundaries are timezone-dependent by nature.** The rule is pure and tested, but a listener who travels can see a streak end on a day boundary that shifted. That is the correct behavior for a *local* streak, and it is disclosed rather than smoothed.
- **Mix quality is bounded by the provider.** A 20-track mix needs enough distinct material across the seed rounds; when the rounds stop producing new tracks the mix is shorter and says nothing false about it. The generation is bounded (seed rounds × request cap) so a mix cannot spend unbounded provider work.
- **The name is derived from one signal** and can be slightly off (an artist who appears once in a long mix). The name is a label, not a claim: it names the strongest signal, and the mix's contents are right there.
- **Persisting mixes adds a dataset to back up**, so the backup schema, serializer, merge plan, and the architecture whitelist all move together — each with tests, and each optional-by-default so older exports still import.

## Migration Plan

1. Additive: two pure modules, one store, one repository + IndexedDB store, two feature folders, one new route, a Home section swap, and backup-schema/serializer/merge additions.
2. No history migration: events are re-read with the new classification rules (decision 1), which is the point.
3. The mixes dataset is new and empty; nothing to migrate.
4. Rollback = revert the merge commit; mixes can be dropped by clearing local data, history is untouched by the rollback.

## Open Questions

None that change the specs, the approach, or the task breakdown.
