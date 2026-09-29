import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static architecture invariants checked against the real source files
 * (M2 task 7.1 + M3 task 6.1 + M4 task 5.1 + M5 task 8.1 + M6 task 9.1 +
 * M7 task 9.1 + M8 task 8.1) —
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
 * `lib/languages.ts` the single language catalog.
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

function readTree(dir: string): Array<{ file: string; source: string }> {
  return walk(dir).map((file) => ({ file, source: readFileSync(file, "utf8") }));
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
function uiSourceFiles(): Array<{ file: string; source: string }> {
  return ["app", "components", "features", "stores"]
    .flatMap((dir) => readTree(join(srcDir, dir)))
    .filter(({ file }) => !/[\\/]api(?:[\\/][^\\/]+)*[\\/]route\.tsx?$/.test(file));
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

/** Whitelists: the seven stores (ROADMAP §8/§13) and six exportable datasets. */
const STORE_WHITELIST = [
  "likedTracks",
  "playlists",
  "listeningHistory",
  "searchHistory",
  "preferences",
  "session",
  "metadataCache",
];
const BACKUP_WHITELIST = [
  "preferences",
  "likedTracks",
  "playlists",
  "history",
  "searchHistory",
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

/** Top-level keys of `export const initialPlayerState = { ... };`. */
function transportStateKeys(source: string): string[] {
  const block = source.match(/export const initialPlayerState = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  return [...block.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]);
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
  });

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
