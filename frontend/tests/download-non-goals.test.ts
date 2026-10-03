import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ROADMAP §21.5's non-goals, enforced (M20; design decision 10).
 *
 * A non-goal that exists only as a sentence in a design document is a non-goal that survives until
 * someone finds it inconvenient. Each one below is a detector with **two proofs**: a snippet that
 * violates it, so a detector that cannot fail is never mistaken for one that passes, and the real
 * application sources, so a detector that fires for the wrong reason is caught before it is trusted.
 *
 * The seven are stated verbatim in §21.5: "Accounts or auth of any kind. Ad blocking or
 * suppression. A managed offline library in IndexedDB. Local-file playback. Transcoding. Batch or
 * playlist downloading. Progress reporting by percentage."
 *
 * **This suite reads files rather than importing them**, and that is the point. Three of the seven
 * would need a browser, a network, or a successful download to test by running the feature; four of
 * them are properties of code that does not exist, which is only observable from the source tree.
 * A detector over sources can be wrong in the way a detector over behaviour cannot — it can miss a
 * shape nobody wrote down — and `evidence/exclusions-diff.md` says so plainly rather than claiming
 * completeness.
 */

// `dirname(fileURLToPath(import.meta.url))` rather than `new URL("..", import.meta.url)`: under
// jsdom, `import.meta.url` is a path, not a `file:` URL, and the `URL` constructor refuses it.
const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const SRC = join(FRONTEND, "src");

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/**
 * The roots the non-goal detectors scan, and why each one is here.
 *
 * ## The correction this list is
 *
 * M20's evidence recorded that these detectors "cover none of M20's new server files". **That was
 * false, and this is where the false part was.** `applicationSources()` walked all of `src/`, and
 * every server file M20 added — `src/server/download/route.ts`, `service.ts`, `provider.ts` — is
 * under `src/`, so they were covered. The real gap was the opposite one: three roots outside `src/`
 * that the walk never reached.
 *
 * It is worth being precise about which half was wrong, because the two corrections are not
 * interchangeable. "These files are not covered" sends a reader to add a test. "These roots are not
 * scanned" sends a reader to widen a list. Fixing the claim into a different false claim would have
 * preserved the defect in new words.
 *
 * | Root | Why a non-goal can hide there |
 * | --- | --- |
 * | `src/` | The application and the server routes. Where M20's files are. |
 * | `public/` | `sw.js` is executable code the browser runs. It opens caches, and a service worker that cached a download response would be an offline library with no `src/` involvement at all. |
 * | `scripts/` | `generate-icons.mjs` and its siblings run at build time. A build script that fetched media would defeat every runtime check. |
 * | `next.config.ts` | Ships `headers`, which is where a `Cache-Control` for extracted audio or a permissive `connect-src` would be written. |
 *
 * `next.config.ts` is a single file rather than a directory, so `ROOTS` allows one to be one.
 */
const ROOTS: ReadonlyArray<{ path: string; extensions: ReadonlyArray<string> }> = [
  { path: "src", extensions: SOURCE_EXTENSIONS },
  { path: "public", extensions: [".js", ".mjs", ".json"] },
  { path: "scripts", extensions: [".mjs", ".js"] },
  { path: "next.config.ts", extensions: [".ts"] },
];

/**
 * Every application source, comments included: a comment is not an exemption from a non-goal.
 *
 * The `public/` and `scripts/` extensions are wider than `SOURCE_EXTENSIONS` on purpose. A `.js`
 * service worker is as executable as a `.tsx` component, and scanning only TypeScript would leave
 * the one file most likely to cache something unwatched — which is the same "coverage that reads as
 * coverage but is not" defect the root list is correcting.
 *
 * `.d.ts` is excluded: a declaration file states a shape and executes nothing.
 */
function applicationSources(): ReadonlyArray<{ file: string; code: string }> {
  const found: Array<{ file: string; code: string }> = [];
  const walk = (target: string, extensions: ReadonlyArray<string>): void => {
    if (!existsSync(target)) return;
    if (!statSync(target).isDirectory()) {
      // A root that is a single file, such as `next.config.ts`.
      found.push({
        file: relative(FRONTEND, target).split("\\").join("/"),
        code: readFileSync(target, "utf8"),
      });
      return;
    }
    for (const entry of readdirSync(target)) {
      const absolute = join(target, entry);
      if (statSync(absolute).isDirectory()) {
        walk(absolute, extensions);
        continue;
      }
      if (!extensions.some((extension) => entry.endsWith(extension))) continue;
      if (entry.endsWith(".d.ts")) continue;
      found.push({
        file: relative(FRONTEND, absolute).split("\\").join("/"),
        code: readFileSync(absolute, "utf8"),
      });
    }
  };
  for (const root of ROOTS) walk(join(FRONTEND, root.path), root.extensions);
  return found;
}

const SOURCES = applicationSources();

/**
 * Roots that are executed by the build rather than shipped to a browser.
 *
 * Two assertions below are about what *reaches a client chunk* — "exactly one place declares the
 * capability", "only a server module may name the extractor". Widening the roots to include build
 * tooling found two files that trip them for entirely legitimate reasons: a fixture that names
 * `offlineDownload` because it is a case about it, and a bundle-measurement script that names the
 * extractor because reporting whether the extractor reached a client bundle is its entire purpose.
 *
 * ## Why this is a named list and not a `startsWith("scripts/")`
 *
 * Because `startsWith("scripts/")` would silently grow to cover `scripts-that-ship/` or any future
 * sibling directory. A literal exclusion with a fixed set of roots can only exclude what somebody
 * deliberately added, and `SHIPPED_CODE excludes only build tooling` asserts the set, so adding a
 * root here fails that test until the reason is written down.
 *
 * ## What this does NOT do
 *
 * It does not exempt `scripts/` from the seven non-goal detectors. Those scan `SOURCES`, which
 * includes it — a build script that fetched media or opened an offline cache would violate a
 * non-goal exactly as much as application code would. Only the two *shipped-code* assertions narrow.
 * `scripts is still scanned by the non-goal detectors` asserts that this stays true.
 */
const BUILD_TOOLING_ROOTS: ReadonlyArray<string> = ["scripts/"];

/** Everything outside build tooling. */
const SHIPPED_CODE = SOURCES.filter(
  (entry) => !BUILD_TOOLING_ROOTS.some((root) => entry.file.startsWith(root)),
);

/** Read one file relative to `frontend/`, for the assertions that name a specific path. */
function read(relativePath: string): string {
  return readFileSync(join(FRONTEND, relativePath), "utf8");
}

/**
 * Join detector arms into one alternation.
 *
 * `String.raw` throughout, so an arm reads in the test as the regex it is. A regex *literal* cannot
 * be written across lines — a line terminator inside one is a parse error before flags are even
 * considered, which is why this helper exists rather than one very long line per detector. The
 * alternative, one arm per line inside an `x`-flagged literal, looks better and does not parse.
 */
function anyOf(arms: readonly string[], flags = ""): RegExp {
  return new RegExp(arms.join("|"), flags);
}

/**
 * The same source with comments and string literals removed.
 *
 * Needed for exactly one assertion, and the reason is worth stating rather than hiding: the streaming
 * check looks for `.arrayBuffer()`, `.blob()` and `.text()`, and `server/download/service.ts`
 * *documents those three calls in a comment* to explain why it does not make them. Checking raw text
 * would make the module's own explanation of itself the thing that fails the suite.
 *
 * It is used for that one assertion and not for the non-goal detectors, where comments are
 * deliberately *not* exempt: a comment naming `ffmpeg` beside an absent import is a stronger hint than
 * the import would be, and a comment is not an exemption from a non-goal.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

interface NonGoal {
  /** §21.5's own wording, trimmed to a clause. */
  readonly name: string;
  readonly pattern: RegExp;
  /**
   * Snippets that violate this non-goal. Their presence is what proves the detector can fail.
   *
   * An array rather than a single snippet, because one snippet proves one spelling. A detector built
   * as a disjunction is watched by however many of its clauses some fixture happens to match, and
   * with a single fixture that number is usually one — M21 measured 5 of 6 arms deletable with the
   * suite green on this detector before this became an array.
   *
   * Several detectors below still carry exactly one, because their clauses are **synonyms** of one
   * another rather than distinct spellings; `load-bearing` explains why that is the right number for
   * those and this is the right number for the one above.
   */
  readonly violations: ReadonlyArray<{ label: string; code: string }>;
}

const NON_GOALS: readonly NonGoal[] = [
  {
    name: "Accounts or auth of any kind",
    // ROADMAP §2.4 clause 1. Independent of the `release-exclusions` suite on purpose: that suite
    // guards the whole permanent-exclusion set, and this one guards the §21.5 list. Two detectors
    // for one policy is duplication only when they would drift, and the drift is the failure mode
    // worth spending a second detector on.
    //
    // Every arm is anchored on an **executable position** — an import specifier, a call, a token
    // name, a credential field — and none on the English words. The first draft matched bare
    // `login`, `createSession` and `refreshToken`, which caught four of this repository's own
    // files: an IndexedDB session *restore* repository, a debounce counter in `historyStore` called
    // `refreshToken`, and three doc comments stating that there is no sign-in. A permanent
    // exclusion detector that fires on the code which upholds it is a detector people disable, and
    // the arms below are the narrowed form of that failure rather than a loosening of the policy.
    pattern: anyOf(
      [
        String.raw`(?:from|import|require)\s*\(?\s*["'][^"']*(?:next-auth|@auth\/|@supabase\/auth-js|@supabase\/supabase-js|firebase\/auth|@clerk\/|@auth0\/|auth0)`,
        String.raw`\b(?:signIn|signInWith|logIn|logInWith|signUp|signOut|logOut|authenticate|authorize|getSession|getAccessToken|getIdToken)\s*\(`,
        String.raw`["'\`](?:access_token|refresh_token|id_token)["'\`]`,
        String.raw`Authorization:\s*["'\`]?Bearer`,
        String.raw`\bcredentials:\s*["'\`][^"'\`]*(?:user|pass|login|account)[^"'\`]*["'\`]`,
        String.raw`\b(?:password|passcode)\s*[:=]\s*["'\`][^"'\`]+["'\`]`,
      ],
      "i",
    ),
    // **One fixture per arm, not one fixture for the detector.** M21 measured this: deleting any arm
    // except the import arm left the whole file green, so 5 of 6 arms had no witness at all. The
    // original single fixture did not cover them by accident — it writes `access_token:
    // session.token` and `password }` *unquoted*, while the token and password arms both require a
    // quoted literal, so it only ever exercised the import arm.
    //
    // These five are **distinct spellings**, not synonyms: a library import, a token key, an
    // `Authorization` header, a `credentials` field and a `password` field are five different ways a
    // credential appears, and a detector that watches only one of them is a detector for that one.
    // So each gets a witness. Where a detector's clauses really are synonyms of each other, the
    // repair is instead to name the detector by its scope — fourteen near-identical fixtures teach
    // nothing, and M20's rule that a hand-written attribution field is a choice rather than evidence
    // applies to fixtures just as much as to clauses.
    violations: [
      {
        label: "an authentication flow importing an auth library",
        code: `
          import NextAuth from "next-auth";
          export async function POST(request: Request) {
            const { email, password } = await request.json();
            const session = await createSession({ email, password });
            return Response.json({ session, access_token: session.token });
          }
        `,
      },
      {
        label: "an authentication flow calling a session or token function",
        code: `
          export async function signInWithGoogle() {
            return getAccessToken({ provider: "google" });
          }
        `,
      },
      {
        label: "a credential token held as a quoted field name",
        // Quoted, because the arm requires it — see above. An unquoted `access_token:` is a
        // different shape and this fixture does not stand in for it.
        code: `const response = { "access_token": token, "id_token": id };`,
      },
      {
        label: "an Authorization header carrying a bearer token",
        code: `const headers = { Authorization: \`Bearer ${"${token}"}\` };`,
      },
      {
        label: "a credentials object naming an account",
        code: `const auth = { credentials: "user:password" };`,
      },
      {
        label: "a password assigned from a literal",
        code: `const config = { password: "hunter2" };`,
      },
    ],
  },
  {
    name: "Ad blocking or suppression",
    // ROADMAP §2.4. Two mistakes were available here and both were taken. A case-insensitive
    // `ad-container` matched `X-Spotivibe-Download-Container` — the substring `ad-Container` — and a
    // bare `\bblockAds?\b` would match a routine that blocks nothing. So every alternative below is a
    // token that appears verbatim in a real ad-blocking implementation (a filter-list rule, a host
    // pattern, a container-class name) and the clause is case-**sensitive**: cosmetic-filter lists
    // are lowercase and camelCase class names are named exactly as written, while prose is not a
    // detector's business.
    pattern:
      /adblock|ad-blocker|adBlocker|\badBlock\b|blockAds|block-ads|hideAds|hide-ads|cosmetic-filter|adsbygoogle|doubleclick\.net|googlesyndication|pagead2?|google_ads|ad-container|ad-wrapper|ad-slot|adunit|adUnit/,
    violations: [
      {
        label: "a cosmetic ad filter",
        code: `
        export const rules = ['##.ad-banner', '##div[id^="google_ads"]', '@@||doubleclick.net^'];
        export function stripAds(html: string): string { return applyRules(html, rules); }
      `,
      },
    ],
  },
  {
    name: "A managed offline library in IndexedDB",
    // §21.5's non-goal, and the one M20 came closest to by accident: a download route that cached its
    // own response would be an offline library wearing the route's clothes. The clause is anchored on
    // a media-ish *store name*, because the store name is what makes it an offline library, and on
    // `caches.open` rather than `cache.put` — the service worker's own `cache.put` is required code.
    pattern:
      /getAudioData\s*\(|captureStream\s*\(|getAudioTracks|MediaRecorder|MediaElementAudioSourceNode|createMediaElementSource\s*\(|createObjectStore\s*\(\s*["'`][^"'`]*(?:media|audio|offline|download)[^"'`]*["'`]|objectStore\s*\(\s*["'`][^"'`]*(?:media|audio|offline)[^"'`]*["'`]|(?:STORE_DEFINITIONS|STORE_DEFINITION|createObjectStores?)\b[\s\S]{0,240}?name:\s*["'`][^"'`]*(?:media|audio|offline|download)[^"'`]*["'`]|caches\.open\s*\(\s*[^)]*(?:media|audio|offline|download)[^)]*\)/i,
    violations: [
      {
        label: "an IndexedDB store created to hold downloaded media",
        code: `
        const STORE_DEFINITIONS = [
          { name: STORE.likedTracks },
          { name: "offlineMedia" },
        ] as const;
        for (const definition of STORE_DEFINITIONS) {
          db.createObjectStore(definition.name);
        }
      `,
      },
    ],
  },
  {
    name: "Local-file playback",
    // Distinct from the offline library: this is playing a file the listener already had. The clause
    // is a picker scoped to **audio**, plus the filesystem APIs and URL schemes only a local file can
    // have.
    //
    // The bare `type="file"` in the first draft matched `features/backup/DataControls.tsx`, which is
    // the versioned JSON backup importer — an `<input type="file" accept="application/json">` is how
    // a listener brings data *in*, which is the opposite of this non-goal and a M2 requirement. So
    // the arm requires an audio accept on the same element, and `file://` was dropped because
    // `styles/motionTokens.ts` cites `file://./motion.css` in a doc comment.
    pattern:
      /type\s*=\s*["']file["'][^>]*accept\s*=\s*["'][^"']*audio|showOpenFilePicker|webkitdirectory|webkitRelativePath|FileSystemFileHandle|FileSystemDirectoryHandle|\bblob:null\/|path\.join\([^)]*\.(?:mp3|m4a|flac|opus|ogg|wav)/i,
    violations: [
      {
        label: "a local file picker",
        code: `
        export function LocalLibrary() {
          return <input type="file" accept="audio/*" multiple onChange={onPick} />;
        }
      `,
      },
    ],
  },
  {
    name: "Transcoding",
    // §21.5: "Real transcoding is explicitly out of scope." This is also what the honest `.webm`
    // naming invites somebody to "fix", so it is worth a detector with a fixture of exactly that.
    pattern:
      /\b(?:ffmpeg|fluent-ffmpeg|avconv|\bsox\b|\blame\b|libav)\b|\.(?:toFormat|convert|remux|transcode|encode)\w*\s*\(\s*["'`](?:mp3|m4a|aac|opus|ogg|flac|wav)["'`]|audio\s*:\s*["'](?:mp3|m4a|aac)["']/i,
    violations: [
      {
        label: "a transcoder converting WebM audio to MP3",
        code: `
        import ffmpeg from "fluent-ffmpeg";
        ffmpeg(input).audioCodec("libmp3lame").toFormat("mp3").save(output);
      `,
      },
    ],
  },
  {
    name: "Batch or playlist downloading",
    // §21.5's non-goal, and the one the *route shape* is the real defence for: a batch endpoint is a
    // different route. So this detector covers both the implementation vocabulary and the path.
    pattern:
      /\/(?:api\/)?download\/(?:batch|bulk|all|playlist|queue|selection)|\bdownload(?:All|Batch|Bulk|Playlist|Queue)\s*\(/i,
    violations: [
      {
        label: "a batch download endpoint",
        code: `
        export async function POST(request: Request) {
          const { ids } = await request.json();
          return downloadAll(ids);
        }
      `,
      },
    ],
  },
  {
    name: "Progress reporting by percentage",
    // §21.5's non-goal, and a subtle one: the size behind any percentage is an *estimate*, so a
    // percentage is a confident number derived from a guess.
    //
    // Every arm therefore names **download** progress. The first draft matched any
    // `Math.round(x * 100)` and any `aria-valuenow`, which caught `components/player/ProgressSlider.tsx`
    // — a playback scrubber whose percentage is a true position within a known duration, and whose
    // removal would be a regression. A non-goal detector that cannot tell a download percentage from
    // a seek-bar position will eventually be turned off by whoever it annoys, so the arms are scoped
    // to the thing §21.5 actually prohibits. The *rendered* half of the same claim — no `progressbar`,
    // no `<progress>`, no `NN%` — is asserted behaviourally in `tests/download-client.test.tsx`,
    // which is the only place a rendered figure can be observed.
    pattern: anyOf(
      [
        String.raw`\b(?:download(?:ed)?[A-Za-z]{0,12}(?:Progress|Percent|Pct)[A-Za-z]{0,12}|progressPercent|pctComplete|percentDownloaded|downloadPct)\b`,
        String.raw`Math\.round\(\s*\(?\s*(?:loaded|downloaded|receivedBytes|bytesLoaded)\b[\s\S]{0,60}?\*\s*100`,
        String.raw`(?:loaded|downloaded|receivedBytes|bytesLoaded)\b[^\n]{0,40}\/[^\n]{0,24}(?:total|contentLength|content_length|\bsize\b)[^\n]{0,24}%`,
        String.raw`\bdownload\b[^\n]{0,40}\d+\s*%`,
      ],
      "i",
    ),
    violations: [
      {
        label: "a download percentage",
        code: `
        const pct = Math.round((loaded / contentLength) * 100);
        return <span>{pct}%</span>;
      `,
      },
    ],
  },
];

describe("ROADMAP 21.5's non-goals are enforced, not merely stated", () => {
  it("scans the roots a non-goal can hide in, not only `src/`", () => {
    // M20's evidence claimed these detectors "cover none of M20's new server files". That was false
    // — `src/server/download/*` is under `src/` and was always covered. The real gap was three roots
    // outside it. This asserts the widened coverage *actually took effect*, by checking that each
    // added root contributes at least one file.
    //
    // Asserted on file counts rather than on the `ROOTS` array itself: a root listed but unreadable,
    // or filtered out by its extension list, would leave the array correct and the coverage unchanged.
    // `public/sw.js` is the specific case — it is the file most likely to cache something, and a
    // `.js`-only root that silently matched nothing would leave it unwatched while this test passed.
    for (const root of ROOTS) {
      const covered = SOURCES.filter(
        (entry) =>
          entry.file.startsWith(`${root.path}/`) ||
          entry.file === root.path ||
          entry.file.startsWith(root.path),
      ).map((entry) => entry.file);
      expect(
        covered.length,
        `${root.path} contributes no files, so the root is listed but not read`,
      ).toBeGreaterThan(0);
    }
    expect(
      SOURCES.some((entry) => entry.file === "public/sw.js"),
      "the service worker must be scanned: it is the most likely place to cache a download",
    ).toBe(true);
    expect(SOURCES.some((entry) => entry.file === "next.config.ts")).toBe(true);
  });

  it("keeps build tooling inside the non-goal detectors' reach", () => {
    // `SHIPPED_CODE` narrows two shipped-code assertions. It must not have narrowed the seven
    // detectors, because a build script that fetched media or opened an offline cache would violate
    // a non-goal exactly as much as application code. Asserted directly rather than inferred from
    // the absence of a failure.
    expect(SOURCES.filter((entry) => entry.file.startsWith("scripts/")).length).toBeGreaterThan(0);
    expect(SHIPPED_CODE.filter((entry) => entry.file.startsWith("scripts/"))).toEqual([]);
  });

  it("excludes only build tooling from the shipped-code scope", () => {
    // The fixed-root list, asserted, so growing it is a deliberate act. `startsWith("scripts/")`
    // would have been the same effect with none of the friction.
    expect([...BUILD_TOOLING_ROOTS]).toEqual(["scripts/"]);
    // And the exclusion must be a strict subset: if it ever covered everything, `SHIPPED_CODE` would
    // be empty and both shipped-code assertions would pass vacuously.
    expect(SHIPPED_CODE.length).toBeGreaterThan(0);
    expect(SHIPPED_CODE.length).toBeLessThan(SOURCES.length);
  });

  it("covers every non-goal the milestone names", () => {
    // A guard on the guard: the milestone lists seven, so a list that shrinks is a silent scope
    // reduction. The count is stated rather than inferred from the array length.
    expect(NON_GOALS).toHaveLength(7);
    expect(NON_GOALS.map((goal) => goal.name)).toEqual([
      "Accounts or auth of any kind",
      "Ad blocking or suppression",
      "A managed offline library in IndexedDB",
      "Local-file playback",
      "Transcoding",
      "Batch or playlist downloading",
      "Progress reporting by percentage",
    ]);
  });

  for (const goal of NON_GOALS) {
    describe(`no ${goal.name}`, () => {
      it("is proven able to fail, so it cannot be mistaken for one that passes", () => {
        // Every fixture, not the first one. A detector with five arms and one witness proved four
        // arms nothing; asserting the first fixture is a check on the check, not on the detector.
        expect(
          goal.violations.map((violation) => ({
            label: violation.label,
            detected: goal.pattern.test(violation.code),
          })),
          `every fixture must be detected; these were missed`,
        ).toEqual(goal.violations.map((violation) => ({ label: violation.label, detected: true })));
      });

      it("finds nothing in the application", () => {
        const offenders = SOURCES.filter((entry) => goal.pattern.test(entry.code)).map(
          (entry) => entry.file,
        );
        expect(offenders, `no source may implement ${goal.name}`).toEqual([]);
      });
    });
  }
});

describe("the download feature is a download to the device and nothing more", () => {
  it("declares every YouTube-sourced track as having no offline download capability", () => {
    // The strongest and cheapest statement of "not a managed offline library": the domain model says
    // so about every track, before any feature gets a chance to behave differently. `backup/schema.ts`
    // independently *refuses* a backup containing `offlineDownload: true`, so flipping it requires
    // editing two files in agreement — which is what makes it deliberate rather than accidental.
    const normalize = read("src/server/music/normalize.ts");
    expect(normalize, "every normalized track must declare no offline download capability").toMatch(
      /capabilities:\s*\{\s*stream:\s*true,\s*offlineDownload:\s*false\s*\}/,
    );

    const schema = read("src/data/backup/schema.ts");
    expect(schema, "a backup claiming offline download must be refused").toMatch(
      /offlineDownload[\s\S]{0,120}value\s*===\s*false/,
    );

    const types = read("src/data/repositories/types.ts");
    expect(types).toMatch(/offlineDownload:\s*boolean/);
  });

  it("gives every Track surface its capability from the normalizer, never from a literal", () => {
    // A second place asserting `offlineDownload: false` would be a second place to get it wrong, and
    // the two would be free to disagree. Asserted by counting: there must be exactly one.
    //
    // Scoped to `SHIPPED_CODE`, which excludes `scripts/`. Widening the scanned roots to include
    // build tooling surfaced `scripts/lyrics-induced-violations.cases.mjs`, a fixture that names the
    // capability because it is a *case about* it. Counting it would mean either deleting a fixture
    // or adding a second exemption, and both would be the wrong repair: the assertion's subject is
    // "one place in the application decides the value", and a case file does not decide anything.
    // The exclusion is asserted to be exactly that one root by `SHIPPED_CODE excludes only build
    // tooling`, so it cannot quietly widen.
    const offenders = SHIPPED_CODE.filter((entry) =>
      /offlineDownload:\s*true/.test(entry.code),
    ).map((entry) => entry.file);
    expect(offenders).toEqual([]);
    const declarations = SHIPPED_CODE.filter((entry) =>
      /offlineDownload:\s*false/.test(entry.code),
    ).map((entry) => entry.file);
    expect(declarations, "exactly one place may declare the capability's value").toEqual([
      "src/server/music/normalize.ts",
    ]);
  });

  it("writes nothing to IndexedDB, which is a property of the import graph", () => {
    // "Nothing is written to IndexedDB" is not testable by running the feature — a download that
    // did not happen tells you nothing. It is testable from the import graph: if the client half of
    // this feature cannot reach the data layer, no code path exists by which it could write to it.
    const feature = [
      "src/features/download/saveFile.ts",
      "src/features/download/useDownloadTrack.ts",
      "src/features/download/DownloadControl.tsx",
      "src/stores/downloadStore.ts",
    ];
    expect(feature, "the feature must still be where this suite expects it").toHaveLength(4);
    for (const file of feature) {
      const code = read(file);
      expect(code, `${file} must not import the data layer`).not.toMatch(
        /from\s+["']@\/data\/|from\s+["'][^"']*indexeddb|openDB|Dexie|idb\b/,
      );
      expect(code, `${file} must not reach playback`).not.toMatch(
        /from\s+["']@\/stores\/(?:player|queue|playback|history)Store/,
      );
    }
  });

  it("keeps the whole feature to one route and one provider id", () => {
    // §21.5's non-goal "batch or playlist downloading" is decided by the route *shape*, so the
    // shape is asserted rather than inferred. A second route under the same directory is rejected
    // by name in `release-exclusions`; this asserts the whole picture from the other direction.
    const routes = SOURCES.map((entry) => entry.file).filter((file) =>
      /\/api\/download\/.*\/route\.ts$/.test(file),
    );
    expect(routes).toEqual(["src/app/api/download/[videoId]/route.ts"]);

    const route = read("src/app/api/download/[videoId]/route.ts");
    // No POST, no PUT: a download is a read of an existing resource, and a body-accepting verb is
    // how a "download anything I send you" route would be written.
    expect(route, "the route must only read").not.toMatch(/export\s+async\s+function\s+POST/);
    expect(route, "the route must only read").not.toMatch(/export\s+async\s+function\s+PUT/);
    expect(route).toMatch(/export\s+async\s+function\s+GET/);
  });

  it("states the streaming claim as code rather than as a comment", () => {
    // The suite the milestone's "Automated verification" section asks for: "the route *streams* —
    // proven by a test that asserts the response body is a stream and that no whole-body buffer is
    // read." The behavioural half is `tests/download-service.test.ts`; this is the static half,
    // which catches a whole-body read introduced in a module those tests do not exercise.
    const server = [
      "src/server/download/service.ts",
      "src/server/download/sources.ts",
      "src/app/api/download/[videoId]/route.ts",
    ];
    for (const file of server) {
      // Comments and string literals removed: `service.ts` names all three of the calls it forbids
      // in a comment explaining that it does not make them, so raw text would fail on the module's
      // own explanation of itself. See {@link codeOnly}.
      const code = codeOnly(read(file));
      expect(code, `${file} must not read a body whole`).not.toMatch(
        /\.arrayBuffer\(\)|\.blob\(\)|\.text\(\)|\.json\(\)/,
      );
      expect(code, `${file} must not buffer into an array`).not.toMatch(
        /Buffer\.concat|chunks\s*:\s*(?:Buffer|Uint8Array)\[\]|new\s+Buffer\(/,
      );
    }

    // The positive half, per module. A single shared pattern would pass on whichever module happened
    // to contain the one call, and the point of this assertion is that *each* of the three does its
    // own half: the extractor converts the Node stream, the service bounds it, the route hands it on.
    expect(
      codeOnly(read("src/server/download/sources.ts")),
      "sources converts, never reads",
    ).toMatch(/Readable\.toWeb\(/);
    expect(codeOnly(read("src/server/download/service.ts")), "service bounds the stream").toMatch(
      /new\s+ReadableStream</,
    );
    // The route hands the stream to the response, optionally through the pass-through that holds the
    // limiter's permit until the body settles. `holdUntilSettled` reads one chunk at a time and
    // forwards it, so it is the same claim.
    //
    // The trailing comma is load-bearing, not punctuation. It requires `payload.stream` to be an
    // *argument* of the outermost `Response`, and it rejects `new Response(payload.stream).text()`
    // — a whole-body read that a looser pattern matched happily, because the inner constructor
    // satisfies it. Found by probing the pattern against violating shapes, not by reading it.
    expect(
      codeOnly(read("src/app/api/download/[videoId]/route.ts")),
      "route hands the stream straight to the response",
    ).toMatch(/new\s+Response\(\s*(?:holdUntilSettled\(\s*)?payload\.stream\s*,/);
  });

  it("keeps the approved extractor server-only, so it never enters a client chunk", () => {
    // The dependency is production code, so it belongs in the runtime tier rather than dev-only — but
    // it is only safe there because the single module that names it reaches it through a dynamic
    // `import()` inside a server module. A static top-level import would put a multi-megabyte
    // extractor into every client bundle that touched the feature.
    const sources = read("src/server/download/sources.ts");
    expect(sources).toMatch(/await\s+import\(\s*["']@distube\/ytdl-core["']\s*\)/);
    expect(sources, "the extractor must not be a static import").not.toMatch(
      /^import\s[^\n]*from\s+["']@distube\/ytdl-core["']/m,
    );
    // …and nothing that ships names it at all.
    //
    // Scoped to `SHIPPED_CODE`, for the same reason as the capability assertion above: widening the
    // roots surfaced `scripts/measure-client-bundle.mjs`, a build-time script that names the
    // extractor precisely so it can report whether the extractor reached a client chunk. That is
    // the check working, not the rule being broken — the rule is about what enters a client chunk,
    // and a build script is not one. Excluding it by name would have been worse: the script would
    // then be free to start *importing* it.
    const outsideServer = SHIPPED_CODE.filter(
      (entry) => !entry.file.startsWith("src/server/") && /@distube\/ytdl-core/.test(entry.code),
    ).map((entry) => entry.file);
    expect(outsideServer, "only a server module may name the extractor").toEqual([]);
  });

  it("declares the function duration the deployment design is built around", () => {
    // §21.5: "Must be stated explicitly in `export const maxDuration` rather than left to default."
    // A default that moved with the plan would move a constraint the route is designed around
    // without anybody editing this file.
    expect(read("src/app/api/download/[videoId]/route.ts")).toMatch(
      /export\s+const\s+maxDuration\s*=\s*300\b/,
    );
  });
});
