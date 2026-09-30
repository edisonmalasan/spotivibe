# M12 evidence — Podcast search mode

Task 9.2 of `openspec/changes/add-podcasts`. Everything in this directory was
produced by driving a **production build** in headless Edge over the Chrome
DevTools Protocol.

## What is in here

| File | What it is |
| --- | --- |
| `cdp-check.mjs` | The harness. Node built-ins only — no Playwright, no Puppeteer, no dependencies. |
| `results.json` | The run record: 32 steps with their verdicts and details, the screenshots, the console-error buckets, every observed `/api/search` request, and the direct server probes. |
| `search-music-mode-1280.png` | Music mode: the unchanged result sections, and a request with no `category` parameter. |
| `search-podcast-mode-1280.png` | Podcast mode: the same query re-asked, presented as **Episodes** and **Shows** with no Albums section. |
| `podcast-category-search-1280.png` | A curated category running a podcast-mode search for its own query. |
| `search-podcast-empty-1280.png` | A podcast search with no results, explained in podcast terms (see the stub disclosure below). |
| `podcast-clamped-restore-1280.png` | A re-cut episode restoring inside its own duration instead of past the end. |
| `podcast-history-stats-1280.png` | A played podcast episode in the local History record, and the statistics that count it. |

`results.json` reports `"pass": true` only when **every** step passed and the run
raised no uncaught error. Exit code 0 means the same thing.

## Reproducing the run

```bash
# 1. Production build and server (the harness never starts either itself).
cd frontend
npm ci
npm run build
npm run start -- -p 3210

# 2. In another shell, from the repository root:
node openspec/changes/add-podcasts/evidence/cdp-check.mjs
```

Environment overrides:

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPOTIVIBE_ORIGIN` | `http://localhost:3210` | Where the production build is served. |
| `SPOTIVIBE_BROWSER_PATH` | first Edge/Chrome found | Explicit browser executable. |
| `SPOTIVIBE_CDP_PORT` | `9445` | DevTools port. |

The run needs outbound network access: it performs **live** searches through the
app's own `/api/search` route in both modes, with no fixture or mock provider. A
run that cannot reach the upstream provider fails on those steps, and that is
reported as a step failure rather than papered over.

## What the run asserts, and why it is not the same as the unit tests

The unit suite proves the mode's *rules* against synthetic candidates
(`tests/music-podcast-mode.test.ts`, `tests/search-route-mode.test.ts`,
`tests/podcast-search-surface.test.tsx`, `tests/podcast-playback-history.test.ts`).
It cannot prove that a real provider answers a different question in podcast mode,
that a real episode survives a real reload, or that the mode changed nothing else
in a live browser. That is what this run covers:

1. **The two modes are different questions, upstream.** A direct probe of
   `/api/search` in each mode is read for the server's own tier diagnostics:
   podcast mode records `ytmusic → skipped`, music mode records `ytmusic → ok`.
   The skipped tier is never contacted, which is design decision 2, asserted
   against the server rather than inferred from the UI.
2. **The same words are answered by a different tier, and labelled for the question
   asked.** The run probes `/api/search` for one query in both modes and compares:
   podcast mode is answered by a tier that was *not* YouTube Music (which was
   skipped), music mode by YouTube Music; podcast mode's results are all labelled
   `podcast` and all clear the 600 s floor. The two result sets are **not** claimed to
   be disjoint — the live provider may answer both questions with the same episode,
   and the run *measures* the overlap into `notes.sameWordsComparison` instead of
   asserting a difference it cannot promise.
3. **Music mode is untouched.** The first and last steps of the run search the
   same music query and assert the same request URL (no `category` parameter at
   all) and the same Songs/Artists/Albums sections, before and after all the
   podcast work in between.
4. **Switching mode is a URL write, not a reset.** The query survives the switch
   in the input and in the URL, the mode travels as `mode=podcast`, and the
   follow-up request carries `category=podcast` for the *same* query.
5. **Podcast results are presented as episodes.** Episodes/Shows replace
   Songs/Artists, the Albums section is gone, and each row names its show/channel
   and shows a duration — cross-checked against a probe of the same query, so the
   channel on screen is the channel the server returned.
6. **A curated category is a search, not a shelf.** The browse state of podcast
   mode lists eight categories, each a `/search?q=…&mode=podcast` link with no
   ranking claim in its copy; activating one navigates there and issues a
   podcast-mode request on the existing route. No new route is involved.
7. **Long-form playback and restore work for real.** An episode plays in the
   persistent player, its position is persisted and survives a reload (cued, never
   autoplayed), and a stored position *beyond* the track's duration is clamped at
   load time — forced to `duration + 900 s`, the player cues at `duration − 2 s`
   and the clamped episode can then play out to its end.
8. **A podcast play lands in the existing local record.** The measured episode is
   read out of IndexedDB, listed on the History surface with a verdict, counted by
   the statistics, and reported under a podcast category — with no podcast-specific
   dataset, store, or surface anywhere.
9. **Nothing local crosses a search request.** Every observed `/api/search`
   request's query keys are compared against the three the route documents
   (`q`, `limit`, `category`), and the run asserts that podcast requests really
   carried `category` while music requests really did not.

## Live-run deviations, disclosed

These are the places where the run is *not* a clean-room reproduction, stated
plainly rather than buried:

- **What the live provider returned for a podcast query, on the day.** The run
  probes `/api/search?q=<query>&category=podcast` and records the answer in
  `notes.upstreamProbes`, including which tier answered and every attempt. In the
  recorded run `true crime podcast` was answered by **invidious** after
  `ytmusic → skipped` and `ytweb → empty`; earlier runs of the same harness saw
  `invidious → timeout` with **piped** answering instead, and one run of the
  pre-correction harness saw the same. Those are live-provider facts, not
  application behavior — which is exactly why the run asserts the *chain*
  (YouTube Music skipped) and the *labels*, never a fixed tier.
- **The query-selection probe retries a 503, and every attempt is recorded.** The
  probe's job is to *choose* a workable podcast query, so a transient upstream
  failure during selection would otherwise be misread as "this query has no podcast
  results" — a claim the probe cannot make. Up to three attempts, 3 s apart, and
  `attempt` is recorded per probe in `results.json`. Assertion steps never retry.
- **The podcast query is chosen by probing.** `PODCAST_QUERY_CANDIDATES` are
  tried in order and the first that returns results is used for the UI steps, so
  the run does not depend on one query always being answerable. The candidate list
  and every probe result are recorded in `results.json`.
- **The same words in music mode are recorded, not asserted.** For the podcast
  query, the music-mode probe is kept in `notes.upstreamProbes` purely as an
  observation (in the recorded run: 20 results from `ytmusic`). Music mode answers
  a music question well; the point of the mode is that a listener can ask a
  different one.
- **The mode switch is retried through an in-page click.** The run tries a trusted
  mouse click first, then `element.click()` on the same control if nothing changed
  — the mode control sits high on the page, where a trusted click can land under
  the sticky header. `results.json` records the path taken per control in
  `notes.activations`; in the recorded run every activation was a trusted click.
- **The clamp is asserted exactly, against the shipped constant.** The run forces
  the stored position past the track's duration and requires the restored position
  to equal `duration − END_CUE_TAIL_SECONDS`, reading that constant out of
  `playerStore.ts` at run time. An inequality would have accepted a silent restart
  from 0:00, which is the failure this check exists to catch.
- **The mode switch is exercised on a query the mode can answer.** The switch step
  types the *podcast* query first and then switches mode, rather than switching a
  song title into podcast mode and hoping the live provider returns long-form
  results for it. Whether a podcast query answers in *music* mode is recorded as an
  observation (`notes.upstreamProbes`) and not asserted — it is a fact about the
  provider, not about this change.
- **Playback pacing is wall-clock.** The first episode plays ~33 s of real time
  before the real "Next track" control is clicked, because a step's measurements
  are written when the step *ends*. The recorded seconds vary per run (typically
  32–35 s); the assertions use thresholds, never exact values.
- **The session is read after a deliberate pause.** The session write is a 2 s
  debounce fed by position updates, so while the engine keeps reporting a new
  position the deadline keeps moving and nothing is persisted (pre-existing M6
  behavior, unchanged by M12). The harness pauses playback — what a listener does
  before leaving — and then reads the record, so the restore assertion is not
  racing a debounce.
- **The empty-podcast state needs one stubbed response.** The chain reports "no
  tier produced a usable result" as a 503, which is the *error* state, so the
  remote-empty state is unreachable through the live server. For a short window
  every `/api/search` response is answered by the harness with `200 { tracks: [] }`,
  and both modes' empty states are then read from the DOM. The disclosure is
  recorded in `notes.disclosures.stubbedResponses`; no other request in the run is
  stubbed, and every other step reads the real server.
- **Zero-second events are expected and kept.** Two of the run's three history
  events store zero seconds: a step that ended because the harness reloaded the
  page, and the clamped step that was cued rather than played. They are real
  events, they stay in the record, and the statistics correctly refuse to count
  them — which is why the recorded run reports `plays=1` for three events.
- **The clamp's snapshot half is proven by unit test, not in the browser.** The
  browser shows the player cueing inside the duration. That the *stored snapshot*
  keeps its original position is asserted in
  `tests/podcast-playback-history.test.ts`, because a live page re-persists its
  own snapshot within seconds and the two cannot be told apart from the outside.
- **The first result is whatever is live.** Episode and show names in the output
  are the provider's. Some tiers return shows with an empty channel id; the
  affected surfaces fall back to the name, which is the M9 contract (see the
  `ArtistTile` note in the change's `design.md` addendum and the regression test
  in `tests/search-entry-points.test.tsx`).
- **Console errors are bucketed, and every bucket is disclosed.** Deliberate
  failures and live-provider flakes (`net::ERR_`, 404/5xx during a stubbed window,
  429/503 from the upstream provider) are recorded in `notes.disclosures` with
  their URL. Anything not matched by a documented bucket is counted as a console
  error and fails the run. This run's `consoleErrors` array is empty.

## Files not in the run

- **No offline-window test.** Both modes' offline behavior is pre-existing and
  unchanged: an offline request issues no fetch and falls back to the local
  library (`tests/search-fallback.test.tsx`). Nothing about that path is specific
  to the mode, so `notes.disclosures.offlineWindow` is expected to be empty
  rather than populated.
- **No backup round trip for the mode.** Podcast mode adds no dataset, so the M2
  backup round trip is untouched by this change and is not re-evidenced here. The
  "no podcast dataset" property is asserted in the architecture suite and in
  `tests/podcast-playback-history.test.ts`.
- **No podcast surface on Library/Home/Now Playing.** M12 deliberately adds none: a
  played episode appears in the existing History and statistics surfaces, and the
  Now Playing surface is unchanged. The run probes for a podcast-specific surface on
  the insights route only — not on every page — so that part of the claim rests on
  the dataset-whitelist architecture rule and the unit tests rather than on this run,
  which is stated here rather than implied.
