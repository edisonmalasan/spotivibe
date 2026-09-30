# Proposal: Release validation, end-to-end coverage, and Vercel deployment

## Why

M14 made the application safe enough to deploy. Nothing yet establishes that it *can* be
deployed, that the constraints which define the product are enforced rather than merely
observed, or that any user flow keeps working from one release to the next.

Investigating M15's three areas against the repository, most of the checklist is real and
most of the *enforcement* is missing. Saying so precisely matters more here than anywhere
else in the roadmap, because a release gate that claims coverage it does not have is worse
than no gate — it is a gate that has already said yes.

Already in place, with tests: the unit and integration categories M15 lists. Duration
parsing, normalization, filtering and ranking, dedupe, queue transitions, repeat and
shuffle, local recommendation scoring, backup migrations, import merge and replace, and
stats and streak calculations each have dedicated suites; the provider fallback chain, the
IndexedDB repositories, playlist CRUD, and export → reset → import are all covered at the
integration level. **140 test files, 2231 tests.**

What is missing:

1. **The permanent product constraints are unenforced.** ROADMAP §2 calls them "deliberate
   product decisions, not temporary MVP shortcuts" — no accounts, no Supabase, no user
   database, no audio extraction or download, no forced background-play circumvention, no
   ad-blocking, no media proxied through the server. Not one of them is asserted by a
   test. They are held by discipline and by review, which is exactly the mechanism that
   erodes.

   There is a sharper detail. The only occurrence of an account-related pattern anywhere
   in `frontend/src` is a *comment* in `playlistRef.ts` that reads "no account/OAuth/
   cookies anywhere" — the file documenting the constraint is the one file a naive
   detector would flag. M14's verification pass found precisely this failure mode in the
   referrer guard, where a detector that matched the wrong shape went green over a real
   violation. A constraint detector needs the same care, and the comment is the proof.

2. **There is no maintained end-to-end suite.** Thirteen milestones each wrote a browser
   harness — `evidence/cdp-check.mjs` or `evidence/audit.mjs` — and each was archived with
   its change, so there are thirteen copies of the same Chrome DevTools Protocol plumbing
   and none of them runs. M15 names eleven end-to-end flows; together the archived harnesses
   touch some of them, but there is no single suite where a regression in any flow fails a
   check. The duplication is the tell: a capability that gets rebuilt per milestone is not
   yet a capability.

3. **Nothing establishes the deployment.** There is no `vercel.json`, no deployment
   documentation, and no test for the shape the application needs in order to be deployable
   to the free tier. The release checklist's "Vercel production build passes" is currently
   an aspiration with no procedure behind it.

4. **A real deployment defect, found by asking the question the checklist asks.**
   `frontend/package.json` declares **no `engines` field**, so a Vercel build would use
   Vercel's default Node runtime rather than the Node 26 this repository is verified on.
   It would *build* — the application has no required environment variables, no custom
   server, and no native dependencies — and then differ at runtime from anything tested.
   A checklist item that only a human remembers to check is not a gate, and this is what
   that costs.

5. **The backup format is not documented for a person.** The release checklist requires
   "Backup format/version documented". `BACKUP_FORMAT` and `CURRENT_BACKUP_VERSION` exist
   in code and are pinned by tests, so a maintainer can find the version — but nothing
   states the envelope's shape, what each field means, or which version this release
   writes, for someone deciding whether to restore a backup.

6. **The browser matrix is entirely manual and entirely unwritten.** Five targets are
   listed; nothing records what was checked, on what, or what to look for. The honest split
   is worth stating up front: Chromium and Edge desktop are automatable with the CDP
   harness this project already has, because both speak it. Firefox desktop does not, and
   Android and iOS cannot be driven from here at all. Pretending otherwise would produce a
   matrix that is checked-ticked and worthless.

## What Changes

- **The permanent exclusions become enforced.** A release gate that asserts each of them
  against the shipped sources, so a violation fails a check instead of being noticed in
  review. Each detector is proven against a violating snippet *and* against the real
  sources, so the comment that documents a constraint is never mistaken for a breach of it.
- **One maintained end-to-end suite** covering the eleven named flows in a real browser
  against a production build, built on the CDP shape M13 and M14 established rather than a
  fourteenth copy of it. The archived harnesses stay where they are: they are the record
  of a specific run, not code to maintain.
- **A runnable release gate** that executes every checklist item that *can* be automated and
  names the ones that cannot, with the steps for each. A gate that reports "11 of 13
  automated, 2 manual with instructions" is useful; one that reports a single green tick is
  not.
- **A deployment contract, asserted rather than assumed.** The application's deployable
  shape — one Next.js application, no custom server, no required environment variables, the
  security policy declared in config where a CDN cannot drop it, the service worker and
  manifest served with headers that keep updates working — becomes a set of checks. The
  runtime pin is added, because without it the build is not the thing that was tested.
- **Two documents that the checklist demands and nobody wrote**: the backup format, and the
  browser matrix with its automated and manual halves stated.

## Capabilities

- **New Capabilities**:
  - `release-validation` — the release gate is runnable and covers the checklist; the
    permanent exclusions are enforced by checks rather than by review; the deployment
    contract is asserted; the backup format and the browser matrix are documented.
  - `end-to-end` — the named critical flows are exercised in a real browser against a
    production build, by one maintained suite whose assertions can fail.
- **Modified Capabilities**: none.

No existing capability changes behaviour. The permanent exclusions are already specified
where they belong — `music-provider` forbids media streaming through the server,
`local-data` forbids local data leaving the device — and what is missing is enforcement of
what those specs already say, which is a property of the release process rather than of the
product. Putting it in a new capability keeps that distinction visible instead of adding
test-shaped requirements to behavioural specs.

## Impact

- **New code**: a release gate script; an end-to-end harness with the eleven flows; a set
  of exclusion detectors; deployment-contract checks; an `engines` pin in `package.json`.
- **New documentation**: the backup format, the deployment procedure, the browser matrix.
- **No new dependency.** The harness speaks the Chrome DevTools Protocol directly, as
  thirteen archived harnesses already do. Playwright would be the conventional choice and
  would add a large dependency, a browser download, and a second browser abstraction to
  maintain — and it would still not drive Firefox or a phone, which is the half of the
  matrix that actually needs a human.
- **No new dataset, no new API route, no change to any existing behaviour.**
- **Known limitations, stated rather than hidden**: Firefox, Android, and iOS are manual
  because nothing available here drives them; the deployment contract is asserted against
  the application's shape, not against a live Vercel account, so the first real deployment
  remains a manual step with written instructions; and an end-to-end suite that depends on
  live third-party providers can be made deterministic only by mocking them, which means it
  proves the *application's* behaviour and not the providers'.
