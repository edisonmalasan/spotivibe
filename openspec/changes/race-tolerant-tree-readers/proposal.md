# Proposal

## Why

`openspec/specs/verification-integrity` already requires that *every* reader of the application source
tree tolerate a file that vanishes between being listed and being read, and that each such reader report
the loss while its caller asserts none was reported. **One test file complies.**

M25 built the correct helper (`tests/helpers/sourceTree.ts`) and applied it to the single reader it was
shown, `architecture.test.ts`. Thirteen other readers walk the same tree with an unguarded
`readFileSync`, and one more tolerates the race silently. Exactly one writer — `motion-scope.test.ts` —
creates and deletes a probe file inside `src/features/sharing/` while those readers walk it.

The obligation has therefore been stated for four milestones and discharged once. M31 hit the
consequence for real: a gate run failed with `ENOENT ... src/features/sharing/ProbeM19Motion.tsx` in a
branding suite with nothing to say about branding. Two further full runs passed, which is why this
survived as "flaky" rather than as a specification violation.

## What Changes

- **Convert the 13 non-compliant readers** to the existing tolerant path, each passing `onRace` and each
  asserting that no file was reported.
- **Add a guard** that fails when a test file walks the application source tree and reads each listed
  file without going through that path, so a fourteenth reader cannot arrive already non-compliant.
- **Record the measured exposure** — which files, which tree roots, and which are genuinely exposed
  rather than merely textually similar.

No production code changes. No dependency, manifest, or gate-step changes.

Not proposed: moving the probe out of `src/`, and adding a lock. Both were considered and rejected by
M25 with reasons that survive re-reading — a probe the walkers cannot see makes the motion-scope guard
prove nothing, and vitest workers share a filesystem without coordinating. The specification's own
scenario requires the probe to sit where the guard under test walks it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `verification-integrity`: requirement *A test may not mutate the tree another test reads* — the
  "every reader tolerates, reports, and its caller asserts" obligation is strengthened from a stated
  rule to a **checked** one. Today nothing fails when a reader stops complying; after this change a
  guard does.

## Impact

- **Affected:** `frontend/tests/` — 13 reader files, `frontend/tests/helpers/sourceTree.ts`, and one new
  guard. `motion-scope.test.ts` is deliberately **not** changed.
- **Not affected:** application source, route handlers, providers, player, persistence, the client
  bundle, and every gate step. The full gate's cost should not move materially.
- **Risk:** the change is mechanical but wide. Each conversion is independently verifiable, and the
  guard is the part that must be proven able to fail.
