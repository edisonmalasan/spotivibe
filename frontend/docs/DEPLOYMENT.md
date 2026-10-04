# Deploying Spotivibe

Spotivibe is a single Next.js application under `frontend/`. It is designed to be deployed
as one unit to Vercel's free tier, and it needs **no environment variable** to run.

That last sentence is the useful part of this document, so it is worth being precise about
what it means and how it is held: `src/server/env.ts` is a zod schema in which every value
is optional, and `tests/deployment-contract.test.ts` parses that schema with an empty
environment and requires it to succeed. A required variable would fail that check, so
"deploys with no configuration" is asserted rather than hoped for.

## What a deployment needs

| | |
| --- | --- |
| Repository | this one, `frontend/` as the project root |
| Framework preset | Next.js (auto-detected) |
| Build command | `npm run build` |
| Install command | `npm ci` |
| Runtime | **Node 24** — pinned in `package.json` `engines.node` |
| Environment variables | **none** |
| Custom server | none, and there must not be one |

Two optional variables exist for operators who want to override the built-in provider
instance lists, and neither is needed: `SPOTIVIBE_INVIDIOUS_INSTANCES` and
`SPOTIVIBE_PIPED_INSTANCES`.

### Why the runtime is pinned, and why 24

`package.json` declares `engines.node` as `24.x`. Without a pin, a Vercel build uses Vercel's
own default Node rather than the one CI verifies — and it would still *succeed*, because the
application has no required variables, no custom server, and no native dependencies. It would
then differ at runtime from anything that had been tested. A build that passes is not a build
that was tested.

**24 is not a preference; it is what the target can build.** Vercel documents its available
build and function runtimes as **24.x (default), 22.x, and 20.x**
([supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)).
A pin naming any other major is not a deployment target — it is a build that fails on
Vercel's schedule rather than in this repository.

This repository previously pinned Node 26, which is available on Vercel only in Sandboxes, not
in builds and functions. The deployment contract now checks the pin against the target's
documented set, and proves that check by rejecting Node 26, so the mistake cannot be repeated
by editing one file. The archived M14 and M15 evidence records still say Node 26, which is
correct: they describe runs that happened before this correction.

`24.x` names a major rather than an exact patch so that a host with a different Node 24 patch
can still satisfy it.

## The playback surface is parked, and that is a departure

**Read this before deploying Spotivibe anywhere other than your own machine.**

The YouTube player is a single persistent IFrame, but it is **visually parked**: 1×1 CSS pixels,
zero opacity, no pointer events, behind the application UI. Spotivibe's own PlayerBar and
MiniPlayer are the only visible playback interface. Now Playing has an opt-in "Show video" that
reveals that same player.

**This does not meet YouTube's documented embedded-player requirements.** Their published rule
asks for a player of a given minimum visible size, and the Developer Policies ask that clients
not interfere with or obscure the attribution provided inside embedded players. Parking the
player does both. It was done deliberately, for private and personal use, and
`openspec/changes/archive/…-lyrix-style-hidden-player/` records the reasoning.

What this deployment **does not** do, and what no test would catch a regression of beyond the
detectors written for it: it does not extract, download, capture, or proxy audio or video **for
playback**, does not use `yt-dlp` or any stream download **for playback**, and does not block or
alter ads. During playback, media flows only through the embedded player. Those remain permanent
product exclusions and are enforced by `tests/release-exclusions.test.ts`.

**M20 added exactly one exception, and it is not playback.** `GET /api/download/[videoId]` streams
one track's audio through the application server **to the listener's own device**, when they ask
for it, at the format the source actually provides — never transcoded, and never named `.mp3`
unless it contains MP3. See `docs/DOWNLOADING.md`. It serves no player, feeds no queue, writes
nothing to IndexedDB, and cannot be used to fetch a URL the caller supplies: the video id comes
from the path and is shape-validated. `tests/download-non-goals.test.ts` enforces §21.5's
non-goals — no accounts, no ad blocking, no managed offline library, no local-file playback, no
transcoding, no batch download, no percentage — with a violating fixture per detector, and each of the
seven detectors now states what it does **not** see as well, so a reader who finds a violation it
missed learns the boundary instead of assuming it is broken.

**If you are deploying this publicly or sharing it with anyone else, change this back first.**
The parked configuration is appropriate for a personal instance and is not appropriate for a
public one. Reverting is a presentation change: restore a visible video surface on the
Now Playing route and the `playback` requirements with it.

## The download route's deployment implications

`GET /api/download/[videoId]` is the one route whose correctness depends on platform configuration
rather than on this repository's code. Four things a deployment must get right, and one that is a
deliberate departure.

| Item | Value | Where it lives |
| --- | --- | --- |
| Function duration | `maxDuration = 300`, stated explicitly rather than inherited from the platform default | the route module |
| Client-facing timeout | 120 s, imposed by Vercel's proxy and **not** configurable from the application | platform |
| Transfer budget | `DOWNLOAD_BUDGET_BYTES`, the ladder's top rung | the route module |
| Rate limiting | per-IP, applied before any provider work, releasing its permit when the body settles | the route module |

**The deliberate departure: `maxDuration = 300` is stated rather than left to the default.** §7.1 says
the duration "must be stated explicitly in `export const maxDuration` rather than left to default", and
this repository follows it. The consequence is that the route's ceiling and the proxy's ceiling are
*different numbers*, and the design bets on the former being operative:

    160 kbit/s, 20 MiB   ~17 minutes   —  9x past the 120 s proxy timeout
     50 kbit/s, 20 MiB   ~56 minutes   — 28x past it

A short track finishes comfortably at either end. A long one at the top of the ladder cannot, on
either reading of which ceiling applies. This is **documented, not solved**: the bitrate range is an
assumption rather than a measurement, no transfer has been observed on this deployment, and choosing a
budget without observing the real timeout would be a guess dressed as a decision. The two options, in
the order they should be tried, are to lower `DOWNLOAD_BUDGET_BYTES` so the ladder's top rung fits
120 s at a realistic rate, or to raise the budget and rely on the 300 s duration. See
`docs/DOWNLOADING.md` for the full working and `evidence/verification.md` in the M20 archive for the
per-check record.

**The second departure is the one above it, in the previous section**: the parked player is not
appropriate for a public deployment, and M20's route is an exception to the *playback* exclusions
rather than to them. Both departures are stated here so that somebody deploying this can see them
before deploying it, rather than discovering them from a test failure.

## What the deployment must serve correctly

- **`/sw.js`** — the service worker, from `public/`. It must not be given a long-lived
  `Cache-Control`, or a new worker will never be fetched and the application will be
  unupdatable. Vercel serves `public/` non-hashed files with `must-revalidate`, which is
  correct; nothing in this repository adds a longer one, and a test holds it that way.
- **`/manifest.webmanifest`** — the web app manifest, from the typed route at
  `src/app/manifest.ts`.
- **The security headers** — declared once in `next.config.ts` and applied to
  `/:path*`, so they reach every response including static assets. They are declared in
  the application rather than injected at the edge, because a CDN can rewrite or drop a
  header it injects and cannot remove one the application sets.

## Verifying a deployment

**Spotivibe is deployed.** The canonical production origin is

    https://spotivibe-web.vercel.app

It was deployed manually — nothing in this repository can deploy to Vercel, because that needs
account credentials this project does not have and does not want — and then verified against the
live origin. The full record is `openspec/changes/archive/2026-10-02-first-production-deployment.md`.

Eight automated checks passed against the deployed origin: `/` returns 200; all four required
security headers are present **through Vercel's CDN** rather than only in a local build;
`/sw.js` returns 200 with `public, max-age=0, must-revalidate`, so a new worker can still be
fetched; `/manifest.webmanifest` parses and its four icons resolve; `/api/search` returns real
provider results; rate limiting answers `429` with `Retry-After`; all eleven declared routes answer
and an undeclared one 404s.

The browser-only list below is **still open** and is recorded as such rather than claimed. Nothing in
this repository can automate it: only a real browser can show whether the offline shell survives a
reload, whether the parked player advances, or whether a layout is right.

The checks themselves:

1. `GET /` returns 200 and the response carries `Content-Security-Policy`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
   and `X-Frame-Options: DENY`.
2. `GET /sw.js` returns 200 with a `Cache-Control` that does not prevent revalidation.
3. `GET /manifest.webmanifest` returns 200 and parses as JSON.
4. `GET /api/search?q=…` returns 200 with a JSON body, and the response is refused with
   `429` and a `Retry-After` after enough rapid requests from one address.
5. Load the deployed origin, then disconnect the network and reload: the application shell
   still renders.

Items 1 to 5 are what the local suites already assert against a production build, so a
deployment that fails any of them has failed something this repository knows how to check.
The manual step is deploying, not verifying.

Item 5 — offline → reload — is the one that cannot be automated from a terminal, and it remains
unverified, exactly as the parked player has been unverified since M4. Both are browser work.

### Where the deployment URL lives

It is **not** in this file by accident: the per-commit deployment URL Vercel reports in a GitHub
deployment status is behind Vercel Deployment Protection, so every path on it answers `302` to
`vercel.com/sso-api`. Verification used the open canonical origin above. Nothing here bypasses that
protection, and a protected URL is not a production URL.

## Rolling back

Vercel keeps previous deployments, so a rollback is promoting the last known-good one from
the project's Deployments view; no rebuild is needed and no data migration is involved,
because **all listener data lives on their own devices** and the server holds none.

That last fact is the reason rollback is cheap here and would not be in a conventional
application: there is no database to reverse, no user records to reconcile, and no schema
to migrate. A rollback cannot lose anyone's library, because the server never had it.

## What a deployment deliberately does not do

- No account system, no cloud sync, no user database. There is nothing to sign into and
  nothing to migrate between environments.
- No media proxying. The server mediates metadata only; media is fetched by the browser
  from the provider, inside the player's own frame.
- No telemetry. The application reports nothing about the person using it. The
  accessibility and performance measurement runs locally against a production build and
  writes to a file.

These are permanent product constraints rather than current limitations. They are enforced
by `tests/release-exclusions.test.ts`, which proves each detector against a violating
snippet *and* against the real sources, so a constraint cannot be quietly broken — or
quietly stopped being checked.
