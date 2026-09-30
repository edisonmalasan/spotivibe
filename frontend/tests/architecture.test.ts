import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import manifestRoute from "@/app/manifest";

/**
 * Static architecture invariants checked against the real source files
 * (M2 task 7.1 + M3 task 6.1 + M4 task 5.1 + M5 task 8.1 + M6 task 9.1 +
 * M7 task 9.1 + M8 task 8.1 + M9 task 7.1 + M10 task 6.1 + M11 task 6.1 +
 * M12 task 8.1 + M13 task 6.1) -
 * routes/components/features
 * depend on
 * repository interfaces (never the IndexedDB implementation), the data layer
 * stays server- and network-free, UI code never reaches into `src/server`
 * or names raw Innertube/provider-response shapes, the server layer never
 * imports IndexedDB, API routes never return media bytes, the
 * stored/backup datasets stay inside the whitelist, the video host stays a
 * single shell-mounted module, UI code never touches the IFrame API loader
 * or YT types directly, nothing can capture or decode media, outbound
 * links never suppress the referrer, the search feature stays
 * client-side and repository-mediated, and the queue/transport store split
 * keeps queue state free of transport dependencies; M7 layers every
 * playlist/like repository write inside `libraryStore`, keeps it off the
 * transport store, keeps library surfaces repository-mediated, and keeps the
 * server playlist module off the data layer; M8 keeps the discovery surfaces
 * repository-mediated, the client stores on the repository entry point and off
 * transport state, the server discovery modules off `@/data`, the discovery
 * route metadata-only with a four-parameter input surface, and
 * `lib/languages.ts` the single language catalog; M9 keeps the artist, album,
 * and related surfaces repository-mediated and off the player internals, the
 * server catalog module off `@/data`, and the three catalog routes
 * metadata-only with exactly their documented entity parameters; and M10 keeps
 * the personalization surfaces repository-mediated and off the player
 * internals, `server/music/radio.ts` off `@/data`, the radio route
 * metadata-only with exactly its six documented query keys, no personalization
 * weight reachable from a module that builds a request, and `radioStore` a
 * queue mode rather than a second player; and M12 keeps the podcast mode's
 * four seams honest - `category` is the search route's only added input and
 * carries no local data, a category-scoped filter rule is reachable only from
 * inside its own category's guard in the filter module, the category selects
 * tiers and upstream parameters but never a second provider capability, and the
 * curated podcast catalog resolves through the one language catalog and the one
 * preferences store while adding no podcast-specific local dataset; and M13 keeps
 * the service worker a self-contained classic script that names no application
 * layer, the PWA feature off the server layer, raw provider shapes and IndexedDB,
 * every PWA component client-only, the install affordance out of the dataset
 * whitelist, and the manifest a parameter-free static install surface.
 *
 * Each detector is first exercised against a violating snippet, so a broken
 * invariant fails this suite instead of slipping through unnoticed.
 */

// Keep the literal in a variable — Vite rewrites new URL("<literal>", import.meta.url).
const srcRel = "../src";
const srcDir = fileURLToPath(new URL(srcRel, import.meta.url));

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Directory reads, memoized per directory for the same reason as
 * {@link uiSourceFiles}: the coverage proofs read their own subtree inside every
 * assertion, and re-walking it each time is pure repeated I/O.
 */
const readTreeCache = new Map<string, Array<{ file: string; source: string }>>();

function readTree(dir: string): Array<{ file: string; source: string }> {
  const cached = readTreeCache.get(dir);
  if (cached) return cached;
  const files = walk(dir).map((file) => ({ file, source: readFileSync(file, "utf8") }));
  readTreeCache.set(dir, files);
  return files;
}

/** Every module specifier referenced by import/export statements. */
function moduleSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/from\s*["']([^"']+)["']/g),
    ...source.matchAll(/import\s+["']([^"']+)["']/g),
    ...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
}

/** True when a specifier reaches into the IndexedDB implementation package. */
function importsIndexedDbImplementation(specifier: string): boolean {
  return /(^|\/)data\/indexeddb(\/|$)/.test(specifier);
}

/** True when a specifier targets the server-only `src/server` package. */
function targetsServerModule(specifier: string): boolean {
  return specifier.startsWith("@/server") || /(^|\.\.\/)server(\/|$)/.test(specifier);
}

function hasDirectIndexedDbImport(source: string): boolean {
  return moduleSpecifiers(source).some(importsIndexedDbImplementation);
}

function hasServerReferenceOrFetch(source: string): boolean {
  return moduleSpecifiers(source).some(targetsServerModule) || /\bfetch\s*\(/.test(source);
}

/**
 * UI scope (task 6.1): pages, components, features, and stores — the API
 * route modules under src/app/api are transport code and legitimately
 * import `src/server`, so they are excluded from this sweep.
 */
/**
 * The swept UI files, read once per test process.
 *
 * Every rule in this file sweeps the same tree, and the M8/M9 coverage proofs call
 * the sweep again *inside* each assertion, so an un-memoized read re-reads the
 * whole `app`/`components`/`features`/`stores` tree dozens of times per file. That
 * made the suite's runtime depend on how many other workers were competing for the
 * disk, and an I/O-bound assertion then started tripping the default 5s timeout
 * intermittently — a flaky gate, observed in a clean-clone run of M9 task 8.4.
 *
 * The cache is safe because no test writes a source file: the coverage proofs
 * substitute violating content as in-memory `{ file, source }` objects rather than
 * editing the tree, so the cached reads cannot go stale mid-run. Assertions are
 * unchanged — only the repeated I/O is removed.
 */
let uiSourceFilesCache: Array<{ file: string; source: string }> | undefined;

function uiSourceFiles(): Array<{ file: string; source: string }> {
  uiSourceFilesCache ??= ["app", "components", "features", "stores"]
    .flatMap((dir) => readTree(join(srcDir, dir)))
    .filter(({ file }) => !/[\\/]api(?:[\\/][^\\/]+)*[\\/]route\.tsx?$/.test(file));
  return uiSourceFilesCache;
}

/**
 * Raw Innertube renderer/view-model keys and provider-response type names —
 * they may exist only inside `src/server`. Finding one in UI code means
 * un-normalized provider data leaked past the canonical `Track` boundary
 * (spec: normalized Track conversion; raw provider structures never reach
 * the client).
 */
function mentionsRawProviderShape(source: string): boolean {
  return (
    /\b\w+(?:Renderer|ViewModel)\b/.test(source) ||
    /\b(?:InvidiousVideo|PipedItem|MusicRun|MusicFlexColumn|TextRun|SimpleText)\b/.test(source)
  );
}

/** Indicators that an API route streams or proxies raw bytes instead of JSON. */
const MEDIA_BYTE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "byte-body read", pattern: /\.\s*arrayBuffer\s*\(/ },
  { label: "blob body", pattern: /\.\s*blob\s*\(/ },
  {
    label: "raw response body",
    pattern: /new\s+Response\s*\(\s*(?!null\b)/,
  },
  { label: "streamed body", pattern: /new\s+ReadableStream|\bpipeThrough\b|\bpipeTo\b/ },
  {
    label: "media MIME type",
    pattern: /\b(?:audio|video)\/[a-z0-9.+-]+|\bapplication\/octet-stream/i,
  },
];

function mediaByteIndicators(source: string): string[] {
  return MEDIA_BYTE_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
    ({ label }) => label,
  );
}

/** Top-level keys of an `export const <name> = { ... } as const;` block. */
function extractConstantKeys(source: string, constantName: string): string[] {
  const block = source.match(
    new RegExp(`export const ${constantName} = \\{([\\s\\S]*?)\\} as const;`),
  );
  if (!block) return [];
  return [...block[1].matchAll(/^\s*(\w+):\s*"([^"]+)"\s*,/gm)].map((match) => match[1]);
}

/** `name:` entries of STORE_DEFINITIONS, ignoring nested index definitions. */
function extractStoreDefinitionNames(source: string): string[] {
  const block = source.match(/export const STORE_DEFINITIONS[\s\S]*?\n\];/)?.[0] ?? "";
  const storesOnly = block.replace(/indexes:\s*\[[\s\S]*?\]/g, "");
  return [...storesOnly.matchAll(/name:\s*(?:STORE\.(\w+)|"(\w+)")/g)].map(
    (match) => match[1] ?? match[2],
  );
}

/** Dataset keys of the backup envelope's `data: z.strictObject({ ... })`. */
function extractBackupDatasetKeys(source: string): string[] {
  const block = source.match(/data:\s*z\.strictObject\(\{([\s\S]*?)\}\),/)?.[1] ?? "";
  return [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]);
}

/** Whitelists: the eight stores (ROADMAP §8/§13) and seven exportable datasets. */
const STORE_WHITELIST = [
  "likedTracks",
  "playlists",
  "listeningHistory",
  "searchHistory",
  "preferences",
  "session",
  "metadataCache",
  // M11: Smart Mixes — derived data, but persisted and exported because a mix is
  // a *named* record the listener recognizes.
  "mixes",
];
const BACKUP_WHITELIST = [
  "preferences",
  "likedTracks",
  "playlists",
  "history",
  "searchHistory",
  // M11: mixes travel as derived data so a recognized mix survives a round trip.
  "mixes",
  "session",
];

describe("architecture violation detectors", () => {
  it("flags direct IndexedDB implementation imports and passes interface imports", () => {
    expect(hasDirectIndexedDbImport('import { createRepositories } from "@/data/indexeddb";')).toBe(
      true,
    );
    expect(
      hasDirectIndexedDbImport('export type { RepositorySet } from "@/data/indexeddb/index";'),
    ).toBe(true);
    expect(
      hasDirectIndexedDbImport('const mod = await import("../../data/indexeddb/likedTracks");'),
    ).toBe(true);
    expect(hasDirectIndexedDbImport('import { getLocalData } from "@/data/localData";')).toBe(
      false,
    );
    expect(
      hasDirectIndexedDbImport('import type { Repositories } from "@/data/repositories";'),
    ).toBe(false);
  });

  it("flags server references and fetch calls but passes pure data-layer code", () => {
    expect(targetsServerModule("@/server/env")).toBe(true);
    expect(targetsServerModule("../server/env")).toBe(true);
    expect(targetsServerModule("@/data/backup/prepare")).toBe(false);
    expect(hasServerReferenceOrFetch('const res = await fetch("/api/search");')).toBe(true);
    expect(hasServerReferenceOrFetch("const res = await prefetchData();")).toBe(false);
    expect(hasServerReferenceOrFetch("export function load() { return readAll(); }")).toBe(false);
  });

  it("extracts an extra store or dataset so the whitelist comparison fails", () => {
    const rogueStore = `export const STORE = {\n  likedTracks: "likedTracks",\n  telemetry: "telemetry",\n} as const;`;
    expect(extractConstantKeys(rogueStore, "STORE")).toEqual(["likedTracks", "telemetry"]);
    expect([...extractConstantKeys(rogueStore, "STORE")].sort()).not.toEqual(
      [...STORE_WHITELIST].sort(),
    );

    const rogueDataset = `data: z.strictObject({\n  preferences: preferencesSchema,\n  telemetry: z.array(z.string()),\n}),`;
    expect(extractBackupDatasetKeys(rogueDataset)).toEqual(["preferences", "telemetry"]);
    expect([...extractBackupDatasetKeys(rogueDataset)].sort()).not.toEqual(
      [...BACKUP_WHITELIST].sort(),
    );
  });

  it("flags raw provider shape names but passes normalized UI code", () => {
    expect(mentionsRawProviderShape("const item: MusicResponsiveListItemRenderer = node;")).toBe(
      true,
    );
    expect(mentionsRawProviderShape('const key = "videoRenderer";')).toBe(true);
    expect(mentionsRawProviderShape("interface PipedItem { id: string }")).toBe(true);
    expect(mentionsRawProviderShape("interface TextRun { text?: string }")).toBe(true);
    expect(mentionsRawProviderShape("const tracks = useSearchStore((s) => s.tracks);")).toBe(false);
    expect(mentionsRawProviderShape("const rows = items.map((track) => renderRow(track));")).toBe(
      false,
    );
  });

  it("flags media-byte indicators but passes JSON-only route bodies", () => {
    expect(
      mediaByteIndicators(
        'return new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });',
      ),
    ).toContain("media MIME type");
    expect(mediaByteIndicators("const buf = await upstream.arrayBuffer();")).toContain(
      "byte-body read",
    );
    expect(mediaByteIndicators("const stream = new Response(webStream);")).toContain(
      "raw response body",
    );
    expect(mediaByteIndicators("const out = upstream.body.pipeThrough(transform);")).toContain(
      "streamed body",
    );
    expect(mediaByteIndicators("return Response.json({ tracks, diagnostics });")).toEqual([]);
    expect(mediaByteIndicators("return new Response(null, { status: 499 });")).toEqual([]);
  });

  it("scopes the UI sweep to non-route app code, components, features, and stores", () => {
    const files = uiSourceFiles().map(({ file }) => file);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => /[\\/]app[\\/]page\.tsx$/.test(file))).toBe(true);
    // The API route legitimately imports @/server; it must sit outside this sweep.
    expect(files.some((file) => /[\\/]api[\\/]search[\\/]route\.ts$/.test(file))).toBe(false);
    expect(existsSync(join(srcDir, "app", "api", "search", "route.ts"))).toBe(true);
  });
});

describe("architecture: routes and features use repository interfaces only", () => {
  it("contains no direct src/data/indexeddb imports in app, components, or features", () => {
    const offenders = ["app", "components", "features"]
      .flatMap((dir) => readTree(join(srcDir, dir)))
      .filter(({ source }) => hasDirectIndexedDbImport(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: the data layer is server- and network-free", () => {
  it("contains no src/server imports and no fetch calls under src/data", () => {
    const offenders = readTree(join(srcDir, "data"))
      .filter(({ source }) => hasServerReferenceOrFetch(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: datasets stay inside the whitelist", () => {
  it("declares exactly the whitelisted IndexedDB stores", () => {
    const schema = readFileSync(join(srcDir, "data", "indexeddb", "schema.ts"), "utf8");

    expect([...extractConstantKeys(schema, "STORE")].sort()).toEqual([...STORE_WHITELIST].sort());
    expect([...extractStoreDefinitionNames(schema)].sort()).toEqual([...STORE_WHITELIST].sort());
  });

  it("declares exactly the whitelisted backup datasets", () => {
    const schema = readFileSync(join(srcDir, "data", "backup", "schema.ts"), "utf8");

    expect([...extractBackupDatasetKeys(schema)].sort()).toEqual([...BACKUP_WHITELIST].sort());
  });
});

describe("architecture: UI never crosses into server or provider shapes (task 6.1)", () => {
  it("imports no src/server module from pages, components, features, or stores", () => {
    const offenders = uiSourceFiles()
      .filter(({ source }) => moduleSpecifiers(source).some(targetsServerModule))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("names no Innertube renderer or provider-response type in UI code", () => {
    const offenders = uiSourceFiles()
      .filter(({ source }) => mentionsRawProviderShape(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: the server layer stays off IndexedDB (task 6.1)", () => {
  it("imports no src/data/indexeddb module from src/server", () => {
    const serverFiles = readTree(join(srcDir, "server"));
    expect(serverFiles.length).toBeGreaterThan(0);

    const offenders = serverFiles
      .filter(({ source }) => hasDirectIndexedDbImport(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: API routes never return media bytes (task 6.1)", () => {
  it("finds no media-byte indicators in any src/app/api route", () => {
    const routes = readTree(join(srcDir, "app", "api")).filter(({ file }) =>
      /[\\/]route\.tsx?$/.test(file),
    );
    expect(routes.length).toBeGreaterThan(0);

    for (const { file, source } of routes) {
      expect(mediaByteIndicators(source), file).toEqual([]);
    }
  });
});

/**
 * Playback invariants (M4 task 5.1): the video host is imported only by the
 * shell, UI code depends on the store/engine interface instead of the IFrame
 * API loader or its YT types, no surface in the app can capture or decode
 * media (extraction stays prohibited), and outbound links/headers never
 * suppress the referrer (YouTube embedded-player policy compliance).
 */

/** True when a specifier reaches the IFrame API loader or its YT types. */
function targetsPlayerInternals(specifier: string): boolean {
  if (specifier.includes("/components/player/")) return false; // Spotivibe's own UI folder
  return /(^|\/)player\/(ytApi|types)(\.tsx?)?$/.test(specifier);
}

/** Indicators of audio/video capture or decode — extraction surfaces. */
const EXTRACTION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "MediaRecorder", pattern: /\bMediaRecorder\b/ },
  { label: "decodeAudioData", pattern: /\bdecodeAudioData\b/ },
  { label: "audio element", pattern: /<audio\b/ },
  { label: "video element", pattern: /<video\b/ },
];

function extractionIndicators(source: string): string[] {
  return EXTRACTION_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
    ({ label }) => label,
  );
}

/** True when source suppresses the referrer (link rel or policy header). */
function suppressesReferrer(source: string): boolean {
  return (
    /\bnoreferrer\b/i.test(source) ||
    /referrer[-_]?policy["']?\s*[:=]\s*["']?no-referrer/i.test(source)
  );
}

/** Next config files next to src — where a Referrer-Policy header would live. */
function frontendConfigFiles(): Array<{ file: string; source: string }> {
  const frontendDir = join(srcDir, "..");
  return readdirSync(frontendDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^next\.config\.(?:ts|js|mjs)$/.test(entry.name))
    .map((entry) => {
      const file = join(frontendDir, entry.name);
      return { file, source: readFileSync(file, "utf8") };
    });
}

describe("architecture violation detectors (task 5.1)", () => {
  it("flags IFrame loader/YT-type imports but passes the engine interface", () => {
    expect(targetsPlayerInternals("@/player/ytApi")).toBe(true);
    expect(targetsPlayerInternals("@/player/types")).toBe(true);
    expect(targetsPlayerInternals("../../player/ytApi")).toBe(true);
    expect(targetsPlayerInternals("@/player/engine")).toBe(false);
    expect(targetsPlayerInternals("@/components/player/PlayerHost")).toBe(false);
    expect(targetsPlayerInternals("@/stores/playerStore")).toBe(false);
  });

  it("flags capture/decode indicators but passes the iframe player surface", () => {
    expect(extractionIndicators("const rec = new MediaRecorder(stream);")).toContain(
      "MediaRecorder",
    );
    expect(extractionIndicators("const buf = await ctx.decodeAudioData(raw);")).toContain(
      "decodeAudioData",
    );
    expect(extractionIndicators("return <audio src={url} controls />;")).toContain("audio element");
    expect(extractionIndicators("return <video src={blob} />;")).toContain("video element");
    // The YouTube video ID shape and the IFrame embed are not media elements.
    expect(extractionIndicators('const id = "youtube:<videoId>";')).toEqual([]);
    expect(extractionIndicators('return <iframe src={embedUrl} allow="autoplay" />;')).toEqual([]);
  });

  it("flags referrer suppression but passes the compliant watch link", () => {
    expect(suppressesReferrer('<a rel="noopener noreferrer" href={url} />')).toBe(true);
    expect(suppressesReferrer('"Referrer-Policy": "no-referrer"')).toBe(true);
    expect(suppressesReferrer('referrerPolicy="no-referrer"')).toBe(true);
    expect(suppressesReferrer('<a rel="noopener" target="_blank" href={url} />')).toBe(false);
    expect(suppressesReferrer('referrerPolicy="origin"')).toBe(false);
  });
});

describe("architecture: single persistent player host (task 5.1)", () => {
  it("is imported only by the AppShell, which the root layout mounts", () => {
    const importers = readTree(srcDir)
      .filter(({ source }) =>
        moduleSpecifiers(source).some((spec) => spec === "@/components/player/PlayerHost"),
      )
      .map(({ file }) => file);

    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) {
      expect(/[\\/]components[\\/]layout[\\/]AppShell\.tsx$/.test(file), file).toBe(true);
    }

    const layout = readFileSync(join(srcDir, "app", "layout.tsx"), "utf8");
    expect(moduleSpecifiers(layout)).toContain("@/components/layout/AppShell");
    expect(layout).toMatch(/<AppShell>/);
  });

  it("keeps UI code off the IFrame API loader and raw YT types", () => {
    const offenders = uiSourceFiles()
      .filter(({ source }) => moduleSpecifiers(source).some(targetsPlayerInternals))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: no audio-extraction surfaces (task 5.1)", () => {
  it("finds no capture or decode indicators anywhere in src", () => {
    const offenders = readTree(srcDir)
      .filter(({ source }) => extractionIndicators(source).length > 0)
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

describe("architecture: outbound links never suppress the referrer (task 5.1)", () => {
  it("finds no noreferrer or no-referrer policy in src or the Next config", () => {
    const files = [...readTree(srcDir), ...frontendConfigFiles()];
    const offenders = files
      .filter(({ source }) => suppressesReferrer(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

/**
 * Search-feature invariants (M5 task 8.1): `features/search` is client-side
 * and repository-mediated — it imports no `src/server` module, names no raw
 * provider shape, and never reaches the IndexedDB implementation or the
 * `indexedDB` global (feature code reads local data through the repository
 * interfaces; `fake-indexeddb` belongs to tests only).
 */

/** True when a specifier loads the fake-indexeddb shim or source uses the global. */
function accessesIndexedDbGlobal(source: string): boolean {
  return (
    moduleSpecifiers(source).some((specifier) => specifier.startsWith("fake-indexeddb")) ||
    /\bindexedDB\b/.test(source)
  );
}

/** The rules `features/search` must satisfy (task 8.1), as violation labels. */
function searchArchitectureViolations(source: string): string[] {
  const violations: string[] = [];
  if (moduleSpecifiers(source).some(targetsServerModule)) violations.push("src/server import");
  if (mentionsRawProviderShape(source)) violations.push("raw provider shape");
  if (hasDirectIndexedDbImport(source)) violations.push("IndexedDB implementation import");
  if (accessesIndexedDbGlobal(source)) violations.push("indexedDB global access");
  return violations;
}

describe("architecture violation detectors (task 8.1)", () => {
  it("flags server imports, provider shapes, and IndexedDB access but passes repository-mediated code", () => {
    expect(
      searchArchitectureViolations('import { runSearch } from "@/server/music/search";'),
    ).toEqual(["src/server import"]);
    expect(
      searchArchitectureViolations("const node: MusicResponsiveListItemRenderer = input;"),
    ).toEqual(["raw provider shape"]);
    expect(
      searchArchitectureViolations('import { createRepositories } from "@/data/indexeddb";'),
    ).toEqual(["IndexedDB implementation import"]);
    expect(searchArchitectureViolations('import "fake-indexeddb/auto";')).toEqual([
      "indexedDB global access",
    ]);
    expect(searchArchitectureViolations('const open = indexedDB.open("spotivibe");')).toEqual([
      "indexedDB global access",
    ]);
    // Repository-mediated search code carries no violation.
    expect(
      searchArchitectureViolations(
        'import { getLocalData } from "@/data/localData";\nimport type { Track } from "@/data/repositories";',
      ),
    ).toEqual([]);
  });
});

describe("architecture: search stays client-side and repository-mediated (task 8.1)", () => {
  it("finds no server, provider-shape, or IndexedDB violations in features/search", () => {
    const files = readTree(join(srcDir, "features", "search"));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(({ source }) => searchArchitectureViolations(source).length > 0)
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});

/**
 * Queue-split invariants (M6 task 9.1, design §1/§10): `queueStore` must never
 * import `playerStore` or the engine (only `playerStore` → `queueStore` is
 * allowed), and the transport store's initial state must carry no queue
 * membership fields — the whole two-store split rests on these two rules.
 */

/** Violations of the queue → transport dependency rule, as labels. */
function queueStoreViolations(source: string): string[] {
  const violations: string[] = [];
  for (const specifier of moduleSpecifiers(source)) {
    if (/(^|[\\/])playerStore(\.tsx?)?$/.test(specifier)) violations.push("playerStore import");
    if (specifier.includes("player/engine")) violations.push("engine import");
  }
  return violations;
}

/** Queue membership fields that must never live on `PlayerState`. */
const QUEUE_MEMBERSHIP_FIELDS = [
  "queue",
  "queueIndex",
  "playOrder",
  "history",
  "shuffle",
  "repeatMode",
];

/** Top-level keys of an `export const <name> = { ... };` block. */
function stateObjectKeys(source: string, name: string): string[] {
  const block =
    source.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\n\\};`))?.[1] ?? "";
  return [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]);
}

/** Top-level keys of `export const initialPlayerState = { ... };`. */
function transportStateKeys(source: string): string[] {
  return stateObjectKeys(source, "initialPlayerState");
}

/** Queue membership fields present in an `initialPlayerState` block. */
function queueMembershipFieldsIn(source: string): string[] {
  const keys = new Set(transportStateKeys(source));
  return QUEUE_MEMBERSHIP_FIELDS.filter((field) => keys.has(field));
}

describe("architecture violation detectors (task 9.1)", () => {
  it("flags playerStore and engine imports from a queue module but passes real queue dependencies", () => {
    expect(queueStoreViolations('import { usePlayerStore } from "@/stores/playerStore";')).toEqual([
      "playerStore import",
    ]);
    expect(queueStoreViolations('import { usePlayerStore } from "./playerStore";')).toEqual([
      "playerStore import",
    ]);
    expect(queueStoreViolations('import { getPlaybackEngine } from "@/player/engine";')).toEqual([
      "engine import",
    ]);
    expect(queueStoreViolations('const engine = await import("../../player/engine");')).toEqual([
      "engine import",
    ]);
    expect(
      queueStoreViolations('import { useNetworkStore } from "@/stores/networkStore";'),
    ).toEqual([]);
    expect(queueStoreViolations('import type { Track } from "@/data/repositories";')).toEqual([]);
  });

  it("flags queue membership fields in a transport initial state but passes the real shape", () => {
    const violating = `export const initialPlayerState = {\n  currentTrack: null,\n  queue: [] as Track[],\n  shuffle: false,\n  status: "idle" as PlaybackStatus,\n};`;
    expect(queueMembershipFieldsIn(violating)).toEqual(["queue", "shuffle"]);

    const clean = `export const initialPlayerState = {\n  currentTrack: null as Track | null,\n  status: "idle" as PlaybackStatus,\n  failedTrackIds: [] as string[],\n};`;
    expect(queueMembershipFieldsIn(clean)).toEqual([]);
  });
});

describe("architecture: the queue/transport split holds (task 9.1)", () => {
  it("keeps queueStore free of playerStore and engine imports", () => {
    const queueSource = readFileSync(join(srcDir, "stores", "queueStore.ts"), "utf8");
    expect(queueSource.length).toBeGreaterThan(0);
    expect(queueStoreViolations(queueSource)).toEqual([]);
  });

  it("keeps queue membership fields out of the transport store's initial state", () => {
    const playerSource = readFileSync(join(srcDir, "stores", "playerStore.ts"), "utf8");
    expect(transportStateKeys(playerSource).length).toBeGreaterThan(0);
    expect(queueMembershipFieldsIn(playerSource)).toEqual([]);
  });
});

/**
 * Library layering invariants (M7 task 9.1, design §1/§12): the M7
 * feature/route surfaces stay repository-mediated (no IndexedDB
 * implementation, no `src/server`, no raw provider shapes), `libraryStore`
 * never imports `playerStore` (library edits cannot touch transport by
 * construction), repository playlist/like writes happen only inside
 * `libraryStore` (the one enforcement point), and the server playlist module
 * never reaches into the local data layer. Each detector is first exercised
 * against violating input, then applied to the real tree.
 */

/** Violations of the M7 surface layering rule, as labels. */
function librarySurfaceViolations(source: string): string[] {
  const violations: string[] = [];
  for (const specifier of moduleSpecifiers(source)) {
    if (importsIndexedDbImplementation(specifier))
      violations.push("IndexedDB implementation import");
    if (targetsServerModule(specifier)) violations.push("src/server import");
  }
  if (mentionsRawProviderShape(source)) violations.push("raw provider shape");
  return violations;
}

/** Violations of the `libraryStore` → transport split, as labels. */
function libraryStoreViolations(source: string): string[] {
  const violations: string[] = [];
  for (const specifier of moduleSpecifiers(source)) {
    if (/(^|[\\/])playerStore(\.tsx?)?$/.test(specifier)) violations.push("playerStore import");
  }
  return violations;
}

/** Repository playlist/like write calls — reserved for `libraryStore`. */
const LIBRARY_WRITE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "liked-tracks write", pattern: /\.likedTracks\s*\.\s*(?:like|unlike)\s*\(/ },
  {
    label: "playlist write",
    pattern: /\.playlists\s*\.\s*(?:create|update|remove|addTrack|removeTrack|reorderTrack)\s*\(/,
  },
];

function libraryWriteViolations(source: string): string[] {
  return LIBRARY_WRITE_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
    ({ label }) => label,
  );
}

/** True when a specifier reaches into the local data layer. */
function importsDataLayer(specifier: string): boolean {
  return specifier.startsWith("@/data/") || /(^|\.\.\/)data(\/|$)/.test(specifier);
}

/** Data-layer specifiers imported by a server module. */
function dataLayerImports(source: string): string[] {
  return moduleSpecifiers(source).filter(importsDataLayer);
}

describe("architecture violation detectors (M7 task 9.1)", () => {
  it("flags IndexedDB, server, and provider-shape leaks from a library surface but passes repository-mediated code", () => {
    expect(
      librarySurfaceViolations('import { createRepositories } from "@/data/indexeddb";'),
    ).toEqual(["IndexedDB implementation import"]);
    expect(
      librarySurfaceViolations('import { resolvePlaylist } from "@/server/music/playlist";'),
    ).toEqual(["src/server import"]);
    expect(
      librarySurfaceViolations("const node: MusicResponsiveListItemRenderer = input;"),
    ).toEqual(["raw provider shape"]);
    // Repository interfaces and canonical domain types are the allowed path.
    expect(
      librarySurfaceViolations(
        'import { getLocalData } from "@/data/localData";\nimport type { Track } from "@/data/repositories";',
      ),
    ).toEqual([]);
  });

  it("flags a playerStore import from the library store but passes its real dependencies", () => {
    expect(
      libraryStoreViolations('import { usePlayerStore } from "@/stores/playerStore";'),
    ).toEqual(["playerStore import"]);
    expect(libraryStoreViolations('import { usePlayerStore } from "./playerStore";')).toEqual([
      "playerStore import",
    ]);
    expect(libraryStoreViolations('import { getLocalData } from "@/data/localData";')).toEqual([]);
    expect(libraryStoreViolations('import { create } from "zustand";')).toEqual([]);
  });

  it("flags playlist/like repository writes outside the store but passes reads and store actions", () => {
    expect(libraryWriteViolations("await data.likedTracks.like(track);")).toEqual([
      "liked-tracks write",
    ]);
    expect(libraryWriteViolations("await data.likedTracks.unlike(track.id);")).toEqual([
      "liked-tracks write",
    ]);
    expect(libraryWriteViolations("await data.playlists.addTrack(id, track);")).toEqual([
      "playlist write",
    ]);
    expect(libraryWriteViolations("await data.playlists.reorderTrack(id, 0, 1);")).toEqual([
      "playlist write",
    ]);
    // Reads and store-level actions are not repository writes.
    expect(libraryWriteViolations("await data.likedTracks.list();")).toEqual([]);
    expect(libraryWriteViolations("await data.playlists.get(id);")).toEqual([]);
    expect(libraryWriteViolations("await useLibraryStore.getState().toggleLike(track);")).toEqual(
      [],
    );
  });

  it("flags a data-layer import from a server module but passes server-only deps", () => {
    expect(dataLayerImports('import { getLocalData } from "@/data/localData";')).toEqual([
      "@/data/localData",
    ]);
    expect(dataLayerImports('import type { Track } from "@/data/repositories";')).toEqual([
      "@/data/repositories",
    ]);
    expect(dataLayerImports('import { repos } from "../../data/indexeddb";')).toEqual([
      "../../data/indexeddb",
    ]);
    expect(dataLayerImports('import { createTtlCache } from "./cache";')).toEqual([]);
  });
});

describe("architecture: library layering holds (M7 task 9.1)", () => {
  it("keeps the M7 feature/route surfaces repository-mediated", () => {
    const files = [
      ...[
        "features/library",
        "features/playlists",
        "components/playlist",
        "components/track",
      ].flatMap((dir) => readTree(join(srcDir, dir))),
      ...readTree(join(srcDir, "app", "library")),
      ...readTree(join(srcDir, "app", "playlist")),
    ];
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(({ source }) => librarySurfaceViolations(source).length > 0)
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps libraryStore free of playerStore imports", () => {
    const storeSource = readFileSync(join(srcDir, "stores", "libraryStore.ts"), "utf8");
    expect(storeSource.length).toBeGreaterThan(0);
    expect(libraryStoreViolations(storeSource)).toEqual([]);
  });

  it("runs every playlist/like repository write inside libraryStore only", () => {
    const offenders = readTree(srcDir)
      .filter(({ file }) => !file.endsWith(join("stores", "libraryStore.ts")))
      .filter(({ source }) => libraryWriteViolations(source).length > 0)
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("keeps the data layer out of the server playlist module", () => {
    const offenders = ["playlist.ts", "playlistRef.ts"]
      .map((name) => join(srcDir, "server", "music", name))
      .map((file) => ({ file, source: readFileSync(file, "utf8") }))
      .filter(({ source }) => dataLayerImports(source).length > 0)
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

/**
 * Discovery layering invariants (M8 task 8.1, design §1/§2/§5/§7): the M8
 * surfaces are repository-mediated exactly like the M5/M7 ones — the client
 * reaches local data only through repository interfaces (`getLocalData()` /
 * `@/data/repositories`), never the IndexedDB implementation, `src/server`, or a
 * raw provider shape. The server discovery modules keep the dependency the
 * other way round: they import nothing from `@/data`, so a discovery feed can
 * never be composed from local user data. The discovery route is
 * metadata-only, and its input surface is exactly four query parameters — a
 * future local-data parameter fails the suite instead of shipping outward.
 * Finally, `lib/languages.ts` stays the single language catalog, because the
 * server seed catalog and the client picker import it and a second copy is
 * exactly how the two would drift.
 *
 * The `features`/`components`/`stores` sweeps already cover the M8
 * directories, so this section does not open a second sweep: it *proves* that
 * coverage by re-running the real detectors over those files with a violating
 * source substituted, which is what would catch a directory silently falling
 * out of `uiSourceFiles()`.
 */

/**
 * The M8 discovery surfaces the repository-mediated rules must reach. `features`
 * and `components` are swept wholesale by {@link uiSourceFiles}; naming the
 * directories here is how the tests below prove that sweep reaches them
 * instead of assuming it.
 */
const M8_SURFACE_DIRECTORIES = [
  "features/home",
  "features/discover",
  "features/preferences",
  "features/history",
  "components/recommendations",
] as const;

/** The sanctioned ways client code reaches local data: one accessor, or its types. */
const LOCAL_DATA_ENTRY_POINTS = ["@/data/localData", "@/data/repositories"];

/** Violations of the client-store local-data rule, as labels. */
function localStoreViolations(source: string): string[] {
  const violations: string[] = [];
  if (hasDirectIndexedDbImport(source)) violations.push("IndexedDB implementation import");
  if (accessesIndexedDbGlobal(source)) violations.push("indexedDB global access");

  // Any *other* data-layer import is an unmediated route to local data: the
  // store would read around `getLocalData()` instead of through the repository
  // interfaces. The IndexedDB implementation is already reported above.
  const specifiers = moduleSpecifiers(source);
  const reachesDataLayer = specifiers.some(
    (specifier) => importsDataLayer(specifier) && !importsIndexedDbImplementation(specifier),
  );
  if (reachesDataLayer && !specifiers.some((spec) => LOCAL_DATA_ENTRY_POINTS.includes(spec))) {
    violations.push("unmediated data-layer import");
  }

  return violations;
}

/**
 * Violations of the data-layer store → transport rule, as labels.
 *
 * `preferencesStore` and `historyStore` are the client authorities for local
 * data: what a surface knows about languages or listening history comes out of
 * them, and nothing else. A transport import would let either store's contents
 * *move* — reading `playerStore`/`queueStore` would make "what is on the page"
 * depend on playback state, and reaching the engine or the IFrame API loader
 * would drag the browser-only host into a module that must stay importable on
 * its own. That is the same layering the M6/M7 store splits enforce for their
 * own stores, so it is detected here rather than left to review.
 */
function dataStoreTransportViolations(source: string): string[] {
  const violations: string[] = [];
  for (const specifier of moduleSpecifiers(source)) {
    if (/(^|[\\/])playerStore(\.tsx?)?$/.test(specifier)) violations.push("playerStore import");
    if (/(^|[\\/])queueStore(\.tsx?)?$/.test(specifier)) violations.push("queueStore import");
    if (specifier.includes("player/engine")) violations.push("engine import");
    if (/(^|[\\/])player\/ytApi(\.tsx?)?$/.test(specifier)) violations.push("ytApi import");
  }
  return violations;
}

/**
 * Query-parameter keys a route handler actually reads (`params.get("x")`,
 * `searchParams.getAll("x")`, …). Asserting the exact set is what enforces the
 * discovery endpoint's input contract: the accepted inputs are a feed kind,
 * catalog language codes, short seed terms, and a limit — nothing else, and
 * never a liked-track, playlist, or history field.
 */
function acceptedQueryKeys(source: string): string[] {
  return [...source.matchAll(/\b\w*[Pp]arams\w*\s*\.\s*get(?:All)?\s*\(\s*["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
}

/** Entries a literal must hold before it counts as a catalog rather than a sample. */
const MIN_LANGUAGE_CATALOG_ENTRIES = 3;

/** The array literal whose `[` is at `start`, matched to its own `]`. */
function balancedArrayLiteral(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  return source.slice(start + 1);
}

/**
 * Competing language catalogs a module declares: an **exported** array constant
 * whose name marks it as a language list (`LANGUAGES`/`…_LANGUAGES`) *and* whose
 * literal holds several `{ code, name }` records.
 *
 * Deliberately narrow, so it cannot misfire on ordinary data: it requires both
 * the catalog naming and the code/name record shape, it ignores a module-private
 * table (nothing can import it, so nothing can drift against the shared one),
 * and non-language data — a genre catalog, a tuple list, a copy block — fails
 * one of the two conditions.
 */
function languageCatalogDeclarations(source: string): string[] {
  const declarations: string[] = [];
  for (const match of source.matchAll(/export\s+const\s+(\w*LANGUAGES\w*)\b[^=]*=\s*\[/g)) {
    // The `[` that opens the literal is the last one in the matched head (a type
    // annotation such as `readonly LanguageOption[]` may contain its own).
    const open = match.index + match[0].lastIndexOf("[");
    const entries = [...balancedArrayLiteral(source, open).matchAll(/\{[^{}]*\}/g)].filter(
      (entry) => /\bcode\s*:/.test(entry[0]) && /\bname\s*:/.test(entry[0]),
    );
    if (entries.length >= MIN_LANGUAGE_CATALOG_ENTRIES) declarations.push(match[1]);
  }
  return declarations;
}

/** Read a real source file, failing loudly when the module is missing. */
function readSource(...segments: string[]): string {
  return readFileSync(join(srcDir, ...segments), "utf8");
}

/** The discovery route handler — the M8 transport boundary. */
function readDiscoveryRoute(): string {
  return readSource("app", "api", "discover", "route.ts");
}

describe("architecture violation detectors (M8 task 8.1)", () => {
  it("flags IndexedDB and unmediated data access from a client store but passes repository-mediated code", () => {
    expect(localStoreViolations('import { createRepositories } from "@/data/indexeddb";')).toEqual([
      "IndexedDB implementation import",
    ]);
    expect(localStoreViolations('const open = indexedDB.open("spotivibe");')).toEqual([
      "indexedDB global access",
    ]);
    expect(localStoreViolations('import "fake-indexeddb/auto";')).toEqual([
      "indexedDB global access",
    ]);
    // Reading around `getLocalData()` — the implementation, a backup helper, or
    // a relative path to the same module — is the violation this rule names.
    expect(localStoreViolations('import { exportEnvelope } from "@/data/backup/prepare";')).toEqual(
      ["unmediated data-layer import"],
    );
    expect(localStoreViolations('import { getLocalData } from "../data/localData";')).toEqual([
      "unmediated data-layer import",
    ]);
    // The sanctioned path, and code that touches no local data at all.
    expect(
      localStoreViolations(
        'import { getLocalData } from "@/data/localData";\nimport type { Track } from "@/data/repositories";',
      ),
    ).toEqual([]);
    expect(localStoreViolations('import { create } from "zustand";')).toEqual([]);
  });

  it("flags transport imports from a data-layer store but passes its real dependencies", () => {
    expect(
      dataStoreTransportViolations('import { usePlayerStore } from "@/stores/playerStore";'),
    ).toEqual(["playerStore import"]);
    expect(dataStoreTransportViolations('import { useQueueStore } from "../queueStore";')).toEqual([
      "queueStore import",
    ]);
    expect(
      dataStoreTransportViolations('import { getPlaybackEngine } from "@/player/engine";'),
    ).toEqual(["engine import"]);
    expect(
      dataStoreTransportViolations('import { loadYouTubeIframeApi } from "@/player/ytApi";'),
    ).toEqual(["ytApi import"]);
    expect(dataStoreTransportViolations('const api = await import("../../player/ytApi");')).toEqual(
      ["ytApi import"],
    );
    // The store's real dependencies, and Spotivibe's own player UI folder (which
    // is not the loader/engine internals).
    expect(
      dataStoreTransportViolations(
        'import { create } from "zustand";\nimport { getLocalData } from "@/data/localData";\nimport type { ListeningEventRecord } from "@/data/repositories";',
      ),
    ).toEqual([]);
    expect(
      dataStoreTransportViolations('import { PlayerHost } from "@/components/player/PlayerHost";'),
    ).toEqual([]);
  });

  it("reads the query parameters a route handler accepts", () => {
    expect(
      acceptedQueryKeys(
        'params.get("kind");\nparams.get("languages");\nparams.get("seeds");\nparams.get("limit");',
      ),
    ).toEqual(["kind", "languages", "seeds", "limit"]);
    // A local-data parameter would be read exactly like a catalog one.
    expect(acceptedQueryKeys('const id = params.get("likedTrackId");')).toEqual(["likedTrackId"]);
    expect(acceptedQueryKeys('const ids = searchParams.getAll("trackIds");')).toEqual(["trackIds"]);
    // A schema object is a bound, not an accepted parameter.
    expect(
      acceptedQueryKeys("discoveryParamsSchema.safeParse({ kind, languages, seeds, limit });"),
    ).toEqual([]);
    expect(acceptedQueryKeys("const body = await request.json();")).toEqual([]);
  });

  it("flags a second language catalog but passes ordinary catalog-shaped data", () => {
    const rival = `export const LANGUAGES = [\n  { code: "en", name: "English" },\n  { code: "es", name: "Spanish" },\n  { code: "fr", name: "French" },\n];`;
    expect(languageCatalogDeclarations(rival)).toEqual(["LANGUAGES"]);
    expect(languageCatalogDeclarations(rival.replace("LANGUAGES", "SUPPORTED_LANGUAGES"))).toEqual([
      "SUPPORTED_LANGUAGES",
    ]);
    // Not a catalog: wrong identifier, wrong record shape, not exported, or too
    // few entries to be one.
    expect(
      languageCatalogDeclarations('export const GENRE_CATALOG = [{ id: "pop", name: "Pop" }];'),
    ).toEqual([]);
    expect(
      languageCatalogDeclarations('export const LANGUAGES_BY_CODE = [["en", "English"]];'),
    ).toEqual([]);
    expect(
      languageCatalogDeclarations('const LANGUAGES = [{ code: "en", name: "English" }];'),
    ).toEqual([]);
    expect(
      languageCatalogDeclarations(
        'export const LANGUAGES = [{ code: "en", name: "English" }, { code: "es", name: "Spanish" }];',
      ),
    ).toEqual([]);
  });
});

describe("architecture: the M8 discovery surfaces stay repository-mediated (M8 task 8.1)", () => {
  // I/O-bound by nature: these coverage proofs walk real source trees, so they get
  // an explicit timeout instead of inheriting the 5s default. On a loaded machine
  // the default was the difference between a green gate and a spurious failure
  // (seen in M9's clean-clone verification). The assertions are unchanged.
  it("sweeps every M8 surface directory", () => {
    for (const dir of M8_SURFACE_DIRECTORIES) {
      const files = readTree(join(srcDir, dir));
      expect(files.length, dir).toBeGreaterThan(0);
      // The repository-mediated sweep is the shared `uiSourceFiles` one.
      const swept = uiSourceFiles().map(({ file }) => file);
      expect(
        swept.some((file) => file.startsWith(join(srcDir, dir))),
        dir,
      ).toBe(true);
    }
  }, 30_000);

  it("flags a leak in any M8 surface — the sweep is proven, not assumed", () => {
    // Substitute a violating source for every real file in the sweep: if a rule
    // did not reach a file, that file would escape this list.
    const swept = uiSourceFiles();
    expect(swept.length).toBeGreaterThan(0);
    const injected = swept.map(({ file }) => ({
      file,
      source:
        'import { createRepositories } from "@/data/indexeddb";\nimport { runDiscovery } from "@/server/music/discovery";\nconst node: MusicResponsiveListItemRenderer = input;',
    }));

    const expected = injected.map(({ file }) => file);
    expect(
      injected
        .filter(({ source }) => librarySurfaceViolations(source).length > 0)
        .map(({ file }) => file),
    ).toEqual(expected);
    // Each leak is reported for its own reason, so one rule cannot mask another.
    expect(
      injected.filter(({ source }) => hasDirectIndexedDbImport(source)).map(({ file }) => file),
    ).toEqual(expected);
    expect(
      injected
        .filter(({ source }) => moduleSpecifiers(source).some(targetsServerModule))
        .map(({ file }) => file),
    ).toEqual(expected);
    expect(
      injected.filter(({ source }) => mentionsRawProviderShape(source)).map(({ file }) => file),
    ).toEqual(expected);
  });

  it("finds no IndexedDB, server, or provider-shape leak in the M8 surfaces", () => {
    const files = M8_SURFACE_DIRECTORIES.flatMap((dir) => readTree(join(srcDir, dir)));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(({ source }) => librarySurfaceViolations(source).length > 0)
      .map(({ file }) => relative(srcDir, file));
    expect(offenders).toEqual([]);
  });
});

describe("architecture: the M8 client stores reach data through repositories (M8 task 8.1)", () => {
  it("keeps preferencesStore and historyStore on the repository entry point", () => {
    for (const name of ["preferencesStore.ts", "historyStore.ts"]) {
      const source = readSource("stores", name);
      expect(source.length, name).toBeGreaterThan(0);
      expect(localStoreViolations(source), name).toEqual([]);
      // Not vacuous: the store really does read local data through the accessor.
      expect(moduleSpecifiers(source), name).toContain("@/data/localData");
    }
  });
});

describe("architecture: the M8 data-layer stores stay off transport (M8 task 8.1)", () => {
  it("keeps preferencesStore and historyStore free of transport imports", () => {
    for (const name of ["preferencesStore.ts", "historyStore.ts"]) {
      const source = readSource("stores", name);
      expect(source.length, name).toBeGreaterThan(0);
      expect(dataStoreTransportViolations(source), name).toEqual([]);
      // Not vacuous: the detector is reading a real store that really imports.
      expect(moduleSpecifiers(source).length, name).toBeGreaterThan(0);
    }
  });
});

describe("architecture: the server discovery layer stays off local data (M8 task 8.1)", () => {
  it("imports no @/data module from the discovery feed modules", () => {
    const modules = ["discovery.ts", "discoverySeeds.ts"].map((name) => ({
      file: join(srcDir, "server", "music", name),
      source: readFileSync(join(srcDir, "server", "music", name), "utf8"),
    }));
    expect(modules.every(({ source }) => source.length > 0)).toBe(true);

    const offenders = modules
      .filter(({ source }) => dataLayerImports(source).length > 0)
      .map(({ file }) => relative(srcDir, file));
    expect(offenders).toEqual([]);
  });
});

describe("architecture: the discovery route is metadata-only (M8 task 8.1)", () => {
  it("accepts exactly kind, languages, seeds, and limit", () => {
    const source = readDiscoveryRoute();

    expect([...acceptedQueryKeys(source)].sort()).toEqual(["kind", "languages", "limit", "seeds"]);
  });

  it("returns no media bytes and reaches no local dataset", () => {
    const source = readDiscoveryRoute();

    expect(mediaByteIndicators(source)).toEqual([]);
    expect(dataLayerImports(source)).toEqual([]);
  });
});

describe("architecture: lib/languages.ts is the only language catalog (M8 task 8.1)", () => {
  it("finds a competing language catalog in no other module under src", () => {
    const owners = readTree(srcDir)
      .filter(({ source }) => languageCatalogDeclarations(source).length > 0)
      .map(({ file }) => relative(srcDir, file));

    expect(owners).toEqual([join("lib", "languages.ts")]);
    // Not vacuous: the canonical catalog is found by the very same detector.
    expect(languageCatalogDeclarations(readSource("lib", "languages.ts"))).toEqual(["LANGUAGES"]);
  });
});

/**
 * Catalog layering invariants (M9 task 7.1, design §1/§2/§3/§8).
 *
 * The M9 surfaces are repository-mediated exactly like the M5/M7/M8 ones: the
 * client reaches local data only through repository interfaces, never the
 * IndexedDB implementation, `src/server`, or a raw provider shape, and never the
 * IFrame API loader or its YT types — the M3 player rule, *proven* to reach the
 * new folders below rather than assumed to. The server catalog module keeps the
 * dependency the other way round and imports nothing from `@/data`, so a
 * resolved artist, release, or similar-track feed can never be composed out of
 * local user data. The three catalog routes are metadata-only, and their input
 * surface is *exactly* the documented entity identifiers: a future
 * `liked`/`playlist`/`history` parameter fails this suite instead of shipping
 * outward.
 *
 * `features` and `app` are already swept wholesale by {@link uiSourceFiles}, so
 * this section deliberately does not open a second walker. It *proves* that
 * coverage — naming the M9 directories, then re-running the real detectors over
 * their files with a violating source substituted — which is what would catch a
 * new directory silently falling out of the shared sweep.
 */

/**
 * The M9 surfaces the repository-mediated and player-internals rules must reach.
 * `features` and `app` are swept wholesale by {@link uiSourceFiles}; naming the
 * directories here is how the tests below prove that sweep reaches them instead
 * of assuming it.
 */
const M9_SURFACE_DIRECTORIES = [
  "features/artist",
  "features/album",
  "features/related",
  "app/artist",
  "app/album",
] as const;

/** The M9 files, as the shared UI sweep sees them. */
function m9SweptFiles(): Array<{ file: string; source: string }> {
  const swept = uiSourceFiles();
  return swept.filter(({ file }) =>
    M9_SURFACE_DIRECTORIES.some((dir) => file.startsWith(join(srcDir, dir))),
  );
}

/**
 * Query keys that would carry local user data into a catalog request. The
 * catalog endpoints identify an entity — or a source track — by public metadata
 * only, so reading any of these would mean a request carries user state, which
 * is exactly what a local-first, accountless design cannot have.
 */
const LIBRARY_QUERY_PARAMETERS = [
  "liked",
  "likedIds",
  "playlist",
  "playlists",
  "history",
  "listeningHistory",
];

/** Accepted query keys of a route handler that name a local dataset. */
function libraryQueryParameterReads(source: string): string[] {
  return acceptedQueryKeys(source).filter((key) => LIBRARY_QUERY_PARAMETERS.includes(key));
}

/** The three catalog route handlers and the input surface each one documents. */
const M9_CATALOG_ROUTES = [
  { name: "artist", accepted: ["id", "name"] },
  { name: "album", accepted: ["artist", "id", "title"] },
  { name: "similar", accepted: ["artist", "exclude", "title"] },
] as const;

/** A catalog route handler's source — the M9 transport boundary. */
function readCatalogRoute(name: (typeof M9_CATALOG_ROUTES)[number]["name"]): string {
  return readSource("app", "api", name, "route.ts");
}

/**
 * The server modules that resolve catalog entities: the M8 feed pair and M9's
 * resolver. They share one rule, so they are named once and swept together.
 */
const SERVER_CATALOG_MODULES = ["discovery.ts", "discoverySeeds.ts", "catalog.ts"] as const;

describe("architecture violation detectors (M9 task 7.1)", () => {
  it("flags a liked/playlist/history query key but passes the documented entity keys", () => {
    expect(libraryQueryParameterReads('const id = params.get("likedIds");')).toEqual(["likedIds"]);
    expect(libraryQueryParameterReads('const all = searchParams.getAll("playlists");')).toEqual([
      "playlists",
    ]);
    expect(libraryQueryParameterReads('const since = params.get("history");')).toEqual(["history"]);
    // The documented inputs carry no user data, and a zod schema is a bound on a
    // value rather than an accepted parameter.
    expect(
      libraryQueryParameterReads(
        'params.get("name");\nparams.get("id");\nparams.get("title");\nparams.get("artist");\nparams.get("exclude");',
      ),
    ).toEqual([]);
    expect(
      libraryQueryParameterReads("similarParamsSchema.safeParse({ title, artist, exclude });"),
    ).toEqual([]);
  });

  it("fails the exact input surface as soon as a handler reads one undocumented key", () => {
    const documented = [...M9_CATALOG_ROUTES[0].accepted].sort();
    const clean = 'params.get("name");\nparams.get("id");';

    expect([...acceptedQueryKeys(clean)].sort()).toEqual(documented);
    // The only change is one local-data key, and it must break the comparison.
    const widened = `${clean}\nparams.get("likedIds");`;
    expect([...acceptedQueryKeys(widened)].sort()).not.toEqual(documented);
    expect(libraryQueryParameterReads(widened)).toEqual(["likedIds"]);
    // A dropped key breaks it too, so the rule is not satisfied by "at least".
    expect([...acceptedQueryKeys('params.get("name");')].sort()).not.toEqual(documented);
  });
});

describe("architecture: the M9 catalog surfaces stay repository-mediated (M9 task 7.1)", () => {
  it("sweeps every M9 surface directory", () => {
    const real = M9_SURFACE_DIRECTORIES.flatMap((dir) => readTree(join(srcDir, dir)));
    for (const dir of M9_SURFACE_DIRECTORIES) {
      expect(readTree(join(srcDir, dir)).length, dir).toBeGreaterThan(0);
      // The repository-mediated sweep is the shared `uiSourceFiles` one.
      const swept = uiSourceFiles().map(({ file }) => file);
      expect(
        swept.some((file) => file.startsWith(join(srcDir, dir))),
        dir,
      ).toBe(true);
    }
    // Nothing in the M9 surfaces falls out of that sweep: the swept set is
    // exactly the real set of M9 files, so a new file is covered by default.
    expect(
      m9SweptFiles()
        .map(({ file }) => file)
        .sort(),
    ).toEqual(real.map(({ file }) => file).sort());
  }, 30_000);

  it("flags a leak in any M9 surface — the sweep is proven, not assumed", () => {
    // Substitute a violating source for every real M9 file: if a rule did not
    // reach a file, that file would escape this list.
    const injected = m9SweptFiles().map(({ file }) => ({
      file,
      source:
        'import { createRepositories } from "@/data/indexeddb";\nimport { resolveArtist } from "@/server/music/catalog";\nconst node: MusicResponsiveListItemRenderer = input;',
    }));
    expect(injected.length).toBeGreaterThan(0);
    const expected = injected.map(({ file }) => file);

    expect(
      injected
        .filter(({ source }) => librarySurfaceViolations(source).length > 0)
        .map(({ file }) => file),
    ).toEqual(expected);
    // Each leak is reported for its own reason, so one rule cannot mask another.
    expect(
      injected.filter(({ source }) => hasDirectIndexedDbImport(source)).map(({ file }) => file),
    ).toEqual(expected);
    expect(
      injected
        .filter(({ source }) => moduleSpecifiers(source).some(targetsServerModule))
        .map(({ file }) => file),
    ).toEqual(expected);
    expect(
      injected.filter(({ source }) => mentionsRawProviderShape(source)).map(({ file }) => file),
    ).toEqual(expected);
  }, 30_000);

  it("finds no IndexedDB, server, or provider-shape leak in the M9 surfaces", () => {
    const files = M9_SURFACE_DIRECTORIES.flatMap((dir) => readTree(join(srcDir, dir)));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(({ source }) => librarySurfaceViolations(source).length > 0)
      .map(({ file }) => relative(srcDir, file));
    expect(offenders).toEqual([]);
  });
});

describe("architecture: the M9 surfaces stay off the IFrame API loader and YT types (M9 task 7.1)", () => {
  it("finds no player-internals import in the M9 surfaces", () => {
    const files = m9SweptFiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(({ source }) => moduleSpecifiers(source).some(targetsPlayerInternals))
      .map(({ file }) => relative(srcDir, file));
    expect(offenders).toEqual([]);
  });

  it("flags the loader and its types in any M9 surface — the sweep is proven, not assumed", () => {
    const swept = m9SweptFiles();
    expect(swept.length).toBeGreaterThan(0);
    const expected = swept.map(({ file }) => file);

    // Each internals module on its own: a rule that only caught one of the two
    // would pass this list.
    for (const specifier of ["@/player/ytApi", "@/player/types"]) {
      const injected = swept.map(({ file }) => ({
        file,
        source: `import { internals } from "${specifier}";`,
      }));
      expect(
        injected
          .filter(({ source }) => moduleSpecifiers(source).some(targetsPlayerInternals))
          .map(({ file }) => file),
      ).toEqual(expected);
    }
  });
});

describe("architecture: the server catalog layer stays off local data (M9 task 7.1)", () => {
  it("imports no @/data module from the server catalog modules", () => {
    for (const name of SERVER_CATALOG_MODULES) {
      const source = readSource("server", "music", name);
      expect(source.length, name).toBeGreaterThan(0);
      // Not vacuous: the module really does import its own dependencies.
      expect(moduleSpecifiers(source).length, name).toBeGreaterThan(0);
      expect(dataLayerImports(source), name).toEqual([]);
    }
  });

  it("flags a data-layer import in any of them — the rule is proven, not assumed", () => {
    const injected = SERVER_CATALOG_MODULES.map((name) => ({
      name,
      source:
        'import { getLocalData } from "@/data/localData";\nimport { runChain } from "./chain";',
    }));

    expect(
      injected.filter(({ source }) => dataLayerImports(source).length > 0).map(({ name }) => name),
    ).toEqual([...SERVER_CATALOG_MODULES]);
  });
});

describe("architecture: the catalog routes are metadata-only and bounded (M9 task 7.1)", () => {
  it("accepts exactly the documented entity query keys on each route", () => {
    for (const route of M9_CATALOG_ROUTES) {
      expect([...acceptedQueryKeys(readCatalogRoute(route.name))].sort(), route.name).toEqual(
        [...route.accepted].sort(),
      );
    }
  });

  it("reads no liked, playlist, or history parameter", () => {
    for (const route of M9_CATALOG_ROUTES) {
      expect(libraryQueryParameterReads(readCatalogRoute(route.name)), route.name).toEqual([]);
    }
  });

  it("returns no media bytes and reaches no local dataset", () => {
    for (const route of M9_CATALOG_ROUTES) {
      const source = readCatalogRoute(route.name);
      expect(mediaByteIndicators(source), route.name).toEqual([]);
      expect(dataLayerImports(source), route.name).toEqual([]);
    }
  });

  it("flags a widened input, a library parameter, and a media body — proven on the real handlers", () => {
    // One violating source substituted for each real handler, carrying all three
    // parts of the rule, so each is exercised against the exact files it guards.
    const injected = M9_CATALOG_ROUTES.map((route) => ({
      name: route.name,
      source: [
        'import { getLocalData } from "@/data/localData";',
        'const name = params.get("name");',
        'const liked = params.get("likedIds");',
        'return new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });',
      ].join("\n"),
    }));
    const expected = injected.map(({ name }) => name);

    expect(
      injected
        .filter(({ source }) => libraryQueryParameterReads(source).length > 0)
        .map(({ name }) => name),
    ).toEqual(expected);
    expect(
      injected
        .filter(({ source }) => mediaByteIndicators(source).length > 0)
        .map(({ name }) => name),
    ).toEqual(expected);
    expect(
      injected.filter(({ source }) => dataLayerImports(source).length > 0).map(({ name }) => name),
    ).toEqual(expected);
    // The exact-set rule fails on the same widening, not only the list rule: a
    // route's own documented keys plus one local-data key is no longer the
    // documented input surface.
    for (const route of M9_CATALOG_ROUTES) {
      const widened = [
        ...route.accepted.map((key) => `params.get("${key}");`),
        'params.get("likedIds");',
      ].join("\n");
      expect([...acceptedQueryKeys(widened)].sort(), route.name).not.toEqual(
        [...route.accepted].sort(),
      );
    }
  });
});

/**
 * Radio/personalization layering invariants (M10 task 6.1, design §1/§2/§3/§4/§6).
 *
 * M10 adds the last client area the repository-mediated rule has not covered
 * yet, and the rules around it are the ones the local-first promise rests on:
 *
 * - The `features/personalization` surfaces are repository-mediated exactly
 *   like the M5/M7/M8/M9 ones — no IndexedDB implementation, no `src/server`,
 *   no raw provider shape — and they stay off the IFrame API loader and its YT
 *   types, which the M3 player rule owns.
 * - `server/music/radio.ts` keeps the dependency the other way round: it imports
 *   nothing from `@/data`, so a radio feed can never be composed out of local
 *   user data. This is the same rule the discovery and catalog services carry.
 * - The radio route is metadata-only, and its input surface is **exactly** the
 *   six documented keys. `kind`, `title`, and `artist` are public metadata,
 *   `variant` is the caller's own refill counter, `limit` and `exclude` are the
 *   caller's own bounds — so a `liked`/`history`/`profile`/`user`/`device`
 *   parameter fails this suite instead of shipping a taste profile outward.
 * - **No personalization weight crosses a request boundary.** The modules that
 *   build a radio request may not read the profile's weighting internals, and
 *   may not read `libraryStore`/`historyStore` themselves. The engine may *read*
 *   a store to decide a policy — `RefillAgent` reads the local datasets, but
 *   only to rank a response that has already arrived — and a request itself
 *   carries only identity, variant, limit, and exclusions. The rule is scoped to
 *   the request builders so it stays honest about what it actually forbids.
 * - `radioStore` holds no playback state: a radio is a **mode of the one queue**,
 *   not a second player, so it owns the seed, the played set, the variant, and
 *   the status — and no queue or transport field.
 *
 * `app`, `components`, `features`, and `stores` are already swept wholesale by
 * {@link uiSourceFiles}, so this section deliberately does not open a second
 * walker. It *proves* that coverage the way the M9 block does — naming the M10
 * directories, then re-running the real detectors over their files with a
 * violating source substituted — which is what would catch a new M10 directory
 * silently falling out of the shared sweep.
 */

/**
 * The M10 surfaces the repository-mediated and player-internals rules must
 * reach. `features/personalization` is the new folder the rules must cover;
 * the rest are the existing areas M10 added a file or a listener to, which the
 * same shared sweep owns and this list proves it owns.
 */
const M10_SURFACE_DIRECTORIES = [
  "features/personalization",
  "features/preferences",
  "app/now-playing",
  "components/layout",
] as const;

/**
 * The exact M10 files, named so the coverage proof pins files and not only
 * directories: a file added to an already-swept directory is covered by
 * construction, and this list makes that claim checkable per file.
 */
const M10_TOUCHED_FILES = [
  join("app", "now-playing", "page.tsx"),
  join("components", "layout", "AppShell.tsx"),
  join("features", "artist", "ArtistView.tsx"),
  join("features", "personalization", "RadioStartedTracker.tsx"),
  join("features", "personalization", "RefillAgent.tsx"),
  join("features", "personalization", "radioApi.ts"),
  join("features", "personalization", "refillEngine.ts"),
  join("features", "personalization", "scoreCandidates.ts"),
  join("features", "personalization", "startRadio.ts"),
  join("features", "personalization", "tasteProfile.ts"),
  join("features", "preferences", "AutofillSettingsSection.tsx"),
  join("features", "search", "ResultMenu.tsx"),
  join("stores", "radioStore.ts"),
] as const;

/**
 * Query keys that would carry local user data or a taste profile into a radio
 * request. Extends the M9 library list with the profile/user/device family the
 * radio contract adds: the radio identity is public metadata, never user state.
 */
const PERSONALIZATION_QUERY_PARAMETERS = [
  "profile",
  "tasteProfile",
  "taste",
  "user",
  "userId",
  "device",
  "deviceId",
  ...LIBRARY_QUERY_PARAMETERS,
];

/** Accepted query keys of a route handler that name a profile or user dataset. */
function personalizationQueryParameterReads(source: string): string[] {
  return acceptedQueryKeys(source).filter((key) => PERSONALIZATION_QUERY_PARAMETERS.includes(key));
}

/**
 * The radio route handler — the M10 transport boundary. Named so the route
 * reads the same way as the discovery and catalog ones above.
 */
function readRadioRoute(): string {
  return readSource("app", "api", "radio", "route.ts");
}

/** The radio route's documented query parameters, exactly. */
const RADIO_ACCEPTED_QUERY_KEYS = ["kind", "title", "artist", "variant", "limit", "exclude"];

/**
 * The modules that **build a radio request** — the ones whose output is the
 * query that crosses the network. These are the boundary the "no weight in a
 * request" rule guards; ranking code (`scoreCandidates`, `RefillAgent`) reads
 * the profile legitimately, and `RefillAgent` reads the local stores to *rank a
 * response that already arrived*, which is not a request payload.
 */
const RADIO_REQUEST_MODULES = [
  "features/personalization/radioApi.ts",
  "features/personalization/refillEngine.ts",
  "features/personalization/startRadio.ts",
] as const;

/** The personalization modules that own the weighting constants. */
const PROFILE_MODULES = ["features/personalization/tasteProfile.ts"] as const;
const SCORER_MODULES = ["features/personalization/scoreCandidates.ts"] as const;

/**
 * The names that make a personalization import a *weighting* import: the
 * bounds object plus any `SCREAMING_SNAKE` constant ending in `_WEIGHT` or
 * `_PENALTY` (`LIKE_WEIGHT`, `REPEAT_PENALTY`, `RECENCY_PENALTY_SKIPPED`).
 *
 * A shape, not a list, so a weight that has not been written yet is still
 * covered — and so an ordinary binding (`buildTasteProfile`, `artistKeyOf`) is
 * not mistaken for one.
 */
const PROFILE_WEIGHTING_PATTERN = /\b(?:TASTE_LIMITS|[A-Z][A-Z0-9_]*_(?:WEIGHT|PENALTY))\b/;

/**
 * True when a specifier is the taste profile or the scorer — by module *name*
 * on the last path segment, so an alias, a relative sibling import, and the
 * `@/…` path all reach the same module. Keyed on the name rather than the exact
 * `personalization/` prefix because these three modules are siblings inside one
 * feature folder and import each other by short relative path.
 */
function targetsProfileModule(specifier: string): boolean {
  return /(^|[\\/])(?:tasteProfile|scoreCandidates)(\.tsx?)?$/.test(specifier);
}

/**
 * Named bindings a source imports from the profile or the scorer, keeping only
 * the *weighting* ones (`TASTE_LIMITS`, `*_WEIGHT`, `*_PENALTY`).
 *
 * Name-based rather than specifier-based on purpose: the profile's **types** and
 * helpers (`TasteProfile`, `artistKeyOf`, `genreKeysOf`, `buildTasteProfile`)
 * are legitimate anywhere, and a rule that flagged every import from the module
 * would be a rule the real code fails for the wrong reason. A weight is a
 * numeric tuning constant, and that is what must not reach a request.
 */
function profileWeightingImports(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    if (!targetsProfileModule(match[2])) continue;
    for (const raw of match[1].split(",")) {
      // `X as Y` keeps both names; a leading `type` marks a type-only binding.
      for (const part of raw.split(/\s+as\s+/)) {
        const name = part.trim().replace(/^type\s+/, "");
        if (PROFILE_WEIGHTING_PATTERN.test(name)) names.push(name);
      }
    }
  }
  return names;
}

/**
 * Violations of the "no personalization weight in a request" rule, as labels.
 *
 * Scoped to the modules that *build* a radio request — {@link
 * RADIO_REQUEST_MODULES} — because that is where the boundary is. A request may
 * carry identity, variant, limit, and exclusions; a taste weight is none of
 * those, and a weight that can be read here is a weight that can end up in a
 * query string.
 */
function radioRequestViolations(source: string): string[] {
  const violations: string[] = [];
  if (profileWeightingImports(source).length > 0) violations.push("taste-profile weighting import");
  // A request may not be assembled *from a store's* local data directly. The
  // stores a request builder is allowed to read are the radio identity and the
  // queue's own membership — never the library/history datasets, whose contents
  // are exactly what must not leave the device.
  for (const specifier of moduleSpecifiers(source)) {
    if (/(^|[\\/])(?:libraryStore|historyStore)(\.tsx?)?$/.test(specifier)) {
      violations.push("library/history store import");
    }
  }
  return violations;
}

/** Playback fields that must never appear in the radio store's state. */
const RADIO_FORBIDDEN_STATE_FIELDS = [
  "queue",
  "queueIndex",
  "currentTrack",
  "position",
  "isPlaying",
  "playOrder",
];

/**
 * The radio store's declared state keys, read from its `initialRadioState`
 * literal. Reuses the transport-store extractor (M6) rather than a second
 * walker: the invariant is the same shape ("this store's state must not carry
 * playback fields"), so one extractor serves both.
 */
function radioStoreStateKeys(source: string): string[] {
  return stateObjectKeys(source, "initialRadioState");
}

/** Playback fields present in the radio store's initial state. */
function radioStorePlaybackFields(source: string): string[] {
  const keys = new Set(radioStoreStateKeys(source));
  return RADIO_FORBIDDEN_STATE_FIELDS.filter((field) => keys.has(field));
}

describe("architecture violation detectors (M10 task 6.1)", () => {
  it("flags profile/user/device query keys but passes the radio's own six", () => {
    expect(personalizationQueryParameterReads('const p = params.get("profile");')).toEqual([
      "profile",
    ]);
    expect(personalizationQueryParameterReads('const u = params.get("userId");')).toEqual([
      "userId",
    ]);
    expect(personalizationQueryParameterReads('const d = params.get("deviceId");')).toEqual([
      "deviceId",
    ]);
    expect(personalizationQueryParameterReads('const l = params.get("liked");')).toEqual(["liked"]);
    expect(personalizationQueryParameterReads('const h = params.get("history");')).toEqual([
      "history",
    ]);
    // The documented keys are public metadata and caller-side bounds.
    expect(
      personalizationQueryParameterReads(
        RADIO_ACCEPTED_QUERY_KEYS.map((key) => `params.get("${key}");`).join("\n"),
      ),
    ).toEqual([]);
    // A schema object is a bound on a value, not an accepted parameter.
    expect(personalizationQueryParameterReads("radioParamsSchema.safeParse({ kind });")).toEqual(
      [],
    );
  });

  it("fails the exact radio input surface on a widened key and on a dropped key", () => {
    const documented = [...RADIO_ACCEPTED_QUERY_KEYS].sort();

    const widened = [
      ...RADIO_ACCEPTED_QUERY_KEYS.map((key) => `params.get("${key}");`),
      'params.get("profile");',
    ].join("\n");
    expect([...acceptedQueryKeys(widened)].sort()).not.toEqual(documented);

    // A dropped key breaks it too, so "at least these six" cannot satisfy the
    // rule: the exact-set comparison is not satisfied by a superset.
    const dropped = RADIO_ACCEPTED_QUERY_KEYS.filter((key) => key !== "exclude")
      .map((key) => `params.get("${key}");`)
      .join("\n");
    expect([...acceptedQueryKeys(dropped)].sort()).not.toEqual(documented);
  });

  it("flags profile weights and library/history reads in a request but passes identity-only code", () => {
    expect(
      radioRequestViolations(
        'import { TASTE_LIMITS } from "@/features/personalization/tasteProfile";',
      ),
    ).toEqual(["taste-profile weighting import"]);
    expect(
      radioRequestViolations(
        'import { LIKE_WEIGHT } from "@/features/personalization/tasteProfile";',
      ),
    ).toEqual(["taste-profile weighting import"]);
    expect(
      radioRequestViolations(
        'import { ARTIST_AFFINITY_WEIGHT } from "@/features/personalization/scoreCandidates";',
      ),
    ).toEqual(["taste-profile weighting import"]);
    // Reading the stores directly is what would assemble a payload from them.
    expect(
      radioRequestViolations('import { useLibraryStore } from "@/stores/libraryStore";'),
    ).toEqual(["library/history store import"]);
    expect(
      radioRequestViolations('import { useHistoryStore } from "@/stores/historyStore";'),
    ).toEqual(["library/history store import"]);
    // The real shape: the radio identity, the queue's own membership, the profile
    // *type*, and the refiller's own helper — none of which is a weight or a store.
    expect(
      radioRequestViolations(
        [
          'import { radioIdentity } from "@/stores/radioStore";',
          'import type { TasteProfile } from "@/features/personalization/tasteProfile";',
          'import { selectAppendable } from "./refillEngine";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("flags a playback field in the radio store's state but passes the real one", () => {
    const violating = `export const initialRadioState = {\n  seed: null,\n  queue: [] as Track[],\n  currentTrack: null as Track | null,\n};`;
    expect(radioStorePlaybackFields(violating)).toEqual(["queue", "currentTrack"]);

    const clean = `export const initialRadioState = {\n  seed: null as RadioSeed | null,\n  status: "idle" as RadioStatus,\n  playedIds: [] as string[],\n};`;
    expect(radioStorePlaybackFields(clean)).toEqual([]);
  });
});

describe("architecture: the M10 surfaces stay repository-mediated (M10 task 6.1)", () => {
  it("sweeps every M10 surface directory", () => {
    for (const dir of M10_SURFACE_DIRECTORIES) {
      expect(readTree(join(srcDir, dir)).length, dir).toBeGreaterThan(0);
      // The repository-mediated sweep is the shared `uiSourceFiles` one.
      expect(
        uiSourceFiles().some(({ file }) => file.startsWith(join(srcDir, dir))),
        dir,
      ).toBe(true);
    }
  }, 30_000);

  it("sweeps every touched M10 file — coverage is pinned per file, not per area", () => {
    const swept = new Set(uiSourceFiles().map(({ file }) => file));
    // Not vacuous: the detector below is about files inside those directories,
    // and the named ones must actually exist for it to say anything.
    for (const file of M10_TOUCHED_FILES) {
      expect(existsSync(join(srcDir, file)), file).toBe(true);
      expect(swept.has(join(srcDir, file)), file).toBe(true);
    }
  }, 30_000);

  it("flags a leak in any M10 surface — the sweep is proven, not assumed", () => {
    // Substitute a violating source for every real file in the M10 areas: if a
    // rule did not reach a file, that file would escape this list.
    const swept = uiSourceFiles().filter(({ file }) =>
      M10_SURFACE_DIRECTORIES.some((dir) => file.startsWith(join(srcDir, dir))),
    );
    expect(swept.length).toBeGreaterThan(0);
    const injected = swept.map(({ file }) => ({
      file,
      source:
        'import { createRepositories } from "@/data/indexeddb";\nimport { runRadio } from "@/server/music/radio";\nconst node: MusicResponsiveListItemRenderer = input;',
    }));
    const expected = injected.map(({ file }) => file);

    expect(
      injected
        .filter(({ source }) => librarySurfaceViolations(source).length > 0)
        .map(({ file }) => file),
    ).toEqual(expected);
    expect(
      injected.filter(({ source }) => hasDirectIndexedDbImport(source)).map(({ file }) => file),
    ).toEqual(expected);
    expect(
      injected
        .filter(({ source }) => moduleSpecifiers(source).some(targetsServerModule))
        .map(({ file }) => file),
    ).toEqual(expected);
    expect(
      injected.filter(({ source }) => mentionsRawProviderShape(source)).map(({ file }) => file),
    ).toEqual(expected);
  }, 30_000);

  it("finds no IndexedDB, server, or provider-shape leak in the M10 surfaces", () => {
    const files = M10_SURFACE_DIRECTORIES.flatMap((dir) => readTree(join(srcDir, dir)));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(({ source }) => librarySurfaceViolations(source).length > 0)
      .map(({ file }) => relative(srcDir, file));
    expect(offenders).toEqual([]);
  });
});

describe("architecture: the M10 surfaces stay off the IFrame API loader and YT types (M10 task 6.1)", () => {
  it("finds no player-internals import in the M10 surfaces", () => {
    const files = M10_SURFACE_DIRECTORIES.flatMap((dir) => readTree(join(srcDir, dir)));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(({ source }) => moduleSpecifiers(source).some(targetsPlayerInternals))
      .map(({ file }) => relative(srcDir, file));
    expect(offenders).toEqual([]);
  });

  it("flags the loader and its types in any M10 surface — the sweep is proven, not assumed", () => {
    const swept = M10_SURFACE_DIRECTORIES.flatMap((dir) =>
      uiSourceFiles().filter(({ file }) => file.startsWith(join(srcDir, dir))),
    );
    expect(swept.length).toBeGreaterThan(0);
    const expected = swept.map(({ file }) => file);

    // Each internals module on its own: a rule that only caught one of the two
    // would pass this list.
    for (const specifier of ["@/player/ytApi", "@/player/types"]) {
      const injected = swept.map(({ file }) => ({
        file,
        source: `import { internals } from "${specifier}";`,
      }));
      expect(
        injected
          .filter(({ source }) => moduleSpecifiers(source).some(targetsPlayerInternals))
          .map(({ file }) => file),
      ).toEqual(expected);
    }
  }, 30_000);
});

describe("architecture: the server radio layer stays off local data (M10 task 6.1)", () => {
  it("imports no @/data module from the radio resolver", () => {
    const source = readSource("server", "music", "radio.ts");
    expect(source.length).toBeGreaterThan(0);
    // Not vacuous: the module really does import its own dependencies.
    expect(moduleSpecifiers(source).length).toBeGreaterThan(0);
    expect(dataLayerImports(source)).toEqual([]);
  });

  it("flags a data-layer import in it — the rule is proven, not assumed", () => {
    const injected = [
      {
        name: "radio.ts",
        source:
          'import { getLocalData } from "@/data/localData";\nimport { runChain } from "./chain";',
      },
    ];

    expect(
      injected.filter(({ source }) => dataLayerImports(source).length > 0).map(({ name }) => name),
    ).toEqual(["radio.ts"]);
  });
});

describe("architecture: the radio route is metadata-only (M10 task 6.1)", () => {
  it("accepts exactly kind, title, artist, variant, limit, and exclude", () => {
    expect([...acceptedQueryKeys(readRadioRoute())].sort()).toEqual(
      [...RADIO_ACCEPTED_QUERY_KEYS].sort(),
    );
  });

  it("reads no liked, history, profile, user, or device parameter", () => {
    expect(personalizationQueryParameterReads(readRadioRoute())).toEqual([]);
  });

  it("returns no media bytes and reaches no local dataset", () => {
    const source = readRadioRoute();

    expect(mediaByteIndicators(source)).toEqual([]);
    expect(dataLayerImports(source)).toEqual([]);
  });

  it("flags a widened input, a profile key, and a media body — proven on the real handler", () => {
    const injected = {
      name: "radio.ts",
      source: [
        'import { getLocalData } from "@/data/localData";',
        ...RADIO_ACCEPTED_QUERY_KEYS.map((key) => `params.get("${key}");`),
        'params.get("profile");',
        'return new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });',
      ].join("\n"),
    };

    expect(personalizationQueryParameterReads(injected.source)).toEqual(["profile"]);
    expect([...acceptedQueryKeys(injected.source)].sort()).not.toEqual(
      [...RADIO_ACCEPTED_QUERY_KEYS].sort(),
    );
    expect(mediaByteIndicators(injected.source)).toContain("media MIME type");
    expect(dataLayerImports(injected.source)).toEqual(["@/data/localData"]);
  });
});

describe("architecture: no personalization weight crosses a request boundary (M10 task 6.1)", () => {
  it("keeps every radio-request module off the profile weights and the local data stores", () => {
    for (const requestModule of RADIO_REQUEST_MODULES) {
      const source = readSource(...requestModule.split("/"));
      expect(source.length, requestModule).toBeGreaterThan(0);
      // Not vacuous: each of these really does build a request payload.
      expect(moduleSpecifiers(source).length, requestModule).toBeGreaterThan(0);
      expect(radioRequestViolations(source), requestModule).toEqual([]);
    }
  });

  it("reads the request's own parameters: identity, variant, limit, and exclusions only", () => {
    // The client half of the same contract the server route pins: the query is
    // built by exactly these six keys, with no liked/history/profile key. I/O
    // -bound, like every sweep here.
    const source = readSource("features", "personalization", "radioApi.ts");
    const set = [...source.matchAll(/params\.set\(\s*["']([^"']+)["']/g)].map((match) => match[1]);

    // Not vacuous: the detector really does read the request builder's keys.
    expect(set.length).toBeGreaterThan(0);
    expect([...new Set(set)].sort()).toEqual([...RADIO_ACCEPTED_QUERY_KEYS].sort());
  }, 30_000);

  it("flags a weight or a store read in any request module — the rule is proven, not assumed", () => {
    const injected = RADIO_REQUEST_MODULES.map((requestModule) => ({
      requestModule,
      source:
        'import { TASTE_LIMITS } from "@/features/personalization/tasteProfile";\nimport { useLibraryStore } from "@/stores/libraryStore";',
    }));

    expect(
      injected
        .filter(({ source }) => radioRequestViolations(source).length > 0)
        .map(({ requestModule }) => requestModule),
    ).toEqual([...RADIO_REQUEST_MODULES]);
  });

  it("confines the profile's weighting constants to the scorer", () => {
    // The scorer is the one place a weight is *legitimately* read: it is the
    // local ranking, after a response has arrived. Everywhere else, a weight is
    // a tuning constant that must not travel. I/O-bound like every sweep here.
    const allowed = [...PROFILE_MODULES, ...SCORER_MODULES].map((owned) =>
      join(srcDir, ...owned.split("/")),
    );

    const offenders = readTree(srcDir)
      .filter(({ file }) => !allowed.includes(file))
      .filter(({ source }) => profileWeightingImports(source).length > 0)
      .map(({ file }) => relative(srcDir, file));

    expect(offenders).toEqual([]);
    // Not vacuous: the scorer really does read the weights, and the very same
    // detector finds it there.
    expect(profileWeightingImports(readSource(...SCORER_MODULES[0].split("/")))).toContain(
      "LIKE_WEIGHT",
    );
  }, 30_000);

  it("reads weights in one imported name at a time, so a renamed leak still fails", () => {
    // A weight aliased on import, or a direct relative specifier, is still the
    // same leak — the rule must not be defeatable by naming.
    expect(
      profileWeightingImports(
        'import { REPEAT_PENALTY as penalty } from "@/features/personalization/scoreCandidates";',
      ),
    ).toEqual(["REPEAT_PENALTY"]);
    expect(
      profileWeightingImports('import { ARTIST_AFFINITY_WEIGHT } from "./tasteProfile";'),
    ).toEqual(["ARTIST_AFFINITY_WEIGHT"]);
    // The profile's types and helpers are not weights and stay allowed.
    expect(
      profileWeightingImports(
        [
          'import type { TasteProfile } from "@/features/personalization/tasteProfile";',
          'import { buildTasteProfile, artistKeyOf } from "@/features/personalization/tasteProfile";',
          'import { scoreCandidates, type ScoreContext } from "@/features/personalization/scoreCandidates";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("architecture: a radio is a queue mode, not a second player (M10 task 6.1)", () => {
  it("keeps playback fields out of the radio store's initial state", () => {
    const source = readSource("stores", "radioStore.ts");
    expect(source.length).toBeGreaterThan(0);
    // Not vacuous: the extractor really does read this store's state keys.
    expect(radioStoreStateKeys(source).length).toBeGreaterThan(0);
    expect(radioStorePlaybackFields(source)).toEqual([]);
  });
});

/**
 * Insights/mixes layering invariants (M11 task 6.1, design §1/§2/§3/§5/§6).
 *
 * M11 adds the last two client feature folders and the rules around them are the
 * ones the "derived, never aggregated" promise rests on:
 *
 * - `features/insights` and `features/mixes` are repository-mediated like every
 *   other client surface: no IndexedDB implementation, no `src/server`, no raw
 *   provider shape, and no IFrame API loader.
 * - `features/insights/buildStats` and `classifyPlay` stay **pure**: they derive
 *   everything from `(events, now)`, so importing a store, a repository accessor,
 *   or the network would make a statistic depend on something other than the
 *   events it summarizes.
 * - **No aggregate is ever persisted.** A derived total written to storage is
 *   exactly the disagreement the spec forbids ("SHALL NOT store an aggregate that
 *   could disagree with the history it summarizes"), so any module that both names
 *   a derived statistic and performs a repository write fails.
 * - The mix request path is held to the M10 rule that already exists: it may read
 *   the profile and the local datasets *locally*, but a request carries only the
 *   feed parameters — never a taste weight, a store's data, or a profile.
 * - `/history` is a thin route: it mounts the two client views and reaches no
 *   dataset, no server module, and no network itself.
 */

/** The M11 surfaces the repository-mediated and player-internals rules must reach. */
const M11_SURFACE_DIRECTORIES = ["features/insights", "features/mixes", "app/history"] as const;

/** The M11 files, named so the coverage proof pins files, not only directories. */
const M11_TOUCHED_FILES = [
  join("app", "history", "page.tsx"),
  join("features", "history", "HistoryView.tsx"),
  join("features", "insights", "StatsView.tsx"),
  join("features", "insights", "buildStats.ts"),
  join("features", "insights", "classifyPlay.ts"),
  join("features", "mixes", "MixList.tsx"),
  join("features", "mixes", "generateMix.ts"),
  join("features", "mixes", "mixNaming.ts"),
  join("stores", "mixStore.ts"),
] as const;

/** The derivation modules that must stay a pure function of their inputs. */
const PURE_INSIGHT_MODULES = [
  join("features", "insights", "buildStats.ts"),
  join("features", "insights", "classifyPlay.ts"),
] as const;

/** The M11 modules that build a mix request — the boundary the M10 rule guards. */
const MIX_REQUEST_MODULES = [
  join("features", "mixes", "generateMix.ts"),
  join("features", "mixes", "mixNaming.ts"),
] as const;

/**
 * Specifiers a pure derivation must never reach: a store (state it did not
 * receive), the local-data accessor or the IndexedDB implementation (I/O a pure
 * function must not perform), the network, and the server layer.
 */
function impureSpecifier(specifier: string): string | null {
  if (/(^|[\\/])stores[\\/]/.test(specifier) || /[\\/]stores$/.test(specifier)) {
    return "store import";
  }
  if (/(^|[\\/])data[\\/](?:localData|indexeddb)/.test(specifier)) return "local-data import";
  if (targetsServerModule(specifier)) return "src/server import";
  if (/(^|[\\/])player[\\/](?:ytApi|types|engine)(\.tsx?)?$/.test(specifier)) {
    return "player internals import";
  }
  return null;
}

/** Violations of the pure-derivation rule, as labels. */
function purityViolations(source: string): string[] {
  const violations: string[] = [];
  for (const specifier of moduleSpecifiers(source)) {
    const label = impureSpecifier(specifier);
    if (label !== null) violations.push(label);
  }
  if (hasServerReferenceOrFetch(source)) violations.push("network call");
  if (accessesIndexedDbGlobal(source)) violations.push("indexedDB global access");
  return violations;
}

/**
 * Field names that only exist because statistics were derived. None of them may
 * appear in a module that also writes to a repository: a persisted aggregate is
 * the one thing that could disagree with the history it summarizes.
 */
const DERIVED_STAT_FIELDS = [
  "totalSeconds",
  "playCount",
  "eventCount",
  "topTracks",
  "topArtists",
  "currentStreak",
  "longestStreak",
  "lastListeningDay",
] as const;

/** Repository write calls — the only way derived data could be persisted. */
const REPOSITORY_WRITE_CALL =
  /\.(?:likedTracks|playlists|listeningHistory|searchHistory|preferences|session|mixes|metadataCache)\s*\.\s*(?:create|record|put|set|update|refresh|addTrack|like|unlike|removeTrack)\s*\(/;

/** Violations of the "no persisted aggregate" rule, as labels. */
function persistedAggregateViolations(source: string): string[] {
  const derived = DERIVED_STAT_FIELDS.filter((field) => new RegExp(`\\b${field}\\b`).test(source));
  // Both conditions are required: naming a statistic is fine (that is what the
  // derivation does), and writing a dataset is fine (that is what every
  // repository does). Persisting one *from* the other is the violation.
  if (derived.length === 0 || !REPOSITORY_WRITE_CALL.test(source)) return [];
  return [`derived statistics persisted (${derived.join(", ")})`];
}

describe("architecture violation detectors (M11 task 6.1)", () => {
  it("flags a store, local-data, server, or network reach from a derivation but passes pure code", () => {
    expect(purityViolations('import { useHistoryStore } from "@/stores/historyStore";')).toEqual([
      "store import",
    ]);
    expect(purityViolations('import { getLocalData } from "@/data/localData";')).toEqual([
      "local-data import",
    ]);
    // A server import is a local-data reach *and* a network reach; both are
    // reported, so one violation cannot hide behind the other.
    expect(purityViolations('import { runDiscovery } from "@/server/music/discovery";')).toEqual([
      "src/server import",
      "network call",
    ]);
    expect(purityViolations('import { loadYouTubeIframeApi } from "@/player/ytApi";')).toEqual([
      "player internals import",
    ]);
    expect(purityViolations('const res = await fetch("/api/discover");')).toEqual(["network call"]);
    expect(purityViolations('const open = indexedDB.open("spotivibe");')).toEqual([
      "indexedDB global access",
    ]);
    // The real derivations: pure imports over events and canonical domain types.
    expect(
      purityViolations(
        [
          'import { artistKeyOf, genreKeysOf } from "@/features/personalization/tasteProfile";',
          'import { languageName } from "@/lib/languages";',
          'import type { ListeningEventRecord } from "@/data/repositories";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it("flags a persisted aggregate but passes the derivation and the repositories", () => {
    expect(
      persistedAggregateViolations(
        "await data.mixes.create({ name, totalSeconds: 900, currentStreak: 3 });",
      ),
    ).toEqual(["derived statistics persisted (totalSeconds, currentStreak)"]);
    expect(
      persistedAggregateViolations("await data.listeningHistory.set({ playCount: 12 });"),
    ).toEqual(["derived statistics persisted (playCount)"]);
    // Naming a statistic without writing is the derivation itself.
    expect(
      persistedAggregateViolations("return { totalSeconds: total, topTracks, topArtists };"),
    ).toEqual([]);
    // Writing a dataset without naming a statistic is every repository.
    expect(
      persistedAggregateViolations(
        "const record = { ...event, id: event.id ?? crypto.randomUUID() };\nstore.put(record);",
      ),
    ).toEqual([]);
  });
});

describe("architecture: the M11 surfaces stay repository-mediated (M11 task 6.1)", () => {
  it("sweeps every M11 surface directory and pins the files it added", () => {
    for (const dir of M11_SURFACE_DIRECTORIES) {
      const real = readTree(join(srcDir, dir));
      expect(real.length, dir).toBeGreaterThan(0);
      const swept = uiSourceFiles().filter(({ file }) => file.startsWith(join(srcDir, dir)));
      // Not vacuous: the shared sweep reaches these directories, and reaches
      // exactly the files that are really there.
      expect(swept.map(({ file }) => file).sort(), dir).toEqual(
        real.map(({ file }) => file).sort(),
      );
    }
    for (const file of M11_TOUCHED_FILES) {
      expect(existsSync(join(srcDir, file)), file).toBe(true);
    }
  }, 30_000);

  it("finds no IndexedDB, server, provider-shape, or player-internals leak", () => {
    const files = M11_SURFACE_DIRECTORIES.flatMap((dir) => readTree(join(srcDir, dir)));
    expect(files.length).toBeGreaterThan(0);

    const offenders = files
      .filter(
        ({ source }) =>
          librarySurfaceViolations(source).length > 0 ||
          moduleSpecifiers(source).some(targetsPlayerInternals),
      )
      .map(({ file }) => relative(srcDir, file));
    expect(offenders).toEqual([]);
  });

  it("flags a leak in any M11 surface — the sweep is proven, not assumed", () => {
    const swept = uiSourceFiles().filter(({ file }) =>
      M11_SURFACE_DIRECTORIES.some((dir) => file.startsWith(join(srcDir, dir))),
    );
    expect(swept.length).toBeGreaterThan(0);
    const injected = swept.map(({ file }) => ({
      file,
      source:
        'import { createRepositories } from "@/data/indexeddb";\nimport { resolveArtist } from "@/server/music/catalog";\nconst node: MusicResponsiveListItemRenderer = input;',
    }));
    const expected = injected.map(({ file }) => file);

    expect(
      injected
        .filter(({ source }) => librarySurfaceViolations(source).length > 0)
        .map(({ file }) => file),
    ).toEqual(expected);
    expect(
      injected.filter(({ source }) => mentionsRawProviderShape(source)).map(({ file }) => file),
    ).toEqual(expected);
  }, 30_000);
});

describe("architecture: the insights derivations stay pure (M11 task 6.1)", () => {
  it("keeps buildStats and classifyPlay free of stores, repositories, and the network", () => {
    for (const file of PURE_INSIGHT_MODULES) {
      const source = readSource(file);
      expect(source.length, file).toBeGreaterThan(0);
      expect(purityViolations(source), file).toEqual([]);
      expect(accessesIndexedDbGlobal(source), file).toBe(false);
    }
    // Not vacuous: `buildStats` really does read canonical helpers, and the rule
    // accepts them. `classifyPlay` is deliberately self-contained — a rule that
    // passes an empty import list proves nothing about a module that imports.
    expect(
      moduleSpecifiers(readSource("features", "insights", "buildStats.ts")).length,
    ).toBeGreaterThan(0);
    expect(moduleSpecifiers(readSource("features", "insights", "classifyPlay.ts"))).toEqual([]);
  });
});

describe("architecture: no aggregate of listening is persisted (M11 task 6.1)", () => {
  it("finds no module that writes a derived statistic to a repository", () => {
    const offenders = readTree(srcDir)
      .filter(({ source }) => persistedAggregateViolations(source).length > 0)
      .map(({ file }) => relative(srcDir, file));

    expect(offenders).toEqual([]);
    // Not vacuous: the derivation really does name these fields, and the
    // repositories really do write — the rule needs both, and finds neither alone.
    expect(
      DERIVED_STAT_FIELDS.filter((field) =>
        readSource("features", "insights", "buildStats.ts").includes(field),
      ).length,
    ).toBeGreaterThan(3);
    // The other half of the rule: repository writes really happen in this tree,
    // so "no violation" cannot be an artifact of a pattern that never matches.
    expect(REPOSITORY_WRITE_CALL.test(readSource("features", "mixes", "generateMix.ts"))).toBe(
      true,
    );
  });
});

describe("architecture: mix requests carry only feed parameters (M11 task 6.1)", () => {
  it("keeps the mix request path free of taste weights and library/history stores", () => {
    for (const file of MIX_REQUEST_MODULES) {
      const source = readSource(file);
      expect(source.length, file).toBeGreaterThan(0);
      expect(radioRequestViolations(source), file).toEqual([]);
    }
  });

  it("still sends the request through the existing discovery feed client", () => {
    // No new provider capability: a mix is composed from the M8 `mix` feed, so
    // the discovery client is the transport and nothing else is.
    const source = readSource("features", "mixes", "generateMix.ts");
    expect(moduleSpecifiers(source)).toContain("@/features/home/discoveryApi");
    expect(source).toMatch(/kind:\s*"mix"/);
  });
});

describe("architecture: /history is a thin route (M11 task 6.1)", () => {
  it("mounts the client views and reaches no dataset, server module, or network", () => {
    const source = readSource("app", "history", "page.tsx");
    expect(source.length).toBeGreaterThan(0);
    expect(librarySurfaceViolations(source)).toEqual([]);
    expect(hasServerReferenceOrFetch(source)).toBe(false);
    expect(dataLayerImports(source)).toEqual([]);
    expect(moduleSpecifiers(source).filter(importsDataLayer)).toEqual([]);
    // The route mounts the client views and owns the route's single hidden h1.
    // It reaches no dataset itself: every view reads local data through the
    // repository interfaces, which the rules above already check per surface.
    for (const view of [
      "@/features/history/HistoryView",
      "@/features/insights/StatsView",
      "@/features/mixes/MixList",
    ]) {
      expect(moduleSpecifiers(source), view).toContain(view);
    }
  });
});

/* ------------------------------------------------------------------------- *
 * M12 - the podcast search mode (task 8.1)
 *
 * The mode is a *question*, threaded through the existing pipeline. Four things
 * must therefore stay true, and each is a rule a future change could break by
 * accident rather than by intent:
 *
 *   1. `category` is the only addition to the search route's input surface, and
 *      it is not a channel for local data.
 *   2. A category-scoped filter rule is reachable *only* from inside its own
 *      category's guard, and only from the filter module.
 *   3. The category selects tiers and upstream parameters - never a different
 *      provider capability (a second endpoint or host) from a provider module.
 *   4. The curated podcast catalog is a language catalog: it resolves through
 *      the one shared language module and the one preferences store, declares no
 *      second language list, and no podcast-specific local dataset exists.
 * ------------------------------------------------------------------------- */

/** The M12 files, named so the coverage proof pins files, not only directories. */
const M12_TOUCHED_FILES = [
  join("app", "api", "search", "route.ts"),
  join("features", "search", "SearchResults.tsx"),
  join("features", "search", "SearchView.tsx"),
  join("features", "search", "PodcastCategoryList.tsx"),
  join("features", "search", "podcastCategories.ts"),
  join("features", "search", "searchApi.ts"),
  join("features", "search", "useSearchController.ts"),
  join("lib", "searchUrl.ts"),
  join("server", "music", "chain.ts"),
  join("server", "music", "filter.ts"),
  join("server", "music", "normalize.ts"),
  join("server", "music", "search.ts"),
  join("server", "music", "types.ts"),
  join("server", "music", "providers", "ytweb.ts"),
  join("stores", "playerStore.ts"),
] as const;

/** The search route's documented input surface - the M3 pair plus the M12 one. */
const SEARCH_ROUTE_ACCEPTED_QUERY_KEYS = ["q", "limit", "category"];

/** The single module that owns the category-scoped filter rules. */
const FILTER_MODULE = join("server", "music", "filter.ts");

/** Rule constants, by the category whose guard they may only be reached from. */
const CATEGORY_RULE_PATTERNS = [
  { scope: "music", pattern: /\bMUSIC_ONLY_\w+_PATTERN\b/g },
  { scope: "podcast", pattern: /\bPODCAST_ONLY_\w+_PATTERN\b/g },
] as const;

/**
 * The `[start, end)` offsets of every `if (... category === "<name>" ...) { ... }`
 * block, found by matching braces from the guard's opening brace.
 *
 * Comments and strings are not stripped, so a mention inside prose cannot shift a
 * range: the guards in the code being checked are single-line conditions, and a
 * violation has to place a rule *use* outside a real block to be reported.
 */
function categoryGuardRanges(source: string, category: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const start of blockStarts(source, (condition) =>
    condition.includes(`category === "${category}"`),
  )) {
    const end = blockEnd(source, start);
    // The range starts at the `if` itself: a rule used inside the condition text
    // (`a && b`) sits before the opening brace, and it is guarded just as much as
    // one used in the body.
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}

/**
 * The offsets of every `if (...) {` block whose *whole* condition satisfies
 * `matches`, found by tracking parenthesis depth.
 *
 * Depth-tracking rather than a regex over the condition: a regex would stop at the
 * first `)` — which is the one inside `PATTERN.test(lowerTitle)`, i.e. exactly the
 * case a guard has to be recognized for. The reported offset is the `if` keyword,
 * so a call in the condition text is inside the block's range.
 */
function blockStarts(source: string, matches: (condition: string) => boolean): number[] {
  const starts: number[] = [];
  for (const match of source.matchAll(/\bif\s*\(/g)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          const after = source.slice(index + 1);
          if (matches(source.slice(open + 1, index)) && /^\s*\{/.test(after))
            starts.push(match.index ?? 0);
          break;
        }
      }
    }
  }
  return starts;
}

/** The offset of the `}` closing a block whose `{` is at or after `start`. */
function blockEnd(source: string, start: number): number {
  const open = source.indexOf("{", start);
  if (open < 0) return -1;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
/**
 * Every reference to a category-scoped rule constant that its own category guard
 * does not cover.
 *
 * With `file` set to the filter module, the check is per rule: a music-only
 * pattern used anywhere but inside a `category === "music"` block is a violation
 * (and vice versa). For any other module, naming one at all is the violation -
 * the rules belong to the filter stage, and a second implementation of them
 * anywhere else is a rule that can drift from the one that ships.
 */
function categoryRuleViolations(source: string, file: string): string[] {
  const violations: string[] = [];
  for (const { scope, pattern } of CATEGORY_RULE_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      if (!file.endsWith(FILTER_MODULE)) {
        violations.push(`${scope} rule used outside the filter module: ${match[0]}`);
        continue;
      }
      // The declaration itself sits outside any guard by necessity, so a
      // declaration line is not a use.
      const lineStart = source.lastIndexOf("\n", offset) + 1;
      if (source.slice(lineStart, offset).includes("const ")) continue;
      const covered = categoryGuardRanges(source, scope).some(
        ([start, end]) => offset > start && offset < end,
      );
      if (!covered) {
        violations.push(`${scope} rule used outside a category === "${scope}" guard: ${match[0]}`);
      }
    }
  }
  // One report per rule, however many times it is referenced: the question a
  // violation answers is "which rule", not "how often did you write it".
  return [...new Set(violations)];
}

/** Endpoint/host indicators: a category must not select a different capability. */
const CAPABILITY_BRANCH_INDICATORS = [
  { label: "upstream URL", pattern: /https?:\/\// },
  { label: "fetch call", pattern: /\bfetch\s*\(/ },
  { label: "request builder", pattern: /new\s+URLSearchParams|\bRequest\s*\(/ },
] as const;

/**
 * Category conditionals in a provider module whose body reaches a network
 * capability.
 *
 * The category is a question about *what to look for*: it picks which tiers are
 * asked, and which upstream parameters they are given. If a provider branched on
 * it to reach a different host, endpoint, or request shape, the mode would
 * quietly become a second provider integration - which is exactly the new
 * capability the mode is required not to add.
 */
function providerCapabilityBranchViolations(source: string): string[] {
  const violations: string[] = [];
  for (const start of blockStarts(source, (condition) => /category/.test(condition))) {
    const end = blockEnd(source, start);
    const body = source.slice(start, end < 0 ? source.length : end);
    for (const { label, pattern } of CAPABILITY_BRANCH_INDICATORS) {
      if (pattern.test(body)) violations.push(`${label} inside a category conditional`);
    }
  }
  // A ternary that picks between two capabilities is the same mistake in one line.
  const ternary = /category\s*===\s*"podcast"\s*\?[^:]*https?:\/\/[^:]*:/g;
  if (ternary.test(source)) violations.push("upstream URL selected by category");
  return violations;
}

/** Language codes the one shared catalog defines. */
function sharedLanguageCodes(): string[] {
  return [...readSource("lib", "languages.ts").matchAll(/code:\s*"([\w-]+)"/g)].map(
    (match) => match[1],
  );
}

/**
 * A curated-catalog violation: a second language list, a language key that is
 * neither a shared code nor the neutral fallback key, or a category that can
 * leave a selection with no query at all.
 */
function curatedCatalogViolations(source: string): string[] {
  const violations: string[] = [];
  violations.push(
    ...languageCatalogDeclarations(source).map((name) => `second language catalog ${name}`),
  );

  const shared = new Set(sharedLanguageCodes());
  const neutral = /const\s+NEUTRAL_LANGUAGE_KEY\s*=\s*"(\w+)"/.exec(source)?.[1];
  if (neutral === undefined) {
    violations.push("no neutral fallback key declared");
  } else {
    shared.add(neutral);
  }

  // Every `queries: { ... }` block's keys must be resolvable language keys. The
  // keys are bare identifiers (`en: [...]`) or the computed neutral key
  // (`[NEUTRAL_LANGUAGE_KEY]: [...]`), which is a key name rather than a code.
  for (const block of source.matchAll(/queries:\s*\{([^{}]*)\}/g)) {
    for (const key of block[1].matchAll(/\b([\w]+):\s*\[/g)) {
      const name = key[1];
      if (name === "NEUTRAL" || name === "NEUTRAL_LANGUAGE_KEY") continue;
      if (!shared.has(name)) {
        violations.push(`query text for a language the shared catalog does not define: ${name}`);
      }
    }
  }
  return violations;
}

/** Keys of the `Repositories` interface - the local dataset surface. */
function extractRepositoryKeys(source: string): string[] {
  const block = source.match(/export interface Repositories\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  return [...block.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
}

describe("architecture violation detectors (M12 task 8.1)", () => {
  it("flags a category-scoped rule reached without its own guard, and passes a guarded use", () => {
    // The music rule applied to every category - the exact mistake decision 4 was
    // written to prevent, and the one that deleted podcast content.
    expect(
      categoryRuleViolations(
        "function f(track) {\n  if (MUSIC_ONLY_NON_SONG_PATTERN.test(track.title)) return false;\n}",
        FILTER_MODULE,
      ),
    ).toEqual([
      'music rule used outside a category === "music" guard: MUSIC_ONLY_NON_SONG_PATTERN',
    ]);
    // The podcast rule behind a music guard is equally a violation.
    expect(
      categoryRuleViolations(
        'function f(track) {\n  if (track.category === "music") {\n    if (PODCAST_ONLY_PROMO_PATTERN.test(track.title)) return false;\n  }\n}',
        FILTER_MODULE,
      ),
    ).toEqual([
      'podcast rule used outside a category === "podcast" guard: PODCAST_ONLY_PROMO_PATTERN',
    ]);
    // A declaration is not a use, and a correctly guarded use passes.
    expect(
      categoryRuleViolations(
        'const MUSIC_ONLY_NON_SONG_PATTERN = /vlog/;\nfunction f(track) {\n  if (track.category === "music") {\n    if (MUSIC_ONLY_NON_SONG_PATTERN.test(track.title)) return false;\n  }\n}',
        FILTER_MODULE,
      ),
    ).toEqual([]);
  });

  it("flags a category-scoped rule duplicated into another module", () => {
    expect(
      categoryRuleViolations(
        'import { MUSIC_ONLY_NON_SONG_PATTERN } from "@/server/music/filter";\nif (track.category === "music") { if (MUSIC_ONLY_NON_SONG_PATTERN.test(t)) return false; }',
        join("server", "music", "chain.ts"),
      ),
    ).toEqual(["music rule used outside the filter module: MUSIC_ONLY_NON_SONG_PATTERN"]);
  });

  it("flags a category branch that reaches a network capability, and passes a parameter branch", () => {
    expect(
      providerCapabilityBranchViolations(
        'if (category === "podcast") {\n  const response = await fetch("https://podcasts.example.test/v1/search");\n}',
      ),
    ).toEqual([
      "upstream URL inside a category conditional",
      "fetch call inside a category conditional",
    ]);
    expect(
      providerCapabilityBranchViolations(
        'const url = category === "podcast" ? "https://a.test/s" : "https://b.test/s";',
      ),
    ).toEqual(["upstream URL selected by category"]);
    // Passing the question in the request body is the mode's contract, not a new
    // capability: no conditional, and no second host.
    expect(
      providerCapabilityBranchViolations(
        'function body(query, category) {\n  return { context, query, ...(category === "podcast" ? { params } : {}) };\n}',
      ),
    ).toEqual([]);
  });

  it("flags a rival language catalog or an unresolvable language key", () => {
    const good =
      'const NEUTRAL_LANGUAGE_KEY = "neutral";\nexport const PODCAST_CATEGORIES = [{ id: "news", queries: { en: ["a"], [NEUTRAL_LANGUAGE_KEY]: ["b"] } }];';
    expect(curatedCatalogViolations(good)).toEqual([]);
    expect(
      curatedCatalogViolations(
        'const NEUTRAL_LANGUAGE_KEY = "neutral";\nexport const LANGUAGES = [{ code: "en", name: "English" }, { code: "es", name: "Spanish" }, { code: "fr", name: "French" }];',
      ),
    ).toEqual(["second language catalog LANGUAGES"]);
    expect(
      curatedCatalogViolations(
        'const NEUTRAL_LANGUAGE_KEY = "neutral";\nexport const PODCAST_CATEGORIES = [{ id: "news", queries: { zz: ["a"], [NEUTRAL_LANGUAGE_KEY]: ["b"] } }];',
      ),
    ).toEqual(["query text for a language the shared catalog does not define: zz"]);
    expect(curatedCatalogViolations("export const PODCAST_CATEGORIES = [];")).toEqual([
      "no neutral fallback key declared",
    ]);
  });
});

describe("architecture: the M12 podcast surfaces hold (M12 task 8.1)", () => {
  it("sweeps every M12 file, so the rules below are known to reach them", () => {
    for (const file of M12_TOUCHED_FILES) {
      expect(readSource(file).length, file).toBeGreaterThan(0);
    }
    expect(M12_TOUCHED_FILES.length).toBeGreaterThanOrEqual(10);
  });

  it("keeps every category-scoped filter rule inside the filter module's own guards", () => {
    for (const { file, source } of readTree(join(srcDir, "server", "music"))) {
      expect(categoryRuleViolations(source, file), file).toEqual([]);
    }
    for (const { file, source } of readTree(join(srcDir, "features"))) {
      expect(categoryRuleViolations(source, file), file).toEqual([]);
    }
    for (const { file, source } of readTree(join(srcDir, "stores"))) {
      expect(categoryRuleViolations(source, file), file).toEqual([]);
    }
  });

  it("keeps the search route's input surface at q, limit, and category", () => {
    const source = readSource("app", "api", "search", "route.ts");
    expect([...acceptedQueryKeys(source)].sort()).toEqual(
      [...SEARCH_ROUTE_ACCEPTED_QUERY_KEYS].sort(),
    );
    // The one new key is a question, not a channel for the listener's data.
    expect(libraryQueryParameterReads(source)).toEqual([]);
    for (const key of ["deviceId", "profile", "likedTrackId", "trackIds", "playlistId"]) {
      expect(acceptedQueryKeys(source), key).not.toContain(key);
    }
  });

  it("flags a widened search-route input surface, proven on a violating snippet", () => {
    // The rule above is only worth having if it fails when the surface widens, so
    // the comparison is exercised against snippets: one with a fourth parameter, and
    // one that reads the listener's own data.
    const widened =
      'const q = params.get("q");\nconst limit = params.get("limit");\nconst category = params.get("category");\nconst liked = params.get("likedIds");';
    expect([...acceptedQueryKeys(widened)].sort()).not.toEqual(
      [...SEARCH_ROUTE_ACCEPTED_QUERY_KEYS].sort(),
    );
    expect(libraryQueryParameterReads(widened)).toEqual(["likedIds"]);

    // The exact current surface passes, so the detector is not simply always-fail.
    const current =
      'const q = params.get("q");\nconst limit = params.get("limit");\nconst category = params.get("category");';
    expect([...acceptedQueryKeys(current)].sort()).toEqual(
      [...SEARCH_ROUTE_ACCEPTED_QUERY_KEYS].sort(),
    );
    expect(libraryQueryParameterReads(current)).toEqual([]);
  });

  it("keeps the M12 client surfaces off the server layer, raw provider shapes, and local data", () => {
    for (const file of M12_TOUCHED_FILES.filter(
      (path) =>
        path.startsWith(join("features")) ||
        path.startsWith(join("stores")) ||
        path.startsWith(join("lib")),
    )) {
      const source = readSource(file);
      expect(mentionsRawProviderShape(source), file).toBe(false);
      expect(moduleSpecifiers(source).filter(targetsServerModule), file).toEqual([]);
      expect(hasDirectIndexedDbImport(source), file).toBe(false);
      // Exactly one of the M12 client modules talks to the network, and it is the
      // search transport that already did (M5); the mode is a query parameter on
      // it, not a second request path.
      const fetches = /\bfetch\s*\(/.test(source);
      expect(fetches, file).toBe(file === join("features", "search", "searchApi.ts"));
    }
  });

  it("lets the category select tiers and parameters, never a provider capability", () => {
    for (const { file, source } of readTree(join(srcDir, "server", "music", "providers"))) {
      expect(providerCapabilityBranchViolations(source), file).toEqual([]);
    }
    // Tier selection happens once, in the chain: a category conditional may name a
    // tier in no other module, so no provider can quietly drop or reorder a tier
    // for a question it is only supposed to be asked.
    const chain = readSource("server", "music", "chain.ts");
    expect(chain).toMatch(/function\s+tiersForCategory/);
    for (const { file, source } of readTree(join(srcDir, "server", "music"))) {
      if (file.endsWith(join("music", "chain.ts"))) continue;
      for (const start of blockStarts(source, (condition) => /category/.test(condition))) {
        const end = blockEnd(source, start);
        expect(source.slice(start, end < 0 ? source.length : end), file).not.toMatch(
          /\b(?:ytmusic|ytweb|invidious|piped)\b/,
        );
      }
    }
  });

  it("resolves the curated catalog through the one language catalog and the one store", () => {
    const catalog = readSource("features", "search", "podcastCategories.ts");
    expect(curatedCatalogViolations(catalog)).toEqual([]);
    // No language list, no fetch, and no second preferences store: the catalog is
    // query text, resolved by the caller.
    expect(catalog).not.toMatch(/\bfetch\s*\(/);
    expect(moduleSpecifiers(catalog)).not.toContain("@/data/localData");
    // The caller reads the selected languages from the M8 preferences store.
    const component = readSource("features", "search", "PodcastCategoryList.tsx");
    expect(component).toMatch(/usePreferencesStore/);
    expect(moduleSpecifiers(component)).toContain("@/features/search/podcastCategories");
    expect(component).not.toMatch(/languages\s*=\s*\[/);
  });

  it("adds no podcast-specific local dataset", () => {
    // Decision 8 in the strongest available form: the repository surface is
    // byte-for-byte the whitelist, and the store list matches it too.
    const keys = extractRepositoryKeys(readSource("data", "repositories", "index.ts"));
    expect(keys).toEqual(STORE_WHITELIST);
    expect(keys.some((key) => /podcast|episode/i.test(key))).toBe(false);
    const storeNames = extractStoreDefinitionNames(readSource("data", "indexeddb", "schema.ts"));
    expect(storeNames).toEqual(STORE_WHITELIST);
  });
});

/* ------------------------------------------------------------------ *
 * M13 - the PWA shell (task 6.1)
 * ------------------------------------------------------------------ *
 *
 * M13 adds a file that no architecture rule covered: a service worker lives in
 * `public/`, outside `src/`, so every existing "walk the src tree" rule passed it
 * by. These rules exist because that file is the one place in the application
 * that can *silently change what every route returns*:
 *
 *   1. The worker is self-contained. It is a classic script with no module
 *      imports, it names no application layer, and it cannot reach the data layer
 *      or a provider module - so a caching decision can never be made from
 *      application state.
 *   2. The PWA feature stays off the server layer, off raw provider shapes, and
 *      off IndexedDB: installability is a platform concern, not a data one.
 *   3. Adding the install affordance adds no dataset and no backup envelope
 *      change: the dismissal is a boot-time flag in `localStorage`, and the
 *      whitelisted repository/store surface is byte-for-byte what M2 defined.
 *   4. The manifest is a static install surface: no query parameters, so a
 *      listener's own data can never be expressed in an install identity.
 *   5. No server-side or data-layer module imports the PWA feature, and every
 *      PWA component is client-only.
 *
 * Each detector is exercised against a violating snippet first.
 */

/** The M13 files, named so the coverage proof pins files, not only directories. */
const M13_TOUCHED_FILES = [
  join("app", "manifest.ts"),
  join("app", "layout.tsx"),
  join("app", "settings", "page.tsx"),
  join("components", "layout", "AppShell.tsx"),
  join("components", "layout", "ConnectionBanner.tsx"),
  join("features", "pwa", "UpdateNotice.tsx"),
  join("features", "pwa", "installPrompt.ts"),
  join("features", "pwa", "serviceWorker.ts"),
] as const;

/** The worker, which lives outside `src/` and so is read by path. */
const SW_SOURCE = readFileSync(join(srcDir, "..", "public", "sw.js"), "utf8");

/** Layers the worker must not know about. */
const APP_LAYER_SPECIFIER =
  /(?:from|import)\s*["']@\/(?:data|server|features|components|stores|lib)\b/;

/** Browser-storage and media capabilities a worker must not have. */
function workerCapabilityViolations(source: string): string[] {
  // Comments are stripped: this file documents each denial in prose, and a
  // scanner that matched prose would be scanning the explanation.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const violations: string[] = [];
  if (/^\s*(?:import|export)\s/m.test(code)) violations.push("module syntax");
  if (APP_LAYER_SPECIFIER.test(code)) violations.push("application layer import");
  for (const [label, pattern] of [
    ["indexedDB", /\bindexedDB\b/],
    ["localStorage", /\blocalStorage\b/],
    ["sessionStorage", /\bsessionStorage\b/],
    ["navigator.storage", /navigator\s*\.\s*storage/],
    ["storage clearing", /\.clear\(\)/],
    ["document access", /\bdocument\s*\./],
  ] as const) {
    if (pattern.test(code)) violations.push(label);
  }
  return violations;
}

describe("architecture: the M13 PWA shell holds (M13 task 6.1)", () => {
  it("sweeps every M13 file, so the rules below are known to reach them", () => {
    for (const file of M13_TOUCHED_FILES) {
      expect(existsSync(join(srcDir, file)), file).toBe(true);
    }
    expect(M13_TOUCHED_FILES.length).toBeGreaterThanOrEqual(8);
    // And the worker exists, since every rule about it would otherwise pass
    // vacuously on a missing file.
    expect(SW_SOURCE.length).toBeGreaterThan(1000);
  });

  it("keeps the worker a self-contained classic script, proven on violating snippets", () => {
    expect(workerCapabilityViolations(SW_SOURCE)).toEqual([]);

    // A module worker that imported the data layer: the violation is reported.
    expect(
      workerCapabilityViolations(
        'import { db } from "@/data/indexeddb/index";\nexport default {};\n',
      ),
    ).toEqual(expect.arrayContaining(["module syntax", "application layer import"]));
    // A worker that opened IndexedDB or cleared storage: reported, named.
    expect(workerCapabilityViolations('const req = indexedDB.open("spotivibe");\n')).toEqual([
      "indexedDB",
    ]);
    expect(workerCapabilityViolations('await caches.open("x").then((c) => c.clear());\n')).toEqual([
      "storage clearing",
    ]);
    // A comment that *mentions* a denied capability is not a violation: this file
    // explains the denials in prose and must be allowed to.
    expect(workerCapabilityViolations("// never touch indexedDB or localStorage here\n")).toEqual(
      [],
    );
  });

  it("keeps the PWA feature off the server layer, raw provider shapes, and IndexedDB", () => {
    for (const file of M13_TOUCHED_FILES.filter((path) => path.startsWith(join("features")))) {
      const source = readSource(file);
      expect(moduleSpecifiers(source).filter(targetsServerModule), file).toEqual([]);
      expect(hasDirectIndexedDbImport(source), file).toBe(false);
      expect(mentionsRawProviderShape(source), file).toBe(false);
    }
    // The feature also adds no data-layer dependency at all, so the install
    // affordance cannot grow into a listener of the library.
    for (const { file, source } of readTree(join(srcDir, "features", "pwa"))) {
      expect(moduleSpecifiers(source), file).toEqual(
        expect.not.arrayContaining([expect.stringMatching(/^@\/data/)]),
      );
    }
  });

  it("keeps every PWA component client-only, and the feature off the server and data layers", () => {
    for (const { file, source } of readTree(join(srcDir, "features", "pwa"))) {
      // Both components read browser APIs during render, so both are client
      // components. A server component importing one would be a build-time lie.
      if (file.endsWith(".tsx")) expect(source, file).toMatch(/^"use client";/);
    }
    // Nothing on the server or in the data layer imports the PWA feature: caching
    // and installability are decided in the browser, and a server that knew about
    // them could not be cached honestly anyway.
    for (const dir of [join("src", "server"), join("src", "data")]) {
      for (const { file, source } of readTree(join(srcDir, "..", dir))) {
        expect(moduleSpecifiers(source), file).not.toContain("@/features/pwa/serviceWorker");
        expect(moduleSpecifiers(source), file).not.toContain("@/features/pwa/installPrompt");
      }
    }
  });

  it("adds no dataset, store, or backup envelope field for the install affordance", () => {
    // Decision 5 in the strongest available form: the repository surface and the
    // store list are byte-for-byte the M2 whitelist, and the PWA feature names no
    // store at all - the dismissal is a `localStorage` boot flag, not a dataset.
    const keys = extractRepositoryKeys(readSource("data", "repositories", "index.ts"));
    expect(keys).toEqual(STORE_WHITELIST);
    const storeNames = extractStoreDefinitionNames(readSource("data", "indexeddb", "schema.ts"));
    expect(storeNames).toEqual(STORE_WHITELIST);
    for (const { file, source } of readTree(join(srcDir, "features", "pwa"))) {
      expect(source, file).not.toMatch(/\bSTORE\.\w+/);
      expect(source, file).not.toMatch(/\bMetadataCacheRepository\b|\bPreferencesRepository\b/);
    }
  });

  it("keeps the manifest a static install surface, with no parameter to carry data", () => {
    const manifest = readSource("app", "manifest.ts");
    // No query is read and no local-data name appears: an install identity is a
    // constant, and a parameter in it would be a channel for listener data.
    expect(manifest).not.toMatch(/searchParams|params\.get|\?\w+=/);
    for (const name of ["deviceId", "profile", "liked", "playlist", "history", "session"]) {
      expect(manifest, name).not.toMatch(new RegExp(`"[^"]*${name}[^"]*":`, "i"));
    }
    // And the shipped manifest's own URLs are constant paths. The route module is
    // a pure function whose only import is a type, so it is read directly here.
    const shipped = manifestRoute();
    for (const url of [shipped.start_url, shipped.scope, shipped.id]) {
      expect(typeof url, "manifest url").toBe("string");
      expect(String(url).startsWith("/")).toBe(true);
      expect(String(url), "manifest url carries no parameter").not.toContain("?");
    }
  });
});

/* ------------------------------------------------------------------------- *
 * architecture: the M14 hardening holds (M14 tasks 1.6, 2.4, 5.1)
 *
 * Each rule below is proven against a violating snippet before it is applied to the
 * real code. A detector that has never been shown to fire is a comment.
 * ------------------------------------------------------------------------- */

describe("architecture: the M14 request boundary is one boundary (M14 task 1.6)", () => {
  /** Every API route handler, as (name, source). */
  function apiRoutes(): Array<{ name: string; source: string }> {
    const routesDir = join(srcDir, "app", "api");
    return readdirSync(routesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        source: readFileSync(join(routesDir, entry.name, "route.ts"), "utf8"),
      }));
  }

  it("finds every route, so the rules below are known to reach them", () => {
    const routes = apiRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(7);
    for (const route of routes) {
      expect(route.source, route.name).toMatch(/export async function GET\b/);
    }
  });

  it("guards every route through the one shared entry point, proven on a violating snippet", () => {
    // The violation: a route that validates and fans out to providers without ever
    // crossing the throttle. A snippet, so the rule is known to be able to fail.
    const unguarded = `
      import { z } from "zod";
      export async function GET(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        return Response.json({ ok: await runSearch(params.get("q") ?? "") });
      }
    `;
    const firstStatement = (source: string) =>
      source.slice(source.indexOf("export async function GET")).split("\n").slice(1, 4).join("\n");
    expect(firstStatement(unguarded), "the snippet is the violation").not.toContain("guardRequest");
    expect(firstStatement(readSource("app", "api", "search", "route.ts"))).toContain(
      "guardRequest",
    );

    for (const route of apiRoutes()) {
      expect(firstStatement(route.source), route.name).toContain("guardRequest(request)");
    }
  });

  it("serves only GET and consumes no request body, proven on a violating snippet", () => {
    // A body-consuming method on a public route would be the one place local data
    // could be posted to the server, and the spec says the boundary accepts none.
    const bodyRoute = `
      export async function POST(request: Request): Promise<Response> {
        const body = await request.json();
        return Response.json({ stored: body });
      }
    `;
    const methodNames = (source: string) =>
      [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map(
        (match) => match[1],
      );
    expect(methodNames(bodyRoute)).toEqual(["POST"]);
    for (const route of apiRoutes()) {
      expect(methodNames(route.source), route.name).toEqual(["GET"]);
      expect(route.source, route.name).not.toMatch(
        /await request\.(json|text|formData|arrayBuffer)\(/,
      );
    }
  });

  it("keeps the throttle out of the provider layer and the client", () => {
    // The limiter is a property of the public boundary. If the provider chain imported
    // it, a cached catalog seed would be refused for a request the listener never
    // made - and a client import would put per-process state in the browser.
    // Named modules, not the directory: `server/http/fetchJson` is the provider layer's
    // own HTTP helper from M3, and a rule that forbade the directory would have been
    // wrong about code this milestone did not write.
    const THROTTLE_MODULES = /from "@\/server\/http\/(throttle|guard|requestAddress)"/;
    for (const file of readTree(join(srcDir, "server", "music"))) {
      expect(file.source, file.file).not.toMatch(THROTTLE_MODULES);
    }
    const clientTree = readTree(join(srcDir, "app"))
      // `src/app/api/**` runs in Node: those route handlers are the boundary, and the
      // guard is theirs to call. Everything else under `src/app` is client code.
      .filter((file) => !file.file.includes(`${join("app", "api")}`))
      .concat(readTree(join(srcDir, "components")), readTree(join(srcDir, "features")));
    for (const file of clientTree) {
      expect(file.source, file.file).not.toMatch(THROTTLE_MODULES);
    }
    // Sanity: the sweep is not vacuous, and the routes really do import it.
    expect(clientTree.length).toBeGreaterThan(20);
    expect(readSource("app", "api", "search", "route.ts")).toMatch(THROTTLE_MODULES);
    // And the provider's own helper is still where it was.
    expect(readSource("server", "http", "fetchJson.ts")).toContain("export");
  });
});

describe("architecture: the M14 security policy is declared once (M14 task 5.1)", () => {
  it("declares the headers in the config only, proven on a violating snippet", () => {
    const config = readFileSync(join(srcDir, "..", "next.config.ts"), "utf8");
    expect(config).toContain("headers()");
    // A route that declares its own headers is a second place to forget to update, and
    // a way for one route to end up with weaker protection than the rest.
    const routeWithHeaders = `
      const config: NextConfig = { async headers() { return [{ source: "/x", headers: [] }]; } };
    `;
    expect(routeWithHeaders).toContain("headers()");
    for (const route of readdirSync(join(srcDir, "app"), { withFileTypes: true })) {
      void route;
    }
    const appTree = readTree(join(srcDir, "app"));
    for (const file of appTree) {
      expect(file.source, file.file).not.toMatch(/export const headers|async headers\(\)/);
      expect(file.source, file.file).not.toMatch(/Content-Security-Policy/);
    }
    // And no middleware, which would be a second runtime place the policy could differ.
    expect(existsSync(join(srcDir, "..", "middleware.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "..", "middleware.js"))).toBe(false);
  });

  it("keeps the audit harness out of the application bundle", () => {
    // The harness drives a browser over CDP. Shipping it would put a measurement tool
    // - and the notion that measuring is a runtime concern - into the application.
    for (const file of readTree(srcDir)) {
      expect(file.source, file.file).not.toMatch(/evidence\/audit|cdp-check/);
    }
    const tsconfig = readFileSync(join(srcDir, "..", "tsconfig.json"), "utf8");
    expect(tsconfig).not.toContain("openspec");
  });
});

describe("architecture: a stored record is untrusted everywhere (M14 task 2.4)", () => {
  /**
   * Surfaces that render listener-owned records, and the store that feeds them.
   *
   * The guard lives in the store rather than the view because that is where a
   * repository read lands: one place to get right, and every consumer inherits it.
   */
  const LISTENER_OWNED_SURFACES: Array<{ file: string; feed: string }> = [
    { file: "features/library/LikedSongsView.tsx", feed: "useLibraryStore" },
    { file: "features/library/LibraryView.tsx", feed: "useLibraryStore" },
    { file: "features/history/HistoryView.tsx", feed: "useHistoryStore" },
  ];

  it("guards the store that feeds each listener-owned surface", () => {
    expect(LISTENER_OWNED_SURFACES.length).toBeGreaterThan(2);
    const libraryStore = readSource("stores", "libraryStore.ts");
    const historyStore = readSource("stores", "historyStore.ts");
    for (const surface of LISTENER_OWNED_SURFACES) {
      const view = readSource(...surface.file.split("/"));
      // The surface reads the store...
      expect(view, surface.file).toContain(surface.feed);
      // ...and the store guards what it hands over.
      const store = surface.feed === "useLibraryStore" ? libraryStore : historyStore;
      expect(store, surface.feed).toMatch(/renderable(Tracks|Playlists|Events)\(/);
    }
  });

  it("keeps rendering surfaces off the repositories, proven on a violating snippet", () => {
    // The violation: a view that opens storage itself, so the guard in the store is
    // bypassed for exactly the records it is there to protect.
    const viewReadingStorage = `
      export function LikedView() {
        const [tracks, setTracks] = useState<Track[]>([]);
        useEffect(() => {
          void getLocalData().then((data) => data.likedTracks.list().then(setTracks));
        }, []);
        return <ul>{tracks.map((track) => <li key={track.providerId}>{track.title}</li>)}</ul>;
      }
    `;
    expect(viewReadingStorage, "the snippet is the violation").toContain("getLocalData()");

    for (const surface of LISTENER_OWNED_SURFACES) {
      const view = readSource(...surface.file.split("/"));
      expect(view, surface.file).not.toContain("getLocalData");
    }
  });

  it("names every feature that reads storage directly, with its reason", () => {
    // These are derivation and management paths, not rendering paths: statistics
    // aggregate, mix generation selects, local search filters, backup and the settings
    // dialogs manage. Each reads records to compute something or to hand them to a
    // caller that guards them, and each is named here so a new direct reader is a
    // deliberate addition rather than a silent bypass.
    const DIRECT_READERS: Record<string, string> = {
      "features/backup/DataControls.tsx":
        "backup export and import, which serialize records itself",
      "features/insights/StatsView.tsx": "aggregates the whole history into statistics",
      "features/mixes/generateMix.ts": "selects tracks for a generated mix",
      "features/search/localSearch.ts": "filters the local search-history index",
      "features/search/RecentSearches.tsx":
        "renders search entries, a record type with no track fields",
      "features/search/useSearchController.ts":
        "rewrites the local search-history index on a query",
      "features/storage/storageStatus.ts": "M14: observes the connection so a failure can be named",
      "player/persistence.ts": "restores the playback session",
    };
    const found = new Set<string>();
    for (const file of readTree(srcDir)) {
      if (file.source.includes("getLocalData")) {
        found.add(relative(srcDir, file.file).replace(/\\/g, "/"));
      }
    }
    // The stores read through the same accessor and are the surfaces that guard.
    for (const store of [
      "stores/historyStore.ts",
      "stores/libraryStore.ts",
      "stores/mixStore.ts",
      "stores/preferencesStore.ts",
    ]) {
      expect(found.has(store), store).toBe(true);
    }
    const features = [...found].filter(
      (file) => file.startsWith("features/") || file.startsWith("player/"),
    );
    expect(features.sort(), "every direct reader is named, with its reason").toEqual(
      Object.keys(DIRECT_READERS).sort(),
    );
    for (const [file, reason] of Object.entries(DIRECT_READERS)) {
      expect(reason.length, `${file} must state why`).toBeGreaterThan(20);
    }
  });

  it("keeps the record guard in the data layer, with no presentation dependency", () => {
    const guard = readSource("data", "repositories", "renderable.ts");
    // It judges record shapes, so it belongs beside them and imports nothing else.
    expect(guard).toMatch(/from "\.\/types"/);
    expect(guard).not.toMatch(/from "react"|from "@\/(components|features|stores|server)/);
    // And it skips rather than repairs: a fabricated title in someone's library is
    // something they cannot tell apart from real data.
    expect(guard).toContain("It does not repair");
  });
});

describe("architecture: the M14 resilience items stay implemented (M14 task 2.5)", () => {
  it("keeps the caps and the chain that ROADMAP M14 already had implemented", () => {
    // Confirmed rather than re-implemented, with the named constant in each case, so
    // this fails if a later change quietly removes a cap.
    const engine = readSource("player", "engine.ts");
    expect(engine).toMatch(/export const MAX_RETRY_ATTEMPTS = \d+;/);
    const support = readSource("server", "music", "providers", "support.ts");
    expect(support).toMatch(/export const MAX_INSTANCE_ATTEMPTS = \d+;/);
    const catalog = readSource("server", "music", "catalog.ts");
    expect(catalog).toMatch(/export const CATALOG_SEED_TIMEOUT_MS = [\d_]+;/);
    expect(catalog).toMatch(/export const CATALOG_SEED_CONCURRENCY = \d+;/);
    // The in-flight deduplication the roadmap credits M3 with.
    expect(readSource("server", "music", "cache.ts")).toMatch(/createInflightDedup/);
  });

  it("keeps the worker's cache reads behind the usability check", () => {
    const worker = readFileSync(join(srcDir, "..", "public", "sw.js"), "utf8");
    // Every strategy goes through the one helper; a direct `cache.match` outside it is
    // an entry that can be served without being checked.
    // Exactly one, and it is the helper's own: every other read would be an entry
    // served without being checked for usability.
    const directMatches = [...worker.matchAll(/cache\.match\(/g)].length;
    expect(directMatches, "only the helper reads a cache directly").toBe(1);
    const helperStart = worker.indexOf("async function readUsable");
    const helperEnd = worker.indexOf("async function isIntactResponse");
    expect(helperStart).toBeGreaterThan(-1);
    expect(worker.slice(helperStart, helperEnd), "the one read is inside the helper").toContain(
      "cache.match(",
    );
    expect(worker).toContain("readUsable");
    expect(worker).toContain("isIntactResponse");
  });
});
