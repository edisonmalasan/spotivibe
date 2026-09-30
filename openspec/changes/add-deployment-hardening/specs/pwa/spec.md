# Spec Delta

## MODIFIED Requirements

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
