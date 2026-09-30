# Proposal: PWA installation, offline shell, and offline metadata

## Why

ROADMAP §2 lists an installable PWA as a **required** product constraint, and
M13 is where it stops being a promise. Today the application is a plain Next.js
site with no manifest, no service worker, and no offline behavior beyond what the
browser does by accident:

- **It cannot be installed.** There is no Web App Manifest, so there is no name, no
  icon set, no theme color, no standalone display mode, and no start URL. Chrome
  will not offer to install it; an iOS home screen shortcut gets a screenshot of a
  website, not an app.
- **It cannot be opened offline.** Every navigation is a network request. With no
  connection the listener loses their library, their playlists, their history, and
  their statistics — data that is *already on their device* in IndexedDB. The
  roadmap's acceptance criterion "core local pages render offline after assets have
  been cached" cannot be met, because nothing is ever cached.
- **Its offline story is vague.** `ConnectionBanner` says "some things won't load
  until you reconnect." That is technically true and practically useless: the two
  things a listener actually reaches for — search and playback — are YouTube-backed
  and *cannot* work offline. ROADMAP M13 requires the app to say exactly that, and
  to never market offline YouTube playback.
- **There is no update path.** Without a service worker there is no version
  boundary to update, and once one exists it must be added without touching the
  IndexedDB data the whole local-first promise rests on ("service-worker updates do
  not destroy IndexedDB data").

The offline *data* layer already exists and is excellent — versioned IndexedDB, seven
whitelisted datasets, an eight-version-safe backup envelope. M13 adds the part that
makes it usable when the network is gone: a cached shell to open, a bounded cache for
the safe metadata and artwork, and honest copy about what still needs a connection.

## What Changes

- **A Web App Manifest** with Spotivibe naming, an icon set (including a maskable
  icon), theme/background colors, `display: standalone`, and a start URL — served as
  a typed Next.js metadata route, not a hand-maintained JSON file.
- **A hand-written service worker** in `public/`, with an explicit per-request-class
  strategy: cached app shell and content-hashed static assets, network-first
  navigations that fall back to the cached shell, a bounded cache for safe metadata
  and artwork, and an explicit **deny list** that keeps the YouTube player API and
  every media request out of the cache.
- **An honest offline statement**: the connection banner names the capabilities that
  need a connection (search and playback) instead of saying "some things won't
  load". No surface claims offline YouTube playback, and a negative test keeps it
  that way.
- **An install affordance that is not a nag**: a Settings row that appears only when
  the browser actually offers installation, is remembered as dismissed, and on iOS —
  which has no such event — explains "Add to Home Screen" instead of pretending to
  offer a button that cannot exist.
- **A service-worker update flow**: when a new build is waiting, the shell says so
  and offers a reload that activates it, without ever clearing local data.
- **Proof**: unit tests for the registration, update, and install modules; static
  tests pinning the worker's deny rules and storage discipline; and a browser
  evidence run that installs nothing, caches the local pages, cuts the network, and
  reloads them.

## Capabilities

- **New Capabilities**:
  - `pwa` — installability (manifest, icons, standalone), the service worker's
    caching strategy and its explicit denials, the update-notification flow, the
    install affordance, and the local pages' availability offline.
- **Modified Capabilities**:
  - `network` — the connection banner names the capabilities that are unavailable
    while offline, instead of a vague promise that something may not load.

## Impact

- **New client code**: a service-worker registration/update module, an install-prompt
  module, an update notice and an install row in the shell/Settings, and the worker
  itself in `public/sw.js`.
- **New static assets**: the manifest route and PNG icons (192/512, plus a maskable
  512) generated from the existing `icon.svg` geometry. `public/` is currently empty,
  so there is nothing to disturb.
- **Existing code touched**: `app/layout.tsx` (viewport/metadata for standalone
  mode), `components/layout/AppShell.tsx` (mount the update notice), the connection
  banner's copy, `app/settings/page.tsx` (the install row), the architecture suite
  (the worker must not reach the data layer or the network layer), and the vitest
  setup (a service-worker stub for the modules that probe for it).
- **No new dependencies, no new API route, no new storage dataset, no server-side
  behavior change.** Everything in M13 is static or client-side; the provider layer,
  the data layer, and the player engine are untouched.
- **Known limitations, stated rather than hidden**:
  - Only *previously visited* prerendered routes are available offline; a first
    offline visit to a dynamic route (`/artist/…`, `/album/…`, `/playlist/…`) shows
    the honest error state, because there is nothing cached to show.
  - Search results are deliberately **not** cached. A search is a live question, and
    a stale result set presented as fresh is worse than no results.
  - Real iOS and Android home-screen behavior cannot be verified from this
    environment. The harness verifies the web platform (installability inputs,
    registration, offline reload, update flow) and the iOS path is implemented as
    documented instructions; the evidence README says which parts are unverified.
