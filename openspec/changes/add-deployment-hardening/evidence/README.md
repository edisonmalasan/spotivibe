# M14 evidence: deployment hardening

One dependency-free harness, run against a **production build** in headless Edge over
the Chrome DevTools Protocol. `results.json` reports `"pass": true` with **62/62 checks**
and **0 console errors**.

## Reproducing it

```bash
# from the repository root
cd frontend
npm ci
npm run build
cd ..
node openspec/changes/add-deployment-hardening/evidence/audit.mjs
```

Exit code `0` means every check passed. The harness owns the whole lifecycle: it starts
`next start` on port 3212, launches a browser on a debugging port, drives it, and stops
both — including the `taskkill /T /F` on Windows that M13 established as necessary,
because killing the spawned process alone does not free the port.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `SPOTIVIBE_PORT` | `3212` | the port the harness serves from |
| `SPOTIVIBE_CDP_PORT` | `9465` | the browser's debugging port |
| `SPOTIVIBE_BROWSER_PATH` | Edge, then Chrome | an explicit browser executable |

The production server's own log is written to the **OS temp directory**, not to this
folder, so a run never produces a diff in a directory that is otherwise the record of one
specific run. If a run fails to reach the origin, look for `spotivibe-m14-audit-*.log`
in `%TEMP%`.

## What the run covers

**Measurement and accessibility** — 5 surfaces × 2 viewports (1280×900 desktop, 390×844
compact), each checked for four things it can compute exactly: contrast ratio against
the effective background at the WCAG AA minimum for the size class, an accessible name
for every interactive element, Tab reachability of every primary control, and loading
performance against the stated targets.

**The detectors are proven before they are trusted.** A deliberately degraded page —
unreadable text, an unnamed button, a pointer-only control — is injected first, and the
run asserts the same audits find all three. Two defects in the *audit* were found this
way and are recorded in the commit history: it hand-rolled a subset of label association
and reported two perfectly labelled import-mode radios as unnamed, and its primary-control
selector never matched role-based controls at all.

**The security policy as the browser receives it** — a document, the manifest, the
worker file, and a content-hashed static asset, read from real responses rather than
from the config that declared them.

**Throttling end to end** — a loop is served until the ceiling and then refused with
`429`, `Retry-After`, and the limit in the body; a different route class keeps its own
budget.

**The storage-failure state** — IndexedDB is removed before the document runs, which is
what a private window looks like to the application. The notice must appear, must say
the data was not deleted, and must clear once storage opens again.

**Cache-corruption recovery with the origin genuinely gone** — a truncated document is
written into the worker's page cache, the **server process is stopped** (not a simulated
offline mode), and the application is reloaded. It must render, land somewhere real
rather than on a browser error page, and the corrupt entry must be gone.

**Exactly one service worker**, registered at `/` and controlling the page.

## Screenshots

| File | What it shows |
| --- | --- |
| `desktop-library.png` | the desktop shell at 1280×900 |
| `compact-library.png` | the compact shell — the surface where the inactive navigation label was below the contrast minimum, and which a desktop-sized screenshot would not contain at all |
| `storage-unavailable.png` | the storage-failure notice over a working application |
| `offline-corrupt-cache.png` | the application rendering with the origin stopped and a corrupt cached document present |

## Recorded conditions

From `results.json → notes.conditions`: Windows 11 x64, 12 CPUs, headless Edge 154,
viewports 1280×900 and 390×844, a **cold** load (fresh profile, first navigation), served
by `next start` on localhost, measured by `PerformanceObserver` inside the page with
nothing transmitted.

## Disclosures — what this run does not establish

These are recorded in `results.json → notes.disclosures` as well, so the numbers cannot
be read without them.

1. **A single-machine run against a local production build is a regression signal, not a
   field lab score.** The thresholds detect a change between two runs on the same
   machine. They are not a claim about a real listener's device, network, or field
   percentile.
2. **INP is not observed**, because it requires a real interaction. Total blocking time
   from long tasks stands in for responsiveness on a load, which is why the two
   thresholds are separate.
3. **Contrast is computed only where the browser can resolve an opaque background.** Text
   painted over a third-party album image is not computable from the DOM and is excluded
   rather than guessed. The run records how many pairs it checked, so the exclusion is
   visible. Inactive controls are exempt under WCAG 1.4.3 and their measured ratios are
   recorded rather than dropped — a hidden exemption is indistinguishable from never
   measuring.
4. **Keyboard reachability is checked through the elements' own semantics and `tabindex`**,
   not by pressing Tab through the application; a control that is focusable but trapped
   behind a focus trap would not be caught.
5. **Both viewports are measured, and a surface that renders at neither size is not
   covered.** The compact shell does not render at the desktop size, which is precisely
   how the first version of this harness missed the contrast defect the compact viewport
   now catches.
6. **The storage failure is forced, not natural.** The harness removes `indexedDB` before
   the document runs. That is the same shape as a denied site-data permission, but it is
   not a real private window, and the one console error it produces is the injected
   failure itself — recorded under `notes.injectedStorageErrors` and asserted to be
   exactly that, rather than counted against the application.
7. **The throttling ceiling is reached by construction**, because the audit is the only
   client and the limiter is per-process. A real deployment behind a proxy would see
   different addresses, and the behaviour across multiple serverless instances is
   untested by design: the limiter does not coordinate across them, and says so.
8. **The offline window is a stopped process, not a severed network.** A severed network
   would also fail DNS and TLS; a refused connection is the case this milestone's
   fallback chain actually handles.

## Findings this run produced

Fixed in the same change, as ROADMAP M14 requires:

| Finding | Where |
| --- | --- |
| The compact shell's inactive navigation label was painted at 4.16:1, under the 4.5:1 minimum for small text | `BottomNav.tsx` — the label now uses `mist`, which DESIGN.md already specifies for secondary text; the icon keeps `fog`, and no token value changed |
| `text-error` matched no declared token, so two `role="alert"` paragraphs rendered in the inherited colour | `StatsView.tsx`, `MixList.tsx` — now `text-mist`, matching `ErrorState`; the announcement comes from the role, not the colour |
| Two decorative placeholder icons were exposed to assistive technology without a name | `PlaylistCover.tsx`, `AlbumView.tsx` — now `aria-hidden`, like every other decorative icon |
| The audit measured one viewport and so could not see the compact shell | `audit.mjs` — both viewports are measured, and every assertion names the one it ran at |

And one bug of the author's own, which the audit caught: a `//` comment in JSX children
position is page text, not a comment. It rendered as copy on every compact surface and
failed five checks.
