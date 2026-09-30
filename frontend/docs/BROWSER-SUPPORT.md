# Browser support matrix

**Read this first: two of the five targets are covered by automated checks and three are
not.** A list of five targets is not a list of five verified targets, and this document
leads with the split so nobody has to infer it.

| Target | Coverage | How |
| --- | --- | --- |
| **Chromium / Edge desktop** | **Automated** | The end-to-end suite drives it over the Chrome DevTools Protocol against a production build |
| **A second Chromium-family engine** | **Automated when a second is installed** | The same suite, `--browser=<engine>`; the release gate reports a second-engine run as **NOT RUN** with the reason when only one engine is present |
| **Firefox desktop** (standard web mode) | **Manual** | Steps below |
| **Android Chromium / PWA** | **Manual** | Steps below |
| **iOS Safari / Home Screen PWA** | **Manual** | Steps below |

## Why the split is where it is

The automation in this repository speaks the **Chrome DevTools Protocol**, which is a
Chromium protocol. Edge and Chrome both speak it, so both can be driven. **Firefox does
not**, and no phone can be driven from a developer machine. That is a tooling boundary, not
a statement about whether the application works there — which is exactly why the manual
half has instructions rather than a shrug.

Adding a second automation stack would cover Firefox automatically and would not cover a
phone. The manual entries are therefore the honest shape of the remaining risk, and each one
below says what evidence to produce.

## Automated: what the suite actually checks

`evidence/end-to-end.mjs` runs eleven flows against a production build: first launch,
search and play, navigate while playing, add to queue, like a track, create a playlist with
add/reorder/remove, reload and session restore, the offline application shell, backup
export and import, provider failure fallback, and mobile navigation.

It also drives a compact viewport as its own flow, and the release gate runs a separate
accessibility and performance measurement against a production build — contrast, accessible
names, keyboard reachability, and loading — before it runs the end-to-end suite.

Two limits belong here rather than in a footnote: provider responses come from recorded
fixtures, so the suite proves **the application's** behaviour and nothing about YouTube; and
a file picker cannot be driven from a page, so the backup flow asserts the import surface's
own controls rather than performing a file selection.

## Manual: Firefox desktop

1. Build and serve the production build, and open it in Firefox desktop.
2. Walk the flows: first launch and language choice, search, play, navigate while playing,
   add to queue, like, create and edit a playlist, reload and confirm the session returns,
   and go offline and confirm the shell still loads.
3. Resize to 1280×900 and to 390×844 and compare against `DESIGN.md`.
4. Tab through the shell and confirm focus is visible at every stop, and that the bottom
   navigation is reachable on the narrow viewport.

**Evidence to produce:** the console, clean or not; a screenshot of each viewport; and a
note of anything that differs from the Chromium run.

## Manual: Android Chromium / PWA

1. Open the deployed origin in Chrome for Android and install it from the menu.
2. Confirm the installed copy launches **standalone** — no browser chrome — and that a
   service worker registered (DevTools is not required; the offline step proves it).
3. Repeat the critical flows, then disable the network and reload: the shell and the
   library must still render, and the connection banner must appear.
4. Background the app and return to it, and confirm playback state survives.

**Evidence to produce:** a screenshot of the installed copy, and the result of the offline
reload.

## Manual: iOS Safari / Home Screen PWA

1. Open the deployed origin in Safari on iOS and add it to the Home Screen.
2. Launch from the Home Screen and confirm it opens standalone.
3. Play something, background the app, and return — the session should be where you left it.
4. Go offline and confirm the shell loads.

**What to watch:** iOS is the platform where a **waiting** service worker is least likely to
activate promptly. If a deployed update appears not to take effect, this is the first place
to look, and the update notice in the player region is the control to exercise.

**Evidence to produce:** a screenshot of the Home Screen launch, and a note of what happened
after a deployment while the app was installed.

## Recording the result

The release gate prints all three manual entries as **NOT RUN** with their steps, and its
tally names how many were not run. When one has been performed, record the outcome and its
date here — a matrix whose rows are all ticked because the rows exist is worth less than one
that says which two were checked.
