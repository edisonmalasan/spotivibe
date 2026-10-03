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
   * More than one on purpose, and the set is adversarial by construction: the second
   * verification pass wrote twenty-five fresh realistic snippets against these patterns and
   * seventeen of them passed undetected. Every one of those is now a fixture here. The
   * evidence is therefore about the *class* of shape rather than one author's phrasing, and
   * it is the only reason to believe these patterns catch what they name.
   */
  violations: Array<{ label: string; code: string }>;
}

const EXCLUSIONS: Exclusion[] = [
  {
    label: "no accounts or authentication",
    clause: "ROADMAP §2.1",
    // An identity is a cookie, a bearer token, a session lookup, an identity header, or an
    // OIDC token. The first version knew only `document.cookie` and `setCookie(`, so a
    // server-side `cookies()` session jar, a `getServerSession` call, or a plain
    // `Authorization: Bearer` header all passed — an account system written in the idiom
    // this codebase itself uses.
    //
    // The second pass found three more that passed: a custom session header read by an
    // unremarkable name, an OIDC discovery document with `id_token` and `claims.sub`, and an
    // `auth_session` table with no vendor word anywhere. Each is a *shape* — a credential
    // crossing a boundary — rather than a vendor's vocabulary, which is the only kind of
    // rule that survives a rewrite.
    pattern:
      /\b(supabase|firebase|auth0|clerk|nextauth|next-auth|better-auth|oauth2?|openid-connect|oidc|signIn|signInWith|getSession|getServerSession|getIronSession|currentUser|current_user|userSession|withAuth|requireAuth)\b|document\.cookie|(?<![A-Za-z])cookies\s*\(\s*\)|setCookie\s*\(|Set-Cookie|["'`](?:authorization|proxy-authorization)["'`]|Bearer\s+[A-Za-z0-9._-]{8,}|\bsessionSecret\b|signJwt|verifyJwt|\bid_token\b|\bclaims\.sub\b|\baccess_token\b|\.well-known\/openid-configuration|\bauth[_-]?session\b|\bsession[_-]?id["'`]\s*\)|\bgetHeader\(["'`]x-[a-z-]*session/i,
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
    // New, and the one the first verification pass pointed at: the roadmap makes "no cloud
    // sync now or later" a permanent decision, and the first seven exclusions did not cover
    // it at all.
    //
    // The second pass then found **four** more shapes that passed: a PouchDB replication
    // target, a `sendBeacon` to an ingest endpoint, a versioned route named
    // `/api/v2/library/synchronize`, and a POST of a `REMOTE_LIBRARY` constant. The first
    // version of this pattern only knew the words `sync`, `upload`, and `push` — which is
    // why a rule aimed at a *behaviour* kept missing the behaviour. The rule that survives
    // is the shape: the listener's data being sent somewhere, by any transport, to any
    // destination that is not this origin.
    pattern:
      /\/api\/(?:v\d+\/)?[\w-]*(?:sync|synchroni[sz]e|replicate|mirror)[a-z-]*\b|\b(?:cloudSync|cloud-sync|syncToCloud|uploadLibrary|pushToCloud|remoteStore|remoteStorage|pouchdb|PouchDB)\b|\bSYNC_(?:URL|ENDPOINT|KEY|TOKEN)\b|\bsyncUrl\b|\breplicate\.(?:to|from)\b|\bsendBeacon\s*\(|(?:method|body)\s*:\s*["'`](?:POST|PUT)["'`][\s\S]{0,160}?JSON\.stringify\([\s\S]{0,80}?fetch\s*\(\s*(?!["'`]\/api)|JSON\.stringify\([\s\S]{0,80}?fetch\s*\(\s*(?:process\.env|REMOTE_|BACKUP_|COLLECT|INGEST|https?:)|fetch\s*\(\s*(?:REMOTE_|BACKUP_|COLLECT|INGEST|SYNC_)|writeBatch|\.postDoc\s*\(|\bmirror(?:To|ed|ing)?\s*\(|\breplicate\b|\bpipeTo\s*\(\s*(?:remote|mirror)/i,
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
      {
        label: "a PouchDB replication target",
        // The second pass's probe. No word from the first version's list appears in it.
        code: `
          import PouchDB from "pouchdb";
          const local = new PouchDB("spotivibe");
          local.replicate.to(REMOTE, { live: true, retry: true });
        `,
      },
      {
        label: "a beacon to an ingest endpoint",
        code: `
          export function reportUsage() {
            navigator.sendBeacon("https://telemetry.example.invalid/ingest", payload);
          }
        `,
      },
      {
        label: "a client helper that mirrors local data to a remote",
        code: `
          export function startMirroring(db: Database) {
            return db.changes({ live: true }).pipeTo(mirrorTo(process.env.REMOTE_DB));
          }
        `,
      },
      {
        label: "a bidirectional change feed against a remote database",
        code: `
          const remote = new Database(process.env.REMOTE_DB);
          export function connect(local: Database) {
            return local.changes({ live: true, since: "now" }).pipeTo(remote.changes({ live: true }));
          }
        `,
      },
      {
        label: "a POST of a remote-library constant",
        code: `
          const REMOTE_LIBRARY = "https://library.example.invalid/v1";
          await fetch(REMOTE_LIBRARY, { method: "PUT", body: JSON.stringify(state) });
        `,
      },
    ],
  },
  {
    label: "no cloud user database",
    clause: "ROADMAP §2.2",
    // A client-side database SDK, an ORM's client, or a table-shaped store fetched from a
    // remote origin. The second pass found three dependency-level shapes that passed: an
    // unquoted `from 'pg'`, `drizzle-orm/postgres-js`, and a `model User` schema. So the
    // rule is a module-specifier shape — a *driver or ORM* named in an import or a
    // dependency map — rather than a quoted list of exact package names, which is what the
    // first version had and which only matched the spelling it anticipated.
    pattern:
      /\b(?:from|import|require\()\s*["'`](?:pg|pg-pool|postgres|postgresql|mysql2?|mysqldb?|sqlite3?|better-sqlite3|mongodb|mongoose|knex|sequelize|typeorm|drizzle-orm(?:\/[\w-]+)?|@vercel\/kv|@upstash\/redis|@upstash\/rdb|@google-cloud\/firestore|@supabase\/supabase-js|@libsql\/client|@planetscale\/database|firebase(?:\/[\w-]+)?|firestore(?:\/[\w-]+)?|appwrite|nedb(?:-promise)?|lowdb|realm)\b|["'`](?:pg|pg-pool|postgres|mysql2?|sqlite3|better-sqlite3|mongodb|mongoose|sequelize|typeorm|drizzle-orm|@vercel\/kv|@upstash\/redis)["'`]\s*:|@prisma\/client|@supabase\/supabase-js|@google-cloud\/firestore|(?:name|table|model|entity)\s*:\s*["'`][A-Z]\w*["'`][\s\S]{0,160}?columns\s*:\s*\{/i,
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
      {
        label: "an unquoted driver import",
        // The second pass's probe: identical to the real thing, and invisible to a rule
        // that only matched inside double quotes.
        code: `
          import { Pool } from 'pg';
          const pool = new Pool({ connectionString: url });
          export async function GET() {
            const rows = await pool.query("select * from listeners");
            return Response.json(rows.rows);
          }
        `,
      },
      {
        label: "an ORM driver import",
        code: `
          import { drizzle } from "drizzle-orm/postgres-js";
          export const db = drizzle(process.env.DATABASE_URL);
        `,
      },
      {
        label: "a table schema declaration",
        // The second pass's probe: a schema with no driver and no vendor, which is what a
        // hand-rolled persistence layer looks like before anyone connects it to anything.
        // Matched as the *shape* — a named entity with a column map — rather than as a
        // table name, because a table name is vocabulary and a column map is not.
        code: `
          export const User = {
            name: "User",
            columns: { id: "uuid", email: "text" },
          };
          export const Play = { name: "Play", columns: { track: "text" } };
        `,
      },
    ],
  },
  {
    label: "no user-database dependency",
    clause: "ROADMAP §2.2",
    // The dependency *manifest* is a closed set, so this exclusion's real strength is the
    // positive check below — it pins the exact runtime dependency list, which is a proof
    // rather than a heuristic. The pattern here is the secondary net, catching a driver that
    // appears in a manifest this sweep reads, and the second verification pass found it to be
    // the weakest of the eight: a driver named by an import rather than in the manifest
    // (`from 'pg'`, `drizzle-orm/postgres-js`) is caught by the *cloud user database*
    // detector's module-specifier shape instead, and a `model User` schema by its
    // column-map shape. That split is deliberate and is why the three are separate
    // exclusions rather than one.
    pattern:
      /"(?:supabase-js|firebase|@google-cloud\/firestore|pg|pg-pool|postgres|mysql2?|mongoose|prisma|@prisma\/client|sqlite3|better-sqlite3|mongodb|mongoose|sequelize|typeorm|drizzle-orm|knex|@vercel\/kv|@upstash\/redis)"/,
    violations: [
      {
        label: "an ORM and its driver",
        code: `
          { "dependencies": { "@prisma/client": "^6.0.0", "pg": "^8.11.0" } }
        `,
      },
      {
        label: "a hosted KV store as a dependency",
        code: `
          { "dependencies": { "@vercel/kv": "^3.0.0", "next": "16.3.6" } }
        `,
      },
      {
        label: "a local SQL driver",
        code: `
          { "dependencies": { "better-sqlite3": "^12.0.0", "zod": "^4.6.5" } }
        `,
      },
    ],
  },
  {
    // ─────────────────────────────────────────────────────────────────────────────
    // §2.5, narrowed — clause 1 only.
    //
    // ROADMAP §2.5 reads as three clauses:
    //
    //   1. Do not implement YouTube-to-MP3.
    //   2. Do not cache extracted YouTube audio for offline playback.
    //   3. Do not port Lyrix's `downloadService.ts` or `/api/download/:videoId` behaviour.
    //
    // ROADMAP §18 (2026-10-03) and §21.5 reverse **clause 3**, and only clause 3: M20 is
    // required to build exactly that path, with exactly that extractor, for private personal
    // use. Clauses 1 and 2 are not mentioned in §18's bullet list of what the reversal does
    // *not* authorise, and they are restated as permanent in §21.5's own non-goals. So they
    // are not deleted — they are split into the two detectors below, one clause each.
    //
    // What was removed from the old pattern, and why each removal is not a weakening:
    //
    //   • `ytdl|ytdl-core` — §21.5 names `@distube/ytdl-core` as the primary extractor, and
    //     §2.5 clause 3 is what forbade it. Banning the approved dependency is a bug.
    //   • `adaptiveFormats` — this is the *response field* the approved Invidious fallback must
    //     read. It is not evidence of a hand-rolled extractor; reading a documented API field
    //     is what using an API means. The hand-rolled extractor is still caught, by
    //     `streamingData` and `signatureCipher`, which is what it *actually* needs.
    //   • `downloadAudio|downloadTrack|downloadVideo|extractAudio|…` — the approved feature
    //     has functions by those names. A rule that forbade the vocabulary of a required
    //     feature is a rule that would have been switched off within a week of the merge.
    //   • `audio/(?:mpeg|mp4|ogg|opus|…)` and `\.(?:m4a|mp3|opus|…)` — these banned every
    //     audio media type and every audio extension anywhere in the tree. An honest format
    //     mapper *must* contain them: `container.ts` has to be able to say "Opus in WebM is
    //     `.webm`". Replaced by a **positive** rule — the extension has exactly one home —
    //     asserted below and in `tests/download-container.test.ts`. A `.mp3`
    //     literal appearing in a route, a helper, or a component still fails; one appearing
    //     in the codec table that decides it is now the requirement rather than the violation.
    //     • the second half of that substitution was WRONG at first, and is now corrected. "Replaced
    //     by a stronger rule" was not true for a client-side `<a download="….mp3">` that builds no
    //     object URL: the filename clause only looked at `filename*`, and the initiation sweep never
    //     saw the file at all. An extension-bearing `download` attribute is now matched in its own
    //     right, with its own fixtures.
    //   • `captureStream|getAudioTracks|MediaRecorder|…` — moved, not removed. They are
    //     clause 2's evidence, and clause 2 has its own detector below.
    // ─────────────────────────────────────────────────────────────────────────────
    label: "no MP3 faking",
    clause: "ROADMAP §2.5",
    // The exclusion is about producing MP3 audio. Downloading is now approved; *lying about
    // what was downloaded* is not, and neither is a transcoder, a second downloader, or a
    // hand-rolled manifest reader that exists because no library was used.
    //
    // Deliberately still no `createObjectURL` and no generic `download` word: the backup
    // export *is* a file download, and the roadmap requires it. The first version of this
    // pattern flagged `DataControls.tsx` for exactly that — a false positive that would have
    // been resolved by deleting a required feature.
    //
    // The last clause is the one the narrowing made necessary. The old pattern matched the
    // *syntax* of a media filename (a quoted string ending in `.m4a`), which the approved
    // feature must also contain. What it could not distinguish was whether the name was
    // **derived** from the selected format or **asserted**. It is now matched as: a filename
    // or `Content-Disposition` that *contains a literal extension* rather than a variable.
    // `filename="${name}"` is the approved shape and does not match; `filename="track.mp3"`
    // is the lie and does.
    //
    // The three `download`-shaped arms are deliberately **broader than the exclusion's name**, which
    // is "no MP3 faking". They also fire on `<a download="Track.webm">`. That is intended, and the
    // reasoning is the one property this module has always asserted: the extension must come from
    // the server's `Content-Disposition`, because the server is the only place that knows whether
    // the bytes are Opus in WebM or MP3. A client that asserts *any* extension is second-guessing
    // the server, so a confidently-wrong `.webm` deserves the same scrutiny as a `.mp3` — and
    // distinguishing "probably lying" from "lying" inside a regex is not a distinction worth having,
    // because the approved shape (`anchor.download = filename`, a variable) is the only one that
    // should survive and it does not match at all.
    //
    // The arms cover three spellings, because a narrowing fix that only patches the shape it was
    // shown is not a fix: the imperative assignment, the declarative JSX attribute (with or without
    // its expression container), `setAttribute("download", …)`, and the concatenation
    // `download = name + ".mp3"`. Each has its own fixture below.
    pattern:
      /\b(?:youtube-dl|youtube-dl-exec|yt-dlp|yt_dlp|yt-dlp_|streamlink|audiodl|videotube|ffmpeg(?:\.exe)?|fluent-ffmpeg|avconv|\bsox\b|\blame\b)\b|streamingData|signatureCipher|decipherFunction|\bdecipher\b|player_ias|\/base\.js|n-parameter|new\s+Function\s*\(|googlevideo\.com[^"'`]*\.(?:m4a|mp3|opus|webm|flac|aac)|writeFile\w*\([^)]*\.(?:m4a|mp3|opus|webm|flac|aac)|\.(?:toFormat|convert|remux|encode)\w*\s*\(\s*["'`](?:mp3|m4a|aac|opus|ogg|flac)["'`]|filename\w*\s*[:=][^\n]{0,80}["'`][^"'\n]{1,64}\.(?:m4a|mp3|opus|flac|aac|ogg|wav|webm)\b|\bdownload\s*=\s*\{?\s*["'`][^"'\n]{1,64}\.(?:m4a|mp3|opus|flac|aac|ogg|wav|webm)\b|setAttribute\(\s*["'`]download["'`]\s*,|\bdownload\s*=\s*\{?\s*[^;\n]{0,48}[+`]\s*["'`]\.(?:m4a|mp3|opus|flac|aac|ogg|wav|webm)\b/i,
    violations: [
      {
        label: "a second, unapproved downloader as a dependency",
        // The old fixture was `import ytdl from "ytdl-core"`, and it had to change: that
        // package is the dependency ROADMAP §21.5 names, so it can no longer be the example of
        // a forbidden one. `youtube-dl-exec` is a real, different, still-forbidden downloader.
        // The clause that caught it (`yt-dlp`) is unchanged — the vocabulary list lost
        // `ytdl` and kept everything else.
        code: `
          import { download } from "youtube-dl-exec";
          export async function GET(request: Request) {
            const url = new URL(request.url).searchParams.get("v");
            return new Response(await download(url), { headers: { "content-type": "audio/mpeg" } });
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
        // Still fires after the narrowing — on `streamingData` and `signatureCipher`, which
        // are the two things it genuinely cannot do without.
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
        label: "the extracted bytes served under a hardcoded .mp3",
        // NEW, and the shape the narrowing makes newly possible. This is the exact lie
        // §2.5 clause 1 exists to forbid, now written as the *approved* route with one thing
        // wrong: the extension asserted instead of derived. Before M20 this would have been
        // caught by the blanket `\.(?:mp3|…)\b` clause, so it must be caught now by name.
        code: `
          export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }) {
            const { videoId } = await context.params;
            const stream = await extract(videoId);
            return new Response(stream, {
              headers: { "Content-Disposition": 'attachment; filename="track.mp3"' },
            });
          }
        `,
      },
      {
        label: "a client-side download attribute that names the file itself",
        // NEW, and added because the first version of this fixture set missed it. The reviewer
        // proved the gap rather than inferring it: a pre-narrowing pattern caught
        // `<a download="Never Gonna Give You Up.mp3" href={streamUrl}>` and the narrowed one did
        // not. The compensating "download initiation" sweep does not save it either, because it
        // only classifies files mentioning `.download =` or `createObjectURL(`, and a *declarative
        // JSX attribute* contains neither token — so such a file never reaches the classifier.
        //
        // This is the shape the narrowing newly permits, and it is the most plausible way for the
        // lie to come back: the server streams an honest `.webm`, and the browser is told to call it
        // `.mp3` because that is the name people recognise. Exactly what §2.5 clause 1 forbids.
        //
        // The approved shape — `anchor.download = filename`, where `filename` came from the
        // server's `Content-Disposition` — is still a variable and does not match.
        code: `
          export function SaveTrack({ streamUrl, title }: { streamUrl: string; title: string }) {
            return <a download={\`\${title}.mp3\`} href={streamUrl}>Save</a>;
          }
        `,
      },
      {
        label: "an anchor whose download name is asserted to MP3",
        // The declarative attribute and the imperative assignment are both ways to say it, and
        // only one of them would have been caught by the arm above if that arm had been written to
        // require `download=`. Asserted separately so the arm cannot quietly narrow to one form.
        code: `
          export function saveAsMp3(blob: Blob, title: string) {
            const anchor = document.createElement("a");
            anchor.href = URL.createObjectURL(blob);
            anchor.download = \`\${title}.mp3\`;
            anchor.click();
          }
        `,
      },
      {
        label: "a download attribute set through setAttribute",
        // The third spelling. The first fix for CRITICAL A added the JSX attribute and the
        // imperative assignment; `setAttribute("download", …)` has no `=` after the word `download`
        // at all, so it was still invisible. A narrowing fix that only patches the shape it was
        // shown is not a fix.
        code: `
          export function save(el: HTMLAnchorElement, url: string, title: string) {
            el.href = url;
            el.setAttribute("download", title + ".mp3");
            el.click();
          }
        `,
      },
      {
        label: "a download name assembled by concatenation",
        // And the fourth: no literal extension *next to* `download`, only a `+` and then one. This
        // is the shape a developer reaches for precisely because they think it is more dynamic than
        // a literal — so the literal is exactly what they would have got wrong.
        code: `
          export function saveAs(blob: Blob, name: string) {
            const anchor = document.createElement("a");
            anchor.href = URL.createObjectURL(blob);
            anchor.download = name + ".mp3";
            anchor.click();
          }
        `,
      },
      {
        label: "a transcoder that converts WebM audio to MP3",
        // NEW for the same reason, from the other direction: the honest mapper says `.webm`,
        // and this is the tempting way to "fix" that. Real conversion is out of scope
        // (ROADMAP §21.5), and this is what implementing it looks like.
        code: `
          import { execFile } from "node:child_process";
          export async function toMp3(input: string, output: string) {
            await execFileAsync("ffmpeg", ["-i", input, "-vn", "-f", "mp3", output]);
          }
        `,
      },
      {
        label: "a scraped media URL written to an audio file",
        // The second pass's probe. The exclusion is about the *outcome* — a track on disk —
        // and the outcome is the thing matched here, because no tool name appears in it.
        code: `
          export async function save(videoId: string) {
            const page = await fetch("https://www.youtube.com/watch?v=" + videoId).then((r) => r.text());
            const url = page.match(/https:\\/\\/r\\d+--sn[^"']+\\.googlevideo\\.com[^"']+?\\.m4a/)?.[0];
            if (url) await fs.writeFile("track.m4a", await (await fetch(url)).arrayBuffer());
          }
        `,
      },
      {
        label: "a downloaded player bundle executed to reverse a signature",
        // The second pass's other probe: the technique an extractor uses when nobody
        // installs one. `new Function` over fetched script is the tell.
        code: `
          export async function decipher(cipher: string) {
            const script = await fetch("/player_ias.vflset/en_US/base.js").then((r) => r.text());
            return new Function("a", script + ";return " + cipher)();
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
    //
    // The second pass found two more shapes that passed, and both are *the loop* rather than
    // a keyword: a 200 ms interval that mutes and calls `play()` with no `visibilitychange`
    // and no volume literal, and a `wakeLock` plus a `playVideo()` interval. So the rule now
    // matches a timed callback whose body starts playback — which is the actual technique,
    // and is stated rather than enumerated.
    pattern:
      /\b(audioContext|new Audio\(|setSinkId|mediaSession\.setActionHandler|navigator\.mediaSession|keepAlive|preventBackgroundThrottle|silentAudio|blockUserGesture|autoPlayPolicy|wakeLock|navigator\.wakeLock)\b|volume\s*=\s*0\s*(;|$|\/\/)|\.muted\s*=\s*(?:true|!0)|visibilitychange[\s\S]{0,200}?\.play\s*\(|setInterval\s*\([\s\S]{0,200}?\.play(?:Video)?\s*\(|setInterval\s*\([\s\S]{0,200}?(isPaused|paused)/i,
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
      {
        label: "a fast mute-and-replay loop with no keywords",
        // The second pass's probe. No visibilitychange, no volume literal, no `isPaused` —
        // the technique is a timer that keeps the player going, and that is what is matched.
        code: `
          setInterval(() => {
            player.muted = !0;
            void player.play().finally(() => undefined);
          }, 200);
        `,
      },
      {
        label: "a wake lock plus a play loop",
        code: `
          navigator.wakeLock.request("screen");
          setInterval(() => player.playVideo(), 1000);
        `,
      },
    ],
  },
  {
    label: "no ad-blocking behaviour",
    clause: "ROADMAP §2.8",
    // A host list, a path pattern, a name for the act, or an element hidden by a selector.
    // The first version listed only vendor hostnames and function names, so a list
    // assembled from string parts, or one keyed on a URL path, passed — and the sweep did
    // not even read the service worker where ad-blocking belongs.
    //
    // The second pass found two more: hiding elements by a class selector rather than
    // blocking a request, and a host filter built with `new RegExp([...].join("|"))`. The
    // first is ad-blocking's other half — CSS filtering, which touches no network at all —
    // and the second is the same list, assembled at run time so no single hostname appears.
    pattern:
      /\b(adblock|adBlock|adblocker|adBlocker|blockAds|filterAds|removeAds|stripAds|AD_HOSTS|AD_DOMAINS|AD_BLOCK_LIST|AD_PATTERNS|blockedHosts|blockedDomains|blockedUrls|blockList)\b|doubleclick\.net|googlesyndication\.com|pagead2?|adsense\.com|click\.net|googletagservices|adservice|adsystem|["'`]ads?["'`]\s*:\s*(?:true|\[)|\/(?:ads?|advert|pagead)\/(?:served|pagead)|respondWith\s*\(\s*new Response\(\s*["'`]["'`]\s*\)\s*\)[\s\S]{0,120}?ads?|new\s+RegExp\s*\(\s*\[|\.(?:classList|className)["'`\]]?\s*=[\s\S]{0,60}?(?:sponsor|promoted|advert)|querySelectorAll\s*\(\s*["'`][^"'`]*(?:sponsor|promoted|advert)[^"'`]*["'`][\s\S]{0,120}?\.remove\s*\(|["'`][^"'`]*\[class\*=["']?[^"']*(?:sponsor|promoted)/i,
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
      {
        label: "a host filter assembled at run time",
        // The second pass's probe: the same deny-list, built by joining, so no individual
        // hostname is ever present in the source for a keyword rule to find.
        code: `
          const BLOCK = new RegExp(["doubleclick", "adserv", "pagead"].join("|"));
          self.addEventListener("fetch", (event) => {
            if (BLOCK.test(new URL(event.request.url).host)) {
              event.respondWith(new Response(""));
            }
          });
        `,
      },
      {
        label: "elements hidden by a class selector",
        // Ad-blocking's other half: no network, no deny-list, just content removed from the
        // page. The first version could not see it at all.
        code: `
          for (const node of document.querySelectorAll('[class*="sponsor|promoted"]')) {
            node.remove();
          }
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
    // The second pass's probe: a forwarder that takes its upstream from the *request body*
    // rather than a query parameter, so every "where does the URL come from" rule the first
    // version had missed it. A caller-supplied URL is a caller-supplied URL whichever
    // envelope it arrives in, so both are matched.
    pattern:
      /fetch\s*\(\s*["'`][^)]*googlevideo|proxyStream|streamProxy|\/api\/(proxy|stream|media)\b|(?:searchParams\.get|get\s*\(\s*["'`](?:url|target|src|source|media|href)["'`]\s*\))\s*\)[\s\S]{0,240}?fetch\s*\(|request\.json\s*\(\s*\)[\s\S]{0,240}?fetch\s*\(|await\s+request\.json[\s\S]{0,120}?\.url\b[\s\S]{0,200}?fetch\s*\(|fetch\s*\([^)]*\)[\s\S]{0,240}?new\s+Response\s*\(\s*[\w$]+\.body|arrayBuffer\s*\(\s*\)[\s\S]{0,200}?new\s+Response/i,
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
      {
        label: "a forwarder taking its upstream from the request body",
        // The second pass's probe. Same proxy, different envelope: the URL arrives in a JSON
        // body rather than a query parameter, which is how it got past a rule that only
        // looked for `searchParams.get("url")`.
        code: `
          export async function POST(request: Request): Promise<Response> {
            const { url } = await request.json();
            const media = await fetch(url);
            return new Response(media.body, { headers: media.headers });
          }
        `,
      },
      {
        // NEW in M20, and the shape the approved route makes newly possible. The approved
        // download route is *itself* a route that fetches media and hands the body back, so
        // §2.7's own detector has to be able to see the difference. What makes the difference
        // is that the URL comes from a validated provider id resolved server-side, and never
        // from the request. So this fixture is the approved route with the one word changed:
        // a caller-supplied URL in the query string. Same detector, same clauses.
        label: "the approved download route taking a caller-supplied media URL",
        code: `
          export async function GET(
            request: Request,
            context: { params: Promise<{ videoId: string }> },
          ): Promise<Response> {
            const { videoId } = await context.params;
            const target = new URL(request.url).searchParams.get("url") ?? videoId;
            const media = await fetch(target);
            return new Response(media.body, { headers: media.headers });
          }
        `,
      },
    ],
  },
  {
    // ─────────────────────────────────────────────────────────────────────────────
    // §2.5, narrowed — clause 2 only.
    //
    // "Do not cache extracted YouTube audio for offline playback." ROADMAP §18 did not
    // reverse this clause and ROADMAP §21.5 restates it as a non-goal ("no managed offline
    // library"), so it keeps a detector of its own rather than being folded into the clause-1
    // entry. The distinction it draws is the one M20's design rests on: a file handed to the
    // device and gone, versus audio the application keeps and will play back itself.
    //
    // Every clause here is a *different route to the same outcome*, because the outcome has
    // three implementations and none of them needs a vendor word:
    //
    //   • re-recording the parked player through the Web Audio / MediaRecorder APIs, which is
    //     what you do when you cannot extract (the old `captureStream` / `MediaRecorder`
    //     clauses, unchanged and still load-bearing);
    //   • writing bytes into IndexedDB under a media-ish store name — matched at the store
    //     *declaration*, because a name chosen at run time would defeat a `put`-shaped rule;
    //   • writing bytes into a Cache API entry, matched the same way, at `caches.open`.
    //
    // The IndexedDB clause therefore has two arms, and the second is the load-bearing one. The
    // application's own `schema.ts` declares stores as `{ name: STORE.likedTracks, options: … }`
    // and creates them as `createObjectStore(definition.name, definition.options)`, so a real
    // store named `"offlineMedia"` puts its quoted media string *nowhere* a
    // `createObjectStore("…")` rule looks. The declaration arm covers that shape. Matching the
    // `createObjectStore("…")` arm alone — which is what the first attempt here did — would have
    // been a rule that could not have caught the code it was written for.
    // ─────────────────────────────────────────────────────────────────────────────
    label: "no media cached for offline playback",
    clause: "ROADMAP §2.5",
    pattern:
      /\.getAudioData\s*\(|captureStream\s*\(|getAudioTracks|MediaRecorder|MediaElementAudioSourceNode|createMediaElementSource\s*\(|createObjectStore\s*\(\s*["'`][^"'`]*(?:media|audio|offline|download)[^"'`]*["'`]|objectStore\s*\(\s*["'`][^"'`]*(?:media|audio|offline)[^"'`]*["'`]|(?:STORE_DEFINITIONS|STORE_DEFINITION|createObjectStores?)\b[\s\S]{0,240}?name:\s*["'`][^"'`]*(?:media|audio|offline|download)[^"'`]*["'`]|caches\.open\s*\(\s*[^)]*(?:media|audio|offline|download)[^)]*\)/i,
    violations: [
      {
        label: "a media buffer written to local storage",
        // Was a fixture of the single §2.5 detector; now the first fixture of the clause that
        // is actually about this outcome. Unchanged text, so its provenance is checkable.
        code: `
          export async function cacheTrack(track: Track) {
            const buffer = await trackMediaElement.captureStream().getAudioTracks()[0];
            const bytes = await new Response(buffer).arrayBuffer();
            await mediaStore.put(track.id, bytes);
          }
        `,
      },
      {
        label: "the parked player re-recorded through the Web Audio graph",
        code: `
          const source = document.createElement("video");
          const graph = new AudioContext().createMediaElementSource(source);
          const recorder = new MediaRecorder(graph.stream);
          recorder.start();
        `,
      },
      {
        label: "an IndexedDB store created to hold media",
        // Matched at the store *declaration*, not at a `put`. A rule shaped like `put(...)` is
        // defeated by naming the store in a variable; the schema file is where a store comes
        // into existence, and a store that does not exist cannot be written to.
        code: `
          const STORE_DEFINITIONS = [
            { name: "offlineMedia", options: { keyPath: "trackId" } },
          ];
        `,
      },
      {
        // NEW in M20. The approved route streams media past the browser; the nearest bad
        // neighbour is a route that also *keeps* it, so a later request replays bytes off the
        // device instead of from the provider. That is a managed offline library wearing a
        // download route's clothes, and it is the shape this narrowing had to keep catching.
        label: "the download route caching its own response so a later request replays it",
        code: `
          export async function GET(request: Request, context: { params: Promise<{ videoId: string }> }) {
            const { videoId } = await context.params;
            const cache = await caches.open("offlineAudio");
            const hit = await cache.match(videoId);
            if (hit) return hit;
            const stream = await extract(videoId);
            await cache.put(videoId, new Response(stream));
            return new Response(stream);
          }
        `,
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// The path rules, hoisted (M20).
//
// They were declared inside the two tests that use them, which meant the *same* rule could be
// edited in one place and left alone in the other — a narrowing applied to half a rule. Both
// are module-level now, and each carries the record of what M20 removed from it and why.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Path segments that name a permanently forbidden capability.
 *
 * M20 removed `download` from this list. ROADMAP §21.5 requires a route at
 * `src/app/api/download/[videoId]/`, so the capability's name stopped being evidence against
 * itself. The alternative — leaving `download` and adding an exception — would have turned the
 * list into a rule with a hole in it, and a hole is where the next exception goes.
 *
 * What replaced the removal is not nothing: see {@link isMediaRoute}, which allows exactly one
 * download route shape and rejects every other one, and whose violation fixtures include the
 * generic `/api/download` this list used to reject for a reason that no longer applies.
 */
const FORBIDDEN_SEGMENTS =
  /\/(?:sync|synchroni[sz]e|replicate|mirror|proxy|stream|relay|tunnel|upload)(?:\/|$)|\/(?:auth|login|signin|sign-in|register|account|oauth|session)(?:\/|$)|\/admin(?:\/|$)/i;

/**
 * Path segments that name a media-extraction capability, plus the single route shape M20
 * approved.
 *
 * The exclusion itself is unchanged from the pre-M20 rule except that `download` moved out of
 * the forbidden alternation and into {@link APPROVED_MEDIA_ROUTE}. `stream`, `proxy`, `media`,
 * `audio`, `extract`, and `dl` are all still forbidden: none of them is the approved route, and
 * a media route under any of those names is exactly the "generic forwarder" §2.7 has always
 * forbidden.
 */
const MEDIA_ROUTE =
  /\/(?:stream|proxy|media|audio|extract|dl)(?:\/|$)|\/(?:video|youtube|videoid)s?\/[a-z]+\/route/i;

/**
 * The one media route the roadmap approves, named in full.
 *
 * A full path rather than a pattern, because the approved route's whole justification is that
 * its **only** input is a validated provider id in the path. A pattern such as
 * `/download/\[?videoId\]?` would also allow `/download/[anything]/`, which is the shape this
 * allowlist exists to reject. Pinning the exact path means adding a second download route — a
 * batch endpoint, a playlist endpoint, a by-artist endpoint — is a change this constant has to
 * be edited to make, which is the point.
 */
const APPROVED_MEDIA_ROUTE = "src/app/api/download/[videoId]/route.ts";

/** Whether a route path names a media-extraction capability at all (`/stream`, `/proxy`, …). */
function namesMediaCapability(file: string): boolean {
  return MEDIA_ROUTE.test(`/${file}`);
}

/** Whether a route path sits under a `download` segment that is *not* the approved one. */
function isUnapprovedDownloadRoute(file: string): boolean {
  return /\/download(?:\/|$)/i.test(`/${file}`) && file !== APPROVED_MEDIA_ROUTE;
}

/**
 * Whether a route is one the roadmap forbids: either it names a media capability, or it is a
 * download route that is not the approved single-track one.
 *
 * One predicate for both, because the two rules answer the same question — *is this route
 * allowed?* — and the sweep wants one list to compare against empty. Splitting them into two
 * predicates (as a first attempt here did) produced a test that asserted the forbidden paths
 * were `false` and the allowed ones were `false` too, which is a test that cannot distinguish
 * them and therefore proves nothing.
 */
function isForbiddenMediaRoute(file: string): boolean {
  if (file === APPROVED_MEDIA_ROUTE) return false;
  return namesMediaCapability(file) || isUnapprovedDownloadRoute(file);
}

describe("the permanent product exclusions are enforced (M15 task 1.1)", () => {
  it("covers every exclusion the roadmap states as permanent", () => {
    // A guard on the guard: if this list shrank, the sweep below would silently stop
    // checking something.
    //
    // M20 raised the floor from 8 to 9 rather than leaving it: §2.5's single detector became two
    // detectors, one for each of the two clauses the roadmap did *not* reverse, and a clause-count
    // guard is what stops the next narrowing from quietly merging them back into one weaker rule.
    // The list is indexed by other tests (`EXCLUSIONS[2]` is the cloud-user-database detector,
    // reused as a vendor-name matcher over the manifest), so entries are **appended**, never
    // reordered.
    expect(EXCLUSIONS.length).toBeGreaterThanOrEqual(9);
    const labels = EXCLUSIONS.map((exclusion) => exclusion.label);
    for (const expected of [
      "no accounts or authentication",
      "no cloud sync",
      "no cloud user database",
      "no user-database dependency",
      // §2.5 clause 1, after M20 reversed clause 3 only.
      "no MP3 faking",
      // §2.5 clause 2, likewise.
      "no media cached for offline playback",
      "no forced background-play circumvention",
      "no ad-blocking behaviour",
      "no media proxied through the application server",
    ]) {
      expect(labels, expected).toContain(expected);
    }
    // The label the pre-M20 suite used must be *gone*, not merely missing from the expected
    // list: it bundled three clauses of §2.5 behind one rule, and one of the three was reversed.
    expect(labels).not.toContain("no audio extraction or download");
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

  it("also reads file paths, because a route's name lives in its path", () => {
    // The second verification pass's probe was a route at
    // `app/api/v2/library/synchronize/route.ts` — and no content scan can see it, because
    // the body of that file is an ordinary handler. The exclusion was unenforceable for the
    // one shape where the evidence is the *name*, which is the shape a route always takes.
    //
    // A positive sweep over paths, rather than another keyword: no route may sit at a path
    // whose segments name a forbidden capability.
    //
    // `download` is no longer in that list — M20 approved the capability, and the note on the
    // module-level rule records what took its place. Asserting that removal rather than merely
    // inheriting it: a segment lost by accident and a segment lost deliberately look identical
    // in a diff, and the difference is the whole review.
    expect(FORBIDDEN_SEGMENTS.source).not.toContain("download");

    const offenders = applicationSources()
      .map((entry) => entry.file)
      .filter((file) => FORBIDDEN_SEGMENTS.test(`/${file}`));
    expect(offenders, "no route or module may sit at a path naming a forbidden capability").toEqual(
      [],
    );
  });

  it("the path rule is proven able to fail, on the paths that got past the content scan", () => {
    // The same two-proofs discipline as the content detectors, and these are the paths the
    // second verification pass used. Without this the path sweep would be a rule nobody has
    // ever seen reject anything — the exact failure this whole suite is about.
    for (const path of [
      "src/app/api/v2/library/synchronize/route.ts",
      "src/app/api/sync/route.ts",
      "src/app/api/stream/route.ts",
      "src/app/api/proxy/route.ts",
      "src/app/api/auth/session/route.ts",
      "src/app/api/login/route.ts",
      // NEW in M20: a *relay* is a forbidden capability the old list caught and still does. Named
      // explicitly so that a future edit to the list cannot quietly cost it.
      "src/app/api/relay/route.ts",
    ]) {
      expect(FORBIDDEN_SEGMENTS.test(`/${path}`), `${path} must be rejected`).toBe(true);
    }
    // And the routes the application legitimately ships must clear it, so the rule is not
    // "reject anything with a slash in it" — including the download capability's own files,
    // which is exactly what removing `download` from the list allows.
    for (const path of [
      "src/app/api/search/route.ts",
      "src/app/api/artist/route.ts",
      "src/app/api/album/route.ts",
      "src/app/api/discover/route.ts",
      "src/server/music/playlistRef.ts",
      "src/app/api/download/[videoId]/route.ts",
      "src/server/download/sources.ts",
      "src/features/download/useDownloadTrack.ts",
    ]) {
      expect(FORBIDDEN_SEGMENTS.test(`/${path}`), `${path} must be allowed`).toBe(false);
    }
  });

  it("enumerates every API route it ships, so the path rule is not vacuous", () => {
    // The path sweep above would pass on a repository with no routes at all, so the routes
    // it actually has to clear are named. If this ever finds none, the check above is
    // asserting nothing and says so.
    const routes = applicationSources()
      .map((entry) => entry.file)
      .filter((file) => /\/api\/.*\/route\.ts$/.test(file));
    expect(
      routes.length,
      "the application must have API routes for this to mean anything",
    ).toBeGreaterThan(3);
  });

  it("has exactly one media route, and it is the approved single-track one", () => {
    // `no media proxied` has a content detector, and a route that proxies media has ordinary
    // handler code — so the *name* is the evidence, exactly as the sync/auth paths above.
    // This became load-bearing when the player was parked: the parked configuration is the
    // one most likely to tempt a "just fetch the stream instead" route, because the visible
    // surface is gone and the policy pressure is real.
    //
    // M20 changed this rule from "no such route" to "exactly this one route". The change is
    // the whole of the narrowing, and it is deliberately not an exception: `download` left the
    // forbidden alternation and became a *named approval*, so the rule still rejects a generic
    // `/api/download`, a `/api/download/batch`, and a `/api/download/[anything]` — the three
    // shapes that §21.5's non-goals ("no batch or playlist download") rule out. Each of those
    // is in the fixtures below, so the rule is known to be able to reject all three.
    // The sweep. One predicate, so the answer to "which routes are forbidden" is one list, and
    // the approved route is the only member of it that does not have to be empty.
    const routes = applicationSources()
      .map((entry) => entry.file)
      .filter((file) => /\/api\/.*\/route\.ts$/.test(file));
    const offenders = routes.filter((file) => isForbiddenMediaRoute(file));
    expect(offenders, "no route may sit at a path naming a media-extraction capability").toEqual(
      [],
    );

    // And the allowlist cannot be vacuously satisfied by the route not existing: the approved
    // route must be *present*, because an allowlist that matches nothing is not an allowlist.
    expect(
      routes,
      "the approved download route must exist for this rule to mean anything",
    ).toContain(APPROVED_MEDIA_ROUTE);

    // The download rule on its own, stated separately because it is the rule that would catch a
    // batch endpoint added next year, and because `namesMediaCapability` deliberately does not
    // cover `download` any more.
    const unapproved = routes.filter((file) => isUnapprovedDownloadRoute(file));
    expect(unapproved, "a download route may only be the approved single-track one").toEqual([]);

    // Proven able to fail — the media-named routes the pre-M20 rule already caught, all of which
    // are still forbidden and none of which the roadmap mentions approving.
    for (const path of [
      "src/app/api/stream/route.ts",
      "src/app/api/proxy/route.ts",
      "src/app/api/media/route.ts",
      "src/app/api/audio/route.ts",
      "src/app/api/extract/route.ts",
      "src/app/api/dl/route.ts",
    ]) {
      expect(isForbiddenMediaRoute(path), `${path} must be rejected`).toBe(true);
    }
    // And the download-shaped ones, including the three §21.5's non-goals rule out.
    for (const path of [
      // A generic download route with no validated id: the shape the *old* rule caught, and the
      // new one catches too, though for a better-stated reason.
      "src/app/api/download/route.ts",
      // NEW in M20. A batch endpoint is §21.5's explicit non-goal ("no batch or playlist
      // download"). It would have passed the old rule's letter, because `/download/batch` is
      // just another path.
      "src/app/api/download/batch/route.ts",
      // NEW in M20. A download keyed by something other than a provider video id — a playlist,
      // an artist, a search query. All forbidden, all shaped identically to the approved route,
      // which is why the allowlist is a full path and not a pattern.
      "src/app/api/download/[playlistId]/route.ts",
      "src/app/api/download/[query]/route.ts",
    ]) {
      expect(isForbiddenMediaRoute(path), `${path} must be rejected`).toBe(true);
      expect(isUnapprovedDownloadRoute(path), `${path} must be rejected as a download route`).toBe(
        true,
      );
    }
    // And the real routes clear it, so the rule is not "reject any second path segment".
    for (const path of [
      "src/app/api/search/route.ts",
      "src/app/api/artist/route.ts",
      "src/app/api/discover/route.ts",
    ]) {
      expect(isForbiddenMediaRoute(path), `${path} must be allowed`).toBe(false);
    }
    // The approved route is allowed, and allowed *by name* — asserted explicitly so that the
    // allowlist cannot be widened into a pattern without this failing.
    expect(isForbiddenMediaRoute(APPROVED_MEDIA_ROUTE)).toBe(false);
    expect(isUnapprovedDownloadRoute(APPROVED_MEDIA_ROUTE)).toBe(false);
    // …and it is allowed *because* it is named, not because its path happens not to match: a
    // sibling under the same directory with a different dynamic segment is still rejected.
    expect(
      isForbiddenMediaRoute("src/app/api/download/[videoId]/album/route.ts"),
      "a sub-route of the approved download directory is not covered by its approval",
    ).toBe(true);
  });
});

/**
 * The parked player (`lyrix-style-hidden-player`).
 *
 * Parking the YouTube player at 1x1 is an intentional departure from YouTube's documented
 * visible-player requirement, taken for private/personal use. That decision makes two
 * things worth holding mechanically, because the departure is exactly the kind of change
 * that decays into something else over time:
 *
 * 1. **The parking is real.** A dropped class, a `display: none`, or a wider box puts a
 *    branded, clickable video panel back in the corner of every screen — the problem the
 *    change was made to solve, reappearing invisibly.
 * 2. **Parking was not a gateway to circumvention.** A hidden player is precisely the setup
 *    a background-play workaround needs, so the shape of that workaround is checked here
 *    too: nothing resumes, un-mutes, or re-triggers playback to keep an invisible player
 *    running. Parking is presentation.
 */

/**
 * A *scheduled or event-driven* trigger: a timer, a frame callback, an observer, a
 * lifecycle/connectivity listener, or a media-session action.
 */
const PLAYBACK_TRIGGER =
  /set(?:Interval|Timeout|Immediate)\s*\(|requestAnimationFrame\s*\(|addEventListener\s*\(\s*["'`](?:visibilitychange|focus|blur|pageshow|pagehide|online|beforeunload|unload)["'`]|new\s+(?:MutationObserver|IntersectionObserver|ResizeObserver|PerformanceObserver)\s*\(|mediaSession[\s\S]{0,80}?setActionHandler|addEventListener\s*\(\s*["'`](?:play|pause|resume|waiting|stalled|emptied|canplay)["'`]/i;

/** A *resume or unmute*: something that restarts playback or lifts the mute. */
const PLAYBACK_RESUME =
  /\.play(?:Video)?\s*\(|\bplay\s*\(\s*\)|setMuted\s*\(\s*false|\.muted\s*=\s*(?:false|!1)|\.volume\s*=/i;

/** One scope a trigger and a resume can be compared within. */
interface Declaration {
  name: string | null;
  body: string;
}

/** A class member signature, at the 2-space indent this repository writes classes with. */
const CLASS_MEMBER =
  /^\s{2}(?:(?:public|private|protected|readonly|static|abstract|async|get|set)\s+)*[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\(/;

/**
 * Split a source into the scopes a trigger and a resume can be compared within.
 *
 * **Classes are containers, not scopes.** The first version treated a whole `class` body as one
 * declaration and immediately reported `src/player/engine.ts`: a `setTimeout` in
 * `scheduleRetry` and a `play()` in the `play` method are in the same *class* and were
 * therefore "in the same function". A rule that fires on the application's correct code is a
 * rule that gets switched off, so members are split out.
 */
function topLevelDeclarations(code: string): Declaration[] {
  // A declaration starts at column 0. An indented `if`/`}` belongs to the declaration above it,
  // which is what keeps a recursive poll loop's `requestAnimationFrame` in scope with its own
  // `playVideo()` call.
  const lines = code.split("\n");
  const top: Declaration[] = [];
  let name: string | null = null;
  let body: string[] = [];
  const flush = (): void => {
    if (body.some((entry) => entry.trim() !== "")) top.push({ name, body: body.join("\n") });
    body = [];
  };
  for (const line of lines) {
    const opens =
      /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)?/.exec(
        line,
      );
    if (opens && body.some((entry) => entry.trim() !== "")) flush();
    if (opens) name = opens[1] ?? null;
    body.push(line);
  }
  flush();

  // Descend one level into class bodies, so members are independent scopes.
  const scopes: Declaration[] = [];
  for (const declaration of top) {
    if (!/^\s*(?:export\s+)?(?:abstract\s+)?class\b/.test(declaration.body)) {
      scopes.push(declaration);
      continue;
    }
    const memberLines = declaration.body.split("\n");
    let member: string[] = [];
    let memberName: string | null = null;
    const flushMember = (): void => {
      if (member.some((entry) => entry.trim() !== "")) {
        scopes.push({ name: memberName, body: member.join("\n") });
      }
      member = [];
      memberName = null;
    };
    for (const line of memberLines) {
      const isMember = CLASS_MEMBER.test(line);
      if (isMember && member.some((entry) => entry.trim() !== "")) flushMember();
      if (isMember) {
        memberName =
          /^\s{2}(?:(?:public|private|protected|readonly|static|abstract|async|get|set)\s+)*([A-Za-z_$][\w$]*)/.exec(
            line,
          )?.[1] as string;
      }
      member.push(line);
    }
    flushMember();
  }
  return scopes;
}

/**
 * True when a trigger drives a resume in the same source.
 *
 * **Two links, because one is not enough.** Matching a trigger and a resume inside one
 * declaration catches the inline forms; it misses the indirection that defeated the first
 * version of this rule entirely — a named helper invoked by a timer, a `requestAnimationFrame`
 * loop, a reconnect listener calling a bridge method. Those need the second link: a trigger
 * whose callback *names* a function that resumes.
 *
 * A trigger alone is a poll and this application has several legitimate ones. A resume alone
 * is a user-driven control and it has many. Only a trigger that actually reaches a resume is
 * the circumvention.
 */
function KEEPS_PLAYING(code: string): boolean {
  const declarations = topLevelDeclarations(code);
  const resumes = (source: string): boolean => PLAYBACK_RESUME.test(source);
  const triggers = (source: string): boolean => PLAYBACK_TRIGGER.test(source);

  // Link 1: same declaration.
  if (declarations.some(({ body }) => triggers(body) && resumes(body))) return true;

  // Link 2: a trigger whose callback names a declaration that resumes.
  const resumingNames = new Set(
    declarations.filter(({ body }) => resumes(body) && !triggers(body)).map((d) => d.name),
  );
  // Link 3: a trigger that *calls* a resuming declaration, by bare name or as a member.
  //
  // Link 2 handles `setInterval(resume, 500)`, where the name sits where an argument goes.
  // Link 3 is for `setInterval(() => this.holdAudioOpen(), 200)`, where the call is a member
  // access and the resume lives one declaration away. Found by probe, not by reading: with
  // only link 2, an unmute helper invoked through `this.` from a timer passed silently.
  const memberCall = (name: string): RegExp =>
    new RegExp(String.raw`(?:^|[^\w$.])(?:this\.)?${name}\s*\(`);
  const callbackName = (name: string): RegExp => new RegExp(String.raw`\(\s*${name}\s*[,)]`);
  for (const { body } of declarations) {
    if (!triggers(body)) continue;
    for (const name of resumingNames) {
      if (name === null) continue;
      if (callbackName(name).test(body)) return true;
      if (memberCall(name).test(body)) return true;
    }
  }
  return false;
}

/** Shapes that defeated the first version of {@link KEEPS_PLAYING}, with why each one did. */
const MISSED_BY_THE_FIRST_VERSION: Array<[label: string, why: string, code: string]> = [
  [
    "a requestAnimationFrame resume loop",
    "no setInterval/setTimeout, and the play call sits inside the loop's own `if`",
    `
      function pollTick() {
        if (player.getPlayerState() !== YT.PlayerState.PLAYING) {
          void player.playVideo();
        }
        requestAnimationFrame(pollTick);
      }
    `,
  ],
  [
    "a named helper called from a timer",
    "the play call is in the helper, so it is not inline within the trigger",
    `
      function resume() { void player.playVideo(); }
      setInterval(resume, 500);
    `,
  ],
  [
    "a media-session action handler that restarts playback",
    "neither a timer nor a visibilitychange",
    `
      navigator.mediaSession.setActionHandler("play", () => {
        void player.playVideo();
      });
    `,
  ],
  [
    "an unmute-and-resume keep-alive",
    "no keyword from the first pattern; the unmute is the tell",
    `
      function holdAudio() {
        player.setMuted(false);
        void player.play();
      }
      setInterval(holdAudio, 200);
    `,
  ],
  [
    "a reconnect subscription that re-invokes play",
    "an 'online' listener calling a bridge method, not `.play`",
    `
      function onReconnect() { bridge.play(); }
      window.addEventListener("online", onReconnect);
    `,
  ],
  [
    "a frame-loop self-rescheduler with no player reference at all",
    "the resume is `setMuted(false)`, which the first pattern did not list",
    `
      function hold() {
        player.setMuted(false);
      }
      setTimeout(hold, 100);
    `,
  ],
  [
    "a timer whose callback calls an unmute helper as a member",
    "the resume is one call away, through `this.`, so neither same-scope matching nor callback-name matching sees it",
    `
      class Engine {
        holdAudioOpen() {
          player.setMuted(false);
        }

        start() {
          setInterval(() => this.holdAudioOpen(), 200);
        }
      }
    `,
  ],
];

describe("the parked player is parked, and parking is not a workaround", () => {
  const hostSource = readFileSync(join(SRC, "components", "player", "PlayerHost.tsx"), "utf8");

  it("declares the parked state on the one host node", () => {
    // Each token is load-bearing. A 1x1 box that is not transparent still shows a thumbnail;
    // a transparent box that still takes pointer events still eats clicks in the corner.
    for (const token of ["h-px", "w-px", "opacity-0", "pointer-events-none", "fixed"]) {
      expect(hostSource, `the parked state must include ${token}`).toContain(token);
    }
    // Marked for assistive traversal, and the visible state is a distinct one so a test can
    // tell them apart without measuring pixels.
    expect(hostSource).toContain("data-video-mode");
    expect(hostSource).toContain("aria-hidden");
  });

  it("is proven able to fail on a host that is not parked", () => {
    // The same two-proofs discipline as the exclusions above, on the same reasoning: a rule
    // nobody has seen reject anything is a report rather than a check.
    const PARKED = ["h-px", "w-px", "opacity-0", "pointer-events-none"];
    const compliantButUnparked = `
      <div className="fixed bottom-2 right-4 z-50 aspect-video w-[400px]" />
    `;
    const parked = `
      <div className="pointer-events-none fixed bottom-0 left-0 z-0 h-px w-px opacity-0" />
    `;
    for (const token of PARKED) {
      expect(parked, `a parked host must carry ${token}`).toContain(token);
      expect(compliantButUnparked, `an unparked host must not satisfy ${token}`).not.toContain(
        token,
      );
    }
  });

  it("never collapses the host to display:none or removes it while a track is active", () => {
    // Every class token the host applies, read from the source.
    //
    // The first version matched /className=\{[\s\S]*?\}"/ — and the ternary in `PlayerHost`
    // closes with `}` then a newline, never `}"`, so the pattern had **zero** matches in the
    // file it was written for. The token set was `[""]`, and appending `hidden invisible` to
    // the real parked class string left all 65 tests green. A regex-based reader of another
    // file's formatting is the defect: it fails silently and in the safe direction.
    //
    // Read every string literal in the file instead, and require the extraction to have found
    // the parked classes *specifically* — so an extraction that returns nothing fails rather
    // than passing on an empty set.
    const literals = [...hostSource.matchAll(/["'`]([^"'`\n]+)["'`]/g)].map((match) => match[1]);
    const tokens = new Set(literals.flatMap((literal) => literal.split(/\s+/)));
    const PARKED = ["pointer-events-none", "fixed", "h-px", "w-px", "opacity-0"];
    for (const token of PARKED) {
      expect(tokens.has(token), `the extraction must find ${token}`).toBe(true);
    }
    // Whole-token comparisons: `overflow-hidden` contains "hidden" as a substring, so a
    // substring check fails on correct code — and a check that cries wolf gets switched off.
    expect(tokens.has("hidden"), "the parked host must stay laid out, not display-hidden").toBe(
      false,
    );
    expect(tokens.has("invisible")).toBe(false);
    // `display: none` written as an inline style or a raw style object is the same failure in
    // a different syntax, so it is matched rather than inferred from the class list.
    expect(hostSource).not.toMatch(/display\s*:\s*["']none/i);
    // And the same extraction is shown to find a forbidden token when one is present, so a
    // future refactor cannot make this pass vacuously again.
    const withHidden = new Set([...tokens, "hidden", "invisible"]);
    expect(withHidden.has("hidden"), "the token set must catch an added hidden class").toBe(true);
  });

  it("the host creates no player, by any spelling", () => {
    // Comments are stripped first, and that is not tidiness: the host's own doc comment
    // explains that the player's node is an `<iframe>`, so a raw-source match for `<iframe`
    // fires on the documentation of the very thing the rule forbids. A detector that fires on
    // correct code is a detector that gets switched off.
    const code = stripComments(hostSource);
    // `new yt.Player` was the first version's rule and it missed `new YT.Player` — the
    // spelling this very repository uses in `engine.ts`.
    //
    // The pattern matches the member access rather than the `new` keyword, because a probe
    // found the gap: `new (window as unknown as {...}).YT.Player(...)` — a TypeScript cast
    // between `new` and the member — is invisible to a `new\s+YT\.Player` rule. The prefix does
    // not exclude a preceding dot either, since in `}).YT.Player(` the dot *is* the preceding
    // character. It still cannot be defeated by destructuring or a renamed alias: **no textual
    // rule can**, because resolving an alias is what a type checker does. The load-bearing
    // assertion is the *count* of construction sites in `architecture.test.ts`, and that limit
    // is recorded there as a fixture rather than left unexamined.
    expect(code).not.toMatch(/(?:^|[^\w$])(?:yt|YT|window\.YT)\s*\.\s*Player\s*\(/);
    // React never renders an iframe as a child: the host is a stable wrapper around a node
    // the engine fills in.
    expect(code).not.toMatch(/document\.createElement\(\s*["']iframe["']\s*\)|<iframe\b/i);

    // Proven able to fail, on every spelling the rule has to name — including the cast that
    // the `new`-anchored version missed.
    const CONSTRUCTOR = /(?:^|[^\w$])(?:yt|YT|window\.YT)\s*\.\s*Player\s*\(/;
    for (const shape of [
      "new yt.Player(target, {})",
      "new YT.Player(target, {})",
      "new window.YT.Player(target, {})",
      "new (window as unknown as { YT: { Player: new () => unknown } }).YT.Player(target, {});",
    ]) {
      expect(CONSTRUCTOR.test(shape), `the rule missed: ${shape}`).toBe(true);
    }
    // The stated limit, asserted rather than assumed: an aliased or destructured constructor
    // is not statically resolvable by a pattern. Recording it as a fixture means the boundary
    // is a decision with a known cost, not an unexamined gap someone will rediscover.
    for (const shape of [
      "const p = YT.Player; new p(target, {});",
      "const { Player } = YT; new Player(target, {});",
    ]) {
      expect(CONSTRUCTOR.test(shape), `${shape} is outside what a static rule can see`).toBe(false);
    }
    const IFRAME = /document\.createElement\(\s*["']iframe["']\s*\)|<iframe\b/i;
    for (const shape of [
      `document.createElement("iframe")`,
      `return <iframe src={embedUrl} allow="autoplay" />;`,
    ]) {
      expect(IFRAME.test(shape), `the rule missed: ${shape}`).toBe(true);
    }
  });

  it("proves the host-shape rules can fail, since a positive token match proves nothing", () => {
    // The single-container rules in both suites reduce to "the source contains
    // `firstElementChild`", and appending a second container on every effect run left them
    // all green — only a rendered-DOM test caught it. A positive source-token check cannot
    // detect a *behavioural* regression, so what is proven here is the negative half: the
    // rules that must fire when a real violation is written.
    const APPENDS_SECOND_CONTAINER = /appendChild\s*\(/;
    const VIOLATION = `
      const engine = getPlaybackEngine();
      const extra = document.createElement("div");
      surface.appendChild(extra);
      engine.attach(extra);
    `;
    // The first version's rule ("contains firstElementChild") passes on the violation.
    expect(VIOLATION, "the first version's rule cannot see this").not.toContain(
      "firstElementChild",
    );
    // The rule that *can* see it counts appends, not the presence of a reuse token.
    expect(APPENDS_SECOND_CONTAINER.test(VIOLATION), "an append must be detectable").toBe(true);
    // And the shipped code reuses rather than appends, so the count is exactly the one
    // legitimate append it has.
    const appends = (hostSource.match(/appendChild\s*\(/g) ?? []).length;
    expect(appends, "the host must append exactly one container, on first mount only").toBe(1);
  });

  it("keeps video mode out of every persisted surface", () => {
    // The flag is a per-visit view state. If it reached any persistence channel, a cold
    // launch would restore into a *visible* player, which is the state this change parks by
    // default.
    //
    // **Three named files are not enough**, which is what the first version checked. It read
    // the session store, the snapshot type, and the backup schema — and ignored
    // `localStorage`, a channel this project demonstrably uses for playback-adjacent state
    // (`spotivibe.volume` is exactly that). A `localStorage.setItem("spotivibe.videoMode", …)`
    // inside `setVisible` left all 65 tests green.
    //
    // So the rule is on the *store itself* and on every persistence call it makes, rather than
    // on a list of files someone remembered: the module that owns the flag must not import a
    // persistence API at all, and no source may key a storage write on a video-visible name.
    const store = readFileSync(join(SRC, "stores", "videoModeStore.ts"), "utf8");
    for (const channel of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "getLocalData",
      "write",
    ]) {
      expect(
        store,
        `the video-mode store must not reach ${channel}; it is a per-visit view state`,
      ).not.toContain(channel);
    }

    // And the sweep, over every source rather than three files: a storage key naming a
    // video-visible flag, whatever the channel.
    const PERSISTED_VIDEO =
      /(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*["'`][^"'`]*video[^"'`]*(?:mode|visible|shown)/i;
    const offenders = applicationSources()
      .filter((entry) => PERSISTED_VIDEO.test(entry.code))
      .map((entry) => entry.file);
    expect(offenders, "no source may persist a video-visible flag").toEqual([]);
    // Proven able to fail, on the exact shape that got past the first version.
    expect(
      PERSISTED_VIDEO.test(`localStorage.setItem("spotivibe.videoMode", String(visible));`),
      "a localStorage video-mode write must be caught",
    ).toBe(true);

    // The persisted shapes themselves, kept as a belt-and-braces check on the files that
    // would carry such a field if it were ever added properly.
    for (const file of [
      join(SRC, "data", "indexeddb", "session.ts"),
      join(SRC, "data", "repositories", "types.ts"),
      join(SRC, "data", "backup", "schema.ts"),
    ]) {
      expect(
        readFileSync(file, "utf8"),
        `${file} must not carry a video-visible field`,
      ).not.toMatch(/video(Visible|Mode|Shown)/i);
    }
  });

  it("uses no deprecated player parameter, and the detector can fail", () => {
    // `modestbranding: 1` was here and did nothing — YouTube deprecated it and its docs say
    // it "has no effect". It read like working configuration, which is the problem: a line
    // that looks effective and is inert is worse than no line. A commented-out one would invite
    // an uncomment, so the rule is on the *token*, not on a live assignment.
    const engine = stripComments(readFileSync(join(SRC, "player", "engine.ts"), "utf8"));
    for (const deprecated of ["modestbranding", "showinfo", "autohide", "theme"]) {
      expect(engine, `${deprecated} is deprecated and inert; it must not be passed`).not.toContain(
        deprecated,
      );
    }
    // Proven able to fail, against the shape the code used to have.
    const withModestBranding = `playerVars: { controls: 0, modestbranding: 1, rel: 0 }`;
    expect(withModestBranding).toContain("modestbranding");
  });

  it("does not keep a hidden player playing through a timer, visibility handler, or media session", () => {
    const offenders = applicationSources()
      .filter((entry) => KEEPS_PLAYING(entry.code))
      .map((entry) => entry.file);
    expect(offenders, "parked playback must never be kept alive programmatically").toEqual([]);
  });

  it("the parked-playback detector is proven able to fail, on every shape that got past it", () => {
    // The two-proofs discipline, and the specific list of shapes the first version missed.
    // A detector proved only against phrasing its own author chose proves much less than it
    // appears to; these are the ten that either got past an earlier draft or are the obvious
    // ways to defeat this one.
    for (const [label, why, code] of MISSED_BY_THE_FIRST_VERSION) {
      expect(KEEPS_PLAYING(stripComments(code)), `the detector missed ${label} — ${why}`).toBe(
        true,
      );
    }

    // And the shapes the first version did catch, so the fix is not a narrowing.
    for (const [label, code] of [
      [
        "an inline setInterval play",
        `setInterval(() => { if (player.isPaused) player.playVideo(); }, 500);`,
      ],
      [
        "a visibilitychange play",
        `document.addEventListener("visibilitychange", () => { el.play(); });`,
      ],
      [
        "a fast mute-and-replay loop",
        `setInterval(() => { player.muted = true; void player.play(); }, 200);`,
      ],
      ["a setTimeout chain", `setTimeout(function again() { player.playVideo(); again(); }, 100);`],
    ]) {
      expect(KEEPS_PLAYING(stripComments(code)), `the detector missed ${label}`).toBe(true);
    }

    // The other half of the proof: a poll that only *reports* is not a keep-alive, and the
    // application has plenty of legitimate ones — including its own 1s position poller and its
    // own reconnect recovery. A rule that fires on those gets switched off, and a rule that
    // would have fired on them is a rule that was not run against the real sources.
    for (const [label, code] of [
      [
        "a position poll that only reads state",
        `setInterval(() => { void player.getCurrentTime(); }, 1000);`,
      ],
      [
        "a health probe that only reads state",
        `setInterval(() => { report(player.getPlayerState()); }, 2000);`,
      ],
      ["a user-driven play control", `onClick={() => void player.playVideo()}`],
      ["a resume helper that is never scheduled", `function resume() { void player.playVideo(); }`],
      [
        "an observer that only re-renders",
        `new MutationObserver(() => { forceUpdate(); }).observe(node, { childList: true });`,
      ],
    ]) {
      expect(KEEPS_PLAYING(stripComments(code)), `${label} must NOT be reported`).toBe(false);
    }
  });
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

describe("every download the application initiates is classified, and named honestly (M15 task 1.1, narrowed by M20)", () => {
  /**
   * Classify a file that initiates a download, from what it does with the bytes.
   *
   * Two positive signals, deliberately not one:
   *
   *   • **backup** — the file states a textual media type. It is producing text on the device and
   *     naming what it produced, so the type is its own to declare.
   *   • **approved media download** — the file reads `content-disposition`. It is relaying bytes
   *     somebody else decided the name of, so the server owns the extension.
   *
   * The media branch is *not* "the file mentions `audio/`". An earlier version of this
   * classifier used the media type literal as the signal, which is precisely what the approved
   * client cannot do: it never inspects the content type to pick a name, because a name it
   * picks itself is a name it could pick wrongly. So the only thing that identifies a media
   * download is that it defers to the server — and a file that defers to neither is a download of
   * unknown provenance, which is what `neither` means and why it fails.
   *
   * @returns the class, or `"neither"` when neither signal is present, or `"both"` when a file
   *   claims to be a backup while also relaying a server-chosen name.
   */
  function classify(entry: {
    file: string;
    code: string;
  }): "backup" | "media" | "neither" | "both" {
    const types = [...entry.code.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1]);
    const textual = types.filter((type) => /^application\/(json|.*\+json)$|^text\//.test(type));
    const media = types.filter((type) => /^(audio|video)\//i.test(type));
    const defersToServer = /content-disposition/i.test(entry.code);
    // A media type literal is the one signal that is simply wrong now: the approved route sets
    // the content type from the selected container, so it is the server's declaration, and the
    // client has no business repeating or narrowing it. Report it rather than ignore it.
    if (media.length > 0) return "both";
    if (defersToServer && textual.length > 0) return "both";
    if (defersToServer) return "media";
    if (textual.length > 0) return "backup";
    return "neither";
  }

  /**
   * What counts as the application *initiating* a download, rather than merely mentioning one.
   *
   * Three revisions, each of which had to be corrected by running it:
   *
   *   - `/\.download\s*=|createObjectURL\(/` — required a dot before `download`, so it found
   *     `anchor.download = x` and missed a **declarative** JSX attribute, which has no dot and
   *     calls no `createObjectURL`. Property 2 of the check was therefore unenforced for the most
   *     natural way to write one.
   *   - `/\bdownload\s*=/` — over-corrected into `const download = useCallback(…)`, an ordinary
   *     local in the approved hook. Every file it swept in had to classify as a download, so the fix
   *     broke the check it was meant to strengthen. An over-broad filter is as wrong as a narrow one:
   *     enumeration is only useful if what it enumerates is what it claims.
   *   - this — the attribute is *located* rather than the word: property access, a JSX tag
   *     attribute scoped to inside the tag, and `setAttribute("download", …)`.
   *
   * `@param code` one source file
   * @returns whether the file initiates a download
   */
  const DOWNLOAD_INITIATION =
    /\.\s*download\s*=|createObjectURL\(|<[A-Za-z][^>]*\sdownload\s*=|setAttribute\(\s*["'`]download["'`]/;

  /**
   * The filter this one replaced, kept so the change above can be *justified* rather than asserted.
   *
   * A detector that is quietly loosened is indistinguishable from one that was always right, and
   * "the new filter finds more" is only a claim in favour of the new filter if the old one is
   * shown to have found less. Written out rather than imported, because importing the old version
   * would leave two filters in the file with no indication which one is live.
   *
   * @param code one source file
   * @returns whether the *previous* filter counted it as initiating a download
   */
  const DOWNLOAD_INITIATION_BEFORE = /\.\s*download\s*=|createObjectURL\(/;

  /**
   * The name a download offers, in both spellings.
   *
   * The brace form is captured whole — `\{[^>\n]*\}` — up to the last `}` before the tag closes. A
   * lazier `\{?([^}\n>]+)` stops at the first `}`, which for `<a download={`${title}.mp3`} …>`
   * truncates the value at ``  `${title `` and the extension sits after the truncated point, so the
   * name looks honest. Over-reading rather than under-reading is the right direction here: the
   * capture may swallow a neighbouring attribute's value, which can only make the check stricter.
   *
   * @param code one source file
   * @returns every filename the file offers a download under
   */
  function downloadNamesOffered(code: string): string[] {
    return [
      ...[...code.matchAll(/\.\s*download\s*=\s*([^;]+);/g)].map((m) => m[1].trim()),
      ...[...code.matchAll(/\bdownload\s*=\s*(\{[^>\n]*\}|[^>\n]+)/g)].map((m) => m[1].trim()),
    ];
  }

  it("finds every download initiation and classifies it", () => {
    // A positive check, and the reason it exists. The negative pattern cannot say
    // `createObjectURL` is wrong, because the backup export *is* a file download and the
    // roadmap requires one. So rather than forbidding the mechanism, this enumerates every place
    // the application initiates a download and asserts each is one of two things.
    //
    // M20 added the second thing. The check is therefore no longer "every download is a backup" —
    // it is "every download is *either* a backup *or* the approved single-track media download,
    // and either way the filename says what the bytes are". The two properties that survived
    // unchanged are the ones that matter:
    //
    //   1. **No download composes a media extension in the browser.** The extension must come
    //      from the server's `Content-Disposition`, because the server is the only place that
    //      knows whether the bytes are Opus in WebM or MP3. A client that appended `".mp3"` would
    //      be the exact lie ROADMAP §2.5 clause 1 forbids, and it would be invisible from here.
    //   2. **No `<a download>` points at a remote origin**, which would be a download the
    //      application did not produce.
    //
    // The filter below is what makes both of those claims about *this* codebase rather than about a
    // subset of it. It used to be `/\.download\s*=|createObjectURL\(/`, which requires a dot before
    // `download` — so it matched `anchor.download = x` and nothing else. A **declarative** JSX
    // attribute, `<a download={name} href="https://…">`, contains no dot and calls no
    // `createObjectURL`, so such a file never entered the set and property 2 was silently unenforced
    // for the most natural way to write one.
    //
    // It then became `\bdownload\s*=`, which over-corrected: that also matches
    // `const download = useCallback(…)` — an ordinary local variable in the approved hook — and every
    // file it swept in had to classify as a download, so the fix broke the check it was meant to
    // strengthen. An over-broad *filter* is as wrong as a narrow one, because enumeration is only
    // useful if what it enumerates is what it claims.
    //
    // So the attribute is located rather than the word. Three spellings: property access
    // (`anchor.download = …`), a JSX tag attribute (`<a download=…>`, scoped to inside the tag so a
    // local variable cannot reach it), and `setAttribute("download", …)`.
    const initiations = applicationSources().filter((entry) =>
      DOWNLOAD_INITIATION.test(entry.code),
    );
    expect(
      initiations.length,
      "the application initiates at least the backup download",
    ).toBeGreaterThan(0);

    const kinds = new Set<string>();
    for (const entry of initiations) {
      const kind = classify(entry);
      kinds.add(kind);
      expect(kind, `${entry.file} initiates a download of an unclassifiable kind`).not.toBe(
        "neither",
      );

      // Every download names its own filename. The real code assigns a *variable* —
      // `anchor.download = filename` inside a `downloadJson(filename, contents)` helper —
      // so asserting the assigned value is a `.json` literal was asserting something the
      // code does not do, and the first version of this check failed on it. What matters is
      // that no download is *named* like media by the client.
      //
      // Both spellings are collected, because the filter above admits both: a declarative JSX
      // attribute that names the file no more than a property assignment does. Collecting only
      // `.download =` would have meant a file using the declarative form entered the sweep and
      // then failed "must name the file it offers" — a check contradicting the check that let it
      // in, which is worse than either being consistent.
      const assigned = downloadNamesOffered(entry.code);
      expect(assigned.length, `${entry.file} must name the file it offers`).toBeGreaterThan(0);
      for (const value of assigned) {
        expect(value, `${entry.file}: ${value}`).not.toMatch(
          /\.(mp3|m4a|aac|opus|ogg|flac|wav|webm|mp4|mkv)\b/i,
        );
      }

      // A backup's blob is textual, and the check says so positively rather than only ruling out
      // media. The first version rejected `audio/*` and `video/*` and nothing else, which meant
      // a download named `track` with `application/octet-stream` — carrying audio — satisfied
      // it. A check that only excludes what it thought of is not a positive check.
      if (kind === "backup") {
        const types = [...entry.code.matchAll(/type:\s*"([^"]+)"/g)].map((m) => m[1]);
        for (const type of types) {
          expect(
            type,
            `${entry.file} offers "${type}"; only a textual backup may be named that way`,
          ).toMatch(/^application\/(json|.*\+json)$|^text\//);
        }
      }

      // And for the approved media download, two positive obligations rather than one negative
      // one. The first — it reads `content-disposition` — is what classified it, so asserting it
      // again here would be a tautology; the second is not.
      if (kind === "media") {
        // The name must reach the anchor as a *variable*, so the only place an extension can
        // enter this module is the server's header. An earlier shape of this check allowed
        // `anchor.download = "track.mp3"` because it only forbade the extension on the right-hand
        // side of the assignment; requiring the assignment to be a bare identifier closes that.
        expect(
          entry.code,
          `${entry.file} initiates a media download, so it must derive the filename from the server`,
        ).toMatch(/filenameFrom\s*\(|content-disposition/i);
        // And no media extension literal anywhere in the file — not in a comment-driven branch,
        // not in a fallback, not in a test helper that got copied in. `container.ts` is the one
        // place entitled to those literals, and it is server-side.
        expect(
          entry.code,
          `${entry.file} is client-side and must not contain a media extension literal`,
        ).not.toMatch(/\.(?:mp3|m4a|aac|opus|ogg|flac|wav|webm)\b/i);
      }

      // No `<a download>` in markup points at a remote origin, which would be a
      // download the application did not produce.
      expect(entry.code, `${entry.file}`).not.toMatch(
        /download\s*=\s*["']true["'][^>]*href=["']https?:/,
      );
    }

    // Neither class may be vacuous. A repository that stopped exporting backups would make the
    // backup branch untested; a repository that had never shipped the download route would make
    // the media branch untested. Both are silent failures otherwise.
    expect(kinds, "the backup download must still be classified as one").toContain("backup");
    expect(kinds, "the approved media download must be classified as one").toContain("media");
  });

  it("can still see a declarative download, and can still tell a local variable from one", () => {
    // The filter is what makes the properties above claims about *this* codebase rather than about
    // whichever subset of it a regex happened to match. A filter is not a detector — nothing fails
    // when it is too narrow — so it needs its own table, in both directions: it must find the
    // shapes that are downloads, must not sweep in a file that merely has a variable named
    // `download`, and must not have narrowed so far that the second property is unenforced.
    //
    // Every row states what the *previous* filter did, because "the new one is right" and "the old
    // one was wrong" are different claims and only the second justifies the change.
    const cases: ReadonlyArray<{
      label: string;
      code: string;
      initiated: boolean;
      initiatedBefore: boolean;
      honestName: boolean;
    }> = [
      {
        label: "the approved shape: a variable the server named",
        code: [
          'const anchor = document.createElement("a");',
          "anchor.download = filename;",
          "anchor.click();",
        ].join("\n"),
        initiated: true,
        initiatedBefore: true,
        honestName: true,
      },
      {
        label: "the approved declarative shape: a variable the server named",
        code: [
          "export function Save({ url, filename }: { url: string; filename: string }) {",
          "  return <a download={filename} href={url}>Save</a>;",
          "}",
        ].join("\n"),
        // Found now, missed before — this row is the whole reason the filter changed.
        initiated: true,
        initiatedBefore: false,
        honestName: true,
      },
      {
        label: "a declarative attribute naming an MP3",
        code: [
          "export function Save({ url, title }: { url: string; title: string }) {",
          "  return <a download={`${title}.mp3`} href={url}>Save</a>;",
          "}",
        ].join("\n"),
        initiated: true,
        initiatedBefore: false,
        // And the offered name is caught as dishonest. The brace capture has to reach the
        // extension: `${title}` contains a `}`, so a capture that stopped at the first one would
        // read `` `${title ``, see no extension, and pass this shape.
        honestName: false,
      },
      {
        label: "not a download: an ordinary local variable named download",
        code: [
          "export function useThing() {",
          "  const download = useCallback(async () => {});",
          "  return download;",
          "}",
        ].join("\n"),
        // The shape that broke the over-broad `\bdownload\s*=` attempt, and the reason the filter
        // locates the attribute instead of the word.
        initiated: false,
        initiatedBefore: false,
        honestName: true,
      },
      {
        label: "not a download: a prop named onDownload",
        code: [
          "export function Row({ onDownload }: { onDownload: () => void }) {",
          "  return <button onClick={onDownload}>Save</button>;",
          "}",
        ].join("\n"),
        initiated: false,
        initiatedBefore: false,
        honestName: true,
      },
    ];

    for (const testCase of cases) {
      expect(
        DOWNLOAD_INITIATION.test(testCase.code),
        `${testCase.label}: must${testCase.initiated ? "" : " not"} count as initiating a download`,
      ).toBe(testCase.initiated);
      expect(
        DOWNLOAD_INITIATION_BEFORE.test(testCase.code),
        `${testCase.label}: the filter this change replaced${testCase.initiatedBefore ? " found" : " missed"} it`,
      ).toBe(testCase.initiatedBefore);

      const names = downloadNamesOffered(testCase.code);
      if (!testCase.initiated) {
        // Deliberately not asserted to be empty. `downloadNamesOffered` is only ever consulted for a
        // file the filter has *already* identified as initiating a download, and it over-reads on
        // purpose: run against `const download = useCallback(async () => {})` it reports the
        // fragment `useCallback(async () =`, which is nonsense. Asserting that an uninitiated file
        // offers no filename would demand the helper be precise about a distinction it has no reason
        // to draw, and precision in the wrong direction — stopping at the first `>`, or requiring a
        // tag — is how the extension in `<a download={`${title}.mp3`}>` went missing in the first
        // place.
        continue;
      }
      expect(names.length, `${testCase.label}: must name the file it offers`).toBeGreaterThan(0);
      for (const name of names) {
        expect(
          /\.(mp3|m4a|aac|opus|ogg|flac|wav|webm|mp4|mkv)\b/i.test(name),
          `${testCase.label}: offers "${name}"`,
        ).toBe(!testCase.honestName);
      }
    }
  });

  it("classifies the two known initiations correctly, so the classifier can be wrong", () => {
    // The classifier is two lines of regex, and a two-line regex that cannot be wrong is a
    // two-line regex that will be. Both known initiations are named here.
    const byFile = new Map(applicationSources().map((entry) => [entry.file, entry]));
    const backup = byFile.get("src/features/backup/DataControls.tsx");
    expect(backup, "the backup export must still be where this suite expects it").toBeDefined();
    expect(classify(backup!)).toBe("backup");

    const media = byFile.get("src/features/download/saveFile.ts");
    expect(media, "the download feature must still be where this suite expects it").toBeDefined();
    expect(classify(media!)).toBe("media");
  });
});

describe("the exclusions hold in the dependency manifest and the shipped configuration (M15 task 1.1)", () => {
  /**
   * Runtime dependencies that exist to serve a permanent exclusion, each with the clause that
   * would forbid it if the roadmap had not approved it.
   *
   * M20 added the one entry. This is not a licence: it is a record of *which* exclusion was
   * traded away and by which document, so that the next person adding a downloader has to add a
   * row here — and a reviewer can see the trade rather than infer it from a package name.
   */
  const APPROVED_EXCLUSION_DEPENDENCIES: Record<string, string> = {
    "@distube/ytdl-core":
      "ROADMAP §18 (2026-10-03) reverses §2.5 clause 3; §21.5 names this package as the primary extractor.",
  };

  it("declares no dependency that holds user data off the device", () => {
    const manifest = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    };
    const dependencyExclusion = EXCLUSIONS[2];
    const offenders = Object.keys(declared)
      .filter((name) => name in APPROVED_EXCLUSION_DEPENDENCIES === false)
      .filter((name) => dependencyExclusion.pattern.test(`"${name}"`));
    expect(offenders, "a permanent exclusion may not enter as a dependency").toEqual([]);
  });

  it("declares no downloader except the one the roadmap names", () => {
    // Split out of the check above because that check cannot do this job: `EXCLUSIONS[2]` is the
    // *cloud user database* detector, and it has never contained a downloader name. Its test
    // claimed "no database, auth, downloader, or ad-blocking dependency" and only ever enforced
    // the first — a test whose name promised more than its body, which is the failure mode this
    // suite exists to prevent. M20 is the moment that became dangerous rather than merely
    // untidy, because a downloader is now legitimately present and the unsound check would have
    // let any *second* one in silently.
    const manifest = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    };
    // The unapproved-downloader vocabulary, taken from the `no MP3 faking` detector and then
    // *widened*: that detector also carries extraction-technique clauses (`streamingData`,
    // `player_ias`) which have nothing to do with a package name and would match nothing here.
    const DOWNLOADER =
      /\b(?:ytdl|youtube-dl|youtube-dl-exec|yt-dlp|yt_dlp|yt-dlp_|streamlink|audiodl)\b/i;
    const offenders = Object.keys(declared)
      .filter((name) => name in APPROVED_EXCLUSION_DEPENDENCIES === false)
      .filter((name) => DOWNLOADER.test(name));
    expect(offenders, "only the downloader ROADMAP §21.5 names may be declared").toEqual([]);
    // …and that one is genuinely declared, so the exclusion above is not satisfied by the
    // package having been renamed.
    expect(Object.keys(manifest.dependencies ?? {})).toContain("@distube/ytdl-core");
  });

  it("depends on nothing it cannot account for", () => {
    // A second, independent angle on the same exclusion: rather than pattern-matching a
    // vendor name, assert that every runtime dependency is one this project can account
    // for. A new runtime dependency is a decision someone made; this makes it visible.
    //
    // `@distube/ytdl-core` joined this list in M20. It is server-only by construction — the
    // only module that imports it does so with a dynamic `import()` inside a route handler, so
    // it never enters a client chunk — and `tests/download-non-goals.test.ts` asserts that. It is
    // listed here rather than in the dev-only tier because it *is* production code; it is the
    // one runtime dependency whose absence would break a shipped feature rather than a build.
    const manifest = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const runtime = Object.keys(manifest.dependencies ?? {}).sort();
    expect(runtime).toEqual([
      "@distube/ytdl-core",
      "lucide-react",
      "next",
      "react",
      "react-dom",
      "zod",
      "zustand",
    ]);
  });

  it("records the roadmap clause behind every exclusion-serving dependency", () => {
    // A guard on the table above: an entry with no citation would let anyone approve a
    // dependency by typing its name.
    for (const [name, citation] of Object.entries(APPROVED_EXCLUSION_DEPENDENCIES)) {
      expect(name.trim(), "an entry must name a package").not.toBe("");
      expect(citation, `${name} must cite the roadmap clause that approved it`).toMatch(
        /ROADMAP §\d+(?:\.\d+)?/,
      );
    }
  });
});

describe("every clause this change removed is published, not quietly dropped", () => {
  // M20's `specs/release-validation/spec.md` requires it, and independent review found it was not
  // actually true: `player.js` had been removed from `no MP3 faking` and appeared in no removal
  // table. Nothing caught it, because that clause's own fixture still fires on `player_ias`,
  // `\/base\.js` and `new Function(` — three neighbouring clauses that all survived.
  //
  // So the guarantee is made checkable rather than asserted in prose. Each entry is a clause that
  // M20 removed from a permanent detector. Removing the entry from this list is a deliberate act
  // that shows up in the diff; removing the clause without publishing it fails here instead.
  //
  // This is a list of *fingerprints*, not of prose, so a reworded row still satisfies it and a
  // deleted row does not.
  //
  // Publishing a removal is only half of it, and the other half is the half the first version did
  // not have. The original entries were a fingerprint and a sentence of justification, so the table
  // proved only that the *document* mentioned a clause — never that the clause actually left the
  // pattern. A row could name a clause, the clause could still be sitting in `no MP3 faking`, and
  // every test would pass. Which is exactly the failure it was written to prevent, one layer up.
  //
  // So each entry now also carries a `sample` — a snippet the removed clause used to catch — and a
  // `survivesIn`. `null` means the clause is genuinely gone from every live pattern and the sample
  // must match none of them. A label means the clause was *moved*, not removed, and the named
  // detector must still catch it. That second direction is what makes "moved, not removed" true
  // rather than aspirational: without it, the clause could vanish from the whole suite and the
  // publication check would still pass.
  //
  // The assignments were not reasoned out — they were read off a diagnostic run over the live
  // patterns, and that run is what this replaced. See the git history for `REMOVED-TERM-PROBE`.
  interface RemovedClause {
    /** The alternation, as published in `exclusions-diff.md`. */
    readonly fingerprint: string;
    /** Why the clause was removed. */
    readonly why: string;
    /** A snippet the removed clause used to catch. */
    readonly sample: string;
    /** The detector the clause moved to, or `null` when it is gone from all of them. */
    readonly survivesIn: string | null;
  }

  const REMOVED_CLAUSES: ReadonlyArray<RemovedClause> = [
    {
      fingerprint: String.raw`\bytdl\b|\bytdl-core\b`,
      why: "the roadmap names @distube/ytdl-core, so forbidding the package name forbade a required dependency",
      sample: `import ytdl from "@distube/ytdl-core";`,
      survivesIn: null,
    },
    {
      fingerprint: String.raw`\badaptiveFormats\b`,
      why: "the approved Invidious fallback must read this documented field",
      sample: `const formats = data.adaptiveFormats;`,
      survivesIn: null,
    },
    {
      fingerprint:
        "downloadAudio|downloadTrack|downloadVideo|extractAudio|audioExtract|extractAudioBuffer",
      why: "the approved feature has functions by these names",
      sample:
        'export async function downloadAudio(track: Track) {\n  return { kind: "audio", url: "https://x" };\n}',
      survivesIn: null,
    },
    {
      fingerprint: "audio/",
      why: "container.ts must be able to say audio/webm and audio/mpeg",
      sample: `const type = "audio/webm";`,
      survivesIn: null,
    },
    {
      fingerprint: "m4a|mp3|opus|flac|aac|webm",
      why: "container.ts holds these extensions as data",
      sample: `const ext = "m4a";`,
      survivesIn: null,
    },
    {
      fingerprint:
        "captureStream|getAudioTracks|MediaRecorder|MediaElementAudioSourceNode|createMediaElementSource",
      why: "moved, not removed: these are clause 2's evidence and have their own detector",
      sample:
        "const s = media.captureStream();\nconst ctx = new AudioContext();\nconst src = ctx.createMediaElementSource(el);",
      survivesIn: "no media cached for offline playback",
    },
    {
      fingerprint: "getAudioData",
      why: "moved, not removed, same reason",
      // Precisely `getAudioData`, with no `captureStream` alongside it — otherwise the sample would
      // also trip the neighbouring arm and the row would keep passing after `getAudioData` itself
      // had been dropped. A sample that exercises two clauses at once cannot tell you which one is
      // missing, which is the same mistake as calibrating a detector on one observed failure.
      sample: "const chunks = stream.getAudioData();",
      survivesIn: "no media cached for offline playback",
    },
    {
      fingerprint: String.raw`player\.js`,
      why: "found by independent review: removed and published nowhere. Redundant rather than wrong — a hand-rolled manifest reader still trips player_ias, /base.js and new Function(.",
      sample: `const player = await fetch("/player.js").then((r) => r.json());`,
      survivesIn: null,
    },
  ];

  const diffPath = join(
    FRONTEND,
    "..",
    "openspec",
    "changes",
    "add-m20-personal-use-downloading",
    "evidence",
    "exclusions-diff.md",
  );
  const diff = readFileSync(diffPath, "utf8");
  // A Markdown table cell has to escape `|` as `\|`, so every regex alternation in the document is
  // written with a backslash before the pipe. That is a rendering requirement, not a difference in
  // content, so it is undone before matching — otherwise this test would be asserting on Markdown
  // escaping rather than on whether a clause was published.
  const normalized = diff.replace(/\\\|/g, "|");

  it.each(REMOVED_CLAUSES)("publishes the removal of $fingerprint", ({ fingerprint, why }) => {
    expect(
      normalized.includes(fingerprint),
      `the removal table must name this clause: ${fingerprint} (${why})`,
    ).toBe(true);
  });

  it.each(REMOVED_CLAUSES.filter((clause) => clause.survivesIn === null))(
    "no live pattern still catches what $fingerprint used to catch",
    ({ fingerprint, why, sample }) => {
      const catching = EXCLUSIONS.filter((exclusion) => exclusion.pattern.test(sample)).map(
        (exclusion) => exclusion.label,
      );
      expect(
        catching,
        `the removal table says ${fingerprint} left the detectors (${why}), but ${catching.join(", ")} still catches:\n${sample}`,
      ).toHaveLength(0);
    },
  );

  it.each(REMOVED_CLAUSES.filter((clause) => clause.survivesIn !== null))(
    "$fingerprint moved to $survivesIn, and that detector still catches it",
    ({ fingerprint, why, sample, survivesIn }) => {
      const moved = EXCLUSIONS.find((exclusion) => exclusion.label === survivesIn);
      // A label that names no detector is worse than no label: the row would read as evidence while
      // checking nothing. So its existence is asserted before its behaviour.
      expect(
        moved,
        `the removal table claims ${fingerprint} moved to "${survivesIn}", which is not a detector (${why})`,
      ).toBeDefined();
      expect(
        moved!.pattern.test(sample),
        `"moved, not removed" is not a removal: ${survivesIn} no longer catches what ${fingerprint} used to catch (${why})\n${sample}`,
      ).toBe(true);
    },
  );

  it("records the correction rather than leaving the earlier, stronger claim standing", () => {
    // The table first described the media-extension clause as "replaced by a stronger, positive
    // rule". That was false for a client-side `<a download="….mp3">`, and the false claim was left
    // in place until review caught it. A correction that does not survive in the document is not a
    // correction.
    expect(diff).toMatch(/stronger\*?\*? positive rule|Correction \(independent review\)/);
    expect(diff).toMatch(/Correction \(independent review\)/);
  });

  it("cites only test files that exist", () => {
    // The table cited `tests/download-format-honesty.test.ts` three times. No such file was ever
    // written — the real one is `download-container.test.ts` — so a reader following the pointer to
    // the evidence for the honesty rule found nothing.
    const cited = [...diff.matchAll(/`?(?:tests\/)?([a-z0-9-]+\.test\.tsx?)`?/g)].map((m) => m[1]);
    expect(cited.length, "the table must cite the tests that carry the evidence").toBeGreaterThan(
      0,
    );
    for (const name of cited) {
      expect(
        existsSync(join(FRONTEND, "tests", name)),
        `the table cites tests/${name}, which does not exist`,
      ).toBe(true);
    }
  });
});
