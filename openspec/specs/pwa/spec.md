# pwa Specification

## Purpose

Whether the application can be installed on a device's home screen, and what remains usable when the network is gone: an honest manifest, a service worker with an explicit per-request-class strategy, a bounded cache of the safe metadata and artwork, an install affordance that does not nag, an update flow that cannot lose local data, and a clear statement of what still needs a connection.

## Requirements

### Requirement: Installable application identity

The application SHALL expose a Web App Manifest describing it as a standalone application: its own name and short name, an icon set that includes a normal and a maskable icon at installable sizes, a theme and background color, `display: standalone`, a start URL, and a scope. The manifest SHALL identify the application by a stable id so an installed copy is recognized as the same app across launches and updates.

#### Scenario: The manifest describes an installable application

- **WHEN** the application is loaded
- **THEN** a manifest is served that names the application, declares `display: standalone`, a start URL and scope, theme and background colors, and at least one icon at 144 px or larger plus a maskable icon

#### Scenario: The installed copy is recognized as the same application

- **WHEN** the manifest is compared across two visits
- **THEN** its `id`, `start_url`, and `scope` are identical, so a launch from the home screen resolves to the same application identity rather than a new one

#### Scenario: Branding is Spotivibe's own

- **WHEN** the manifest and its icons are inspected
- **THEN** the name, short name, and icon artwork are Spotivibe's, and no third-party brand asset is shipped

### Requirement: Service worker caching strategy

The application SHALL register a service worker that classifies every request before deciding what to do with it, and SHALL apply a documented rule per class rather than a blanket policy. The worker SHALL serve the application shell and its content-hashed static assets from cache, and SHALL serve every same-origin navigation network-first with a documented fallback chain: the route's own cached response when it has one, and the cached application shell when it does not. A navigation SHALL NEVER be answered with a cached response belonging to a different route, and a route whose content is per-entity SHALL never be answered with another entity's cached response. Bounded caches of shell assets, provider metadata, and artwork SHALL each have a maximum entry count enforced by the worker, and the bounds SHALL be named values in the worker rather than implicit browser behavior. Every cache read SHALL be able to conclude that a stored entry is unusable, in which case the worker SHALL discard that entry and treat the read as absent rather than serving it.

#### Scenario: The shell and its assets are available offline

- **WHEN** a listener has loaded the application and then lost connectivity
- **THEN** the application shell, its styles and scripts, and the pages already visited still render from cache

#### Scenario: A prerendered page is served from cache when the network is gone

- **WHEN** a navigation to one of the application's own prerendered routes fails because the device is offline
- **THEN** the previously cached response for that route is served instead of a network error

#### Scenario: A route that was never visited still opens the application

- **WHEN** a navigation fails because the device is offline and no cached response exists for that exact route
- **THEN** the navigation is answered with a redirect to the cached application shell, so the listener lands in a working application at a URL that matches what is shown, rather than on the browser's own "no internet" page, which would take away the navigation, the player, and any way back

#### Scenario: A per-entity route falls back to the shell, never to another entity

- **WHEN** a navigation to a per-entity route (an artist, an album, or an imported playlist) fails because the device is offline and no cached response exists for that exact entity
- **THEN** the worker redirects to the cached application shell so the application itself still loads, and it does not substitute any cached response for the entity - neither the shell's own document under this URL nor another entity's

#### Scenario: The offline fallback is the app, not the browser's error page

- **WHEN** a per-entity route is opened for the first time while offline
- **THEN** the application renders - navigation, player region, and the connection banner naming what needs a connection - rather than the browser's own "no internet" page, because a browser error page is a dead end the listener cannot leave. The route they asked for is not the route they get: a single offline shell cannot render a route it has never been sent.

#### Scenario: Caches are bounded and evicted

- **WHEN** more entries are cached than a cache's maximum
- **THEN** the oldest entries are evicted, and no cache grows past its stated maximum

#### Scenario: A live question is never answered from cache

- **WHEN** a request for search results, a radio rotation, or a playlist resolution is made
- **THEN** the worker goes to the network and does not serve a cached response for it

#### Scenario: The player is never served from cache

- **WHEN** the browser requests the video player's API script or any player media
- **THEN** the worker passes the request straight to the network, so the live player is always used

#### Scenario: A corrupt cache entry is discarded rather than served

- **WHEN** a cached entry exists for a request but cannot be used as an answer
- **THEN** the worker deletes that entry, treats the cache as having no answer for the request, and falls through to its normal behavior for that class

#### Scenario: A cache read that fails is a miss, not a failure

- **WHEN** reading the cache throws for any reason
- **THEN** the request continues as though the cache were empty, and the listener's page still loads

### Requirement: Bounded offline metadata and artwork

The worker MAY cache provider metadata responses and artwork images for offline use, and SHALL do so only for responses that carry no listener data, with a stated entry bound and a freshness bound for metadata. A metadata request that carries listener-derived input SHALL NOT be cached; artwork is display data from a third party and is cached as it was served, without inspection or re-encoding. Cached metadata SHALL be used only as a fallback when the network cannot answer, never in preference to a live response, and artwork caching SHALL NOT alter, resize, or re-encode the image the provider served.

#### Scenario: Previously seen entity metadata is available offline

- **WHEN** a listener opens an artist, album, or discovery surface that was fetched before, while offline
- **THEN** the surface renders from the cached response instead of failing

#### Scenario: A live response always wins

- **WHEN** a metadata request can reach the network
- **THEN** the live response is returned and the cache is refreshed with it, even if a cached copy exists

#### Scenario: Metadata beyond its freshness bound is not used

- **WHEN** the only cached copy of a metadata response is older than the stated freshness bound
- **THEN** it is not served as an answer, and the surface reports that the data could not be loaded

#### Scenario: No user data is ever cached

- **WHEN** the worker inspects a request before caching it
- **THEN** it caches only the metadata and artwork classes it documents, and no request carrying listener data, identifiers, or history is ever written to a cache

### Requirement: Service worker update flow

The application SHALL tell the listener when a new version of the application is waiting to take over, SHALL offer a way to activate it, and SHALL complete the activation so the new build's assets are actually used. The update SHALL NOT destroy, reset, or rewrite any locally stored data: the worker SHALL NOT open or modify the listener's datasets, session, or history, and on activation it SHALL delete only caches of its own previous version and nothing else.

#### Scenario: A waiting update is announced

- **WHEN** a new build's worker is installed while an older one controls the page
- **THEN** the shell shows a notice that an update is ready, with an action to activate it

#### Scenario: Activating the update loads the new build

- **WHEN** the listener activates a waiting update
- **THEN** the waiting worker takes control and the page is reloaded so the new build's shell and assets are used

#### Scenario: An update cannot lose local data

- **WHEN** an update is activated
- **THEN** the listener's local datasets, session, and history are unchanged, and the worker performs no deletion of browser storage

#### Scenario: A dismissed update notice does not block the next one

- **WHEN** the listener dismisses an update notice and a later update arrives
- **THEN** the new update is announced again

### Requirement: Install affordance

The application SHALL offer an install affordance only where the platform supports installation, SHALL remember a dismissal so it does not become repetitive, and SHALL explain the platform's own manual installation path where no programmatic prompt exists. The affordance SHALL NOT claim that installing changes what the application can do.

#### Scenario: The affordance appears where installation is offered

- **WHEN** the browser has offered to install the application and the listener has not dismissed the affordance
- **THEN** a discoverable affordance is shown that installs the application when activated

#### Scenario: A dismissed affordance does not come back on its own

- **WHEN** the listener dismisses the install affordance and returns to the application later
- **THEN** the affordance is not shown again unless the listener asks for it

#### Scenario: A platform without a programmatic prompt gets instructions

- **WHEN** the platform exposes no programmatic install prompt
- **THEN** the affordance explains the platform's own home-screen installation step instead of offering an action that cannot work

#### Scenario: An installed application stops offering installation

- **WHEN** the installation completes
- **THEN** the affordance is no longer offered, because there is nothing left to install

### Requirement: Local pages are usable offline

The application's local-data surfaces SHALL remain usable when the network is unavailable, because their data is already on the device: the library, its playlists, liked tracks, the listening history and its statistics, the queue, and the settings surface including export and import through the browser's file APIs. None of these surfaces SHALL require a network response to render their stored content.

#### Scenario: The library is browsable offline

- **WHEN** the listener opens the library while offline
- **THEN** their playlists and liked tracks render from local data without a network response

#### Scenario: History and statistics are readable offline

- **WHEN** the listener opens the history surface while offline
- **THEN** their recorded plays, verdicts, and statistics render from local data

#### Scenario: Data management still works offline

- **WHEN** the listener exports a backup, imports a backup, or clears a dataset while offline
- **THEN** the operation completes against local data, using the browser's file APIs where those are required

#### Scenario: Nothing local pretends to be live

- **WHEN** a local surface renders stored content while offline
- **THEN** it does not present that content as freshly loaded from the provider, and provider-dependent surfaces state that a connection is required
