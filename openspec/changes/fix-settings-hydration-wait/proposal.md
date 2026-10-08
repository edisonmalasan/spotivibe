# Synchronise the Settings test on the condition the UI actually depends on

## Why

Batch 31, run to try to certify M25, failed 1 of 6:

```
FAIL  tests/autofill-setting.test.tsx > the autofill preference's default >
      renders as enabled on a fresh Settings page
AssertionError: expect(element).toBeEnabled()

Received element is not enabled:
  <input aria-label="Keep playing when the queue ends"
         checked="" disabled="" role="switch" type="checkbox" />
 ❯ tests/autofill-setting.test.tsx:82:30
```

Roughly 1 in 6 full-suite runs. Running the file alone, it does not reproduce.

## The defect is in the test's wait, not in the product

`AutofillSettingsSection` disables its toggle on `status === "loading"`, where `status` is the
component's **own local** `useState`, flipped to `"ready"` only when *its own* `hydrate()` promise
settles and React commits the re-render. Disabling a control while its value is still loading is
correct behaviour and is not changed.

The test's `renderSettings()` waits on something else:

```ts
await waitFor(() => {
  expect(usePreferencesStore.getState().hydrated).toBe(true);
});
```

`hydrated` is a **store-level** flag, set by `applyPreferences` — which runs strictly *earlier* in
the same promise chain than the component's `.then(() => setStatus("ready"))`. So `hydrated` becomes
observable **before** `setStatus("ready")` is called, and React must then re-render before the
`disabled` attribute lifts. The store flag is therefore *never* a safe proxy for "the toggle is
enabled", and under full-suite load the poll lands in the gap.

The test waits on the wrong condition. It waits on a signal that is a **necessary but not
sufficient** precondition for its assertion.

## What this changes

`renderSettings()` waits on the condition its callers actually assert — the control being enabled —
instead of on a store flag that happens to be set earlier in the chain.

Nothing else moves. The product code is untouched, the assertions are untouched, and the store is
untouched.

## Why this is a verification concern and not a test tidy-up

An unsynchronised wait produces a **red that means nothing**. It reports "the autofill setting is
broken" when the setting is fine and the scheduler was busy. That is the same class of defect as
M21 CRITICAL 1 and 2, and it is why this is recorded against `verification-integrity` rather than
against the preferences surface: the failure mode is a gate that cries wolf, not a gate that is
permissive.

It also blocked a milestone criterion. M25 is merged but **not `DONE`**, because its batch was 5 of
6, and this is the run that failed it.

## Why not fix the component instead

The component's local `status` also carries an `error` case, rendering `STORAGE_ERROR` when storage
is unavailable. The store has no error state to derive from, so the local status is carrying
information the store genuinely does not have. Deriving `status` from `hydrated` would delete the
error branch — a real behaviour regression traded for a test fix.

## Verification

- The corrected wait must still fail when the product is actually broken: mutating the component so
  it stays `"loading"` must turn the suite red, and the source is restored byte-for-byte.
- The full gate must be run to completion, because the defect only appears under full-suite load.
- A batch must reach 6 of 6 for any criterion to be certified. This change does not retroactively
  certify M25.
