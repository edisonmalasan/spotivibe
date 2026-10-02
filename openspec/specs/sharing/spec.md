# sharing Specification

## Purpose

Sharing a track, album, artist, or playlist as a Spotivibe link, through the platform share sheet where
one exists and a clipboard copy otherwise, with an honest confirmation either way.

## Requirements

### Requirement: A shareable surface shares a Spotivibe link

A surface that has a shareable identity SHALL offer a share action that shares a URL identifying it
within this application. An album, an artist, and a playlist SHALL share the URL of their own page. A
track has no page of its own, so it SHALL share a search URL that resolves to it, built from its artist
and title — a lossy representation, and one that is chosen deliberately rather than by omission.

The share action SHALL carry the name of what it shares, so a list of actions is distinguishable by
label and not only by icon.

#### Scenario: An album shares its own page URL

- **WHEN** share is activated on an album
- **THEN** the shared URL is that album's own page URL

#### Scenario: An artist shares its own page URL

- **WHEN** share is activated on an artist
- **THEN** the shared URL is that artist's own page URL

#### Scenario: A playlist shares its own page URL

- **WHEN** share is activated on a playlist
- **THEN** the shared URL is that playlist's own page URL, built by a shared helper rather than
  concatenated at the call site

#### Scenario: A track shares a resolvable search URL

- **WHEN** share is activated on a track
- **THEN** the shared URL is a search URL for that track's artist and title, which resolves to the
  track

#### Scenario: The share action is labelled

- **WHEN** a shareable surface renders its share action
- **THEN** the action has an accessible name identifying what it shares

### Requirement: Sharing works without the Web Share API

Sharing SHALL use the platform share sheet where the platform provides one, and SHALL fall back to
copying the link where it does not. A platform that **rejects** the share — including a listener who
dismisses the share sheet — SHALL be treated as the fallback path rather than as an error, because
cancelling is not a failure.

Either path SHALL report its outcome in a status region a listener can perceive, and SHALL report it
whether it succeeded or not. Nothing SHALL be persisted by sharing.

#### Scenario: The platform share sheet is used when present

- **WHEN** share is activated and the platform provides a share sheet
- **THEN** the platform share sheet is invoked with the link and the title

#### Scenario: A missing share API falls back to copying

- **WHEN** share is activated on a platform with no share API
- **THEN** the link is copied instead, and the copy is reported

#### Scenario: A rejected share is not an error

- **WHEN** the platform share sheet is dismissed or rejects
- **THEN** the listener is not shown an error, and the outcome is reported as a dismissal

#### Scenario: The outcome is always reported

- **WHEN** a share attempt finishes
- **THEN** a status region carries the outcome, whether it succeeded, fell back, or was dismissed

#### Scenario: Sharing persists nothing

- **WHEN** share is activated
- **THEN** no store, repository, or persisted record is written