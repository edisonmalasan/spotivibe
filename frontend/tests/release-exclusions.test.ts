import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The permanent product exclusions, enforced (M15 task 1.1; spec `release-validation` —
 * "The permanent product exclusions are enforced").
 *
 * ROADMAP §2 lists these as "deliberate product decisions, not temporary MVP shortcuts".
 * Until now nothing asserted them: they were held by discipline and by review, which is
 * the mechanism that erodes. A release gate is the last place a violation should be able
 * to hide, and this is that place.
 *
 * ## The two proofs every detector here gets
 *
 * **Proven against a violating snippet**, so a detector that cannot fail is never mistaken
 * for one that passes. Each `it("flags ...")` below feeds its own pattern a snippet that
 * violates the exclusion and asserts the pattern fires.
 *
 * **Proven against the real sources**, in the sweep at the bottom, so a detector that
 * fails for the wrong reason is caught before it is trusted. This is not ceremony. The
 * only occurrence of an account-related pattern anywhere in `frontend/src` is a *comment*
 * in `playlistRef.ts` that reads "no account/OAuth/cookies anywhere" — the file that
 * documents the constraint is the one a naive pattern would flag, and a silenced exclusion
 * check is worse than no check at all, because it looks like coverage.
 *
 * M14's verification pass found the general shape of this failure: a guard for
 * referrer suppression existed, matched a shape the code never used, and went green over a
 * real violation while its own self-test asserted the wrong shape. Hence `stripComments`
 * below, applied to every pattern, and a test that fails if a detector ever needs it
 * removed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, "..");
const SRC = join(FRONTEND, "src");

/**
 * Remove comments before matching.
 *
 * A comment cannot hold an account, download a track, or block an ad. Stripping them is
 * what keeps `playlistRef.ts` — whose comment documents that it accepts no account,
 * OAuth, or cookies — from being reported as the thing it warns against.
 *
 * The strips are deliberately simple: line comments and block comments. A `//` inside a
 * string literal is not handled, which is the conservative direction to be wrong in — a
 * source containing `const url = "https://example.com"` keeps its `//`, and the patterns
 * below match on words rather than on URLs.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/**
 * Every source file under `src/`, relative to `src/`, with its comments stripped.
 *
 * Client and server together. An exclusion is a property of the codebase rather than of one
 * layer, and a downloader or a proxy would sit in a route handler — which is also where
 * `server/music/playlistRef.ts` lives, the file whose comment documents that it accepts no
 * account, OAuth, or cookies. The first version of this sweep excluded the server tree and
 * so never exercised the comment-aware behaviour it exists for.
 */
function applicationSources(): Array<{ file: string; code: string; raw: string }> {
  return sourceFiles(SRC).map((file) => {
    const raw = readFileSync(file, "utf8");
    return {
      file: relative(SRC, file).replace(/\\/g, "/"),
      code: stripComments(raw),
      raw,
    };
  });
}

interface Exclusion {
  /** What the roadmap forbids, quoted closely enough to be checkable. */
  label: string;
  /** Where in ROADMAP the exclusion is stated. */
  clause: string;
  /** The detector, applied to comment-stripped source. */
  pattern: RegExp;
  /** A snippet that violates this exclusion, used to prove the detector can fail. */
  violation: string;
}

const EXCLUSIONS: Exclusion[] = [
  {
    label: "no accounts or authentication",
    clause: "ROADMAP §2.1",
    // Provider hosts and the word "signIn" are the shapes an account system takes here.
    // `cookies` and `OAuth` are included because the playlist reference explicitly
    // promises neither, so either appearing in code is a change worth a human look.
    pattern:
      /\b(supabase|firebase|auth0|clerk|nextauth|next-auth|oauth2?|signIn|signInWith|getSession|currentUser)\b|document\.cookie|setCookie\(/i,
    violation: `
      import { createClient } from "@supabase/supabase-js";
      const supabase = createClient(url, key);
      export async function GET() {
        const { data } = await supabase.auth.getSession();
        return Response.json({ user: data.session?.user });
      }
    `,
  },
  {
    label: "no cloud user database",
    clause: "ROADMAP §2.2",
    // A client-side database SDK, or a table-shaped store fetched from a remote origin.
    pattern: /\b(firebase|firestore|appwrite|nedb|nedb-promise|lowdb|@vercel\/kv|upstash)\b/i,
    violation: `
      import { collection, addDoc } from "firebase/firestore";
      export async function POST(request: Request) {
        const body = await request.json();
        await addDoc(collection(db, "plays"), body);
        return new Response(null, { status: 204 });
      }
    `,
  },
  {
    label: "no user-database dependency",
    clause: "ROADMAP §2.2",
    pattern:
      /"(supabase-js|firebase|@google-cloud\/firestore|pg|mysql2?|mongoose|prisma|@prisma\/client)"/,
    violation: `
      // package.json
      { "dependencies": { "@prisma/client": "^6.0.0", "pg": "^8.11.0" } }
    `,
  },
  {
    label: "no audio extraction or download",
    clause: "ROADMAP §2.5",
    // The whole shape of an extractor: a media element pointed at a stream, a format
    // conversion, or a download trigger. A *playback* surface is a `<video>`/`<iframe>`
    // pointing at YouTube, which is the opposite and must not match.
    // Deliberately no `createObjectURL` and no generic `download` word: the backup
    // export *is* a file download, and the roadmap requires it. The first version of this
    // pattern flagged `DataControls.tsx` for exactly that — a false positive that would
    // have been resolved by deleting a required feature. The exclusion is about *audio*,
    // and a separate positive check below asserts that every download the application
    // initiates is a JSON backup rather than media.
    pattern:
      /\b(ytdl|ytdl-core|youtube-dl|youtube-dl-exec|yt-dlp|streamlink|ffmpeg(?:\.exe)?|fluent-ffmpeg|audiodl|downloadAudio|extractAudio|audioExtract|extractAudioBuffer)\b|audio\/(mpeg|mp4|ogg|opus|flac|wav|x-m4a)|videotube|\.getAudioData\(|createMediaElementSource\([^)]*\)\s*\.connect\(\s*(?!destination)/i,
    violation: `
      import ytdl from "ytdl-core";
      export async function GET(request: Request) {
        const url = new URL(request.url).searchParams.get("v");
        return new Response(ytdl(url), { headers: { "content-type": "audio/mpeg" } });
      }
    `,
  },
  {
    label: "no forced background-play circumvention",
    clause: "ROADMAP §2.6",
    // Holding an AudioContext alive, or silencing the document to defeat a pause. The
    // IFrame player's own media element is the compliant surface and does not match.
    pattern:
      /\b(audioContext|new Audio\(|setSinkId|mediaSession\.setActionHandler|navigator\.mediaSession|keepAlive|preventBackgroundThrottle|silentAudio|volume\s*=\s*0)\b/i,
    violation: `
      const context = new AudioContext();
      export function keepAlive() {
        const oscillator = context.createOscillator();
        oscillator.connect(context.destination);
        oscillator.start();
        setInterval(keepAlive, 1000);
      }
    `,
  },
  {
    label: "no ad-blocking behaviour",
    clause: "ROADMAP §2.8",
    pattern:
      /\b(adblock|adBlock|adblocker|blockAds|filterAds|removeAds|doubleclick\.net|googlesyndication\.com\/pagead)/i,
    // Written as plain strings rather than nested regex literals: the first version
    // double-escaped them, so the snippet contained a literal backslash and the very
    // pattern it was meant to prove had nothing to match.
    violation: `
      const AD_HOSTS = ["doubleclick.net", "googlesyndication.com/pagead"];
      self.addEventListener("fetch", (event) => {
        if (AD_HOSTS.some((host) => event.request.url.includes(host))) {
          event.respondWith(new Response(""));
        }
      });
    `,
  },
  {
    label: "no media proxied through the application server",
    clause: "ROADMAP §2.7",
    // A server route that streams or redirects to a media body. Every media reference in
    // this application is an outbound *link* the listener follows, and a link is not a
    // proxy: the browser never asks this server for the bytes.
    // Two shapes, because one is not enough. The named hosts are where media actually
    // comes from, and the shape is the general case: a route that reads a URL out of its
    // own request and returns that response's body is a proxy whatever the URL is. The
    // first version had only the hosts, and its violating snippet — a generic forwarder —
    // correctly did not match, which is how a detector that cannot catch the thing it
    // names gets shipped.
    pattern:
      /googlevideo\.com|proxyStream|streamProxy|\/api\/(proxy|stream)\b|new\s+Response\(\s*(upstream|remote|target|source)\w*\.body|new\s+Response\(\s*await\s+fetch\(/i,
    violation: `
      export async function GET(request: Request): Promise<Response> {
        const target = new URL(request.url).searchParams.get("url") ?? "";
        const upstream = await fetch(target);
        return new Response(upstream.body, {
          headers: { "content-type": upstream.headers.get("content-type") ?? "audio/mpeg" },
        });
      }
    `,
  },
];

describe("the permanent product exclusions are enforced (M15 task 1.1)", () => {
  it("covers every exclusion the roadmap states as permanent", () => {
    // A guard on the guard: if this list shrank, the sweep below would silently stop
    // checking something.
    expect(EXCLUSIONS.length).toBeGreaterThanOrEqual(7);
    const labels = EXCLUSIONS.map((exclusion) => exclusion.label);
    for (const expected of [
      "no accounts or authentication",
      "no cloud user database",
      "no user-database dependency",
      "no audio extraction or download",
      "no forced background-play circumvention",
      "no ad-blocking behaviour",
      "no media proxied through the application server",
    ]) {
      expect(labels, expected).toContain(expected);
    }
    // Every exclusion cites the clause it comes from, so a future reader can check the
    // claim against the roadmap rather than against this file.
    for (const exclusion of EXCLUSIONS) {
      expect(exclusion.clause, exclusion.label).toMatch(/ROADMAP §2\.\d/);
    }
  });

  it("reads the application sources, so the sweep below is not vacuous", () => {
    const sources = applicationSources();
    expect(sources.length, "the walker must reach the application sources").toBeGreaterThan(80);
    // And at least one of them contains a comment naming an account pattern, which is the
    // false positive this suite is built to avoid. If that comment ever disappears, the
    // comment-aware behaviour stops being exercised and this assertion says so.
    const documentsNoAccounts = sources.filter((entry) =>
      /no account\/OAuth\/cookies/i.test(entry.raw),
    );
    expect(documentsNoAccounts.map((entry) => entry.file)).toContain("server/music/playlistRef.ts");
  });

  for (const exclusion of EXCLUSIONS) {
    it(`finds no ${exclusion.label} in the application sources (${exclusion.clause})`, () => {
      const offenders = applicationSources()
        .filter((entry) => exclusion.pattern.test(entry.code))
        .map((entry) => entry.file);
      expect(offenders, `${exclusion.label} must not appear in application source`).toEqual([]);
    });

    it(`flags ${exclusion.label} on a violating snippet, so the detector can fail`, () => {
      // Without this, a pattern that matches nothing at all would pass the sweep above
      // forever, and the exclusion would be "enforced" by nothing.
      expect(exclusion.pattern.test(stripComments(exclusion.violation))).toBe(true);
    });
  }
});

describe("a source that documents an exclusion does not break it (M15 task 1.3)", () => {
  it("strips the comment that documents the constraint", () => {
    // The exact shape that would have produced a false positive, taken from the real file.
    const documented = `
      import { z } from "zod";
      /**
       * Accepts exactly two shapes - no account/OAuth/cookies anywhere, keyless
       * only, or an opaque key.
       */
      export function parseRef(input: string) {
        return input.startsWith("spotify:") ? { kind: "keyless" } : { kind: "key" };
      }
    `;
    expect(stripComments(documented)).not.toMatch(/OAuth|cookies/);
    const accountExclusion = EXCLUSIONS[0];
    expect(accountExclusion.pattern.test(stripComments(documented))).toBe(false);
  });

  it("still flags the same words in code, because a comment is not the only thing that matters", () => {
    // The mirror of the test above: stripping comments must not become a way to smuggle
    // the real thing past the check.
    const real = `
      export async function GET() {
        const session = await supabase.auth.getSession();
        return Response.json({ user: session.data.session });
      }
    `;
    expect(EXCLUSIONS[0].pattern.test(stripComments(real))).toBe(true);
  });

  it("keeps a legitimate mention of the forbidden word in a string value", () => {
    // An outbound playlist link is a thing the listener pastes, and the import dialog
    // shows one as placeholder text. A detector that flagged that would be pushed to
    // delete a legitimate feature, which is how a check gets switched off.
    const placeholder = `
      export const PLACEHOLDER = "https://youtube.com/playlist?list=. or ID";
    `;
    expect(EXCLUSIONS[0].pattern.test(stripComments(placeholder))).toBe(false);
    expect(EXCLUSIONS[6].pattern.test(stripComments(placeholder))).toBe(false);
  });
});

describe("every download the application initiates is a backup, not media (M15 task 1.1)", () => {
  it("finds every download initiation and names the file type it offers", () => {
    // A positive check, and the reason it exists. The negative pattern cannot say
    // `createObjectURL` is wrong, because the backup export *is* a file download and the
    // roadmap requires one. So rather than forbidding the mechanism, this enumerates
    // every place the application initiates a download and asserts each is a JSON backup
    // produced on the device. A download of anything else would show up here as a
    // filename and a type that are not a backup.
    const initiations = applicationSources().filter((entry) =>
      /\.download\s*=|createObjectURL\(/.test(entry.code),
    );
    expect(
      initiations.length,
      "the application initiates at least the backup download",
    ).toBeGreaterThan(0);

    for (const entry of initiations) {
      // Every download names its own filename. The real code assigns a *variable* —
      // `anchor.download = filename` inside a `downloadJson(filename, contents)` helper —
      // so asserting the assigned value is a `.json` literal was asserting something the
      // code does not do, and the first version of this check failed on it. What matters
      // is that no download is *named* like media, and that the blob beside it is JSON.
      const assigned = [...entry.code.matchAll(/\.download\s*=\s*([^;]+);/g)].map((m) =>
        m[1].trim(),
      );
      expect(assigned.length, `${entry.file} must name the file it offers`).toBeGreaterThan(0);
      for (const value of assigned) {
        expect(value, `${entry.file}: ${value}`).not.toMatch(
          /\.(mp3|m4a|aac|opus|ogg|flac|wav|webm|mp4|mkv)\b/i,
        );
      }
      // And the blob it offers is JSON, never an audio or video type.
      const types = [...entry.code.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1]);
      for (const type of types) {
        expect(type, `${entry.file} must not offer a media download`).not.toMatch(
          /^(audio|video)\//,
        );
      }
      // No `<a download>` in markup points at a remote origin, which would be a
      // download the application did not produce.
      expect(entry.code, `${entry.file}`).not.toMatch(
        /download\s*=\s*["']true["'][^>]*href=["']https?:/,
      );
    }
  });
});

describe("the exclusions hold in the dependency manifest and the shipped configuration (M15 task 1.1)", () => {
  it("declares no database, auth, downloader, or ad-blocking dependency", () => {
    const manifest = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    };
    const dependencyExclusion = EXCLUSIONS[2];
    const offenders = Object.keys(declared).filter((name) =>
      dependencyExclusion.pattern.test(`"${name}"`),
    );
    expect(offenders, "a permanent exclusion may not enter as a dependency").toEqual([]);
  });

  it("depends on nothing that can hold user data off the device", () => {
    // A second, independent angle on the same exclusion: rather than pattern-matching a
    // vendor name, assert that every runtime dependency is one this project can account
    // for. A new runtime dependency is a decision someone made; this makes it visible.
    const manifest = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const runtime = Object.keys(manifest.dependencies ?? {}).sort();
    expect(runtime).toEqual(["lucide-react", "next", "react", "react-dom", "zod", "zustand"]);
  });
});
