#!/usr/bin/env node
// The M19 client-bundle measurement (spec `performance` — "A motion budget holds
// the client bundle"; tasks 5.1–5.3).
//
// Motion in this application is CSS, so it must cost no JavaScript. That claim is
// only worth something if it is a number measured the way a CDN serves the bytes,
// and this is where the number comes from.
//
// **Why the emitted chunks and not the build log.** `next build` under Turbopack
// prints the route table with **no size columns at all**, so there is nothing in its
// output to read. The measurement is therefore taken from what the build actually
// wrote: every `.js` chunk under `.next/static/chunks`, gzipped at level 9 —
// maximum compression, which is what a CDN applies before it serves a file.
//
// **Why per-route is measured from the prerendered HTML.** The first-load figure for
// a route is the set of chunks that route's own HTML asks for, read from the
// `<script src>` attributes of the emitted document. That is exactly what a first
// visit downloads, and it is why a chunk shared by several routes is counted once
// *per route*: each visit pays for it, so summing routes or deduplicating across
// routes would both understate what a listener downloads.
//
//   node scripts/measure-client-bundle.mjs
//
// Node built-ins only. Read-only: it reads a build, it never writes one.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

/** Gzip level. 9 is what a CDN applies, and the number has to mean something. */
const GZIP_LEVEL = 9;

/**
 * M19's own record, preserved rather than overwritten.
 *
 * Measured 2026-10-03, Windows, Node 24.21.0, `next build` (Next.js 16.3.6, Turbopack),
 * before any M19 change: 24 emitted chunks, 384,831 bytes gzipped in total, largest
 * single chunk 96,644, `/` first load 227,266 across 12 chunks.
 *
 * It is kept as its own exported constant because M20 re-recorded the ceiling, and a
 * ceiling that silently replaced its predecessor erases the only evidence that the number
 * ever moved. A reviewer asking "what did this cost?" now has both records and the delta
 * between them rather than one number and a commit message.
 */
export const PRE_M19_CLIENT_BUDGET = Object.freeze({
  totalGzippedBytes: 384831,
  largestChunkGzippedBytes: 96644,
  chunkCount: 24,
  homeFirstLoadGzippedBytes: 227266,
  homeFirstLoadChunkCount: 12,
});

/**
 * M20's record, preserved rather than overwritten.
 *
 * Measured 2026-10-03, Windows, Node 24.21.0, `next build` (Next.js 16.3.6, Turbopack),
 * after personal-use media downloading: 25 emitted chunks, 387,992 bytes gzipped in
 * total, largest single chunk 96,667, `/` first load 230,555 across 13 chunks.
 *
 * Kept for the same reason {@link PRE_M19_CLIENT_BUDGET} is: M22 re-recorded the
 * ceiling, and a ceiling that silently replaced its predecessor would erase the only
 * evidence the number ever moved twice. A reviewer asking "what did this cost?" now has
 * three records and the deltas between them.
 */
export const M20_CLIENT_BUDGET = Object.freeze({
  totalGzippedBytes: 387992,
  largestChunkGzippedBytes: 96667,
  chunkCount: 25,
  homeFirstLoadGzippedBytes: 230555,
  homeFirstLoadChunkCount: 13,
});

/**
 * The recorded ceiling, re-measured after M22 (Quick Picks cold start).
 *
 * Same toolchain and method as both records above: 2026-10-05, Windows, Node 24.21.0,
 * `next build` (Next.js 16.3.6, Turbopack), clean `.next`. Reproduce with
 * `node scripts/measure-client-bundle.mjs`.
 *
 * **The `main` control, measured the same way.** `main` at `0401573` on a clean build
 * reproduced M20's record **byte for byte** — 25 chunks, 387,992 B, largest 96,667, `/`
 * 230,555 across 13 — so the figures below are attributable to M22's own change and not
 * to build drift on this machine. That control is the only reason this re-record is a
 * measurement rather than an assumption.
 *
 * **What moved, and what it cost.** The total grew by 1,572 bytes gzipped (387,992 ->
 * 389,564), the largest chunk did not move at all (96,667), and the emitted and `/`-
 * first-load chunk counts by one each (25 -> 26, 13 -> 14). All of it is first-party
 * code: the Quick Picks stand-in pass and its two shared helpers in
 * `src/features/home/quickPicks.ts`. **No dependency was added to the client at all**, and
 * no new import edge reached the client graph.
 *
 * **What was measured about the extra chunk, and what was not.** Two probes, both on clean
 * builds. Reverting `HomeView`'s wiring — so that nothing passes `providerTracks` at all and
 * the new path is unreachable — still emitted 26 chunks and 389,564 B, so the split is
 * caused by the code being *present*, not by the new behaviour being reachable. Replacing
 * the one added `import type { Track }` with a type alias borrowed from `LocalTaste`, to
 * drop the import edge, changed nothing at all: 26 chunks, 389,564 B, identical. The
 * mechanism behind Turbopack's decision is **not** established and is not claimed here.
 * Chasing it further would mean writing worse code — duplicating the artist and release
 * passes inline to nudge a chunk graph — so it was left, and is recorded as unattributed
 * rather than dressed up as understood.
 *
 * That is the distinction the ceiling exists to draw. The whole reason this file exists is
 * that M19 declined `framer-motion`, which measured **+41.4 kB** — more than ten times
 * the 4,096-byte headroom, and it cost *one* chunk, the same shape as this. What separates
 * them is size and origin, not chunk count: M22's move is 1,572 bytes of the project's own
 * source, inside the tolerance the *first* record already allowed, and `framer-motion` is
 * 26 times larger than the whole of that tolerance. Re-recording does not weaken the
 * budget: `totalGzippedBytes` keeps its 4,096-byte tolerance on top of the new figure, so a
 * library still cannot hide inside it.
 *
 * These are bytes, not "kB", so the assertion cannot move when someone rounds.
 */
export const CLIENT_BUDGET = Object.freeze({
  /** What the ceiling is a ceiling *of*. */
  subject: "gzipped bytes of every emitted client chunk under .next/static/chunks",
  /** The route the per-route figure was measured on. */
  route: "/",
  /** The interpreter and framework that produced the build being compared against. */
  toolchain: "Node 24.21.0 / Next.js 16.3.6 (Turbopack) / gzip level 9",
  /** How the figure was taken, so a reader can reproduce it rather than trust it. */
  method:
    "every .js file under .next/static/chunks, gzipped at level 9; per-route, the <script src> set of the route's emitted .next/server/app HTML",
  /** When and after what this figure was measured, so a drift has something to be compared to. */
  recordedAt: "2026-10-05, after M22 (Quick Picks cold start)",
  totalGzippedBytes: 389564,
  largestChunkGzippedBytes: 96667,
  chunkCount: 26,
  homeFirstLoadGzippedBytes: 232127,
  homeFirstLoadChunkCount: 14,
  /**
   * How far a rebuild may drift from the recorded figure.
   *
   * Not zero, and not "no ceiling": the recorded figure came from one build on one
   * machine, and a Next.js patch can rename a chunk without changing a byte of
   * behaviour. The number exists to catch a *dependency* appearing, and the cheapest
   * such dependency in this ecosystem is far larger than the slack below.
   */
  toleranceBytes: 4096,
});

/** Every file under a directory, recursively. */
function walk(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}

/** One file's gzipped size, at the level a CDN would use. */
export function gzippedBytes(file) {
  return gzipSync(readFileSync(file), { level: GZIP_LEVEL }).length;
}

/**
 * The emitted client chunks, measured.
 *
 * Total is every chunk, largest is the single biggest one, and `perChunk` keeps the
 * individual figures so a test can name which file grew.
 */
export function measureClientBundle(root = process.cwd()) {
  const chunksDir = join(root, ".next", "static", "chunks");
  if (!existsSync(chunksDir)) {
    throw new Error(
      `no build to measure: ${chunksDir} does not exist. Run \`npm run build\` first — the budget is a measurement, not an estimate.`,
    );
  }
  const files = walk(chunksDir)
    .filter((file) => file.endsWith(".js"))
    .sort();
  const perChunk = files.map((file) => ({
    file: relative(chunksDir, file).split(sep).join("/"),
    gzippedBytes: gzippedBytes(file),
  }));
  const totalGzippedBytes = perChunk.reduce((sum, chunk) => sum + chunk.gzippedBytes, 0);
  const largest = perChunk.reduce((max, chunk) => Math.max(max, chunk.gzippedBytes), 0);
  return {
    totalGzippedBytes,
    largestChunkGzippedBytes: largest,
    chunkCount: perChunk.length,
    perChunk,
  };
}

/** The prerendered document a route's build emits, by its directory name. */
function routeDocument(root, document) {
  return join(root, ".next", "server", "app", document);
}

/**
 * The chunks one route's first visit loads.
 *
 * Read from the emitted HTML's `<script src>` attributes, deduplicated **within the
 * route only**: two routes that load the same shared chunk each pay for it, so the
 * chunk appears in both routes' totals and is never subtracted from either.
 */
export function measureRouteFirstLoad(root = process.cwd(), document = "page.html") {
  const file = routeDocument(root, document);
  if (!existsSync(file)) throw new Error(`no emitted document for this route: ${file}`);
  const html = readFileSync(file, "utf8");
  const referenced = new Set();
  for (const match of html.matchAll(/\/_next\/(static\/chunks\/[^"'\\\s]+\.js)/g)) {
    referenced.add(join(root, ".next", match[1]));
  }
  const perChunk = [...referenced].sort().map((chunk) => ({
    file: relative(join(root, ".next"), chunk).split(sep).join("/"),
    gzippedBytes: statSync(chunk).isFile() ? gzippedBytes(chunk) : 0,
  }));
  return {
    document,
    totalGzippedBytes: perChunk.reduce((sum, chunk) => sum + chunk.gzippedBytes, 0),
    chunkCount: perChunk.length,
    perChunk,
  };
}

/** Every route document this build emitted, so a per-route figure can be compared. */
export function routeFirstLoads(root = process.cwd()) {
  const appDir = join(root, ".next", "server", "app");
  const documents = walk(appDir)
    .filter((file) => file.endsWith(".html"))
    .map((file) => relative(appDir, file).split(sep).join("/"))
    .sort();
  return documents.map((document) => ({
    route: "/" + document.replace(/(^|\/)index\.html$/, "$1").replace(/\.html$/, ""),
    ...measureRouteFirstLoad(root, document),
  }));
}

/**
 * `CLIENT_BUDGET` with the per-route figure filled in from the measurement above.
 *
 * Kept as a separate exported constant so the recorded numbers stay literal — a
 * budget that recomputes its own ceiling from the build it is judging is not a
 * budget.
 */
export const RECORDED_BASELINE = CLIENT_BUDGET;

if (process.argv[1] && process.argv[1].endsWith("measure-client-bundle.mjs")) {
  const root = process.cwd();
  const client = measureClientBundle(root);
  const kib = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
  console.log("");
  console.log(`  toolchain                ${CLIENT_BUDGET.toolchain}`);
  console.log(`  subject                  ${CLIENT_BUDGET.subject}`);
  console.log(`  client chunks            ${client.chunkCount}`);
  console.log(
    `  client total (gzip 9)    ${client.totalGzippedBytes} B  (${kib(client.totalGzippedBytes)})`,
  );
  console.log(
    `  largest chunk            ${client.largestChunkGzippedBytes} B  (${kib(client.largestChunkGzippedBytes)})`,
  );
  console.log("");
  console.log("  per-route first load (a shared chunk is counted in every route that loads it)");
  for (const route of routeFirstLoads(root)) {
    console.log(
      `  ${route.route.padEnd(28)} ${String(route.chunkCount).padStart(3)} chunks  ` +
        `${String(route.totalGzippedBytes).padStart(7)} B  (${kib(route.totalGzippedBytes)})`,
    );
  }
  console.log("");
}
