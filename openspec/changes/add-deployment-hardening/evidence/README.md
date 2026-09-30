# M14 evidence: deployment hardening

One dependency-free harness, run against a **production build** in headless Edge over
the Chrome DevTools Protocol. `results.json` reports `"pass": true` with **62/62 checks**
and **0 console errors**, and carries **11 disclosures**.

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
written into the worker's page cache, an *intact* one is captured from a real visit, the
**server process is stopped** (not a simulated offline mode), and both are read back. The
truncated entry must be discarded and its route redirected to the shell; the intact one
must be served **from its own route** and must still be in the cache afterwards, at the
same byte length.

That pair exists because of what the independent verification pass found. The integrity
check compared `content-length` — a **byte** count — against the length of a *decoded*
string, which counts UTF-16 code units. Every prerendered page in this application
contains non-ASCII punctuation, so the check deleted **intact** cached documents: four of
the nine routes behaved as if never visited, and the artwork cache could never serve a
hit. Nothing caught it, because the unit tests built responses with no `content-length`
(so the comparison never ran) and this phase seeded only a truncated entry (so the
false-positive path was never exercised). The comparison is now in bytes, and both halves
of the pair are asserted — the run reports the intact document as 30566 bytes served from
`/history` and still 30566 bytes afterwards, where the character count for that same page
is 30564.

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

### What the independent verification pass found, and what happened to it

The pass ran against this change's own specification and nothing else, and returned
**NOT MERGEABLE** with two CRITICAL findings. Both were in this change's own work, and
both were verified by execution rather than by reading:

| Finding | Resolution |
| --- | --- |
| **CRITICAL** — the integrity check compared a byte count to a character count, deleting *intact* cached entries: four prerendered routes, and all artwork | `isIntactResponse` reads an `ArrayBuffer` and compares `byteLength`; three unit tests drive non-ASCII bodies and binary artwork through it, and the browser run asserts an intact document is served from its own route **and survives** the read |
| **CRITICAL** — `Referrer-Policy: no-referrer` contradicted the `playback` spec's "SHALL NOT suppress the page referrer", which this change does not modify, and the existing guard could not see it | The header is now `strict-origin-when-cross-origin`. The guard matched only an inline `"Referrer-Policy": "no-referrer"` pair, so a `{ key, value }` array entry escaped a rule written to catch exactly that; the detector now matches any declaration shape, strips comments first (a comment cannot suppress a referrer — and the rule was flagging `next.config.ts` for *explaining* the decision), and its self-test exercises the shape the real code uses |
| **WARNING** — the record guard allowed `artwork: undefined`, which six surfaces index without optional chaining | `artwork` must be an array; an empty array is fine, an absent field is not, and there is a test for each |
| **WARNING** — `readUsable` did not survive a cache that could not be *opened*, though its comment said it did | `caches.open` is guarded like the read, with a test that makes every cache fail to open |
| **WARNING** — the throttle's address comes from a client-settable header | Documented in the module, in the spec, and in the disclosures: behind a proxy that appends rather than overwrites, a caller that rotates the header gets a fresh budget |
| **WARNING** — three README disclosures were not in `results.json` | Added. The file now carries 11, and the claims match |
| **WARNING** — the "no middleware" guard checked a filename Next 16 renamed | `proxy.ts`/`proxy.js`/`proxy.mjs` are checked too |
| **WARNING** — the eviction test passed under LIFO as well as FIFO | It now asserts the *budget*: a fresh key gets the whole ceiling, a retained one has a slot spent |
| **WARNING** — task 3.5 promised a runtime timer count that was never built | The task was amended to describe the static sweep that exists, and the sweep's limit is in the test's documentation and in the disclosures |
| **WARNING** — two spec scenarios had no test | "No secret is ever exported" is now tested with provider configuration genuinely *set*; the storage-recovery step covers "a failure to read is not a failure to write" |
| **WARNING** — the `app-shell` delta had dropped the landmark obligation | Restored verbatim |
| **WARNING** — the bottom-nav fix overrode the active label's colour | The label picks its own colour now, so the active destination keeps pure white |
| **WARNING** — `form-action 'none'` rested on "there are no forms", and there are four | The comment states the real invariant: each form prevents the default |
| **WARNING** — the `DEBT` note claimed `'unsafe-inline'` blocks remote script injection | Restated: inline script is permitted; remote script is blocked by the host list |
| **WARNING** — a dead import, and eight lint warnings under a green gate | All removed. The gate does not fail on warnings, which is how they accumulated; the repository is now at zero warnings |

And one bug of the author's own, which the audit caught: a `//` comment in JSX children
position is page text, not a comment. It rendered as copy on every compact surface and
failed five checks.

## What the pass could not verify

Stated so this record is not read as broader than it is. The reviewer did **not** execute
this harness — it starts and `taskkill`s a server and a browser, and takes several minutes
— so the 62 checks were not re-run independently; it read the harness end to end and
confirmed the header delivery by starting `next start` separately. It also did not run
`npm ci`, the clean-clone re-verification, or the build, to stay read-only: the
orchestrator ran those, and the gate numbers above are the orchestrator's, not the
reviewer's. `main`'s test count was not confirmed by checkout, so the increase from 2152 is
an inference from the new files rather than a measurement. Vercel's specific
`x-forwarded-for` behaviour was not confirmed either, which is why the throttle's identity
finding is stated conditionally.
