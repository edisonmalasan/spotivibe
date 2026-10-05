## MODIFIED Requirements

### Requirement: Response security policy

Every response the application serves SHALL carry a Content Security Policy and the standard hardening headers, and the policy SHALL name exactly the origins the application needs rather than a permissive default. The policy SHALL differ between development and production only where the framework's development runtime requires it, and the production policy SHALL NOT include script relaxation that production does not need.

The origins named by the `img-src` directive SHALL be derived from the artwork URLs the application's provider responses actually contain, as recorded by the application's own captured provider fixtures, rather than from the image hosts that appear as literals in the application's source. A provider origin present in those fixtures but absent from `img-src` SHALL fail the policy's own verification. An origin named by the policy that no captured provider fixture and no client source uses SHALL likewise fail, so the directive cannot accumulate dead entries.

Because artwork reaches the browser as opaque provider data rather than as a string in this repository's source, a detector that scans source text alone CANNOT observe it and SHALL NOT be accepted as verification of this requirement.

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