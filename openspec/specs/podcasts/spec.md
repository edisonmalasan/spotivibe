# Podcasts Specification

## Purpose

Podcasts as a mode of the existing product: a search mode that asks the right question of the provider, curated categories that give a listener somewhere to start, filters that do not delete legitimate spoken word, playback that survives a multi-hour timeline, and a local record of what was heard — all built on capabilities the app already has.

## Requirements

### Requirement: Podcast search mode

The application SHALL offer podcast search as a mode of its search surface rather than as a filter over music results, and that mode SHALL reach the provider layer so the query is answered as a podcast query. Selecting the mode SHALL preserve the current query, SHALL be carried in the URL so the mode and query reproduce on a deep link and on back/forward navigation, and SHALL NOT change music-mode behavior in any way. The search surface SHALL state which mode is active, and a listener with no results SHALL be told what the mode searched for rather than shown an unexplained empty list.

#### Scenario: Podcast mode is a mode, not a filter

- **WHEN** a listener selects podcast mode and searches
- **THEN** the request identifies itself as a podcast query, the provider is asked a podcast question, and the results are presented as podcasts

#### Scenario: Switching mode keeps the query

- **WHEN** a query is typed in music mode and the mode is switched to podcasts
- **THEN** the same query text is searched in podcast mode without being retyped or cleared

#### Scenario: The mode and query reproduce from the URL

- **WHEN** a podcast-mode results URL is opened directly or reached through back/forward navigation
- **THEN** the surface shows podcast mode with that query and re-runs the search in that mode

#### Scenario: Music mode is unchanged

- **WHEN** a music-mode search runs
- **THEN** it issues the same request it issued before podcast mode existed and returns music results

#### Scenario: An empty podcast search explains itself

- **WHEN** a podcast-mode search returns nothing
- **THEN** the surface explains that no podcast was found for that query in the active mode, rather than presenting a blank or a generic failure

### Requirement: Curated podcast categories

The application SHALL provide a small, explicit set of podcast categories whose entries act as query-driven starting points, so a listener who does not know a show name has somewhere to begin. Activating a category SHALL start a podcast-mode search for that category's query text and SHALL NOT add a new provider feed kind, a new route, or a ranking the product cannot compute. The catalog SHALL be available per selected language with a documented neutral fallback, matching how the discovery feed resolves query seeds.

#### Scenario: A category starts a podcast search

- **WHEN** a podcast category is activated
- **THEN** a podcast-mode search runs for that category and its results are presented as podcasts

#### Scenario: Categories are language-aware with a fallback

- **WHEN** the listener has selected languages and a category is shown
- **THEN** the category's query text comes from the selected languages, falling back to the documented neutral entry when a language has none

#### Scenario: Categories are not a ranking

- **WHEN** a podcast category's results are presented
- **THEN** they are the provider's results for that query in order, with no chart, editorial, or "best" claim added by the product

### Requirement: Long-form podcast playback

Podcast episodes SHALL play through the same single persistent player as music, and a long episode SHALL NOT break seeking, progress reporting, or session restoration. A stored position SHALL be restored on reload, and a stored position beyond the episode's current duration SHALL be clamped to that duration rather than cueing a start past the end. Duration displayed for an episode SHALL be the canonical duration reported for it, and the surface SHALL NOT claim a duration the provider did not report.

#### Scenario: An episode plays in the persistent player

- **WHEN** a podcast result or category result is activated
- **THEN** that episode plays through the single persistent player and continues across route changes

#### Scenario: A long episode restores its position

- **WHEN** a session is restored for an episode whose duration is hours long
- **THEN** playback resumes at the stored position within the episode and progress reporting continues normally

#### Scenario: A stored position beyond the duration is clamped

- **WHEN** a stored position is greater than the episode's currently reported duration
- **THEN** playback is cued inside the episode rather than past its end, and the stored snapshot itself is left unchanged

#### Scenario: Search never autoplays a podcast

- **WHEN** a podcast search or a podcast category view renders
- **THEN** no episode starts without an explicit activation by the listener

### Requirement: Podcast listening history

A played podcast episode SHALL be recorded in the same local listening-history dataset as music, carrying the episode's canonical metadata including its category, and SHALL be visible in the local History surface and counted by the local listening statistics. Podcast listening SHALL NOT require a new dataset, a new event field, or a separate clear action, and clearing the history SHALL clear podcast plays the same way it clears music plays.

#### Scenario: A played episode is recorded locally

- **WHEN** a podcast episode is played
- **THEN** the local listening history contains one event for it with the episode's title, show or channel, duration, and podcast category

#### Scenario: Podcast plays appear on the local surfaces

- **WHEN** the local History surface is opened after a podcast episode has played
- **THEN** that episode is listed with the others, and the local statistics count the play

#### Scenario: Clearing the history clears podcast plays too

- **WHEN** the listener clears the listening history
- **THEN** podcast events are removed along with music events, and the statistics and streaks report the cleared state

#### Scenario: Podcast history is not a separate store

- **WHEN** the local datasets are inspected
- **THEN** podcast history is stored in the existing listening-history dataset rather than in a podcast-specific one
