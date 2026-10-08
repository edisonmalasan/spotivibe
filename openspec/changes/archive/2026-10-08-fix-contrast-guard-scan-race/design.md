# Design: repairing the cross-test-file scan race

## The defect, precisely

`componentFiles(dir)` returns `string[]`. It walks with `readdirSync(..., { withFileTypes: true })`
and pushes each `.tsx` path. Both callers then do:

```ts
for (const file of componentFiles(SRC)) {
  const source = readFileSync(file, "utf8");
```

So between `readdirSync` returning an entry and `readFileSync` opening that path, the file can be
deleted. `motion-scope.test.ts` deletes it in a `finally` that runs as soon as its own assertions
finish.

The interval is not the concern; it is the *width*. It covers the rest of the directory walk plus
the entire reading loop of the caller, and under full-suite load with 183 files in parallel that is
tens of milliseconds — vastly more than the microseconds the writer's file exists.

## Options considered

**A. Read inside the walk; skip a file that vanished.** Return `{ file, source }` and tolerate a
concurrent delete.

Chosen. It narrows the window from "the rest of the walk plus the caller's read loop" to "the
microseconds between `readdirSync` returning one entry and opening that one file", and the
tolerance handles what remains.

**B. Read inside the walk; throw on a vanished file.**

Rejected. It shrinks the window without closing it, and leaves a rare hard failure in a guard
that has no reason to fail for environmental reasons. The whole point is that this guard's red
should mean "a contrast rule is broken".

**C. Tolerate the vanished file, keep the two-pass structure.**

Rejected alone. It would mask the race without reducing its probability, so the flake would
become rarer but not gone — worse than either fixing or reporting it, because it would look
fixed.

**D. Make `motion-scope.test.ts` write its probe elsewhere.**

Rejected. The test exists to prove the guard rejects a probe dropped **into the real source
tree**. A probe written to a temporary directory would not exercise the guard's walk at all, so
the test would pass while proving nothing. This is the same reasoning behind refusing to weaken
`evidence-scripts.test.ts` when the gate-batch scripts moved.

**E. Serialise the two files.**

Rejected. Vitest's file-level parallelism is global configuration; disabling it for two files
means either `fileParallelism: false` for the entire suite — a large, unrelated slowdown — or a
per-file grouping mechanism that is not part of the stable surface. The cost is disproportionate
to a defect that option A closes.

**F. Have the probe's directory excluded from the walk.**

Rejected. It would exclude `src/features/sharing/` from a contrast audit, so a real contrast
regression in `ShareButton.tsx` would stop being caught. That is a strictly worse trade than the
flake.

## Why skipping a vanished file is correct rather than convenient

`readdirSync` returned the entry, so the file existed at that instant. `readFileSync` cannot open
it, so it was deleted between the two calls. No other explanation fits: a file that is genuinely
not part of the product is not returned by the listing in the first place, so it never reaches the
read.

The guard's subject is the product's source files. A file that has ceased to exist mid-scan is not
one of them, and asserting contrast ratios on a deleted file is not a stronger check — it is an
impossible one.

## Guard against the fix becoming vacuous

The failure mode of "make the reader tolerant" is a reader that tolerates everything and returns
nothing, which would turn every contrast rule into a pass. Two existing assertions already prevent
that and are kept:

- `finds the text elements in the components` requires more than 30 component files and more than
  10 using the type scale.
- `paints no readable text in a token that fails its minimum` builds its offender list from the
  same reader; a reader returning nothing would report zero offenders and pass.

Both are asserted before and after this change, and the new tolerance test asserts that a missing
path yields "absent" **while an existing path still yields its contents** — the two together mean
the tolerance cannot generalise into silence.

## Scope

One file changed: `frontend/tests/token-contrast.test.ts`. No product code, no guard thresholds,
no other test.