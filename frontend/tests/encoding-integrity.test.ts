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
 * Two or more Latin-1 supplement characters in a row, or the signature of a double-decoded UTF-8
 * sequence. Requires two adjacent high characters because a single legitimate one is fine.
 *
 * Written as `\uXXXX` escapes rather than literal characters, deliberately. A literal version of
 * this pattern puts the very bytes it searches for into this file, so the detector flags *itself* —
 * and the obvious fix, excluding this file from the scan, is exactly the kind of carve-out that
 * turns a check into decoration.
 */
const MOJIBAKE = /[\u00C0-\u00FF]{2,}|\u00C3.|\u00E2\u20AC|\u00C2[\u00C2\s]/;

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
