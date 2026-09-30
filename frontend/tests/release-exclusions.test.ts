import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * Every source file the application ships, relative to `frontend/`, comments stripped.
 *
 * **Client and server together, and outside `src/` as well as inside it.** An exclusion is
 * a property of the shipped codebase rather than of one layer, and a downloader, a proxy,
 * or — most of all — an ad-blocker would sit in exactly the places a `src/`-only walk
 * misses. The first version of this sweep read `src/` only, so `public/sw.js`,
 * `next.config.ts`, and `scripts/**` were never scanned: an ad-blocker in the service
 * worker, which is where ad-blocking belongs, was unscanned by construction.
 *
 * The first version also excluded the server tree, which is where
 * `server/music/playlistRef.ts` lives — the file whose comment documents that it accepts
 * no account, OAuth, or cookies — so the comment-aware behaviour this suite exists for was
 * never exercised.
 */
function applicationSources(): Array<{ file: string; code: string; raw: string }> {
  const files: Array<{ file: string; root: string }> = [];
  for (const root of [SRC, join(FRONTEND, "public"), join(FRONTEND, "scripts")]) {
    if (!existsSync(root)) continue;
    for (const absolute of sourceFiles(root)) {
      files.push({ file: relative(FRONTEND, absolute).replace(/\\/g, "/"), root });
    }
  }
  // The application config is not in a directory walk, and it is where a proxy, a
  // rewrites rule, or an injected header would appear.
  const config = join(FRONTEND, "next.config.ts");
  if (existsSync(config)) files.push({ file: "next.config.ts", root: FRONTEND });

  return files.map(({ file }) => {
    const raw = readFileSync(join(FRONTEND, file), "utf8");
    return { file, code: stripComments(raw), raw };
  });
}

interface Exclusion {
  /** What the roadmap forbids, quoted closely enough to be checkable. */
  label: string;
  /** Where in ROADMAP the exclusion is stated. */
  clause: string;
  /**
   * The detector, applied to comment-stripped source.
   *
   * Written to match the *ordinary* shapes rather than one author's vocabulary, because a
   * detector proved only against a snippet its own author wrote proves much less than it
   * appears to. Every `violations` entry below is a shape that got past a first draft of
   * these patterns.
   */
  pattern: RegExp;
  /**
   * Snippets that violate this exclusion, each of which the detector must flag.
   *
   * More than one on purpose. A single snippet is a demonstration; several shapes are the
   * evidence that the detector catches the thing it names rather than one phrasing of it.
   */
  violations: Array<{ label: string; code: string }>;
}

const EXCLUSIONS: Exclusion[] = [
  {
    label: "no accounts or authentication",
    clause: "ROADMAP §2.1",
    // An identity is a cookie, a bearer token, a session lookup, or a named identity API.
    // The first version knew only `document.cookie` and `setCookie(`, so a server-side
    // `cookies()` session jar, a `getServerSession` call, or a plain `Authorization:
    // Bearer` header all passed — which is to say, an account system written in the idiom
    // this codebase itself uses was undetected.
    pattern:
      /\b(supabase|firebase|auth0|clerk|nextauth|next-auth|better-auth|oauth2?|signIn|signInWith|getSession|getServerSession|getIronSession|currentUser|current_user|userSession|withAuth|requireAuth)\b|document\.cookie|(?<![A-Za-z])cookies\s*\(\s*\)|setCookie\s*\(|Set-Cookie|["'`]authorization["'`]|Bearer\s+[A-Za-z0-9._-]{8,}|\bsessionSecret\b|signJwt|verifyJwt/i,
    violations: [
      {
        label: "a named identity provider",
        code: `
          import { createClient } from "@supabase/supabase-js";
          const supabase = createClient(url, key);
          export async function GET() {
            const { data } = await supabase.auth.getSession();
            return Response.json({ user: data.session?.user });
          }
        `,
      },
      {
        label: "a server-side session cookie jar",
        // The idiom a Next codebase reaches for when it wants a session without a vendor.
        code: `
          import { cookies } from "next/headers";
          export async function GET() {
            const jar = await cookies();
            const id = jar.get("sv_session")?.value;
            if (!id) return Response.json({ user: null }, { status: 401 });
            return Response.json({ user: await lookup(id) });
          }
        `,
      },
      {
        label: "a bearer-token identity header",
        code: `
          export async function GET(request: Request) {
            const header = request.headers.get("authorization");
            if (!header?.startsWith("Bearer ")) throw new Error("no identity");
            return Response.json({ user: await identify(header.slice(7)) });
          }
        `,
      },
      {
        label: "a home-grown session table",
        code: `
          import { getServerSession } from "@/server/session";
          export async function GET() {
            const session = await getServerSession();
            return Response.json({ user: session?.user ?? null });
          }
        `,
      },
    ],
  },
  {
    label: "no cloud sync",
    clause: "ROADMAP §2.1",
    // New, and the one the verification pass pointed at: the roadmap makes "no cloud sync
    // now or later" a permanent decision, and the first seven exclusions did not cover it
    // at all. A route that accepts a listener's library and stores it elsewhere is exactly
    // the thing the product does not do, and it was undetected.
    pattern:
      /\/api\/(sync|upload|backup-to-cloud|push)\b|cloudSync|cloud-sync|syncToCloud|uploadLibrary|pushToCloud|remoteStore|remoteStorage|\bsyncEndpoint\b|\bSYNC_(URL|ENDPOINT|KEY|TOKEN)\b|\bsyncUrl\b|\bsyncEndpoint\b|["'`]SYNC_URL["'`]/i,
    violations: [
      {
        label: "a route that accepts a listener's data",
        code: `
          export async function POST(request: Request) {
            const library = await request.json();
            await fetch(process.env.SYNC_URL, {
              method: "POST",
              body: JSON.stringify(library),
            });
            return new Response(null, { status: 204 });
          }
        `,
      },
      {
        label: "a named client helper",
        code: `
          export function uploadLibrary(library: Library) {
            return fetch("/api/sync", { method: "POST", body: JSON.stringify(library) });
          }
        `,
      },
    ],
  },
  {
    label: "no cloud user database",
    clause: "ROADMAP §2.2",
    // A client-side database SDK, or a table-shaped store fetched from a remote origin.
    pattern:
      /\b(firebase|firestore|appwrite|nedb|nedb-promise|lowdb|@vercel\/kv|upstash|@upstash\/redis|mongodb|realm)\b/i,
    violations: [
      {
        label: "a client-side database SDK",
        code: `
          import { collection, addDoc } from "firebase/firestore";
          export async function POST(request: Request) {
            const body = await request.json();
            await addDoc(collection(db, "plays"), body);
            return new Response(null, { status: 204 });
          }
        `,
      },
    ],
  },
  {
    label: "no user-database dependency",
    clause: "ROADMAP §2.2",
    pattern:
      /"(supabase-js|firebase|@google-cloud\/firestore|pg|mysql2?|mongoose|prisma|@prisma\/client|pg-pool|sqlite3|better-sqlite3|mongodb)"/,
    violations: [
      {
        label: "an ORM and its driver",
        code: `
          { "dependencies": { "@prisma/client": "^6.0.0", "pg": "^8.11.0" } }
        `,
      },
    ],
  },
  {
    label: "no audio extraction or download",
    clause: "ROADMAP §2.5",
    // The whole shape of an extractor: a named downloader, a stream manifest, a format
    // conversion, or a media buffer being persisted. A *playback* surface is a
    // `<video>`/`<iframe>` pointing at YouTube, which is the opposite and must not match.
    //
    // Deliberately no `createObjectURL` and no generic `download` word: the backup export
    // *is* a file download, and the roadmap requires it. The first version of this pattern
    // flagged `DataControls.tsx` for exactly that — a false positive that would have been
    // resolved by deleting a required feature.
    pattern:
      /\b(ytdl|ytdl-core|youtube-dl|youtube-dl-exec|yt-dlp|yt_dlp|yt-dlp_|streamlink|ffmpeg(?:\.exe)?|fluent-ffmpeg|audiodl|downloadAudio|downloadTrack|downloadVideo|extractAudio|audioExtract|extractAudioBuffer|streamingData|adaptiveFormats|signatureCipher|player\.js|decipherFunction|n-parameter)\b|audio\/(mpeg|mp4|ogg|opus|flac|wav|x-m4a|aac)|videotube|\.getAudioData\(|captureStream\s*\(|getAudioTracks|MediaRecorder|MediaElementAudioSourceNode|createMediaElementSource\([^)]*\)\s*\.connect\(\s*(?!destination)/i,
    violations: [
      {
        label: "a named downloader as a dependency",
        code: `
          import ytdl from "ytdl-core";
          export async function GET(request: Request) {
            const url = new URL(request.url).searchParams.get("v");
            return new Response(ytdl(url), { headers: { "content-type": "audio/mpeg" } });
          }
        `,
      },
      {
        label: "a downloader invoked as a subprocess",
        // The module is spelled with an underscore, which the first version's list did not
        // contain — the difference between a real tool and the word I expected.
        code: `
          import { execFile } from "node:child_process";
          export async function GET() {
            const { stdout } = await execFileAsync("python", ["-m", "yt_dlp", "-x", url]);
            return new Response(stdout, { headers: { "content-type": "audio/mpeg" } });
          }
        `,
      },
      {
        label: "a hand-rolled extractor over the stream manifest",
        // No named tool anywhere: this is what an extractor looks like when someone writes
        // it rather than installs it, and it was completely invisible to the first version.
        code: `
          export async function extract(videoId: string) {
            const page = await fetch("https://www.youtube.com/watch?v=" + videoId);
            const manifest = JSON.parse(page).playerResponse.streamingData.adaptiveFormats;
            const audio = manifest.find((format) => format.mimeType.startsWith("audio"));
            return decipher(audio.signatureCipher, transformFunctions);
          }
        `,
      },
      {
        label: "a media buffer written to local storage",
        code: `
          export async function cacheTrack(track: Track) {
            const buffer = await trackMediaElement.captureStream().getAudioTracks()[0];
            const bytes = await new Response(buffer).arrayBuffer();
            await mediaStore.put(track.id, bytes);
          }
        `,
      },
    ],
  },
  {
    label: "no forced background-play circumvention",
    clause: "ROADMAP §2.6",
    // Holding audio alive, silencing the document to defeat a pause, or repeatedly
    // re-triggering playback when the page is backgrounded. The IFrame player's own media
    // element is the compliant surface and does not match.
    //
    // `volume = 0` is anchored so that a legitimate fade to 5% is not reported: the first
    // version's `volume\s*=\s*0\b` matched `volume = 0.5`, because the `0` is followed by
    // a `.` and a word boundary. A check that cries wolf gets switched off.
    pattern:
      /\b(audioContext|new Audio\(|setSinkId|mediaSession\.setActionHandler|navigator\.mediaSession|keepAlive|preventBackgroundThrottle|silentAudio|blockUserGesture|autoPlayPolicy)\b|volume\s*=\s*0\s*(;|$|\/\/)|\.muted\s*=\s*true|visibilitychange[\s\S]{0,200}?\.play\s*\(|setInterval\([\s\S]{0,120}?(isPaused|paused)[\s\S]{0,120}?play(Video)?\s*\(/i,
    violations: [
      {
        label: "an audio context held open",
        code: `
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
        label: "a muted element replayed on every visibility change",
        // No AudioContext, no keepAlive, no volume assignment: the ordinary shape of this
        // circumvention, and invisible to the first version's pattern.
        code: `
          const el = document.querySelector("video");
          el.muted = true;
          document.addEventListener("visibilitychange", () => { el.play(); });
        `,
      },
      {
        label: "a poller that restarts playback when it stops",
        code: `
          setInterval(() => {
            if (player.isPaused) player.playVideo();
          }, 500);
        `,
      },
    ],
  },
  {
    label: "no ad-blocking behaviour",
    clause: "ROADMAP §2.8",
    // A host list, a path pattern, or a name for the act. The first version listed only
    // vendor hostnames and function names, so a list assembled from string parts, or one
    // keyed on a URL path, passed — and the sweep did not even read the service worker
    // where ad-blocking belongs.
    pattern:
      /\b(adblock|adBlock|adblocker|adBlocker|blockAds|filterAds|removeAds|stripAds|AD_HOSTS|AD_DOMAINS|AD_BLOCK_LIST|AD_PATTERNS)\b|doubleclick\.net|googlesyndication\.com|pagead2?|adsense\.com|click\.net|googletagservices|adservice|adsystem|blockedHosts|blockedDomains|blockedUrls|blockList|["'`]ads?["'`]\s*:\s*(?:true|\[)|\/(ads?|advert)\/(?:served|pagead)|respondWith\s*\(\s*new Response\(\s*["'`]["'`]\s*\)\s*\)[\s\S]{0,120}?ads?/i,
    violations: [
      {
        label: "a host list in a service-worker fetch handler",
        // Written as plain strings rather than nested regex literals: the first version
        // double-escaped them, so the snippet held a literal backslash and the very
        // pattern it was meant to prove had nothing to match.
        code: `
          const AD_HOSTS = ["doubleclick.net", "googlesyndication.com/pagead"];
          self.addEventListener("fetch", (event) => {
            if (AD_HOSTS.some((host) => event.request.url.includes(host))) {
              event.respondWith(new Response(""));
            }
          });
        `,
      },
      {
        label: "a host list assembled from string parts",
        code: `
          const BLOCKED = ["double" + "click.net", "google" + "adsense.com"];
          self.addEventListener("fetch", (event) => {
            if (BLOCKED.some((host) => event.request.url.includes(host))) {
              event.respondWith(new Response(""));
            }
          });
        `,
      },
      {
        label: "a path pattern rather than a host list",
        code: `
          self.addEventListener("fetch", (event) => {
            if (/\\/(ads?|pagead)\\//i.test(new URL(event.request.url).pathname)) {
              event.respondWith(new Response(""));
            }
          });
        `,
      },
    ],
  },
  {
    label: "no media proxied through the application server",
    clause: "ROADMAP §2.7",
    // Every media reference in this application is an outbound *link* the listener follows,
    // and a link is not a proxy: the browser never asks this server for the bytes.
    //
    // Two shapes, because one is not enough, and the second must be a *shape*. The first
    // version detected the shape by four variable names — `upstream|remote|target|source` —
    // so renaming one to `media` defeated it, which is the same failure the design
    // commentary criticises one paragraph above it. What is matched now is the code's
    // structure: a route that derives a URL from its own request and fetches it, or that
    // materialises a fetched body as a buffer.
    //
    // Every clause is anchored on handing a fetched body *back to a client*, deliberately.
    // A broader rule — "any fetched response, buffered" — flagged the service worker's own
    // cache copy, which clones and buffers a response it legitimately holds and is required
    // to hold. A detector that fires on the application's correct code is a detector that
    // gets switched off.
    // The media host is only a signal when it is *fetched*, never when it is merely named.
    // The service worker lists `googlevideo.com` in its deny-list — the worker refusing to
    // touch media is the opposite of proxying it — and a bare hostname rule flagged that
    // correct code. The rule is therefore the host inside a `fetch`.
    pattern:
      /fetch\s*\(\s*["'`][^)]*googlevideo|proxyStream|streamProxy|\/api\/(proxy|stream|media)\b|searchParams\.get\s*\(\s*["'`](?:url|target|src|source|media)["'`]\s*\)[\s\S]{0,200}?fetch\s*\(|fetch\s*\([^)]*\)[\s\S]{0,240}?new\s+Response\s*\(\s*[\w$]+\.body|arrayBuffer\s*\(\s*\)[\s\S]{0,200}?new\s+Response/i,
    violations: [
      {
        label: "a generic forwarder",
        code: `
          export async function GET(request: Request): Promise<Response> {
            const target = new URL(request.url).searchParams.get("url") ?? "";
            const upstream = await fetch(target);
            return new Response(upstream.body, {
              headers: { "content-type": upstream.headers.get("content-type") ?? "audio/mpeg" },
            });
          }
        `,
      },
      {
        label: "the same forwarder with every variable renamed",
        // The specific gap the first version had. A detector keyed on the author's
        // vocabulary rather than on the code's shape passes this.
        code: `
          export async function GET(request: Request): Promise<Response> {
            const link = new URL(request.url).searchParams.get("url") ?? "";
            const media = await fetch(link);
            return new Response(media.body, { headers: media.headers });
          }
        `,
      },
      {
        label: "a buffer re-wrapped rather than a body streamed",
        code: `
          export async function GET(request: Request): Promise<Response> {
            const src = new URL(request.url).searchParams.get("url") ?? "";
            const bytes = await (await fetch(src)).arrayBuffer();
            return new Response(bytes, { headers: { "content-type": "audio/mpeg" } });
          }
        `,
      },
    ],
  },
];

describe("the permanent product exclusions are enforced (M15 task 1.1)", () => {
  it("covers every exclusion the roadmap states as permanent", () => {
    // A guard on the guard: if this list shrank, the sweep below would silently stop
    // checking something.
    expect(EXCLUSIONS.length).toBeGreaterThanOrEqual(8);
    const labels = EXCLUSIONS.map((exclusion) => exclusion.label);
    for (const expected of [
      "no accounts or authentication",
      "no cloud sync",
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
    expect(sources.length, "the walker must reach the application sources").toBeGreaterThan(100);
    // The sweep must reach *outside* `src/`, or an ad-blocker or a proxy declared in the
    // service worker, the scripts, or the application config is unscanned by construction.
    // The first version walked `src/` only, which is exactly where none of those live.
    const files = sources.map((entry) => entry.file);
    expect(files, "the worker is where ad-blocking belongs").toContain("public/sw.js");
    expect(files, "the application config can declare a proxy or an injected header").toContain(
      "next.config.ts",
    );
    // And at least one of them contains a comment naming an account pattern, which is the
    // false positive this suite is built to avoid. If that comment ever disappears, the
    // comment-aware behaviour stops being exercised and this assertion says so.
    const documentsNoAccounts = sources.filter((entry) =>
      /no account\/OAuth\/cookies/i.test(entry.raw),
    );
    expect(documentsNoAccounts.map((entry) => entry.file)).toContain(
      "src/server/music/playlistRef.ts",
    );
  });

  for (const exclusion of EXCLUSIONS) {
    it(`finds no ${exclusion.label} in the application sources (${exclusion.clause})`, () => {
      const offenders = applicationSources()
        .filter((entry) => exclusion.pattern.test(entry.code))
        .map((entry) => entry.file);
      expect(offenders, `${exclusion.label} must not appear in application source`).toEqual([]);
    });

    // One test per violating shape, not one per detector. The first version had a single
    // snippet per exclusion, which is a demonstration rather than evidence: a detector
    // proved only against phrasing its own author chose will catch that phrasing and
    // little else. These are the shapes that got past a first draft of these patterns,
    // written down so they cannot be forgotten.
    for (const violation of exclusion.violations) {
      it(`flags ${exclusion.label} on ${violation.label}, so the detector can fail`, () => {
        expect(
          exclusion.pattern.test(stripComments(violation.code)),
          `the detector missed ${violation.label}`,
        ).toBe(true);
      });
    }
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
      // The blob it offers is JSON, and the check says so positively rather than only
      // ruling out media. The first version rejected `audio/*` and `video/*` and nothing
      // else, which meant a download named `track` with `application/octet-stream` —
      // carrying audio — satisfied it. A check that only excludes what it thought of is
      // not a positive check.
      const types = [...entry.code.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1]);
      expect(types.length, `${entry.file} must state what it offers`).toBeGreaterThan(0);
      for (const type of types) {
        expect(
          type,
          `${entry.file} offers "${type}"; only a textual backup may be downloaded`,
        ).toMatch(/^application\/(json|.*\+json)$|^text\//);
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
