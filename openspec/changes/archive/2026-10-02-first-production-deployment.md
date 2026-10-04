# Evidence: the first Spotivibe production deployment

Canonical production origin: **https://spotivibe-web.vercel.app**

Verified against the live deployment over the network on 2026-10-02. Every number below was
produced by a request that actually ran; nothing is inferred from a local build. Checks that
genuinely cannot be automated are recorded as MANUAL and were **not** claimed as passing.

## Automated — 8 passed, 0 failed

| Check | Result | Evidence |
| --- | --- | --- |
| `GET /` | **200** | `text/html; charset=utf-8`, 49721 bytes, Spotivibe markup present |
| `Content-Security-Policy` | **present** | see the full directive list below |
| `X-Content-Type-Options` | **present** | `nosniff` |
| `Referrer-Policy` | **present** | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | **present** | `DENY` |
| `GET /sw.js` | **200** | 23222 bytes, contains worker constructs |
| service worker cache policy | **updateable** | `public, max-age=0, must-revalidate` — not immutable, no max-age of a day or more |
| `GET /manifest.webmanifest` | **200** | `application/manifest+json`, parses; `name` "Spotivibe", `start_url` "/", `display` "standalone", 4 icons, `theme_color` `#000000`, `background_color` `#121212` |
| manifest icons resolve | **4/4 fetch 200** | `/icon.svg` (image/svg+xml), `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png` |
| `GET /api/search?q=radiohead` | **200** | 919 ms, `cache-control: public, max-age=60`, body `{tracks, diagnostics}`, 3 tracks |
| rate limiting | **429 observed** | 60 rapid requests: `200`x59 then `429`x1, `Retry-After: 18` |
| declared application routes | **11/11 as declared** | `/`, `/search`, `/library`, `/library/liked`, `/now-playing`, `/queue`, `/discover`, `/history`, `/settings`, and the dynamic `/artist/Radiohead` — all 200 with Spotivibe markup |
| an undeclared route | **404** | `/does-not-exist-verify-404` |

## The service worker, and why its absence from the HTML is not a defect

`/sw.js` is not referenced in the server-rendered HTML. That is by design, not a regression: the
worker is registered from client code — `SERVICE_WORKER_URL = "/sw.js"` in
`src/features/pwa/serviceWorker.ts`, attached by `attachServiceWorker()` in `AppShell`. It is
fetched at `200` with `max-age=0, must-revalidate`, which is exactly the policy that lets a new
worker be fetched; an `immutable` or day-long `max-age` would leave the application unupdatable.

## The parked YouTube player is still permitted to run

The deployed CSP is, in full:

```
default-src 'self'
form-action 'none'
object-src 'none'
frame-src 'self' https://www.youtube.com
frame-ancestors 'none'
img-src 'self' https://i.ytimg.com data:
script-src 'self' https://www.youtube.com 'unsafe-inline'
style-src 'self' 'unsafe-inline'
connect-src 'self'
media-src 'self'
manifest-src 'self'
worker-src 'self' blob:
upgrade-insecure-requests
```

`frame-src 'self' https://www.youtube.com` is what the parked player needs in order to exist at
all, and it is present through the CDN rather than only in a local build. Whether the parked
1x1 iframe actually **advances playback** is not established here — see MANUAL below.

## Search really reached the provider

The API's own diagnostics on the deployed origin:

```json
{"tier":"ytmusic","tiersTried":[{"tier":"ytmusic","outcome":"ok"}],"cached":false,"resultCount":2}
```

First track returned: `{"id":"youtube:ZVgHPSyEIqk","title":"Let Down","artists":["Radiohead"]}`

So the deployed function resolved the provider tier and returned real metadata, rather than
serving an empty envelope. `cached: false` also shows the request was not answered from a
pre-warmed cache.

## MANUAL — requires a real browser, and is not claimed as passing

| Check | Why it cannot be automated from a CLI |
| --- | --- |
| online → offline → reload preserves the cached shell | Needs a real service-worker registration and DevTools offline mode. A `fetch` cannot observe what the browser cached. |
| search / playback / queue / library navigation work end to end | Requires the YouTube IFrame player, a user gesture, and audio. |
| the parked 1×1 YouTube player advances playback | The IFrame API is blocked by CSP in the tooling available here. **This item has been unverified since M4 and remains unverified now.** |
| no unexpected production console errors | A console belongs to a browser session. |
| desktop and compact/mobile layouts render correctly | A judgement about rendered pixels, not a status code. |
> **Corrected in M21 — the *reason* in the row above is wrong; the *status* is not.** The
> application ships `frame-src 'self' https://www.youtube.com` (`frontend/next.config.ts:72`) and
> permits `https://www.youtube.com` in `script-src` (`:41-53`), so its own policy allows both the
> frame and the IFrame API script; the CSP claim described a limitation of the tooling used to
> check, not of the deployed application. The real obstacle was that **no browser automation was
> available** — only Edge is installed, and both live origins sit behind Vercel Deployment
> Protection, which is not circumvented. The row's own conclusion stands unchanged: this item
> **remains unverified**. Correction, and the decision to leave archived records as written:
> `openspec/changes/archive/2026-10-02-m17-home-discovery/evidence/README.md`, "Not verified".


The first deployment therefore clears every check this repository knows how to automate, and
leaves the browser-only list open — which is where it has been since M4.

## Deployment topology

| Claim | How it was established |
| --- | --- |
| Vercel's native GitHub integration is the deployment mechanism | Deployments are authored by `vercel[bot]` in this repository's deployment history. |
| a merge to `main` triggers Production | The Production deployment recorded at sha `2ceac9c` is the M18 archive merge. One deployment, created by the merge. |
| PR / feature branches receive Preview deployments | **Observed.** Opening PR #90 produced a Vercel check, a `Vercel Preview Comments` check, and a deployment in the `Preview` environment, state `success`. |
| Root Directory is `frontend` | **Inferred from success.** The repository root declares no dependencies and has no lockfile and no `build` script, so `npm ci` and `npm run build` cannot succeed there. The deployment built, so both ran in `frontend/`. This is inference from the build succeeding, not a read of the project settings. |
| Install is `npm ci`, build is `npm run build` | Same inference, and both are what `frontend/package.json` defines. `package-lock.json` is `lockfileVersion` 3. |
| Node runtime is 24.x | `frontend/package.json` declares `engines.node: "24.x"`, and `tests/deployment-contract.test.ts` checks that pin against Vercel's documented runtimes. The live function's Node version cannot be read without account access, so this is **declared and enforced by test, not observed**. |
| `.github/workflows/ci.yml` remains the canonical gate | Untouched; it runs install, lint, format:check, typecheck, test and build in `frontend/`. |

A note on how the origin was found, because it was not in the repository: the deployment's
status carries a per-commit URL (`spotivibe-e0t3xtazw-edisons-projects-3fc2eda8.vercel.app`),
which is behind Vercel Deployment Protection — every path on it answers `302` to
`vercel.com/sso-api`. The canonical origin above is the open one. Verification used only the
canonical origin; no protected or generated deployment URL was used, and no authentication was
circumvented.

## Deployment Protection covers Preview deployments too

PR #90 produced a Preview deployment at `spotivibe-6opvoz49e-edisons-projects-3fc2eda8.vercel.app`,
state `success`. **That URL is behind Deployment Protection as well**: it answers `302` to
`vercel.com/sso-api`, exactly as the production per-commit URL does — and the project alias
`spotivibe-e0t3xtazw.vercel.app` answers `x-vercel-error: DEPLOYMENT_NOT_FOUND`.

So the topology is confirmed: feature branches **do** receive Preview deployments. But a Preview is
not an open origin either, and therefore **cannot be used for automated visual verification**.

That matters for **M19**, which is a motion milestone whose correctness is largely a visual
judgement. Its desktop and compact-viewport checks, its transitions, its hover and tap feedback,
and its `prefers-reduced-motion` behaviour cannot be confirmed against a protected Preview from
here, and will be recorded as unverified rather than asserted. The one Preview-derived fact
available from a terminal is that the build succeeds, which is the part a terminal can establish.
