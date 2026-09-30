/**
 * Recorded provider responses for the end-to-end suite (M15 task 2.2).
 *
 * ## Why recorded, and what that proves
 *
 * A suite that calls YouTube fails when YouTube rate-limits a CI runner, and a flaky gate
 * gets disabled — and a disabled gate is the false assurance this milestone exists to
 * avoid. So the router answers every `/api/*` request from here, and a run is
 * reproducible and offline.
 *
 * **The boundary, stated plainly: this proves the *application's* behaviour and nothing
 * about the providers.** That is the correct division — the providers are not this
 * project's to test — but it means a provider outage is invisible to this suite by
 * construction. One scenario therefore fails a provider *deliberately* (see
 * `FAILING_ROUTES`) so the fallback path is exercised rather than assumed.
 *
 * ## Why the shapes are hand-written rather than captured
 *
 * These are in the shape the normalizer *produces*, which the normalisation tests pin. A
 * fixture that stopped matching that shape would fail a unit test rather than quietly
 * teaching the suite something untrue — which is the coupling that makes hand-writing
 * safe here.
 */

/** One track, in the normalized `Track` shape. */
export function makeTrack({
  videoId,
  title,
  artist,
  album,
  durationSeconds = 212,
  category = "music",
  language = "en",
} = {}) {
  const id = `youtube:${videoId}`;
  return {
    id,
    source: "youtube",
    providerId: videoId,
    title,
    artists: [{ name: artist }],
    ...(album ? { album: { title: album } } : {}),
    artwork: [
      {
        url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        width: 480,
        height: 480,
      },
    ],
    durationSeconds,
    category,
    language,
    // `offlineDownload` is false by rule, for every YouTube-sourced track.
    capabilities: { stream: true, offlineDownload: false },
  };
}

export const TRACKS = [
  makeTrack({
    videoId: "fixture-alpha",
    title: "Fixture Alpha",
    artist: "The Deterministic Band",
    album: "Recorded Responses",
  }),
  makeTrack({
    videoId: "fixture-beta",
    title: "Fixture Beta",
    artist: "The Deterministic Band",
    album: "Recorded Responses",
    durationSeconds: 245,
  }),
  makeTrack({
    videoId: "fixture-gamma",
    title: "Fixture Gamma",
    artist: "Another Fixture Artist",
    durationSeconds: 198,
  }),
];

/** `GET /api/search` in its success shape. */
export const SEARCH_OK = {
  ok: true,
  tracks: TRACKS,
  diagnostics: {
    tier: "ytmusic",
    tiersTried: [{ tier: "ytmusic", outcome: "ok" }],
    cached: false,
    resultCount: TRACKS.length,
  },
};

/** `GET /api/artist` in its success shape. */
export const ARTIST_OK = {
  ok: true,
  artist: {
    id: "UCfixture",
    name: "The Deterministic Band",
    artworkUrl: "https://i.ytimg.com/vi/fixture-alpha/hq.jpg",
  },
  tracks: TRACKS,
  related: [{ id: "UCrelated", name: "Another Fixture Artist" }],
  releases: [
    { id: "fixture-release", title: "Recorded Responses", year: 2026 },
  ],
  diagnostics: {
    tier: "ytmusic",
    cached: false,
    seedCount: 1,
    resolvedCount: 1,
    failures: [],
  },
};

/**
 * Routes for a working application.
 *
 * `path` matches exactly; `match` is for a family of paths. A request with no route is
 * continued to the network, so the router stands in for the providers and never for the
 * application itself.
 */
export const WORKING_ROUTES = [
  { path: "/api/search", match: /^\/api\/search/, body: SEARCH_OK },
  { path: "/api/artist", match: /^\/api\/artist/, body: ARTIST_OK },
  {
    path: "/api/album",
    match: /^\/api\/album/,
    body: {
      ok: true,
      album: {
        id: "fixture-release",
        title: "Recorded Responses",
        artistName: "The Deterministic Band",
        year: 2026,
      },
      tracks: TRACKS,
      diagnostics: {
        tier: "ytmusic",
        cached: false,
        seedCount: 1,
        resolvedCount: 1,
        failures: [],
      },
    },
  },
  { path: "/api/similar", match: /^\/api\/similar/, body: SEARCH_OK },
  {
    path: "/api/playlist",
    match: /^\/api\/playlist/,
    body: {
      ok: true,
      playlist: {
        id: "PLfixture",
        name: "Fixture Playlist",
        description: "A recorded playlist.",
        trackCount: TRACKS.length,
      },
      tracks: TRACKS,
      diagnostics: {
        tier: "ytmusic",
        cached: false,
        seedCount: 1,
        resolvedCount: 1,
        failures: [],
      },
    },
  },
  {
    path: "/api/radio",
    match: /^\/api\/radio/,
    body: {
      ok: true,
      tracks: TRACKS,
      diagnostics: {
        tier: "ytmusic",
        cached: false,
        seedCount: 1,
        resolvedCount: 1,
        failures: [],
      },
    },
  },
  {
    path: "/api/discover",
    match: /^\/api\/discover/,
    body: {
      ok: true,
      kind: "trending",
      tracks: TRACKS,
      diagnostics: {
        tier: "ytmusic",
        cached: false,
        seedCount: 0,
        resolvedCount: 1,
        failures: [],
      },
    },
  },
];

/**
 * Routes for a provider that is failing.
 *
 * A 503 with a JSON body is what the application's own routes return when every tier
 * fails, so this is the shape the client already handles. The fallback notice is
 * `fallback-notice` in the shell, and the point of the scenario is that a listener sees
 * an explanation rather than an empty page.
 */
export const FAILING_ROUTES = [
  {
    path: "/api/search",
    match: /^\/api\/search/,
    status: 503,
    body: {
      ok: false,
      tiersTried: [
        { tier: "ytmusic", outcome: "unreachable" },
        { tier: "ytweb", outcome: "unreachable" },
      ],
    },
  },
  {
    path: "/api/artist",
    match: /^\/api\/artist/,
    status: 503,
    body: { ok: false },
  },
  {
    path: "/api/album",
    match: /^\/api\/album/,
    status: 503,
    body: { ok: false },
  },
  {
    path: "/api/similar",
    match: /^\/api\/similar/,
    status: 503,
    body: { ok: false },
  },
  {
    path: "/api/playlist",
    match: /^\/api\/playlist/,
    status: 503,
    body: { ok: false },
  },
  {
    path: "/api/radio",
    match: /^\/api\/radio/,
    status: 503,
    body: { ok: false },
  },
  {
    path: "/api/discover",
    match: /^\/api\/discover/,
    status: 503,
    body: { ok: false },
  },
];
