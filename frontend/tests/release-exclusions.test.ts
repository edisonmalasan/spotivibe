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
    // The second pass found two more shapes that passed: a scraped `googlevideo` URL
    // written to a `.m4a` file, and a downloaded player bundle executed through
    // `new Function` to reverse a signature. The first is the *outcome* — a media file on
    // disk — and the second is the *technique* — running a script you fetched. Both are
    // matched as shapes now, because neither has a vendor word in it.
    pattern:
      /\b(ytdl|ytdl-core|youtube-dl|youtube-dl-exec|yt-dlp|yt_dlp|yt-dlp_|streamlink|ffmpeg(?:\.exe)?|fluent-ffmpeg|audiodl|downloadAudio|downloadTrack|downloadVideo|extractAudio|audioExtract|extractAudioBuffer|streamingData|adaptiveFormats|signatureCipher|player\.js|decipherFunction|n-parameter)\b|audio\/(?:mpeg|mp4|ogg|opus|flac|wav|x-m4a|aac)|videotube|\.getAudioData\(|captureStream\s*\(|getAudioTracks|MediaRecorder|MediaElementAudioSourceNode|createMediaElementSource\([^)]*\)\s*\.connect\(\s*(?!destination)|\.(?:m4a|mp3|opus|flac|aac|webm)\b|["'`][^"'`]*\.(?:m4a|mp3|opus|flac|aac)\b|googlevideo\.com[^"'`]*\.(?:m4a|mp3|opus)|new\s+Function\s*\(|player_ias|\/base\.js|writeFile\w*\([^)]*\.m4a/i,
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

  it("also reads file paths, because a route's name lives in its path", () => {
    // The second verification pass's probe was a route at
    // `app/api/v2/library/synchronize/route.ts` — and no content scan can see it, because
    // the body of that file is an ordinary handler. The exclusion was unenforceable for the
    // one shape where the evidence is the *name*, which is the shape a route always takes.
    //
    // A positive sweep over paths, rather than another keyword: no route may sit at a path
    // whose segments name a forbidden capability.
    const FORBIDDEN_SEGMENTS =
      /\/(?:sync|synchroni[sz]e|replicate|mirror|proxy|stream|relay|tunnel|upload|download)(?:\/|$)|\/(?:auth|login|signin|sign-in|register|account|oauth|session)(?:\/|$)|\/admin(?:\/|$)/i;

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
    const FORBIDDEN_SEGMENTS =
      /\/(?:sync|synchroni[sz]e|replicate|mirror|proxy|stream|relay|tunnel|upload|download)(?:\/|$)|\/(?:auth|login|signin|sign-in|register|account|oauth|session)(?:\/|$)|\/admin(?:\/|$)/i;
    for (const path of [
      "src/app/api/v2/library/synchronize/route.ts",
      "src/app/api/sync/route.ts",
      "src/app/api/stream/route.ts",
      "src/app/api/proxy/route.ts",
      "src/app/api/auth/session/route.ts",
      "src/app/api/login/route.ts",
    ]) {
      expect(FORBIDDEN_SEGMENTS.test(`/${path}`), `${path} must be rejected`).toBe(true);
    }
    // And the routes the application legitimately ships must clear it, so the rule is not
    // "reject anything with a slash in it".
    for (const path of [
      "src/app/api/search/route.ts",
      "src/app/api/artist/route.ts",
      "src/app/api/album/route.ts",
      "src/app/api/discover/route.ts",
      "src/server/music/playlistRef.ts",
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
