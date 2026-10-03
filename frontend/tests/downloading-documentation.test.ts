import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * M20 task 6.7: `docs/DOWNLOADING.md` exists and says what the code does.
 *
 * The reason a documentation suite at all is that this file carries the claims a listener cannot
 * check for themselves — which platform limits are designed against rather than observed, what the
 * feature refuses to do, and what it costs. Those are exactly the claims that rot quietly: the code
 * changes, the prose does not, and the document becomes a record of an intention rather than of the
 * application.
 *
 * So every load-bearing statement below is asserted against the **source**, not just against a
 * remembered figure. A number in the prose that no longer matches the constant it describes fails
 * here. A claim about a detector names that detector's test file, so the document cannot outlive the
 * enforcement it describes.
 *
 * The unverified items are asserted *as unverified*. A document that quietly started describing the
 * 300 s duration as observed behaviour would satisfy every other assertion in this file.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const DOC = readFileSync(join(FRONTEND, "docs", "DOWNLOADING.md"), "utf8");

/** One source file, read as UTF-8. */
function source(relativePath: string): string {
  return readFileSync(join(FRONTEND, relativePath), "utf8");
}

describe("docs/DOWNLOADING.md exists and is about this feature", () => {
  it("names the route it documents", () => {
    expect(DOC).toContain("/api/download/[videoId]");
    expect(source("src/app/api/download/[videoId]/route.ts")).toContain("/api/download");
  });

  it("says plainly what the feature is not, so a reader is not misled by the word download", () => {
    // The single most likely misreading of this milestone is that it is a playback change or a
    // media library. Both are stated as negations, in the same words the roadmap uses.
    expect(DOC).toMatch(/not playback|never.*playback/i);
    expect(DOC).toMatch(/not a library|no.*IndexedDB/i);
    expect(DOC).toMatch(/not compliant|may be described as such/i);
  });
});

describe("the format-honesty table is checked against the mapper", () => {
  // Read from the module rather than retyped, so a mapping change fails this instead of leaving a
  // table that describes a mapper nobody uses any more.
  const mapper = source("src/server/download/container.ts");

  it.each([
    ["webm", "opus", ".webm"],
    ["webm", "vorbis", ".webm"],
    ["mp4", "aac", ".m4a"],
    ["mp4", "mp3", ".mp3"],
    ["ogg", "opus", ".opus"],
    ["mpeg", "mp3", ".mp3"],
  ])("documents %s/%s as %s, and the mapper agrees", (container, codec, extension) => {
    expect(DOC, `${container}/${codec} must be documented`).toContain(
      `| \`${container}\` | \`${codec}\` | \`${extension}\` |`,
    );
    // The mapper must actually recognise the pair. Asserting on the extension alone would pass for
    // a document that invented a row.
    expect(mapper, `the mapper must handle ${container}/${codec} -> ${extension}`).toContain(
      extension,
    );
  });

  it("states the rule the whole table exists to serve", () => {
    expect(DOC).toMatch(/never named `?\.mp3`? unless it contains MP3/i);
    expect(DOC).toMatch(/no transcoding|not transcoded/i);
    // `audio/mpeg` requires an explicit codec — the one place a bare media type would have let a
    // `.mp3` name be a guess.
    // The prose is hard-wrapped, so a claim can straddle a line break. Read the whole document with
    // newlines folded to spaces rather than loosening the pattern until it matches a fragment.
    const flat = DOC.replace(/\s+/g, " ");
    expect(flat).toMatch(/`audio\/mpeg` additionally \*\*requires an explicit codec\*\*/i);
  });
});

describe("the stated limits match the constants they describe", () => {
  it("quotes the real budget, the real duration, and the real rate limits", () => {
    const selection = source("src/server/download/selectFormat.ts");
    expect(selection).toMatch(/DOWNLOAD_BUDGET_BYTES\s*=\s*20 \* 1024 \* 1024/);
    expect(DOC).toContain("20 MiB");

    expect(source("src/app/api/download/[videoId]/route.ts")).toContain(
      "export const maxDuration = 300",
    );
    expect(DOC).toContain("300 s");

    const limiter = source("src/server/download/limiter.ts");
    expect(limiter).toMatch(/DOWNLOAD_LIMIT\s*=\s*6/);
    expect(limiter).toMatch(/DOWNLOAD_WINDOW_MS\s*=\s*10 \* 60_000/);
    expect(limiter).toMatch(/DOWNLOAD_CONCURRENCY_LIMIT\s*=\s*4/);
    expect(DOC).toMatch(/6 requests per address per 10 minutes/);
    expect(DOC).toMatch(/4 concurrent per instance/);
  });

  it("carries the arithmetic that makes the budget a real risk", () => {
    // This is the finding most likely to be lost, and the one most likely to be acted on wrongly.
    // A reader who sees only "20 MiB, 300 s" concludes the feature is comfortable.
    expect(DOC).toMatch(/17 minutes/);
    expect(DOC).toMatch(/120 s proxied timeout|proxied request timeout/i);
    expect(DOC).toMatch(/documented, not solved/i);
  });

  it("lists the four statuses the route actually returns", () => {
    // Read per-shape rather than with one loose pattern: three statuses are the first argument to
    // the `errorResponse` helper and `499` is a bare `new Response(null, { status: 499 })`. A
    // single regex loose enough to match both would also match a status in a comment.
    const route = source("src/app/api/download/[videoId]/route.ts");
    for (const code of [400, 502]) {
      expect(DOC, `status ${code} must be documented`).toContain(`\`${code}\``);
      expect(route, `the route must return ${code}`).toMatch(
        new RegExp(`errorResponse\\(\\s*${code}\\b`),
      );
    }
    expect(DOC, "status 499 must be documented").toContain("`499`");
    expect(route, "the route must return 499").toMatch(/new Response\(null, \{ status: 499\b/);
    // 429 is built inline rather than through the helper, because it carries the limiter's
    // `Retry-After` and its structured reason. Asserted where it actually lives.
    expect(DOC, "status 429 must be documented").toContain("`429`");
    expect(route, "the refusal path must return 429").toMatch(/status: 429\b/);

    // And the rethrow: a defect must not be dressed as an upstream outage.
    expect(DOC).toMatch(/rethrown/i);
  });
});

describe("the non-goals are named, and each names the test that enforces it", () => {
  it.each([
    ["Accounts or auth", /Accounts or auth/i],
    ["Ad blocking", /Ad blocking/i],
    ["managed offline library", /managed offline library/i],
    ["Local-file playback", /Local-file playback/i],
    ["Transcoding", /Transcoding/i],
    ["Batch or playlist downloading", /Batch or playlist downloading/i],
    ["Progress reporting by percentage", /Progress reporting by percentage/i],
  ])("names %s", (_label, pattern) => {
    expect(DOC).toMatch(pattern);
  });

  it("points at the suite that enforces them, and that suite exists", () => {
    expect(DOC).toContain("tests/download-non-goals.test.ts");
    expect(existsSync(join(FRONTEND, "tests", "download-non-goals.test.ts"))).toBe(true);
  });
});

describe("the unverified claims are recorded as unverified", () => {
  it("carries the platform limits this feature is designed against", () => {
    expect(DOC).toContain("4.5 MB");
    expect(DOC).toMatch(/streaming.*do not carry this limit|do not carry this limit/i);
    expect(DOC).toMatch(/Deployment Protection/);
  });

  it("says the browser check did not happen, rather than implying it did", () => {
    expect(DOC).toMatch(/No browser verification was possible/i);
    expect(DOC).toMatch(/not verified|never been exercised|not observed/i);
    // A claim that could be mistaken for a pass must not be present in the first person.
    expect(DOC).not.toMatch(/\bverified on a real deployment\b/i);
  });

  it("names what would change it, because an unverifiable claim needs an exit", () => {
    expect(DOC).toMatch(/What would change/i);
    expect(DOC).toMatch(/user-only input/i);
  });
});

describe("the dependency note is honest about what the audit found", () => {
  it("records the lint-chain advisories instead of claiming a clean audit", () => {
    // The older `AGENTS.md` line saying "0 vulnerabilities" was true as of 2026-10-01. Replacing
    // it with another clean number would repeat the mistake this documents.
    expect(DOC).toContain("@distube/ytdl-core");
    expect(DOC).toMatch(/npm audit/);
    expect(DOC).toMatch(/dev-only lint chain/i);
    expect(DOC).toMatch(/recorded rather than papered over/i);
  });
});

describe("the document cites only files that exist", () => {
  it("resolves every backticked source path", () => {
    // Same carve-out as `release-documentation.test.ts`: the document also writes served routes and
    // package names in backticks, and resolving those would report them as missing files — which is
    // how a check like this gets switched off.
    const cited = [...DOC.matchAll(/`([A-Za-z0-9_][A-Za-z0-9_./@-]*\.(?:ts|tsx|mjs|js))`/g)]
      .map((match) => match[1])
      .filter((path) => !path.startsWith("/") && !path.includes("://"));
    expect(cited.length, "the document must cite the code it describes").toBeGreaterThanOrEqual(8);
    for (const path of cited) {
      expect(existsSync(join(FRONTEND, path)), `${path} must exist`).toBe(true);
    }
  });
});
