import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, CURRENT_BACKUP_VERSION, backupEnvelopeSchema } from "@/data/backup/schema";
import { serializeBackup } from "@/data/backup/serialize";
import { getServerEnv } from "@/server/env";
import { FIXED_EXPORTED_AT, makeBackupData } from "./helpers/backup-fixtures";

/**
 * The release documentation is held by the code (M15 task 5.1; spec `release-validation` —
 * "The release documentation states what it covers").
 *
 * The release checklist asks for the backup format to be *documented*. A document that
 * nothing checks is a document that can drift in either direction, and this suite exists
 * so that it cannot: every claim the document makes about the envelope is asserted against
 * the schema that writes it.
 *
 * That was the gap the first draft of this change had, and it was found by the
 * verification pass rather than by reading: `BACKUP-FORMAT.md` cited
 * `tests/release-exclusions.test.ts` as holding the claim that no server value reaches an
 * export, and that file contained no such test — so the document's one substantive safety
 * claim was held by nothing at all. The test exists here now, and the citation resolves.
 *
 * The same applies to the browser matrix and the deployment procedure, which are asserted
 * below for the same reason.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");

function documentText(name: string): string {
  const path = join(FRONTEND, "docs", name);
  expect(existsSync(path), `frontend/docs/${name} must exist`).toBe(true);
  return readFileSync(path, "utf8");
}

describe("the backup document matches the format the code writes (M15 task 5.1)", () => {
  it("states the format and version the code actually uses", () => {
    const text = documentText("BACKUP-FORMAT.md");
    // Not "mentions a version": states *this* one. A document that said "version 0" would
    // otherwise read as complete.
    expect(text, "the format name").toContain(BACKUP_FORMAT);
    expect(text, "the version").toMatch(
      new RegExp(`version\\s+\\*{0,2}\\s*${CURRENT_BACKUP_VERSION}\\b`),
    );
  });

  it("names every top-level field the schema requires", () => {
    const text = documentText("BACKUP-FORMAT.md");
    // Read from the schema rather than from a hand-written list, so a field added to the
    // envelope without being documented fails here.
    const required = backupEnvelopeSchema.shape as Record<string, unknown>;
    expect(Object.keys(required).length).toBeGreaterThan(3);
    for (const field of Object.keys(required)) {
      expect(text, `the field "${field}" must be documented`).toContain(field);
    }
  });

  it("names every dataset an export actually contains", () => {
    const text = documentText("BACKUP-FORMAT.md");
    // The real export, built by the real serializer from the shared fixture data, so the
    // document's dataset list is compared against what a listener's file will hold rather
    // than against a list restated here. The first version of this test called
    // `collectLocalData()` with no repositories, which produced an empty `data` object and
    // so asserted nothing whatever about the document.
    const envelope = serializeBackup(makeBackupData(), {
      exportedAt: FIXED_EXPORTED_AT,
      appVersion: "0.0.0-test",
    });
    const datasets = Object.keys(envelope.data);
    expect(datasets.length, "the export must carry the documented datasets").toBeGreaterThanOrEqual(
      7,
    );
    for (const dataset of datasets) {
      expect(text, `the dataset "${dataset}" must be documented`).toContain(dataset);
    }
    // And the reverse: the document must not describe a field or dataset that no longer
    // exists. The rows it tables are the envelope's fields and the datasets inside `data`,
    // so the comparison is against both rather than against the datasets alone — the
    // first version compared against the datasets only and so reported the `format` row as
    // a dataset the export lacks.
    const documented = new Set([...Object.keys(backupEnvelopeSchema.shape), ...datasets]);
    for (const claimed of text.matchAll(/^\| `([a-zA-Z]+)` \|/gm)) {
      expect(
        documented,
        `the document describes "${claimed[1]}", which the envelope does not contain`,
      ).toContain(claimed[1]);
    }
  });

  it("cites only tests that exist", () => {
    // The specific defect the first verification pass found: a citation to a check that was
    // never written. Every `tests/...ts` path the document names must resolve, so a
    // citation cannot rot into a claim held by nothing.
    const text = documentText("BACKUP-FORMAT.md");
    const cited = [...text.matchAll(/`((?:src|tests)\/[A-Za-z0-9_./-]+\.ts)`/g)].map(
      (match) => match[1],
    );
    expect(cited.length, "the document must cite the code that holds it honest").toBeGreaterThan(3);
    for (const path of cited) {
      expect(existsSync(join(FRONTEND, path)), `${path} is cited but does not exist`).toBe(true);
    }
  });

  it("cites the file that actually holds each claim, not merely one that exists", () => {
    // Path resolution is the *weaker* half of the citation problem, and the second
    // verification pass found the document still citing `release-exclusions.test.ts` for the
    // export-safety claim after that claim had moved to this file. A guard that only checks
    // a path resolves cannot see that: the wrong file exists, so the check passes. The
    // document's claims are therefore matched against the *content* of the file each names.
    const claims: Array<{ claim: string; phrase: RegExp; heldBy: string; must: RegExp }> = [
      {
        claim: "no server-side value reaches an export",
        phrase: /no server-side value\s+reaches an export/i,
        heldBy: "tests/release-documentation.test.ts",
        must: /SPOTIVIBE_INVIDIOUS_INSTANCES[\s\S]{0,600}not\.toContain/,
      },
      {
        claim: "the envelope's top-level keys are pinned",
        phrase: /top-level keys/i,
        heldBy: "tests/backup-export.test.ts",
        must: /Object\.keys\(envelope\)/,
      },
    ];

    const text = documentText("BACKUP-FORMAT.md");
    const lines = text.split("\n");
    for (const entry of claims) {
      // Located in the joined text, then read as a window of lines. Two earlier versions of
      // this matched line by line and found nothing, because the claim is wrapped across two
      // lines and the test that holds it across three. A check that reads one line at a time
      // reports a missing claim for a document that plainly makes it — which is how a check
      // gets deleted for being "broken" when the document is right.
      const offset = text.search(entry.phrase);
      expect(offset, `the document must state: ${entry.claim}`).toBeGreaterThan(-1);
      const lineOf = text.slice(0, offset).split("\n").length - 1;
      const statement = lines.slice(Math.max(0, lineOf - 3), lineOf + 4).join("\n");
      const named = [...statement.matchAll(/`(tests\/[A-Za-z0-9_./-]+\.ts)`/g)].map((m) => m[1]);
      expect(named.length, `${entry.claim} must name a test`).toBeGreaterThan(0);
      expect(
        named,
        `${entry.claim} must cite ${entry.heldBy}, not another file that happens to exist`,
      ).toContain(entry.heldBy);
      // And the named file must genuinely hold the claim, so a citation cannot be satisfied
      // by pointing at a file that merely exists.
      const source = readFileSync(join(FRONTEND, entry.heldBy), "utf8");
      expect(
        entry.must.test(source),
        `${entry.heldBy} does not hold the claim: ${entry.claim}`,
      ).toBe(true);
    }
  });

  it("holds the claim that no server value reaches an export", () => {
    // The claim the document makes and previously could not cite. It is asserted here
    // rather than asserted nowhere: a provider instance override is deliberately *set*,
    // because a test that passes because the value was absent proves nothing.
    const serverValue = "https://provider-override.invalid";
    const previous = process.env.SPOTIVIBE_INVIDIOUS_INSTANCES;
    process.env.SPOTIVIBE_INVIDIOUS_INSTANCES = serverValue;
    try {
      const envelope = serializeBackup(makeBackupData(), {
        exportedAt: FIXED_EXPORTED_AT,
        appVersion: "0.0.0-test",
      });
      const serialized = JSON.stringify(envelope);
      // The override must actually be visible to the process, or the negative below
      // would be vacuous: the serializer would have nothing to leak.
      expect(getServerEnv().SPOTIVIBE_INVIDIOUS_INSTANCES).toBe(serverValue);
      expect(
        serialized,
        "a server-side provider configuration must not reach a listener's backup",
      ).not.toContain(serverValue);
      // And nothing in the envelope may carry a field outside the schema's own keys.
      expect(Object.keys(envelope).sort()).toEqual(Object.keys(backupEnvelopeSchema.shape).sort());
    } finally {
      if (previous === undefined) delete process.env.SPOTIVIBE_INVIDIOUS_INSTANCES;
      else process.env.SPOTIVIBE_INVIDIOUS_INSTANCES = previous;
    }
  });

  it("states the compatibility rule rather than leaving it implicit", () => {
    const text = documentText("BACKUP-FORMAT.md");
    // An unknown version must be refused, and the document has to say so — a person
    // deciding whether to restore a file is exactly who this is for.
    expect(text).toMatch(/refus|reject|not accept/i);
    expect(documentText("BACKUP-FORMAT.md")).toMatch(/merge/i);
  });
});

describe("the browser matrix does not imply coverage it does not have (M15 task 5.2)", () => {
  it("states the automated and manual split before listing any target", () => {
    const text = documentText("BROWSER-SUPPORT.md");
    const firstTarget = text.search(/\| Target \|/);
    const split = text.search(/automated/i);
    expect(firstTarget).toBeGreaterThan(-1);
    // The split must come before the table, or a reader sees five targets and infers five
    // verified ones.
    expect(split, "the split must be stated before the table").toBeLessThan(firstTarget);
  });

  it("names every target the roadmap's manual browser matrix lists", () => {
    const roadmap = readFileSync(join(FRONTEND, "..", "ROADMAP.md"), "utf8");
    const start = roadmap.indexOf("### Manual Browser Matrix");
    expect(start, "the roadmap must have a manual browser matrix").toBeGreaterThan(-1);
    const section = roadmap.slice(start, start + 800);
    const text = documentText("BROWSER-SUPPORT.md");
    for (const target of ["Chromium", "Edge", "Firefox", "Android", "iOS"]) {
      expect(section, `the roadmap lists ${target}`).toContain(target);
      expect(text, `the matrix must account for ${target}`).toContain(target);
    }
  });

  it("gives every manual entry what to do and what to produce", () => {
    const text = documentText("BROWSER-SUPPORT.md");
    // A manual row with no instructions is an omission, not a result.
    const manual = text.split(/^## /m).filter((section) => /^Manual:/.test(section));
    expect(manual.length, "each manual target needs its own section").toBeGreaterThanOrEqual(3);
    for (const section of manual) {
      expect(section, `${section.split("\n")[0]} must give steps`).toMatch(/1\.\s/);
      expect(section, `${section.split("\n")[0]} must say what to produce`).toMatch(
        /evidence to produce|what to watch/i,
      );
    }
  });
});

describe("the deployment procedure is held by the application it describes (M15 task 4.3)", () => {
  it("states the runtime the manifest actually pins", () => {
    const manifest = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    const major = /(\d+)/.exec(manifest.engines?.node ?? "")?.[1];
    expect(major, "package.json must pin a runtime").toBeDefined();
    expect(documentText("DEPLOYMENT.md")).toContain(`Node ${major}`);
  });

  it("claims no configuration is needed, and the code agrees", () => {
    const text = documentText("DEPLOYMENT.md");
    expect(text).toMatch(/no environment variable/i);
    // The claim is only worth making if the code supports it, and the deployment contract
    // asserts that separately — this asserts the two agree, which is what stops the
    // document from being aspirational.
    const env = readFileSync(join(FRONTEND, "src", "server", "env.ts"), "utf8");
    for (const [, name] of env.matchAll(/(SPOTIVIBE_[A-Z_]+):\s*z\./g)) {
      const line = env.split("\n").find((entry) => entry.includes(`${name}: z.`)) ?? "";
      expect(line, `${name} must be optional for the claim to hold`).toContain(".optional()");
    }
  });

  it("says the first deployment is a manual step, and gives the verification steps", () => {
    const text = documentText("DEPLOYMENT.md");
    expect(text, "the first deployment must be stated as manual").toMatch(/manual/i);
    // A procedure with no verification is a wish. The five numbered steps are what a
    // person does after deploying, and they are what the local suites already check.
    const steps = text.match(/^\d+\.\s/gm) ?? [];
    expect(steps.length, "the document must give verification steps").toBeGreaterThanOrEqual(4);
  });

  /**
   * The parked player is a deliberate departure from YouTube's documented
   * visible-player requirement (`lyrix-style-hidden-player`). A document that described it
   * as a visible compliant surface would be making a claim the code no longer supports, so
   * this holds both halves: the departure is stated, and the false claim is gone.
   */
  it("states that the player is parked and does not claim documented compliance", () => {
    const text = documentText("DEPLOYMENT.md");
    expect(text, "the parked player must be stated, not implied").toMatch(/parked/i);
    expect(text, "the departure from the documented requirement must be named").toMatch(
      /does not meet YouTube'?s documented/i,
    );
    expect(text, "the intended audience must be named").toMatch(/private|personal/i);
    // The claim this change invalidated, gone for good rather than softened.
    expect(text).not.toMatch(/visible,? compliant/i);
    // And the reader is told what to do about it, because a stated departure with no
    // instruction is a warning nobody acts on.
    expect(text, "a public deployment must be told to revert this").toMatch(
      /publicly|public deployment/i,
    );
  });

  it("names the exclusions the parked configuration does not relax", () => {
    // Parking the player is what tempts a "just fetch the stream instead" shortcut, so the
    // document has to say that the permanent exclusions still hold.
    const text = documentText("DEPLOYMENT.md");
    expect(text, "stream download must be ruled out").toMatch(/yt-dlp|stream download/i);
    expect(text, "media proxying must be ruled out").toMatch(/prox(y|ies)/i);
    expect(text, "ad blocking must be ruled out").toMatch(/ads?\b/i);
  });

  it("scopes the exclusions to playback and names the one exception, so deleting them fails", () => {
    // M20 falsified this document's flat claim, and the fix is not to delete the claim — that
    // would let the original exclusions go quietly — but to scope it and to state the exception.
    // A document that dropped "for playback" everywhere and said nothing about downloading would
    // pass the test above; this one rejects it.
    const text = documentText("DEPLOYMENT.md");
    expect(text, "the exclusions must be scoped to playback rather than restated flat").toMatch(
      /for\s+\*\*playback\*\*|not playback/i,
    );
    expect(text, "the one exception must be named").toMatch(/\/api\/download/);
    expect(text, "the exception must be scoped away from playback").toMatch(/not playback/i);
    // …and it must be a download *to the device*, with the honest-format rule attached, because
    // "it downloads" on its own would read as a resumption of the thing §2.5 prohibited.
    expect(text).toMatch(/to the listener's own device/i);
    expect(text, "the honest-format rule must travel with the exception").toMatch(
      /never transcoded|never named `?\.mp3/i,
    );
  });

  it("cites only files that exist", () => {
    const text = documentText("DEPLOYMENT.md");
    // Repository-relative paths only: the document also writes served URLs such as
    // "/sw.js", and those are routes rather than files. A check that resolved every
    // backticked source file against frontend/ would report a served URL as a missing
    // file, which is how a check gets switched off.
    const pattern = /`([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:ts|js|json|mjs))`/g;
    const cited = [...text.matchAll(pattern)]
      .map((match) => match[1])
      .filter((path) => !path.startsWith("/") && !path.includes("://"));
    expect(cited.length, "the document must cite the files it depends on").toBeGreaterThanOrEqual(
      3,
    );
    for (const path of cited) {
      // Relative to `frontend/` first, then to the repository root, because the document
      // cites both application files and repository-level ones.
      const paths = [join(FRONTEND, path), join(FRONTEND, "..", path)];
      expect(
        paths.some((candidate) => existsSync(candidate)),
        `${path} is cited but does not exist`,
      ).toBe(true);
    }
  });
});
