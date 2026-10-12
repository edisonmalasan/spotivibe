import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { INHERITED_MOTION, MOTION_ALLOWED, MOTION_CLASS } from "@/styles/motionTokens";
import { FRONTEND_ROOT, motionUtilities, sourceFiles } from "./helpers/motionSource";
import { SOURCE_TREE_RETRY_BUDGET_MS } from "./helpers/sourceTree";

/**
 * M19 tasks 4.1 and 4.2 — the no-motion detector, generalised and inverted. This
 * replaces `home-m17-no-motion.test.ts`, which it supersedes rather than contradicts.
 *
 * **What the previous version was, and the two defects M18's verification found in it.**
 *
 * 1. *Its coverage was typed, not walked.* It scoped itself to `features/home` plus one
 *    hand-listed file, so dropping a module carrying a motion utility into
 *    `features/shortcuts`, `features/sharing`, `features/search`, or `Dialog.tsx` was
 *    caught by nothing. **The coverage here is the result of walking `src`** — a new
 *    module is covered the moment it exists, and the walk is asserted rather than
 *    assumed.
 * 2. *Its default was inverted.* M17's claim was that it added **no** motion, so the
 *    rule was "nothing here may animate". M19's claim is the opposite: it **adds** motion
 *    to a named set of surfaces. A guard whose default is "no motion" passes an
 *    application with no motion at all, which would make a milestone that promises to add
 *    some indistinguishable from one that removed it. **The default here is "the named
 *    surfaces must each carry their declared motion"** (task 4.2), and "nothing else
 *    animates" is the second rule rather than the first.
 *
 * The M17 claim itself is not discarded: it is restated below, in its current form, over
 * the same directory M17 was scoped to. What changed is that `HomeView` and
 * `ShelfTrackCard` now carry *vocabulary* motion rather than a raw Tailwind transition,
 * so the pinned utilities are the vocabulary's classes.
 *
 * **What is read, and why.** A DOM walk cannot answer either question: the primitives
 * these surfaces reuse carry motion of their own, and an element inside a new surface is
 * not evidence about anything a milestone wrote. Both properties are about what modules
 * *declare*, and the only instrument that can see a declaration is the declaration. The
 * scan is therefore over **class vocabularies** — `className`/`class` attributes and
 * `*ClassName` constants — rather than over every string, because `playerStore` writes
 * "the same transition a failed refill uses" in prose and an error message reads
 * `"duration must be an integer"`. Comments are stripped for the same reason.
 */

/** Everything under `src`, discovered. */
const files = sourceFiles();

/**
 * The two files that may carry a motion marker without being a *consumer* of motion:
 * the vocabulary's stylesheet and the contract that describes it. They are excluded from
 * `carriers()` because counting them would make "modules that animate" and "modules
 * allowed to animate" differ by a constant, which is the kind of quiet fudge a bound is
 * supposed to prevent.
 */
const VOCABULARY_FILES = new Set(["styles/motion.css", "styles/motionTokens.ts"]);

/** Modules carrying a motion utility, as `src`-relative paths. */
function carriers(): string[] {
  return files
    .filter((file) => file.path.endsWith(".ts") || file.path.endsWith(".tsx"))
    .filter((file) => !VOCABULARY_FILES.has(file.path))
    .filter((file) => motionUtilities(file.source).length > 0)
    .map((file) => file.path);
}

/** The motion markers one module declares. */
function markersOf(path: string): string[] {
  const file = files.find((entry) => entry.path === path);
  expect(file, `${path} must be in the walked tree`).toBeTruthy();
  return motionUtilities(file!.source)
    .map((utility) => utility.marker)
    .sort();
}

describe("the detector's coverage is the source tree, not a list (task 4.1)", () => {
  it("reaches every module under src, so a probe cannot be dropped anywhere unnoticed", () => {
    // The defect M18 found: the previous guard's own coverage assertion walked one
    // directory. Asserting the *whole* tree's size is what makes "walked, not typed" a
    // property rather than an intention.
    expect(files.length, "the walker must reach the source tree").toBeGreaterThan(150);
    const paths = files.map((file) => file.path);
    for (const expected of [
      // The three places M18 named as uncovered by the old guard.
      "features/shortcuts/ShortcutHelpDialog.tsx",
      "features/sharing/ShareButton.tsx",
      "features/search/SearchCombobox.tsx",
      "components/design-system/Dialog.tsx",
      // And one from each corner of the tree, so the walk is not a directory listing.
      "app/globals.css",
      "app/now-playing/page.tsx",
      "stores/playerStore.ts",
      "server/music/normalize.ts",
    ]) {
      expect(paths, `${expected} must be covered by the motion guard`).toContain(expected);
    }
  });

  it("fails when a probe module carrying a motion utility is dropped anywhere under src", () => {
    // The M18 finding, turned into an assertion. The probe is written into a directory
    // the previous guard never walked, the rule is re-evaluated against the new tree, and
    // the file is removed again in a `finally` — so this test cannot leave a probe behind
    // for the next run to inherit.
    const probe = join(FRONTEND_ROOT, "src", "features", "sharing", "ProbeM19Motion.tsx");
    // Written the way a component would write it: a hoisted class-name constant. A bare
    // `export const PROBE = "motion-feedback"` is *not* read as motion by this detector,
    // because a string that reaches no class attribute cannot reach the DOM — which is a
    // stricter rule than M17's and is asserted separately below.
    //
    // ## Why this block also measures itself
    //
    // This is the only test in the repository that writes into the application source tree, and the
    // probe's lifetime is therefore the window every other reader can collide with. Readers now wait
    // and re-list rather than skipping a vanished file, and **that remedy only works while this window
    // is shorter than the budget they wait for** — a claim nobody can check by reading the code, since
    // one assertion here and a `readTree` across a dozen files are both microseconds apart and the
    // ordering is not something either side controls.
    //
    // So the window is measured at the two instants that define it, immediately before the probe is
    // written and immediately after it is removed, and asserted against the budget the readers actually
    // use. **If the probe ever grows past the budget, this fails and says so** — rather than the reader
    // quietly ceasing to help and the collision resurfacing as an intermittent failure somewhere else.
    //
    // Nothing else here changed. The probe is not moved, no lock is taken, and when it exists on disk is
    // exactly when it existed before: the collision is fixed entirely from the reader side.
    const probeWrittenAt = performance.now();
    writeFileSync(probe, 'export const probeClassName = "motion-feedback";\n', "utf8");
    let probeWindowMs = 0;
    try {
      const carriersAfterDrop = readdirSync(join(FRONTEND_ROOT, "src", "features", "sharing")).map(
        String,
      );
      expect(carriersAfterDrop, "the probe must be on disk for this to mean anything").toContain(
        "ProbeM19Motion.tsx",
      );

      const found = motionUtilities(readFileSync(probe, "utf8")).map((utility) => utility.marker);
      expect(found, "a dropped probe must be read as motion").toEqual([MOTION_CLASS.feedback]);
      expect(
        MOTION_ALLOWED.has("features/sharing/ProbeM19Motion.tsx"),
        "and it is not on the allowance, so the scope rule must reject it",
      ).toBe(false);
    } finally {
      rmSync(probe, { force: true });
      probeWindowMs = performance.now() - probeWrittenAt;
    }

    // Asserted outside the `finally` on purpose. An `expect` inside it would replace any earlier failure
    // with its own, so a genuine detector failure would be reported as a window failure — which is the
    // kind of misleading red this repository has been bitten by before.
    expect(
      probeWindowMs,
      `the probe was on disk for ${probeWindowMs.toFixed(1)}ms, and every reader of the source tree ` +
        `retries for ${SOURCE_TREE_RETRY_BUDGET_MS}ms before reporting a vanished file. A window longer ` +
        `than the budget means a repetition can no longer outlast the writer, so the collision would ` +
        `come back as an intermittent failure somewhere other than here.`,
    ).toBeLessThan(SOURCE_TREE_RETRY_BUDGET_MS);
  });

  it("is not fooled by prose, by an error message, or by an identifier", () => {
    // The three false positives a looser matcher produces, each of which was produced by
    // an earlier draft of the helper. A guard that reports these is a guard somebody
    // turns off.
    const playerStore = files.find((file) => file.path === "stores/playerStore.ts")!;
    expect(
      motionUtilities(playerStore.source).map((utility) => utility.marker),
      "prose about a transition is not a transition",
    ).toEqual([]);

    const normalize = files.find((file) => file.path === "server/music/normalize.ts")!;
    expect(
      motionUtilities(normalize.source).map((utility) => utility.marker),
      "a `durationSeconds` field is not a duration utility",
    ).toEqual([]);

    const lyrics = files.find((file) => file.path === "features/lyrics/LyricsPanel.tsx")!;
    expect(
      motionUtilities(lyrics.source).map((utility) => utility.marker),
      "the one real Tailwind transition this milestone inherited, and only that",
    ).toEqual([INHERITED_MOTION.lyricActiveLine]);
  });
});

describe("the named surfaces carry motion (task 4.2, the inverted default)", () => {
  it("gives every allowance at least one marker, so no entry is an empty promise", () => {
    for (const [path, allowance] of MOTION_ALLOWED) {
      expect(allowance.markers.length, `${path}`).toBeGreaterThan(0);
    }
  });

  it("carries motion in every module the milestone put it in", () => {
    // The inversion. The previous guard would have been *green* with every one of these
    // markers deleted, because its rule was "nothing may animate here". Deleting the
    // motion the milestone added must fail, and this is the assertion that makes that so.
    //
    // A marker may be satisfied by the module's own source or by the shell it renders through
    // (`delegatesTo`) — see `MotionAllowance`. Both routes are real animation reaching a real
    // row; what is forbidden is an allowance that claims motion nobody applies.
    const missing: string[] = [];
    for (const [path, allowance] of MOTION_ALLOWED) {
      const own = markersOf(path);
      const delegated = allowance.delegatesTo === undefined ? [] : markersOf(allowance.delegatesTo);
      for (const marker of allowance.markers) {
        if (!own.includes(marker) && !delegated.includes(marker)) {
          missing.push(`${path}: ${marker}`);
        }
      }
    }
    expect(missing, "a named surface lost the motion the milestone added").toEqual([]);
  });

  it("refuses a delegation that points at a module which does not animate the row", () => {
    // The escape hatch has to be a checked one. A `delegatesTo` naming something absent, or
    // something that carries none of the delegated markers, would otherwise satisfy the rule above
    // with motion nobody can see — which is the failure the inverted default exists to catch.
    for (const [path, allowance] of MOTION_ALLOWED) {
      if (allowance.delegatesTo === undefined) continue;
      const target = MOTION_ALLOWED.get(allowance.delegatesTo);
      expect(
        target,
        `${path} delegates to a module that is not itself allowed to animate`,
      ).toBeTruthy();
      const carried = markersOf(allowance.delegatesTo);
      for (const marker of allowance.markers) {
        expect(carried, `${path} delegates ${marker} to a shell that does not carry it`).toContain(
          marker,
        );
      }
    }
  });

  it("puts motion on each of the five surfaces the roadmap names", () => {
    // Read from the allowance rather than restated here, so the five named surfaces are
    // checked for existing and not for being spelled a particular way.
    const surfaces = new Set([...MOTION_ALLOWED.values()].map((allowance) => allowance.surface));
    expect(
      [...surfaces].sort(),
      "entrances, hover and tap feedback, dialog and sheet, player, and Home content",
    ).toEqual(["content", "entrance", "feedback", "player", "surface"]);
    expect(
      [...MOTION_ALLOWED.values()].filter((allowance) => allowance.surface === "surface"),
      "the dialog surface has exactly one module: the primitive",
    ).toHaveLength(1);
  });

  it("animates nothing outside the named set (task 3.6, spec motion — 'Nothing else is animated')", () => {
    // The roadmap's own non-goal — "animating everything" — as a rule rather than a
    // preference. The two files that may carry motion without being *consumers* of it are
    // the vocabulary's stylesheet and its contract; everything else must be an allowance.
    const outside = carriers().filter((path) => !MOTION_ALLOWED.has(path));
    expect(outside, "nothing outside the named surfaces may animate").toEqual([]);
  });

  it("pins every inherited marker to its modules, so the exceptions stay exceptions", () => {
    // Four modules carry motion this milestone did not add, and each is named with the
    // exact marker plus the reason. Without the pin, "inherited" would become a word that
    // covers anything, and the scope rule would stop being a rule.
    for (const marker of Object.values(INHERITED_MOTION)) {
      const holders = [...MOTION_ALLOWED.entries()]
        .filter(([, allowance]) => allowance.markers.includes(marker))
        .map(([path]) => path)
        .sort();
      expect(holders, `${marker} must be pinned to the modules that carry it`).not.toEqual([]);
      for (const [path, allowance] of MOTION_ALLOWED) {
        if (allowance.markers.includes(marker)) {
          expect(
            allowance.why.length,
            `${path} inherits ${marker} and must say so`,
          ).toBeGreaterThan(80);
        }
      }
    }
  });

  it("counts the modules that carry motion, so 'animate everything' cannot creep in unnoticed", () => {
    // The equality is the point: every module that animates is on the allowance, and
    // every module on the allowance animates — directly, or through the shell it renders
    // through. The ceiling then says the set is not allowed to grow without someone noticing
    // — 34 today, and motion was already present in 24 modules before this milestone, which
    // normalised them rather than adding a new kind of surface.
    const animated = MOTION_ALLOWED.size;
    const carriersSet = new Set(carriers());
    const resolving = [...MOTION_ALLOWED.entries()].filter(
      ([path, allowance]) =>
        carriersSet.has(path) ||
        (allowance.delegatesTo !== undefined && carriersSet.has(allowance.delegatesTo)),
    ).length;
    expect(
      resolving,
      "every allowance either animates or renders through something that does",
    ).toBe(animated);
    expect(
      MOTION_ALLOWED.size,
      "motion stays on a named, finite set of modules",
    ).toBeLessThanOrEqual(34);
  });
});

describe("M17's claim, restated in its current form", () => {
  it("still holds over the milestone's own source surface", () => {
    // M17's guard scoped itself to `features/home` plus `Shelf.tsx` because that was the
    // milestone's whole surface. The claim is unchanged in substance — the M17 modules
    // declare no motion *of their own* — but two of them now carry the vocabulary's
    // classes, because M19 gave them motion deliberately. The pin is the exact set, so
    // adding a module to it fails and adding motion to a module not on it fails.
    const pinned: Readonly<Record<string, readonly string[]>> = {
      "features/home/HomeView.tsx": [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      "features/home/ShelfTrackCard.tsx": [MOTION_CLASS.reveal, MOTION_CLASS.feedback],
      "components/recommendations/Shelf.tsx": [MOTION_CLASS.reveal],
    };

    for (const [path, expected] of Object.entries(pinned)) {
      expect(markersOf(path), `${path} must keep exactly its own motion`).toEqual(
        [...expected].sort(),
      );
    }

    // And the rest of M17's surface stays clean, which is the claim M17 actually made.
    const root = "features/home/";
    const m17Modules = files
      .map((file) => file.path)
      .filter((path) => path.startsWith(root) && path.endsWith(".tsx"))
      .filter((path) => !(path in pinned));
    expect(m17Modules.length, "M17's directory must still be walked").toBeGreaterThan(0);
    for (const path of m17Modules) {
      expect(markersOf(path), `${path} declares motion M17 never added`).toEqual([]);
    }
  });

  it("keeps the time shelf's action free of a motion utility", () => {
    // The one case the old guard existed for, restated. `TimeShelf` reuses the design
    // system's ghost button, so the *rendered* control carries the primitive's own motion
    // — that was M17's documented distinction — while the module itself declares none.
    expect(markersOf("features/home/TimeShelf.tsx")).toEqual([]);
    expect(markersOf("components/design-system/Button.tsx")).toContain(MOTION_CLASS.feedback);
  });
});
