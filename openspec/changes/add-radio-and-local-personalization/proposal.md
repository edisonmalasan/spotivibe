# Proposal: Radio, queue autofill, and local personalization

## Why

The product can start a queue and play it to its end, but it cannot keep playing. M9's artist page offers "Start artist radio", which today seeds one fetch and then stops; the queue reaches its last track and the session simply ends. A listener has to go back, search again, and choose something by hand — the opposite of the continuous listening the roadmap describes as a required outcome ("Track Radio seeded by track", "Refill radio before queue exhaustion", "Queue autofill for ordinary playback when enabled/appropriate", M10).

The second half of M10 is why the first half must be local. There is nothing to refill *from*: no account, no server profile, no collaborative filtering (permanently out of scope). So the only way to make a radio that avoids repeating itself and that gets better over a session is to build a **local taste profile** from the data the app already owns in IndexedDB (likes, listening events with completion/skip, languages) and to use it to seed and rank provider queries — with the profile itself never leaving the device.

## What Changes

- Add **two radio modes** that keep playing across multiple refill cycles: `track` (seeded by a track) and `artist` (seeded by an artist). A radio is a queue *mode*, not a separate player: the persistent YouTube player, the mini-player, the queue view, and the transport are the same state a radio shares.
- Add a **refill endpoint** that answers with fresh material per cycle instead of a fixed feed: `GET /api/radio?kind=…&title=&artist=&exclude=&limit=&variant=`. The curated seed phrases rotate by `variant` (a counter the client holds), and the played set is excluded server-side from a bounded id list, so a radio can refill without re-serving what was just heard. The server stores nothing about who is listening.
- Add a **played-id set** for session dedupe (a radio never re-serves a track it has played) and a **local recency penalty** so a track is not repeated too soon.
- Add **queue autofill** for ordinary playback: when the setting is on and the queue runs low, the app appends ranked candidates, latched so it cannot loop.
- Add a **local taste profile** — a pure derivation over the existing liked, history, and preference data (top artists, top genres/categories, languages, recent tracks, completion/skip weighting) — and a **rule-based local scorer** that ranks candidates before they are appended. The profile is derived on demand; **no new IndexedDB store, no new backup dataset, and nothing is uploaded**. Only ephemeral seed terms and the current track's public metadata reach the API.
- Add the entry points: a "Start track radio" item on the search result menu, a radio action on Now Playing, and M9's existing "Start artist radio" now entering radio mode rather than playing one fetch.
- Clearing local history or preferences changes future personalization, and no cross-user data exists anywhere in the path.

## Capabilities

- **New Capabilities**:
  - `radio` — track and artist radio modes, refill before exhaustion, played-id dedupe, and queue autofill, including their local-only signals and recovery.
  - `personalization` — the local taste profile, rule-based candidate scoring, ephemeral seed terms, and the guarantee that no persistent profile is uploaded and no cross-user data exists.
- **Modified Capabilities**:
  - `queue` — the queue gains a `radio` source and participates in refill/autofill; its duplicate protection and repeat modes stay unchanged.
  - `search` — the result context menu gains a "Start track radio" item.
  - `app-shell` — the Now Playing surface gains a radio action.

## Impact

- **New server code**: `src/server/music/radio.ts` (seed rotation + exclusion) and `src/app/api/radio/route.ts`.
- **New client code**: `src/stores/radioStore.ts`, `src/features/personalization/{tasteProfile,scoreCandidates}.ts`, a refill/autofill agent mounted with the persistent player, and small additions to the search result menu, Now Playing, the artist page, Settings, and the queue source labels.
- **Existing code touched**: `data/repositories/types.ts` (`QueueSource` gains `radio`; `SessionSnapshot` gains the radio identity), `data/backup/{schema,serialize,plan}.ts` and `data/indexeddb/preferences.ts` (the optional fields and the read fallback), `player/persistence.ts` (the radio identity travels with the session it belongs to), `stores/queueStore.ts` (`appendUpcoming`), `features/queue/QueueView.tsx` (label), `stores/preferencesStore.ts` (autofill setting), `features/history/useListeningRecorder.ts` (the radio listening context), `app/now-playing/page.tsx`, `features/search/ResultMenu.tsx`, `features/artist/ArtistView.tsx`, `components/layout/AppShell.tsx` (the two agents), and the architecture/route test suites.
- **No new dependencies, no new IndexedDB store, no new dataset, no accounts, no server-side profile.** The taste profile is derived from the M7 library dataset, the M8 history dataset, and the M8 preferences store. The existing backup *schema* does gain three **optional** fields (the `autofillQueue` preference, the `radio` queue source, and the radio identity in the session envelope), each defaulted so a pre-M10 export still validates and imports unchanged.
- **Out of scope (later milestones)**: Smart Mixes, listening stats, and streaks (M11); podcast work (M12); offline shell (M13).
- **Known limitation carried forward**: with no account, a *first* radio on a brand-new device has no taste signal to steer it beyond the seed — the profile only becomes meaningful as the session (and the local datasets) accumulate. The design makes the cold-start explicit rather than pretending otherwise.
