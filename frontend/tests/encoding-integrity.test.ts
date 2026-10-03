import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The repository's text files must be UTF-8 without a BOM, and must contain no mojibake and no
 * stray control characters.
 *
 * This exists because of a concrete, repeated failure in this repository. Windows PowerShell's
 * `Set-Content -Encoding utf8` reads a file as windows-1252 and writes it back as UTF-8, so an em
 * dash silently becomes three characters. During M20 three source files were damaged this way and one
 * needed three decode rounds to repair. `MEMORY.md` records the rule; this asserts it, because a
 * rule nobody checks is a rule that eventually gets broken by someone who has not read it.
 *
 * Two things make it worth having as a test rather than a script:
 *
 * - **A BOM or mojibake is invisible in review and harmless to every compiler.** It survives to
 *   `main` unnoticed and turns every future diff of that file into unreadable noise.
 * - **A raw NUL made a test fixture read as _binary_.** Review tools, greps and diffs all treat a
 *   binary file differently, so the damage is not just cosmetic — it removes the file from the tools
 *   a reviewer is relying on.
 *
 * The mojibake pattern is deliberately specific. A loose one (any character above U+007F) would fire
 * on the em dashes, section signs and arrows this codebase legitimately uses, and a test that fails
 * on correct code gets switched off.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const REPO = join(FRONTEND, "..");

const ROOTS = ["src", "tests", "scripts", "docs", "public"];
const REPO_ROOTS = ["openspec"];
const EXTENSIONS = /\.(?:ts|tsx|mjs|js|json|md|css|yml|yaml)$/;

/** Directories that are build output or dependency trees, never source. */
const IGNORED = /node_modules|\.next|\.git|coverage/;

/**
 * Characters that a UTF-8 **continuation** byte becomes when the bytes are decoded as windows-1252.
 *
 * Two ranges, because windows-1252 is not Latin-1: bytes 0x80–0x9F are undefined in Latin-1 and
 * decode to typographic punctuation (`€`, `—`, `’`, `“`, `…`), while 0xA0–0xBF decode to themselves.
 * An earlier version of this detector searched for two characters in 0xC0–0xFF, which is the range
 * of UTF-8 *lead* bytes — so it caught mangled em dashes and missed mangled Cyrillic and CJK, and
 * every other mojibake that does not happen to contain U+00E2. It had been calibrated to the one
 * failure this repository actually suffered, which is a reasonable thing to be calibrated to and a
 * poor thing to be *only* calibrated to.
 *
 * (This comment previously quoted the damaged strings verbatim. It does not any more: a file that
 * contains mojibake as an *example* of mojibake is indistinguishable from one that contains it by
 * accident, and this detector flags exactly that. Three times now in this one file — the pattern, the
 * fixtures, and this comment — which is the strongest possible argument for the check.)
 */
const CP1252_CONTINUATION =
  "\\u0080-\\u00BF" +
  "\\u00A0\\u00B7" +
  "\\u0152\\u0153\\u0160\\u0161\\u017D\\u017E\\u0192\\u02C6" +
  "\\u2013\\u2014\\u2018\\u2019\\u201A\\u201C\\u201D\\u201E" +
  "\\u2020\\u2021\\u2022\\u2026\\u2030\\u2039\\u203A\\u20AC\\u2122";

/**
 * A UTF-8 sequence decoded as windows-1252: a lead byte (0xC2–0xF4 — the bytes that can *start* a
 * multi-byte sequence) immediately followed by what its continuation byte turned into.
 *
 * Requiring the pair is what keeps this off legitimate text. An accented Latin letter is itself in
 * the lead-byte range, so a rule that merely banned those characters would fire on `Sigur Rós` — and
 * so would a rule that banned `Ã` followed by anything at all, since `Ãngela` is a real Portuguese
 * name. The second character has to be one that could only have come from a mangled continuation
 * byte, which is what makes the pair specific rather than merely suspicious.
 *
 * The known miss is a *lone* stray character with no pair, such as a single `ð`. This rule cannot
 * see that, and arguably nothing should: `ð` is a legitimate Icelandic and Danish letter, so
 * flagging it would be a false positive on correct code — which is the failure mode that gets a
 * check switched off.
 *
 * Written as `\\uXXXX` escapes rather than literal characters, deliberately. A literal version of
 * this pattern puts the very bytes it searches for into this file, so the detector flags *itself* —
 * and the obvious fix, excluding this file from the scan, is exactly the kind of carve-out that
 * turns a check into decoration.
 */
const MOJIBAKE = new RegExp(`[\\u00C2-\\u00F4][${CP1252_CONTINUATION}]`, "u");

function textFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!IGNORED.test(full)) walk(full);
      } else if (EXTENSIONS.test(name)) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
}

const FILES = [
  ...ROOTS.map((root) => textFiles(join(FRONTEND, root))),
  ...REPO_ROOTS.map((root) => textFiles(join(REPO, root))),
].flat();

describe("every text file is clean UTF-8", () => {
  it("found the source tree, or the walk is broken and every assertion below is vacuous", () => {
    // A test that walks a directory and finds nothing passes forever. Pin the scan itself.
    expect(FILES.length, "the encoding scan must actually see files").toBeGreaterThan(300);
    expect(FILES.some((file) => file.includes(`${join("src", "app")}`))).toBe(true);
    expect(FILES.some((file) => file.endsWith("release-exclusions.test.ts"))).toBe(true);
  });

  it("no file carries a UTF-8 BOM", () => {
    const offenders = FILES.filter(
      (file) => readFileSync(file)[0] === 0xef && readFileSync(file)[1] === 0xbb,
    ).map((file) => relative(REPO, file));
    expect(offenders, "strip the BOM — it makes every diff of that file show as changed").toEqual(
      [],
    );
  });

  it("no file contains mojibake", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      if (!MOJIBAKE.test(text)) continue;
      text.split("\n").forEach((line, index) => {
        if (MOJIBAKE.test(line)) {
          offenders.push(`${relative(REPO, file)}:${index + 1}`);
        }
      });
    }
    expect(
      offenders,
      "these lines look like UTF-8 that was re-encoded as windows-1252 and back",
    ).toEqual([]);
  });

  it("no file contains a stray control character", () => {
    // Tab, newline and carriage return are the only C0 characters a text file may contain. A NUL in
    // particular makes a source file read as binary to review tools and diffs.
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, index) => {
        for (const character of line) {
          const code = character.codePointAt(0) ?? 0;
          if (code < 0x20 && code !== 0x09 && code !== 0x0d) {
            offenders.push(
              `${relative(REPO, file)}:${index + 1} U+${code.toString(16).padStart(4, "0")}`,
            );
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("catches the mojibake it was built for, and misses nothing obvious", () => {
    // The pattern's calibration is pinned here rather than left to a comment, because the previous
    // version of it *looked* fine and had been fitted to exactly one observed failure. Independent
    // review showed it missed every mojibake that does not happen to contain an `\u00e2` — it
    // searched the UTF-8 lead-byte range (0xC0-0xFF) rather than the continuation range (0x80-0xBF
    // plus the windows-1252 punctuation), so Cyrillic and CJK damage sailed straight through.
    //
    // Every fixture is produced by actually performing the corruption rather than by pasting its
    // result. That is self-documenting, and it cannot drift from what the damage really looks like.
    // It also keeps the bytes this suite searches for out of this file — writing them literally
    // made the detector report eleven offending lines, all of them this test.
    const mangle = (text: string): string => Buffer.from(text, "utf8").toString("latin1");

    const mustCatch: ReadonlyArray<readonly [string, string]> = [
      [mangle("\u2014"), "an em dash — the corruption this repository actually suffered"],
      [mangle("\u041f\u0440\u0438\u0432\u0435\u0442"), "Cyrillic"],
      [mangle("\u5343\u672c\u6a69"), "CJK"],
      [mangle("Gr\u00fc\u00dfe"), "German"],
      [mangle("cr\u00e8me"), "French"],
      [mangle("Jo\u00e3o"), "Portuguese"],
    ];
    for (const [text, why] of mustCatch) {
      expect(MOJIBAKE.test(text), `must catch ${why}: ${JSON.stringify(text)}`).toBe(true);
    }
  });

  it("leaves every non-ASCII string this codebase legitimately uses alone", () => {
    // A detector that fires on correct code gets switched off, so the false-positive half matters
    // more than the true-positive half over the long run. These are all real content: titles in four
    // scripts, the em dash and section sign used in prose, the en dash and multiplication sign in the
    // bitrate arithmetic, and `\u00c3ngela`, an actual Portuguese name that the *previous* version of
    // this pattern flagged — because it banned `\u00c3` followed by any character at all.
    const mustNotMatch = [
      "Sigur R\u00f3s \u2014 Hopp\u00edpolla",
      "Caf\u00e9 del Mar",
      "\u00c3ngela",
      "\u00c2 ngela",
      "\u00a721.5 \u2014 the budget",
      "50\u2013160 kbit/s \u00d7 2",
      "\u2192 the client",
      "\u5343\u672c\u6a69",
      "\u041a\u043e\u043c\u043f\u043e\u0437\u0438\u0442\u043e\u0440",
      "\u0645\u0631\u062d\u0628\u0627",
      "\u03a9mega Track",
    ];
    for (const text of mustNotMatch) {
      expect(MOJIBAKE.test(text), `must NOT flag ${JSON.stringify(text)}`).toBe(false);
    }
  });

  it("legitimate non-ASCII prose still passes, so the checks above are not merely strict", () => {
    // Without this, the three assertions above could all be satisfied by a tree with no non-ASCII at
    // all — which would make them vacuous in the other direction. `selectFormat.ts` documents the
    // bitrate arithmetic with en dashes and multiplication signs, and `container.ts` cites §-numbers.
    const selectFormat = readFileSync(
      join(FRONTEND, "src", "server", "download", "selectFormat.ts"),
      "utf8",
    );
    expect(selectFormat).toMatch(/50–160 kbit\/s/);
    expect(selectFormat).toMatch(/§/);
    expect(MOJIBAKE.test(selectFormat)).toBe(false);
  });
});
