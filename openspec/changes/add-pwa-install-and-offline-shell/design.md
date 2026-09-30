# Design: PWA installation, offline shell, and offline metadata

## Context

M12 left the application installable-in-intent only. This change adds the three
pieces that make it installable and offline-capable, and one decision each for the
places where the platform forces a choice.

Two facts shape most of the decisions below:

1. **The app is a single Next.js App Router application served by `next start` (and
   by Vercel in the free tier).** `public/` is served at the root, `/_next/static/*`
   carries content-hashed build assets, and nine routes are prerendered static
   (`/`, `/discover`, `/history`, `/library`, `/library/liked`, `/now-playing`,
   `/queue`, `/search`, `/settings`) while `/artist/[key]`, `/album/[key]`,
   `/playlist/[id]` and every `/api/*` route are dynamic. A service worker therefore
   cannot precache a known asset list at build time, and it can only offer an
   offline *page* for a route it has already served.
2. **The local data layer is the product's core promise.** Seven whitelisted
   IndexedDB datasets, a versioned schema, and a versioned backup envelope. Anything
   that could drop or rewrite them is out of bounds, including the worker.

## Decisions

### 1. A dependency-free, hand-written service worker in `public/sw.js`

**Decision.** `public/sw.js`, written by hand, registered from a client module. No
`serw`/`@serw/next`/`workbox` dependency, no custom server, no build integration.

**Why.** `serw` (the usual Next.js service-worker helper) requires wrapping `next
start` in its own Node server. That is incompatible with two settled constraints:
the deployment is a single Next.js application on Vercel serverless functions
(ROADMAP §7.1), and the repository prefers explicit small modules over a framework
wrapper. The worker itself is ~200 lines: a versioned cache list, a handful of
per-request-class rules, and bounded eviction. A dependency would add more
configuration than behavior.

**Alternatives considered.** `serw` (rejected: needs a custom server, breaks the
deployment shape). `@ducanh2912/next-pwa` (rejected: same problem plus a build-time
asset manifest this app's dynamic routes cannot produce honestly). Workbox
(rejected: runtime + precache manifest, a large surface for four caching rules).

### 2. The caching strategy is a per-request-class decision table, not a blanket policy

**Decision.** Every request the worker sees is classified, and each class has one
rule. Nothing is "cached by default":

| Class | Rule | Why |
| --- | --- | --- |
| Non-GET, or a `Range` request | **deny** — straight to the network | A partial or mutating request answered from cache is a bug, not a feature. |
| `youtube.com` / `googlevideo.com` / any player script | **deny** | The IFrame player API must always be the live one: a cached player script is a playback-compliance and correctness hazard (M4's attribution and visible-surface requirements depend on it). |
| `/_next/static/*` (content-hashed), same-origin icons | cache-first, bounded | Content-hashed URLs cannot go stale; a cache hit is correct by construction. |
| Navigations to a **prerendered** route | network-first, fall back to the cached response | The page must be fresh when online (it carries the current build's RSC payload) and available when not. |
| Navigations to a **dynamic** route | network-first, **no** cached fallback | A cached `/artist/x` for `/artist/y` would be a lie. The route's own error state is the honest offline answer. |
| `GET /api/{artist,album,similar,discover}` | network-first, fall back to the cached response, bounded + TTL | These are keyless, profile-free **metadata** endpoints (their specs say so), so a stale copy is safe and genuinely useful offline. |
| `GET /api/search`, `/api/radio`, `/api/playlist` | **deny** | A search is a live question; a radio request is a rotation; a playlist resolution is an import path. Serving any of them from cache would answer a question nobody asked today. |
| Image GETs (artwork) | cache-first with background revalidate, bounded, opaque allowed | Artwork is display-only and third-party; a bounded cache makes a revisited page look right offline. Opaque responses are stored as-is, which is all an `<img>` needs. |

**Why a table and not a policy.** The failure modes are per class: a stale *page* is
confusing, a stale *search* is wrong, a cached *player* is dangerous, and an
*uncached* shell is useless. One policy cannot be simultaneously right for all four,
so the worker states the class and the rule side by side and a static test pins both
sides — including the denials, which are the half nobody tests.

**Alternatives considered.** Network-first for everything (rejected: the app shell's
hashed assets would be re-fetched on every offline-ish load and every cold start).
Cache-first for everything except APIs (rejected: a prerendered page cached
cache-first would keep serving an old build after an update, which the M13 update
flow exists to prevent). Precaching a build-time asset manifest (rejected: the
hashed asset names are only known after a build, and a hand-maintained list rots
silently).

### 3. Bounded means counted, with FIFO eviction, and the counts are named constants

**Decision.** Every cache the worker fills has a maximum entry count, evicted
first-in-first-out: shell/static 200 entries, metadata 100 entries with a 7-day
freshness bound, artwork 300 entries. The numbers live as named constants in the
worker and are asserted by a static test, so raising one is a deliberate edit.

**Why.** An unbounded cache on a free-tier device is a slow bug: it grows until the
browser evicts it (or the user clears site data) and nobody can say how much space
the app asked for. Named bounds also make the claim checkable — the evidence run can
report the real entry counts after a browsing session.

**Alternatives considered.** Relying on the browser's own quota (rejected: opaque to
the app, unbounded in the meantime). An LRU (rejected: FIFO is enough when every
entry has a bounded lifetime and the working set is the recent past).

### 4. The manifest is a typed Next.js metadata route; icons are generated from the existing mark

**Decision.** `src/app/manifest.ts` exports a `MetadataRoute.Manifest` (typed,
colocated with `app/icon.svg`, no build step). It declares `id: "/"`, `start_url:
"/"`, `scope: "/"`, `display: "standalone"`, theme `#000000`, background `#121212`,
and four icons: the SVG (`sizes: "any"`) plus generated PNGs at 192, 512, and a
maskable 512. The PNGs are generated **once** from the same geometry as `icon.svg`
(rounded square, three green bars) by a committed script, and the binary files are
committed; nothing regenerates them at build time.

**Why.** Chrome's install criteria want at least one icon ≥ 144 px and accept SVG,
but Safari's home screen and Android's adaptive icons are happier with real PNGs, and
a maskable icon needs a safe-area design. Generating the PNGs from the *same* three
rounded rectangles keeps one brand mark instead of two that drift.

**Alternatives considered.** A hand-written `public/manifest.webmanifest` (rejected:
untyped, and it drifts from the app's own metadata). Committing PNGs exported by an
external design tool (rejected: opaque provenance, and the geometry is three
rectangles). One `purpose: "any maskable"` icon (rejected: a maskable icon needs
padding inside the safe area, which would look small as a normal icon).

### 5. The install affordance lives in Settings, appears only when the browser offers it, and remembers a dismissal

**Decision.** A client module captures `beforeinstallprompt` once and exposes the
deferred event. Settings renders an **Install Spotivibe** row when a prompt is
available and not previously dismissed; activating it calls `prompt()`. On
`appinstalled` the row disappears and the state is recorded. Where
`beforeinstallprompt` never fires (iOS Safari), the row explains **Add to Home
Screen** instead of offering a button that cannot work. The dismissal is remembered
in `localStorage` under a namespaced key.

**Why.** ROADMAP M13 says "only where supported and not annoyingly repetitive". A
first-run modal or a persistent banner is the annoying version of this; a Settings
row the listener can find and forget is the honest version. `localStorage` is the
right home because it is exactly AGENTS.md's "tiny boot-time preference" — it must
be readable *before* the IndexedDB repositories are open (the row must not depend on
a database round trip to decide whether to nag), and it is not listening data, so it
does not belong in the backup envelope or in `preferences`.

**Alternatives considered.** A `preferences` field (rejected: it would change the
whitelisted `preferences` record and the backup envelope's shape for a flag that is
not a preference). A first-run modal (rejected: repetitive by construction). Hiding
the row on iOS entirely (rejected: the instruction is genuinely useful there, and
silence would look like the app cannot be installed).

### 6. The update flow activates a waiting worker and never touches local data

**Decision.** The registration module listens for `updatefound` and for a
`waiting` worker. When one exists, the shell renders a dismissible notice — "A new
version of Spotivibe is ready" with a **Reload** action. Reload posts
`{ type: "SKIP_WAITING" }`, the worker calls `skipWaiting()` + `clients.claim()`, and
the page re-renders from the network. The worker contains no call to IndexedDB, Cache
storage deletion outside its own versioned caches, or `StorageManager`; a static test
asserts all three, and a browser test asserts that library data is still present
after an update.

**Why.** The danger of a service worker is not caching — it is that a buggy
`activate` can wipe state the user cannot get back. Spotivibe's state *is* the user's
library, history, and playlists, so the worker's storage discipline is a product
requirement, not an implementation detail. Reloading after `skipWaiting` is also the
only way the new build's assets are actually used.

**Alternatives considered.** Reloading silently when a worker waits (rejected: it can
discard in-progress playback and typing without warning). `skipWaiting` on install
(rejected: it makes the first load unversioned and can swap the shell under a running
session).

### 7. The offline statement names the capabilities, and nothing advertises offline playback

**Decision.** The connection banner's offline copy becomes explicit: offline, search
and playback are unavailable and the local library is what remains. No other surface
is added a redundant banner, and no copy anywhere implies that YouTube content is
available offline. A negative test greps the shipped sources for the phrases such a
claim would use ("offline playback", "listen offline", "works offline" next to
"playback"/"YouTube").

**Why.** ROADMAP M13 requires both halves: clearly indicate that search/playback are
unavailable, and do not market offline YouTube playback. One honest statement in the
element that is already on every route in both responsive variants is enough, and a
single place is a place that can be tested; a banner on every network surface is three
places to keep in sync.

**Alternatives considered.** A per-surface offline notice (rejected: three surfaces
to keep in sync for one fact; the shell banner already covers all of them).
Rewording to mention YouTube explicitly in every surface (rejected: the app does not
route around YouTube's terms of service, and naming the provider in a status message
invites a support question the app cannot answer).

### 8. What is verified here, and what is documented instead

**Decision.** The web platform is verified: manifest and icon validity, worker
registration, offline reload of the local pages, the offline copy, the update flow,
and IndexedDB data surviving an update — in unit tests, static tests over `sw.js`, and
a browser evidence run against a production build. Real iOS and Android home-screen
behavior is **documented, not claimed**: the harness cannot install to a home screen,
so the evidence README states exactly which platform behaviors are unverified.

**Why.** ROADMAP M13 says "where possible". Claiming a verified iOS install from a
headless Windows browser would be a false claim; implementing the documented iOS
path and saying so is honest and useful.

**Alternatives considered.** Skipping the browser run and relying on unit tests
(rejected: an offline shell is precisely the kind of thing that only fails in a real
browser — the M4/M11 evidence runs each found defects unit tests could not).
Claiming cross-device verification (rejected: it would be a fabricated result).

## Risks / Trade-offs

- **A cached prerendered page is a previous build.** After an update the worker
  serves the cached shell for an offline navigation, so a listener offline right
  after an update sees the previous build. That is the correct trade: a stale shell
  beats no shell, and the update notice is available as soon as the network returns.
- **Metadata can be stale offline.** A cached `/api/artist` answer may be days old
  (the freshness bound is 7 days, and eviction is FIFO). Every such endpoint's spec
  already tolerates a bounded, keyless answer; the surfaces label cached-entity data
  as local and derived rather than live. Nothing user-generated is ever cached.
- **Opaque artwork responses cannot be validated.** The worker stores what the image
  host returned without inspecting it, which is all an `<img>` needs and avoids
  pretending to verify third-party content.
- **A service worker is hard to un-ship.** A broken worker can outlive a rollback. The
  versioned cache names and the `skipWaiting` flow exist so a new build always wins,
  and the worker's failure mode is "go to the network", never "deny the request".
- **iOS remains partially manual.** Add to Home Screen is a user gesture Safari
  exposes only through its own UI, so the app can only explain it.

## Migration Plan

1. Additive: a manifest route, a worker in `public/`, three client modules
   (registration/update, install prompt, offline copy), two surfaces (an update
   notice in the shell, an install row in Settings), and generated icon PNGs.
2. No storage migration: no dataset, record, or snapshot changes. The worker's
   caches are namespaced by version and disposable by design.
3. No data transform: existing local data, sessions, and backups are untouched.
4. Rollback = revert the merge commit and unregister the worker from any one device.
   A reverted build's worker is replaced on the next visit; a listener who never
   returns keeps a worker for a build that no longer exists, which is the one
   residual risk of this milestone and is bounded (it only ever shows the previous
   build, and Settings → "Reset Spotivibe data" remains available offline).

## Open Questions

None that change the specs, the approach, or the task breakdown. Two follow-ups are
deliberately out of M13's scope and are noted for the milestone that owns them:
precaching the shell on first install (M14's resilience work, after real-device
measurements exist), and any push-notification-shaped update path (out of scope: it
would imply a server capability the roadmap excludes).
