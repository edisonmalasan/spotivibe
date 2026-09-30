# Design: Deployment hardening

## Context

Four domains, one milestone, and a strong prior that most of the roadmap's bullets are
already implemented. Two consequences shape every decision below.

First, **the risk to manage is regression, not absence**. Reworking working provider
timeouts or retry caps to "harden" them would be a change that can only lose. This
change touches what is missing and audits what is claimed.

Second, **M13's lesson governs the measurement work**: an assertion nobody can falsify
is not evidence. So every audit in this milestone has to be able to fail, must be shown
to fire on a violating case, and must report the machine and viewport it measured on
rather than a bare score.

## Decisions

### 1. The security policy lives in `next.config.ts`, not in middleware or a server wrapper

**Decision.** A static `headers()` rule set in `next.config.ts`, applying to every
route, plus a per-route rule only where something genuinely needs to differ.

**Why.** `headers()` is the one place that applies to *every* response — including
static assets, the manifest, and the service worker itself — with no runtime hook that
could be bypassed by a path I did not think about. A middleware wrapper is a runtime
cost on every request, and (from M13's lesson) a place where an exception could let a
response through un-headered. The headers are a property of the deployment, declared
once, and they work identically on `next start` and on Vercel.

**Alternatives considered.** Per-route `headers()` exports (rejected: seven routes and
`/_next/static/*` and `sw.js` and `manifest.webmanifest` — the set a new route could
forget; rejected deliberately in favour of one declaration). A custom server
(rejected: ROADMAP §7.1's single Vercel-deployable application).

### 2. The CSP is written from the domains the player needs, not from a generic template

**Decision.** An explicit `default-src 'self'` policy whose `script-src`,
`frame-src`, `img-src`, `media-src`, `connect-src` and `style-src` each name the
minimum the application actually reaches. As shipped, that is two third-party origins:
the YouTube IFrame API script and the embed frame it creates, both from the player host,
and the artwork host whose URLs the *server* builds and hands to the client as data.
Development adds `'unsafe-eval'` because Next's dev runtime evaluates generated code;
production does not, and the difference is asserted rather than assumed.

**Amended after the verification pass, three times.** The first draft of this decision
named four origins that never reached the policy - a `nocookie` player variant, a second
artwork host, and a media host - on the reasoning that the player "might" reach them.
They are not reachable: the player is constructed without a `host` player variable, so
the frame is the default embed; the normalizer emits one artwork host; and the player's
media is fetched inside its own frame under YouTube's own policy, so this document's
`media-src` has nothing to permit. A policy derived from a guess about what *might* be
contacted is exactly the permissive policy this decision exists to avoid.

The draft also claimed production carries neither `'unsafe-eval'` nor `'unsafe-inline'`.
It carries inline, deliberately and with a `DEBT` note: the App Router bootstraps
hydration with inline payload scripts that are not enumerable at config time. The honest
statement is that inline *script* is permitted - the protection against remote script
comes from the host list, not from that entry - and the note now says so.

The third amendment is the referrer policy, which this decision did not mention at all.
It was implemented as `no-referrer`, which the verification pass found contradicts the
`playback` spec of record: that capability requires the player "SHALL NOT suppress the
page referrer", and a response-level `no-referrer` suppresses it for exactly the
attribution navigations that requirement is about. It ships as
`strict-origin-when-cross-origin` - the strongest value that leaves the requirement
intact.

**Why.** A CSP that is too tight breaks playback, and a CSP that is too loose is
decoration. The only defensible way to write one is from the domains the code actually
uses — which is why the decision to *derive* the list from the sources (and pin it with
a test) matters more than the header text itself. `style-src` needs `'unsafe-inline'`
because Tailwind's runtime and the inline styles the shell uses are not nonce-plumbed;
that is stated as a debt in the comment rather than hidden.

**Alternatives considered.** A hash-based CSP (rejected: it needs a build step to
collect hashes, and Next's own inline scripts are not enumerable at config time).
`serw`-style nonce middleware (rejected: same problem, plus runtime cost).

### 3. Throttling is process-local, bounded, and described honestly

**Decision.** A small in-memory limiter keyed by client address plus route class, with a
fixed window and a fixed ceiling, applied by the API routes. It evicts its own map when
it grows past a bound. It is documented as best-effort: it does not survive a restart,
does not coordinate across serverless instances, and cannot distinguish one person from
another.

**Why.** ROADMAP asks for exactly this and explicitly warns against pretending it is
durable rate limiting. The value is real even so — it stops the trivial loop that
actually burns shared provider instances — and the failure mode of over-claiming is
worse than the feature: someone would later rely on it as a quota.

**Alternatives considered.** No throttling (rejected: the loop is trivial and the
provider instances are a shared, finite resource). A durable store (rejected: there is
no server, no accounts, and no database by design).

### 4. A corrupt cache entry is a miss, not an answer

**Decision.** Every worker cache read goes through one helper that validates what came
back — a response that is not usable is deleted from the cache and treated as absent,
and a read that throws is caught and treated as a miss. The metadata fallback then does
what it already does when nothing is cached: fall through to the network, and fail
honestly if the network is gone too.

**Why.** A cache is the one component that can hold bytes the application did not just
write. Serving a truncated document is a silent wrong answer, which is the failure mode
M13's whole decision table exists to avoid. Deleting the entry is also self-healing:
the next successful request repopulates it.

**Amended after the verification pass.** The validation compared `content-length` - a
**byte** count - against the length of a *decoded* string, which counts UTF-16 code
units. Every prerendered page in this application contains non-ASCII punctuation, so the
check deleted **intact** entries: four of the nine routes behaved as if never visited,
and the artwork cache deleted and re-downloaded every image on every read. The check is
now in bytes, via `ArrayBuffer.byteLength`.

The finding is worth more than the fix, because of *why* nothing caught it. The unit
tests built responses with no `content-length`, so the comparison never ran. The browser
evidence seeded only a *truncated* entry, so the false-positive path was never
exercised. A check that proves only the failure it was written for is half a check - so
the evidence now also captures an **intact** entry and asserts it is served from its own
route *and survives the read*, and the unit tests drive non-ASCII bodies and binary
artwork through the helper.

**Alternatives considered.** Validating by re-reading the body on every hit (rejected:
it defeats the point of a cache). A cache version bump as the only repair (rejected: it
does not help a device that is already broken).

### 5. Storage failure is a listener-visible state, not a blank page

**Decision.** When the database cannot be opened — unavailable, blocked, or an upgrade
that fails — the shell surfaces a named state that says what happened and what the
listener's data is (untouched, still on the device), rather than rendering an empty
library that looks like data loss.

**Why.** The local data is the product. An empty library and a broken database look
identical from the inside, and the difference matters enormously to the person looking
at it. This is also the M2 failure surface that never got a story.

**Alternatives considered.** A modal on first failure (rejected: it would trap the
listener on a page that cannot work). Logging only (rejected: it is what the code does
today, and the person affected cannot see it).

### 6. The audit is dependency-free and asserts, because the alternative is a score nobody trusts

**Decision.** One harness, in the CDP shape M13 established, that measures Core Web
Vitals through `PerformanceObserver` in a real browser, and audits four things it can
compute exactly: contrast ratio of every rendered text node against its effective
background (WCAG AA 4.5:1 for body text, 3:1 for large text), an accessible name for
every interactive element, a visible focus indicator on keyboard focus, and reachability
of every primary control by Tab alone.

**Why.** `lighthouse` and `axe-core` would each be a large dependency for two checks
this repository can make itself — and, more importantly, a *scored* number is the
opposite of the falsifiable assertions this project has learned to prefer. A computed
contrast ratio with a stated threshold fails when a token pair drifts; a Lighthouse
score does not fail a build in a way anyone can act on.

**Caveat recorded, not hidden**: CWV measured on one machine against a local server is
a regression signal, not a lab score. The harness records the machine, the viewport and
whether the run was cold or warm, and the thresholds are set for *regression detection*,
not for parity with a field study.

**Alternatives considered.** `lighthouse` CLI in CI (rejected: dependency, and its
score is advisory). Playwright + axe (rejected: two dependencies, and M13's CDP harness
is already the project's browser automation).

### 7. Fixing the findings is part of the milestone, with a stated order

**Decision.** Wave order is security → resilience → measurement → fixes, because each
wave makes the next one's audit meaningful (there is no point measuring contrast before
the CSP stops the page from being styled differently under a real deployment), and
because a security fix that a later wave invalidates would be wasted work. Findings
from the audit are fixed in the same change, not filed as follow-ups, with the exception
of anything whose fix belongs to a different capability's owner — which is recorded with
its reason rather than silently dropped.

### 8. Thresholds are numbers, with the reasoning that chose them

**Decision.** The `performance` capability states targets as thresholds: LCP and CLS
and a long-task/INP proxy measured against the documented values, local lists bounded,
and no interval that runs while the player is idle. Each threshold names what it is
protecting, so a later change that relaxes it has to argue with the reason.

**Why.** M14's acceptance criterion is "meet project targets defined during this
milestone" — the targets are part of this change, and a target with no stated number is
a target nobody can fail.

## Risks / Trade-offs

- **A CSP can break playback.** This is the highest-risk item in the milestone and it is
  why the policy is derived from the sources, why development and production differ
  explicitly, and why the browser evidence run must exercise playback under the
  production header set rather than assuming a 200 for a document implies a working
  player. If a domain is missed, the honest failure is a blank player — so the harness
  checks the frame, not the header.
- **Throttling can throttle a legitimate burst.** A ceiling tuned for a shared free-tier
  instance could slow a person who legitimately searches quickly. The window and ceiling
  are named constants, the map is bounded, and both are chosen to be generous relative
  to human use.
- **Contrast thresholds can fail on artwork.** Text over a third-party album image is not
  computable from the DOM, so the audit checks text against *token-derived* backgrounds
  and excludes image-backed surfaces explicitly — recording what it excluded rather than
  silently passing them.
- **Deleting a corrupt cache entry loses it.** That is the point: it is rebuilt on the
  next successful request. The worker never deletes an entry it has not validated as
  unusable, and never touches the listener's datasets.
- **CWV on one machine is noisy.** The thresholds are regression bounds, the harness
  records the conditions, and a single slow run is a signal to investigate rather than a
  verdict.

## Migration Plan

1. Additive: headers, a throttle module, worker read hardening, a storage-failure
   surface, an audit harness, and the fixes its findings name.
2. No storage migration: no dataset, record, or envelope change. A corrupt-record rule
   changes how records are *read*, which is exactly what the repositories already do.
3. No data transform: existing local data, sessions, and backups are untouched.
4. Rollback: each wave is a separate commit, so a wave can be reverted on its own. The
   CSP is the one rollback-sensitive item, because a partially rolled-back policy can
   break playback; the harness is the check for that.

## Open Questions

None that change the specs, the approach, or the task breakdown. Two follow-ups are
deliberately out of M14's scope and recorded for the milestone that owns them:
nonce-based style/script hashing (which needs a build step and belongs with any future
move off a single deployable), and durable cross-instance rate limiting (which needs a
server and an account model this project excludes by design).
