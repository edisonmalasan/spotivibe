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
detectors written for it: it does not extract, download, capture, or proxy audio or video, does
not use `yt-dlp` or any stream download, does not proxy media through the application server,
and does not block or alter ads. Media flows only through the embedded player. Those remain
permanent product exclusions and are enforced by `tests/release-exclusions.test.ts`.

**If you are deploying this publicly or sharing it with anyone else, change this back first.**
The parked configuration is appropriate for a personal instance and is not appropriate for a
public one. Reverting is a presentation change: restore a visible video surface on the
Now Playing route and the `playback` requirements with it.

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

The first deployment is a **manual step**. Nothing in this repository can deploy to
Vercel: it would need account credentials this project does not have and does not want, and
a free-tier account is a resource the project should not spend on a check.

After deploying, verify by hand:

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
