# Proposal: Deployment hardening (performance, security, accessibility, resilience)

## Why

M13 left the application installable and offline-capable. M14 is the milestone that
asks the harder question: **can it be put in front of strangers on a free tier and
still fail safely?** ROADMAP M14 puts it plainly — "Prepare a public free-tier
deployment that fails safely and remains responsive."

Investigating the 33 bullets M14 lists, most of the work is already done and does not
need re-doing. That is worth stating first, because a hardening milestone that
re-implements working code is a hardening milestone that breaks something:

| Already implemented | Where |
| --- | --- |
| Provider timeouts and abort propagation | `music-provider` spec, `CATALOG_SEED_TIMEOUT_MS` |
| Bounded outbound concurrency | `CATALOG_SEED_CONCURRENCY`, `MAX_INSTANCE_ATTEMPTS` |
| Identical in-flight request deduplication | `server/music/cache.ts` |
| Playback retry caps | `player/engine.ts` `MAX_RETRY_ATTEMPTS = 5` |
| Graceful unplayable-track handling | `playback` spec, "Unplayable track handling" |
| Query-parameter validation with length caps | every API route (zod, M3 onward) |
| Validated backup import before any transaction | `local-data` spec, M2 |
| Lazy, dimensioned artwork images | `AlbumCard`, `ArtistCard`, `SongRow` |
| Visible focus, ARIA labels, reduced motion | `app-shell` "Accessibility fundamentals" |
| Bounded local lists | `RECENT_HISTORY_LIMIT = 50`, `HISTORY_LIMIT = 50` |

What is genuinely missing is smaller and sharper:

1. **There are no security headers and no Content Security Policy at all.**
   `frontend/next.config.ts` is still the scaffold stub — `/* config options here */`.
   So the deployment sends no `Content-Security-Policy`, no `X-Content-Type-Options`,
   no `Referrer-Policy`, no `Permissions-Policy`, and no frame protection. M11 added
   an architecture rule that outbound links must not suppress the referrer, and that
   rule currently governs markup while the header that would enforce it is absent.
   A Content Security Policy is the one hardening measure that is nearly impossible
   to retrofit later without a breaking change, and this is the milestone for it.
2. **There is no abuse protection of any kind.** Every route is an open, unauthenticated
   GET that fans out to up to four third-party providers. One person looping a search
   can spend another person's quota with the Invidious and Piped instances the
   application depends on. ROADMAP asks for "best-effort per-instance throttling …
   without pretending it is globally durable rate limiting" — that precise hedge is
   the design.
3. **A corrupt cache entry cannot be recovered from.** M13's service worker reads
   `cache.match()` results without validating them. A truncated or corrupted entry
   that *matches* is served as an answer, and a `match()` that throws inside the
   worker's catch-less path takes the page's request down with it. ROADMAP lists
   "service-worker cache corruption recovery" under resilience and it is not there.
4. **A storage failure has an error type but not a story.** `StorageUnavailableError`
   exists and the repositories reject cleanly, but there is no requirement — and I
   should verify this rather than assume it — about what a listener sees when the
   database will not open, or when an upgrade from an older schema fails. The data
   is the product; "the app is blank" is not an acceptable answer.
5. **Corrupted local records are handled ad hoc.** M13's verification pass found a
   liked track whose `artists` was missing crashing `/library/liked` into the route
   error boundary; that was fixed at the surface. There is no rule saying records are
   untrusted *everywhere*, which means the next surface will find it on its own.
6. **Nothing measures the acceptance criteria.** M14's criteria are "lighthouse/
   accessibility/performance checks meet project targets", "no critical UI requires a
   mouse", "provider outage does not crash the whole app". None of them can be checked
   today: there is no measurement, so "meet project targets" is not a statement anyone
   can make. And M13 taught the expensive lesson that an assertion nobody can falsify
   is not evidence — so the measurement has to come with falsifiable assertions.

## What Changes

Four waves, each independently verifiable, in the order the risk justifies:

- **Security.** A dependency-free security policy in `next.config.ts`: a
  Content Security Policy written against the domains YouTube playback genuinely
  requires, plus the standard hardening headers. Per-instance, best-effort request
  throttling on the public routes, bounded and process-local, with the honesty that it
  is not durable rate limiting. A boundary rule that every API route validates and
  bounds its parameters, enforced by the architecture suite.
- **Resilience.** Cache-corruption recovery in the worker: a stored entry that cannot
  be served is deleted and the request falls through to the network, and a read that
  throws is treated as a miss rather than propagated. A storage-failure story for the
  listener. A rule, with tests, that a stored record is untrusted everywhere.
- **Performance and accessibility measurement.** A dependency-free audit harness — the
  same CDP shape M13 established — that measures Core Web Vitals in a real browser, and
  audits contrast against the design tokens, interactive-element naming, focus
  visibility, and keyboard reachability. Its findings are fixed, not filed.
- **Targets.** The thresholds the acceptance criteria refer to, written down as numbers
  with the harness asserting them, so "meets project targets" becomes checkable.

## Capabilities

- **New Capabilities**:
  - `security` — the response security policy (CSP and headers), boundary input
    validation as a rule for every route, per-instance best-effort throttling, and the
    contents of an export.
  - `performance` — measurable Core Web Vitals without user telemetry, bounded local
    list rendering, and the absence of idle polling.
- **Modified Capabilities**:
  - `pwa` — the worker recovers from a corrupt cache entry instead of serving it.
  - `local-data` — corrupted records and a failed open/upgrade are handled as
    listener-visible states, not as blanks.
  - `app-shell` — the accessibility fundamentals gain measurable contrast and
    keyboard-reachability targets, so "no critical UI requires a mouse" is checkable.

## Impact

- **New code**: the security policy and headers in `next.config.ts`; a bounded
  process-local throttle module; cache-read hardening in `public/sw.js`; a storage
  failure surface; an audit harness under the change's `evidence/`.
- **Existing code touched**: the API routes (throttle), the worker (corruption
  recovery), the shell or an existing surface (the storage-failure message), plus the
  architecture suite and whichever files the audit findings turn out to name.
- **No new dependency.** The CSP, the throttle, the PNG-free audit, the contrast
  computation and the CWV measurement are all reachable with Node built-ins and the
  CDP harness M13 already established. `axe-core` and `lighthouse` would each be a
  large surface for two checks this repository can make itself, and this project's
  standing rule is that a dependency needs a concrete reason.
- **No new dataset, no new API route, no provider behavior change.**
- **Known limitations, stated rather than hidden**: process-local throttling is not
  durable and not per-user (there are no users); a CSP strict enough for XSS still has
  to permit the domains the YouTube player needs, so `frame-src` for
  `youtube-nocookie.com` stays; CWV measured on one machine is a regression signal,
  not a lab score, and the harness says so.
