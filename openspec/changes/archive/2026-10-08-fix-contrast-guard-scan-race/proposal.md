# Repair the cross-test-file scan race in the contrast guard

## Why

Batch 26, run while proving M24's criterion, failed 1 of 6. The failing case was not flaky
in the ordinary sense — it was another test breaking it:

```
FAIL tests/token-contrast.test.ts > readable text only ever uses a token that clears AA
     > paints no readable text in a token that fails its minimum
Error: ENOENT: no such file or directory, open
  '…\frontend\src\features\sharing\ProbeM19Motion.tsx'
```

`tests/motion-scope.test.ts` **writes** `src/features/sharing/ProbeM19Motion.tsx` into the
source tree and removes it in a `finally`. `tests/token-contrast.test.ts` **walks that same
directory** and reads the files it found. Vitest executes test files in parallel, so the two
overlap.

The defect is a time-of-check/time-of-use gap in `componentFiles()`
(`frontend/tests/token-contrast.test.ts:119`): it **collects paths** with `readdirSync` in one
pass, and the callers **read the contents** in a later pass. The window between "listed" and
"read" spans the remainder of the walk and the whole of the reading loop — milliseconds to tens
of milliseconds, which is ample for a concurrent writer's `finally` to land.

**Observed rate: roughly 1 in 6 full-suite runs** (batch 26). Running only the two files
together, 8 trials reproduced it **0 times** — the writer's delete window is microseconds, so the
race needs full-suite load to align. That is why it survived so long: it is invisible in
isolation and appears roughly one run in six.

## What this changes

One helper and its two call sites.

- `componentFiles()` returns `{ file, source }` pairs, reading each file **inside the walk**,
  immediately after its directory entry is seen.
- A file that is listed and then cannot be read is **skipped rather than thrown on**, because a
  path that `readdirSync` returned and `readFileSync` then cannot open was deleted concurrently.
  A genuinely absent product file is absent from the listing and so is not this guard's subject.

Every product `.tsx` is still read and still checked. Nothing is skipped that exists; only a
file that vanished mid-scan is passed over, and it is passed over because it is not in the
product.

## What this does not change

- The contrast rules, their thresholds, and what counts as an offence are untouched.
- `motion-scope.test.ts` keeps writing its probe into the real source tree. That is the point of
  the test: the guard must be evaluated against the real tree. Making the probe write somewhere
  else would make the test prove nothing.
- No guard is weakened. The existing "the walker must reach the components" assertion still
  requires more than 30 files, so a reader that silently stopped finding files would still fail.

## Why this was not folded into M24

It is a different capability — a design-system contrast guard's data flow, not the verification
apparatus — and M24's own tasks recorded it as an open finding rather than absorbing it. M24 is
merged; this is separate work on its own branch.

## Verification

- The tolerance is proved by test: reading a path that does not exist returns "absent" instead of
  throwing, and reading a path that exists still returns its contents.
- The reader is proved still to find the real components (>30) and still to find text elements
  (>10), so a reader that returned nothing would fail rather than pass quietly.
- The full gate is run to completion, because the defect only appears under full-suite load and a
  targeted two-file run cannot see it.