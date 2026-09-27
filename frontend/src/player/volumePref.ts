/**
 * Tiny boot-time playback preference (volume + mute) kept in `localStorage`
 * (AGENTS.md: localStorage only for tiny boot-time preferences). Kept out of
 * the IndexedDB preferences dataset so the local-data/backup schemas stay
 * untouched; output level is a per-device concern, not part of a backup.
 */

export interface VolumePreference {
  /** 0..100 (player units). */
  volume: number;
  muted: boolean;
}

export const DEFAULT_VOLUME_PREFERENCE: VolumePreference = { volume: 80, muted: false };

const STORAGE_KEY = "spotivibe.volume";

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME_PREFERENCE.volume;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function readVolumePreference(): VolumePreference {
  if (typeof localStorage === "undefined") return DEFAULT_VOLUME_PREFERENCE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_VOLUME_PREFERENCE;
    const parsed = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
    return {
      volume: typeof parsed.volume === "number" ? clampVolume(parsed.volume) : DEFAULT_VOLUME_PREFERENCE.volume,
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULT_VOLUME_PREFERENCE.muted,
    };
  } catch {
    // Corrupt or unreadable storage (private-mode quota, bad JSON): the
    // default preference applies; the in-memory value stays authoritative.
    return DEFAULT_VOLUME_PREFERENCE;
  }
}

export function writeVolumePreference(preference: VolumePreference): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ volume: clampVolume(preference.volume), muted: preference.muted }),
    );
  } catch {
    // Best-effort persistence: storage can be full or blocked; playback then
    // keeps the in-memory preference for the rest of the session.
  }
}
