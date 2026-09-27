import type { Track } from "@/data/repositories";
import type { ProviderCandidate } from "@/server/music/types";

/** Shared music-layer fixtures (not collected by Vitest). */

export function makeCandidate(overrides: Partial<ProviderCandidate> = {}): ProviderCandidate {
  return {
    videoId: "vid000001",
    title: "Get Lucky",
    artistText: "Daft Punk",
    artwork: [{ url: "https://example.test/art.jpg", width: 120, height: 120 }],
    durationSeconds: 249,
    tier: "ytmusic",
    ...overrides,
  };
}

export function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "youtube:vid000001",
    source: "youtube",
    providerId: "vid000001",
    title: "Get Lucky",
    artists: [{ name: "Daft Punk" }],
    artwork: [{ url: "https://example.test/art.jpg" }],
    durationSeconds: 249,
    category: "music",
    capabilities: { stream: true, offlineDownload: false },
    ...overrides,
  };
}
