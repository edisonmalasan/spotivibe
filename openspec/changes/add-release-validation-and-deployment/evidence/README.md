# M15 release evidence

The release gate, the end-to-end suite, and what they do and do not establish.

## Reproducing

```bash
# from the repository root
cd frontend
npm ci
npm run build
cd ..
node openspec/changes/add-release-validation-and-deployment/evidence/release-gate.mjs
```

Exit code `0` means no automated check failed. **A NOT RUN item has not passed either** -
the gate prints one line per checklist item with a result or a reason and the steps to
perform it, and the tally names both numbers. `--skip-browser` omits the three
browser-driven checks and says so in the tally.

Individual suites:

```bash
node openspec/changes/add-release-validation-and-deployment/evidence/end-to-end.mjs
node openspec/changes/add-release-validation-and-deployment/evidence/end-to-end.mjs --flow=offline
node openspec/changes/add-release-validation-and-deployment/evidence/end-to-end.mjs --prove-can-fail
```

## The end-to-end suite

Eleven flows, driven by **accessible name, role, and visible text** - which is both what
the flows a listener performs are made of, and a constraint worth keeping: a flow driven
by `aria-label` can only pass if the control is genuinely labelled, so the suite
continuously re-proves the accessibility work rather than testing around it. It needs no
test-only markup in the application, which is why the render assertions look for each
route's own heading rather than a root `data-testid`.

Results are written to `end-to-end-results.json` with the browser, the user agent, and
which engines were installed and run.

### What it proves, and what it cannot

**Provider responses come from recorded fixtures** (`lib/fixtures.mjs`), so a run is
reproducible and does not change when a third party rate-limits a CI runner. The
boundary is explicit: **this suite proves the application's behaviour and nothing about the
providers.** A provider outage is invisible to it by construction, which is why one
scenario fails every provider deliberately and asserts the fallback the listener sees.

Two further limits, both consequences of the automation being a Chromium protocol:

- **Firefox, Android, and iOS are not driven.** They are manual entries in the gate with
  steps, and the matrix document says which is which before listing any target.
- **A file picker cannot be driven from a page**, so the backup flow asserts the import
  surface's own labelled file input and the presence of an export, not the file selection.

### The offline flow takes the origin down for real

It stops the `next start` process and the harness **proves the origin refuses connections**
before anything is asserted. It then asserts the library surface renders from the
service worker, with a `main` region, no error boundary, and real content. It
deliberately does **not** require the connection banner: the banner reports the browser's
own connectivity, and stopping one origin does not change that. The first version required
it and failed for exactly that reason - it was asserting the wrong condition, not finding a
defect.

### Proving the suite can fail

`--prove-can-fail` runs assertions that are deliberately impossible and requires each to
fail. A suite whose assertions have never been observed failing is a report, not a check;
M13's verification pass found three evidence steps in this repository that could not fail,
and this is the standing answer to that.

## The release gate

Covers the roadmap's release checklist. Automated items run the quality gates, the PWA
asset drift check, the release suites, the permanent-exclusion and deployment-contract
checks, the backup round trip, and the browser-driven suites. Seven items are **manual**
and carry their steps: the Vercel deployment, the DESIGN.md visual audit, the three
matrix targets that cannot be driven, the roadmap's own truthfulness, and the provenance
judgement behind `ATTRIBUTION.md`.

The gate also asserts that **every checklist item appears exactly once** in its own output,
which is what stops a future item being added to the list and quietly not checked.

## What the work found in itself

Ten defects, all in this change's own code, and several of them in the harness:

1. The audio-download detector flagged the **backup export** for using `createObjectURL` -
   a feature the roadmap requires. Forbidding the mechanism would have meant deleting it, so
   the pattern now targets audio specifically and a positive check enumerates every download
   the application initiates.
2. The media-proxy detector matched only named hosts, so its own violating snippet - a
   generic forwarder - correctly did not match. It now detects the shape as well.
3. The exclusion sweep excluded the server tree, which is where the file documenting the
   no-account rule lives, so the comment-aware behaviour was never exercised.
4. The harness read the browser's version endpoint **before** launching the browser, and
   reported a timeout that looked like a CDP problem.
5. The browser candidate list double-escaped its backslashes and found no browser at all.
6. The run loop broke at the offline flow, so **the three flows after it never ran** and the
   summary reported 8 of 11 without saying so.
7. The offline flow returned a flag and never stopped the origin, so it asserted nothing
   about being offline.
8. A `RegExp.source` was interpolated without its delimiters, producing a syntax error the
   flows reported as their own failure.
9. A backtick inside a comment inside a template literal ended the string - the third time
   this repository has hit it, and the fix is the same each time.
10. Two assertions were wrong about the _condition_ rather than the code: the backup flow
    demanded a feedback region that only exists after an operation, and the offline flow
    demanded a connection banner that stopping an origin does not produce.

## Recorded conditions and limits

- **One browser engine is installed on the machine that ran this.** The suite is built to
  take a second (`--browser=<engine>`) and the gate reports a second-engine run as NOT RUN
  with the reason, so a one-engine run is never read as a two-engine one.
- **The deployment contract is asserted against the application's shape, not against a live
  Vercel account.** The first deployment remains a manual step;
  `frontend/docs/DEPLOYMENT.md` is the procedure, and it names the five things to verify
  afterwards.
- **The DESIGN.md visual audit is manual.** Contrast, accessible names, and keyboard
  reachability are computed and asserted; proportion, hierarchy, and visual rhythm are human
  judgements no check in this repository makes.
