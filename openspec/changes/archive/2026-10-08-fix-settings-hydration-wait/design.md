# Design: synchronising on the asserted condition

## The ordering that makes the flake possible

One promise chain, three observable effects, in this order:

1. `readPreferences()` resolves.
2. `hydrateInFlight`'s own `.then(applyPreferences)` runs → the store's `hydrated` becomes `true`.
   **Observable from outside immediately.**
3. `hydrateInFlight` settles, so the component's `.then(() => setStatus("ready"))` runs →
   `setStatus` schedules a React render.
4. React commits → the `disabled` attribute is removed from the DOM. **Observable only now.**

The test's `waitFor` watches step 2 and asserts against step 4. Steps 3 and 4 — a state update and a
render commit — sit between them, and neither is synchronous with the flag.

`waitFor` polls. Whether it observes step 2 before or after step 4 is a scheduling question, and
scheduling is exactly what full-suite load changes. That is the whole flake: **the wait condition is
a necessary but not sufficient precondition for the assertion.**

## Options considered

**A. Wait on the asserted condition — `waitFor(() => expect(autofillToggle()).toBeEnabled())`.**

Chosen. It removes the gap by construction rather than narrowing it: there is no longer a second
signal that can be observed early, so there is no window to lose. It is also self-maintaining — if
the component later gates `disabled` on something else again, the wait follows the assertion instead
of silently drifting back to a stale proxy.

**B. Wait on the component's own status — expose `data-status` and wait for `"ready"`.**

Rejected. It reaches into the component's internal state through the DOM, so a refactor that renames
the state breaks the test for a reason unrelated to behaviour. It also keeps two things to keep in
step.

**C. Derive the component's `status` from the store's `hydrated`.**

Rejected, and it is the tempting one because it removes the duplication that caused the bug. But the
component's `status` also carries `"error"`, rendering `STORAGE_ERROR` when storage is unavailable,
and **the store has no error state to derive it from**. Adopting this would delete the error branch —
a real, user-visible behaviour regression traded for a test fix. The duplication is load-bearing.

**D. Make `hydrate()` set `hydrated: true` in a `finally`, so it flips late.**

Rejected. `hydrated` means "preferences were successfully read"; setting it on failure would make a
failed read indistinguishable from a successful one, and three other suites wait on it. It also
attempts to fix the *store*'s semantics to suit one *test's* timing.

**E. Lengthen the wait or add a fixed sleep.**

Rejected outright. A sleep is a guess about how long a render takes, and it is wrong in both
directions: too short and the flake survives, too long and every run pays for it while still being
unable to say why it is safe.

## Why A is not merely "make the test pass"

The assertion being made is "the toggle is enabled on a fresh Settings page". Option A waits for
exactly that. The previous wait asserted a *different* proposition — "the store finished reading
preferences" — and then relied on the two happening to coincide. If the component were genuinely
broken and stayed `"loading"` forever, the old wait would time out on `hydrated` and report a
timeout; the new wait times out naming the control that never enabled. Both fail, but only one
failure message identifies the defect.

## Scope

One file: `frontend/tests/autofill-setting.test.tsx`, and within it one helper. Product code, the
store, and every assertion are untouched.
