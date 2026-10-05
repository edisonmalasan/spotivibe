## MODIFIED Requirements

### Requirement: Response security policy

Every response the application serves SHALL carry a Content Security Policy and the standard hardening headers, and the policy SHALL name exactly the origins the application needs rather than a permissive default. The policy SHALL differ between development and production only where the framework's development runtime requires it, and the production policy SHALL NOT include script relaxation that production does not need.

The origins named by the `img-src` directive SHALL be derived from the artwork URLs the application's provider responses actually contain, as recorded by the application's own captured provider fixtures, rather than from the image hosts that appear as literals in the application's source. A provider origin present in those fixtures but absent from `img-src` SHALL fail the policy's own verification. An origin named by the policy that no captured provider fixture and no client source uses SHALL likewise fail, so the directive cannot accumulate dead entries.

Because artwork reaches the browser as opaque provider data rather than as a string in this repository's source, a detector that scans source text alone CANNOT observe it and SHALL NOT be accepted as verification of this requirement.

The service worker script SHALL be governed by a policy of its own rather than by the document's. The worker is the one context in this application that performs a deliberate cross-origin `fetch` — it mediates third-party artwork through the Cache API — and inheriting the document's `connect-src` makes that fetch fail, which prevents every provider-hosted image from rendering for every visitor the worker is controlling. The worker script's policy SHALL differ from the document's in `connect-src` and in no other directive, so the exemption grants the worker nothing the document does not already grant the page.

#### Scenario: Every response is governed by one declared policy

- **WHEN** any route, static asset, the application manifest, or the service worker file is requested
- **THEN** the response carries a `Content-Security-Policy` header and the standard hardening headers (`X-Content-Type-Options`, `Referrer-Policy`, frame protection, and a restrictive `Permissions-Policy`), and no route is exempt because it was forgotten

#### Scenario: The policy permits what playback requires and nothing more

- **WHEN** the policy's directives are compared against the origins the application actually contacts
- **THEN** the player frame host, the artwork hosts, the media host, and the application's own origin are permitted, and any origin the application does not use is absent

#### Scenario: Production does not carry development script relaxation

- **WHEN** a production build is served
- **THEN** the policy contains no `unsafe-eval` and no blanket script source, and a development build's additional relaxation is absent

#### Scenario: The policy is stated where it is declared

- **WHEN** a maintainer reads the policy declaration
- **THEN** each directive names why it is there, and any directive that must stay permissive records the debt rather than presenting it as intended

#### Scenario: The policy permits every artwork origin the providers return

- **WHEN** the image origins named by the policy are compared against the origins present in the captured provider fixtures
- **THEN** every such origin is permitted by `img-src`, including the origins used for artist, album and track artwork in real provider payloads

#### Scenario: The policy names no unused image origin

- **WHEN** the image origins named by the policy are compared against the captured provider fixtures and the client's own source
- **THEN** no origin is named that neither a captured provider payload nor a client source uses

#### Scenario: The policy check can fail on an artwork origin

- **WHEN** an artwork origin present in the captured provider fixtures is removed from the policy
- **THEN** the policy's verification fails, naming the omitted origin

#### Scenario: The service worker script is permitted to fetch the artwork it mediates

- **WHEN** the service worker script is requested
- **THEN** the policy served with it names, in `connect-src`, every origin the document policy names in `img-src`, because the worker mediates third-party artwork through the Cache API and a policy lacking those origins makes its own fetch fail

#### Scenario: The exemption does not widen the document

- **WHEN** the worker script's `connect-src` is compared against the document's
- **THEN** the document policy still names only the application's own origin in `connect-src`, and every directive other than `connect-src` is identical between the two

#### Scenario: The exemption survives header resolution

- **WHEN** the header rules are resolved for the service worker script's path
- **THEN** the worker's policy is the one that applies, the remaining hardening headers are still present on that response, and the verification fails if the rule is declared in an order that would let the catch-all overwrite it