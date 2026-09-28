"use client";

import { IconButton } from "@/components/design-system/IconButton";
import type { RepeatMode } from "@/data/repositories";
import { usePlayerStore } from "@/stores/playerStore";
import { useQueueStore } from "@/stores/queueStore";
import { Pause, Play, Repeat, Repeat1, Shuffle, Volume2, VolumeX } from "lucide-react";

/**
 * Store-driven playback controls shared by the persistent surfaces (spec:
 * controls render from the store and dispatch store actions). Active states
 * are tinted with the theme's accent color via an inline custom property so
 * they win over the IconButton tone's base color.
 *
 * - PlayPause: shows the pause affordance while a load/playback is pending.
 * - Repeat: cycles off → context → all… with the active mode in its label.
 * - Shuffle: toggles shuffled traversal (aria-pressed).
 * - Volume: mute toggle plus a 0–100 slider bound to the store.
 */

/** Statuses where the player is (or is about to be) running: show Pause. */
const RUNNING_STATUSES = new Set(["loading", "buffering", "playing"]);

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat: Off",
  context: "Repeat: All",
  track: "Repeat: One",
};

function accentWhen(active: boolean): { color?: string } {
  return active ? { color: "var(--color-spotify-green)" } : {};
}

export function PlayPauseButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const hasTrack = usePlayerStore((state) => state.currentTrack !== null);
  const status = usePlayerStore((state) => state.status);
  const play = usePlayerStore((state) => state.play);
  const pause = usePlayerStore((state) => state.pause);

  if (hasTrack && RUNNING_STATUSES.has(status)) {
    return (
      <IconButton label="Pause" size={size} tone="accent" onClick={() => pause()}>
        <Pause className="size-5 fill-current" aria-hidden="true" />
      </IconButton>
    );
  }
  return (
    <IconButton label="Play" size={size} tone="accent" disabled={!hasTrack} onClick={() => play()}>
      <Play className="size-5 fill-current" aria-hidden="true" />
    </IconButton>
  );
}

export function ShuffleToggle() {
  const shuffle = useQueueStore((state) => state.shuffle);
  const toggleShuffle = useQueueStore((state) => state.toggleShuffle);
  return (
    <IconButton
      label="Shuffle"
      aria-pressed={shuffle}
      title={shuffle ? "Shuffle: On" : "Shuffle: Off"}
      style={accentWhen(shuffle)}
      onClick={() => toggleShuffle()}
    >
      <Shuffle className="size-5" aria-hidden="true" />
    </IconButton>
  );
}

export function RepeatToggle() {
  const repeatMode = useQueueStore((state) => state.repeatMode);
  const cycleRepeat = useQueueStore((state) => state.cycleRepeat);
  const Icon = repeatMode === "track" ? Repeat1 : Repeat;
  return (
    <IconButton
      label={REPEAT_LABEL[repeatMode]}
      aria-pressed={repeatMode !== "off"}
      title={REPEAT_LABEL[repeatMode]}
      style={accentWhen(repeatMode !== "off")}
      onClick={() => cycleRepeat()}
    >
      <Icon className="size-5" aria-hidden="true" />
    </IconButton>
  );
}

export function VolumeControls() {
  const volume = usePlayerStore((state) => state.volume);
  const muted = usePlayerStore((state) => state.muted);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const toggleMute = usePlayerStore((state) => state.toggleMute);

  return (
    <>
      <IconButton
        label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        onClick={() => toggleMute()}
      >
        {muted ? (
          <VolumeX className="size-5" aria-hidden="true" />
        ) : (
          <Volume2 className="size-5" aria-hidden="true" />
        )}
      </IconButton>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={volume}
        aria-label="Volume"
        data-testid="volume-slider"
        className="h-1 w-24 cursor-pointer accent-spotify-green"
        onChange={(event) => setVolume(Number(event.target.value))}
      />
    </>
  );
}
